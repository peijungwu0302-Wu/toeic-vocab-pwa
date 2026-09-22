import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GeminiWebAdapter } from '../gemini/GeminiWebAdapter';
import { promptSha256, validateArtifact } from '../gemini/artifact';
import { GeminiAdapterError, type BoundResponse } from '../gemini/types';
import type { GeminiGeneration, GeminiMasterSource } from './types';

type Json = Record<string, unknown>;
type Target = { id: string; type: string; url: string; webSocketDebuggerUrl?: string };

class RawCdp {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: Json) => void; reject: (error: Error) => void }>();
  private readonly listeners = new Set<(method: string, params: Json) => void>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Json;
      const id = message.id;
      if (typeof id === 'number') {
        const request = this.pending.get(id);
        if (!request) return;
        this.pending.delete(id);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message);
        return;
      }
      if (typeof message.method === 'string') {
        const params = (message.params as Json | undefined) ?? {};
        for (const listener of this.listeners) listener(message.method, params);
      }
    });
  }

  static async connect(url: string): Promise<RawCdp> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('CDP websocket connection failed')), { once: true });
    });
    return new RawCdp(socket);
  }

  onEvent(listener: (method: string, params: Json) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(method: string, params: Json = {}): Promise<Json> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void { this.socket.close(); }
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json() as Promise<T>;
}

function header(headers: Json[], name: string): string {
  const item = headers.find((entry) => String(entry.name ?? '').toLowerCase() === name);
  return String(item?.value ?? '');
}

function isTargetImage(params: Json, clickedAt: number, eventAt: number): boolean {
  const request = (params.request as Json | undefined) ?? {};
  let url: URL;
  try { url = new URL(String(request.url ?? '')); } catch { return false; }
  const headers = Array.isArray(params.responseHeaders) ? params.responseHeaders as Json[] : [];
  const mime = header(headers, 'content-type').split(';', 1)[0].trim().toLowerCase();
  const status = Number(params.responseStatusCode ?? 0);
  return clickedAt > 0 && eventAt >= clickedAt && status >= 200 && status < 300 &&
    (url.hostname === 'lh3.googleusercontent.com' || url.hostname === 'lh3.google.com') &&
    url.pathname.startsWith('/rd-gg/') && mime === 'image/jpeg';
}

async function continueResponse(cdp: RawCdp, requestId: string): Promise<void> {
  try { await cdp.send('Fetch.continueResponse', { requestId }); }
  catch { await cdp.send('Fetch.continueRequest', { requestId }); }
}

export type GeminiMasterSourceOptions = {
  profileDirectory: string;
  cdpEndpoint?: string;
  artifactRoot: string;
  generationTimeoutMs?: number;
  captureTimeoutMs?: number;
};

export function verifyGeminiPromptSnapshot(promptText: string, expectedPromptHash: string): void {
  if (!promptText || promptSha256(promptText) !== expectedPromptHash) {
    throw new GeminiAdapterError('PROMPT_SUBMIT_FAILED', 'Prompt hash did not match the immutable job snapshot');
  }
}

export class GeminiWebMasterSource implements GeminiMasterSource {
  private readonly adapter: GeminiWebAdapter;
  private pageCdp: RawCdp | null = null;
  private initialized = false;

  constructor(private readonly options: GeminiMasterSourceOptions) {
    this.adapter = new GeminiWebAdapter({
      profileDirectory: options.profileDirectory,
      generationTimeoutMs: options.generationTimeoutMs ?? 180_000,
    });
  }

  async open(cleanChat = true): Promise<void> {
    const endpoint = this.options.cdpEndpoint ?? 'http://127.0.0.1:9664';
    const targets = await json<Target[]>(`${endpoint}/json/list`);
    const target = targets.find((item) => item.type === 'page' && /gemini\.google\.com\/app/.test(item.url));
    if (!target?.webSocketDebuggerUrl) throw new GeminiAdapterError('GEMINI_NOT_READY', 'Existing Gemini page target was not found');
    this.pageCdp = await RawCdp.connect(target.webSocketDebuggerUrl);
    await this.adapter.openOverCDP(endpoint);
    await this.adapter.ensureReady();
    if (cleanChat) await this.adapter.newChat();
    this.initialized = true;
  }

  async generate(promptText: string, attemptNumber: number, expectedPromptHash?: string): Promise<GeminiGeneration> {
    if (!this.initialized || !this.pageCdp) throw new GeminiAdapterError('GEMINI_NOT_READY', 'Gemini master source is not open');
    if (!expectedPromptHash) throw new GeminiAdapterError('PROMPT_SUBMIT_FAILED', 'Prompt hash is required for a live job');
    verifyGeminiPromptSnapshot(promptText, expectedPromptHash);
    const bound = await this.adapter.submitPrompt(promptText, attemptNumber);
    await this.adapter.waitForImageResponse(bound);
    await this.adapter.pageForDiagnostics().waitForTimeout(1_500);
    const prepared = await this.adapter.prepareOfficialDownload(bound);
    const attemptRoot = join(this.options.artifactRoot, 'phase2b-master', `attempt-${String(attemptNumber).padStart(3, '0')}`);
    await mkdir(attemptRoot, { recursive: true });
    const artifactPath = join(attemptRoot, 'master.jpg');
    await this.captureOfficialDownload(prepared.control, bound, artifactPath);
    const details = await validateArtifact(artifactPath);
    if (details.mediaType !== 'image/jpeg') throw new GeminiAdapterError('ARTIFACT_INVALID', 'Official Gemini master was not JPEG');
    return {
      responseMarker: bound.assistantResponseToken,
      conversationUrl: this.adapter.conversationUrl() ?? undefined,
      master: { path: artifactPath, mediaType: 'image/jpeg', byteSize: details.byteSize, width: details.width, height: details.height, sha256: details.sha256 },
    };
  }

  private async captureOfficialDownload(control: Awaited<ReturnType<GeminiWebAdapter['prepareOfficialDownload']>>['control'], _bound: BoundResponse, artifactPath: string): Promise<void> {
    const cdp = this.pageCdp!;
    let clickedAt = 0;
    let targetCount = 0;
    let resolveCapture: ((bytes: Buffer) => void) | null = null;
    let rejectCapture: ((error: Error) => void) | null = null;
    const captured = new Promise<Buffer>((resolve, reject) => { resolveCapture = resolve; rejectCapture = reject; });
    const remove = cdp.onEvent((method, params) => {
      if (method !== 'Fetch.requestPaused') return;
      const requestId = String(params.requestId ?? '');
      if (!isTargetImage(params, clickedAt, Date.now())) {
        void continueResponse(cdp, requestId).catch(() => undefined);
        return;
      }
      targetCount += 1;
      if (targetCount !== 1) {
        void continueResponse(cdp, requestId).catch(() => undefined);
        rejectCapture?.(new Error('RESPONSE_OWNERSHIP_UNCERTAIN: multiple official image responses'));
        return;
      }
      void (async () => {
        try {
          const bodyReply = await cdp.send('Fetch.getResponseBody', { requestId });
          const result = (bodyReply.result as Json | undefined) ?? {};
          const body = String(result.body ?? '');
          const bytes = Boolean(result.base64Encoded) ? Buffer.from(body, 'base64') : Buffer.from(body, 'binary');
          if (!bytes.length) throw new Error('Empty official Gemini response body');
          await continueResponse(cdp, requestId);
          resolveCapture?.(bytes);
        } catch (error) {
          await continueResponse(cdp, requestId).catch(() => undefined);
          rejectCapture?.(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });
    let enabled = false;
    try {
      await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Response' }] });
      enabled = true;
      clickedAt = Date.now();
      await this.adapter.clickPreparedDownload(control);
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('FETCH_RESPONSE_STAGE_TIMEOUT')), this.options.captureTimeoutMs ?? 45_000));
      const bytes = await Promise.race([captured, timeout]);
      await writeFile(artifactPath, bytes);
    } finally {
      remove();
      if (enabled) await cdp.send('Fetch.disable').catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    this.pageCdp?.close();
    this.pageCdp = null;
    await this.adapter.disconnect();
    this.initialized = false;
  }
}
