import { createClient } from '@supabase/supabase-js';
import { ImagePublisherClient } from './worker/publisherClient';
import { RuntimeManifestReader } from './worker/runtimeManifest';
import { sharpDeliveryEncoder } from './worker/imageDelivery';
import { GeminiWebMasterSource } from './worker/geminiMasterSource';
import { SupabaseAutomationControlPlane } from './worker/supabaseControlPlane';
import { runSingleJob } from './worker/singleJobWorker';
import { resolveControlledCandidate } from './worker/candidateResolver';
import { phase2bRuntimeConfig, resolvePublisherSecret } from './worker/runtimeConfig';

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`MISSING_RUNTIME_CONFIG:${name}`);
  return value;
}

async function main(): Promise<void> {
  if (!process.argv.includes('--confirm-one-job')) {
    throw new Error('HARD_STOP: pass --confirm-one-job only after controlled-job approval; this runner never claims by default');
  }
  const config = phase2bRuntimeConfig();
  const ownerId = required(config.ownerId, 'AUTOMATION_OWNER_ID');
  const runId = required(config.runId, 'PHASE2B_RUN_ID');
  const wordId = required(config.wordId, 'PHASE2B_WORD_ID');
  const candidate = await resolveControlledCandidate(wordId);
  const publisherSecret = await resolvePublisherSecret(config);
  const supabase = createClient(config.supabaseUrl, required(config.supabaseServiceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  const control = new SupabaseAutomationControlPlane(supabase, ownerId);
  const source = new GeminiWebMasterSource({
    profileDirectory: config.profileDirectory,
    cdpEndpoint: `http://127.0.0.1:${config.cdpPort}`,
    artifactRoot: config.artifactRoot,
  });
  await source.open(true);
  try {
    const result = await runSingleJob({
      ownerId,
      runId,
      artifactRoot: config.artifactRoot,
      candidate,
      control,
      gemini: source,
      publisher: new ImagePublisherClient(config.publisherUrl, required(publisherSecret.value, 'IMAGE_PUBLISHER_TOKEN_OR_LOCAL_SECRET')),
      manifest: new RuntimeManifestReader(config.manifestUrl),
      webp: sharpDeliveryEncoder,
    });
    console.log(JSON.stringify({ status: result.status, liveJob: true }, null, 2));
  } finally {
    await source.close();
  }
}

main().catch((error) => { console.error(`[Phase2B] HARD STOP ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
