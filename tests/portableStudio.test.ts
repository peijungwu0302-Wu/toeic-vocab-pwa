// @vitest-environment node

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, test, vi } from 'vitest';

const JSDOM = createRequire(import.meta.url)('jsdom').JSDOM as new (
  html: string,
  options: { url: string; runScripts: 'dangerously'; beforeParse: (window: any) => void }
) => { window: any };

const WORD_A = 'tw_w_aaaaaaaaaaaa';
const WORD_B = 'tw_w_bbbbbbbbbbbb';
const WORD_C = 'tw_w_cccccccccccc';
const SHA = 'a'.repeat(64);
const words = [
  { id: WORD_A, headword: 'alpha', slug: 'shared_slug', prompt: 'prompt A', pos: 'noun', zh: 'A', hasImage: false },
  { id: WORD_B, headword: 'beta', slug: 'shared_slug', prompt: 'prompt B', pos: 'noun', zh: 'B', hasImage: false },
  { id: WORD_C, headword: 'gamma', slug: 'gamma', prompt: 'prompt C', pos: 'noun', zh: 'C', hasImage: false },
];
const fixtureDataset = {
  'core-1200': [],
  'advanced-2500': [],
  'expert-high-part1': words,
  'expert-high-part2': [],
  'expert-high-part3': [],
};
const studioHtml = readFileSync(new URL('../public/portable_studio.html', import.meta.url), 'utf8')
  .replace(/    const DATASET = [^\r\n]*;\r?\n/, `    const DATASET = ${JSON.stringify(fixtureDataset)};\n`);

type PublishMetadata = { wordId: string; imageSha256: string; publishRequestId: string };

function receipt(meta: PublishMetadata, overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    publishRequestId: meta.publishRequestId,
    wordId: meta.wordId,
    version: 1,
    imageKey: `words/${meta.wordId}/v1.webp`,
    sha256: meta.imageSha256,
    ledgerCommitted: true,
    manifestCommitted: true,
    verifiedAtCommit: true,
    activeAtVerification: true,
    verifiedAt: '2026-09-21T00:00:00.000Z',
    publication: { objectStored: true, ledgerCommitted: true, manifestCommitted: true, verified: true },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function makeStudio() {
  let publishResponder: (meta: PublishMetadata) => Promise<Record<string, unknown>> = async (meta) => receipt(meta);
  const dom = new JSDOM(studioHtml, {
    url: 'https://studio.test/portable_studio.html',
    runScripts: 'dangerously',
    beforeParse(window) {
      (window as any).fetch = async (url: string, init?: { body?: FormData }) => {
        if (String(url).endsWith('/api/publish')) {
          const meta = JSON.parse(String(init?.body?.get('metadata'))) as PublishMetadata;
          return { ok: true, json: () => publishResponder(meta) };
        }
        return { ok: true, json: async () => ({ count: 0, images: {} }) };
      };
    },
  });
  const win = dom.window as any;
  win.sessionStorage.setItem('TOEIC_STUDIO_SECRET', 'test-secret');
  return {
    dom,
    win,
    setPublishResponder(responder: (meta: PublishMetadata) => Promise<Record<string, unknown>>) {
      publishResponder = responder;
    },
  };
}

function transformedImage(win: any) {
  return {
    blob: new win.Blob(['image'], { type: 'image/webp' }),
    base64: 'data:image/webp;base64,aW1hZ2U=',
    sha256: SHA,
    ext: 'webp',
    width: 896,
    height: 896,
  };
}

async function stageSelectedWord(win: any) {
  win.processImageToWebP = async () => transformedImage(win);
  await win.handleImageFile(new win.Blob(['source'], { type: 'image/png' }));
}

describe('Portable Studio manual wordId ownership', () => {
  const opened: Array<InstanceType<typeof JSDOM>> = [];
  afterEach(() => {
    opened.splice(0).forEach((dom) => dom.window.close());
    vi.restoreAllMocks();
  });

  function setup() {
    const studio = makeStudio();
    opened.push(studio.dom);
    return studio;
  }

  test('staged status and preview resolve by wordId even when two words share a slug', async () => {
    const { win } = setup();
    await stageSelectedWord(win);

    expect(win.eval(`stagedImages.has('${WORD_A}')`)).toBe(true);
    expect(win.eval(`getWordImageInfo(DATASET['expert-high-part1'][0]).isStaged`)).toBe(true);
    expect(win.eval(`getWordImageInfo(DATASET['expert-high-part1'][1]).isStaged`)).toBe(false);
    expect(win.document.getElementById('previewImg').src).toContain('data:image/webp;base64,');
  });

  test('Ctrl+V still stages the selected word through the existing paste listener', async () => {
    const { win } = setup();
    win.processImageToWebP = async () => transformedImage(win);
    const event = new win.Event('paste');
    Object.defineProperty(event, 'clipboardData', {
      value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => new win.Blob(['source']) }] },
    });

    win.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(win.eval(`stagedImages.has('${WORD_A}')`)).toBe(true);
    expect(win.document.getElementById('previewImg').src).toContain('data:image/webp;base64,');
  });

  test('selection change during image transform cannot attach A image to B', async () => {
    const { win } = setup();
    const pending = deferred<ReturnType<typeof transformedImage>>();
    win.processImageToWebP = () => pending.promise;
    const transform = win.handleImageFile(new win.Blob(['source'], { type: 'image/png' }));
    win.document.getElementById('wordsList').children[1].click();

    pending.resolve(transformedImage(win));
    await transform;

    expect(win.eval(`stagedImages.has('${WORD_A}')`)).toBe(true);
    expect(win.eval(`stagedImages.has('${WORD_B}')`)).toBe(false);
    expect(win.eval('selectedWord.id')).toBe(WORD_B);
    expect(win.document.getElementById('focusWord').textContent).toBe('beta');
  });

  test('selection change during publish updates A receipt and manifest without retargeting B UI', async () => {
    const { win, setPublishResponder } = setup();
    await stageSelectedWord(win);
    const pending = deferred<Record<string, unknown>>();
    const requestSeen = deferred<PublishMetadata>();
    setPublishResponder((meta) => { requestSeen.resolve(meta); return pending.promise; });

    const publishing = win.document.getElementById('btnPublishR2').onclick();
    const submitted = await requestSeen.promise;
    win.eval("selectWord(DATASET['expert-high-part1'][1])");
    pending.resolve(receipt(submitted));
    await publishing;

    expect(submitted.wordId).toBe(WORD_A);
    expect(win.eval(`DATASET['expert-high-part1'][0].cloudImageUrl`)).toContain(`/words/${WORD_A}/v1.webp`);
    expect(win.eval(`DATASET['expert-high-part1'][1].cloudImageUrl`)).toBeUndefined();
    expect(win.eval(`runtimeManifest.images['${WORD_A}'].v`)).toBe(1);
    expect(win.eval(`runtimeManifest.images['${WORD_B}']`)).toBeUndefined();
    expect(win.eval('selectedWord.id')).toBe(WORD_B);
    expect(win.document.getElementById('focusWord').textContent).toBe('beta');
  });

  test('wrong-word publish receipt is rejected before completion state changes', async () => {
    const { win, setPublishResponder } = setup();
    await stageSelectedWord(win);
    setPublishResponder(async (meta) => receipt(meta, { wordId: WORD_B }));

    await win.document.getElementById('btnPublishR2').onclick();

    expect(win.eval(`DATASET['expert-high-part1'][0].cloudImageUrl`)).toBeUndefined();
    expect(win.eval(`runtimeManifest.images['${WORD_A}']`)).toBeUndefined();
    expect(win.eval(`stagedImages.has('${WORD_A}')`)).toBe(true);
    expect(win.document.getElementById('toast').textContent).toContain('發布失敗');
  });

  test('publish receipt with a different SHA is rejected before completion state changes', async () => {
    const { win, setPublishResponder } = setup();
    await stageSelectedWord(win);
    setPublishResponder(async (meta) => receipt(meta, { sha256: 'b'.repeat(64) }));

    await win.document.getElementById('btnPublishR2').onclick();

    expect(win.eval(`DATASET['expert-high-part1'][0].cloudImageUrl`)).toBeUndefined();
    expect(win.eval(`stagedImages.has('${WORD_A}')`)).toBe(true);
  });

  test('duplicate publish invocation cannot send the same staged artifact twice', async () => {
    const { win, setPublishResponder } = setup();
    await stageSelectedWord(win);
    const pending = deferred<Record<string, unknown>>();
    const requestSeen = deferred<PublishMetadata>();
    let callCount = 0;
    setPublishResponder((meta) => {
      callCount++;
      requestSeen.resolve(meta);
      return pending.promise;
    });

    const first = win.document.getElementById('btnPublishR2').onclick();
    const second = win.document.getElementById('btnPublishR2').onclick();
    const submitted = await requestSeen.promise;
    pending.resolve(receipt(submitted));
    await Promise.all([first, second]);

    expect(callCount).toBe(1);
  });

  test('pasting the same word while its publish is in flight cannot replace the retryable artifact', async () => {
    const { win, setPublishResponder } = setup();
    await stageSelectedWord(win);
    const original = win.eval(`stagedImages.get('${WORD_A}')`);
    const pending = deferred<Record<string, unknown>>();
    const requestSeen = deferred<PublishMetadata>();
    setPublishResponder((meta) => { requestSeen.resolve(meta); return pending.promise; });

    const publishing = win.document.getElementById('btnPublishR2').onclick();
    const submitted = await requestSeen.promise;
    await stageSelectedWord(win);

    expect(win.eval(`stagedImages.get('${WORD_A}')`)).toBe(original);
    pending.resolve(receipt(submitted));
    await publishing;
  });

  test('a transform started before same-word publish cannot replace its in-flight artifact', async () => {
    const { win, setPublishResponder } = setup();
    await stageSelectedWord(win);
    const original = win.eval(`stagedImages.get('${WORD_A}')`);
    const transformed = deferred<ReturnType<typeof transformedImage>>();
    win.processImageToWebP = () => transformed.promise;
    const transforming = win.handleImageFile(new win.Blob(['next image']));
    const pending = deferred<Record<string, unknown>>();
    const requestSeen = deferred<PublishMetadata>();
    setPublishResponder((meta) => { requestSeen.resolve(meta); return pending.promise; });
    const publishing = win.document.getElementById('btnPublishR2').onclick();
    const submitted = await requestSeen.promise;

    transformed.resolve(transformedImage(win));
    await transforming;
    expect(win.eval(`stagedImages.get('${WORD_A}')`)).toBe(original);
    pending.resolve(receipt(submitted));
    await publishing;
  });

  test('pasting B while A publishes remains allowed and B stays selected', async () => {
    const { win, setPublishResponder } = setup();
    await stageSelectedWord(win);
    const pending = deferred<Record<string, unknown>>();
    const requestSeen = deferred<PublishMetadata>();
    setPublishResponder((meta) => { requestSeen.resolve(meta); return pending.promise; });
    const publishing = win.document.getElementById('btnPublishR2').onclick();
    const submitted = await requestSeen.promise;

    win.eval("selectWord(DATASET['expert-high-part1'][1])");
    await stageSelectedWord(win);
    pending.resolve(receipt(submitted));
    await publishing;

    expect(win.eval(`stagedImages.has('${WORD_B}')`)).toBe(true);
    expect(win.eval('selectedWord.id')).toBe(WORD_B);
    expect(win.document.getElementById('focusWord').textContent).toBe('beta');
  });

  test('retrying the same staged artifact after an uncertain network result reuses publishRequestId', async () => {
    const { win, setPublishResponder } = setup();
    await stageSelectedWord(win);
    const requestIds: string[] = [];
    setPublishResponder(async (meta) => {
      requestIds.push(meta.publishRequestId);
      if (requestIds.length === 1) throw new Error('network interrupted');
      return receipt(meta);
    });

    await win.document.getElementById('btnPublishR2').onclick();
    await win.document.getElementById('btnPublishR2').onclick();

    expect(requestIds).toHaveLength(2);
    expect(requestIds[1]).toBe(requestIds[0]);
    expect(win.eval(`DATASET['expert-high-part1'][0].cloudImageUrl`)).toContain(`/words/${WORD_A}/v1.webp`);
  });

  test('a reconciliation-required partial failure cannot be normally republished', async () => {
    const { win, setPublishResponder } = setup();
    await stageSelectedWord(win);
    let callCount = 0;
    setPublishResponder(async () => {
      callCount++;
      return { success: false, code: 'MANIFEST_COMMIT_FAILED', error: 'partial publication', reconciliationRequired: true };
    });

    await win.document.getElementById('btnPublishR2').onclick();
    await win.document.getElementById('btnPublishR2').onclick();

    expect(callCount).toBe(1);
    expect(win.eval(`stagedImages.has('${WORD_A}')`)).toBe(true);
    expect(win.document.getElementById('toast').textContent).toContain('reconciliation');
  });

  test('restaging the same word does not bypass an unresolved partial publication', async () => {
    const { win, setPublishResponder } = setup();
    await stageSelectedWord(win);
    let callCount = 0;
    setPublishResponder(async (meta) => {
      callCount++;
      return callCount === 1
        ? { success: false, code: 'MANIFEST_COMMIT_FAILED', reconciliationRequired: true }
        : receipt(meta);
    });

    await win.document.getElementById('btnPublishR2').onclick();
    await stageSelectedWord(win);
    await win.document.getElementById('btnPublishR2').onclick();

    expect(callCount).toBe(1);
    expect(win.eval(`DATASET['expert-high-part1'][0].cloudImageUrl`)).toBeUndefined();
  });

  test('single download finds the wordId-keyed staged image', async () => {
    const { win } = setup();
    await stageSelectedWord(win);
    const downloads: string[] = [];
    vi.spyOn(win.HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });

    win.document.getElementById('btnDownloadSingle').click();

    expect(downloads).toEqual([`${WORD_A}.webp`]);
  });

  test('ZIP preserves both wordIds when staged words share a slug', async () => {
    const { win } = setup();
    await stageSelectedWord(win);
    win.eval("selectWord(DATASET['expert-high-part1'][1])");
    await stageSelectedWord(win);
    const names: string[] = [];
    win.JSZip = class {
      file(name: string) { names.push(name); }
      async generateAsync() { return new win.Blob(['zip']); }
    };
    win.URL.createObjectURL = () => 'blob:test';
    vi.spyOn(win.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await win.document.getElementById('btnDownloadZip').onclick();

    expect(names).toEqual([`${WORD_A}.webp`, `${WORD_B}.webp`]);
  });

  test('Next uses wordId order after staged completion rerenders Pending', async () => {
    const { win } = setup();
    await stageSelectedWord(win);
    win.eval("DATASET['expert-high-part1'][0].cloudImageUrl = 'https://example.test/v1.webp'; renderList()");

    win.document.getElementById('btnNextWord').click();

    expect(win.eval('selectedWord.id')).toBe(WORD_B);
    expect(win.document.getElementById('focusWord').textContent).toBe('beta');
  });

  test('tabs, reverse sort, Next, tier selection, and Copy Prompt stay usable', async () => {
    const { win } = setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(win.navigator, 'clipboard', { configurable: true, value: { writeText } });
    win.document.getElementById('btnCopyPrompt').click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('prompt A');

    await stageSelectedWord(win);
    win.document.getElementById('tabCompleted').click();
    expect(win.document.getElementById('listTotal').textContent).toBe('1');
    win.document.getElementById('tabPending').click();
    const sort = win.document.getElementById('sortSelect');
    sort.value = 'desc';
    sort.onchange();
    expect(win.document.getElementById('wordsList').firstElementChild.textContent).toContain('gamma');
    win.eval("selectWord(DATASET['expert-high-part1'][2])");
    win.document.getElementById('btnNextWord').click();
    expect(win.eval('selectedWord.id')).toBe(WORD_B);

    const tier = win.document.getElementById('tierSelect');
    tier.value = 'expert-high-part2';
    tier.onchange();
    expect(win.document.getElementById('listTotal').textContent).toBe('0');
    tier.value = 'expert-high-part1';
    tier.onchange();
    expect(win.eval('selectedWord.id')).toBe(WORD_C);
  });
});
