import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { GeminiAdapterError, type ArtifactDetails, type AttemptMetadata, type GeminiErrorCode } from './types';

export function promptSha256(prompt: string): string {
  return createHash('sha256').update(prompt, 'utf8').digest('hex');
}

function mediaTypeFor(format: string | undefined, extension: string): string {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  if (format === 'gif') return 'image/gif';
  if (format === 'avif') return 'image/avif';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

export async function validateArtifact(artifactPath: string): Promise<Omit<ArtifactDetails, 'artifactPath' | 'relativeArtifactPath' | 'originalFilename' | 'fileExtension'>> {
  try {
    const bytes = await readFile(artifactPath);
    if (bytes.length === 0) throw new Error('File is empty');
    const decoded = await sharp(bytes, { failOn: 'error' }).metadata();
    if (!decoded.width || !decoded.height || !decoded.format) {
      throw new Error('Image metadata is incomplete');
    }
    const extension = extname(artifactPath).toLowerCase();
    return {
      mediaType: mediaTypeFor(decoded.format, extension),
      byteSize: bytes.length,
      width: decoded.width,
      height: decoded.height,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch (error) {
    throw new GeminiAdapterError('ARTIFACT_INVALID', 'Downloaded file is not a decodable non-empty image', error);
  }
}

export function createAttemptMetadata(input: Pick<AttemptMetadata, 'attemptNumber' | 'promptText' | 'submittedAt' | 'result' | 'errorCode'>): AttemptMetadata {
  return {
    ...input,
    promptSha256: promptSha256(input.promptText),
    responseDetectedAt: null,
    imageReadyAt: null,
    downloadStartedAt: null,
    downloadCompletedAt: null,
    relativeArtifactPath: null,
    originalFilename: null,
    fileExtension: null,
    mediaType: null,
    byteSize: null,
    width: null,
    height: null,
    artifactSha256: null,
    conversationUrl: null,
  };
}

export async function writeAttemptMetadata(targetPath: string, metadata: AttemptMetadata): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, targetPath);
}

export function enrichMetadataWithArtifact(
  metadata: AttemptMetadata,
  artifact: ArtifactDetails,
  projectRoot: string,
): AttemptMetadata {
  return {
    ...metadata,
    relativeArtifactPath: relative(resolve(projectRoot), resolve(artifact.artifactPath)).replaceAll('\\', '/'),
    originalFilename: artifact.originalFilename,
    fileExtension: artifact.fileExtension,
    mediaType: artifact.mediaType,
    byteSize: artifact.byteSize,
    width: artifact.width,
    height: artifact.height,
    artifactSha256: artifact.sha256,
  };
}

export function metadataFailure(metadata: AttemptMetadata, code: GeminiErrorCode): AttemptMetadata {
  return { ...metadata, result: 'failure', errorCode: code };
}
