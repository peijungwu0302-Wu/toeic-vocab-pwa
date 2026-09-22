import { createHash } from 'node:crypto';
import { mkdir, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';
import type { DeliveryArtifact, DeliveryEncoder, MasterArtifact } from './types';

/** Matches the existing generator: WebP quality 85, effort/method 6, no resize. */
export const sharpDeliveryEncoder: DeliveryEncoder = {
  async derive(master: MasterArtifact, outputPath: string): Promise<DeliveryArtifact> {
    await mkdir(dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.tmp`;
    await sharp(master.path, { failOn: 'error' }).webp({ quality: 85, effort: 6 }).toFile(temporaryPath);
    await rename(temporaryPath, outputPath);
    const bytes = await readFile(outputPath);
    const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
    if (!metadata.width || !metadata.height || metadata.format !== 'webp' || bytes.length === 0) {
      throw new Error('DELIVERY_ARTIFACT_INVALID');
    }
    return {
      path: outputPath,
      mediaType: 'image/webp',
      byteSize: bytes.length,
      width: metadata.width,
      height: metadata.height,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  },
  async load(path: string, expectedSha256?: string): Promise<DeliveryArtifact> {
    const bytes = await readFile(path);
    const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (!metadata.width || !metadata.height || metadata.format !== 'webp' || bytes.length === 0 || (expectedSha256 && expectedSha256 !== sha256)) {
      throw new Error('DELIVERY_ARTIFACT_IDENTITY_MISMATCH');
    }
    return { path, mediaType: 'image/webp', byteSize: bytes.length, width: metadata.width, height: metadata.height, sha256 };
  },
};
