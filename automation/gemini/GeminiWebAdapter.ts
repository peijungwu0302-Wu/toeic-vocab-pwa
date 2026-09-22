import { mkdir, readdir, rename, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { validateArtifact } from './artifact';
import { chooseCompletedDownload, isCompletedDownloadState } from './download';
import { classifyHardStopText, choosePromptSubmissionAction, GEMINI_SELECTORS, type ConversationSnapshot } from './selectors';
import { GeminiAdapterError, type ArtifactDetails, type BoundResponse } from './types';

export interface GeminiWebAdapterOptions {
  profileDirectory: string;
  generationTimeoutMs?: number;
  downloadTimeoutMs?: number;
}

interface Boundary extends ConversationSnapshot {
  captureId: string;
}

interface UserTurn extends Boundary {
  userTurnToken: string;
  promptText: string;
}

export class GeminiWebAdapter {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private captureNumber = 0;
  private readonly generationTimeoutMs: number;
  private readonly downloadTimeoutMs: number;

  constructor(private readonly options: GeminiWebAdapterOptions) {
    this.generationTimeoutMs = options.generationTimeoutMs ?? 120_000;
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? 30_000;
  }

  async open(): Promise<void> {
    await mkdir(this.options.profileDirectory, { recursive: true });
    try {
      this.context = await chromium.launchPersistentContext(this.options.profileDirectory, {
        channel: 'chrome',
        headless: false,
        acceptDownloads: false,
        viewport: { width: 1440, height: 1000 },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/singleton|profile|user data directory|already in use|in use/i.test(message)) {
        throw new GeminiAdapterError('PROFILE_IN_USE', 'Dedicated Gemini Chrome profile is already in use; close that browser first', error);
      }
      throw new GeminiAdapterError('GEMINI_NOT_READY', 'Could not launch dedicated Chrome profile', error);
    }
    this.page = this.context.pages()[0] ?? await this.context.newPage();
    this.context.on('close', () => console.log('[Phase2A] context close event'));
    const browser = this.context.browser();
    browser?.on('disconnected', () => console.log('[Phase2A] browser disconnected event'));
    this.page.on('close', () => console.log('[Phase2A] page close event'));
    await this.page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
  }

  /** Attach to an externally launched Chrome for isolated transport experiments. */
  async openOverCDP(endpoint: string): Promise<void> {
    try {
      const browser: Browser = await chromium.connectOverCDP(endpoint);
      this.context = browser.contexts()[0] ?? await browser.newContext();
      this.page = this.context.pages().find((candidate) => /gemini\.google\.com/.test(candidate.url()))
        ?? this.context.pages()[0]
        ?? await this.context.newPage();
      this.context.on('close', () => console.log('[Phase2A] context close event'));
      browser.on('disconnected', () => console.log('[Phase2A] browser disconnected event'));
      this.page.on('close', () => console.log('[Phase2A] page close event'));
    } catch (error) {
      throw new GeminiAdapterError('GEMINI_NOT_READY', 'Could not attach Playwright to external Chrome over CDP', error);
    }
  }

  async prepareOfficialDownload(bound: BoundResponse): Promise<{ control: Locator; diagnostics: unknown }> {
    const page = this.requirePage();
    const downloadToken = `download-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const choice = await page.evaluate(({ responseToken, selectors, token }) => {
      const response = document.querySelector(`[data-phase2a-turn-token="${CSS.escape(responseToken)}"]`);
      if (!response) return { status: 'missing-response' as const };
      const controls = [...new Set(selectors.flatMap((selector) => [...response.querySelectorAll<HTMLButtonElement>(selector)]))]
        .filter((control) => {
          const style = window.getComputedStyle(control);
          return style.visibility !== 'hidden' && style.display !== 'none' && !control.disabled;
        });
      const diagnostics = {
        responseTag: response.tagName,
        controls: [...response.querySelectorAll<HTMLElement>('button,[role="button"]')].slice(0, 20).map((control) => ({
          tag: control.tagName,
          aria: control.getAttribute('aria-label'),
          title: control.getAttribute('title'),
          text: (control.textContent ?? '').trim().slice(0, 80),
        })),
        images: [...response.querySelectorAll<HTMLImageElement>('img')].map((image) => ({
          width: image.naturalWidth,
          height: image.naturalHeight,
          srcHost: (() => { try { return new URL(image.currentSrc || image.src).hostname; } catch { return null; } })(),
        })),
      };
      if (controls.length !== 1) return { status: 'control-count' as const, count: controls.length, diagnostics };
      controls[0].setAttribute('data-phase2a-download-token', token);
      return { status: 'ok' as const, diagnostics };
    }, { responseToken: bound.assistantResponseToken, selectors: GEMINI_SELECTORS.officialDownload, token: downloadToken });
    if (choice.status === 'missing-response') throw new GeminiAdapterError('RESPONSE_OWNERSHIP_UNCERTAIN', 'Bound response vanished before hybrid download');
    if (choice.status !== 'ok') throw new GeminiAdapterError('DOWNLOAD_CONTROL_NOT_FOUND', `Expected one official response-scoped control; found ${choice.count}`);
    const control = page.locator(`[data-phase2a-download-token="${downloadToken}"]`);
    await control.scrollIntoViewIfNeeded();
    return { control, diagnostics: choice.diagnostics };
  }

  async clickPreparedDownload(control: Locator): Promise<void> {
    await this.requirePage().waitForTimeout(500);
    await control.click();
  }

  async ensureReady(): Promise<void> {
    const page = this.requirePage();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await this.assertNoHardStop();
      if (await this.firstVisible(page, GEMINI_SELECTORS.composer)) {
        // Gemini can render the composer before its unauthenticated shell finishes loading.
        // Require a short stable window so LOGIN_REQUIRED is not missed during that transition.
        await page.waitForTimeout(1_000);
        await this.assertNoHardStop();
        console.log('[Gemini] browser ready');
        return;
      }
      await page.waitForTimeout(500);
    }
    const text = await page.locator('body').innerText().catch(() => '');
    if (/sign in|登入.*google|登入以繼續/i.test(text)) {
      throw new GeminiAdapterError('LOGIN_REQUIRED', 'Gemini requires manual Google login in the dedicated browser profile');
    }
    throw new GeminiAdapterError('GEMINI_NOT_READY', 'Gemini prompt composer was not available after 20 seconds');
  }

  async waitForManualLogin(timeoutMs = 300_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    console.log('[Gemini] manual login required; complete Google login in the visible dedicated Chrome window');
    while (Date.now() < deadline) {
      try {
        await this.ensureReady();
        return;
      } catch (error) {
        if (!(error instanceof GeminiAdapterError) || error.code !== 'LOGIN_REQUIRED') throw error;
      }
      await this.requirePage().waitForTimeout(1_000);
    }
    throw new GeminiAdapterError('LOGIN_REQUIRED', 'Manual login did not complete before timeout');
  }

  async submitPrompt(prompt: string, attemptNumber: number): Promise<BoundResponse> {
    const page = this.requirePage();
    await this.ensureReady();
    const before = await this.captureBoundary();
    const composer = await this.firstVisible(page, GEMINI_SELECTORS.composer);
    if (!composer) throw new GeminiAdapterError('DOM_UNSUPPORTED', 'Gemini composer disappeared before submission');
    let submitError: unknown = null;
    try {
      const blockingOverlay = await this.firstVisible(page, GEMINI_SELECTORS.blockingOverlay);
      if (blockingOverlay) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
      }
      if (await this.firstVisible(page, GEMINI_SELECTORS.blockingOverlay)) {
        const closeSidebar = await this.firstVisible(page, GEMINI_SELECTORS.closeSidebar);
        if (closeSidebar) {
          await closeSidebar.click({ timeout: 2_000 });
          await page.waitForTimeout(150);
        }
      }
      if (await this.firstVisible(page, GEMINI_SELECTORS.blockingOverlay)) {
        throw new GeminiAdapterError('PROMPT_SUBMIT_FAILED', 'Gemini submission area remained blocked by a visible overlay');
      }
      await composer.fill(prompt);
      const send = await this.firstVisible(page, GEMINI_SELECTORS.sendButton);
      if (choosePromptSubmissionAction(Boolean(send)) === 'click') {
        const clickStartedAt = new Date().toISOString();
        const clickUrl = page.url();
        console.log(`[Gemini] Send click start=${clickStartedAt} url=${clickUrl}`);
        try {
          await send?.click({ timeout: 5_000 });
          console.log(`[Gemini] Send click resolved=${new Date().toISOString()} url=${page.url()}`);
        } catch (error) {
          submitError = error;
          console.log(`[Gemini] Send click rejected=${new Date().toISOString()} url=${page.url()} waiting for user-turn confirmation without retry`);
        }
      } else {
        try {
          await composer.press('Enter');
        } catch (error) {
          submitError = error;
          console.log('[Gemini] Enter submission did not resolve; waiting for user-turn confirmation without retry');
        }
      }
    } catch (error) {
      throw new GeminiAdapterError('PROMPT_SUBMIT_FAILED', 'Could not submit prompt through Gemini UI', error);
    }
    console.log(`[Gemini] submit action attempted attempt=${String(attemptNumber).padStart(3, '0')}`);
    let user: UserTurn;
    try {
      user = await this.waitForConfirmedUserTurn(before, prompt);
    } catch (error) {
      if (submitError) throw new GeminiAdapterError('PROMPT_SUBMIT_FAILED', 'Submission action failed and no new user turn was confirmed', submitError);
      throw error;
    }
    console.log(`[Gemini] prompt submitted and user turn confirmed attempt=${String(attemptNumber).padStart(3, '0')}`);
    const response = await this.waitForOwnedResponse(user);
    console.log('[Gemini] response bound');
    return {
      userTurnToken: user.userTurnToken,
      assistantResponseToken: response.assistantResponseIds[0],
      responseDetectedAt: new Date().toISOString(),
    };
  }

  async waitForImageResponse(bound: BoundResponse): Promise<string> {
    const page = this.requirePage();
    const deadline = Date.now() + this.generationTimeoutMs;
    while (Date.now() < deadline) {
      await this.assertNoHardStop();
      const state = await page.evaluate(({ responseToken, activeSelectors, loadingSelectors }) => {
        const response = document.querySelector(`[data-phase2a-turn-token="${CSS.escape(responseToken)}"]`);
        if (!response) return { responsePresent: false, readyImageCount: 0, loading: false };
        const images = [...response.querySelectorAll('img')].filter((image) =>
          image.naturalWidth > 128 && image.naturalHeight > 128,
        );
        const active = activeSelectors.some((selector) => response.querySelector(selector));
        const loading = loadingSelectors.some((selector) => response.querySelector(selector));
        return { responsePresent: true, readyImageCount: images.length, loading: active || loading };
      }, {
        responseToken: bound.assistantResponseToken,
        activeSelectors: GEMINI_SELECTORS.activeGeneration,
        loadingSelectors: GEMINI_SELECTORS.loading,
      });
      if (!state.responsePresent) {
        throw new GeminiAdapterError('RESPONSE_OWNERSHIP_UNCERTAIN', 'Bound assistant response was replaced before image readiness verification');
      }
      if (state.readyImageCount > 0 && !state.loading) {
        console.log('[Gemini] image ready');
        return new Date().toISOString();
      }
      await page.waitForTimeout(1_000);
    }
    throw new GeminiAdapterError('IMAGE_GENERATION_TIMEOUT', 'Bound Gemini response did not show a ready image before timeout');
  }

  async downloadGeneratedImage(bound: BoundResponse, attemptDirectory: string, projectRoot: string, attemptNumber = 1): Promise<ArtifactDetails> {
    const page = this.requirePage();
    const label = String(attemptNumber).padStart(3, '0');
    const downloadDirectory = join(attemptDirectory, 'downloads');
    await mkdir(downloadDirectory, { recursive: true });
    if ((await readdir(downloadDirectory)).length !== 0) {
      throw new GeminiAdapterError('DOWNLOAD_FAILED', 'Per-attempt CDP download directory was not empty');
    }
    const downloadToken = `download-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const choice = await page.evaluate(({ responseToken, selectors, downloadToken: token }) => {
      const response = document.querySelector(`[data-phase2a-turn-token="${CSS.escape(responseToken)}"]`);
      if (!response) return { status: 'missing-response' };
      const controls = [...new Set(selectors.flatMap((selector) => [...response.querySelectorAll<HTMLButtonElement>(selector)]))]
        .filter((control) => {
          const style = window.getComputedStyle(control);
          return style.visibility !== 'hidden' && style.display !== 'none' && !control.disabled;
        });
      if (controls.length !== 1) return {
        status: 'control-count',
        count: controls.length,
        availableControls: [...response.querySelectorAll<HTMLElement>('button,[role="button"]')].slice(0, 20).map((control) => ({
          tag: control.tagName,
          aria: control.getAttribute('aria-label'),
          title: control.getAttribute('title'),
          tooltip: control.getAttribute('data-tooltip'),
          text: (control.textContent ?? '').trim().slice(0, 80),
        })),
      };
      controls[0].setAttribute('data-phase2a-download-token', token);
      return { status: 'ok' };
    }, { responseToken: bound.assistantResponseToken, selectors: GEMINI_SELECTORS.officialDownload, downloadToken });
    if (choice.status === 'missing-response') {
      throw new GeminiAdapterError('RESPONSE_OWNERSHIP_UNCERTAIN', 'Bound response vanished before official download click');
    }
    if (choice.status !== 'ok') {
      const controls = 'availableControls' in choice ? ` controls=${JSON.stringify(choice.availableControls)}` : '';
      throw new GeminiAdapterError('DOWNLOAD_CONTROL_NOT_FOUND', `Expected one official download control in bound response; found ${'count' in choice ? choice.count : 0}${controls}`);
    }
    const control = page.locator(`[data-phase2a-download-token="${downloadToken}"]`);
    const downloadStartedAt = new Date().toISOString();
    const browser = this.context?.browser();
    if (!browser) throw new GeminiAdapterError('DOWNLOAD_FAILED', 'Browser was unavailable before CDP download setup');
    const cdp = await browser.newBrowserCDPSession();
    let downloadGuid: string | null = null;
    let suggestedFilename: string | null = null;
    let resolveCompleted: ((filePath?: string) => void) | null = null;
    let rejectCompleted: ((error: Error) => void) | null = null;
    const completion = new Promise<string | undefined>((resolvePromise, rejectPromise) => {
      resolveCompleted = resolvePromise;
      rejectCompleted = rejectPromise;
    });
    const timeout = setTimeout(() => rejectCompleted?.(new Error('CDP download completion timeout')), this.downloadTimeoutMs);
    const onWillBegin = (event: { guid: string; suggestedFilename?: string }) => {
      downloadGuid = event.guid;
      suggestedFilename = event.suggestedFilename ?? null;
      console.log(`[Phase2A][${label}] CDP downloadWillBegin guid=${event.guid}`);
    };
    const onProgress = (event: { guid: string; state: string; receivedBytes?: number; totalBytes?: number; filePath?: string }) => {
      if (event.guid !== downloadGuid) return;
      console.log(`[Phase2A][${label}] CDP download progress state=${event.state} received=${event.receivedBytes ?? 0} total=${event.totalBytes ?? 0}`);
      if (isCompletedDownloadState(event.state)) resolveCompleted?.(event.filePath);
      if (event.state === 'canceled') rejectCompleted?.(new Error('CDP download was canceled'));
    };
    const onDisconnected = () => rejectCompleted?.(new Error('Browser disconnected before CDP download completion'));
    cdp.on('Browser.downloadWillBegin', onWillBegin);
    cdp.on('Browser.downloadProgress', onProgress);
    browser.on('disconnected', onDisconnected);
    try {
      await cdp.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadDirectory,
        eventsEnabled: true,
      });
      console.log(`[Phase2A][${label}] CDP download behavior configured`);
      await control.click();
      console.log(`[Phase2A][${label}] official download clicked`);
      const eventFilePath = await completion;
      clearTimeout(timeout);
      const sourcePath = await this.waitForCompletedDownload(downloadDirectory, eventFilePath);
      console.log(`[Phase2A][${label}] artifact located path=${sourcePath}`);
      const originalFilename = suggestedFilename ?? basename(sourcePath);
      const extension = extname(originalFilename).toLowerCase() || extname(sourcePath).toLowerCase() || '.bin';
      const artifactPath = join(attemptDirectory, `image${extension}`);
      await rename(sourcePath, artifactPath);
      console.log(`[Phase2A][${label}] artifact validation start`);
      const validation = await validateArtifact(artifactPath);
      console.log(`[Phase2A][${label}] artifact validation success`);
      const relativeArtifactPath = resolve(artifactPath).slice(resolve(projectRoot).length + 1).replaceAll('\\', '/');
      console.log(`[Gemini] download complete sha256=${validation.sha256}`);
      return {
        artifactPath,
        relativeArtifactPath,
        originalFilename: basename(originalFilename),
        fileExtension: extension,
        ...validation,
      };
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof GeminiAdapterError) throw error;
      const detail = error instanceof Error ? `: ${error.message}` : `: ${String(error)}`;
      throw new GeminiAdapterError('DOWNLOAD_FAILED', `CDP Gemini download did not complete (started ${downloadStartedAt})${detail}`, error);
    } finally {
      browser.off('disconnected', onDisconnected);
      cdp.off('Browser.downloadWillBegin', onWillBegin);
      cdp.off('Browser.downloadProgress', onProgress);
      await cdp.detach().catch(() => undefined);
    }
  }

  private async waitForCompletedDownload(downloadDirectory: string, eventFilePath?: string): Promise<string> {
    const deadline = Date.now() + this.downloadTimeoutMs;
    const directoryRoot = resolve(downloadDirectory) + '\\';
    if (eventFilePath) {
      const resolvedEventPath = resolve(eventFilePath);
      if (!resolvedEventPath.startsWith(directoryRoot)) throw new Error('CDP download path escaped the isolated attempt directory');
    }
    while (Date.now() < deadline) {
      const entries = await readdir(downloadDirectory);
      if (entries.some((entry) => entry.endsWith('.crdownload'))) {
        await this.requirePage().waitForTimeout(200);
        continue;
      }
      if (entries.length > 1) throw new Error(`Expected exactly one completed artifact, found ${entries.length}`);
      if (entries.length === 1) {
        const filename = chooseCompletedDownload(entries);
        const candidate = join(downloadDirectory, filename);
        const details = await stat(candidate);
        if (details.isFile() && details.size > 0) return candidate;
      }
      await this.requirePage().waitForTimeout(200);
    }
    throw new Error('CDP download completed event did not produce a stable file');
  }

  async newChat(): Promise<void> {
    const page = this.requirePage();
    const control = await this.firstVisible(page, GEMINI_SELECTORS.newChat);
    if (!control) throw new GeminiAdapterError('DOM_UNSUPPORTED', 'Gemini New Chat control was not found');
    await control.click();
    await page.waitForTimeout(500);
    await this.ensureReady();
    console.log('[Gemini] new chat ready');
  }

  async close(): Promise<void> {
    console.log('[Phase2A] adapter close requested');
    await this.context?.close();
    this.context = null;
    this.page = null;
  }

  /** Detach a connectOverCDP session without closing the externally-owned Chrome. */
  async disconnect(): Promise<void> {
    const browser = this.context?.browser();
    // Playwright's connected-browser close path disconnects from the remote
    // browser rather than terminating the externally launched Chrome process.
    await browser?.close();
    this.context = null;
    this.page = null;
  }

  conversationUrl(): string | null {
    return this.page?.url() ?? null;
  }

  /** Read-only page access for bounded diagnostics; does not alter adapter behavior. */
  pageForDiagnostics(): Page {
    return this.requirePage();
  }

  private async captureBoundary(): Promise<Boundary> {
    const page = this.requirePage();
    const captureId = `boundary-${++this.captureNumber}-${Date.now()}`;
    return page.evaluate(({ captureId: id, userSelectors, assistantSelectors }) => {
      const userTurnIds: string[] = [];
      const assistantResponseIds: string[] = [];
      const groups = [
        { selectors: userSelectors, role: 'user', output: userTurnIds },
        { selectors: assistantSelectors, role: 'assistant', output: assistantResponseIds },
      ];
      for (const group of groups) {
        const nodes: HTMLElement[] = [];
        for (const selector of group.selectors) {
          const matches = document.querySelectorAll<HTMLElement>(selector);
          for (let index = 0; index < matches.length; index += 1) {
            if (!nodes.includes(matches[index])) nodes.push(matches[index]);
          }
        }
        for (let index = 0; index < nodes.length; index += 1) {
          const node = nodes[index];
          const existing = node.getAttribute('data-phase2a-turn-token');
          const token = existing ?? `${id}-${group.role}-${index}`;
          if (!existing) {
            node.setAttribute('data-phase2a-turn-token', token);
            node.setAttribute('data-phase2a-turn-role', group.role);
          }
          group.output.push(token);
        }
      }
      return {
        captureId: id,
        userTurnIds,
        assistantResponseIds,
      };
    }, { captureId, userSelectors: GEMINI_SELECTORS.userTurn, assistantSelectors: GEMINI_SELECTORS.assistantResponse });
  }

  private async waitForConfirmedUserTurn(before: Boundary, prompt: string): Promise<UserTurn> {
    const page = this.requirePage();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      await this.assertNoHardStop();
      const result = await page.evaluate(({ userSelectors, previous, promptText, captureId }) => {
        const nodes = [...new Set(userSelectors.flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)]))];
        const normalizedPrompt = promptText.replace(/\s+/g, ' ').trim();
        const matches = nodes.filter((node) => !previous.includes(node.getAttribute('data-phase2a-turn-token') ?? '') &&
          node.innerText.replace(/\s+/g, ' ').trim().includes(normalizedPrompt));
        if (matches.length !== 1) return { count: matches.length };
        const token = `${captureId}-submitted-user`;
        matches[0].setAttribute('data-phase2a-turn-token', token);
        matches[0].setAttribute('data-phase2a-turn-role', 'user');
        return { count: 1, token };
      }, { userSelectors: GEMINI_SELECTORS.userTurn, previous: before.userTurnIds, promptText: prompt, captureId: before.captureId });
      if (result.count === 1 && result.token) return { ...before, userTurnToken: result.token, promptText: prompt };
      if (result.count > 1) throw new GeminiAdapterError('USER_TURN_NOT_CONFIRMED', 'More than one new user turn matched the submitted prompt');
      await page.waitForTimeout(500);
    }
    throw new GeminiAdapterError('USER_TURN_NOT_CONFIRMED', 'Submitted prompt did not appear as one new Gemini user turn');
  }

  private async waitForOwnedResponse(user: UserTurn): Promise<Boundary> {
    const page = this.requirePage();
    const deadline = Date.now() + this.generationTimeoutMs;
    while (Date.now() < deadline) {
      await this.assertNoHardStop();
      const result = await page.evaluate(({ userToken, userSelectors, promptText, assistantSelectors, previous, captureId }) => {
        let user = document.querySelector<HTMLElement>(`[data-phase2a-turn-token="${CSS.escape(userToken)}"]`);
        if (!user) {
          const normalizedPrompt = promptText.replace(/\s+/g, ' ').trim();
          const reboundCandidates: HTMLElement[] = [];
          for (const selector of userSelectors) {
            const matches = document.querySelectorAll<HTMLElement>(selector);
            for (let index = 0; index < matches.length; index += 1) {
              const candidate = matches[index];
              if (reboundCandidates.includes(candidate)) continue;
              const token = candidate.getAttribute('data-phase2a-turn-token') ?? '';
              if (!previous.includes(token) && candidate.innerText.replace(/\s+/g, ' ').trim().includes(normalizedPrompt)) {
                reboundCandidates.push(candidate);
              }
            }
          }
          if (reboundCandidates.length !== 1) return { status: reboundCandidates.length > 1 ? 'ambiguous-user' : 'missing-user' };
          user = reboundCandidates[0];
          user.setAttribute('data-phase2a-turn-token', userToken);
          user.setAttribute('data-phase2a-turn-role', 'user');
        }
        const assistants = [...new Set(assistantSelectors.flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)]))];
        const candidate = assistants.filter((node) => {
          const position = user.compareDocumentPosition(node);
          return Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING) && !previous.includes(node.getAttribute('data-phase2a-turn-token') ?? '');
        });
        if (candidate.length === 0) return { status: 'waiting' };
        if (candidate.length !== 1) return {
          status: 'ambiguous',
          count: candidate.length,
          candidateInfo: candidate.slice(0, 5).map((node) => ({
            tag: node.tagName,
            role: node.getAttribute('role'),
            testId: node.getAttribute('data-test-id'),
            author: node.getAttribute('data-message-author-role'),
          })),
        };
        const token = `${captureId}-assistant-response`;
        candidate[0].setAttribute('data-phase2a-turn-token', token);
        candidate[0].setAttribute('data-phase2a-turn-role', 'assistant');
        return { status: 'ok', token };
      }, {
        userToken: user.userTurnToken,
        userSelectors: GEMINI_SELECTORS.userTurn,
        promptText: user.promptText,
        assistantSelectors: GEMINI_SELECTORS.assistantResponse,
        previous: user.assistantResponseIds,
        captureId: user.captureId,
      });
      if (result.status === 'ok' && result.token) {
        return { captureId: user.captureId, userTurnIds: [...user.userTurnIds, user.userTurnToken], assistantResponseIds: [result.token] };
      }
      if (result.status === 'missing-user' || result.status === 'ambiguous-user' || result.status === 'ambiguous') {
        const detail = result.status === 'ambiguous' ? ` candidates=${JSON.stringify(result.candidateInfo ?? [])}` : '';
        throw new GeminiAdapterError('RESPONSE_OWNERSHIP_UNCERTAIN', `Could not bind exactly one assistant response after this submitted user turn${detail}`);
      }
      await page.waitForTimeout(500);
    }
    throw new GeminiAdapterError('RESPONSE_NOT_FOUND', 'No assistant response appeared after the confirmed user turn');
  }

  private async assertNoHardStop(): Promise<void> {
    const text = await this.requirePage().locator('body').innerText().catch(() => '');
    const code = classifyHardStopText(text);
    if (code) throw new GeminiAdapterError(code, `Gemini hard-stop state detected: ${code}`);
  }

  private async firstVisible(scope: Page | Locator, selectors: readonly string[]): Promise<Locator | null> {
    for (const selector of selectors) {
      const candidate = scope.locator(selector);
      const count = await candidate.count();
      for (let index = 0; index < count; index += 1) {
        const item = candidate.nth(index);
        if (await item.isVisible().catch(() => false)) return item;
      }
    }
    return null;
  }

  private requirePage(): Page {
    if (!this.page) throw new GeminiAdapterError('GEMINI_NOT_READY', 'Browser has not been opened');
    return this.page;
  }
}
