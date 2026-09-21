// @vitest-environment node

import { describe, expect, test } from 'vitest';
import { requireIsolatedDatabase } from './stagingSafety';

const valid = {
  testUrl: 'https://stagingbranch.supabase.co',
  productionUrl: 'https://productionref.supabase.co',
  projectRef: 'stagingbranch',
  publishableKey: 'test-publishable-key',
  serviceRoleKey: 'test-service-role-key',
  confirmation: 'ISOLATED_TEST_DATABASE',
};

describe('staging-only integration guard', () => {
  test('accepts an explicitly confirmed, distinct staging project', () => {
    expect(requireIsolatedDatabase(valid).testUrl).toBe(valid.testUrl);
  });

  test('rejects the repo production URL before any request is made', () => {
    expect(() => requireIsolatedDatabase({ ...valid, testUrl: valid.productionUrl, projectRef: 'productionref' }))
      .toThrow('PRODUCTION_PROJECT_FORBIDDEN');
  });

  test('rejects the known repo production ref even if the production URL was misconfigured', () => {
    expect(() => requireIsolatedDatabase({
      ...valid, testUrl: 'https://hgufhnytbkbmivhofqeu.supabase.co',
      projectRef: 'hgufhnytbkbmivhofqeu',
    })).toThrow('PRODUCTION_PROJECT_FORBIDDEN');
  });

  test('rejects a project-ref/URL mismatch', () => {
    expect(() => requireIsolatedDatabase({ ...valid, projectRef: 'differentref' }))
      .toThrow('STAGING_PROJECT_REF_MISMATCH');
  });

  test('rejects missing explicit isolation confirmation or credentials', () => {
    expect(() => requireIsolatedDatabase({ ...valid, confirmation: '' })).toThrow('ISOLATED_CONFIRMATION_REQUIRED');
    expect(() => requireIsolatedDatabase({ ...valid, serviceRoleKey: '' })).toThrow('STAGING_CREDENTIALS_REQUIRED');
    expect(() => requireIsolatedDatabase({ ...valid, productionUrl: '' })).toThrow('PRODUCTION_URL_REQUIRED');
  });

  test('rejects a non-TLS remote endpoint', () => {
    expect(() => requireIsolatedDatabase({ ...valid, testUrl: 'http://stagingbranch.supabase.co' }))
      .toThrow('STAGING_TLS_REQUIRED');
  });
});
