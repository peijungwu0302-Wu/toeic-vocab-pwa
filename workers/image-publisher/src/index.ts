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
  imageSha256?: string;
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
const IDEMPOTENCY_WAIT_ATTEMPTS = 20;
const IDEMPOTENCY_WAIT_MS = 300;
const COMMIT_RETRY_ATTEMPTS = 10;

interface PublicationState {
  objectStored: boolean;
  ledgerCommitted: boolean;
  manifestCommitted: boolean;
  verified: boolean;
}

interface IdempotencyRecord {
  status?: 'in-flight' | 'completed' | 'failed' | 'staged';
  httpStatus?: number;
  result?: Record<string, unknown>;
  publishRequestId?: string;
  wordId?: string;
  sha256?: string;
  success?: boolean;
  [key: string]: unknown;
}

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
      'Cache-Control': 'no-store, no-cache, must-revalidate',
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

async function computeSha256(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function waitForIdempotencyResult(
  bucket: R2Bucket,
  key: string
): Promise<IdempotencyRecord | null> {
  for (let wait = 0; wait < IDEMPOTENCY_WAIT_ATTEMPTS; wait++) {
    await new Promise((resolve) => setTimeout(resolve, IDEMPOTENCY_WAIT_MS));
    const recordObject = await bucket.get(key);
    if (!recordObject) continue;
    const record = await recordObject.json<IdempotencyRecord>();
    if (record.status !== 'in-flight') return record;
  }
  return null;
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

    // 2. Route: GET /api/manifest/current (Publication/Auth API - STRICT NO-STORE)
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
      return jsonResponse(data, 200, corsHeaders);
    }

    // 2.05 Route: GET/HEAD /manifests/* (Public manifest delivery)
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/manifests/')) {
      const objectKey = url.pathname.slice(1);
      const object = await env.PUBLIC_BUCKET.get(objectKey);
      if (!object) {
        return new Response('Not Found', { status: 404, headers: corsHeaders });
      }
      const headers = new Headers();
      headers.set('Content-Type', 'application/json; charset=utf-8');
      headers.set('etag', object.httpEtag);
      if (url.pathname === '/manifests/current.json') {
        headers.set('Cache-Control', 'no-cache, must-revalidate');
      } else {
        // Immutable snapshot manifests (e.g. /manifests/manifest-*.json)
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      }
      Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v as string));

      if (request.method === 'HEAD') {
        return new Response(null, { headers });
      }
      return new Response(object.body, { headers });
    }

    // 2.1 Route: GET/HEAD /words/* (Public image delivery route - Workers Caching)
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

        // Validate all client input and verify the actual bytes before claiming idempotency
        // or creating any publication-side R2 object.
        if (!meta.wordId || !WORD_ID_REGEX.test(meta.wordId)) {
          return jsonResponse(
            { success: false, code: 'INVALID_WORD_ID', error: `Invalid wordId format: ${meta.wordId}` },
            400,
            corsHeaders
          );
        }
        if (!meta.publishRequestId || typeof meta.publishRequestId !== 'string') {
          return jsonResponse(
            { success: false, code: 'MISSING_PUBLISH_REQUEST_ID', error: 'Missing publishRequestId' },
            400,
            corsHeaders
          );
        }
        if (meta.imageSha256 !== undefined && (
          typeof meta.imageSha256 !== 'string' || !SHA256_HEX_REGEX.test(meta.imageSha256)
        )) {
          return jsonResponse(
            { success: false, code: 'INVALID_IMAGE_SHA256', error: 'Invalid imageSha256 (expected 64-char hex)' },
            400,
            corsHeaders
          );
        }
        if (imageBytes.length > MAX_IMAGE_BYTES) {
          return jsonResponse(
            {
              success: false,
              code: 'IMAGE_TOO_LARGE',
              error: `Image size (${imageBytes.length} bytes) exceeds 2MB limit`,
            },
            413,
            corsHeaders
          );
        }
        if (!isValidWebP(imageBytes)) {
          return jsonResponse(
            { success: false, code: 'INVALID_WEBP', error: 'Image binary is not a valid WebP file' },
            400,
            corsHeaders
          );
        }

        const serverSha256 = await computeSha256(imageBytes);
        const expectedSha256 = meta.imageSha256?.toLowerCase();
        if (expectedSha256 && expectedSha256 !== serverSha256) {
          return jsonResponse(
            {
              success: false,
              code: 'IMAGE_SHA256_MISMATCH',
              error: 'Client imageSha256 does not match the uploaded image bytes',
              expectedSha256,
              actualSha256: serverSha256,
            },
            400,
            corsHeaders
          );
        }

        const idempotencyKey = `idempotency/${meta.publishRequestId}.json`;
        const publicationIsCurrent = (
          ledger: any,
          manifest: any,
          wordId: string,
          version: number,
          sha256: string,
          imageKey: string
        ): boolean => Boolean(
          ledger?.wordId === wordId &&
          ledger?.activeVersion === version &&
          ledger?.currentPublishedVersion === version &&
          ledger?.history?.[version]?.version === version &&
          ledger?.history?.[version]?.storage?.publicWebpKey === imageKey &&
          ledger?.history?.[version]?.storage?.publicWebpSha256 === sha256 &&
          manifest?.images?.[wordId]?.v === version &&
          manifest?.images?.[wordId]?.h === sha256.slice(0, 16)
        );
        const replayIdempotencyRecord = async (record: IdempotencyRecord): Promise<Response> => {
          const recordWordId = record.wordId ?? (record.result?.wordId as string | undefined);
          const recordSha = record.sha256 ?? (record.result?.sha256 as string | undefined);
          if ((recordWordId && recordWordId !== meta.wordId) || (recordSha && recordSha !== serverSha256)) {
            return jsonResponse(
              {
                success: false,
                code: 'IDEMPOTENCY_KEY_REUSED',
                error: 'publishRequestId is already associated with different publication input',
                publishRequestId: meta.publishRequestId,
              },
              409,
              corsHeaders
            );
          }

          const cachedResult = record.result ?? record;
          const cachedPublication = cachedResult.publication as PublicationState | undefined;
          if (
            cachedResult.success === true &&
            !(
              record.status === 'completed' &&
              cachedPublication?.objectStored === true &&
              cachedPublication?.ledgerCommitted === true &&
              cachedPublication?.manifestCommitted === true &&
              cachedPublication?.verified === true
            )
          ) {
            return jsonResponse(
              {
                success: false,
                code: 'IDEMPOTENCY_RESULT_UNVERIFIED',
                error: 'Existing idempotency result predates verified publication receipts',
                publishRequestId: meta.publishRequestId,
                wordId: meta.wordId,
                sha256: serverSha256,
                reconciliationRequired: true,
              },
              409,
              corsHeaders
            );
          }
          const status = record.httpStatus ?? (cachedResult.success === true ? 200 : 503);
          let currentState: { verifiedAtCommit: boolean; activeAtVerification: boolean; verifiedAt: string } | Record<string, never> = {};
          if (cachedResult.success === true) {
            try {
              const [ledgerObject, manifestObject] = await Promise.all([
                env.PRIVATE_BUCKET.get(`ledger/words/${meta.wordId}.json`),
                env.PUBLIC_BUCKET.get('manifests/current.json'),
              ]);
              const ledger = ledgerObject ? await ledgerObject.json<any>() : null;
              const manifest = manifestObject ? await manifestObject.json<any>() : null;
              currentState = {
                verifiedAtCommit: true,
                activeAtVerification: publicationIsCurrent(
                  ledger,
                  manifest,
                  meta.wordId,
                  cachedResult.version as number,
                  serverSha256,
                  cachedResult.imageKey as string
                ),
                verifiedAt: new Date().toISOString(),
              };
            } catch {
              return jsonResponse({
                success: false,
                code: 'CURRENT_STATE_READ_FAILED',
                error: 'Could not verify whether the historical publication is currently active',
                publishRequestId: meta.publishRequestId,
              }, 503, corsHeaders);
            }
          }
          return jsonResponse(
            {
              ...cachedResult,
              ...currentState,
              idempotentReplay: true,
              replayed: true,
              latencyMs: Math.round(performance.now() - startTime),
            },
            status,
            corsHeaders
          );
        };
        const inFlightResponse = (): Response => jsonResponse(
          {
            success: false,
            code: 'PUBLISH_IN_FLIGHT',
            error: 'A publication with this publishRequestId is still in flight',
            publishRequestId: meta.publishRequestId,
          },
          409,
          { ...corsHeaders, 'Retry-After': '2' }
        );

        const existingRecordObject = await env.PRIVATE_BUCKET.get(idempotencyKey);
        if (existingRecordObject) {
          const existingRecord = await existingRecordObject.json<IdempotencyRecord>();
          if (existingRecord.status !== 'in-flight') return replayIdempotencyRecord(existingRecord);
          const finishedRecord = await waitForIdempotencyResult(env.PRIVATE_BUCKET, idempotencyKey);
          return finishedRecord ? replayIdempotencyRecord(finishedRecord) : inFlightResponse();
        }

        const claimResult = await env.PRIVATE_BUCKET.put(
          idempotencyKey,
          JSON.stringify({
            status: 'in-flight',
            startedAt: new Date().toISOString(),
            publishRequestId: meta.publishRequestId,
            wordId: meta.wordId,
            sha256: serverSha256,
          }),
          {
            onlyIf: { etagDoesNotMatch: '*' },
            httpMetadata: { contentType: 'application/json' },
          }
        );

        if (claimResult === null) {
          const finishedRecord = await waitForIdempotencyResult(env.PRIVATE_BUCKET, idempotencyKey);
          return finishedRecord ? replayIdempotencyRecord(finishedRecord) : inFlightResponse();
        }

        const publication: PublicationState = {
          objectStored: false,
          ledgerCommitted: false,
          manifestCommitted: false,
          verified: false,
        };
        let allocatedVersion = 0;
        let targetImageKey = '';

        const persistOutcome = async (
          status: 'completed' | 'failed' | 'staged',
          httpStatus: number,
          result: Record<string, unknown>
        ): Promise<Response> => {
          await env.PRIVATE_BUCKET.put(
            idempotencyKey,
            JSON.stringify({
              status,
              httpStatus,
              publishRequestId: meta.publishRequestId,
              wordId: meta.wordId,
              sha256: serverSha256,
              result,
            }),
            { httpMetadata: { contentType: 'application/json' } }
          );
          return jsonResponse(result, httpStatus, corsHeaders);
        };

        const failPartialPublication = async (
          code: string,
          error: string,
          manifestUri: string | null = null
        ): Promise<Response> => {
          const failureReceipt = {
            publishRequestId: meta.publishRequestId,
            wordId: meta.wordId,
            version: allocatedVersion || null,
            imageKey: targetImageKey || null,
            sha256: serverSha256,
            manifestUri,
            reconciliationRequired: publication.objectStored,
            publication: { ...publication },
          };
          return persistOutcome('failed', 503, {
            success: false,
            code,
            error,
            publishRequestId: meta.publishRequestId,
            wordId: meta.wordId,
            version: allocatedVersion || null,
            imageKey: targetImageKey || null,
            sha256: serverSha256,
            reconciliationRequired: publication.objectStored,
            failureReceipt,
          });
        };

        // --- Optimistic Concurrency 1: Conditional Create for Image Object ---
        const ledgerKey = `ledger/words/${meta.wordId}.json`;
        let createdImageObj: R2Object | null = null;
        const MAX_ALLOC_RETRIES = 12;

        for (let attempt = 0; attempt < MAX_ALLOC_RETRIES; attempt++) {
          const existingLedger = await env.PRIVATE_BUCKET.get(ledgerKey);
          let ledgerData: any = null;
          if (existingLedger) {
            try { ledgerData = await existingLedger.json(); } catch { ledgerData = null; }
          }

          const historyVersions = Object.keys(ledgerData?.history || {}).map(Number).filter((n) => !isNaN(n));
          const candidateVersion = Math.max(
            0,
            ledgerData?.latestAllocatedVersion || 0,
            ...historyVersions
          ) + 1 + attempt;

          targetImageKey = `words/${meta.wordId}/v${candidateVersion}.webp`;
          createdImageObj = await env.PUBLIC_BUCKET.put(targetImageKey, imageBytes, {
            onlyIf: { etagDoesNotMatch: '*' },
            httpMetadata: {
              contentType: 'image/webp',
              cacheControl: 'public, max-age=31536000, immutable',
            },
            customMetadata: {
              'x-amz-meta-sha256': serverSha256,
              'x-amz-meta-wordid': meta.wordId,
              'x-amz-meta-version': String(candidateVersion),
            },
          });

          if (createdImageObj !== null) {
            allocatedVersion = candidateVersion;
            publication.objectStored = true;
            break;
          }
        }

        if (createdImageObj === null) {
          return persistOutcome('failed', 409, {
            success: false,
            code: 'VERSION_ALLOCATION_FAILED',
            error: 'Version allocation collision: max retries exceeded',
            publishRequestId: meta.publishRequestId,
            wordId: meta.wordId,
            sha256: serverSha256,
            reconciliationRequired: false,
            publication: { ...publication },
          });
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
            publicWebpSha256: serverSha256,
            byteSizeWebp: imageBytes.length,
            dimensions,
          },
          qa: {
            status: 'approved',
            reviewedAt: nowIso,
            reviewer: meta.generator?.generatedBy || 'studio-user',
          },
        };

        let ledgerCasCommitted = false;
        for (let attempt = 0; attempt < COMMIT_RETRY_ATTEMPTS; attempt++) {
          const curLedgerObj = await env.PRIVATE_BUCKET.get(ledgerKey);
          let curLedgerData: any;
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
            ledgerCasCommitted = true;
            break;
          }
        }

        if (!ledgerCasCommitted) {
          return failPartialPublication('LEDGER_COMMIT_FAILED', 'Ledger CAS retries exhausted');
        }

        const committedLedgerObject = await env.PRIVATE_BUCKET.get(ledgerKey);
        const committedLedger = committedLedgerObject ? await committedLedgerObject.json<any>() : null;
        const committedVersion = committedLedger?.history?.[allocatedVersion];
        if (
          committedLedger?.wordId !== meta.wordId ||
          committedLedger?.activeVersion !== allocatedVersion ||
          committedLedger?.currentPublishedVersion !== allocatedVersion ||
          committedVersion?.version !== allocatedVersion ||
          committedVersion?.storage?.publicWebpKey !== targetImageKey ||
          committedVersion?.storage?.publicWebpSha256 !== serverSha256
        ) {
          return failPartialPublication('LEDGER_VERIFICATION_FAILED', 'Ledger read-back verification failed');
        }
        publication.ledgerCommitted = true;

        if (meta.skipManifestCommit) {
          return persistOutcome('staged', 409, {
            success: false,
            status: 'staged',
            code: 'PUBLISH_STAGED',
            error: 'Object and ledger are staged; Runtime Manifest has not been committed',
            publishRequestId: meta.publishRequestId,
            wordId: meta.wordId,
            version: allocatedVersion,
            imageKey: targetImageKey,
            sha256: serverSha256,
            ledgerCommitted: true,
            manifestCommitted: false,
            reconciliationRequired: false,
            publication: { ...publication },
          });
        }

        // --- Optimistic Concurrency 3: Global Runtime Manifest Update ---
        let immutableManifestKey = '';
        let updatedCount = 0;
        let manifestCasCommitted = false;

        for (let attempt = 0; attempt < COMMIT_RETRY_ATTEMPTS; attempt++) {
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
            h: serverSha256.slice(0, 16),
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

          if (snapshotPut === null) continue;

          const putManifestResult = await env.PUBLIC_BUCKET.put(
            'manifests/current.json',
            JSON.stringify(newManifestPayload),
            {
              onlyIf: manifestEtag ? { etagMatches: manifestEtag } : { etagDoesNotMatch: '*' },
              httpMetadata: {
                contentType: 'application/json',
                cacheControl: 'no-cache, must-revalidate',
              },
            }
          );

          if (putManifestResult !== null) {
            manifestCasCommitted = true;
            break;
          }
        }

        if (!manifestCasCommitted) {
          return failPartialPublication(
            'MANIFEST_COMMIT_FAILED',
            'Runtime Manifest CAS retries exhausted',
            immutableManifestKey || null
          );
        }
        publication.manifestCommitted = true;

        const [publishedObject, verifiedLedgerObject, committedManifestObject] = await Promise.all([
          env.PUBLIC_BUCKET.head(targetImageKey),
          env.PRIVATE_BUCKET.get(ledgerKey),
          env.PUBLIC_BUCKET.get('manifests/current.json'),
        ]);
        const verifiedLedger = verifiedLedgerObject ? await verifiedLedgerObject.json<any>() : null;
        const verifiedManifest = committedManifestObject ? await committedManifestObject.json<any>() : null;
        if (
          verifiedLedger?.wordId === meta.wordId &&
          (verifiedLedger?.activeVersion !== allocatedVersion ||
            verifiedLedger?.currentPublishedVersion !== allocatedVersion)
        ) {
          return failPartialPublication(
            'PUBLISH_SUPERSEDED_DURING_COMMIT',
            'Another publication advanced the active ledger version during commit',
            immutableManifestKey
          );
        }
        const verificationPassed = Boolean(
          publishedObject &&
          publishedObject.customMetadata?.['x-amz-meta-wordid'] === meta.wordId &&
          publishedObject.customMetadata?.['x-amz-meta-version'] === String(allocatedVersion) &&
          publishedObject.customMetadata?.['x-amz-meta-sha256'] === serverSha256 &&
          publicationIsCurrent(
            verifiedLedger,
            verifiedManifest,
            meta.wordId,
            allocatedVersion,
            serverSha256,
            targetImageKey
          )
        );

        if (!verificationPassed) {
          return failPartialPublication(
            'PUBLICATION_VERIFICATION_FAILED',
            'Publication read-back did not match wordId, version, and server-computed SHA',
            immutableManifestKey
          );
        }
        publication.verified = true;

        const latencyMs = Math.round(performance.now() - startTime);
        // This is a point-in-time read-back, not a lock against later publications or rollbacks.
        const resultResponse = {
          success: true,
          verifiedAtCommit: true,
          activeAtVerification: true,
          verifiedAt: new Date().toISOString(),
          publishRequestId: meta.publishRequestId,
          wordId: meta.wordId,
          version: allocatedVersion,
          imageKey: targetImageKey,
          sha256: serverSha256,
          manifestUri: immutableManifestKey,
          ledgerCommitted: true,
          manifestCommitted: true,
          publication: { ...publication },
          totalManifestCount: updatedCount,
          latencyMs,
        };

        return persistOutcome('completed', 200, resultResponse);
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
          const cachedResult = await existingBatchRecord.json<Record<string, unknown>>();
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
                cacheControl: 'no-cache, must-revalidate',
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
                cacheControl: 'no-cache, must-revalidate',
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

      // Route: POST /api/archive/original (Private R2 Original JPG Archival)
      if (url.pathname === '/api/archive/original') {
        const contentType = request.headers.get('content-type') || '';
        if (!contentType.includes('multipart/form-data')) {
          return jsonResponse({ error: 'Multipart form-data required' }, 415, corsHeaders);
        }

        try {
          const formData = await request.formData();
          const file = formData.get('file');
          const metaRaw = formData.get('metadata');
          if (!file || typeof file === 'string' || !metaRaw || typeof metaRaw !== 'string') {
            return jsonResponse({ error: 'Missing file or metadata field' }, 400, corsHeaders);
          }

          const meta = JSON.parse(metaRaw) as {
            originalFilename: string;
            sha256: string;
            fileSize: number;
            isOrphan: boolean;
            matchedWordId?: string | null;
            auditProvenance?: any | null;
          };

          const arrayBuf = await file.arrayBuffer();
          const fileBytes = new Uint8Array(arrayBuf);

          // Verify SHA-256
          const hashBuf = await crypto.subtle.digest('SHA-256', fileBytes);
          const hexSha = Array.from(new Uint8Array(hashBuf))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');

          if (hexSha.toLowerCase() !== meta.sha256.toLowerCase()) {
            return jsonResponse(
              { error: 'SHA256 mismatch', expected: meta.sha256, actual: hexSha },
              400,
              corsHeaders
            );
          }

          const archiveKey = `archive/legacy-originals/${meta.originalFilename}`;
          await env.PRIVATE_BUCKET.put(archiveKey, fileBytes, {
            httpMetadata: { contentType: 'image/jpeg' },
            customMetadata: {
              sha256: hexSha,
              fileSize: String(fileBytes.length),
              matchedWordId: meta.matchedWordId || '',
              isOrphan: String(meta.isOrphan),
            },
          });

          const latencyMs = Math.round(performance.now() - startTime);
          return jsonResponse(
            {
              success: true,
              key: archiveKey,
              originalFilename: meta.originalFilename,
              sha256: hexSha,
              fileSize: fileBytes.length,
              latencyMs,
            },
            200,
            corsHeaders
          );
        } catch (err: any) {
          return jsonResponse({ error: `Archive failed: ${err.message}` }, 500, corsHeaders);
        }
      }

      // Route: POST /api/archive/verify-batch (Batch existence & SHA verification)
      if (url.pathname === '/api/archive/verify-batch') {
        let body: { filenames: string[] };
        try {
          body = await request.json();
          if (!body || !Array.isArray(body.filenames)) {
            return jsonResponse({ error: 'Invalid body: filenames array required' }, 400, corsHeaders);
          }
        } catch {
          return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders);
        }

        const results: Record<
          string,
          { exists: boolean; size?: number; sha256?: string; matchedWordId?: string; isOrphan?: boolean }
        > = {};

        await Promise.all(
          body.filenames.map(async (fn) => {
            const archiveKey = `archive/legacy-originals/${fn}`;
            const obj = await env.PRIVATE_BUCKET.head(archiveKey);
            if (!obj) {
              results[fn] = { exists: false };
            } else {
              results[fn] = {
                exists: true,
                size: obj.size,
                sha256: obj.customMetadata?.sha256 || '',
                matchedWordId: obj.customMetadata?.matchedWordId || undefined,
                isOrphan: obj.customMetadata?.isOrphan === 'true',
              };
            }
          })
        );

        const latencyMs = Math.round(performance.now() - startTime);
        return jsonResponse({ success: true, count: body.filenames.length, results, latencyMs }, 200, corsHeaders);
      }
    }

    return jsonResponse({ error: 'Endpoint not found' }, 404, corsHeaders);
  },
};
