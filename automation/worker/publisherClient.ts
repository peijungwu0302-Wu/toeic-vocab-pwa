import { readFile } from 'node:fs/promises';
import type { PublicationReceipt, PublisherClient } from './types';
import type { DeliveryArtifact } from './types';

export class ImagePublisherClient implements PublisherClient {
  constructor(private readonly endpoint: string, private readonly secret?: string) {}

  async publish(input: { wordId: string; promptHash: string; publishRequestId: string; artifact: DeliveryArtifact }): Promise<PublicationReceipt> {
    const bytes = await readFile(input.artifact.path);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'image/webp' }), `${input.wordId}.webp`);
    form.append('metadata', JSON.stringify({
      wordId: input.wordId,
      imageSha256: input.artifact.sha256,
      publishRequestId: input.publishRequestId,
      promptHash: input.promptHash,
      dimensions: { width: input.artifact.width, height: input.artifact.height },
      generator: { provider: 'gemini-web', generatedBy: 'phase2b-worker' },
    }));
    let response: Response;
    try {
      response = await fetch(this.endpoint, { method: 'POST', body: form, headers: this.secret ? { 'X-Studio-Secret': this.secret } : undefined });
    } catch (error) {
      throw Object.assign(new Error(`PUBLISH_UNCERTAIN:${error instanceof Error ? error.message : String(error)}`), { code: 'PUBLISH_UNCERTAIN', uncertain: true });
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success !== true) {
      const code = String(body.code ?? `HTTP_${response.status}`);
      const uncertain = response.status >= 500 || code === 'PUBLISH_IN_FLIGHT' || body.reconciliationRequired === true;
      throw Object.assign(new Error(`${code}:${String(body.error ?? 'publication failed')}`), { code, uncertain });
    }
    return body as PublicationReceipt;
  }
}
