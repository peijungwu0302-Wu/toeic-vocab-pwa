import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { GeminiWebAdapter } from '../gemini/GeminiWebAdapter';

const ROOT = resolve(process.cwd());
const PROFILE = join(ROOT, '.local', 'gemini-browser-profile');
const OUTPUT = join(ROOT, 'automation-artifacts', 'phase2a-f-resource-recon.json');
const PROMPT = 'Generate a simple image of a red umbrella on a plain white background.';
const PORT = Number(process.env.PHASE2A_RECON_PORT ?? 9553);

function log(message: string): void { console.log(`[Recon] ${new Date().toISOString()} ${message}`); }

async function launchChrome(): Promise<ChildProcess> {
  const candidates = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'];
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error('Chrome executable not found');
  const child = spawn(executable, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--new-window', 'https://gemini.google.com/app'], { windowsHide: false, stdio: 'ignore' });
  log(`Chrome launched pid=${child.pid ?? 'unknown'} port=${PORT}`);
  return child;
}

async function main(): Promise<void> {
  const chrome = await launchChrome();
  const adapter = new GeminiWebAdapter({ profileDirectory: PROFILE, generationTimeoutMs: 180_000 });
  try {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
    await adapter.openOverCDP(`http://127.0.0.1:${PORT}`);
    await adapter.ensureReady();
    const bound = await adapter.submitPrompt(PROMPT, 1);
    const imageReadyAt = await adapter.waitForImageResponse(bound);
    await adapter.pageForDiagnostics().waitForTimeout(3_000);
    const page = adapter.pageForDiagnostics();
    const responseTokenLiteral = JSON.stringify(bound.assistantResponseToken);
    const selectorsLiteral = JSON.stringify(['button[aria-label*="下載原尺寸"]', 'button[aria-label*="Download full"]', 'button[aria-label*="Download original"]']);
    const evidence = await page.evaluate(`(() => {
      const responseToken = ${responseTokenLiteral};
      const officialSelectors = ${selectorsLiteral};
      const response = document.querySelector('[data-phase2a-turn-token="' + CSS.escape(responseToken) + '"]');
      if (!response) return { status: 'RESPONSE_OWNERSHIP_UNCERTAIN' };
      function sanitize(value) { if (!value) return { protocol: 'none', host: null, pathPattern: null, queryParameterNames: [] }; try { const url = new URL(value); return { protocol: url.protocol.replace(':', ''), host: url.hostname || null, pathPattern: url.pathname || '/', queryParameterNames: Array.from(url.searchParams.keys()).sort() }; } catch { return { protocol: value.indexOf('blob:') === 0 ? 'blob' : value.indexOf('data:') === 0 ? 'data' : 'other', host: null, pathPattern: null, queryParameterNames: [] }; } }
      function classify(naturalWidth, renderedWidth) { return naturalWidth > renderedWidth * 1.2 ? 'likely original/high-resolution candidate' : naturalWidth < renderedWidth * 0.75 ? 'likely thumbnail' : 'likely displayed rendition'; }
      const images = Array.from(response.querySelectorAll('img')).map(function (image, index) { const rect = image.getBoundingClientRect(); return { candidateId: 'img-' + (index + 1), tag: image.tagName, role: image.getAttribute('role'), ariaLabel: image.getAttribute('aria-label'), title: image.getAttribute('title'), alt: image.alt, src: sanitize(image.src), currentSrc: sanitize(image.currentSrc), srcset: image.getAttribute('srcset'), sizes: image.getAttribute('sizes'), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, clientWidth: image.clientWidth, clientHeight: image.clientHeight, renderedWidth: rect.width, renderedHeight: rect.height, complete: image.complete, decoding: image.decoding, visible: Boolean(rect.width && rect.height), classification: classify(image.naturalWidth, rect.width) }; });
      const pictures = Array.from(response.querySelectorAll('picture')).map(function (picture, index) { return { index, sources: Array.from(picture.querySelectorAll('source')).map(function (source) { return { srcset: source.getAttribute('srcset'), media: source.getAttribute('media'), type: source.getAttribute('type'), sizes: source.getAttribute('sizes') }; }) }; });
      const controls = Array.from(response.querySelectorAll('button,[role="button"]')).filter(function (control) { return officialSelectors.some(function (selector) { return control.matches(selector); }); }).map(function (control) { return { tag: control.tagName, text: (control.textContent || '').trim().slice(0, 80), ariaLabel: control.getAttribute('aria-label'), title: control.getAttribute('title'), href: control.href || null, hrefPresent: Boolean(control.href), downloadAttribute: control.getAttribute('download'), attributes: Array.from(control.attributes).filter(function (attribute) { return attribute.name.indexOf('data-') === 0; }).map(function (attribute) { return attribute.name; }) }; });
      const ancestors = Array.from(response.querySelectorAll('img')).map(function (image) { const parent = image.closest('a'); return parent ? { tag: parent.tagName, href: sanitize(parent.href), target: parent.getAttribute('target'), download: parent.getAttribute('download') } : null; }).filter(Boolean);
      const backgroundResources = Array.from(response.querySelectorAll('*')).slice(0, 200).map(function (element) { const match = getComputedStyle(element).backgroundImage.match(/url\\(["']?([^"')]+)["']?\\)/); return match ? sanitize(match[1]) : null; }).filter(Boolean);
      const hosts = new Set(images.reduce(function (all, image) { if (image.src.host) all.push(image.src.host); if (image.currentSrc.host) all.push(image.currentSrc.host); return all; }, []));
      const performanceResources = performance.getEntriesByType('resource').filter(function (entry) { try { return hosts.has(new URL(entry.name).hostname); } catch { return false; } }).slice(-30).map(function (entry) { return { initiatorType: entry.initiatorType, resource: sanitize(entry.name), transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize }; });
      return { status: 'ok', responseTag: response.tagName, images, pictures, controls, ancestors, backgroundResources, performanceResources };
    })()`);
    await mkdir(join(ROOT, 'automation-artifacts'), { recursive: true });
    const output = { prompt: PROMPT, responseIdentity: bound.assistantResponseToken, responseDetectedAt: bound.responseDetectedAt, imageReadyAt, conversationUrl: adapter.conversationUrl(), evidence };
    await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    log(`sanitized evidence written to ${OUTPUT}`);
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await adapter.close().catch(() => undefined);
    chrome.kill();
  }
}

main().catch((error) => { console.error(`[Recon] HARD STOP ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
