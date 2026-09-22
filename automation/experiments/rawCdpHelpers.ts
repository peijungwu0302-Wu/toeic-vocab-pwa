import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.jfif', '.webp', '.avif']);

export async function listStableImageFiles(downloadDir: string): Promise<string[]> {
  const names = (await readdir(downloadDir)).filter((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()));
  const files: string[] = [];
  for (const name of names) {
    const path = join(downloadDir, name);
    const info = await stat(path);
    if (info.isFile() && info.size > 0) files.push(path);
  }
  return files;
}

export async function waitForStableImageFile(downloadDir: string, timeoutMs = 45_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let previous: { path: string; size: number } | null = null;
  let stableChecks = 0;
  while (Date.now() < deadline) {
    const partial = (await readdir(downloadDir)).some((name) => name.endsWith('.crdownload'));
    const files = await listStableImageFiles(downloadDir);
    if (!partial && files.length === 1) {
      const info = await stat(files[0]);
      if (previous !== null && previous.path === files[0] && previous.size === info.size) stableChecks += 1;
      else stableChecks = 0;
      previous = { path: files[0], size: info.size };
      if (stableChecks >= 2) return files[0];
    } else {
      previous = null;
      stableChecks = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('No single stable image artifact appeared before timeout');
}
