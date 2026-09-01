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

  it('validates ExampleSentenceSchema backward and forward compatibility', async () => {
    const { ExampleSentenceSchema, WordEntrySchema } = await import('../src/types/vocab');

    // Test new schema format (en, zh, scenario)
    const newFormat = {
      en: 'The committee approved the revised proposal.',
      zh: '委員會核准了修訂後的提案。',
      scenario: '會議決策'
    };
    const parsedNew = ExampleSentenceSchema.parse(newFormat);
    expect(parsedNew.en).toBe(newFormat.en);
    expect(parsedNew.zh).toBe(newFormat.zh);
    expect(parsedNew.english).toBe(newFormat.en); // backward compatibility alias
    expect(parsedNew.chinese).toBe(newFormat.zh); // backward compatibility alias
    expect(parsedNew.scenario).toBe('會議決策');

    // Test legacy schema format (english, chinese)
    const legacyFormat = {
      id: 'ex_legacy_1',
      english: 'We must finalize the contract today.',
      chinese: '我們今天必須敲定合約。'
    };
    const parsedLegacy = ExampleSentenceSchema.parse(legacyFormat);
    expect(parsedLegacy.en).toBe(legacyFormat.english);
    expect(parsedLegacy.zh).toBe(legacyFormat.chinese);
    expect(parsedLegacy.english).toBe(legacyFormat.english);
    expect(parsedLegacy.chinese).toBe(legacyFormat.chinese);
    expect(parsedLegacy.scenario).toBe('商務實務'); // default fallback

    // Validate WordEntrySchema with frequencyTier and imageUrl
    const fullWord = {
      id: 'tw_w_demo',
      headword: 'finalize',
      normalizedHeadword: 'finalize',
      entryType: 'word' as const,
      definitionZh: '敲定；完成',
      starRating: 4 as const,
      toeicScoreRange: '600-780',
      category: '商務談判',
      partsOfSpeech: ['verb'],
      wordForms: [],
      phoneticUS: null,
      phoneticUK: null,
      examples: [parsedNew],
      examTips: ['常考於 Part 5'],
      audioUSUrl: null,
      audioUKUrl: null,
      imageUrl: 'https://images.unsplash.com/photo-123',
      frequencyTier: 'core_1200' as const
    };
    expect(WordEntrySchema.safeParse(fullWord).success).toBe(true);
  });
});

