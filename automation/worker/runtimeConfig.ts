import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

export const KNOWN_SUPABASE_URL = 'https://hgufhnytbkbmivhofqeu.supabase.co';
export const KNOWN_IMAGE_WORKER_URL = 'https://toeic-image-publisher.peijungwu0302.workers.dev';

export type Phase2bRuntimeConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey?: string;
  ownerId?: string;
  runId?: string;
  wordId?: string;
  manifestUrl: string;
  publisherUrl: string;
  publisherSecret?: string;
  publisherSecretFile: string;
  cdpPort: number;
  profileDirectory: string;
  artifactRoot: string;
};

export function phase2bRuntimeConfig(environment: NodeJS.ProcessEnv = process.env, root = resolve(process.cwd())): Phase2bRuntimeConfig {
  const cdpPort = Number(environment.PHASE2B_CDP_PORT ?? '9664');
  return {
    supabaseUrl: environment.SUPABASE_URL?.trim() || KNOWN_SUPABASE_URL,
    supabaseServiceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined,
    ownerId: environment.AUTOMATION_OWNER_ID?.trim() || undefined,
    runId: environment.PHASE2B_RUN_ID?.trim() || undefined,
    wordId: environment.PHASE2B_WORD_ID?.trim() || undefined,
    manifestUrl: environment.RUNTIME_MANIFEST_URL?.trim() || `${KNOWN_IMAGE_WORKER_URL}/api/manifest/current`,
    publisherUrl: environment.IMAGE_PUBLISHER_URL?.trim() || `${KNOWN_IMAGE_WORKER_URL}/api/publish`,
    publisherSecret: environment.IMAGE_PUBLISHER_TOKEN?.trim() || environment.IMAGE_PUBLISHER_SECRET?.trim() || undefined,
    publisherSecretFile: join(root, 'workers', 'image-publisher', '.secret.tmp'),
    cdpPort: Number.isFinite(cdpPort) && cdpPort > 0 ? cdpPort : 9664,
    profileDirectory: environment.GEMINI_PROFILE_DIR?.trim() || join(root, '.local', 'gemini-browser-profile'),
    artifactRoot: resolve(environment.PHASE2B_ARTIFACT_ROOT?.trim() || join(root, 'automation-artifacts', 'phase2b')),
  };
}

/** Resolves only a local ignored publisher secret; callers must never log the value. */
export async function resolvePublisherSecret(config: Phase2bRuntimeConfig): Promise<{ value?: string; source: 'env' | 'local-config' | 'unavailable' }> {
  if (config.publisherSecret) return { value: config.publisherSecret, source: 'env' };
  try {
    const value = (await readFile(config.publisherSecretFile, 'utf8')).trim();
    return value ? { value, source: 'local-config' } : { source: 'unavailable' };
  } catch { return { source: 'unavailable' }; }
}
