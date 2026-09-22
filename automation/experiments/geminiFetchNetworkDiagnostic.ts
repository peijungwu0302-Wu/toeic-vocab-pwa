import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { GeminiWebAdapter } from '../gemini/GeminiWebAdapter';
import { promptSha256, validateArtifact } from '../gemini/artifact';

const ROOT = resolve(process.cwd());
const PROFILE = join(ROOT, '.local', 'gemini-browser-profile');
const PORT = 9664;
const PROMPT = 'Generate a simple image of a blue bicycle on a plain white background.';
const TIMEOUT_MS = 45_000;

type Json = Record<string, unknown>;
type CdpEvent = { method: string; params: Json; receivedAt: number };

function sanitizeUrl(value: string): Json {
  try {
    const url = new URL(value);
    return {
      scheme: url.protocol.replace(':', ''),
      host: url.hostname,
      pathPattern: url.pathname.split('/').map((part) => part.length > 32 ? '<redacted>' : part).join('/') || '/',
      queryParameterNames: [...url.searchParams.keys()].sort(),
    };
  } catch {
    return { scheme: 'other', host: null, pathPattern: null, queryParameterNames: [] };
  }
}

function header(headers: Json[], name: string): string | null {
  const found = headers.find((entry) => String(entry.name ?? '').toLowerCase() === name.toLowerCase());
  return found ? String(found.value ?? '') : null;
}

class RawCdp {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: Json) => void; reject: (error: Error) => void }>();
  private readonly listeners = new Set<(event: CdpEvent) => void>();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Json;
      if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message);
        return;
      }
      if (typeof message.method === 'string') {
        for (const listener of this.listeners) listener({
          method: message.method,
          params: (message.params as Json | undefined) ?? {},
          receivedAt: Date.now(),
        });
      }
    });
  }

  static async connect(url: string): Promise<RawCdp> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolvePromise, reject) => {
      socket.addEventListener('open', () => resolvePromise(), { once: true });
      socket.addEventListener('error', () => reject(new Error('CDP websocket connection failed')), { once: true });
    });
    return new RawCdp(socket);
  }

  onEvent(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async send(method: string, params: Json = {}): Promise<Json> {
    const id = this.nextId++;
    return new Promise<Json>((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void { this.socket.close(); }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return (await response.json()) as T;
}

async function continueUnmodified(cdp: RawCdp, requestId: string): Promise<void> {
  try {
    await cdp.send('Fetch.continueResponse', { requestId });
  } catch {
    await cdp.send('Fetch.continueRequest', { requestId });
  }
}

function log(message: string): void {
  console.log(`[FetchDiag] ${new Date().toISOString()} ${message}`);
}

async function main(): Promise<void> {
  if (!existsSync(PROFILE)) throw new Error(`Dedicated profile missing: ${PROFILE}`);
  const version = await getJson<{ webSocketDebuggerUrl: string }>(`http://127.0.0.1:${PORT}/json/version`);
  const targets = await getJson<Array<{ id: string; type: string; url: string; webSocketDebuggerUrl?: string }>>(`http://127.0.0.1:${PORT}/json/list`);
  const target = targets.find((entry) => entry.type === 'page' && /gemini\.google\.com/.test(entry.url));
  if (!target?.webSocketDebuggerUrl) throw new Error('Gemini target not found');
  const targetId = target.id;
  const sessionLabel = target.webSocketDebuggerUrl.replace(/^ws:\/\/127\.0\.0\.1:\d+\//, 'ws://<local>/');
  log(`same-target targetId=${targetId} pageUrl=${target.url} websocket=${sessionLabel}`);

  const browserCdp = await RawCdp.connect(version.webSocketDebuggerUrl);
  const pageCdp = await RawCdp.connect(target.webSocketDebuggerUrl);
  const adapter = new GeminiWebAdapter({ profileDirectory: PROFILE, generationTimeoutMs: 180_000 });
  const runDirectory = join(ROOT, 'automation-artifacts', 'phase2a-fetch-network', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(runDirectory, { recursive: true });
  let fetchEnabled = false;
  let networkEnabled = false;
  let removeListener: (() => void) | undefined;
  try {
    await adapter.openOverCDP(`http://127.0.0.1:${PORT}`);
    await adapter.ensureReady();
    await adapter.newChat();
    const bound = await adapter.submitPrompt(PROMPT, 1);
    await adapter.waitForImageResponse(bound);
    await adapter.pageForDiagnostics().waitForTimeout(3_000);

    await pageCdp.send('Network.enable');
    networkEnabled = true;
    log(`Network.enable success targetId=${targetId}`);
    await pageCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Response' }] });
    fetchEnabled = true;
    log(`Fetch.enable success targetId=${targetId} pattern=* requestStage=Response`);

    let clickAt = 0;
    let pausedCount = 0;
    let targetCount = 0;
    const networkEvents: Json[] = [];
    let resolveCapture: ((value: { bytes: Buffer; paused: Json; base64Encoded: boolean }) => void) | null = null;
    let rejectCapture: ((error: Error) => void) | null = null;
    const capturePromise = new Promise<{ bytes: Buffer; paused: Json; base64Encoded: boolean }>((resolvePromise, rejectPromise) => {
      resolveCapture = resolvePromise;
      rejectCapture = rejectPromise;
    });
    removeListener = pageCdp.onEvent((event) => {
      if (event.method === 'Network.requestWillBeSent' || event.method === 'Network.responseReceived' || event.method === 'Network.loadingFinished') {
        if (!clickAt || event.receivedAt >= clickAt) {
          const params = event.params;
          const request = (params.request as Json | undefined) ?? {};
          const response = (params.response as Json | undefined) ?? {};
          networkEvents.push({ method: event.method, relativeMs: clickAt ? event.receivedAt - clickAt : null, requestId: params.requestId, url: sanitizeUrl(String(request.url ?? response.url ?? '')), status: response.status, mimeType: response.mimeType, encodedDataLength: params.encodedDataLength });
        }
        return;
      }
      if (event.method !== 'Fetch.requestPaused') return;
      pausedCount += 1;
      const params = event.params;
      const requestId = String(params.requestId ?? '');
      const request = (params.request as Json | undefined) ?? {};
      const responseHeaders = Array.isArray(params.responseHeaders) ? params.responseHeaders as Json[] : [];
      const resource = sanitizeUrl(String(request.url ?? ''));
      const mime = (header(responseHeaders, 'content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
      const status = Number(params.responseStatusCode ?? 0);
      const relativeMs = clickAt ? event.receivedAt - clickAt : null;
      const isCandidate = Boolean(clickAt && relativeMs !== null && relativeMs >= 0 && status >= 200 && status < 300 && (resource.host === 'lh3.googleusercontent.com' || resource.host === 'lh3.google.com') && String(resource.pathPattern ?? '').startsWith('/rd-gg/') && mime === 'image/jpeg');
      log(`Fetch.requestPaused count=${pausedCount} relativeMs=${relativeMs} host=${resource.host} path=${resource.pathPattern} status=${status} mime=${mime} candidate=${isCandidate}`);
      if (!isCandidate) {
        void continueUnmodified(pageCdp, requestId).catch((error) => log(`continue unrelated response failed: ${error.message}`));
        return;
      }
      targetCount += 1;
      if (targetCount > 1) {
        void continueUnmodified(pageCdp, requestId).catch(() => undefined);
        rejectCapture?.(new Error('AMBIGUOUS_TARGET_IMAGE_RESPONSES'));
        return;
      }
      void (async () => {
        try {
          const bodyReply = await pageCdp.send('Fetch.getResponseBody', { requestId });
          const result = (bodyReply.result as Json | undefined) ?? {};
          const body = String(result.body ?? '');
          const base64Encoded = Boolean(result.base64Encoded);
          const bytes = base64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body, 'binary');
          await continueUnmodified(pageCdp, requestId);
          resolveCapture?.({ bytes, paused: { requestId, resource, status, mime, contentLength: header(responseHeaders, 'content-length'), relativeMs }, base64Encoded });
        } catch (error) {
          await continueUnmodified(pageCdp, requestId).catch(() => undefined);
          rejectCapture?.(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });

    const prepared = await adapter.prepareOfficialDownload(bound);
    clickAt = Date.now();
    log(`DOWNLOAD_CLICK_T0=${new Date(clickAt).toISOString()}`);
    await adapter.clickPreparedDownload(prepared.control);
    log('official response-scoped download clicked exactly once');
    const capture = await Promise.race([
      capturePromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('FETCH_RESPONSE_STAGE_TIMEOUT')), TIMEOUT_MS)),
    ]);
    const artifactPath = join(runDirectory, 'original.jpg');
    await writeFile(artifactPath, capture.bytes);
    const artifact = await validateArtifact(artifactPath);
    await writeFile(join(runDirectory, 'metadata.json'), `${JSON.stringify({ prompt: PROMPT, promptSha256: promptSha256(PROMPT), targetId, pageUrl: target.url, networkEvents, pausedCount, targetCount, capture, artifact }, null, 2)}\n`, 'utf8');
    log(`artifact verified bytes=${artifact.byteSize} dimensions=${artifact.width}x${artifact.height} sha256=${artifact.sha256}`);
  } finally {
    removeListener?.();
    if (fetchEnabled) await pageCdp.send('Fetch.disable').catch(() => undefined);
    if (networkEnabled) await pageCdp.send('Network.disable').catch(() => undefined);
    pageCdp.close();
    browserCdp.close();
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(`[FetchDiag] HARD STOP ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
