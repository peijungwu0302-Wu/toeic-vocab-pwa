// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const runner = fileURLToPath(new URL('../../scripts/run_phase1c_staging.ps1', import.meta.url));
const windowsTest = process.platform === 'win32' ? test : test.skip;

windowsTest('staging runner refuses to touch any DB without explicit isolation confirmation', () => {
  const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', runner], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SUPABASE_TEST_CONFIRMATION: '',
      SUPABASE_TEST_PROJECT_REF: 'stagingbranch',
      SUPABASE_TEST_DB_HOST: 'db.stagingbranch.supabase.co',
    },
  });
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}${result.stderr}`).toContain('ISOLATED_CONFIRMATION_REQUIRED');
});

windowsTest('staging runner rejects the known production project before checking psql', () => {
  const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', runner], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SUPABASE_TEST_CONFIRMATION: 'ISOLATED_TEST_DATABASE',
      SUPABASE_TEST_PROJECT_REF: 'hgufhnytbkbmivhofqeu',
      SUPABASE_TEST_DB_HOST: 'db.hgufhnytbkbmivhofqeu.supabase.co',
    },
  });
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}${result.stderr}`).toContain('PRODUCTION_PROJECT_FORBIDDEN');
});
