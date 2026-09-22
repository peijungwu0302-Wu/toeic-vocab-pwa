import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAttemptMetadata, enrichMetadataWithArtifact, metadataFailure, writeAttemptMetadata } from './gemini/artifact';
import { GeminiWebAdapter } from './gemini/GeminiWebAdapter';
import { GeminiAdapterError } from './gemini/types';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const promptIndex = args.indexOf('--prompt');
const loginMode = args.includes('--login');
const fiveMode = args.includes('--five');
const onePrompt = promptIndex >= 0 ? args[promptIndex + 1] : undefined;

if (promptIndex >= 0 && !onePrompt) throw new Error('--prompt requires text');
if (loginMode && (fiveMode || onePrompt)) throw new Error('--login cannot be combined with generation arguments');
if (!loginMode && !fiveMode && !onePrompt) throw new Error('Use --login, --prompt "...", or --five');

const prompts = fiveMode
  ? [
      'A single red umbrella on a plain white background, centered, simple product illustration.',
      'A single blue bicycle on a plain white background, centered, simple product illustration.',
      'A single yellow ceramic mug on a plain white background, centered, simple product illustration.',
      'A single green backpack on a plain white background, centered, simple product illustration.',
      'A single purple desk lamp on a plain white background, centered, simple product illustration.',
    ]
  : onePrompt ? [onePrompt] : [];

const runName = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const runDirectory = join(projectRoot, 'automation-artifacts', 'phase2a', runName);
const profileDirectory = join(projectRoot, '.local', 'gemini-browser-profile');
const adapter = new GeminiWebAdapter({ profileDirectory });

async function run(): Promise<void> {
  await adapter.open();
  if (loginMode) {
    await adapter.waitForManualLogin();
    await adapter.close();
    return;
  }
  await adapter.ensureReady();
  await mkdir(runDirectory, { recursive: true });
  for (const [zeroIndex, prompt] of prompts.entries()) {
    const attemptNumber = zeroIndex + 1;
    const attemptDirectory = join(runDirectory, `attempt-${String(attemptNumber).padStart(3, '0')}`);
    const metadataPath = join(attemptDirectory, 'metadata.json');
    let metadata = createAttemptMetadata({
      attemptNumber,
      promptText: prompt,
      submittedAt: null,
      result: 'failure',
      errorCode: null,
    });
    try {
      if (attemptNumber > 1 && fiveMode) await adapter.newChat();
      metadata = { ...metadata, submittedAt: new Date().toISOString() };
      const bound = await adapter.submitPrompt(prompt, attemptNumber);
      metadata = { ...metadata, responseDetectedAt: bound.responseDetectedAt };
      metadata = { ...metadata, imageReadyAt: await adapter.waitForImageResponse(bound) };
      metadata = { ...metadata, downloadStartedAt: new Date().toISOString() };
      const artifact = await adapter.downloadGeneratedImage(bound, attemptDirectory, projectRoot, attemptNumber);
      metadata = enrichMetadataWithArtifact({
        ...metadata,
        downloadCompletedAt: new Date().toISOString(),
        conversationUrl: adapter.conversationUrl(),
        result: 'success',
      }, artifact, projectRoot);
      await writeAttemptMetadata(metadataPath, metadata);
      console.log(`[Phase2A][${String(attemptNumber).padStart(3, '0')}] attempt completion recorded`);
    } catch (error) {
      const code = error instanceof GeminiAdapterError ? error.code : 'DOM_UNSUPPORTED';
      await writeAttemptMetadata(metadataPath, metadataFailure(metadata, code));
      console.error(`[Gemini] HARD STOP code=${code}`);
      throw error;
    }
  }
  await adapter.close();
}

run().catch(async (error: unknown) => {
  await adapter.close();
  if (error instanceof GeminiAdapterError && error.code === 'LOGIN_REQUIRED') {
    console.error('Manual-login checkpoint: run "npm run phase2a -- --login", then sign in to Gemini in the visible dedicated browser window.');
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
