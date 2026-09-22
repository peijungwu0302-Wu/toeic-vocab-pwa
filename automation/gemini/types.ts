export const GEMINI_ERROR_CODES = [
  'GEMINI_NOT_READY',
  'LOGIN_REQUIRED',
  'PROFILE_IN_USE',
  'PROMPT_SUBMIT_FAILED',
  'USER_TURN_NOT_CONFIRMED',
  'RESPONSE_NOT_FOUND',
  'RESPONSE_OWNERSHIP_UNCERTAIN',
  'IMAGE_GENERATION_TIMEOUT',
  'IMAGE_NOT_READY',
  'DOWNLOAD_CONTROL_NOT_FOUND',
  'DOWNLOAD_FAILED',
  'ARTIFACT_INVALID',
  'CAPTCHA_DETECTED',
  'VERIFICATION_REQUIRED',
  'QUOTA_OR_RATE_LIMIT',
  'DOM_UNSUPPORTED',
] as const;

export type GeminiErrorCode = (typeof GEMINI_ERROR_CODES)[number];

export class GeminiAdapterError extends Error {
  constructor(
    public readonly code: GeminiErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'GeminiAdapterError';
  }
}

export interface ArtifactDetails {
  artifactPath: string;
  relativeArtifactPath: string;
  originalFilename: string;
  fileExtension: string;
  mediaType: string;
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
}

export interface AttemptMetadata {
  attemptNumber: number;
  promptText: string;
  promptSha256: string;
  submittedAt: string | null;
  responseDetectedAt: string | null;
  imageReadyAt: string | null;
  downloadStartedAt: string | null;
  downloadCompletedAt: string | null;
  relativeArtifactPath: string | null;
  originalFilename: string | null;
  fileExtension: string | null;
  mediaType: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  artifactSha256: string | null;
  conversationUrl: string | null;
  result: 'success' | 'failure';
  errorCode: GeminiErrorCode | null;
}

export interface BoundResponse {
  userTurnToken: string;
  assistantResponseToken: string;
  responseDetectedAt: string;
}
