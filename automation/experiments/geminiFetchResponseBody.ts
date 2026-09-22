import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { GeminiWebAdapter } from '../gemini/GeminiWebAdapter';
import { validateArtifact, promptSha256 } from '../gemini/artifact';
import { isAttachExistingMode } from './fetchMode';

const ROOT = resolve(process.cwd());
const PROFILE = join(ROOT, '.local', 'gemini-browser-profile');
const ARTIFACT_ROOT = join(ROOT, 'automation-artifacts', 'phase2a-fetch');
const PROMPT = process.env.PHASE2A_FETCH_PROMPT ?? 'Generate a simple image of a red umbrella on a plain white background.';
const PORT = Number(process.env.PHASE2A_FETCH_PORT ?? 9664);
const TIMEOUT_MS = 45_000;
const ATTACH_EXISTING = isAttachExistingMode();

type Json = Record<string, unknown>;
type CdpEvent = { method: string; params: Json; receivedAt: string };
type PausedResponse = {
  requestId: string;
  request: Json;
  responseStatusCode: number;
  responseHeaders: Json[];
};

function log(message: string): void {
  console.log(`[Fetch] ${new Date().toISOString()} ${message}`);
}

function sanitizeUrl(value: string): Json {
  try {
    const url = new URL(value);
    return {
      protocol: url.protocol.replace(':', ''),
      host: url.hostname,
      pathPattern: url.pathname.split('/').map((part) => part.length > 32 ? '<redacted>' : part).join('/') || '/',
      queryParameterNames: [...url.searchParams.keys()].sort(),
    };
  } catch {
    return { protocol: 'other', host: null, pathPattern: null, queryParameterNames: [] };
  }
}

function header(headers: Json[], name: string): string | null {
  const match = headers.find((entry) => String(entry.name ?? '').toLowerCase() === name.toLowerCase());
  return match ? String(match.value ?? '') : null;
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
        const record = { method: message.method, params: (message.params as Json | undefined) ?? {}, receivedAt: new Date().toISOString() };
        for (const listener of this.listeners) listener(record);
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

async function waitForJson<T>(url: string): Promise<T> {
  const deadline = Date.now() + 30_000;
  let last: unknown;
  while (Date.now() < deadline) {
    try { return await getJson<T>(url); }
    catch (error) { last = error; await new Promise((resolvePromise) => setTimeout(resolvePromise, 500)); }
  }
  throw last instanceof Error ? last : new Error(`Timed out waiting for ${url}`);
}

async function launchChrome(): Promise<ChildProcess> {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error('Chrome executable not found');
  const child = spawn(executable, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--new-window',
    'https://gemini.google.com/app',
  ], { windowsHide: false, stdio: 'ignore' });
  log(`Chrome launched pid=${child.pid ?? 'unknown'} port=${PORT}`);
  return child;
}

function isExpectedImageResponse(event: CdpEvent, clickAt: number): PausedResponse | null {
  if (event.method !== 'Fetch.requestPaused') return null;
  const params = event.params;
  if (new Date(event.receivedAt).getTime() < clickAt - 1_000) return null;
  const responseStatusCode = Number(params.responseStatusCode ?? 0);
  if (responseStatusCode < 200 || responseStatusCode >= 300) return null;
  const request = (params.request as Json | undefined) ?? {};
  const resource = sanitizeUrl(String(request.url ?? ''));
  if (resource.host !== 'lh3.googleusercontent.com' && resource.host !== 'lh3.google.com') return null;
  if (!String(resource.pathPattern ?? '').startsWith('/rd-gg/')) return null;
  const responseHeaders = Array.isArray(params.responseHeaders) ? params.responseHeaders as Json[] : [];
  const mime = (header(responseHeaders, 'content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (mime !== 'image/jpeg') return null;
  return { requestId: String(params.requestId ?? ''), request, responseStatusCode, responseHeaders };
}

async function resumeUnmodified(cdp: RawCdp, requestId: string): Promise<'continueResponse' | 'continueRequest'> {
  try {
    await cdp.send('Fetch.continueResponse', { requestId });
    return 'continueResponse';
  } catch (error) {
    log(`Fetch.continueResponse unavailable; falling back to Fetch.continueRequest (${error instanceof Error ? error.message : String(error)})`);
    await cdp.send('Fetch.continueRequest', { requestId });
    return 'continueRequest';
  }
}

async function main(): Promise<void> {
  const runDirectory = join(ARTIFACT_ROOT, new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(runDirectory, { recursive: true });
  const chrome = ATTACH_EXISTING ? undefined : await launchChrome();
  const adapter = new GeminiWebAdapter({ profileDirectory: PROFILE, generationTimeoutMs: 180_000 });
  let browserCdp: RawCdp | undefined;
  let pageCdp: RawCdp | undefined;
  let fetchEnabled = false;
  try {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
    const version = await waitForJson<{ webSocketDebuggerUrl: string }>(`http://127.0.0.1:${PORT}/json/version`);
    browserCdp = await RawCdp.connect(version.webSocketDebuggerUrl);
    const targets = await waitForJson<Array<{ id: string; type: string; url: string; webSocketDebuggerUrl?: string }>>(`http://127.0.0.1:${PORT}/json/list`);
    const target = targets.find((entry) => entry.type === 'page' && /gemini\.google\.com/.test(entry.url));
    if (!target?.webSocketDebuggerUrl) throw new Error('Gemini target not found');
    if (ATTACH_EXISTING) {
      log(`Attach mode: true; CDP endpoint reachable: yes; Gemini target count=${targets.filter((entry) => entry.type === 'page' && /gemini\.google\.com/.test(entry.url)).length}; selected URL=${target.url}; browser PID=unknown`);
    }
    pageCdp = await RawCdp.connect(target.webSocketDebuggerUrl);
    await pageCdp.send('Page.enable');
    await adapter.openOverCDP(`http://127.0.0.1:${PORT}`);
    await adapter.ensureReady();
    const bound = await adapter.submitPrompt(PROMPT, 1);
    const imageReadyAt = await adapter.waitForImageResponse(bound);
    await adapter.pageForDiagnostics().waitForTimeout(3_000);
    const prepared = await adapter.prepareOfficialDownload(bound);

    const patterns = [
      { urlPattern: 'https://lh3.googleusercontent.com/rd-gg/*', requestStage: 'Response' },
      { urlPattern: 'https://lh3.google.com/rd-gg/*', requestStage: 'Response' },
    ];
    await pageCdp.send('Fetch.enable', { patterns });
    fetchEnabled = true;
    log(`Fetch response-stage interception enabled patterns=${JSON.stringify(patterns)}`);
    await adapter.pageForDiagnostics().waitForTimeout(500);

    const clickAt = Date.now();
    log(`DOWNLOAD_CLICK_T0=${new Date(clickAt).toISOString()}`);
    let candidateCount = 0;
    let resolveCapture: ((value: { paused: PausedResponse; bytes: Buffer; base64Encoded: boolean; resumedWith: string; capturedAt: string }) => void) | null = null;
    let rejectCapture: ((error: Error) => void) | null = null;
    const capturePromise = new Promise<{ paused: PausedResponse; bytes: Buffer; base64Encoded: boolean; resumedWith: string; capturedAt: string }>((resolvePromise, rejectPromise) => {
      resolveCapture = resolvePromise;
      rejectCapture = rejectPromise;
    });
    const removeListener = pageCdp.onEvent((event) => {
      const paused = isExpectedImageResponse(event, clickAt);
      if (!paused) return;
      candidateCount += 1;
      if (candidateCount > 1) {
        void resumeUnmodified(pageCdp as RawCdp, paused.requestId).catch(() => undefined);
        rejectCapture?.(new Error('CORRELATED_RESPONSE_UNCERTAIN: more than one final lh3 JPEG response was paused'));
        return;
      }
      log(`final JPEG response paused requestId=${paused.requestId}`);
      void (async () => {
        try {
          const bodyReply = await (pageCdp as RawCdp).send('Fetch.getResponseBody', { requestId: paused.requestId });
          const bodyResult = (bodyReply.result as Json | undefined) ?? {};
          const body = String(bodyResult.body ?? '');
          const base64Encoded = Boolean(bodyResult.base64Encoded);
          const bytes = base64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body, 'binary');
          if (bytes.length === 0) throw new Error('FETCH_RESPONSE_BODY_EMPTY');
          const resumedWith = await resumeUnmodified(pageCdp as RawCdp, paused.requestId);
          log(`response body captured bytes=${bytes.length} base64Encoded=${base64Encoded}; response resumed via ${resumedWith}`);
          resolveCapture?.({ paused, bytes, base64Encoded, resumedWith, capturedAt: new Date().toISOString() });
        } catch (error) {
          await resumeUnmodified(pageCdp as RawCdp, paused.requestId).catch(() => undefined);
          rejectCapture?.(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });

    await adapter.clickPreparedDownload(prepared.control);
    log('official response-scoped download clicked exactly once');
    const capture = await Promise.race([
      capturePromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('FETCH_RESPONSE_STAGE_TIMEOUT')), TIMEOUT_MS)),
    ]);
    removeListener();
    await pageCdp.send('Fetch.disable').catch(() => undefined);
    fetchEnabled = false;

    const artifactPath = join(runDirectory, 'original.jpg');
    await writeFile(artifactPath, capture.bytes);
    const artifact = await validateArtifact(artifactPath);
    const responseResource = sanitizeUrl(String(capture.paused.request.url ?? ''));
    const metadata = {
      prompt: PROMPT,
      promptSha256: promptSha256(PROMPT),
      responseIdentity: bound.assistantResponseToken,
      imageReadyAt,
      downloadClickAt: new Date(clickAt).toISOString(),
      capturedAt: capture.capturedAt,
      correlatedResponse: {
        requestId: capture.paused.requestId,
        host: responseResource.host,
        pathPattern: responseResource.pathPattern,
        status: capture.paused.responseStatusCode,
        mimeType: header(capture.paused.responseHeaders, 'content-type'),
        contentLength: header(capture.paused.responseHeaders, 'content-length'),
      },
      bodyExtraction: {
        succeeded: true,
        base64Encoded: capture.base64Encoded,
        extractedBytes: capture.bytes.length,
        method: 'cdp-fetch-response-stage-get-response-body',
        resumedWith: capture.resumedWith,
      },
      artifact: {
        filename: 'original.jpg',
        ...artifact,
        comparedWithDomRendition: artifact.width > 1024 || artifact.height > 559 ? 'higher-resolution-than-dom-rendition' : artifact.width === 1024 && artifact.height === 559 ? 'same-resolution' : 'lower-resolution',
      },
    };
    await writeFile(join(runDirectory, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    log(`artifact verified bytes=${artifact.byteSize} dimensions=${artifact.width}x${artifact.height} sha256=${artifact.sha256}`);
    const page = adapter.pageForDiagnostics();
    log(`Gemini page healthy after resume url=${page.url()} visibility=${await page.evaluate(() => document.visibilityState)}`);
    console.log(JSON.stringify(metadata, null, 2));
  } finally {
    if (fetchEnabled) await pageCdp?.send('Fetch.disable').catch(() => undefined);
    if (!ATTACH_EXISTING) await adapter.close().catch(() => undefined);
    pageCdp?.close();
    browserCdp?.close();
    if (chrome) chrome.kill();
  }
  if (ATTACH_EXISTING) process.exit(0);
}

main().catch((error) => {
  console.error(`[Fetch] HARD STOP ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
  if (ATTACH_EXISTING) process.exit(1);
});
