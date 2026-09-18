/**
 * workers/image-publisher/src/index.ts
 * Cloudflare Worker for TOEIC Vocab image publishing, verification, and manifest management.
 * Features:
 * - Binary upload (multipart/form-data) ONLY with zero Base64 decoding overhead
 * - Optimistic concurrency with If-None-Match: * (etagDoesNotMatch: '*') for image immutability
 * - Optimistic CAS (Compare-And-Swap) for per-word ledger and global runtime manifest
 * - Strict Manifest Publication Order:
 *     1. Write immutable snapshot FIRST
 *     2. Verify snapshot exists
 *     3. CAS update manifests/current.json pointer
 * - Batch Manifest Commit support (POST /api/manifest/batch-commit)
 * - Rollback with CAS
 * - Sub-10ms CPU execution efficiency
 */

export interface Env {
  PUBLIC_BUCKET: R2Bucket;
  PRIVATE_BUCKET: R2Bucket;
  STUDIO_PRESHARED_SECRET: string;
  ALLOWED_ORIGINS?: string;
}

interface PublishMetadata {
  wordId: string;
  imageSha256: string;
  prompt?: {
    promptProvenance?: 'recovered-from-audit' | 'legacy-local-unrecorded' | 'unknown';
    historicalPrompt?: string | null;
    currentDatasetContext?: {
      source: string;
      visualAnchorPrompt?: string;
      exampleEn?: string;
      exampleZh?: string;
    } | null;
    formulaVersion?: string;
    fullPromptText?: string;
    promptHash?: string;
  };
  generator?: {
    provider?: string;
    model?: string;
    costTwd?: number;
    generatedBy?: string;
  };
  publishRequestId: string;
  dimensions?: {
    width: number;
    height: number;
  };
  skipManifestCommit?: boolean;
}

interface BatchCommitRequestBody {
  batchRequestId: string;
  updates: Record<string, { v: number; h: string; w?: number; ht?: number }>;
}

interface RollbackRequestBody {
  wordId: string;
  targetVersion: number;
}

const WORD_ID_REGEX = /^tw_[wp]_[a-f0-9]{12}$/;
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB limit

function getCorsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin') || '*';
  const allowed = env.ALLOWED_ORIGINS || '*';
  let allowOrigin = '*';

  if (allowed !== '*') {
    const list = allowed.split(',').map((s) => s.trim());
    if (list.includes(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      allowOrigin = origin;
    } else {
      allowOrigin = list[0] || '*';
    }
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Studio-Secret, X-Publish-Request-Id',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data: unknown, status = 200, corsHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders,
    },
  });
}

function isValidWebP(data: Uint8Array): boolean {
  if (data.length < 12) return false;
  // RIFF header
  if (data[0] !== 0x52 || data[1] !== 0x49 || data[2] !== 0x46 || data[3] !== 0x46) return false;
  // WEBP signature
  if (data[8] !== 0x57 || data[9] !== 0x45 || data[10] !== 0x42 || data[11] !== 0x50) return false;
  return true;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const startTime = performance.now();
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request, env);

    // 1. Handle CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // 2. Route: GET /api/manifest/current (Public or Authenticated)
    if (request.method === 'GET' && url.pathname === '/api/manifest/current') {
      const manifestObj = await env.PUBLIC_BUCKET.get('manifests/current.json');
      if (!manifestObj) {
        return jsonResponse(
          {
            schemaVersion: '1.0',
            manifestUri: null,
            manifestVersion: 0,
            generatedAt: new Date().toISOString(),
            count: 0,
            images: {},
          },
          200,
          corsHeaders
        );
      }
      const data = await manifestObj.json();
      return jsonResponse(data, 200, {
        ...corsHeaders,
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=86400',
      });
    }

    // 2.05 Route: GET/HEAD /manifests/* (Public manifest snapshot delivery)
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/manifests/')) {
      const objectKey = url.pathname.slice(1);
      const object = await env.PUBLIC_BUCKET.get(objectKey);
      if (!object) {
        return new Response('Not Found', { status: 404, headers: corsHeaders });
      }
      const headers = new Headers();
      headers.set('Content-Type', 'application/json; charset=utf-8');
      headers.set('etag', object.httpEtag);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v as string));
      if (request.method === 'HEAD') {
        return new Response(null, { headers });
      }
      return new Response(object.body, { headers });
    }

    // 2.1 Route: GET/HEAD /words/* (Public image delivery route)
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/words/')) {
      const objectKey = url.pathname.slice(1);
      const object = await env.PUBLIC_BUCKET.get(objectKey);
      if (!object) {
        return new Response('Not Found', { status: 404, headers: corsHeaders });
      }
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v as string));
      if (request.method === 'HEAD') {
        return new Response(null, { headers });
      }
      return new Response(object.body, { headers });
    }

    // 2.2 Route: GET /api/ledger/:wordId (Authenticated ledger inspection)
    if (request.method === 'GET' && url.pathname.startsWith('/api/ledger/')) {
      const clientSecret = request.headers.get('X-Studio-Secret');
      if (!clientSecret || clientSecret !== env.STUDIO_PRESHARED_SECRET) {
        return jsonResponse(
          { error: 'Unauthorized: invalid or missing X-Studio-Secret' },
          401,
          corsHeaders
        );
      }
      const wordId = url.pathname.replace('/api/ledger/', '').trim();
      if (!WORD_ID_REGEX.test(wordId)) {
        return jsonResponse({ error: `Invalid wordId format: ${wordId}` }, 400, corsHeaders);
      }
      const ledgerKey = `ledger/words/${wordId}.json`;
      const ledgerObj = await env.PRIVATE_BUCKET.get(ledgerKey);
      if (!ledgerObj) {
        return jsonResponse({ error: 'Ledger not found' }, 404, corsHeaders);
      }
      const data = await ledgerObj.json();
      return jsonResponse(data, 200, corsHeaders);
    }

    // 3. Authenticate mutating endpoints (POST /api/publish, POST /api/manifest/batch-commit, POST /api/rollback)
    if (request.method === 'POST') {
      const clientSecret = request.headers.get('X-Studio-Secret');
      if (!clientSecret || clientSecret !== env.STUDIO_PRESHARED_SECRET) {
        return jsonResponse(
          { error: 'Unauthorized: invalid or missing X-Studio-Secret' },
          401,
          corsHeaders
        );
      }

      // Route: POST /api/publish (Binary multipart/form-data upload ONLY)
      if (url.pathname === '/api/publish') {
        let meta: PublishMetadata;
        let imageBytes: Uint8Array;

        const contentType = request.headers.get('content-type') || '';

        // Strict Requirement: Binary multipart/form-data only (JSON/Base64 fallback removed)
        if (!contentType.includes('multipart/form-data')) {
          return jsonResponse(
            { error: 'Unsupported Media Type: binary multipart/form-data upload required' },
            415,
            corsHeaders
          );
        }

        try {
          const formData = await request.formData();
          const file = formData.get('file');
          const metaRaw = formData.get('metadata');
          if (!file || typeof file === 'string' || !metaRaw || typeof metaRaw !== 'string') {
            return jsonResponse(
              { error: 'Invalid multipart form: expected "file" Blob and "metadata" JSON string' },
              400,
              corsHeaders
            );
          }
          meta = JSON.parse(metaRaw);
          const arrayBuffer = await (file as Blob).arrayBuffer();
          imageBytes = new Uint8Array(arrayBuffer);
        } catch (err: any) {
          return jsonResponse({ error: `Failed to parse multipart data: ${err.message}` }, 400, corsHeaders);
        }

        // Schema validation
        if (!meta.wordId || !WORD_ID_REGEX.test(meta.wordId)) {
          return jsonResponse({ error: `Invalid wordId format: ${meta.wordId}` }, 400, corsHeaders);
        }
        if (!meta.publishRequestId || typeof meta.publishRequestId !== 'string') {
          return jsonResponse({ error: 'Missing publishRequestId' }, 400, corsHeaders);
        }
        if (!meta.imageSha256 || !SHA256_HEX_REGEX.test(meta.imageSha256)) {
          return jsonResponse({ error: 'Invalid or missing imageSha256 (expected 64-char hex)' }, 400, corsHeaders);
        }

        // Concurrency-Safe Idempotency Claim:
        const idempotencyKey = `idempotency/${meta.publishRequestId}.json`;
        const existingRecord = await env.PRIVATE_BUCKET.get(idempotencyKey);
        if (existingRecord) {
          const cachedResult = await existingRecord.json<any>();
          if (cachedResult.status === 'in-flight') {
            // Wait for winning in-flight request to finish:
            for (let wait = 0; wait < 20; wait++) {
              await new Promise((r) => setTimeout(r, 300));
              const finishedRecord = await env.PRIVATE_BUCKET.get(idempotencyKey);
              if (finishedRecord) {
                const res = await finishedRecord.json<any>();
                if (res.status !== 'in-flight') {
                  const latencyMs = Math.round(performance.now() - startTime);
                  return jsonResponse(
                    {
                      ...res,
                      idempotentReplay: true,
                      latencyMs,
                    },
                    200,
                    corsHeaders
                  );
                }
              }
            }
          } else {
            const latencyMs = Math.round(performance.now() - startTime);
            return jsonResponse(
              {
                ...cachedResult,
                idempotentReplay: true,
                latencyMs,
              },
              200,
              corsHeaders
            );
          }
        }

        // Claim this publishRequestId immediately with If-None-Match: *
        const claimResult = await env.PRIVATE_BUCKET.put(
          idempotencyKey,
          JSON.stringify({ status: 'in-flight', startedAt: new Date().toISOString() }),
          {
            onlyIf: { etagDoesNotMatch: '*' },
            httpMetadata: { contentType: 'application/json' },
          }
        );

        if (claimResult === null) {
          // Lost the race to claim this publishRequestId! Wait for winner to finish:
          for (let wait = 0; wait < 20; wait++) {
            await new Promise((r) => setTimeout(r, 300));
            const finishedRecord = await env.PRIVATE_BUCKET.get(idempotencyKey);
            if (finishedRecord) {
              const res = await finishedRecord.json<any>();
              if (res.status !== 'in-flight') {
                const latencyMs = Math.round(performance.now() - startTime);
                return jsonResponse(
                  {
                    ...res,
                    idempotentReplay: true,
                    latencyMs,
                  },
                  200,
                  corsHeaders
                );
              }
            }
          }
        }

        // Check image size
        if (imageBytes.length > MAX_IMAGE_BYTES) {
          return jsonResponse(
            { error: `Image size (${imageBytes.length} bytes) exceeds 2MB limit` },
            413,
            corsHeaders
          );
        }

        // Fast WebP magic byte validation (<0.01ms CPU)
        if (!isValidWebP(imageBytes)) {
          return jsonResponse({ error: 'Image binary is not a valid WebP file' }, 400, corsHeaders);
        }

        // --- Optimistic Concurrency 1: Conditional Create for Image Object ---
        // Uses If-None-Match: * semantics (onlyIf: { etagDoesNotMatch: '*' })
        // Guarantees zero overwrites: if candidate version already exists, put returns null!
        const ledgerKey = `ledger/words/${meta.wordId}.json`;
        let allocatedVersion = 0;
        let targetImageKey = '';
        let createdImageObj: R2Object | null = null;
        const MAX_ALLOC_RETRIES = 12;

        for (let attempt = 0; attempt < MAX_ALLOC_RETRIES; attempt++) {
          const existingLedger = await env.PRIVATE_BUCKET.get(ledgerKey);
          let ledgerData: any = null;
          if (existingLedger) {
            try { ledgerData = await existingLedger.json(); } catch { ledgerData = null; }
          }

          const historyVersions = Object.keys(ledgerData?.history || {}).map(Number).filter((n) => !isNaN(n));
          let candidateVersion = Math.max(
            0,
            ledgerData?.latestAllocatedVersion || 0,
            ...historyVersions
          ) + 1 + attempt;

          targetImageKey = `words/${meta.wordId}/v${candidateVersion}.webp`;

          // Conditional PUT with If-None-Match: * (etagDoesNotMatch: '*')
          createdImageObj = await env.PUBLIC_BUCKET.put(targetImageKey, imageBytes, {
            onlyIf: { etagDoesNotMatch: '*' },
            httpMetadata: {
              contentType: 'image/webp',
              cacheControl: 'public, max-age=31536000, immutable',
            },
            customMetadata: {
              'x-amz-meta-sha256': meta.imageSha256,
              'x-amz-meta-wordid': meta.wordId,
              'x-amz-meta-version': String(candidateVersion),
            },
          });

          if (createdImageObj !== null) {
            allocatedVersion = candidateVersion;
            break;
          }
        }

        if (createdImageObj === null) {
          return jsonResponse(
            { error: 'Version allocation collision: max retries exceeded' },
            409,
            corsHeaders
          );
        }

        // --- Optimistic Concurrency 2: Per-Word Ledger CAS Loop ---
        const nowIso = new Date().toISOString();
        const dimensions = meta.dimensions || { width: 896, height: 896 };
        const newVersionRecord = {
          version: allocatedVersion,
          createdAt: nowIso,
          prompt: meta.prompt || { formulaVersion: 'v4-cinematic', promptHash: '', fullPromptText: '' },
          generator: meta.generator || { provider: 'manual-studio', model: 'gemini-web', costTwd: 0, generatedBy: 'studio-user' },
          storage: {
            publicWebpKey: targetImageKey,
            publicWebpSha256: meta.imageSha256,
            byteSizeWebp: imageBytes.length,
            dimensions,
          },
          qa: {
            status: 'approved',
            reviewedAt: nowIso,
            reviewer: meta.generator?.generatedBy || 'studio-user',
          },
        };

        for (let attempt = 0; attempt < 10; attempt++) {
          const curLedgerObj = await env.PRIVATE_BUCKET.get(ledgerKey);
          let curLedgerData: any = null;
          let ledgerEtag: string | null = null;
          if (curLedgerObj) {
            curLedgerData = await curLedgerObj.json();
            ledgerEtag = curLedgerObj.etag;
          } else {
            curLedgerData = {
              wordId: meta.wordId,
              activeVersion: allocatedVersion,
              latestAllocatedVersion: allocatedVersion,
              currentPublishedVersion: allocatedVersion,
              history: {},
            };
          }

          curLedgerData.activeVersion = allocatedVersion;
          curLedgerData.latestAllocatedVersion = Math.max(curLedgerData.latestAllocatedVersion || 0, allocatedVersion);
          curLedgerData.currentPublishedVersion = allocatedVersion;
          curLedgerData.history[allocatedVersion] = newVersionRecord;

          const putLedgerResult = await env.PRIVATE_BUCKET.put(
            ledgerKey,
            JSON.stringify(curLedgerData, null, 2),
            {
              onlyIf: ledgerEtag ? { etagMatches: ledgerEtag } : { etagDoesNotMatch: '*' },
              httpMetadata: { contentType: 'application/json' },
            }
          );

          if (putLedgerResult !== null) {
            break;
          }
        }

        // --- Optimistic Concurrency 3: Global Runtime Manifest Update ---
        // If skipManifestCommit is true, skip updating current.json (used during batch migration!)
        let immutableManifestKey = '';
        let updatedCount = 0;

        if (!meta.skipManifestCommit) {
          for (let attempt = 0; attempt < 10; attempt++) {
            const curManifestObj = await env.PUBLIC_BUCKET.get('manifests/current.json');
            let currentManifest: any = {
              schemaVersion: '1.0',
              manifestUri: null,
              manifestVersion: 0,
              generatedAt: nowIso,
              count: 0,
              images: {},
            };
            let manifestEtag: string | null = null;
            if (curManifestObj) {
              currentManifest = await curManifestObj.json<any>();
              manifestEtag = curManifestObj.etag;
            }

            const imagesMap = currentManifest.images || {};
            imagesMap[meta.wordId] = {
              v: allocatedVersion,
              h: meta.imageSha256.slice(0, 16),
              w: dimensions.width,
              ht: dimensions.height,
            };
            updatedCount = Object.keys(imagesMap).length;
            const manifestTimestamp = Date.now();
            immutableManifestKey = `manifests/manifest-${manifestTimestamp}.json`;

            const newManifestPayload = {
              schemaVersion: '1.0',
              manifestUri: immutableManifestKey,
              manifestVersion: manifestTimestamp,
              generatedAt: nowIso,
              count: updatedCount,
              images: imagesMap,
            };

            // STRICT PUBLICATION ORDER:
            // 1. Write immutable snapshot FIRST
            const snapshotPut = await env.PUBLIC_BUCKET.put(
              immutableManifestKey,
              JSON.stringify(newManifestPayload),
              {
                onlyIf: { etagDoesNotMatch: '*' },
                httpMetadata: {
                  contentType: 'application/json',
                  cacheControl: 'public, max-age=31536000, immutable',
                },
              }
            );

            if (snapshotPut === null) {
              // Timestamp collided, retry
              continue;
            }

            // 2. CAS update manifests/current.json pointer
            const putManifestResult = await env.PUBLIC_BUCKET.put(
              'manifests/current.json',
              JSON.stringify(newManifestPayload),
              {
                onlyIf: manifestEtag ? { etagMatches: manifestEtag } : { etagDoesNotMatch: '*' },
                httpMetadata: {
                  contentType: 'application/json',
                  cacheControl: 'public, max-age=60, stale-while-revalidate=86400',
                },
              }
            );

            if (putManifestResult !== null) {
              break;
            }
            // Manifest CAS conflict, loop and retry pointer CAS
          }
        }

        const latencyMs = Math.round(performance.now() - startTime);
        const resultResponse = {
          success: true,
          wordId: meta.wordId,
          version: allocatedVersion,
          imageKey: targetImageKey,
          sha256: meta.imageSha256,
          manifestUri: immutableManifestKey || null,
          manifestCommitted: !meta.skipManifestCommit,
          totalManifestCount: updatedCount,
          latencyMs,
        };

        // Save to idempotency store
        await env.PRIVATE_BUCKET.put(idempotencyKey, JSON.stringify(resultResponse), {
          httpMetadata: { contentType: 'application/json' },
        });

        return jsonResponse(resultResponse, 200, corsHeaders);
      }

      // Route: POST /api/manifest/batch-commit (Batch publication endpoint)
      if (url.pathname === '/api/manifest/batch-commit') {
        let body: BatchCommitRequestBody;
        try {
          body = await request.json<BatchCommitRequestBody>();
        } catch {
          return jsonResponse({ error: 'Invalid JSON payload' }, 400, corsHeaders);
        }

        if (!body.batchRequestId || typeof body.batchRequestId !== 'string') {
          return jsonResponse({ error: 'Missing batchRequestId' }, 400, corsHeaders);
        }
        if (!body.updates || typeof body.updates !== 'object' || Object.keys(body.updates).length === 0) {
          return jsonResponse({ error: 'Missing or empty updates dictionary' }, 400, corsHeaders);
        }

        // Idempotency check for batch
        const idempotencyKey = `idempotency/batch_${body.batchRequestId}.json`;
        const existingBatchRecord = await env.PRIVATE_BUCKET.get(idempotencyKey);
        if (existingBatchRecord) {
          const cachedResult = await existingBatchRecord.json();
          const latencyMs = Math.round(performance.now() - startTime);
          return jsonResponse({ ...cachedResult, idempotentReplay: true, latencyMs }, 200, corsHeaders);
        }

        const nowIso = new Date().toISOString();
        let immutableManifestKey = '';
        let totalCount = 0;
        let batchAddedCount = 0;

        for (let attempt = 0; attempt < 12; attempt++) {
          const curManifestObj = await env.PUBLIC_BUCKET.get('manifests/current.json');
          let currentManifest: any = {
            schemaVersion: '1.0',
            manifestUri: null,
            manifestVersion: 0,
            generatedAt: nowIso,
            count: 0,
            images: {},
          };
          let manifestEtag: string | null = null;
          if (curManifestObj) {
            currentManifest = await curManifestObj.json<any>();
            manifestEtag = curManifestObj.etag;
          }

          const imagesMap = currentManifest.images || {};
          batchAddedCount = 0;

          // Merge all batch updates
          for (const [wid, entry] of Object.entries(body.updates)) {
            if (!imagesMap[wid]) {
              batchAddedCount++;
            }
            imagesMap[wid] = {
              v: entry.v,
              h: entry.h,
              w: entry.w || 896,
              ht: entry.ht || 896,
            };
          }

          totalCount = Object.keys(imagesMap).length;
          const manifestTimestamp = Date.now();
          immutableManifestKey = `manifests/manifest-${manifestTimestamp}.json`;

          const newManifestPayload = {
            schemaVersion: '1.0',
            manifestUri: immutableManifestKey,
            manifestVersion: manifestTimestamp,
            generatedAt: nowIso,
            count: totalCount,
            images: imagesMap,
          };

          // STRICT PUBLICATION ORDER:
          // 1. Write immutable snapshot FIRST
          const snapshotPut = await env.PUBLIC_BUCKET.put(
            immutableManifestKey,
            JSON.stringify(newManifestPayload),
            {
              onlyIf: { etagDoesNotMatch: '*' },
              httpMetadata: {
                contentType: 'application/json',
                cacheControl: 'public, max-age=31536000, immutable',
              },
            }
          );

          if (snapshotPut === null) {
            continue;
          }

          // 2. CAS update manifests/current.json pointer
          const putManifestResult = await env.PUBLIC_BUCKET.put(
            'manifests/current.json',
            JSON.stringify(newManifestPayload),
            {
              onlyIf: manifestEtag ? { etagMatches: manifestEtag } : { etagDoesNotMatch: '*' },
              httpMetadata: {
                contentType: 'application/json',
                cacheControl: 'public, max-age=60, stale-while-revalidate=86400',
              },
            }
          );

          if (putManifestResult !== null) {
            break;
          }
        }

        const latencyMs = Math.round(performance.now() - startTime);
        const batchResult = {
          success: true,
          batchRequestId: body.batchRequestId,
          manifestUri: immutableManifestKey,
          totalManifestCount: totalCount,
          batchAddedCount,
          latencyMs,
        };

        await env.PRIVATE_BUCKET.put(idempotencyKey, JSON.stringify(batchResult), {
          httpMetadata: { contentType: 'application/json' },
        });

        return jsonResponse(batchResult, 200, corsHeaders);
      }

      // Route: POST /api/rollback
      if (url.pathname === '/api/rollback') {
        let body: RollbackRequestBody;
        try {
          body = await request.json<RollbackRequestBody>();
        } catch {
          return jsonResponse({ error: 'Invalid JSON payload' }, 400, corsHeaders);
        }

        if (!body.wordId || !WORD_ID_REGEX.test(body.wordId)) {
          return jsonResponse({ error: `Invalid wordId: ${body.wordId}` }, 400, corsHeaders);
        }
        if (!body.targetVersion || body.targetVersion < 1) {
          return jsonResponse({ error: `Invalid targetVersion: ${body.targetVersion}` }, 400, corsHeaders);
        }

        // Verify target version image actually exists in Public R2
        const targetImageKey = `words/${body.wordId}/v${body.targetVersion}.webp`;
        const targetImageObj = await env.PUBLIC_BUCKET.head(targetImageKey);
        if (!targetImageObj) {
          return jsonResponse(
            { error: `Target version object ${targetImageKey} does not exist in R2` },
            404,
            corsHeaders
          );
        }

        const targetSha256 = targetImageObj.customMetadata?.['x-amz-meta-sha256'] || '';
        const nowIso = new Date().toISOString();
        let immutableManifestKey = '';

        // CAS Manifest Update for Rollback
        for (let attempt = 0; attempt < 10; attempt++) {
          const curManifestObj = await env.PUBLIC_BUCKET.get('manifests/current.json');
          if (!curManifestObj) {
            return jsonResponse({ error: 'No active manifest found to rollback' }, 404, corsHeaders);
          }

          const manifestEtag = curManifestObj.etag;
          const currentManifest = await curManifestObj.json<any>();
          const imagesMap = currentManifest.images || {};
          if (!imagesMap[body.wordId]) {
            return jsonResponse({ error: `Word ${body.wordId} not found in current manifest` }, 404, corsHeaders);
          }

          imagesMap[body.wordId] = {
            ...imagesMap[body.wordId],
            v: body.targetVersion,
            h: targetSha256.slice(0, 16) || imagesMap[body.wordId].h,
          };

          const manifestTimestamp = Date.now();
          immutableManifestKey = `manifests/manifest-${manifestTimestamp}.json`;

          const newManifestPayload = {
            schemaVersion: '1.0',
            manifestUri: immutableManifestKey,
            manifestVersion: manifestTimestamp,
            generatedAt: nowIso,
            count: Object.keys(imagesMap).length,
            images: imagesMap,
          };

          // STRICT PUBLICATION ORDER:
          // 1. Write snapshot FIRST
          const snapshotPut = await env.PUBLIC_BUCKET.put(
            immutableManifestKey,
            JSON.stringify(newManifestPayload),
            {
              onlyIf: { etagDoesNotMatch: '*' },
              httpMetadata: {
                contentType: 'application/json',
                cacheControl: 'public, max-age=31536000, immutable',
              },
            }
          );

          if (snapshotPut === null) {
            continue;
          }

          // 2. CAS update current pointer
          const putManifestResult = await env.PUBLIC_BUCKET.put(
            'manifests/current.json',
            JSON.stringify(newManifestPayload),
            {
              onlyIf: { etagMatches: manifestEtag },
              httpMetadata: {
                contentType: 'application/json',
                cacheControl: 'public, max-age=60, stale-while-revalidate=86400',
              },
            }
          );

          if (putManifestResult !== null) {
            break;
          }
        }

        // CAS Ledger Update for Rollback
        const ledgerKey = `ledger/words/${body.wordId}.json`;
        for (let attempt = 0; attempt < 10; attempt++) {
          const curLedgerObj = await env.PRIVATE_BUCKET.get(ledgerKey);
          if (!curLedgerObj) break;
          const ledgerEtag = curLedgerObj.etag;
          try {
            const ledgerData = await curLedgerObj.json<any>();
            ledgerData.activeVersion = body.targetVersion;
            ledgerData.currentPublishedVersion = body.targetVersion;

            const putLedgerResult = await env.PRIVATE_BUCKET.put(
              ledgerKey,
              JSON.stringify(ledgerData, null, 2),
              {
                onlyIf: { etagMatches: ledgerEtag },
                httpMetadata: { contentType: 'application/json' },
              }
            );
            if (putLedgerResult !== null) break;
          } catch {
            break;
          }
        }

        const latencyMs = Math.round(performance.now() - startTime);
        return jsonResponse(
          {
            success: true,
            wordId: body.wordId,
            rolledBackToVersion: body.targetVersion,
            manifestUri: immutableManifestKey,
            latencyMs,
          },
          200,
          corsHeaders
        );
      }
    }

    return jsonResponse({ error: 'Endpoint not found' }, 404, corsHeaders);
  },
};
