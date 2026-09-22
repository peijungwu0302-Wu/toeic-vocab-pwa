import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { GeminiWebAdapter } from '../gemini/GeminiWebAdapter';
import { promptSha256, validateArtifact } from '../gemini/artifact';
import { waitForStableImageFile } from './rawCdpHelpers';

const ROOT = resolve(process.cwd());
const PROFILE = join(ROOT, '.local', 'gemini-browser-profile');
const ARTIFACT_ROOT = join(ROOT, 'automation-artifacts', 'phase2a-hybrid');
const PROMPT = 'Generate a simple image of a red umbrella on a plain white background.';
const PORT = Number(process.env.PHASE2A_HYBRID_PORT ?? 9443);

type Json = Record<string, unknown>;

class RawCdp {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: Json) => void; reject: (error: Error) => void }>();
  readonly events: Array<{ method: string; params?: Json }> = [];
  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Json;
      if (typeof message.id === 'number') {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message);
      } else if (typeof message.method === 'string') {
        this.events.push(message as { method: string; params?: Json });
        console.log(`[Hybrid][RawCDP] ${message.method}`);
      }
    });
    socket.addEventListener('close', () => console.log('[Hybrid][RawCDP] websocket close'));
  }

  static async connect(url: string): Promise<RawCdp> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolvePromise, reject) => {
      socket.addEventListener('open', () => resolvePromise(), { once: true });
      socket.addEventListener('error', () => reject(new Error('raw CDP websocket connection failed')), { once: true });
    });
    return new RawCdp(socket);
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
    try { return await getJson<T>(url); } catch (error) { last = error; await new Promise((r) => setTimeout(r, 500)); }
  }
  throw last instanceof Error ? last : new Error(`Timed out waiting for ${url}`);
}

function log(message: string): void { console.log(`[Hybrid] ${new Date().toISOString()} ${message}`); }

async function launchChrome(): Promise<ChildProcess> {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error('Chrome executable not found');
  await mkdir(PROFILE, { recursive: true });
  const child = spawn(executable, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--new-window',
    'https://gemini.google.com/app',
  ], { windowsHide: false, stdio: 'ignore' });
  log(`Chrome launched pid=${child.pid ?? 'unknown'} port=${PORT}`);
  child.on('exit', (code, signal) => log(`Chrome exit code=${code ?? 'null'} signal=${signal ?? 'null'}`));
  return child;
}

async function main(): Promise<void> {
  const runDir = join(ARTIFACT_ROOT, new Date().toISOString().replace(/[:.]/g, '-'));
  const attemptDir = join(runDir, 'attempt-001');
  const downloadDir = join(attemptDir, 'downloads');
  await mkdir(downloadDir, { recursive: true });
  const chrome = await launchChrome();
  let browserCdp: RawCdp | undefined;
  let pageCdp: RawCdp | undefined;
  const adapter = new GeminiWebAdapter({ profileDirectory: PROFILE, generationTimeoutMs: 180_000, downloadTimeoutMs: 45_000 });
  const startedAt = Date.now();
  try {
    const version = await waitForJson<{ webSocketDebuggerUrl: string }>(`http://127.0.0.1:${PORT}/json/version`);
    browserCdp = await RawCdp.connect(version.webSocketDebuggerUrl);
    const targets = await waitForJson<Array<{ id: string; type: string; url: string; webSocketDebuggerUrl?: string }>>(`http://127.0.0.1:${PORT}/json/list`);
    const rawTarget = targets.find((target) => target.type === 'page' && /gemini\.google\.com/.test(target.url));
    if (!rawTarget?.webSocketDebuggerUrl) throw new Error('Gemini raw page target not found');
    pageCdp = await RawCdp.connect(rawTarget.webSocketDebuggerUrl);
    await pageCdp.send('Page.enable');
    log(`same target raw id=${rawTarget.id} url=${rawTarget.url}`);
    await adapter.openOverCDP(`http://127.0.0.1:${PORT}`);
    const playwrightUrl = adapter.conversationUrl();
    log(`Playwright URL=${playwrightUrl ?? 'unknown'} raw URL=${rawTarget.url}`);
    if (!playwrightUrl || !/gemini\.google\.com/.test(playwrightUrl) || !/gemini\.google\.com/.test(rawTarget.url)) {
      throw new Error('Playwright and raw CDP are not both attached to Gemini');
    }
    await adapter.ensureReady();
    const submittedAt = new Date().toISOString();
    const bound = await adapter.submitPrompt(PROMPT, 1);
    const responseDetectedAt = bound.responseDetectedAt;
    const imageReadyAt = await adapter.waitForImageResponse(bound);
    const prepared = await adapter.prepareOfficialDownload(bound);
    log(`pre-click response=${bound.assistantResponseToken} diagnostics=${JSON.stringify(prepared.diagnostics)}`);
    log(`elapsed=${Date.now() - startedAt}ms imageReadyAt=${imageReadyAt} official response-scoped control prepared`);
    await new Promise((r) => setTimeout(r, 3_000));
    await browserCdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });
    log(`Browser.setDownloadBehavior applied dir=${downloadDir}`);
    try { await pageCdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir }); log('Page.setDownloadBehavior applied'); }
    catch (error) { log(`Page.setDownloadBehavior unavailable: ${String(error)}`); }
    await new Promise((r) => setTimeout(r, 500));
    await adapter.clickPreparedDownload(prepared.control);
    log('official response-scoped Download clicked via Playwright');
    const artifactPath = await waitForStableImageFile(downloadDir, 45_000);
    log(`filesystem artifact appeared path=${artifactPath}`);
    const validation = await validateArtifact(artifactPath);
    const metadata = {
      attemptNumber: 1,
      promptText: PROMPT,
      promptSha256: promptSha256(PROMPT),
      submittedAt,
      responseDetectedAt,
      imageReadyAt,
      downloadStartedAt: new Date().toISOString(),
      downloadCompletedAt: new Date().toISOString(),
      relativeArtifactPath: artifactPath.slice(ROOT.length + 1).replaceAll('\\', '/'),
      originalFilename: artifactPath.split(/[\\/]/).pop(),
      mediaType: validation.mediaType,
      byteSize: validation.byteSize,
      width: validation.width,
      height: validation.height,
      artifactSha256: validation.sha256,
      conversationUrl: playwrightUrl,
      result: 'success',
      errorCode: null,
      browserDownloadWillBegin: browserCdp.events.some((event) => event.method === 'Browser.downloadWillBegin'),
      browserDownloadProgress: browserCdp.events.some((event) => event.method === 'Browser.downloadProgress'),
      targetEvents: [...browserCdp.events, ...pageCdp.events].filter((event) => event.method.startsWith('Target.') || event.method.startsWith('Page.frame')).map((event) => event.method),
    };
    await writeFile(join(attemptDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    log(`SUCCESS bytes=${validation.byteSize} dimensions=${validation.width}x${validation.height} sha256=${createHash('sha256').update(await readFile(artifactPath)).digest('hex')}`);
  } finally {
    await adapter.close().catch((error) => log(`adapter close: ${String(error)}`));
    pageCdp?.close();
    browserCdp?.close();
    chrome.kill();
  }
}

main().catch((error) => { console.error(`[Hybrid] HARD STOP ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
