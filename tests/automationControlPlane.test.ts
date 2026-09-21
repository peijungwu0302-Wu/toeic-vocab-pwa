// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { FakeAutomationPlane, FakeWorker, type Candidate, type VerifiedReceipt } from '../automation/fakeControlPlane';

const OWNER_A = '00000000-0000-4000-8000-000000000001';
const OWNER_B = '00000000-0000-4000-8000-000000000002';
const WORD_A = 'tw_w_aaaaaaaaaaaa';
const WORD_B = 'tw_w_bbbbbbbbbbbb';
const SHA = 'a'.repeat(64);
const candidate = (wordId = WORD_A, promptText = 'immutable prompt'): Candidate => ({
  wordId, courseId: 'core-1200', headword: 'alpha', promptText,
  promptHash: createHash('sha256').update(promptText, 'utf8').digest('hex'), datasetHash: 'c'.repeat(64),
});

function setup(now = '2026-09-21T00:00:00.000Z') {
  let current = new Date(now);
  const plane = new FakeAutomationPlane(() => current);
  plane.bootstrap(OWNER_A);
  plane.bootstrap(OWNER_B);
  return { plane, advance(ms: number) { current = new Date(current.getTime() + ms); }, setNow(value: string) { current = new Date(value); } };
}

function start(plane: FakeAutomationPlane, owner = OWNER_A) {
  return plane.command(owner, owner, '00000000-0000-4000-8000-000000000011', 0, 'START');
}

function leased(plane: FakeAutomationPlane, owner = OWNER_A) {
  const run = start(plane, owner);
  const lease = plane.acquireLease(owner, 'worker-1');
  return { run, lease };
}

function receipt(job: { wordId: string }, attempt: { publishRequestId: string; artifactSha256: string }): VerifiedReceipt {
  return {
    success: true, ledgerCommitted: true, manifestCommitted: true,
    verifiedAtCommit: true, activeAtVerification: true,
    verifiedAt: '2026-09-21T00:00:00.000Z', wordId: job.wordId, version: 1,
    imageKey: `words/${job.wordId}/v1.webp`, sha256: attempt.artifactSha256,
    publishRequestId: attempt.publishRequestId,
    publication: { objectStored: true, ledgerCommitted: true, manifestCommitted: true, verified: true },
  };
}

function publishing(plane: FakeAutomationPlane) {
  const { run, lease } = leased(plane);
  const job = plane.claim(OWNER_A, lease, run.runId, candidate());
  plane.advance(OWNER_A, lease, job.attemptId, 'prompt_submitted');
  plane.advance(OWNER_A, lease, job.attemptId, 'response_verified', 'fake-response-A');
  plane.advance(OWNER_A, lease, job.attemptId, 'downloaded');
  const artifact = plane.recordArtifact(OWNER_A, lease, job.attemptId, SHA, 12);
  const publishRequestId = '00000000-0000-4000-8000-000000000099';
  plane.beginPublish(OWNER_A, lease, job.attemptId, publishRequestId);
  return { run, lease, job, artifact, publishRequestId };
}

describe('Phase 1B fake RPC contract', () => {
  test('owner A cannot read or command owner B', () => {
    const { plane } = setup();
    expect(() => plane.read(OWNER_A, OWNER_B)).toThrow('OWNER_MISMATCH');
    expect(() => plane.command(OWNER_A, OWNER_B, crypto.randomUUID(), 0, 'START')).toThrow('OWNER_MISMATCH');
  });

  test('stale command sequence is rejected', () => {
    const { plane } = setup();
    start(plane);
    expect(() => plane.command(OWNER_A, OWNER_A, crypto.randomUUID(), 0, 'PAUSE', plane.read(OWNER_A, OWNER_A).runId)).toThrow('STALE_COMMAND');
  });

  test('missing command sequence is rejected rather than bypassing CAS', () => {
    const { plane } = setup();
    expect(() => plane.command(OWNER_A, OWNER_A, crypto.randomUUID(), null as unknown as number, 'START'))
      .toThrow('STALE_COMMAND');
  });

  test('latest command ID replays without advancing sequence', () => {
    const { plane } = setup();
    const first = start(plane);
    expect(start(plane)).toEqual(first);
    expect(plane.read(OWNER_A, OWNER_A).commandSeq).toBe(1);
  });

  test('reusing the latest command ID with a different payload is rejected', () => {
    const { plane } = setup();
    const run = start(plane);
    expect(() => plane.command(OWNER_A, OWNER_A, '00000000-0000-4000-8000-000000000011', 0, 'PAUSE', run.runId))
      .toThrow('COMMAND_ID_REUSED');
    expect(plane.read(OWNER_A, OWNER_A).commandSeq).toBe(1);
  });

  test('older START cannot undo STOP', () => {
    const { plane } = setup();
    const run = start(plane);
    plane.command(OWNER_A, OWNER_A, crypto.randomUUID(), 1, 'STOP', run.runId);
    expect(() => plane.command(OWNER_A, OWNER_A, crypto.randomUUID(), 1, 'START')).toThrow('STALE_COMMAND');
    expect(plane.read(OWNER_A, OWNER_A).runState).toBe('stopped');
  });

  test('new START cannot resurrect a stopped same-day run', () => {
    const { plane } = setup();
    const run = start(plane);
    plane.command(OWNER_A, OWNER_A, crypto.randomUUID(), 1, 'STOP', run.runId);
    expect(() => plane.command(OWNER_A, OWNER_A, crypto.randomUUID(), 2, 'START')).toThrow('RUN_TERMINAL');
  });

  test('START rejects a stale target run identity instead of ignoring it', () => {
    const { plane } = setup();
    expect(() => plane.command(OWNER_A, OWNER_A, crypto.randomUUID(), 0, 'START', crypto.randomUUID()))
      .toThrow('INVALID_COMMAND');
  });

  test('fenced worker cannot claim or complete after newer lease generation', () => {
    const { plane, advance } = setup();
    const { run, lease } = leased(plane);
    advance(31_000);
    const replacement = plane.acquireLease(OWNER_A, 'worker-2');
    expect(replacement.generation).toBe(lease.generation + 1);
    expect(() => plane.claim(OWNER_A, lease, run.runId, candidate())).toThrow('STALE_LEASE');
  });

  test('expired lease with no active job can be taken over', () => {
    const { plane, advance } = setup();
    const { run, lease } = leased(plane);
    advance(31_000);
    const replacement = plane.acquireLease(OWNER_A, 'worker-2');
    expect(plane.claim(OWNER_A, replacement, run.runId, candidate()).wordId).toBe(WORD_A);
    expect(() => plane.renewLease(OWNER_A, lease)).toThrow('STALE_LEASE');
  });

  test('only one job per owner can be active and duplicate wordId in a run is rejected', () => {
    const { plane } = setup();
    const { run, lease } = leased(plane);
    plane.claim(OWNER_A, lease, run.runId, candidate());
    expect(() => plane.claim(OWNER_A, lease, run.runId, candidate(WORD_B))).toThrow('ACTIVE_JOB_EXISTS');
  });

  test('duplicate wordId remains rejected after the first job completed', () => {
    const { plane } = setup();
    const { run, lease, job, publishRequestId } = publishing(plane);
    plane.complete(OWNER_A, lease, job.jobId, job.attemptId, receipt(job, { artifactSha256: SHA, publishRequestId }));
    expect(() => plane.claim(OWNER_A, lease, run.runId, candidate(WORD_A))).toThrow('DUPLICATE_WORD');
  });

  test('PAUSE waits for current A; STOP prevents B after A completes', () => {
    const { plane } = setup();
    const { run, lease, job, publishRequestId } = publishing(plane);
    const paused = plane.command(OWNER_A, OWNER_A, crypto.randomUUID(), 1, 'PAUSE', run.runId);
    expect(paused.runState).toBe('pause_requested');
    plane.command(OWNER_A, OWNER_A, crypto.randomUUID(), 2, 'STOP', run.runId);
    plane.complete(OWNER_A, lease, job.jobId, job.attemptId, receipt(job, { artifactSha256: SHA, publishRequestId }));
    expect(plane.read(OWNER_A, OWNER_A).runState).toBe('stopped');
    expect(() => plane.claim(OWNER_A, lease, run.runId, candidate(WORD_B))).toThrow('RUN_NOT_CLAIMABLE');
  });

  test('job prompt snapshot is immutable after candidate data changes', () => {
    const { plane } = setup();
    const { run, lease } = leased(plane);
    const input = candidate();
    const job = plane.claim(OWNER_A, lease, run.runId, input);
    input.promptText = 'later dataset text';
    expect(plane.job(job.jobId).promptText).toBe('immutable prompt');
  });

  test('claim rejects a prompt/hash mismatch before creating a job', () => {
    const { plane } = setup();
    const { run, lease } = leased(plane);
    expect(() => plane.claim(OWNER_A, lease, run.runId, { ...candidate(), promptHash: 'b'.repeat(64) })).toThrow('INVALID_CANDIDATE');
    expect(plane.recover(OWNER_A, lease).job).toBeUndefined();
  });

  test('artifact locator is relative and retry preserves attempt and publishRequestId', () => {
    const { plane } = setup();
    const { lease, job, artifact, publishRequestId } = publishing(plane);
    expect(artifact).toBe(`artifacts/${job.jobId}/${job.attemptId}.webp`);
    expect(plane.beginPublish(OWNER_A, lease, job.attemptId, publishRequestId).attemptId).toBe(job.attemptId);
    expect(plane.attempt(job.attemptId).publishRequestId).toBe(publishRequestId);
    expect(() => plane.beginPublish(OWNER_A, lease, job.attemptId, crypto.randomUUID())).toThrow('ARTIFACT_IDENTITY_CHANGED');
  });

  test('PUBLISH_IN_FLIGHT remains the same attempt', () => {
    const { plane } = setup();
    const { lease, job } = publishing(plane);
    plane.publishInFlight(OWNER_A, lease, job.attemptId);
    expect(plane.attempt(job.attemptId).state).toBe('publishing');
    expect(plane.job(job.jobId).state).toBe('active');
  });

  test('fresh generation after a confirmed safe failure uses a new attemptId', () => {
    const { plane } = setup();
    const { lease, run } = leased(plane);
    const claimed = plane.claim(OWNER_A, lease, run.runId, candidate());
    plane.failSafe(OWNER_A, lease, claimed.attemptId, 'NO_EXTERNAL_SUBMISSION');
    const next = plane.newAttempt(OWNER_A, lease, claimed.jobId);
    expect(next.attemptId).not.toBe(claimed.attemptId);
    expect(plane.attempt(next.attemptId).state).toBe('created');
  });

  test('a verified response requires a response marker', () => {
    const { plane } = setup();
    const { run, lease } = leased(plane);
    const job = plane.claim(OWNER_A, lease, run.runId, candidate());
    plane.advance(OWNER_A, lease, job.attemptId, 'prompt_submitted');
    expect(() => plane.advance(OWNER_A, lease, job.attemptId, 'response_verified')).toThrow('RESPONSE_MARKER_REQUIRED');
    expect(plane.attempt(job.attemptId).state).toBe('prompt_submitted');
  });

  test('reconciliation-required A blocks B even after lease takeover', () => {
    const { plane, advance } = setup();
    const { run, lease, job } = publishing(plane);
    plane.reconciliationRequired(OWNER_A, lease, job.attemptId, 'MANIFEST_COMMIT_FAILED');
    advance(31_000);
    const replacement = plane.acquireLease(OWNER_A, 'worker-2');
    expect(plane.read(OWNER_A, OWNER_A).activeJobId).toBe(job.jobId);
    expect(() => plane.claim(OWNER_A, replacement, run.runId, candidate(WORD_B))).toThrow();
  });

  test('hard stop preserves A as the blocking job and exposes the reason', () => {
    const { plane } = setup();
    const { run, lease, job } = publishing(plane);
    plane.hardStop(OWNER_A, lease, 'LOGIN_LOST', 'Gemini session expired');
    expect(plane.read(OWNER_A, OWNER_A)).toMatchObject({
      activeJobId: job.jobId, runState: 'hard_stopped', lastErrorCode: 'LOGIN_LOST', hardStopReason: 'Gemini session expired',
    });
    expect(() => plane.claim(OWNER_A, lease, run.runId, candidate(WORD_B))).toThrow('ACTIVE_JOB_EXISTS');
  });

  test('verified completion rejects mismatched publication identity', () => {
    const { plane } = setup();
    const { lease, job, publishRequestId } = publishing(plane);
    expect(() => plane.complete(OWNER_A, lease, job.jobId, job.attemptId, { ...receipt(job, { artifactSha256: SHA, publishRequestId }), wordId: WORD_B })).toThrow('RECEIPT_MISMATCH');
    expect(plane.job(job.jobId).state).toBe('active');
  });

  test('verified completion is idempotent and counts once', () => {
    const { plane } = setup();
    const { lease, job, publishRequestId } = publishing(plane);
    const valid = receipt(job, { artifactSha256: SHA, publishRequestId });
    const first = plane.complete(OWNER_A, lease, job.jobId, job.attemptId, valid);
    const second = plane.complete(OWNER_A, lease, job.jobId, job.attemptId, valid);
    expect(second.countedAt).toBe(first.countedAt);
    expect(plane.dailyCount(OWNER_A)).toBe(1);
  });

  test('completion after Taiwan midnight counts on the new calendar date', () => {
    const { plane, setNow } = setup('2026-09-21T15:59:59.000Z');
    const { lease, job, publishRequestId } = publishing(plane);
    setNow('2026-09-21T16:00:01.000Z');
    plane.complete(OWNER_A, lease, job.jobId, job.attemptId, receipt(job, { artifactSha256: SHA, publishRequestId }));
    expect(plane.dailyCount(OWNER_A, '2026-09-21')).toBe(0);
    expect(plane.dailyCount(OWNER_A, '2026-09-22')).toBe(1);
  });

  test('cap prevents claim 101 across runs without counting attempts', () => {
    const { plane } = setup();
    const { run, lease } = leased(plane);
    for (let i = 0; i < 100; i++) {
      const wordId = `tw_w_${i.toString(16).padStart(12, '0')}`;
      const job = plane.claim(OWNER_A, lease, run.runId, candidate(wordId));
      plane.advance(OWNER_A, lease, job.attemptId, 'prompt_submitted');
      plane.advance(OWNER_A, lease, job.attemptId, 'response_verified', `fake-response-${i}`);
      plane.advance(OWNER_A, lease, job.attemptId, 'downloaded');
      plane.recordArtifact(OWNER_A, lease, job.attemptId, SHA, 12);
      const publishRequestId = crypto.randomUUID();
      plane.beginPublish(OWNER_A, lease, job.attemptId, publishRequestId);
      plane.complete(OWNER_A, lease, job.jobId, job.attemptId, receipt({ wordId }, { artifactSha256: SHA, publishRequestId }));
    }
    expect(plane.dailyCount(OWNER_A)).toBe(100);
    expect(plane.read(OWNER_A, OWNER_A).runState).toBe('capped');
    expect(() => plane.claim(OWNER_A, lease, run.runId, candidate())).toThrow();
  });

  test('previous-day active completion after midnight counts against new run', () => {
    const { plane, setNow } = setup('2026-09-21T15:59:59.000Z');
    const { lease, job, publishRequestId } = publishing(plane);
    setNow('2026-09-21T16:00:01.000Z');
    plane.complete(OWNER_A, lease, job.jobId, job.attemptId, receipt(job, { artifactSha256: SHA, publishRequestId }));
    const nextRun = plane.command(OWNER_A, OWNER_A, crypto.randomUUID(), 1, 'START');
    expect(plane.dailyCount(OWNER_A)).toBe(1);
    expect(plane.claim(OWNER_A, lease, nextRun.runId, candidate(WORD_B)).wordId).toBe(WORD_B);
  });

  test('downloaded artifact survives recovery with A still active', () => {
    const { plane, advance } = setup();
    const { run, lease } = leased(plane);
    const job = plane.claim(OWNER_A, lease, run.runId, candidate());
    plane.advance(OWNER_A, lease, job.attemptId, 'prompt_submitted');
    plane.advance(OWNER_A, lease, job.attemptId, 'response_verified', 'fake-response-A');
    plane.advance(OWNER_A, lease, job.attemptId, 'downloaded');
    const locator = plane.recordArtifact(OWNER_A, lease, job.attemptId, SHA, 12);
    advance(31_000);
    const replacement = plane.acquireLease(OWNER_A, 'worker-2');
    expect(plane.recover(OWNER_A, replacement).attempt?.artifactLocator).toBe(locator);
    expect(() => plane.claim(OWNER_A, replacement, run.runId, candidate(WORD_B))).toThrow('ACTIVE_JOB_EXISTS');
  });

  test('publishing crash recovers A with the same artifact and publishRequestId', () => {
    const { plane, advance } = setup();
    const { run, job, publishRequestId, artifact } = publishing(plane);
    advance(31_000);
    const replacement = plane.acquireLease(OWNER_A, 'worker-2');
    const recovered = plane.recover(OWNER_A, replacement);
    expect(recovered.attempt).toMatchObject({
      attemptId: job.attemptId, state: 'publishing', artifactLocator: artifact,
      artifactSha256: SHA, publishRequestId,
    });
    expect(plane.beginPublish(OWNER_A, replacement, job.attemptId, publishRequestId).attemptId).toBe(job.attemptId);
    expect(() => plane.claim(OWNER_A, replacement, run.runId, candidate(WORD_B))).toThrow('ACTIVE_JOB_EXISTS');
  });

  test('an active job prevents voluntary lease release', () => {
    const { plane } = setup();
    const { run, lease } = leased(plane);
    plane.claim(OWNER_A, lease, run.runId, candidate());
    expect(() => plane.releaseLease(OWNER_A, lease)).toThrow('ACTIVE_JOB_EXISTS');
  });

  test('stale worker cannot complete a job after lease takeover', () => {
    const { plane, advance } = setup();
    const { lease, job, publishRequestId } = publishing(plane);
    advance(31_000);
    plane.acquireLease(OWNER_A, 'worker-2');
    expect(() => plane.complete(OWNER_A, lease, job.jobId, job.attemptId, receipt(job, { artifactSha256: SHA, publishRequestId }))).toThrow('STALE_LEASE');
  });

  test('fake worker selects manifest-missing flagship wordIds and completes A before B', () => {
    const { plane } = setup();
    const worker = new FakeWorker(plane, OWNER_A, [candidate(WORD_A), candidate(WORD_B)], new Set([WORD_B]));
    const run = start(plane);
    worker.acquire();
    expect(worker.runOne(run.runId)?.wordId).toBe(WORD_A);
    expect(plane.dailyCount(OWNER_A)).toBe(1);
    expect(worker.runOne(run.runId)).toBeNull();
    expect(plane.read(OWNER_A, OWNER_A).runState).toBe('finished');
  });

  test('an empty pending set finishes the run without creating a job', () => {
    const { plane } = setup();
    const worker = new FakeWorker(plane, OWNER_A, [candidate(WORD_A)], new Set([WORD_A]));
    const run = start(plane);
    worker.acquire();
    expect(worker.runOne(run.runId)).toBeNull();
    expect(plane.read(OWNER_A, OWNER_A)).toMatchObject({ runState: 'finished', activeJobId: undefined });
  });

  test('fake worker completes A then B in sequence with no overlapping active job', () => {
    const { plane } = setup();
    const worker = new FakeWorker(plane, OWNER_A, [candidate(WORD_A), candidate(WORD_B)], new Set());
    const run = start(plane);
    worker.acquire();
    expect(worker.runOne(run.runId)?.wordId).toBe(WORD_A);
    expect(plane.read(OWNER_A, OWNER_A).activeJobId).toBeUndefined();
    expect(worker.runOne(run.runId)?.wordId).toBe(WORD_B);
    expect(plane.dailyCount(OWNER_A)).toBe(2);
  });

  test('fake worker partial-publication outcome hard-stops and retains A', () => {
    const { plane } = setup();
    const worker = new FakeWorker(plane, OWNER_A, [candidate(WORD_A), candidate(WORD_B)], new Set(), 'reconciliation_required');
    const run = start(plane);
    worker.acquire();
    expect(() => worker.runOne(run.runId)).toThrow('RECONCILIATION_REQUIRED');
    expect(plane.read(OWNER_A, OWNER_A).activeJobId).toBeTruthy();
    expect(plane.read(OWNER_A, OWNER_A).runState).toBe('hard_stopped');
    expect(() => worker.runOne(run.runId)).toThrow();
  });
});

test('migration grant guard keeps browser DML and lease tokens private', () => {
  const schema = readFileSync(new URL('../supabase/migrations/0003_automation_control_plane.sql', import.meta.url), 'utf8');
  const rpcs = readFileSync(new URL('../supabase/migrations/0004_automation_control_rpcs.sql', import.meta.url), 'utf8');
  for (const table of ['automation_runs', 'generation_jobs', 'generation_attempts', 'automation_control']) {
    expect(schema).toContain(`alter table public.${table} enable row level security`);
  }
  expect(schema).toMatch(/revoke all on public\.automation_runs, public\.generation_jobs,[\s\S]*?from public, anon, authenticated, service_role;/);
  expect(schema).not.toMatch(/grant\s+(?:all|insert|update|delete)\b[\s\S]*?to authenticated;/i);
  const controlGrant = schema.match(/grant select \(([^)]+)\)\s+on public\.automation_control to authenticated;/i)?.[1];
  expect(controlGrant).toBeTruthy();
  expect(controlGrant).not.toContain('lease_token');
  expect(controlGrant).not.toContain('lease_generation');
  expect(rpcs).toContain('auth.uid() <> p_owner');
  expect(rpcs).toContain("coalesce(auth.jwt() ->> 'role', '') <> 'service_role'");
});
