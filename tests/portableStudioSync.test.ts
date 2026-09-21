// @vitest-environment node

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const sync = fileURLToPath(new URL('../scripts/sync_portable_dataset.py', import.meta.url));
const builder = fileURLToPath(new URL('../scripts/build-portable-studio.mjs', import.meta.url));
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Portable Studio safe dataset sync', () => {
  test('changes only DATASET and preserves modern R2/wordId/immutable-target shell', () => {
    const dir = mkdtempSync(join(tmpdir(), 'portable-sync-'));
    tempDirs.push(dir);
    const html = join(dir, 'portable_studio.html');
    const before = `<script>\n    const DATASET = {"core-1200":[{"id":"tw_w_aaaaaaaaaaaa","headword":"alpha","slug":"alpha","prompt":"old","hasImage":true}],"advanced-2500":[],"expert-high-part1":[],"expert-high-part2":[],"expert-high-part3":[]};\n    const R2_WORKER_URL = '/api/publish';\n    const runtimeManifest = {};\n    const stagedImages = new Map();\n    const target = { wordId: selectedWord.id };\n    if (data.activeAtVerification && data.verifiedAt) publish(target.wordId);\n</script>`;
    writeFileSync(html, before);
    for (const tier of ['core-1200', 'advanced-2500', 'expert-high-part1', 'expert-high-part2', 'expert-high-part3']) {
      writeFileSync(join(dir, `course-${tier}.json`), JSON.stringify({ words: tier === 'core-1200' ? [{ id: 'tw_w_aaaaaaaaaaaa', headword: 'alpha', partsOfSpeech: ['noun'], visualAnchor: { imagePrompt: 'new prompt', shortEn: 'example', scene: 'scene' } }] : [] }));
    }

    execFileSync('python', [sync, '--html', html, '--courses-dir', dir]);
    const after = readFileSync(html, 'utf8');
    const shell = (value: string) => value.replace(/^    const DATASET = .*;\r?\n/m, '    const DATASET = <generated>;\n');
    expect(shell(after)).toBe(shell(before));
    expect(after).toContain('"prompt": "new prompt"');
    expect(after).toContain('"hasImage": true');
    expect(after).toContain('/api/publish');
    expect(after).toContain('runtimeManifest');
    expect(after).toContain('target.wordId');
    expect(after).toContain('activeAtVerification');
    expect(execFileSync('python', [sync, '--html', html, '--courses-dir', dir, '--check'], { encoding: 'utf8' })).toContain('up to date');
  });

  test('refuses ambiguous DATASET blocks without changing the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'portable-sync-'));
    tempDirs.push(dir);
    const html = join(dir, 'portable_studio.html');
    const before = '    const DATASET = {};\n    const DATASET = {};\n';
    writeFileSync(html, before);
    const result = spawnSync('python', [sync, '--html', html, '--courses-dir', dir]);
    expect(result.status).not.toBe(0);
    expect(readFileSync(html, 'utf8')).toBe(before);
  });

  test('refreshing the real current shell preserves every non-DATASET byte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'portable-sync-real-'));
    tempDirs.push(dir);
    const html = join(dir, 'portable_studio.html');
    const authoritative = readFileSync(join(root, 'public', 'portable_studio.html'), 'utf8');
    const stale = authoritative.replace('"prompt": "', '"prompt": "__stale__');
    expect(stale).not.toBe(authoritative);
    writeFileSync(html, stale);
    execFileSync('python', [sync, '--html', html, '--courses-dir', join(root, 'public', 'data', 'v1', 'courses')]);
    const refreshed = readFileSync(html, 'utf8');
    const shell = (value: string) => value.replace(/^    const DATASET = .*;\r?\n/m, '    const DATASET = <generated>;\n');
    expect(shell(refreshed)).toBe(shell(authoritative));
    expect(refreshed).toBe(authoritative);
    for (const feature of ['/api/publish', 'runtimeManifest', 'stagedImages.set(target.wordId', 'activeAtVerification', 'target.wordId']) {
      expect(refreshed).toContain(feature);
    }
  });

  test('legacy builder fails closed and never writes the authoritative HTML', () => {
    const html = join(root, 'public', 'portable_studio.html');
    const before = readFileSync(html);
    const result = spawnSync('node', [builder], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('sync_portable_dataset.py');
    expect(readFileSync(html).equals(before)).toBe(true);
  });
});
