// @vitest-environment node

import { describe, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAttemptMetadata,
  promptSha256,
  validateArtifact,
  writeAttemptMetadata,
} from '../automation/gemini/artifact';
import {
  bindOwnedAssistantResponse,
  classifyHardStopText,
  chooseFirstAvailableSelector,
  choosePromptSubmissionAction,
  type ConversationSnapshot,
} from '../automation/gemini/selectors';
import { chooseCompletedDownload, isCompletedDownloadState } from '../automation/gemini/download';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlV8f8AAAAASUVORK5CYII=',
  'base64',
);

describe('Phase 2A Gemini adapter pure contracts', () => {
  test('hashes the exact prompt text deterministically', () => {
    expect(promptSha256('red umbrella')).toBe(
      'e01b7fb71f18f52820ae27daafef8cf808f923dd89d8b9564a9cef0455a2b991',
    );
    expect(promptSha256('red umbrella ')).not.toBe(promptSha256('red umbrella'));
  });

  test('validates downloaded image bytes and records original-byte SHA', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phase2a-artifact-'));
    const imagePath = join(directory, 'original.png');
    try {
      await writeFile(imagePath, PNG_1X1);
      const artifact = await validateArtifact(imagePath);
      expect(artifact.width).toBe(1);
      expect(artifact.height).toBe(1);
      expect(artifact.mediaType).toBe('image/png');
      expect(artifact.byteSize).toBe(PNG_1X1.length);
      expect(artifact.sha256).toHaveLength(64);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('rejects a non-image download instead of trusting the extension', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phase2a-artifact-'));
    const imagePath = join(directory, 'pretend.png');
    try {
      await writeFile(imagePath, 'not an image');
      await expect(validateArtifact(imagePath)).rejects.toMatchObject({ code: 'ARTIFACT_INVALID' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('serializes metadata without browser session secrets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phase2a-metadata-'));
    try {
      const metadata = createAttemptMetadata({
        attemptNumber: 1,
        promptText: 'red umbrella',
        submittedAt: '2026-09-21T00:00:00.000Z',
        result: 'success',
        errorCode: null,
      });
      const target = join(directory, 'metadata.json');
      await writeAttemptMetadata(target, metadata);
      const stored = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>;
      expect(stored.promptSha256).toBe(promptSha256('red umbrella'));
      expect(JSON.stringify(stored)).not.toMatch(/cookie|token|password/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('chooses the first currently available selector fallback', () => {
    expect(chooseFirstAvailableSelector(['first', 'second', 'third'], new Set(['second']))).toBe('second');
    expect(chooseFirstAvailableSelector(['first'], new Set())).toBeNull();
  });

  test('keeps a selector for the visible Gemini drawer backdrop that can block submission', async () => {
    const { GEMINI_SELECTORS } = await import('../automation/gemini/selectors');
    expect(GEMINI_SELECTORS.blockingOverlay).toContain('.mat-drawer-backdrop.mat-drawer-shown');
    expect(GEMINI_SELECTORS.closeSidebar).toContain('button[aria-label*="關閉側欄"]');
  });

  test('allows Enter fallback only when no Send control was available', async () => {
    expect(choosePromptSubmissionAction(true)).toBe('click');
    expect(choosePromptSubmissionAction(false)).toBe('enter');
  });

  test('accepts exactly one completed artifact and rejects temporary or ambiguous files', () => {
    expect(chooseCompletedDownload(['image.jfif'])).toBe('image.jfif');
    expect(() => chooseCompletedDownload(['image.jfif', 'other.png'])).toThrowError(/exactly one/);
    expect(() => chooseCompletedDownload(['image.jfif', 'image.jfif.crdownload'])).toThrowError(/temporary/);
    expect(isCompletedDownloadState('completed')).toBe(true);
    expect(isCompletedDownloadState('inProgress')).toBe(false);
  });

  test('classifies Gemini hard-stop messages without retrying', () => {
    expect(classifyHardStopText('Please complete the CAPTCHA to continue')).toBe('CAPTCHA_DETECTED');
    expect(classifyHardStopText('You have reached your quota for today')).toBe('QUOTA_OR_RATE_LIMIT');
    expect(classifyHardStopText('登入')).toBe('LOGIN_REQUIRED');
    expect(classifyHardStopText('Normal response text')).toBeNull();
  });

  test('binds exactly one new assistant response after the confirmed new user turn', () => {
    const before: ConversationSnapshot = {
      userTurnIds: ['u-1'],
      assistantResponseIds: ['a-1'],
    };
    expect(bindOwnedAssistantResponse(before, {
      userTurnIds: ['u-1', 'u-2'],
      assistantResponseIds: ['a-1', 'a-2'],
    }, 'u-2')).toBe('a-2');
  });

  test('rejects a missing, stale, or ambiguous response boundary', () => {
    const before: ConversationSnapshot = { userTurnIds: ['u-1'], assistantResponseIds: ['a-1'] };
    try {
      bindOwnedAssistantResponse(before, { userTurnIds: ['u-1'], assistantResponseIds: ['a-1', 'a-2'] }, 'u-2');
      throw new Error('Expected USER_TURN_NOT_CONFIRMED');
    } catch (error) {
      expect(error).toMatchObject({ code: 'USER_TURN_NOT_CONFIRMED' });
    }
    try {
      bindOwnedAssistantResponse(before, { userTurnIds: ['u-1', 'u-2'], assistantResponseIds: ['a-1', 'a-2', 'a-3'] }, 'u-2');
      throw new Error('Expected RESPONSE_OWNERSHIP_UNCERTAIN');
    } catch (error) {
      expect(error).toMatchObject({ code: 'RESPONSE_OWNERSHIP_UNCERTAIN' });
    }
  });
});
