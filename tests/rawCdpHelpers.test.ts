import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listStableImageFiles, waitForStableImageFile } from '../automation/experiments/rawCdpHelpers';

describe('raw CDP download helpers', () => {
  it('accepts one stable image and rejects temporary files', async () => {
    const dir = join(process.cwd(), 'tmp-raw-cdp-helper-test');
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'image.jfif'), Buffer.from('bytes'));
    await writeFile(join(dir, 'image.jfif.crdownload'), Buffer.from('partial'));
    expect(await listStableImageFiles(dir)).toHaveLength(1);
    await rm(join(dir, 'image.jfif.crdownload'));
    await expect(waitForStableImageFile(dir, 3_000)).resolves.toBe(join(dir, 'image.jfif'));
    await rm(dir, { recursive: true, force: true });
  });
});
