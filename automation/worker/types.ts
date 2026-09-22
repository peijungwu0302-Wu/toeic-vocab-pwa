export type CandidateSnapshot = {
  wordId: string;
  courseId: string;
  headword: string;
  promptText: string;
  promptHash: string;
  datasetHash: string;
};

export type Lease = { token: string; generation: number; activeJobId?: string | null };
export type JobState = 'queued' | 'active' | 'publication_uncertain' | 'blocked' | 'completed' | 'cancelled';
export type AttemptState = 'created' | 'prompt_submitted' | 'response_verified' | 'downloaded' | 'artifact_verified' | 'publishing' | 'publication_verified' | 'failed_safe' | 'reconciliation_required' | 'blocked';

export type JobSnapshot = CandidateSnapshot & { jobId: string; runId: string; state: JobState; activeAttemptId?: string | null };
export type AttemptSnapshot = {
  attemptId: string;
  jobId: string;
  attemptNo: number;
  state: AttemptState;
  responseMarker?: string | null;
  artifactLocator?: string | null;
  artifactSha256?: string | null;
  artifactBytes?: number | null;
  publishRequestId?: string | null;
  publicationReceipt?: PublicationReceipt | null;
};

export type MasterArtifact = {
  path: string;
  mediaType: 'image/jpeg';
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
};

export type DeliveryArtifact = {
  path: string;
  mediaType: 'image/webp';
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
};

export type GeminiGeneration = { responseMarker: string; master: MasterArtifact; conversationUrl?: string };

export type PublicationReceipt = {
  success: boolean;
  verifiedAtCommit: boolean;
  activeAtVerification: boolean;
  verifiedAt: string;
  publishRequestId: string;
  wordId: string;
  version: number;
  imageKey: string;
  sha256: string;
  ledgerCommitted: boolean;
  manifestCommitted: boolean;
  publication: { objectStored: boolean; ledgerCommitted: boolean; manifestCommitted: boolean; verified: boolean };
};

export interface WorkerControlPlane {
  acquireLease(ownerId: string, workerInstanceId: string): Promise<Lease>;
  recover(lease: Lease): Promise<{ job: JobSnapshot | null; attempt: AttemptSnapshot | null }>;
  claimJob(lease: Lease, runId: string, candidate: CandidateSnapshot): Promise<{ job: JobSnapshot; attempt: AttemptSnapshot }>;
  advanceAttempt(lease: Lease, attemptId: string, nextState: AttemptState, input?: {
    responseMarker?: string;
    artifactLocator?: string;
    artifactSha256?: string;
    artifactBytes?: number;
    publishRequestId?: string;
    errorCode?: string;
  }): Promise<void>;
  completePublication(lease: Lease, jobId: string, attemptId: string, receipt: PublicationReceipt): Promise<{ countedAt: string }>;
  hardStop(lease: Lease, errorCode: string, reason: string): Promise<void>;
  finishRun?(lease: Lease, runId: string): Promise<void>;
}

export interface GeminiMasterSource { generate(promptText: string, attemptNumber: number, expectedPromptHash?: string): Promise<GeminiGeneration>; }
export interface ManifestReader { hasImage(wordId: string): Promise<boolean>; }
export interface DeliveryEncoder {
  derive(master: MasterArtifact, outputPath: string): Promise<DeliveryArtifact>;
  load?(path: string, expectedSha256?: string): Promise<DeliveryArtifact>;
}
export interface PublisherClient { publish(input: { wordId: string; promptHash: string; publishRequestId: string; artifact: DeliveryArtifact }): Promise<PublicationReceipt>; }
