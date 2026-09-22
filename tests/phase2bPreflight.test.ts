import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { promptSha256 } from '../automation/gemini/artifact';
import { resolveCandidateFromRecords } from '../automation/worker/candidateResolver';
import { runPreflight } from '../automation/worker/preflight';
import type { Phase2bRuntimeConfig } from '../automation/worker/runtimeConfig';

describe('Phase 2B runtime preflight', () => {
  test('collects independent blockers without exposing secret-shaped values', async () => {
    const root = mkdtempSync(join(tmpdir(), 'phase2b-preflight-'));
    const config: Phase2bRuntimeConfig = {
      supabaseUrl: 'https://example.invalid', manifestUrl: 'http://127.0.0.1:1/manifest', publisherUrl: 'https://example.invalid/api/publish',
      cdpPort: 1, profileDirectory: root, artifactRoot: root, publisherSecretFile: join(root, 'missing-secret'),
    };
    try {
      const report = await runPreflight(config);
      expect(report.blockers.join('\n')).toContain('Supabase service credential');
      expect(report.blockers.join('\n')).toContain('Automation owner');
      expect(report.blockers.join('\n')).toContain('Active run');
      expect(report.blockers.join('\n')).toContain('Publisher credential');
      expect(report.blockers.join('\n')).toContain('Controlled candidate');
      expect(JSON.stringify(report)).not.toContain('SUPABASE_SERVICE_ROLE_KEY=');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('derives immutable candidate identity from the approved wordId', () => {
    const prompt = 'Generate a canonical test image.';
    const datasetHash = createHash('sha256').update('catalog-bytes').digest('hex');
    const candidate = resolveCandidateFromRecords('tw_w_aaaaaaaaaaaa', {
      courses: [{ id: 'course-core-1200', fileName: 'core.json' }],
    }, new Map([['course-core-1200', { words: [{ id: 'tw_w_aaaaaaaaaaaa', headword: 'alpha', imagePrompt: prompt }] }]]), datasetHash);
    expect(candidate.courseId).toBe('course-core-1200');
    expect(candidate.headword).toBe('alpha');
    expect(candidate.promptText).toBe(prompt);
    expect(candidate.promptHash).toBe(promptSha256(prompt));
    expect(candidate.datasetHash).toBe(datasetHash);
    expect(() => resolveCandidateFromRecords('tw_w_aaaaaaaaaaaa', { courses: [{ id: 'course-foundation-550-part1', fileName: 'x' }] }, new Map(), datasetHash)).toThrow('CANDIDATE_WORD_NOT_FOUND_IN_FLAGSHIP_SCOPE');
  });
});
