/** Deterministic dry-run of the Phase 1B RPC contract. No network or image authority. */
import { createHash } from 'node:crypto';
export type Candidate = {
  wordId: string; courseId: string; headword: string; promptText: string; promptHash: string; datasetHash: string;
};
export type VerifiedReceipt = {
  success: boolean; ledgerCommitted: boolean; manifestCommitted: boolean;
  verifiedAtCommit: boolean; activeAtVerification: boolean; verifiedAt: string;
  wordId: string; version: number; imageKey: string; sha256: string; publishRequestId: string;
  publication: { objectStored: boolean; ledgerCommitted: boolean; manifestCommitted: boolean; verified: boolean };
};
type Action = 'START' | 'PAUSE' | 'STOP';
type RunState = 'requested' | 'running' | 'pause_requested' | 'paused' | 'stop_requested' | 'stopped' | 'hard_stopped' | 'capped' | 'finished';
type JobState = 'queued' | 'active' | 'publication_uncertain' | 'blocked' | 'completed' | 'cancelled';
type AttemptState = 'created' | 'prompt_submitted' | 'response_verified' | 'downloaded' | 'artifact_verified' | 'publishing' | 'publication_verified' | 'failed_safe' | 'reconciliation_required' | 'blocked';
type Lease = { ownerId: string; instanceId: string; token: string; generation: number; expiresAt: number };
type Run = { runId: string; ownerId: string; date: string; state: RunState; lastErrorCode?: string; hardStopReason?: string };
type Job = Candidate & { jobId: string; runId: string; ownerId: string; state: JobState; attemptId: string; countedAt?: string };
type Attempt = { attemptId: string; jobId: string; attemptNo: number; state: AttemptState; responseMarker?: string;
  artifactLocator?: string; artifactSha256?: string; byteSize?: number; publishRequestId?: string; receipt?: VerifiedReceipt };
type Control = { ownerId: string; commandSeq: number; lastCommandId?: string; lastCommandAction?: Action;
  lastCommandTargetRunId?: string; lastCommandResult?: CommandResult; runId?: string; activeJobId?: string;
  lease?: Lease; leaseGeneration: number };
type CommandResult = { commandSeq: number; runId: string; runState: RunState };

function taipeiDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}

export class FakeAutomationPlane {
  private controls = new Map<string, Control>();
  private runs = new Map<string, Run>();
  private jobs = new Map<string, Job>();
  private attempts = new Map<string, Attempt>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  bootstrap(ownerId: string): void {
    if (this.controls.has(ownerId)) throw new Error('OWNER_EXISTS');
    this.controls.set(ownerId, { ownerId, commandSeq: 0, leaseGeneration: 0 });
  }

  private control(ownerId: string): Control {
    const control = this.controls.get(ownerId);
    if (!control) throw new Error('OWNER_NOT_BOOTSTRAPPED');
    return control;
  }

  private assertOwner(actorId: string, ownerId: string): void {
    if (actorId !== ownerId) throw new Error('OWNER_MISMATCH');
  }

  read(actorId: string, ownerId: string) {
    this.assertOwner(actorId, ownerId);
    const control = this.control(ownerId);
    const run = control.runId ? this.runs.get(control.runId) : undefined;
    return { commandSeq: control.commandSeq, runId: control.runId, activeJobId: control.activeJobId,
      runState: run?.state, lastErrorCode: run?.lastErrorCode, hardStopReason: run?.hardStopReason };
  }

  command(actorId: string, ownerId: string, commandId: string, expectedSeq: number, action: Action, targetRunId?: string): CommandResult {
    this.assertOwner(actorId, ownerId);
    const control = this.control(ownerId);
    if (action === 'START' && targetRunId !== undefined) throw new Error('INVALID_COMMAND');
    if (control.lastCommandId === commandId) {
      if (control.lastCommandAction !== action || control.lastCommandTargetRunId !== targetRunId) throw new Error('COMMAND_ID_REUSED');
      return { ...control.lastCommandResult! };
    }
    if (expectedSeq !== control.commandSeq) throw new Error('STALE_COMMAND');
    let run: Run;
    if (action === 'START') {
      if (control.activeJobId && control.runId && this.runs.get(control.runId)?.date !== taipeiDate(this.now())) throw new Error('ACTIVE_JOB_EXISTS');
      const today = taipeiDate(this.now());
      run = [...this.runs.values()].find((r) => r.ownerId === ownerId && r.date === today) ?? {
        runId: crypto.randomUUID(), ownerId, date: today, state: 'requested',
      };
      if (['stopped', 'hard_stopped', 'capped', 'finished', 'stop_requested'].includes(run.state)) throw new Error('RUN_TERMINAL');
      run.state = 'running';
      this.runs.set(run.runId, run);
      control.runId = run.runId;
    } else {
      if (!targetRunId || control.runId !== targetRunId) throw new Error('WRONG_RUN');
      run = this.runs.get(targetRunId)!;
      if (action === 'PAUSE') {
        if (!['running', 'pause_requested', 'paused'].includes(run.state)) throw new Error('RUN_TERMINAL');
        run.state = control.activeJobId ? 'pause_requested' : 'paused';
      } else {
        if (['stopped', 'hard_stopped', 'capped', 'finished'].includes(run.state)) throw new Error('RUN_TERMINAL');
        run.state = control.activeJobId ? 'stop_requested' : 'stopped';
      }
    }
    control.commandSeq++;
    control.lastCommandId = commandId;
    control.lastCommandAction = action;
    control.lastCommandTargetRunId = targetRunId;
    control.lastCommandResult = { commandSeq: control.commandSeq, runId: run.runId, runState: run.state };
    return { ...control.lastCommandResult };
  }

  acquireLease(ownerId: string, instanceId: string, ttlMs = 30_000): Lease {
    const control = this.control(ownerId);
    const existing = control.lease;
    if (existing && existing.expiresAt > this.now().getTime()) {
      if (existing.instanceId !== instanceId) throw new Error('LEASE_HELD');
      return { ...existing };
    }
    control.leaseGeneration++;
    control.lease = { ownerId, instanceId, token: crypto.randomUUID(), generation: control.leaseGeneration, expiresAt: this.now().getTime() + ttlMs };
    return { ...control.lease };
  }

  private fence(ownerId: string, lease: Lease): Control {
    const control = this.control(ownerId);
    if (!control.lease || control.lease.token !== lease.token || control.lease.generation !== lease.generation || control.lease.expiresAt <= this.now().getTime()) {
      throw new Error('STALE_LEASE');
    }
    return control;
  }

  renewLease(ownerId: string, lease: Lease, ttlMs = 30_000): Lease {
    const control = this.fence(ownerId, lease);
    control.lease!.expiresAt = this.now().getTime() + ttlMs;
    return { ...control.lease! };
  }

  releaseLease(ownerId: string, lease: Lease): void {
    const control = this.fence(ownerId, lease);
    if (control.activeJobId) throw new Error('ACTIVE_JOB_EXISTS');
    control.lease = undefined;
  }

  finishRun(ownerId: string, lease: Lease, runId: string): void {
    const control = this.fence(ownerId, lease);
    const run = this.runs.get(runId);
    if (control.activeJobId || control.runId !== runId || !run || run.ownerId !== ownerId || run.state !== 'running') {
      throw new Error('RUN_NOT_FINISHABLE');
    }
    run.state = 'finished';
  }

  claim(ownerId: string, lease: Lease, runId: string, input: Candidate) {
    const control = this.fence(ownerId, lease);
    if (control.activeJobId) throw new Error('ACTIVE_JOB_EXISTS');
    const run = this.runs.get(runId);
    if (!run || run.ownerId !== ownerId || control.runId !== runId || run.state !== 'running' || run.date !== taipeiDate(this.now())) throw new Error('RUN_NOT_CLAIMABLE');
    if (this.dailyCount(ownerId) >= 100) {
      run.state = 'capped';
      throw new Error('DAILY_CAP');
    }
    if ([...this.jobs.values()].some((j) => j.runId === runId && j.wordId === input.wordId)) throw new Error('DUPLICATE_WORD');
    if (!/^tw_[wp]_[a-f0-9]{12}$/.test(input.wordId) || !input.promptText ||
      input.promptHash !== createHash('sha256').update(input.promptText, 'utf8').digest('hex')) throw new Error('INVALID_CANDIDATE');
    const jobId = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    this.jobs.set(jobId, { ...input, jobId, attemptId, runId, ownerId, state: 'active' });
    this.attempts.set(attemptId, { attemptId, jobId, attemptNo: 1, state: 'created' });
    control.activeJobId = jobId;
    return { jobId, attemptId, wordId: input.wordId };
  }

  job(jobId: string): Job {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('JOB_NOT_FOUND');
    return { ...job };
  }

  attempt(attemptId: string): Attempt {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) throw new Error('ATTEMPT_NOT_FOUND');
    return { ...attempt };
  }

  private activeAttempt(ownerId: string, lease: Lease, attemptId: string): { control: Control; job: Job; attempt: Attempt } {
    const control = this.fence(ownerId, lease);
    const attempt = this.attempts.get(attemptId);
    const job = attempt && this.jobs.get(attempt.jobId);
    if (!attempt || !job || job.ownerId !== ownerId || control.activeJobId !== job.jobId || job.attemptId !== attemptId || job.state !== 'active') throw new Error('ATTEMPT_NOT_ACTIVE');
    return { control, job, attempt };
  }

  advance(ownerId: string, lease: Lease, attemptId: string, next: AttemptState, responseMarker?: string): void {
    const { attempt } = this.activeAttempt(ownerId, lease, attemptId);
    const allowed: Record<string, string> = {
      created: 'prompt_submitted', prompt_submitted: 'response_verified', response_verified: 'downloaded',
    };
    if (allowed[attempt.state] !== next) throw new Error('INVALID_ATTEMPT_TRANSITION');
    if (next === 'response_verified') {
      if (!responseMarker) throw new Error('RESPONSE_MARKER_REQUIRED');
      attempt.responseMarker = responseMarker;
    }
    attempt.state = next;
  }

  recordArtifact(ownerId: string, lease: Lease, attemptId: string, sha256: string, byteSize: number): string {
    const { job, attempt } = this.activeAttempt(ownerId, lease, attemptId);
    if (attempt.state !== 'downloaded' || !/^[a-f0-9]{64}$/.test(sha256) || byteSize <= 0) throw new Error('INVALID_ARTIFACT');
    attempt.artifactLocator = `artifacts/${job.jobId}/${attemptId}.webp`;
    attempt.artifactSha256 = sha256;
    attempt.byteSize = byteSize;
    attempt.state = 'artifact_verified';
    return attempt.artifactLocator;
  }

  beginPublish(ownerId: string, lease: Lease, attemptId: string, publishRequestId: string): Attempt {
    const { attempt } = this.activeAttempt(ownerId, lease, attemptId);
    if (attempt.state === 'publishing') {
      if (attempt.publishRequestId !== publishRequestId) throw new Error('ARTIFACT_IDENTITY_CHANGED');
      return { ...attempt };
    }
    if (attempt.state !== 'artifact_verified') throw new Error('INVALID_ATTEMPT_TRANSITION');
    attempt.publishRequestId = publishRequestId;
    attempt.state = 'publishing';
    return { ...attempt };
  }

  publishInFlight(ownerId: string, lease: Lease, attemptId: string): void {
    const { attempt } = this.activeAttempt(ownerId, lease, attemptId);
    if (attempt.state !== 'publishing') throw new Error('INVALID_ATTEMPT_TRANSITION');
  }

  failSafe(ownerId: string, lease: Lease, attemptId: string, reason: string): void {
    const { attempt } = this.activeAttempt(ownerId, lease, attemptId);
    if (attempt.state !== 'created' || !reason) throw new Error('UNSAFE_FRESH_GENERATION');
    attempt.state = 'failed_safe';
  }

  newAttempt(ownerId: string, lease: Lease, jobId: string): { attemptId: string } {
    const control = this.fence(ownerId, lease);
    const job = this.jobs.get(jobId);
    if (!job || job.ownerId !== ownerId || control.activeJobId !== jobId || job.state !== 'active') throw new Error('ATTEMPT_NOT_ACTIVE');
    const previous = this.attempts.get(job.attemptId)!;
    if (previous.state !== 'failed_safe') throw new Error('UNSAFE_FRESH_GENERATION');
    const attemptId = crypto.randomUUID();
    this.attempts.set(attemptId, { attemptId, jobId, attemptNo: previous.attemptNo + 1, state: 'created' });
    job.attemptId = attemptId;
    return { attemptId };
  }

  reconciliationRequired(ownerId: string, lease: Lease, attemptId: string, reason: string): void {
    const { control, job, attempt } = this.activeAttempt(ownerId, lease, attemptId);
    if (attempt.state !== 'publishing' || !reason) throw new Error('INVALID_ATTEMPT_TRANSITION');
    attempt.state = 'reconciliation_required';
    job.state = 'publication_uncertain';
    const run = this.runs.get(control.runId!)!;
    run.state = 'hard_stopped';
    run.lastErrorCode = reason;
    run.hardStopReason = 'Publication requires reconciliation';
  }

  hardStop(ownerId: string, lease: Lease, errorCode: string, reason: string): void {
    const control = this.fence(ownerId, lease);
    if (!errorCode || !reason) throw new Error('ERROR_REASON_REQUIRED');
    if (control.activeJobId) {
      const job = this.jobs.get(control.activeJobId)!;
      const attempt = this.attempts.get(job.attemptId)!;
      const uncertain = job.state === 'publication_uncertain' || ['publishing', 'reconciliation_required'].includes(attempt.state);
      job.state = uncertain ? 'publication_uncertain' : 'blocked';
      attempt.state = uncertain ? 'reconciliation_required' : 'blocked';
    }
    if (control.runId) {
      const run = this.runs.get(control.runId)!;
      run.state = 'hard_stopped';
      run.lastErrorCode = errorCode;
      run.hardStopReason = reason;
    }
  }

  complete(ownerId: string, lease: Lease, jobId: string, attemptId: string, receipt: VerifiedReceipt): { countedAt: string } {
    const control = this.fence(ownerId, lease);
    const job = this.jobs.get(jobId);
    const attempt = this.attempts.get(attemptId);
    if (!job || !attempt || attempt.jobId !== jobId || job.ownerId !== ownerId || job.attemptId !== attemptId) throw new Error('WRONG_JOB');
    if (!this.validReceipt(job, attempt, receipt)) throw new Error('RECEIPT_MISMATCH');
    if (job.state === 'completed') {
      if (JSON.stringify(attempt.receipt) !== JSON.stringify(receipt)) throw new Error('RECEIPT_MISMATCH');
      return { countedAt: job.countedAt! };
    }
    if (control.activeJobId !== jobId || job.state !== 'active' || attempt.state !== 'publishing') throw new Error('ATTEMPT_NOT_ACTIVE');
    attempt.state = 'publication_verified';
    attempt.receipt = structuredClone(receipt);
    job.state = 'completed';
    job.countedAt = this.now().toISOString();
    control.activeJobId = undefined;
    const run = this.runs.get(job.runId)!;
    if (run.state === 'pause_requested') run.state = 'paused';
    if (run.state === 'stop_requested') run.state = 'stopped';
    if (run.state === 'running' && this.dailyCount(ownerId) >= 100) run.state = 'capped';
    return { countedAt: job.countedAt };
  }

  private validReceipt(job: Job, attempt: Attempt, value: VerifiedReceipt): boolean {
    return value.success === true && value.ledgerCommitted === true && value.manifestCommitted === true &&
      value.verifiedAtCommit === true && value.activeAtVerification === true &&
      !Number.isNaN(Date.parse(value.verifiedAt)) && Number.isInteger(value.version) && value.version > 0 &&
      value.wordId === job.wordId && value.sha256 === attempt.artifactSha256 &&
      value.publishRequestId === attempt.publishRequestId &&
      value.imageKey === `words/${job.wordId}/v${value.version}.webp` &&
      value.publication.objectStored === true && value.publication.ledgerCommitted === true &&
      value.publication.manifestCommitted === true && value.publication.verified === true;
  }

  recover(ownerId: string, lease: Lease): { job?: Job; attempt?: Attempt } {
    const control = this.fence(ownerId, lease);
    if (!control.activeJobId) return {};
    const job = this.jobs.get(control.activeJobId)!;
    return { job: { ...job }, attempt: { ...this.attempts.get(job.attemptId)! } };
  }

  dailyCount(ownerId: string, date = taipeiDate(this.now())): number {
    return [...this.jobs.values()].filter((job) => job.ownerId === ownerId && job.state === 'completed' && job.countedAt && taipeiDate(new Date(job.countedAt)) === date).length;
  }
}

export class FakeWorker {
  private lease?: Lease;
  constructor(private readonly plane: FakeAutomationPlane, private readonly ownerId: string,
    private readonly scope: Candidate[], private readonly manifestWordIds: Set<string>,
    private readonly outcome: 'verified' | 'reconciliation_required' = 'verified') {}

  acquire(): void { this.lease = this.plane.acquireLease(this.ownerId, 'fake-worker'); }

  runOne(runId: string): { wordId: string } | null {
    if (!this.lease) throw new Error('LEASE_REQUIRED');
    const input = this.scope.find((item) => !this.manifestWordIds.has(item.wordId));
    if (!input) {
      this.plane.finishRun(this.ownerId, this.lease, runId);
      return null;
    }
    const job = this.plane.claim(this.ownerId, this.lease, runId, input);
    this.plane.advance(this.ownerId, this.lease, job.attemptId, 'prompt_submitted');
    this.plane.advance(this.ownerId, this.lease, job.attemptId, 'response_verified', `fake-response-${job.attemptId}`);
    this.plane.advance(this.ownerId, this.lease, job.attemptId, 'downloaded');
    const fakeBytes = Buffer.from(`FAKE-WEBP:${job.jobId}:${job.attemptId}`, 'utf8');
    const sha256 = createHash('sha256').update(fakeBytes).digest('hex');
    this.plane.recordArtifact(this.ownerId, this.lease, job.attemptId, sha256, fakeBytes.byteLength);
    const publishRequestId = crypto.randomUUID();
    this.plane.beginPublish(this.ownerId, this.lease, job.attemptId, publishRequestId);
    if (this.outcome === 'reconciliation_required') {
      this.plane.reconciliationRequired(this.ownerId, this.lease, job.attemptId, 'MANIFEST_COMMIT_FAILED');
      throw new Error('RECONCILIATION_REQUIRED');
    }
    this.plane.complete(this.ownerId, this.lease, job.jobId, job.attemptId, {
      success: true, ledgerCommitted: true, manifestCommitted: true,
      verifiedAtCommit: true, activeAtVerification: true, verifiedAt: new Date().toISOString(),
      wordId: job.wordId, version: 1, imageKey: `words/${job.wordId}/v1.webp`, sha256, publishRequestId,
      publication: { objectStored: true, ledgerCommitted: true, manifestCommitted: true, verified: true },
    });
    this.manifestWordIds.add(job.wordId);
    return { wordId: job.wordId };
  }
}
