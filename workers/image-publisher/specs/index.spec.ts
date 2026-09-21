// @vitest-environment node

import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import worker from '../src/index';

type StoredObject = {
  bytes: Uint8Array;
  etag: string;
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
};

type PutOptions = {
  onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string };
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
};

class FakeR2Object {
  readonly key: string;
  readonly etag: string;
  readonly httpEtag: string;
  readonly size: number;
  readonly customMetadata?: Record<string, string>;
  readonly httpMetadata?: Record<string, string>;
  readonly body: ReadableStream<Uint8Array>;

  constructor(key: string, private readonly stored: StoredObject) {
    this.key = key;
    this.etag = stored.etag;
    this.httpEtag = `\"${stored.etag}\"`;
    this.size = stored.bytes.byteLength;
    this.customMetadata = stored.customMetadata;
    this.httpMetadata = stored.httpMetadata;
    this.body = new Blob([stored.bytes]).stream();
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.stored.bytes.slice().buffer;
  }

  async json<T = unknown>(): Promise<T> {
    return JSON.parse(new TextDecoder().decode(this.stored.bytes)) as T;
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this.stored.bytes);
  }

  writeHttpMetadata(headers: Headers): void {
    for (const [name, value] of Object.entries(this.httpMetadata ?? {})) {
      headers.set(name, value);
    }
  }
}

class MemoryR2Bucket {
  readonly objects = new Map<string, StoredObject>();
  readonly putCalls: string[] = [];
  readonly getCalls: string[] = [];
  beforeGet?: (key: string) => Promise<void> | void;
  afterPut?: (key: string, stored: StoredObject) => void;
  private readonly forcedPutConflicts = new Map<string, number>();
  private readonly corruptManifestReadback = new Set<string>();
  private etagCounter = 0;

  forcePutConflicts(key: string, count: number): void {
    this.forcedPutConflicts.set(key, count);
  }

  corruptNextCommittedManifestReadback(key: string): void {
    this.corruptManifestReadback.add(key);
  }

  seedJson(key: string, value: unknown): void {
    this.store(key, JSON.stringify(value), {
      httpMetadata: { contentType: 'application/json' },
    });
  }

  countPuts(prefix: string): number {
    return this.putCalls.filter((key) => key.startsWith(prefix)).length;
  }

  async get(key: string): Promise<FakeR2Object | null> {
    this.getCalls.push(key);
    await this.beforeGet?.(key);
    const stored = this.objects.get(key);
    if (!stored) return null;

    if (this.corruptManifestReadback.has(key) && key === 'manifests/current.json') {
      this.corruptManifestReadback.delete(key);
      const payload = JSON.parse(new TextDecoder().decode(stored.bytes));
      const firstWordId = Object.keys(payload.images ?? {})[0];
      if (firstWordId) payload.images[firstWordId].h = '0000000000000000';
      return new FakeR2Object(key, {
        ...stored,
        bytes: new TextEncoder().encode(JSON.stringify(payload)),
      });
    }

    return new FakeR2Object(key, stored);
  }

  async head(key: string): Promise<FakeR2Object | null> {
    const stored = this.objects.get(key);
    return stored ? new FakeR2Object(key, stored) : null;
  }

  async put(
    key: string,
    value: string | Uint8Array | ArrayBuffer | Blob,
    options: PutOptions = {}
  ): Promise<FakeR2Object | null> {
    this.putCalls.push(key);

    const remainingConflicts = this.forcedPutConflicts.get(key) ?? 0;
    if (remainingConflicts > 0) {
      this.forcedPutConflicts.set(key, remainingConflicts - 1);
      return null;
    }

    const existing = this.objects.get(key);
    if (options.onlyIf?.etagDoesNotMatch === '*' && existing) return null;
    if (options.onlyIf?.etagMatches && existing?.etag !== options.onlyIf.etagMatches) return null;
    if (options.onlyIf?.etagMatches && !existing) return null;

    const stored = this.store(key, value, options);
    this.afterPut?.(key, stored);
    return new FakeR2Object(key, stored);
  }

  private store(key: string, value: string | Uint8Array | ArrayBuffer | Blob, options: PutOptions): StoredObject {
    if (value instanceof Blob) {
      throw new Error('Blob writes are not used by the image publisher');
    }
    const bytes = typeof value === 'string'
      ? new TextEncoder().encode(value)
      : value instanceof Uint8Array
        ? value.slice()
        : new Uint8Array(value.slice(0));
    const stored: StoredObject = {
      bytes,
      etag: `etag-${++this.etagCounter}`,
      httpMetadata: options.httpMetadata,
      customMetadata: options.customMetadata,
    };
    this.objects.set(key, stored);
    return stored;
  }
}

const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46,
  0x08, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x20,
]);
const SERVER_SHA = createHash('sha256').update(WEBP_BYTES).digest('hex');
const WORD_ID = 'tw_w_0123456789ab';
const SECRET = 'test-secret';

function createEnv() {
  return {
    publicBucket: new MemoryR2Bucket(),
    privateBucket: new MemoryR2Bucket(),
  };
}

function createPublishRequest(
  publishRequestId: string,
  imageSha256 = SERVER_SHA,
  overrides: Record<string, unknown> = {}
): Request {
  const form = new FormData();
  form.append('file', new Blob([WEBP_BYTES], { type: 'image/webp' }), `${WORD_ID}.webp`);
  form.append('metadata', JSON.stringify({
    wordId: WORD_ID,
    imageSha256,
    publishRequestId,
    prompt: { formulaVersion: 'v4-cinematic', fullPromptText: 'test prompt' },
    generator: { provider: 'test', model: 'test-model', costTwd: 0, generatedBy: 'vitest' },
    dimensions: { width: 896, height: 896 },
    ...overrides,
  }));
  return new Request('https://worker.test/api/publish', {
    method: 'POST',
    headers: { 'X-Studio-Secret': SECRET },
    body: form,
  });
}

async function publish(
  env: ReturnType<typeof createEnv>,
  publishRequestId: string,
  imageSha256 = SERVER_SHA,
  overrides: Record<string, unknown> = {}
): Promise<{ response: Response; body: any }> {
  return invokePublish(env, createPublishRequest(publishRequestId, imageSha256, overrides));
}

async function invokePublish(
  env: ReturnType<typeof createEnv>,
  request: Request
): Promise<{ response: Response; body: any }> {
  const response = await worker.fetch(
    request,
    {
      PUBLIC_BUCKET: env.publicBucket,
      PRIVATE_BUCKET: env.privateBucket,
      STUDIO_PRESHARED_SECRET: SECRET,
      ALLOWED_ORIGINS: '*',
    } as never,
    {} as never
  );
  return { response, body: await response.json() };
}

describe('POST /api/publish correctness hardening', () => {
  beforeEach(() => {
    let timestamp = 2_000_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => timestamp++);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('valid publish reports a fully verified committed publication', async () => {
    const env = createEnv();

    const { response, body } = await publish(env, 'req-valid');

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      publishRequestId: 'req-valid',
      wordId: WORD_ID,
      version: 1,
      imageKey: `words/${WORD_ID}/v1.webp`,
      sha256: SERVER_SHA,
      verifiedAtCommit: true,
      activeAtVerification: true,
      ledgerCommitted: true,
      manifestCommitted: true,
      publication: {
        objectStored: true,
        ledgerCommitted: true,
        manifestCommitted: true,
        verified: true,
      },
    });
    expect(new Date(body.verifiedAt).toISOString()).toBe(body.verifiedAt);
  });

  test('rejects a client SHA mismatch before any publication side effect', async () => {
    const env = createEnv();

    const { response, body } = await publish(env, 'req-bad-sha', '0'.repeat(64));

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      success: false,
      code: 'IMAGE_SHA256_MISMATCH',
      expectedSha256: '0'.repeat(64),
      actualSha256: SERVER_SHA,
    });
    expect(env.publicBucket.putCalls).toEqual([]);
    expect(env.privateBucket.putCalls).toEqual([]);
  });

  test('replays a completed publishRequestId without allocating another version', async () => {
    const env = createEnv();
    const first = await publish(env, 'req-completed-replay');
    const objectPutsAfterFirst = env.publicBucket.countPuts(`words/${WORD_ID}/`);

    const second = await publish(env, 'req-completed-replay');

    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(200);
    expect(second.body).toMatchObject({
      success: true,
      idempotentReplay: true,
      replayed: true,
      verifiedAtCommit: true,
      activeAtVerification: true,
      publishRequestId: 'req-completed-replay',
      version: first.body.version,
      sha256: SERVER_SHA,
    });
    expect(new Date(second.body.verifiedAt).toISOString()).toBe(second.body.verifiedAt);
    expect(env.publicBucket.countPuts(`words/${WORD_ID}/`)).toBe(objectPutsAfterFirst);
    expect(env.publicBucket.objects.has(`words/${WORD_ID}/v2.webp`)).toBe(false);
  });

  test('completed replay preserves historical success but reports superseded publication inactive', async () => {
    const env = createEnv();
    const first = await publish(env, 'req-old');
    const second = await publish(env, 'req-new');
    const objectPuts = env.publicBucket.countPuts(`words/${WORD_ID}/`);
    const totalPuts = env.publicBucket.putCalls.length + env.privateBucket.putCalls.length;

    const replay = await publish(env, 'req-old');

    expect(first.body.version).toBe(1);
    expect(second.body.version).toBe(2);
    expect(replay.response.status).toBe(200);
    expect(replay.body).toMatchObject({
      success: true,
      replayed: true,
      verifiedAtCommit: true,
      activeAtVerification: false,
      publishRequestId: 'req-old',
      version: 1,
    });
    expect(new Date(replay.body.verifiedAt).toISOString()).toBe(replay.body.verifiedAt);
    expect(env.publicBucket.countPuts(`words/${WORD_ID}/`)).toBe(objectPuts);
    expect(env.publicBucket.putCalls.length + env.privateBucket.putCalls.length).toBe(totalPuts);
    expect(env.publicBucket.objects.has(`words/${WORD_ID}/v3.webp`)).toBe(false);
  });

  test('completed replay reports inactive when manifest no longer points to its version', async () => {
    const env = createEnv();
    const first = await publish(env, 'req-manifest-changed');
    const manifest = await (await env.publicBucket.get('manifests/current.json'))!.json<any>();
    manifest.images[WORD_ID].v = 99;
    env.publicBucket.seedJson('manifests/current.json', manifest);
    const objectPuts = env.publicBucket.countPuts(`words/${WORD_ID}/`);

    const replay = await publish(env, 'req-manifest-changed');

    expect(first.response.status).toBe(200);
    expect(replay.body).toMatchObject({ success: true, replayed: true, activeAtVerification: false });
    expect(new Date(replay.body.verifiedAt).toISOString()).toBe(replay.body.verifiedAt);
    expect(env.publicBucket.countPuts(`words/${WORD_ID}/`)).toBe(objectPuts);
  });

  test('different publishRequestIds cannot report success after another publish advances the same-word ledger', async () => {
    const env = createEnv();
    const ledgerKey = `ledger/words/${WORD_ID}.json`;
    let releaseNewManifest!: () => void;
    const newManifestGate = new Promise<void>((resolve) => { releaseNewManifest = resolve; });
    let signalNewLedger!: () => void;
    const newLedgerCommitted = new Promise<void>((resolve) => { signalNewLedger = resolve; });
    let manifestReads = 0;
    let newPublish: ReturnType<typeof publish> | undefined;
    env.privateBucket.afterPut = (key, stored) => {
      if (key !== ledgerKey) return;
      const ledger = JSON.parse(new TextDecoder().decode(stored.bytes));
      if (ledger.currentPublishedVersion === 2) signalNewLedger();
    };
    env.publicBucket.beforeGet = async (key) => {
      if (key !== 'manifests/current.json') return;
      manifestReads++;
      if (manifestReads === 1) {
        newPublish = publish(env, 'req-concurrent-new');
        await newLedgerCommitted;
      } else if (manifestReads === 2) {
        await newManifestGate;
      }
    };

    const oldPublish = await publish(env, 'req-concurrent-old');
    releaseNewManifest();
    const completedNewPublish = await newPublish;

    expect(manifestReads).toBeGreaterThanOrEqual(3);
    expect(oldPublish.response.status).not.toBe(200);
    expect(oldPublish.body).toMatchObject({
      success: false,
      code: 'PUBLISH_SUPERSEDED_DURING_COMMIT',
      reconciliationRequired: true,
    });
    expect(completedNewPublish?.response.status).toBe(200);
    expect((await (await env.privateBucket.get(ledgerKey))!.json<any>()).currentPublishedVersion).toBe(2);
    expect((await (await env.publicBucket.get('manifests/current.json'))!.json<any>()).images[WORD_ID].v).toBe(2);
  });

  test('does not replay an unverified legacy idempotency result as success', async () => {
    const env = createEnv();
    env.privateBucket.seedJson('idempotency/req-legacy-result.json', {
      success: true,
      wordId: WORD_ID,
      version: 1,
      imageKey: `words/${WORD_ID}/v1.webp`,
      sha256: SERVER_SHA,
      manifestCommitted: true,
    });

    const { response, body } = await publish(env, 'req-legacy-result');

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      success: false,
      code: 'IDEMPOTENCY_RESULT_UNVERIFIED',
      publishRequestId: 'req-legacy-result',
      reconciliationRequired: true,
    });
    expect(env.publicBucket.putCalls).toEqual([]);
    expect(env.privateBucket.putCalls).toEqual([]);
  });

  test('returns PUBLISH_IN_FLIGHT after waiting and never starts a second publication', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler) => {
      if (typeof callback === 'function') callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);
    const env = createEnv();
    env.privateBucket.seedJson('idempotency/req-in-flight.json', {
      status: 'in-flight',
      publishRequestId: 'req-in-flight',
      wordId: WORD_ID,
      sha256: SERVER_SHA,
    });

    const { response, body } = await publish(env, 'req-in-flight');

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      success: false,
      code: 'PUBLISH_IN_FLIGHT',
      publishRequestId: 'req-in-flight',
    });
    expect(env.publicBucket.putCalls).toEqual([]);
    expect(env.privateBucket.countPuts('idempotency/req-in-flight.json')).toBe(0);
  });

  test('ledger CAS retries and eventually commits the publication', async () => {
    const env = createEnv();
    env.privateBucket.forcePutConflicts(`ledger/words/${WORD_ID}.json`, 2);

    const { response, body } = await publish(env, 'req-ledger-eventual');

    expect(response.status).toBe(200);
    expect(body.ledgerCommitted).toBe(true);
    expect(env.privateBucket.countPuts(`ledger/words/${WORD_ID}.json`)).toBe(3);
  });

  test('ledger CAS exhaustion returns a reconciliation-required failure receipt', async () => {
    const env = createEnv();
    env.privateBucket.forcePutConflicts(`ledger/words/${WORD_ID}.json`, 10);

    const { response, body } = await publish(env, 'req-ledger-exhausted');

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      success: false,
      code: 'LEDGER_COMMIT_FAILED',
      reconciliationRequired: true,
      failureReceipt: {
        publishRequestId: 'req-ledger-exhausted',
        wordId: WORD_ID,
        version: 1,
        imageKey: `words/${WORD_ID}/v1.webp`,
        sha256: SERVER_SHA,
        reconciliationRequired: true,
        publication: {
          objectStored: true,
          ledgerCommitted: false,
          manifestCommitted: false,
          verified: false,
        },
      },
    });
    expect(env.publicBucket.objects.has('manifests/current.json')).toBe(false);
  });

  test('manifest CAS retries and eventually commits the publication', async () => {
    const env = createEnv();
    env.publicBucket.forcePutConflicts('manifests/current.json', 2);

    const { response, body } = await publish(env, 'req-manifest-eventual');

    expect(response.status).toBe(200);
    expect(body.manifestCommitted).toBe(true);
    expect(env.publicBucket.countPuts('manifests/current.json')).toBe(3);
  });

  test('manifest CAS exhaustion never returns success', async () => {
    const env = createEnv();
    env.publicBucket.forcePutConflicts('manifests/current.json', 10);

    const { response, body } = await publish(env, 'req-manifest-exhausted');

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      success: false,
      code: 'MANIFEST_COMMIT_FAILED',
      reconciliationRequired: true,
      failureReceipt: {
        publication: {
          objectStored: true,
          ledgerCommitted: true,
          manifestCommitted: false,
          verified: false,
        },
      },
    });
  });

  test('an object stored before manifest failure is not reported as a successful publication', async () => {
    const env = createEnv();
    env.publicBucket.forcePutConflicts('manifests/current.json', 10);

    const { response, body } = await publish(env, 'req-object-only');

    expect(env.publicBucket.objects.has(`words/${WORD_ID}/v1.webp`)).toBe(true);
    expect(response.ok).toBe(false);
    expect(body.success).toBe(false);
    expect(body.failureReceipt.publication.objectStored).toBe(true);
    expect(body.failureReceipt.publication.manifestCommitted).toBe(false);
  });

  test('skipManifestCommit returns a non-success staged outcome', async () => {
    const env = createEnv();

    const { response, body } = await publish(env, 'req-staged', SERVER_SHA, {
      skipManifestCommit: true,
    });

    expect(response.status).toBe(409);
    expect(response.ok).toBe(false);
    expect(body).toMatchObject({
      success: false,
      status: 'staged',
      code: 'PUBLISH_STAGED',
      ledgerCommitted: true,
      manifestCommitted: false,
      publication: {
        objectStored: true,
        ledgerCommitted: true,
        manifestCommitted: false,
        verified: false,
      },
    });
    expect(env.publicBucket.objects.has('manifests/current.json')).toBe(false);
  });

  test('success fields match the committed object, ledger, and manifest values', async () => {
    const env = createEnv();

    const { body } = await publish(env, 'req-committed-values');
    const object = await env.publicBucket.head(body.imageKey);
    const ledger = await (await env.privateBucket.get(`ledger/words/${WORD_ID}.json`))!.json<any>();
    const manifest = await (await env.publicBucket.get('manifests/current.json'))!.json<any>();

    expect(object?.customMetadata).toMatchObject({
      'x-amz-meta-wordid': body.wordId,
      'x-amz-meta-version': String(body.version),
      'x-amz-meta-sha256': body.sha256,
    });
    expect(ledger.wordId).toBe(body.wordId);
    expect(ledger.activeVersion).toBe(body.version);
    expect(ledger.currentPublishedVersion).toBe(body.version);
    expect(ledger.history[body.version].version).toBe(body.version);
    expect(ledger.history[body.version].storage.publicWebpSha256).toBe(body.sha256);
    expect(manifest.images[body.wordId]).toMatchObject({
      v: body.version,
      h: body.sha256.slice(0, 16),
    });
  });

  test('same publishRequestId replays the identical partial failure receipt without new writes', async () => {
    const env = createEnv();
    env.publicBucket.forcePutConflicts('manifests/current.json', 10);
    const first = await publish(env, 'req-partial-replay');
    const publicPutCount = env.publicBucket.putCalls.length;
    const privatePutCount = env.privateBucket.putCalls.length;

    const second = await publish(env, 'req-partial-replay');

    expect(first.response.status).toBe(503);
    expect(second.response.status).toBe(503);
    expect(second.body.idempotentReplay).toBe(true);
    expect(second.body.failureReceipt).toEqual(first.body.failureReceipt);
    expect(env.publicBucket.putCalls.length).toBe(publicPutCount);
    expect(env.privateBucket.putCalls.length).toBe(privatePutCount);
    expect(env.publicBucket.objects.has(`words/${WORD_ID}/v2.webp`)).toBe(false);
  });

  test('manifest read-back hash-prefix mismatch prevents success', async () => {
    const env = createEnv();
    env.publicBucket.corruptNextCommittedManifestReadback('manifests/current.json');

    const { response, body } = await publish(env, 'req-readback-mismatch');

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      success: false,
      code: 'PUBLICATION_VERIFICATION_FAILED',
      reconciliationRequired: true,
      failureReceipt: {
        wordId: WORD_ID,
        version: 1,
        sha256: SERVER_SHA,
        publication: {
          objectStored: true,
          ledgerCommitted: true,
          manifestCommitted: true,
          verified: false,
        },
      },
    });
  });
});
