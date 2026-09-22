import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promptSha256 } from '../gemini/artifact';
import type { AttemptSnapshot, CandidateSnapshot, DeliveryArtifact, GeminiMasterSource, JobSnapshot, Lease, ManifestReader, PublicationReceipt, PublisherClient, WorkerControlPlane, DeliveryEncoder } from './types';

export type WorkerDependencies = {
  ownerId: string;
  workerInstanceId?: string;
  runId: string;
  candidate: CandidateSnapshot;
  artifactRoot: string;
  control: WorkerControlPlane;
  gemini: GeminiMasterSource;
  publisher: PublisherClient;
  manifest: ManifestReader;
  webp: DeliveryEncoder;
  testCalls?: string[];
};

export type SingleJobResult =
  | { status: 'completed'; jobId: string; attemptId: string; publishRequestId: string; receipt: PublicationReceipt }
  | { status: 'already_published' }
  | { status: 'publication_uncertain'; jobId: string; attemptId: string; publishRequestId?: string };

function assertPrompt(candidate: CandidateSnapshot): void {
  if (promptSha256(candidate.promptText) !== candidate.promptHash) throw new Error('PROMPT_HASH_MISMATCH');
}

function assertReceipt(receipt: PublicationReceipt, job: JobSnapshot, delivery: DeliveryArtifact, publishRequestId: string): void {
  if (!receipt.success || !receipt.verifiedAtCommit || !receipt.activeAtVerification ||
      receipt.wordId !== job.wordId || receipt.sha256 !== delivery.sha256 ||
      receipt.publishRequestId !== publishRequestId || !receipt.ledgerCommitted || !receipt.manifestCommitted ||
      !receipt.publication.objectStored || !receipt.publication.ledgerCommitted ||
      !receipt.publication.manifestCommitted || !receipt.publication.verified ||
      receipt.imageKey !== `words/${job.wordId}/v${receipt.version}.webp`) {
    throw new Error('PUBLICATION_RECEIPT_MISMATCH');
  }
}

async function handleGenerationFailure(control: WorkerControlPlane, lease: Lease, error: unknown): Promise<never> {
  const code = error instanceof Error && 'code' in error ? String((error as Error & { code?: unknown }).code) : 'GEMINI_GENERATION_FAILED';
  await control.hardStop(lease, code, error instanceof Error ? error.message : String(error));
  throw error;
}

export async function runSingleJob(input: WorkerDependencies): Promise<SingleJobResult> {
  const lease = await input.control.acquireLease(input.ownerId, input.workerInstanceId ?? `phase2b-${randomUUID()}`);
  let job: JobSnapshot;
  let attempt: AttemptSnapshot;
  const recovery = await input.control.recover(lease);
  if (recovery.job && recovery.attempt) {
    job = recovery.job;
    attempt = recovery.attempt;
  } else {
    if (await input.manifest.hasImage(input.candidate.wordId)) {
      if (input.control.finishRun) await input.control.finishRun(lease, input.runId);
      return { status: 'already_published' };
    }
    try {
      assertPrompt(input.candidate);
    } catch (error) {
      await input.control.hardStop(lease, 'PROMPT_HASH_MISMATCH', 'Immutable candidate prompt hash did not verify');
      throw error;
    }
    const claimed = await input.control.claimJob(lease, input.runId, input.candidate);
    job = claimed.job;
    attempt = claimed.attempt;
  }

  try {
    assertPrompt(job);
  } catch (error) {
    await input.control.hardStop(lease, 'PROMPT_HASH_MISMATCH', 'Claimed immutable prompt hash did not verify');
    throw error;
  }
  if (job.wordId !== input.candidate.wordId && !recovery.job) throw new Error('JOB_IDENTITY_MISMATCH');
  let delivery: DeliveryArtifact | undefined;
  let publishRequestId = attempt.publishRequestId ?? '';

  if (attempt.state === 'publication_verified') {
    if (!attempt.publicationReceipt) throw new Error('PUBLICATION_RECEIPT_MISSING');
    await input.control.completePublication(lease, job.jobId, attempt.attemptId, attempt.publicationReceipt);
    return { status: 'completed', jobId: job.jobId, attemptId: attempt.attemptId, publishRequestId: attempt.publishRequestId ?? attempt.publicationReceipt.publishRequestId, receipt: attempt.publicationReceipt };
  }

  if (attempt.state === 'created') {
    let generation;
    try {
      generation = await input.gemini.generate(job.promptText, attempt.attemptNo, job.promptHash);
    } catch (error) {
      return handleGenerationFailure(input.control, lease, error);
    }
    await input.control.advanceAttempt(lease, attempt.attemptId, 'prompt_submitted');
    await input.control.advanceAttempt(lease, attempt.attemptId, 'response_verified', { responseMarker: generation.responseMarker });
    await input.control.advanceAttempt(lease, attempt.attemptId, 'downloaded');
    const outputPath = join(input.artifactRoot, 'artifacts', job.jobId, `${attempt.attemptId}.webp`);
    try {
      delivery = await input.webp.derive(generation.master, outputPath);
    } catch (error) {
      await input.control.hardStop(lease, 'DELIVERY_ARTIFACT_INVALID', error instanceof Error ? error.message : String(error));
      throw error;
    }
    await input.control.advanceAttempt(lease, attempt.attemptId, 'artifact_verified', {
      artifactLocator: `artifacts/${job.jobId}/${attempt.attemptId}.webp`,
      artifactSha256: delivery.sha256,
      artifactBytes: delivery.byteSize,
    });
  } else if (attempt.state === 'artifact_verified') {
    if (!attempt.artifactLocator || !input.webp.load) throw new Error('RESTART_ARTIFACT_RECONCILIATION_REQUIRED');
    delivery = await input.webp.load(join(input.artifactRoot, attempt.artifactLocator), attempt.artifactSha256 ?? undefined);
  } else if (attempt.state === 'publishing') {
    if (!attempt.publishRequestId) throw new Error('PUBLISH_REQUEST_ID_MISSING');
    publishRequestId = attempt.publishRequestId;
    if (!attempt.artifactLocator || !input.webp.load) throw new Error('RESTART_ARTIFACT_RECONCILIATION_REQUIRED');
    delivery = await input.webp.load(join(input.artifactRoot, attempt.artifactLocator), attempt.artifactSha256 ?? undefined);
  } else if (attempt.state === 'reconciliation_required') {
    return { status: 'publication_uncertain', jobId: job.jobId, attemptId: attempt.attemptId, publishRequestId: attempt.publishRequestId ?? undefined };
  } else {
    throw new Error(`UNSUPPORTED_ATTEMPT_STATE:${attempt.state}`);
  }

  if (!delivery) throw new Error('DELIVERY_ARTIFACT_MISSING');
  publishRequestId ||= randomUUID();
  await input.control.advanceAttempt(lease, attempt.attemptId, 'publishing', { publishRequestId });
  let receipt: PublicationReceipt;
  try {
    receipt = await input.publisher.publish({ wordId: job.wordId, promptHash: job.promptHash, publishRequestId, artifact: delivery });
    assertReceipt(receipt, job, delivery, publishRequestId);
  } catch (error) {
    const uncertain = error instanceof Error && Boolean((error as Error & { uncertain?: boolean }).uncertain);
    await input.control.hardStop(lease, uncertain ? 'PUBLISH_UNCERTAIN' : 'PUBLISH_FAILED', error instanceof Error ? error.message : String(error));
    if (uncertain) return { status: 'publication_uncertain', jobId: job.jobId, attemptId: attempt.attemptId, publishRequestId };
    throw error;
  }
  await input.control.completePublication(lease, job.jobId, attempt.attemptId, receipt);
  return { status: 'completed', jobId: job.jobId, attemptId: attempt.attemptId, publishRequestId, receipt };
}
