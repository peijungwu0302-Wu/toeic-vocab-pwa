/** Fail-closed guard. Call before creating a Supabase client or making a request. */
export type StagingConfig = {
  testUrl: string;
  productionUrl: string;
  projectRef: string;
  publishableKey: string;
  serviceRoleKey: string;
  confirmation: string;
};

// This repository's current .env points to this production project. Keep the
// independent check even if an operator supplies a wrong productionUrl.
const REPO_PRODUCTION_HOST = 'hgufhnytbkbmivhofqeu.supabase.co';

export function requireIsolatedDatabase(config: StagingConfig): StagingConfig {
  if (config.confirmation !== 'ISOLATED_TEST_DATABASE') throw new Error('ISOLATED_CONFIRMATION_REQUIRED');
  if (!config.productionUrl) throw new Error('PRODUCTION_URL_REQUIRED');
  if (!config.publishableKey || !config.serviceRoleKey) throw new Error('STAGING_CREDENTIALS_REQUIRED');
  let staging: URL;
  let production: URL;
  try {
    staging = new URL(config.testUrl);
    production = new URL(config.productionUrl);
  } catch {
    throw new Error('INVALID_SUPABASE_URL');
  }
  if (staging.protocol !== 'https:') throw new Error('STAGING_TLS_REQUIRED');
  if (staging.host === production.host || staging.hostname === REPO_PRODUCTION_HOST) {
    throw new Error('PRODUCTION_PROJECT_FORBIDDEN');
  }
  if (staging.hostname !== `${config.projectRef}.supabase.co`) throw new Error('STAGING_PROJECT_REF_MISMATCH');
  return config;
}
