import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { validateArtifact, promptSha256 } from '../gemini/artifact';
import { waitForStableImageFile } from './rawCdpHelpers';

const ROOT = resolve(process.cwd());
const PROFILE = join(ROOT, '.local', 'gemini-raw-cdp-profile');
const ARTIFACT_ROOT = join(ROOT, 'automation-artifacts', 'phase2a-cc');
const PROMPT = 'Generate a simple image of a red umbrella on a plain white background.';
const PORT = Number(process.env.PHASE2A_RAW_CDP_PORT ?? 9333);

type JsonObject = Record<string, unknown>;
type CdpEvent = { method: string; params?: JsonObject };

class RawCdp {
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: JsonObject) => void; reject: (error: Error) => void }>();
  private socket: WebSocket;
  public readonly events: CdpEvent[] = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as JsonObject;
      if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message);
      } else if (typeof message.method === 'string') {
        this.events.push(message as unknown as CdpEvent);
        console.log(`[RawCDP] event ${message.method}`);
      }
    });
    socket.addEventListener('close', () => console.log('[RawCDP] websocket close'));
  }

  static async connect(url: string): Promise<RawCdp> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolvePromise, reject) => {
      socket.addEventListener('open', () => resolvePromise(), { once: true });
      socket.addEventListener('error', () => reject(new Error('CDP websocket connection failed')), { once: true });
    });
    return new RawCdp(socket);
  }

  async send(method: string, params: JsonObject = {}): Promise<JsonObject> {
    const id = this.nextId++;
    const message = JSON.stringify({ id, method, params });
    return new Promise<JsonObject>((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(message);
    });
  }

  close(): void {
    this.socket.close();
  }
}

function log(message: string): void {
  console.log(`[RawCDP] ${new Date().toISOString()} ${message}`);
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return (await response.json()) as T;
}

async function waitForJson<T>(url: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try { return await json<T>(url); } catch (error) { lastError = error; await new Promise((r) => setTimeout(r, 500)); }
  }
  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${url}`);
}

async function evaluate(page: RawCdp, expression: string): Promise<unknown> {
  const result = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  const envelope = result.result as JsonObject | undefined;
  const remote = envelope?.result as JsonObject | undefined;
  if (remote?.exceptionDetails) throw new Error(JSON.stringify(remote.exceptionDetails));
  if (!remote || !Object.prototype.hasOwnProperty.call(remote, 'value')) {
    throw new Error(`Runtime.evaluate returned no value: ${JSON.stringify(result)}`);
  }
  return remote.value;
}

async function launchChrome(): Promise<ChildProcess> {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const executable = candidates.find((path) => existsSync(path));
  if (!executable) throw new Error('Chrome executable not found');
  await mkdir(PROFILE, { recursive: true });
  const child = spawn(executable, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--new-window',
    'https://gemini.google.com/app',
  ], { windowsHide: false, stdio: 'ignore' });
  log(`Chrome launched pid=${child.pid ?? 'unknown'} port=${PORT}`);
  child.on('exit', (code, signal) => log(`Chrome process exit code=${code ?? 'null'} signal=${signal ?? 'null'}`));
  return child;
}

async function waitForReady(page: RawCdp): Promise<void> {
  const deadline = Date.now() + 5 * 60_000;
  let announced = false;
  while (Date.now() < deadline) {
    const state = await evaluate(page, `(() => ({
      url: location.href,
      ready: Boolean(document.querySelector('[contenteditable="true"], [role="textbox"]')),
      login: /accounts\\.google\\.com|登入|sign in/i.test(document.body?.innerText || ''),
    }))()`);
    if ((state as JsonObject).ready) { log('Gemini UI ready'); return; }
    if (!announced) { log('Manual login may be required; use the visible dedicated Chrome window'); announced = true; }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error('GEMINI_NOT_READY or LOGIN_REQUIRED');
}

async function submitPrompt(page: RawCdp): Promise<{ prompt: string; submittedAt: string }> {
  const submittedAt = new Date().toISOString();
  const result = await evaluate(page, `(() => {
    const box = document.querySelector('[contenteditable="true"], [role="textbox"]');
    if (!box) return { ok: false, reason: 'textbox' };
    box.setAttribute('data-raw-cdp-prompt-box', 'true');
    box.focus();
    return { ok: true };
  })()`);
  if (!(result as JsonObject).ok) throw new Error('PROMPT_SUBMIT_FAILED: textbox not found');
  await page.send('Input.insertText', { text: PROMPT });
  const sent = await evaluate(page, `(() => {
    const buttons = [...document.querySelectorAll('button')];
    const button = buttons.find((b) => /傳送|送出|send/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')));
    if (button) { button.click(); return true; }
    return false;
  })()`);
  if (!sent) await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' });
  log(`prompt submitted at ${submittedAt}`);
  return { prompt: PROMPT, submittedAt };
}

async function waitForImageReady(page: RawCdp, prompt: string): Promise<{ responseDetectedAt: string; imageReadyAt: string }> {
  const deadline = Date.now() + 180_000;
  const minimumSettle = Date.now() + 20_000;
  let userConfirmed = false;
  let responseDetectedAt = '';
  while (Date.now() < deadline) {
    const state = await evaluate(page, `(() => {
      const text = ${JSON.stringify(prompt)};
      const nodes = [...document.querySelectorAll('user-query, [data-message-author="user"], main [role="heading"]')];
      const user = nodes.find((n) => (n.textContent || '').includes(text));
      if (!user) return { user: false, response: false, ready: false, inactive: false, download: false };
      const all = [...document.querySelectorAll('model-response, [data-message-author="model"], main [role="article"]')];
      const response = all.find((n) => (user.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
      if (!response) return { user: true, response: false, ready: false, inactive: false, download: false };
      const image = [...response.querySelectorAll('img')].find((img) => img.naturalWidth > 0 && img.naturalHeight > 0);
      const download = [...response.querySelectorAll('button, [role="button"]')].find((b) => /下載原尺寸圖片|download full size|download original/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')));
      const inactive = !/停止回應|停止生成|stop generating|stop response/i.test(response.textContent || '');
      return { user: true, response: true, ready: Boolean(image), inactive, download: Boolean(download) };
    })()`);
    const s = state as JsonObject;
    if (s.user) userConfirmed = true;
    if (s.response && !responseDetectedAt) { responseDetectedAt = new Date().toISOString(); log('assistant response bound'); }
    if (Date.now() >= minimumSettle && s.ready && s.inactive && s.download && userConfirmed) {
      const imageReadyAt = new Date().toISOString();
      log(`image ready at ${imageReadyAt}`);
      return { responseDetectedAt, imageReadyAt };
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error('IMAGE_GENERATION_TIMEOUT or RESPONSE_OWNERSHIP_UNCERTAIN');
}

async function clickOfficialDownload(page: RawCdp): Promise<{ clickedAt: string; label: string }> {
  const scrolled = await evaluate(page, `(() => {
    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter((b) => /下載原尺寸圖片|download full size|download original/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')));
    if (buttons.length !== 1) return { ok: false, count: buttons.length };
    const b = buttons[0]; b.scrollIntoView({ block: 'center' }); return { ok: true, label: b.getAttribute('aria-label') || b.textContent || '' };
  })()`);
  if (!(scrolled as JsonObject).ok) throw new Error(`DOWNLOAD_CONTROL_NOT_FOUND: ${JSON.stringify(scrolled)}`);
  await new Promise((r) => setTimeout(r, 500));
  const clickedAt = new Date().toISOString();
  await evaluate(page, `(() => {
    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter((b) => /下載原尺寸圖片|download full size|download original/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')));
    if (buttons.length !== 1) throw new Error('download control changed');
    buttons[0].click(); return true;
  })()`);
  log(`official download clicked at ${clickedAt}`);
  return { clickedAt, label: String((scrolled as JsonObject).label) };
}

async function main(): Promise<void> {
  const runDir = join(ARTIFACT_ROOT, new Date().toISOString().replace(/[:.]/g, '-'));
  const downloadDir = join(runDir, 'downloads');
  await mkdir(downloadDir, { recursive: true });
  const chrome = await launchChrome();
  let browser: RawCdp | undefined;
  let page: RawCdp | undefined;
  try {
    const version = await waitForJson<{ webSocketDebuggerUrl: string }>(`http://127.0.0.1:${PORT}/json/version`);
    browser = await RawCdp.connect(version.webSocketDebuggerUrl);
    await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });
    log('Browser.setDownloadBehavior applied');
    let targets = await waitForJson<Array<{ url: string; webSocketDebuggerUrl?: string; type: string }>>(`http://127.0.0.1:${PORT}/json/list`);
    let target = targets.find((entry) => entry.type === 'page' && /gemini\.google\.com/.test(entry.url));
    if (!target) {
      await fetch(`http://127.0.0.1:${PORT}/json/new?https://gemini.google.com/app`, { method: 'PUT' });
      targets = await waitForJson<Array<{ url: string; webSocketDebuggerUrl?: string; type: string }>>(`http://127.0.0.1:${PORT}/json/list`);
      target = targets.find((entry) => entry.type === 'page' && /gemini\.google\.com/.test(entry.url));
    }
    if (!target?.webSocketDebuggerUrl) throw new Error('Gemini page target not found');
    page = await RawCdp.connect(target.webSocketDebuggerUrl);
    await page.send('Page.enable');
    try { await page.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir }); log('Page.setDownloadBehavior applied'); }
    catch (error) { log(`Page.setDownloadBehavior unavailable: ${String(error)}`); }
    await waitForReady(page);
    const submitted = await submitPrompt(page);
    const ready = await waitForImageReady(page, submitted.prompt);
    const download = await clickOfficialDownload(page);
    const artifactPath = await waitForStableImageFile(downloadDir);
    log(`artifact located path=${artifactPath}`);
    const details = await validateArtifact(artifactPath);
    log(`artifact verified sha256=${details.sha256} dimensions=${details.width}x${details.height}`);
    const metadata = {
      attemptNumber: 1,
      promptText: PROMPT,
      promptSha256: promptSha256(PROMPT),
      submittedAt: submitted.submittedAt,
      responseDetectedAt: ready.responseDetectedAt,
      imageReadyAt: ready.imageReadyAt,
      downloadStartedAt: download.clickedAt,
      downloadCompletedAt: new Date().toISOString(),
      relativeArtifactPath: artifactPath.replace(`${ROOT}\\`, '').replaceAll('\\', '/'),
      originalFilename: artifactPath.split(/[\\/]/).pop(),
      fileExtension: artifactPath.slice(artifactPath.lastIndexOf('.')),
      mediaType: details.mediaType,
      byteSize: details.byteSize,
      width: details.width,
      height: details.height,
      artifactSha256: details.sha256,
      conversationUrl: target.url,
      result: 'success',
      errorCode: null,
      rawCdp: { browserDownloadWillBegin: browser.events.some((e) => e.method === 'Browser.downloadWillBegin'), browserDownloadProgress: browser.events.some((e) => e.method === 'Browser.downloadProgress'), officialLabel: download.label },
    };
    await writeFile(join(runDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    log(`SUCCESS sha256=${createHash('sha256').update(await readFile(artifactPath)).digest('hex')}`);
  } finally {
    page?.close();
    browser?.close();
    chrome.kill();
  }
}

main().catch((error) => { console.error(`[RawCDP] HARD STOP ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
