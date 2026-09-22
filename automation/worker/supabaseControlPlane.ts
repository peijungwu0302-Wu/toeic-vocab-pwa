import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttemptSnapshot, CandidateSnapshot, JobSnapshot, Lease, PublicationReceipt, WorkerControlPlane } from './types';

type RpcClient = SupabaseClient;

export const REQUIRED_WORKER_RPCS = [
  'automation_acquire_lease',
  'automation_recovery_snapshot',
  'automation_claim_job',
  'automation_advance_attempt',
  'automation_complete_publication',
  'automation_hard_stop',
  'automation_finish_run',
] as const;

export class SupabaseAutomationControlPlane implements WorkerControlPlane {
  constructor(private readonly client: RpcClient, private readonly ownerId: string) {}

  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await this.client.rpc(name, args);
    if (result.error) throw new Error(`${name}:${result.error.message}`);
    return result.data as T;
  }

  async acquireLease(ownerId: string, workerInstanceId: string): Promise<Lease> {
    const value = await this.rpc<{ leaseToken: string; leaseGeneration: number; activeJobId?: string | null }>('automation_acquire_lease', {
      p_owner: ownerId, p_instance: workerInstanceId,
    });
    return { token: value.leaseToken, generation: Number(value.leaseGeneration), activeJobId: value.activeJobId ?? null };
  }

  async recover(lease: Lease): Promise<{ job: JobSnapshot | null; attempt: AttemptSnapshot | null }> {
    const value = await this.rpc<{ activeJob: JobSnapshot | null; attempt: AttemptSnapshot | null }>('automation_recovery_snapshot', {
      p_owner: this.ownerId, p_token: lease.token, p_generation: lease.generation,
    });
    return { job: value.activeJob ?? null, attempt: value.attempt ?? null };
  }

  async claimJob(lease: Lease, runId: string, candidate: CandidateSnapshot): Promise<{ job: JobSnapshot; attempt: AttemptSnapshot }> {
    const ownerId = this.ownerId;
    const value = await this.rpc<{ status: string; jobId: string; attemptId: string; wordId: string }>('automation_claim_job', {
      p_owner: ownerId, p_token: lease.token, p_generation: lease.generation, p_run: runId,
      p_word_id: candidate.wordId, p_course_id: candidate.courseId, p_headword: candidate.headword,
      p_prompt_text: candidate.promptText, p_prompt_hash: candidate.promptHash, p_dataset_hash: candidate.datasetHash,
    });
    if (value.status === 'DAILY_CAP') throw new Error('DAILY_CAP');
    const job: JobSnapshot = { ...candidate, jobId: value.jobId, runId, state: 'active', activeAttemptId: value.attemptId };
    const attempt: AttemptSnapshot = { attemptId: value.attemptId, jobId: value.jobId, attemptNo: 1, state: 'created' };
    return { job, attempt };
  }

  async advanceAttempt(lease: Lease, attemptId: string, nextState: AttemptSnapshot['state'], input: {
    responseMarker?: string; artifactLocator?: string; artifactSha256?: string; artifactBytes?: number;
    publishRequestId?: string; errorCode?: string;
  } = {}): Promise<void> {
    await this.rpc('automation_advance_attempt', {
      p_owner: this.ownerId, p_token: lease.token, p_generation: lease.generation,
      p_attempt: attemptId, p_next_state: nextState, p_response_marker: input.responseMarker ?? null,
      p_artifact_locator: input.artifactLocator ?? null, p_artifact_sha256: input.artifactSha256 ?? null,
      p_artifact_bytes: input.artifactBytes ?? null, p_publish_request_id: input.publishRequestId ?? null,
      p_error_code: input.errorCode ?? null,
    });
  }

  async completePublication(lease: Lease, jobId: string, attemptId: string, receipt: PublicationReceipt): Promise<{ countedAt: string }> {
    return this.rpc<{ countedAt: string }>('automation_complete_publication', {
      p_owner: this.ownerId, p_token: lease.token, p_generation: lease.generation,
      p_job: jobId, p_attempt: attemptId, p_receipt: receipt,
    });
  }

  async hardStop(lease: Lease, errorCode: string, reason: string): Promise<void> {
    await this.rpc('automation_hard_stop', {
      p_owner: this.ownerId, p_token: lease.token, p_generation: lease.generation,
      p_error_code: errorCode, p_reason: reason,
    });
  }

  async finishRun(lease: Lease, runId: string): Promise<void> {
    await this.rpc('automation_finish_run', {
      p_owner: this.ownerId, p_token: lease.token, p_generation: lease.generation, p_run: runId,
    });
  }

}
