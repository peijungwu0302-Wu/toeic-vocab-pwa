import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { GeminiWebAdapter } from '../gemini/GeminiWebAdapter';
import { validateArtifact, promptSha256 } from '../gemini/artifact';

const ROOT = resolve(process.cwd());
const PROFILE = join(ROOT, '.local', 'gemini-browser-profile');
const OUTPUT = join(ROOT, 'automation-artifacts', 'phase2a-body-recon.json');
const DOWNLOAD_DIR = join(ROOT, 'automation-artifacts', 'phase2a-body-observation');
const BODY_DIR = join(ROOT, 'automation-artifacts', 'phase2a-body');
const PROMPT = 'Generate a simple image of a red umbrella on a plain white background.';
const PORT = Number(process.env.PHASE2A_NETWORK_PORT ?? 9663);

type Json = Record<string, unknown>;
type EventRecord = { method: string; params: Json; receivedAt: string };

function sanitize(value: string | null | undefined): Json {
  if (!value) return { protocol: 'none', host: null, pathPattern: null, queryParameterNames: [] };
  try {
    const url = new URL(value);
    const pathPattern = url.pathname.split('/').map((segment) => segment.length > 32 ? '<redacted>' : segment).join('/') || '/';
    return { protocol: url.protocol.replace(':', ''), host: url.hostname || null, pathPattern, queryParameterNames: [...url.searchParams.keys()].sort() };
  } catch {
    return { protocol: value.startsWith('blob:') ? 'blob' : value.startsWith('data:') ? 'data' : 'other', host: null, pathPattern: null, queryParameterNames: [] };
  }
}

class RawCdp {
  private id = 1;
  private pending = new Map<number, { resolve: (value: Json) => void; reject: (error: Error) => void }>();
  readonly events: EventRecord[] = [];
  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Json;
      if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message);
      } else if (typeof message.method === 'string') {
        this.events.push({ method: message.method, params: (message.params as Json | undefined) ?? {}, receivedAt: new Date().toISOString() });
      }
    });
  }
  static async connect(url: string): Promise<RawCdp> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolvePromise, reject) => { socket.addEventListener('open', () => resolvePromise(), { once: true }); socket.addEventListener('error', () => reject(new Error('CDP websocket connection failed')), { once: true }); });
    return new RawCdp(socket);
  }
  async send(method: string, params: Json = {}): Promise<Json> {
    const id = this.id++;
    return new Promise<Json>((resolvePromise, reject) => { this.pending.set(id, { resolve: resolvePromise, reject }); this.socket.send(JSON.stringify({ id, method, params })); });
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
  while (Date.now() < deadline) { try { return await getJson<T>(url); } catch (error) { last = error; await new Promise((r) => setTimeout(r, 500)); } }
  throw last instanceof Error ? last : new Error(`Timed out waiting for ${url}`);
}

async function launchChrome(): Promise<ChildProcess> {
  const candidates = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'];
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error('Chrome executable not found');
  const child = spawn(executable, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--new-window', 'https://gemini.google.com/app'], { windowsHide: false, stdio: 'ignore' });
  console.log(`[NetworkRecon] Chrome pid=${child.pid ?? 'unknown'} port=${PORT}`);
  return child;
}

function relevantNetworkEvents(events: EventRecord[], clickAtMs: number): Json[] {
  const requests = new Map<string, Json>();
  const outputs: Json[] = [];
  for (const event of events) {
    const params = event.params;
    if (event.method === 'Network.requestWillBeSent') {
      const request = params.request as Json | undefined;
      const requestId = String(params.requestId ?? '');
      if (requestId) requests.set(requestId, { requestId, timestamp: event.receivedAt, relativeMs: new Date(event.receivedAt).getTime() - clickAtMs, method: request?.method, resourceType: params.type, initiatorType: (params.initiator as Json | undefined)?.type, url: sanitize(String(request?.url ?? '')) });
    }
    if (event.method === 'Network.responseReceived') {
      const response = params.response as Json | undefined;
      const headers = (response?.headers as Json | undefined) ?? {};
      const mimeType = String(response?.mimeType ?? '').toLowerCase();
      const disposition = Object.entries(headers).find(([name]) => name.toLowerCase() === 'content-disposition')?.[1];
      if (mimeType.startsWith('image/') || mimeType === 'application/octet-stream' || disposition) {
        outputs.push({ requestId: params.requestId, timestamp: event.receivedAt, relativeMs: new Date(event.receivedAt).getTime() - clickAtMs, status: response?.status, mimeType, contentLength: headers['content-length'] ?? headers['Content-Length'] ?? null, contentDispositionPresent: Boolean(disposition), encodedDataLength: response?.encodedDataLength, url: sanitize(String(response?.url ?? '')), request: requests.get(String(params.requestId ?? '')) ?? null });
      }
    }
    if (event.method === 'Network.loadingFinished') {
      const request = requests.get(String(params.requestId ?? ''));
      if (request) outputs.push({ requestId: params.requestId, timestamp: event.receivedAt, relativeMs: new Date(event.receivedAt).getTime() - clickAtMs, loadingFinished: true, encodedDataLength: params.encodedDataLength, request });
    }
    if (event.method === 'Network.loadingFailed') outputs.push({ requestId: params.requestId, timestamp: event.receivedAt, relativeMs: new Date(event.receivedAt).getTime() - clickAtMs, loadingFailed: true, errorText: params.errorText, canceled: params.canceled, request: requests.get(String(params.requestId ?? '')) ?? null });
  }
  return outputs.filter((entry) => Number(entry.relativeMs) >= -1_000);
}

async function main(): Promise<void> {
  await mkdir(DOWNLOAD_DIR, { recursive: true });
  const chrome = await launchChrome();
  const adapter = new GeminiWebAdapter({ profileDirectory: PROFILE, generationTimeoutMs: 180_000 });
  let browserCdp: RawCdp | undefined;
  let pageCdp: RawCdp | undefined;
  try {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
    const version = await waitForJson<{ webSocketDebuggerUrl: string }>(`http://127.0.0.1:${PORT}/json/version`);
    browserCdp = await RawCdp.connect(version.webSocketDebuggerUrl);
    const targets = await waitForJson<Array<{ id: string; type: string; url: string; webSocketDebuggerUrl?: string }>>(`http://127.0.0.1:${PORT}/json/list`);
    const target = targets.find((entry) => entry.type === 'page' && /gemini\.google\.com/.test(entry.url));
    if (!target?.webSocketDebuggerUrl) throw new Error('Gemini target not found');
    pageCdp = await RawCdp.connect(target.webSocketDebuggerUrl);
    await pageCdp.send('Page.enable');
    await pageCdp.send('Network.enable');
    await adapter.openOverCDP(`http://127.0.0.1:${PORT}`);
    await adapter.ensureReady();
    const bound = await adapter.submitPrompt(PROMPT, 1);
    const imageReadyAt = await adapter.waitForImageResponse(bound);
    await adapter.pageForDiagnostics().waitForTimeout(3_000);
    const prepared = await adapter.prepareOfficialDownload(bound);
    const page = adapter.pageForDiagnostics();
    await page.evaluate(() => {
      const original = URL.createObjectURL;
      (window as unknown as { __phase2aOriginalCreateObjectURL?: typeof original }).__phase2aOriginalCreateObjectURL = original;
      URL.createObjectURL = function (blob: Blob) { (window as unknown as { __phase2aBlobEvents?: unknown[] }).__phase2aBlobEvents ??= []; (window as unknown as { __phase2aBlobEvents: unknown[] }).__phase2aBlobEvents.push({ type: blob.type, size: blob.size, at: new Date().toISOString() }); return original.call(URL, blob); };
    });
    await page.waitForTimeout(1_000);
    const clickAt = Date.now();
    console.log(`[NetworkRecon] DOWNLOAD_CLICK_T0=${new Date(clickAt).toISOString()}`);
    await adapter.clickPreparedDownload(prepared.control);
    await page.waitForTimeout(15_000);
    if (!pageCdp || !browserCdp) throw new Error('CDP session unavailable after official click');
    const observedPageCdp = pageCdp;
    const observedBrowserCdp = browserCdp;
    const blobEvents = await page.evaluate(() => (window as unknown as { __phase2aBlobEvents?: unknown[] }).__phase2aBlobEvents ?? []);
    const files = await readdir(DOWNLOAD_DIR);
    const allEvents = [...observedBrowserCdp.events, ...observedPageCdp.events];
    const imageResponses = observedPageCdp.events.filter((event) => event.method === 'Network.responseReceived').filter((event) => {
      const response = event.params.response as Json | undefined;
      const resource = sanitize(String(response?.url ?? ''));
      return new Date(event.receivedAt).getTime() >= clickAt - 1_000 && String(response?.mimeType ?? '').toLowerCase().startsWith('image/') && (resource.host === 'lh3.googleusercontent.com' || resource.host === 'lh3.google.com');
    });
    const completeImageResponses = imageResponses.filter((event) => observedPageCdp.events.some((candidate) => candidate.method === 'Network.loadingFinished' && String(candidate.params.requestId) === String(event.params.requestId)));
    if (completeImageResponses.length !== 1) throw new Error(`CORRELATED_IMAGE_RESPONSE_UNCERTAIN: expected one completed lh3 image response, found ${completeImageResponses.length}`);
    const imageEvent = completeImageResponses[0];
    const imageResponse = imageEvent.params.response as Json;
    const requestId = String(imageEvent.params.requestId);
    const finishedEvent = observedPageCdp.events.find((event) => event.method === 'Network.loadingFinished' && String(event.params.requestId) === requestId);
    const bodyReply = await observedPageCdp.send('Network.getResponseBody', { requestId });
    const bodyEnvelope = bodyReply.result as Json | undefined;
    const bodyResult = bodyEnvelope?.result as Json | undefined;
    const body = String(bodyResult?.body ?? '');
    const base64Encoded = Boolean(bodyResult?.base64Encoded);
    const bytes = base64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body, 'binary');
    if (bytes.length === 0) throw new Error('CORRELATED_RESPONSE_BODY_EMPTY');
    await mkdir(BODY_DIR, { recursive: true });
    const artifactPath = join(BODY_DIR, `${new Date(clickAt).toISOString().replace(/[:.]/g, '-')}-original.jpg`);
    await writeFile(artifactPath, bytes);
    const artifact = await validateArtifact(artifactPath);
    const responseResource = sanitize(String(imageResponse.url ?? ''));
    const output = { prompt: PROMPT, promptSha256: promptSha256(PROMPT), targetId: target.id, targetUrl: target.url, responseIdentity: bound.assistantResponseToken, responseDetectedAt: bound.responseDetectedAt, imageReadyAt, preClickDiagnostics: prepared.diagnostics, downloadClickAt: new Date(clickAt).toISOString(), correlatedResponse: { requestId, relativeMs: new Date(imageEvent.receivedAt).getTime() - clickAt, host: responseResource.host, pathPattern: responseResource.pathPattern, mimeType: imageResponse.mimeType, contentLength: (imageResponse.headers as Json | undefined)?.['content-length'] ?? null, encodedDataLength: finishedEvent?.params.encodedDataLength ?? null, initiatorType: ((imageEvent.params as Json).initiator as Json | undefined)?.type ?? null }, bodyExtraction: { succeeded: true, base64Encoded, extractedBytes: bytes.length, method: 'cdp-network-get-response-body' }, artifact: { filename: artifactPath.split(/[\\/]/).pop(), mediaType: artifact.mediaType, byteSize: artifact.byteSize, width: artifact.width, height: artifact.height, sha256: artifact.sha256, comparedWithDomRendition: artifact.width > 1024 || artifact.height > 559 ? 'higher-resolution-than-dom-rendition' : artifact.width === 1024 && artifact.height === 559 ? 'same-resolution' : 'lower-resolution' }, blobEvents, observedFiles: files, networkEvents: relevantNetworkEvents(allEvents, clickAt) };
    await mkdir(join(ROOT, 'automation-artifacts'), { recursive: true });
    await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await adapter.close().catch(() => undefined);
    pageCdp?.close();
    browserCdp?.close();
    chrome.kill();
  }
}

main().catch((error) => { console.error(`[NetworkRecon] HARD STOP ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
