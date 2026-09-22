import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { runSingleJob, type WorkerDependencies } from '../automation/worker/singleJobWorker';

const OWNER = 'owner-a';
const RUN = 'run-a';
const WORD = 'tw_w_aaaaaaaaaaaa';
const PROMPT = 'Generate a simple image for alpha.';
const PROMPT_HASH = createHash('sha256').update(PROMPT).digest('hex');
const DATASET_HASH = 'a'.repeat(64);

function candidate() {
  return { wordId: WORD, courseId: 'core-1200', headword: 'alpha', promptText: PROMPT, promptHash: PROMPT_HASH, datasetHash: DATASET_HASH };
}

function deps(overrides: Partial<WorkerDependencies> = {}): WorkerDependencies {
  const calls: string[] = [];
  const control = {
    acquireLease: async () => ({ token: 'lease', generation: 1, activeJobId: null }),
    claimJob: async () => ({ job: { jobId: 'job-a', runId: RUN, activeAttemptId: 'attempt-a', ...candidate(), state: 'active' as const }, attempt: { attemptId: 'attempt-a', jobId: 'job-a', attemptNo: 1, state: 'created' as const } }),
    advanceAttempt: async (_lease: unknown, _attemptId: string, state: string) => { calls.push(state); return { state }; },
    completePublication: async () => { calls.push('completed'); return { countedAt: new Date().toISOString() }; },
    hardStop: async (_lease: unknown, code: string) => { calls.push(`hard:${code}`); },
    recover: async () => ({ job: null, attempt: null }),
  };
  const gemini = { generate: async () => ({ responseMarker: 'response-a', masterPath: 'master.jpg', master: { mediaType: 'image/jpeg', byteSize: 4, width: 2, height: 2, sha256: 'b'.repeat(64) } }) };
  const publisher = { publish: async ({ publishRequestId }: { publishRequestId: string }) => ({ success: true, verifiedAtCommit: true, activeAtVerification: true, verifiedAt: new Date().toISOString(), publishRequestId, wordId: WORD, version: 1, imageKey: `words/${WORD}/v1.webp`, sha256: 'c'.repeat(64), ledgerCommitted: true, manifestCommitted: true, publication: { objectStored: true, ledgerCommitted: true, manifestCommitted: true, verified: true } }) };
  const manifest = { hasImage: async () => false };
  const webp = { derive: async () => ({ path: 'production.webp', sha256: 'c'.repeat(64), byteSize: 3, width: 2, height: 2, mediaType: 'image/webp' }) };
  return { ownerId: OWNER, runId: RUN, candidate: candidate(), artifactRoot: 'artifacts', control, gemini, publisher, manifest, webp, testCalls: calls, ...overrides } as WorkerDependencies;
}

describe('Phase 2B single-job worker', () => {
  test('happy path completes one publication and never claims a second job', async () => {
    const input = deps();
    const result = await runSingleJob(input);
    expect(result.status).toBe('completed');
    expect(input.testCalls).toEqual(['prompt_submitted', 'response_verified', 'downloaded', 'artifact_verified', 'publishing', 'completed']);
  });

  test('prompt hash mismatch stops before Gemini', async () => {
    const input = deps({ candidate: { ...candidate(), promptHash: 'f'.repeat(64) } });
    await expect(runSingleJob(input)).rejects.toThrow('PROMPT_HASH_MISMATCH');
  });

  test('publisher uncertainty preserves the same attempt and does not complete', async () => {
    const input = deps({ publisher: { publish: async () => { throw Object.assign(new Error('timeout'), { code: 'PUBLISH_UNCERTAIN', uncertain: true }); } } });
    const result = await runSingleJob(input);
    expect(result.status).toBe('publication_uncertain');
    expect(input.testCalls).toContain('hard:PUBLISH_UNCERTAIN');
    expect(input.testCalls).not.toContain('completed');
  });

  test('artifact capture failure never calls publisher', async () => {
    let published = false;
    const input = deps({
      gemini: { generate: async () => { throw new Error('ARTIFACT_INVALID'); } },
      publisher: { publish: async () => { published = true; throw new Error('must not publish'); } },
    });
    await expect(runSingleJob(input)).rejects.toThrow('ARTIFACT_INVALID');
    expect(published).toBe(false);
  });

  test('WebP derivation failure never calls publisher', async () => {
    let published = false;
    const input = deps({
      webp: { derive: async () => { throw new Error('DELIVERY_ARTIFACT_INVALID'); } },
      publisher: { publish: async () => { published = true; throw new Error('must not publish'); } },
    });
    await expect(runSingleJob(input)).rejects.toThrow('DELIVERY_ARTIFACT_INVALID');
    expect(published).toBe(false);
  });

  test('definite publisher failure never completes the job', async () => {
    const calls: string[] = [];
    const input = deps({
      publisher: { publish: async () => { throw Object.assign(new Error('rejected'), { code: 'INVALID_WEBP', uncertain: false }); } },
      control: {
        acquireLease: async () => ({ token: 'lease', generation: 1, activeJobId: null }),
        claimJob: async () => ({ job: { jobId: 'job-a', runId: RUN, activeAttemptId: 'attempt-a', ...candidate(), state: 'active' as const }, attempt: { attemptId: 'attempt-a', jobId: 'job-a', attemptNo: 1, state: 'created' as const } }),
        recover: async () => ({ job: null, attempt: null }),
        advanceAttempt: async (_lease: unknown, _attemptId: string, state: string) => { calls.push(state); },
        completePublication: async () => { calls.push('completed'); return { countedAt: new Date().toISOString() }; },
        hardStop: async (_lease: unknown, code: string) => { calls.push(`hard:${code}`); },
      },
    });
    await expect(runSingleJob(input)).rejects.toThrow('rejected');
    expect(calls).toContain('hard:PUBLISH_FAILED');
    expect(calls).not.toContain('completed');
  });

  test('fresh manifest image prevents Gemini generation', async () => {
    let generated = false;
    const input = deps({ manifest: { hasImage: async () => true }, gemini: { generate: async () => { generated = true; throw new Error('must not generate'); } } });
    const result = await runSingleJob(input);
    expect(result.status).toBe('already_published');
    expect(generated).toBe(false);
  });

  test('publishing restart reuses existing artifact and publishRequestId without Gemini', async () => {
    let generated = false;
    let publishedRequest = '';
    const input = deps({
      gemini: { generate: async () => { generated = true; throw new Error('must not regenerate'); } },
      publisher: { publish: async ({ publishRequestId }) => { publishedRequest = publishRequestId; return {
        success: true, verifiedAtCommit: true, activeAtVerification: true, verifiedAt: new Date().toISOString(), publishRequestId,
        wordId: WORD, version: 1, imageKey: `words/${WORD}/v1.webp`, sha256: 'c'.repeat(64), ledgerCommitted: true, manifestCommitted: true,
        publication: { objectStored: true, ledgerCommitted: true, manifestCommitted: true, verified: true },
      }; } },
      control: {
        acquireLease: async () => ({ token: 'lease', generation: 1, activeJobId: 'job-a' }),
        claimJob: async () => { throw new Error('must not claim'); },
        recover: async () => ({ job: { jobId: 'job-a', runId: RUN, state: 'active' as const, activeAttemptId: 'attempt-a', ...candidate() }, attempt: {
          attemptId: 'attempt-a', jobId: 'job-a', attemptNo: 1, state: 'publishing' as const, artifactLocator: 'artifacts/job-a/attempt-a.webp', artifactSha256: 'c'.repeat(64), artifactBytes: 3, publishRequestId: 'publish-existing',
        } }),
        advanceAttempt: async () => {},
        completePublication: async () => ({ countedAt: new Date().toISOString() }),
        hardStop: async () => {},
      },
      webp: { derive: async () => { throw new Error('must not derive'); }, load: async (path, expectedSha256) => ({ path, sha256: expectedSha256!, byteSize: 3, width: 2, height: 2, mediaType: 'image/webp' }) },
    });
    const result = await runSingleJob(input);
    expect(result.status).toBe('completed');
    expect(generated).toBe(false);
    expect(publishedRequest).toBe('publish-existing');
  });

  test('verified publication restart completes without Gemini, encoding, or publish replay', async () => {
    let generated = false;
    let published = false;
    let encoded = false;
    const receipt = {
      success: true, verifiedAtCommit: true, activeAtVerification: true, verifiedAt: new Date().toISOString(),
      publishRequestId: 'publish-verified', wordId: WORD, version: 4, imageKey: `words/${WORD}/v4.webp`,
      sha256: 'c'.repeat(64), ledgerCommitted: true, manifestCommitted: true,
      publication: { objectStored: true, ledgerCommitted: true, manifestCommitted: true, verified: true },
    };
    const input = deps({
      gemini: { generate: async () => { generated = true; throw new Error('must not regenerate'); } },
      publisher: { publish: async () => { published = true; throw new Error('must not republish'); } },
      webp: { derive: async () => { encoded = true; throw new Error('must not encode'); }, load: async () => ({ path: 'existing.webp', sha256: 'c'.repeat(64), byteSize: 3, width: 2, height: 2, mediaType: 'image/webp' }) },
      control: {
        acquireLease: async () => ({ token: 'lease', generation: 7, activeJobId: 'job-a' }),
        claimJob: async () => { throw new Error('must not claim'); },
        recover: async () => ({ job: { jobId: 'job-a', runId: RUN, state: 'active' as const, activeAttemptId: 'attempt-a', ...candidate() }, attempt: {
          attemptId: 'attempt-a', jobId: 'job-a', attemptNo: 1, state: 'publication_verified' as const,
          publishRequestId: receipt.publishRequestId, publicationReceipt: receipt,
        } }),
        advanceAttempt: async () => { throw new Error('must not advance'); },
        completePublication: async () => ({ countedAt: new Date().toISOString() }),
        hardStop: async () => { throw new Error('must not stop'); },
      },
    });
    const result = await runSingleJob(input);
    expect(result.status).toBe('completed');
    expect(generated).toBe(false);
    expect(published).toBe(false);
    expect(encoded).toBe(false);
  });

  test('stale lease completion is surfaced and cannot report success', async () => {
    const input = deps({
      control: {
        acquireLease: async () => ({ token: 'stale', generation: 1, activeJobId: null }),
        claimJob: async () => ({ job: { jobId: 'job-a', runId: RUN, activeAttemptId: 'attempt-a', ...candidate(), state: 'active' as const }, attempt: { attemptId: 'attempt-a', jobId: 'job-a', attemptNo: 1, state: 'created' as const } }),
        recover: async () => ({ job: null, attempt: null }),
        advanceAttempt: async () => {},
        completePublication: async () => { throw new Error('STALE_LEASE'); },
        hardStop: async () => {},
      },
    });
    await expect(runSingleJob(input)).rejects.toThrow('STALE_LEASE');
  });
});
