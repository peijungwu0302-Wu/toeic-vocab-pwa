import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { GeminiWebAdapter } from '../gemini/GeminiWebAdapter';
import { resolveControlledCandidate } from './candidateResolver';
import { phase2bRuntimeConfig, resolvePublisherSecret, type Phase2bRuntimeConfig } from './runtimeConfig';
import { REQUIRED_WORKER_RPCS } from './supabaseControlPlane';

export type CheckState = 'PASS' | 'MISSING' | 'SKIPPED' | 'FAIL' | 'NOT_SAFELY_PREFLIGHTABLE';
export type PreflightCheck = { name: string; state: CheckState; detail: string };
export type PreflightReport = { mode: 'preflight-only'; checks: PreflightCheck[]; blockers: string[]; controlledCandidate?: { wordId: string; courseId: string; headword: string; promptHash: string; datasetHash: string; promptPreview: string } };

function add(report: PreflightReport, name: string, state: CheckState, detail: string): void {
  report.checks.push({ name, state, detail });
  if (state === 'MISSING' || state === 'FAIL') report.blockers.push(`${name}: ${detail}`);
}

async function checkCdp(config: Phase2bRuntimeConfig, report: PreflightReport): Promise<boolean> {
  const endpoint = `http://127.0.0.1:${config.cdpPort}`;
  try {
    const version = await fetch(`${endpoint}/json/version`);
    const list = await fetch(`${endpoint}/json/list`);
    const targets = list.ok ? await list.json() as Array<{ type: string; url: string }> : [];
    const gemini = targets.find((target) => target.type === 'page' && /gemini\.google\.com\/app/.test(target.url));
    if (!version.ok || !list.ok || !gemini) throw new Error('Gemini target unavailable');
    add(report, 'Chrome/CDP', 'PASS', 'existing Chrome endpoint and Gemini page target reachable');
    return true;
  } catch (error) {
    add(report, 'Chrome/CDP', 'FAIL', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function checkGemini(config: Phase2bRuntimeConfig, cdpReady: boolean, report: PreflightReport): Promise<void> {
  if (!cdpReady) return add(report, 'Gemini auth', 'SKIPPED', 'CDP unavailable');
  const adapter = new GeminiWebAdapter({ profileDirectory: config.profileDirectory });
  try {
    await adapter.openOverCDP(`http://127.0.0.1:${config.cdpPort}`);
    await adapter.ensureReady();
    add(report, 'Gemini auth', 'PASS', 'authenticated composer is ready; no prompt was submitted');
  } catch (error) {
    add(report, 'Gemini auth', 'FAIL', error instanceof Error ? error.message : String(error));
  } finally {
    await adapter.disconnect().catch(() => undefined);
  }
}

async function checkSupabase(config: Phase2bRuntimeConfig, report: PreflightReport): Promise<void> {
  add(report, 'Supabase URL', 'PASS', 'derived from existing project configuration');
  add(report, 'Control-plane RPC contract', 'PASS', `${REQUIRED_WORKER_RPCS.length} required RPC names are pinned in worker source`);
  if (!config.supabaseServiceRoleKey) {
    add(report, 'Supabase service credential', 'MISSING', 'SUPABASE_SERVICE_ROLE_KEY');
    add(report, 'Supabase read connectivity', 'SKIPPED', 'service credential missing');
    add(report, 'Control-plane worker RPCs', 'NOT_SAFELY_PREFLIGHTABLE', 'worker RPCs mutate lease/control state; migration/source contract inspected only');
    add(report, 'Automation owner', 'MISSING', 'AUTOMATION_OWNER_ID');
    add(report, 'Active run', 'MISSING', 'PHASE2B_RUN_ID from authenticated START command');
    return;
  }
  try {
    const client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await client.from('automation_control').select('owner_user_id').limit(1);
    if (result.error) throw new Error(result.error.message);
    add(report, 'Supabase service credential', 'PASS', 'configured from environment');
    add(report, 'Supabase read connectivity', 'PASS', 'automation_control readable with service credential');
  } catch (error) {
    add(report, 'Supabase read connectivity', 'FAIL', error instanceof Error ? error.message : String(error));
  }
  add(report, 'Control-plane worker RPCs', 'NOT_SAFELY_PREFLIGHTABLE', 'automation_acquire_lease and claim RPCs mutate production control state');
  if (config.ownerId) add(report, 'Automation owner', 'PASS', 'AUTOMATION_OWNER_ID supplied');
  else add(report, 'Automation owner', 'MISSING', 'AUTOMATION_OWNER_ID');
  if (config.runId) add(report, 'Active run', 'PASS', 'PHASE2B_RUN_ID supplied by prior authenticated START command');
  else add(report, 'Active run', 'MISSING', 'PHASE2B_RUN_ID from authenticated START command');
}

async function checkManifest(config: Phase2bRuntimeConfig, report: PreflightReport): Promise<void> {
  try {
    const response = await fetch(config.manifestUrl, { cache: 'no-store' });
    const manifest = response.ok ? await response.json() as { images?: unknown } : null;
    if (!response.ok || !manifest || typeof manifest.images !== 'object') throw new Error(`manifest HTTP ${response.status}`);
    add(report, 'Runtime Manifest', 'PASS', 'configured endpoint is readable and has an images mapping');
  } catch (error) {
    add(report, 'Runtime Manifest', 'FAIL', error instanceof Error ? error.message : String(error));
  }
}

async function checkPublisher(config: Phase2bRuntimeConfig, report: PreflightReport): Promise<void> {
  try { new URL(config.publisherUrl); add(report, 'Publisher URL', 'PASS', 'derived from existing image publisher configuration'); }
  catch { add(report, 'Publisher URL', 'FAIL', 'invalid configured URL'); }
  const secret = await resolvePublisherSecret(config);
  if (secret.value) add(report, 'Publisher credential', 'PASS', `configured from ${secret.source}`);
  else add(report, 'Publisher credential', 'MISSING', 'IMAGE_PUBLISHER_TOKEN, IMAGE_PUBLISHER_SECRET, or local ignored publisher secret');
  add(report, 'Publisher endpoint reachability', 'NOT_SAFELY_PREFLIGHTABLE', '/api/publish is mutation-only; no health endpoint is assumed');
}

async function checkArtifacts(config: Phase2bRuntimeConfig, report: PreflightReport): Promise<void> {
  try {
    await mkdir(config.artifactRoot, { recursive: true });
    const probe = join(config.artifactRoot, `.preflight-${randomUUID()}.tmp`);
    await writeFile(probe, 'phase2b-preflight', 'utf8');
    await rm(probe, { force: true });
    add(report, 'Artifact directory', 'PASS', 'writable temporary probe removed');
  } catch (error) {
    add(report, 'Artifact directory', 'FAIL', error instanceof Error ? error.message : String(error));
  }
}

async function checkCandidate(config: Phase2bRuntimeConfig, report: PreflightReport): Promise<void> {
  if (!config.wordId) return add(report, 'Controlled candidate', 'MISSING', 'PHASE2B_WORD_ID requires explicit user approval');
  try {
    const candidate = await resolveControlledCandidate(config.wordId);
    report.controlledCandidate = candidate;
    add(report, 'Controlled candidate', 'PASS', 'wordId resolved from canonical flagship dataset; prompt/hash derived locally');
  } catch (error) {
    add(report, 'Controlled candidate', 'FAIL', error instanceof Error ? error.message : String(error));
  }
}

export async function runPreflight(config = phase2bRuntimeConfig()): Promise<PreflightReport> {
  const report: PreflightReport = { mode: 'preflight-only', checks: [], blockers: [] };
  const cdpReady = await checkCdp(config, report);
  await Promise.all([checkGemini(config, cdpReady, report), checkSupabase(config, report), checkManifest(config, report), checkPublisher(config, report), checkArtifacts(config, report), checkCandidate(config, report)]);
  return report;
}

async function main(): Promise<void> {
  const report = await runPreflight();
  console.log(JSON.stringify(report, null, 2));
  if (report.blockers.length) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('preflight.ts')) {
  main().catch((error) => { console.error(`[Phase2B] PREFLIGHT_FAILED ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
}
