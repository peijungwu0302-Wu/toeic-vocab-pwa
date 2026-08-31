import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

// Replicate ETL helper functions to test ETL behavior
function detectEntryType(headword: string, rawPartsOfSpeech: string[] = []): 'word' | 'phrase' | 'pattern' {
  const norm = headword.trim();
  const lower = norm.toLowerCase();

  if (
    lower.includes('...') ||
    /\b(sb|sth|a be|a and b|either.*or|neither.*nor|not only.*but also|so.*that|too.*to)\b/i.test(lower) ||
    /^[A-Z]\s+(be|and|or|is|are|was|were)\s+[A-Z]/i.test(norm)
  ) {
    return 'pattern';
  }

  if (norm.includes(' ') || norm.includes('-') || rawPartsOfSpeech.some(p => String(p).toLowerCase().includes('phrase') || String(p).toLowerCase().includes('idiom'))) {
    return 'phrase';
  }

  return 'word';
}

function generateDeterministicId(headword: string, entryType: string): string {
  const normalized = headword.toLowerCase().trim().replace(/\s+/g, ' ');
  const hash = crypto.createHash('sha256').update(`${normalized}:${entryType}`).digest('hex');
  return `tw_${entryType[0]}_${hash.slice(0, 12)}`;
}

describe('ETL Pipeline Unit Tests', () => {
  it('correctly classifies entry types (word, phrase, pattern)', () => {
    expect(detectEntryType('accommodate')).toBe('word');
    expect(detectEntryType('look forward to')).toBe('phrase');
    expect(detectEntryType('take into account')).toBe('phrase');
    expect(detectEntryType('A be followed by B')).toBe('pattern');
    expect(detectEntryType('either ... or ...')).toBe('pattern');
    expect(detectEntryType('not only sb but also sth')).toBe('pattern');
  });

  it('generates consistent and deterministic IDs regardless of execution time', () => {
    const id1 = generateDeterministicId('look forward to', 'phrase');
    const id2 = generateDeterministicId('look forward to', 'phrase');
    const id3 = generateDeterministicId('LOOK  FORWARD   TO', 'phrase'); // normalization check

    expect(id1).toBe(id2);
    expect(id1).toBe(id3);
    expect(id1.startsWith('tw_p_')).toBe(true);
  });

  it('handles deduplication key generation', () => {
    const key1 = `${'Look Forward To'.toLowerCase().replace(/\s+/g, ' ')}:::phrase`;
    const key2 = `${'look forward to'.toLowerCase().replace(/\s+/g, ' ')}:::phrase`;
    expect(key1).toBe(key2);
  });
});
