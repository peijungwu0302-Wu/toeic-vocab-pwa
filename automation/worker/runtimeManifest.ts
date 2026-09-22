import type { ManifestReader } from './types';

export class RuntimeManifestReader implements ManifestReader {
  constructor(private readonly manifestUrl: string) {}

  async hasImage(wordId: string): Promise<boolean> {
    const response = await fetch(this.manifestUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`RUNTIME_MANIFEST_READ_FAILED:${response.status}`);
    const body = await response.json() as { images?: Record<string, unknown> };
    return Boolean(body.images?.[wordId]);
  }
}
