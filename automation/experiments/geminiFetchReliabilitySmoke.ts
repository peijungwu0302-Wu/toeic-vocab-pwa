import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { GeminiWebAdapter } from '../gemini/GeminiWebAdapter';
import { promptSha256, validateArtifact } from '../gemini/artifact';

const ROOT = resolve(process.cwd());
const PORT = 9664;
const PROFILE = join(ROOT, '.local', 'gemini-browser-profile');
const SMOKE_PROMPTS = [
  'Generate a simple image of a red umbrella on a plain white background.',
  'Generate a simple image of a blue bicycle on a plain white background.',
  'Generate a simple image of a yellow ceramic mug on a plain white background.',
];
const PROMPT_POOL = [
  'Generate a simple image of a green backpack on a wooden chair.',
  'Generate a simple image of a silver alarm clock on a bedside table.',
  'Generate a simple image of a purple bicycle beside a brick wall.',
  'Generate a simple image of an orange suitcase at an airport.',
  'Generate a simple image of white headphones beside a laptop.',
  'Generate a simple image of a blue watering can in a garden.',
  'Generate a simple image of a yellow raincoat hanging on a hook.',
  'Generate a simple image of a red toaster on a kitchen counter.',
  'Generate a simple image of a black camera on a white desk.',
  'Generate a simple image of a pink umbrella beside a park bench.',
  'Generate a simple image of a teal bicycle near a fountain.',
  'Generate a simple image of a brown leather wallet on a table.',
  'Generate a simple image of a white vase with daisies by a window.',
  'Generate a simple image of a gold key beside a notebook.',
  'Generate a simple image of a gray backpack beside a locker.',
  'Generate a simple image of a turquoise mug on a breakfast table.',
  'Generate a simple image of a crimson scarf on a coat rack.',
  'Generate a simple image of a lime-green lunchbox on a school desk.',
  'Generate a simple image of a navy suitcase beside a train platform.',
  'Generate a simple image of a copper desk lamp beside a book.',
  'Generate a simple image of a lavender watering can beside flowers.',
  'Generate a simple image of a black bicycle against a white fence.',
  'Generate a simple image of a coral alarm clock on a nightstand.',
  'Generate a simple image of a silver camera beside a travel bag.',
  'Generate a simple image of a mustard-yellow raincoat by a doorway.',
];
const STRESS_MODE = process.argv.includes('--stress10');
const RANDOM_SEED = 20260922;
const TIMEOUT_MS = 45_000;
type Json = Record<string, unknown>;
type Event = { method: string; params: Json; receivedAt: number };

class RawCdp {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: Json) => void; reject: (error: Error) => void }>();
  private readonly listeners = new Set<(event: Event) => void>();
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
        for (const listener of this.listeners) listener({ method: message.method, params: (message.params as Json | undefined) ?? {}, receivedAt: Date.now() });
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
  onEvent(listener: (event: Event) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
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

function sanitize(value: string): { host: string | null; path: string | null } {
  try {
    const url = new URL(value);
    return { host: url.hostname, path: url.pathname.split('/').map((part) => part.length > 32 ? '<redacted>' : part).join('/') || '/' };
  } catch { return { host: null, path: null }; }
}

function header(headers: Json[], name: string): string | null {
  const found = headers.find((entry) => String(entry.name ?? '').toLowerCase() === name.toLowerCase());
  return found ? String(found.value ?? '') : null;
}

async function continueUnmodified(cdp: RawCdp, requestId: string): Promise<void> {
  try { await cdp.send('Fetch.continueResponse', { requestId }); }
  catch { await cdp.send('Fetch.continueRequest', { requestId }); }
}

function log(message: string): void { console.log(`[FetchR1] ${new Date().toISOString()} ${message}`); }

function seededPrompts(seed: number): string[] {
  const selected = [...PROMPT_POOL];
  let state = seed >>> 0;
  for (let index = selected.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const swap = state % (index + 1);
    [selected[index], selected[swap]] = [selected[swap], selected[index]];
  }
  return selected.slice(0, 10);
}

async function captureForClick(cdp: RawCdp, control: Awaited<ReturnType<GeminiWebAdapter['prepareOfficialDownload']>>['control'], runDirectory: string, adapter: GeminiWebAdapter, runNumber: number): Promise<{ artifact: Awaited<ReturnType<typeof validateArtifact>>; pausedCount: number; targetCount: number; captureMs: number }> {
  let clickAt = 0;
  let pausedCount = 0;
  let targetCount = 0;
  let resolveCapture: ((value: { bytes: Buffer; relativeMs: number; mime: string | null; host: string | null; path: string | null }) => void) | null = null;
  let rejectCapture: ((error: Error) => void) | null = null;
  const capturePromise = new Promise<{ bytes: Buffer; relativeMs: number; mime: string | null; host: string | null; path: string | null }>((resolvePromise, rejectPromise) => { resolveCapture = resolvePromise; rejectCapture = rejectPromise; });
  const removeListener = cdp.onEvent((event) => {
    if (event.method !== 'Fetch.requestPaused') return;
    pausedCount += 1;
    const params = event.params;
    const requestId = String(params.requestId ?? '');
    const request = (params.request as Json | undefined) ?? {};
    const resource = sanitize(String(request.url ?? ''));
    const headers = Array.isArray(params.responseHeaders) ? params.responseHeaders as Json[] : [];
    const mime = (header(headers, 'content-type') ?? '').split(';', 1)[0].trim().toLowerCase() || null;
    const status = Number(params.responseStatusCode ?? 0);
    const relativeMs = clickAt ? event.receivedAt - clickAt : -1;
    const candidate = relativeMs >= 0 && status >= 200 && status < 300 && (resource.host === 'lh3.googleusercontent.com' || resource.host === 'lh3.google.com') && String(resource.path ?? '').startsWith('/rd-gg/') && mime === 'image/jpeg';
    log(`run=${runNumber} paused=${pausedCount} relativeMs=${relativeMs} host=${resource.host} path=${resource.path} status=${status} mime=${mime} candidate=${candidate}`);
    if (!candidate) { void continueUnmodified(cdp, requestId).catch((error) => log(`run=${runNumber} unrelated continue failed=${error.message}`)); return; }
    targetCount += 1;
    if (targetCount > 1) { void continueUnmodified(cdp, requestId).catch(() => undefined); rejectCapture?.(new Error('AMBIGUOUS_TARGET_IMAGE_RESPONSES')); return; }
    void (async () => {
      try {
        const reply = await cdp.send('Fetch.getResponseBody', { requestId });
        const result = (reply.result as Json | undefined) ?? {};
        const body = String(result.body ?? '');
        const bytes = Boolean(result.base64Encoded) ? Buffer.from(body, 'base64') : Buffer.from(body, 'binary');
        await continueUnmodified(cdp, requestId);
        resolveCapture?.({ bytes, relativeMs, mime, host: resource.host, path: resource.path });
      } catch (error) {
        await continueUnmodified(cdp, requestId).catch(() => undefined);
        rejectCapture?.(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let fetchEnabled = false;
  let clickStarted = 0;
  try {
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Response' }] });
    fetchEnabled = true;
    log(`run=${runNumber} Fetch.enable success target=${runNumber}`);
    clickStarted = Date.now();
    clickAt = clickStarted;
    await adapter.clickPreparedDownload(control);
    log(`run=${runNumber} official response-scoped download clicked exactly once`);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('FETCH_RESPONSE_STAGE_TIMEOUT')), TIMEOUT_MS);
    });
    const capture = await Promise.race([capturePromise, timeoutPromise]);
    const artifactPath = join(runDirectory, 'original.jpg');
    await writeFile(artifactPath, capture.bytes);
    const artifact = await validateArtifact(artifactPath);
    log(`run=${runNumber} artifact verified bytes=${artifact.byteSize} dimensions=${artifact.width}x${artifact.height} sha256=${artifact.sha256}`);
    return { artifact, pausedCount, targetCount, captureMs: Date.now() - clickStarted };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    removeListener();
    if (fetchEnabled) await cdp.send('Fetch.disable').catch(() => undefined);
    log(`run=${runNumber} Fetch disabled and listeners removed`);
  }
}

async function main(): Promise<void> {
  const version = await getJson<{ webSocketDebuggerUrl: string }>(`http://127.0.0.1:${PORT}/json/version`);
  const targets = await getJson<Array<{ id: string; type: string; url: string; webSocketDebuggerUrl?: string }>>(`http://127.0.0.1:${PORT}/json/list`);
  const target = targets.find((entry) => entry.type === 'page' && /gemini\.google\.com/.test(entry.url));
  if (!target?.webSocketDebuggerUrl) throw new Error('Gemini target not found; attach-existing requires the running Chrome');
  const browserCdp = await RawCdp.connect(version.webSocketDebuggerUrl);
  const pageCdp = await RawCdp.connect(target.webSocketDebuggerUrl);
  const adapter = new GeminiWebAdapter({ profileDirectory: PROFILE, generationTimeoutMs: 180_000 });
  const prompts = STRESS_MODE ? seededPrompts(RANDOM_SEED) : SMOKE_PROMPTS;
  const runDirectory = join(ROOT, 'automation-artifacts', STRESS_MODE ? 'phase2a-r2' : 'phase2a-reliability', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(runDirectory, { recursive: true });
  const results: Json[] = [];
  try {
    await adapter.openOverCDP(`http://127.0.0.1:${PORT}`);
    await adapter.ensureReady();
    await adapter.newChat();
    for (let index = 0; index < prompts.length; index += 1) {
      const runNumber = index + 1;
      const prompt = prompts[index];
      const startedAt = Date.now();
      const beforeSubmit = Date.now();
      const bound = await adapter.submitPrompt(prompt, runNumber);
      const userConfirmedMs = Date.now() - beforeSubmit;
      const imageReadyStarted = Date.now();
      const imageReadyAt = await adapter.waitForImageResponse(bound);
      const imageReadyMs = Date.now() - imageReadyStarted;
      await adapter.pageForDiagnostics().waitForTimeout(1_500);
      const prepared = await adapter.prepareOfficialDownload(bound);
      const attemptDirectory = join(runDirectory, `attempt-${String(runNumber).padStart(3, '0')}`);
      await mkdir(attemptDirectory, { recursive: true });
      const captured = await captureForClick(pageCdp, prepared.control, attemptDirectory, adapter, runNumber);
      await writeFile(join(attemptDirectory, 'metadata.json'), `${JSON.stringify({ runNumber, seed: STRESS_MODE ? RANDOM_SEED : null, prompt, promptSha256: promptSha256(prompt), responseDetectedAt: bound.responseDetectedAt, imageReadyAt, userTurnMs: userConfirmedMs, imageReadyMs, clickToCaptureMs: captured.captureMs, totalMs: Date.now() - startedAt, artifact: captured.artifact, pausedCount: captured.pausedCount, targetCount: captured.targetCount }, null, 2)}\n`, 'utf8');
      results.push({ runNumber, prompt, result: 'PASS', userTurnMs: userConfirmedMs, imageReadyMs, clickToCaptureMs: captured.captureMs, totalMs: Date.now() - startedAt, bytes: captured.artifact.byteSize, width: captured.artifact.width, height: captured.artifact.height, sha256: captured.artifact.sha256 });
      log(`run=${runNumber} PASS composer remains available; user turns/responses remain ownership-bound`);
      if (runNumber < prompts.length) await adapter.pageForDiagnostics().waitForTimeout(1_500);
    }
    await writeFile(join(runDirectory, 'run.json'), `${JSON.stringify({ mode: STRESS_MODE ? 'phase2a-r2' : 'phase2a-r1', seed: STRESS_MODE ? RANDOM_SEED : null, prompts, promptHashes: prompts.map(promptSha256), targetId: target.id, pageUrl: target.url, results }, null, 2)}\n`, 'utf8');
    log(`${prompts.length}-run smoke PASS directory=${runDirectory}`);
  } finally {
    pageCdp.close();
    browserCdp.close();
    await adapter.disconnect();
  }
}

main().catch((error) => { console.error(`[FetchR1] HARD STOP ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
