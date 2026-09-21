// @vitest-environment node
// Opt-in only. Every request targets an explicitly confirmed isolated project.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireIsolatedDatabase, type StagingConfig } from './stagingSafety';

type Owner = { id: string; client: SupabaseClient; secondClient: SupabaseClient };
type Lease = { leaseToken: string; leaseGeneration: number; activeJobId: string | null };
type Run = { commandSeq: number; runId: string; runState: string };
type Claim = { status: string; jobId: string; attemptId: string; wordId: string };
type Completion = { jobId: string; countedAt: string; idempotentReplay: boolean };
type RpcResult = { data: unknown; error: { message: string } | null };

const stagingKeys = [
  'SUPABASE_TEST_URL', 'SUPABASE_TEST_PROJECT_REF', 'SUPABASE_TEST_PUBLISHABLE_KEY',
  'SUPABASE_TEST_SERVICE_ROLE_KEY', 'SUPABASE_TEST_CONFIRMATION', 'SUPABASE_PRODUCTION_URL',
];
const requested = stagingKeys.some((key) => Boolean(process.env[key]));

describe.skipIf(!requested)('real Supabase automation RPCs (isolated staging only)', () => {
  let config: StagingConfig;
  let service: SupabaseClient;
  let sequence = 0;
  const usersToDelete: string[] = [];

  beforeAll(() => {
    config = requireIsolatedDatabase({
      testUrl: process.env.SUPABASE_TEST_URL ?? '',
      productionUrl: process.env.SUPABASE_PRODUCTION_URL ?? '',
      projectRef: process.env.SUPABASE_TEST_PROJECT_REF ?? '',
      publishableKey: process.env.SUPABASE_TEST_PUBLISHABLE_KEY ?? '',
      serviceRoleKey: process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? '',
      confirmation: process.env.SUPABASE_TEST_CONFIRMATION ?? '',
    });
    service = createClient(config.testUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterEach(async () => {
    for (const id of usersToDelete.splice(0).reverse()) {
      const { error } = await service.auth.admin.deleteUser(id);
      if (error) throw new Error(`TEST_USER_CLEANUP_FAILED: ${error.message}`);
    }
  });

  async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data as T;
  }

  async function denied(result: PromiseLike<RpcResult>): Promise<string> {
    const { error } = await result;
    expect(error).not.toBeNull();
    return error!.message;
  }

  async function owner(): Promise<Owner> {
    const email = `phase1c-${randomUUID()}@example.com`;
    const password = randomBytes(24).toString('base64url');
    const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`TEST_USER_CREATE_FAILED: ${error?.message ?? 'missing user'}`);
    usersToDelete.push(data.user.id);
    const makeClient = async () => {
      const client = createClient(config.testUrl, config.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const signIn = await client.auth.signInWithPassword({ email, password });
      if (signIn.error || signIn.data.user?.id !== data.user!.id) {
        throw new Error(`TEST_USER_SIGN_IN_FAILED: ${signIn.error?.message ?? 'wrong identity'}`);
      }
      return client;
    };
    return { id: data.user.id, client: await makeClient(), secondClient: await makeClient() };
  }

  async function start(user: Owner): Promise<Run> {
    await rpc(service, 'automation_bootstrap_owner', { p_owner: user.id });
    return rpc<Run>(user.client, 'automation_request_command', {
      p_owner: user.id, p_command_id: randomUUID(), p_expected_seq: 0,
      p_action: 'START', p_target_run: null,
    });
  }

  async function acquire(user: Owner, instance = randomUUID()): Promise<Lease> {
    return rpc<Lease>(service, 'automation_acquire_lease', { p_owner: user.id, p_instance: instance });
  }

  function fence(user: Owner, lease: Lease) {
    return { p_owner: user.id, p_token: lease.leaseToken, p_generation: lease.leaseGeneration };
  }

  function candidate(user: Owner, lease: Lease, run: Run, wordId?: string) {
    const prompt = `Phase 1C staging prompt ${++sequence}`;
    return {
      ...fence(user, lease), p_run: run.runId,
      p_word_id: wordId ?? `tw_w_${sequence.toString(16).padStart(12, '0')}`,
      p_course_id: 'core-1200', p_headword: 'staging-test', p_prompt_text: prompt,
      p_prompt_hash: createHash('sha256').update(prompt, 'utf8').digest('hex'),
      p_dataset_hash: 'c'.repeat(64),
    };
  }

  async function claim(user: Owner, lease: Lease, run: Run, wordId?: string): Promise<Claim> {
    return rpc<Claim>(service, 'automation_claim_job', candidate(user, lease, run, wordId));
  }

  async function artifactVerified(user: Owner, lease: Lease, job: Claim) {
    const base = { ...fence(user, lease), p_attempt: job.attemptId };
    await rpc(service, 'automation_advance_attempt', { ...base, p_next_state: 'prompt_submitted' });
    await rpc(service, 'automation_advance_attempt', {
      ...base, p_next_state: 'response_verified', p_response_marker: `response-${job.attemptId}`,
    });
    await rpc(service, 'automation_advance_attempt', { ...base, p_next_state: 'downloaded' });
    const sha = createHash('sha256').update(`fake-artifact:${job.attemptId}`).digest('hex');
    const locator = `artifacts/${job.jobId}/${job.attemptId}.webp`;
    await rpc(service, 'automation_advance_attempt', {
      ...base, p_next_state: 'artifact_verified', p_artifact_locator: locator,
      p_artifact_sha256: sha, p_artifact_bytes: 64,
    });
    return { sha, locator };
  }

  async function publishing(user: Owner, lease: Lease, job: Claim) {
    const artifact = await artifactVerified(user, lease, job);
    const publishRequestId = randomUUID();
    await rpc(service, 'automation_advance_attempt', {
      ...fence(user, lease), p_attempt: job.attemptId,
      p_next_state: 'publishing', p_publish_request_id: publishRequestId,
    });
    return { ...artifact, publishRequestId };
  }

  function receipt(job: Claim, artifact: { sha: string; publishRequestId: string }) {
    return {
      success: true, verifiedAtCommit: true, activeAtVerification: true,
      verifiedAt: new Date().toISOString(), wordId: job.wordId, version: 1,
      imageKey: `words/${job.wordId}/v1.webp`, sha256: artifact.sha,
      publishRequestId: artifact.publishRequestId, ledgerCommitted: true, manifestCommitted: true,
      publication: { objectStored: true, ledgerCommitted: true, manifestCommitted: true, verified: true },
    };
  }

  async function complete(user: Owner, lease: Lease, job: Claim,
    artifact: { sha: string; publishRequestId: string }): Promise<Completion> {
    return rpc<Completion>(service, 'automation_complete_publication', {
      ...fence(user, lease), p_job: job.jobId, p_attempt: job.attemptId, p_receipt: receipt(job, artifact),
    });
  }

  async function count(user: Owner, day: string): Promise<number> {
    return rpc<number>(service, 'automation_daily_success_count', { p_owner: user.id, p_day: day });
  }

  function taipeiDay(value: string): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(value));
  }

  test('two Auth users are isolated; browser cannot read fence or mutate worker state', async () => {
    const a = await owner();
    const b = await owner();
    const runA = await start(a);
    await start(b);
    const leaseA = await acquire(a);
    await claim(a, leaseA, runA);
    const aControl = await a.client.from('automation_control').select('owner_user_id, command_seq').eq('owner_user_id', a.id);
    expect(aControl.error).toBeNull();
    expect(aControl.data).toHaveLength(1);
    const cross = await b.client.from('automation_control').select('owner_user_id').eq('owner_user_id', a.id);
    expect(cross.data).toEqual([]);
    for (const table of ['automation_runs', 'generation_jobs', 'generation_attempts']) {
      const result = await b.client.from(table).select('owner_user_id').eq('owner_user_id', a.id);
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    }
    await denied(a.client.from('automation_control').select('lease_token').eq('owner_user_id', a.id));
    await denied(b.client.rpc('automation_request_command', {
      p_owner: a.id, p_command_id: randomUUID(), p_expected_seq: 1, p_action: 'STOP', p_target_run: null,
    }));
    await denied(a.client.rpc('automation_acquire_lease', { p_owner: a.id, p_instance: randomUUID() }));
    await denied(a.client.rpc('automation_claim_job', candidate(a, leaseA, runA)));
    const directUpdate = await a.client.from('automation_control')
      .update({ command_seq: 99 }).eq('owner_user_id', a.id).select('command_seq');
    expect(Boolean(directUpdate.error) || directUpdate.data?.length === 0).toBe(true);
    const prompt = 'browser direct write must fail';
    await denied(a.client.from('generation_jobs').insert({
      owner_user_id: a.id, run_id: runA.runId, word_id: 'tw_w_aaaaaaaaaaaa',
      course_id: 'core-1200', headword: 'denied', prompt_text: prompt,
      prompt_hash: createHash('sha256').update(prompt).digest('hex'), dataset_hash: 'c'.repeat(64),
      state: 'queued',
    }));
    const unchanged = await a.client.from('automation_control').select('command_seq').eq('owner_user_id', a.id).single();
    expect(unchanged.data?.command_seq).toBe(1);
  });

  test('two concurrent lease acquisitions yield exactly one valid fence', async () => {
    const a = await owner();
    await start(a);
    const calls = await Promise.all([
      service.rpc('automation_acquire_lease', { p_owner: a.id, p_instance: randomUUID() }),
      service.rpc('automation_acquire_lease', { p_owner: a.id, p_instance: randomUUID() }),
    ]);
    expect(calls.filter((value) => !value.error)).toHaveLength(1);
    expect(calls.filter((value) => value.error)).toHaveLength(1);
    expect((calls.find((value) => !value.error)?.data as Lease).leaseGeneration).toBe(1);
  });

  test('heartbeat renewal retains the fence and advances heartbeat status', async () => {
    const a = await owner();
    await start(a);
    const instance = randomUUID();
    const lease = await acquire(a, instance);
    const before = await a.client.from('automation_control').select('heartbeat_at').eq('owner_user_id', a.id).single();
    await rpc(service, 'automation_renew_lease', fence(a, lease));
    const after = await a.client.from('automation_control').select('heartbeat_at').eq('owner_user_id', a.id).single();
    expect(new Date(after.data!.heartbeat_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before.data!.heartbeat_at).getTime());
    expect((await acquire(a, instance)).leaseGeneration).toBe(lease.leaseGeneration);
  });

  test('safe lease release invalidates its old token', async () => {
    const a = await owner();
    const run = await start(a);
    const original = await acquire(a);
    await rpc(service, 'automation_release_lease', fence(a, original));
    const replacement = await acquire(a);
    expect(replacement.leaseGeneration).toBe(original.leaseGeneration + 1);
    await denied(service.rpc('automation_claim_job', candidate(a, original, run)));
  });

  test('two concurrent claims establish only one active job', async () => {
    const a = await owner();
    const run = await start(a);
    const lease = await acquire(a);
    const calls = await Promise.all([
      service.rpc('automation_claim_job', candidate(a, lease, run)),
      service.rpc('automation_claim_job', candidate(a, lease, run)),
    ]);
    expect(calls.filter((value) => !value.error)).toHaveLength(1);
    const active = await a.client.from('generation_jobs').select('job_id').eq('state', 'active');
    expect(active.data).toHaveLength(1);
  });

  test('concurrent completion records one counted_at and one daily success', async () => {
    const a = await owner();
    const run = await start(a);
    const lease = await acquire(a);
    const job = await claim(a, lease, run);
    const artifact = await publishing(a, lease, job);
    const args = { ...fence(a, lease), p_job: job.jobId, p_attempt: job.attemptId, p_receipt: receipt(job, artifact) };
    const calls = await Promise.all([
      rpc<Completion>(service, 'automation_complete_publication', args),
      rpc<Completion>(service, 'automation_complete_publication', args),
    ]);
    expect(calls[0].countedAt).toBe(calls[1].countedAt);
    expect(calls.map((item) => item.idempotentReplay).sort()).toEqual([false, true]);
    expect(await count(a, taipeiDay(calls[0].countedAt))).toBe(1);
  });

  test('completed wordId is not claimed again in the same run', async () => {
    const a = await owner();
    const run = await start(a);
    const lease = await acquire(a);
    const job = await claim(a, lease, run);
    await complete(a, lease, job, await publishing(a, lease, job));
    await denied(service.rpc('automation_claim_job', candidate(a, lease, run, job.wordId)));
  });

  test('safe pre-submission retry creates a new attemptId', async () => {
    const a = await owner();
    const run = await start(a);
    const lease = await acquire(a);
    const job = await claim(a, lease, run);
    await rpc(service, 'automation_fail_safe_attempt', {
      ...fence(a, lease), p_attempt: job.attemptId, p_reason: 'NO_EXTERNAL_SUBMISSION',
    });
    const next = await rpc<{ attemptId: string }>(service, 'automation_new_attempt', {
      ...fence(a, lease), p_job: job.jobId,
    });
    expect(next.attemptId).not.toBe(job.attemptId);
    const snapshot = await rpc<{ activeJob: { job_id: string }; attempt: { attempt_id: string; state: string } }>(
      service, 'automation_recovery_snapshot', fence(a, lease));
    expect(snapshot.activeJob.job_id).toBe(job.jobId);
    expect(snapshot.attempt).toMatchObject({ attempt_id: next.attemptId, state: 'created' });
  });

  test('publish retry retains the same attempt, artifact SHA and publishRequestId', async () => {
    const a = await owner();
    const run = await start(a);
    const lease = await acquire(a);
    const job = await claim(a, lease, run);
    const artifact = await publishing(a, lease, job);
    await rpc(service, 'automation_advance_attempt', {
      ...fence(a, lease), p_attempt: job.attemptId, p_next_state: 'publishing',
      p_publish_request_id: artifact.publishRequestId, p_artifact_sha256: artifact.sha,
    });
    await denied(service.rpc('automation_advance_attempt', {
      ...fence(a, lease), p_attempt: job.attemptId, p_next_state: 'publishing',
      p_publish_request_id: randomUUID(),
    }));
    const snapshot = await rpc<{ attempt: { attempt_id: string; artifact_sha256: string;
      publish_request_id: string } }>(service, 'automation_recovery_snapshot', fence(a, lease));
    expect(snapshot.attempt).toMatchObject({
      attempt_id: job.attemptId, artifact_sha256: artifact.sha,
      publish_request_id: artifact.publishRequestId,
    });
  });

  test('concurrent mobile commands serialize; stale START cannot undo STOP', async () => {
    const a = await owner();
    const run = await start(a);
    const pair = await Promise.all([
      a.client.rpc('automation_request_command', {
        p_owner: a.id, p_command_id: randomUUID(), p_expected_seq: 1,
        p_action: 'PAUSE', p_target_run: run.runId,
      }),
      a.secondClient.rpc('automation_request_command', {
        p_owner: a.id, p_command_id: randomUUID(), p_expected_seq: 1,
        p_action: 'STOP', p_target_run: run.runId,
      }),
    ]);
    expect(pair.filter((item) => !item.error)).toHaveLength(1);
    expect(pair.filter((item) => item.error)).toHaveLength(1);
    const winner = pair.find((item) => !item.error)!.data as Run;
    let currentSeq = 2;
    if (winner.runState === 'paused') {
      await rpc(a.client, 'automation_request_command', {
        p_owner: a.id, p_command_id: randomUUID(), p_expected_seq: 2,
        p_action: 'STOP', p_target_run: run.runId,
      });
      currentSeq = 3;
    }
    await denied(a.client.rpc('automation_request_command', {
      p_owner: a.id, p_command_id: randomUUID(), p_expected_seq: 1,
      p_action: 'START', p_target_run: null,
    }));
    await denied(a.client.rpc('automation_request_command', {
      p_owner: a.id, p_command_id: randomUUID(), p_expected_seq: currentSeq,
      p_action: 'START', p_target_run: null,
    }));
  });

  test('latest command replay is idempotent and wrong run is rejected', async () => {
    const a = await owner();
    const run = await start(a);
    const commandId = randomUUID();
    const args = { p_owner: a.id, p_command_id: commandId, p_expected_seq: 1,
      p_action: 'PAUSE', p_target_run: run.runId };
    const first = await rpc<Run>(a.client, 'automation_request_command', args);
    expect(await rpc<Run>(a.client, 'automation_request_command', args)).toEqual(first);
    await denied(a.client.rpc('automation_request_command', {
      ...args, p_command_id: randomUUID(), p_expected_seq: 2, p_target_run: randomUUID(),
    }));
  });

  test('STOP racing with claim cannot allow a claim after STOP linearizes', async () => {
    const a = await owner();
    const run = await start(a);
    const lease = await acquire(a);
    const [stop, next] = await Promise.all([
      a.client.rpc('automation_request_command', {
        p_owner: a.id, p_command_id: randomUUID(), p_expected_seq: 1,
        p_action: 'STOP', p_target_run: run.runId,
      }),
      service.rpc('automation_claim_job', candidate(a, lease, run)),
    ]);
    expect(stop.error).toBeNull();
    const stopState = (stop.data as Run).runState;
    if (stopState === 'stopped') expect(next.error).not.toBeNull();
    else {
      expect(stopState).toBe('stop_requested');
      expect(next.error).toBeNull();
    }
    await denied(service.rpc('automation_claim_job', candidate(a, lease, run)));
  });

  test('expired safe lease is taken over; stale fence cannot mutate recovered A', async () => {
    const a = await owner();
    const run = await start(a);
    const original = await acquire(a);
    const job = await claim(a, original, run);
    await new Promise((resolve) => setTimeout(resolve, 31_100));
    const replacement = await acquire(a);
    expect(replacement.leaseGeneration).toBe(original.leaseGeneration + 1);
    const snapshot = await rpc<{ activeJob: { job_id: string } }>(service, 'automation_recovery_snapshot', fence(a, replacement));
    expect(snapshot.activeJob.job_id).toBe(job.jobId);
    await denied(service.rpc('automation_advance_attempt', {
      ...fence(a, original), p_attempt: job.attemptId, p_next_state: 'prompt_submitted',
    }));
    await denied(service.rpc('automation_complete_publication', {
      ...fence(a, original), p_job: job.jobId, p_attempt: job.attemptId, p_receipt: {},
    }));
    await denied(service.rpc('automation_claim_job', candidate(a, replacement, run)));
  }, 45_000);

  test('expired lease with no active job permits a new claim', async () => {
    const a = await owner();
    const run = await start(a);
    const original = await acquire(a);
    await new Promise((resolve) => setTimeout(resolve, 31_100));
    const replacement = await acquire(a);
    expect(replacement.leaseGeneration).toBe(original.leaseGeneration + 1);
    expect((await claim(a, replacement, run)).status).toBe('CLAIMED');
  }, 45_000);

  test('artifact_verified and publishing attempts survive lease takeover', async () => {
    const a = await owner();
    const run = await start(a);
    const original = await acquire(a);
    const job = await claim(a, original, run);
    const artifact = await publishing(a, original, job);
    await new Promise((resolve) => setTimeout(resolve, 31_100));
    const replacement = await acquire(a);
    const snapshot = await rpc<{ attempt: { state: string; artifact_locator: string; artifact_sha256: string;
      publish_request_id: string } }>(service, 'automation_recovery_snapshot', fence(a, replacement));
    expect(snapshot.attempt).toMatchObject({
      state: 'publishing', artifact_locator: artifact.locator,
      artifact_sha256: artifact.sha, publish_request_id: artifact.publishRequestId,
    });
    await denied(service.rpc('automation_claim_job', candidate(a, replacement, run)));
  }, 45_000);

  test('artifact_verified attempt recovers its relative locator before any new claim', async () => {
    const a = await owner();
    const run = await start(a);
    const original = await acquire(a);
    const job = await claim(a, original, run);
    const artifact = await artifactVerified(a, original, job);
    await new Promise((resolve) => setTimeout(resolve, 31_100));
    const replacement = await acquire(a);
    const snapshot = await rpc<{ attempt: { state: string; artifact_locator: string; artifact_sha256: string } }>(
      service, 'automation_recovery_snapshot', fence(a, replacement));
    expect(snapshot.attempt).toMatchObject({
      state: 'artifact_verified', artifact_locator: artifact.locator, artifact_sha256: artifact.sha,
    });
    await denied(service.rpc('automation_claim_job', candidate(a, replacement, run)));
  }, 45_000);

  test('publication_uncertain A retains the active slot across lease expiry', async () => {
    const a = await owner();
    const run = await start(a);
    const original = await acquire(a);
    const job = await claim(a, original, run);
    await publishing(a, original, job);
    await rpc(service, 'automation_advance_attempt', {
      ...fence(a, original), p_attempt: job.attemptId,
      p_next_state: 'reconciliation_required', p_error_code: 'MANIFEST_UNCERTAIN',
    });
    await new Promise((resolve) => setTimeout(resolve, 31_100));
    const replacement = await acquire(a);
    const snapshot = await rpc<{ activeJob: { state: string; job_id: string } }>(
      service, 'automation_recovery_snapshot', fence(a, replacement));
    expect(snapshot.activeJob).toMatchObject({ state: 'publication_uncertain', job_id: job.jobId });
    await denied(service.rpc('automation_claim_job', candidate(a, replacement, run)));
  }, 45_000);

  test('hard stop leaves A blocking and records the reason', async () => {
    const a = await owner();
    const run = await start(a);
    const lease = await acquire(a);
    const job = await claim(a, lease, run);
    await rpc(service, 'automation_hard_stop', {
      ...fence(a, lease), p_error_code: 'LOGIN_LOST', p_reason: 'staging test',
    });
    const status = await a.client.from('automation_runs').select('state, hard_stop_reason').eq('run_id', run.runId).single();
    expect(status.data).toMatchObject({ state: 'hard_stopped', hard_stop_reason: 'staging test' });
    await new Promise((resolve) => setTimeout(resolve, 31_100));
    const replacement = await acquire(a);
    await denied(service.rpc('automation_claim_job', candidate(a, replacement, run)));
    expect((await rpc<{ activeJob: { job_id: string } }>(service, 'automation_recovery_snapshot', fence(a, replacement)))
      .activeJob.job_id).toBe(job.jobId);
  }, 45_000);

  test('100 verified completions cap claims; replay does not increase the count', async () => {
    const a = await owner();
    const run = await start(a);
    const lease = await acquire(a);
    const dayAtStart = taipeiDay(new Date().toISOString());
    let first: { job: Claim; artifact: { sha: string; publishRequestId: string }; completion: Completion } | undefined;
    for (let index = 0; index < 100; index++) {
      await rpc(service, 'automation_renew_lease', fence(a, lease));
      const job = await claim(a, lease, run);
      const artifact = await publishing(a, lease, job);
      const completion = await complete(a, lease, job, artifact);
      first ??= { job, artifact, completion };
    }
    if (taipeiDay(new Date().toISOString()) !== dayAtStart) throw new Error('MIDNIGHT_DURING_CAP_TEST_RETRY_LATER');
    expect(await count(a, taipeiDay(first!.completion.countedAt))).toBe(100);
    const replay = await complete(a, lease, first!.job, first!.artifact);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.countedAt).toBe(first!.completion.countedAt);
    expect(await count(a, taipeiDay(first!.completion.countedAt))).toBe(100);
    await denied(service.rpc('automation_claim_job', candidate(a, lease, run)));
  }, 180_000);
});
