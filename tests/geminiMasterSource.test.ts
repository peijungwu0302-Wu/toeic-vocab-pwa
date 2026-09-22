import { describe, expect, test } from 'vitest';
import { promptSha256 } from '../automation/gemini/artifact';
import { verifyGeminiPromptSnapshot } from '../automation/worker/geminiMasterSource';

describe('GeminiWebMasterSource contract', () => {
  test('requires the exact immutable prompt hash', () => {
    const prompt = 'Generate a simple image of a blue bicycle.';
    expect(() => verifyGeminiPromptSnapshot(prompt, promptSha256(prompt))).not.toThrow();
    expect(() => verifyGeminiPromptSnapshot(prompt, '0'.repeat(64))).toThrow('Prompt hash');
  });
});
