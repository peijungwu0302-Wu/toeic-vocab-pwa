import { z } from 'zod';

export type EntryType = 'word' | 'phrase' | 'pattern';

export type FrequencyTier = 'core_1200' | 'advanced_2500' | 'expert_high';

export interface ExampleSentence {
  id?: string;
  en?: string;
  zh?: string;
  scenario?: string;
  // Backward compatibility aliases
  english?: string;
  chinese?: string;
}

export interface WordForm {
  partOfSpeech: string;
  forms: string[];
}

export interface WordEntry {
  id: string;
  headword: string;
  normalizedHeadword: string;
  entryType: EntryType;
  definitionZh: string;
  starRating: 1 | 2 | 3 | 4 | 5;
  toeicScoreRange: string;
  category: string;
  partsOfSpeech: string[];
  wordForms: WordForm[];
  phoneticUS: string | null;
  phoneticUK: string | null;
  examples: ExampleSentence[];
  examTips: string[];
  audioUSUrl: string | null;
  audioUKUrl: string | null;
  imageUrl?: string | null;
  imageKeyword?: string | null;
  visualAnchor?: {
    imagePrompt?: string;
    scene?: string;
  };
  examFocus?: {
    primaryBusinessSense?: string;
    trapWarning?: string;
  };
  etymology?: {
    prefix?: string | null;
    root?: string;
    suffix?: string | null;
    memoryHook?: string;
  };
  wordFamily?: {
    noun?: string[];
    verb?: string[];
    adjective?: string[];
    adverb?: string[];
    cognates?: string[];
  };
  synonymDiscrimination?: {
    synonyms?: string[];
    antonyms?: string[];
    discrimination?: string;
  };
  collocations?: Array<{
    en: string;
    zh: string;
  }>;
  inflections?: {
    s?: string;
    ed?: string;
    ing?: string;
    [key: string]: string | undefined;
  };
  frequencyTier?: FrequencyTier;
  quizzes?: any[];
}

export const ExampleSentenceSchema = z.object({
  id: z.string().optional(),
  en: z.string().optional(),
  zh: z.string().optional(),
  scenario: z.string().optional(),
  english: z.string().optional(),
  chinese: z.string().optional()
}).transform((val) => {
  const en = val.en || val.english || '';
  const zh = val.zh || val.chinese || '';
  return {
    id: val.id || '',
    en,
    zh,
    scenario: val.scenario || '商務實務',
    english: en,
    chinese: zh
  };
});

export const WordFormSchema = z.object({
  partOfSpeech: z.string().optional(),
  part_of_speech: z.string().optional(),
  forms: z.array(z.string()).optional().default([])
}).transform((val) => ({
  partOfSpeech: val.partOfSpeech || val.part_of_speech || '',
  forms: val.forms || []
}));

export const WordEntrySchema = z.object({
  id: z.string().optional(),
  headword: z.string(),
  normalizedHeadword: z.string().optional(),
  entryType: z.enum(['word', 'phrase', 'pattern']).optional().default('word'),
  definitionZh: z.string().optional().default(''),
  starRating: z.number().optional().default(3),
  toeicScoreRange: z.string().optional().default('400-990'),
  category: z.string().optional().default('綜合商務'),
  partsOfSpeech: z.array(z.string()).optional().default([]),
  wordForms: z.array(WordFormSchema).optional().default([]),
  phoneticUS: z.string().nullable().optional(),
  phoneticUK: z.string().nullable().optional(),
  examples: z.array(ExampleSentenceSchema).optional().default([]),
  examTips: z.array(z.string()).optional().default([]),
  audioUSUrl: z.string().nullable().optional(),
  audioUKUrl: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  imageKeyword: z.string().nullable().optional(),
  visualAnchor: z.object({
    imagePrompt: z.string().optional(),
    scene: z.string().optional()
  }).passthrough().optional(),
  examFocus: z.any().optional(),
  etymology: z.any().optional(),
  wordFamily: z.any().optional(),
  synonymDiscrimination: z.any().optional(),
  collocations: z.any().optional(),
  frequencyTier: z.enum(['core_1200', 'advanced_2500', 'expert_high']).optional(),
  quizzes: z.array(z.any()).optional().default([])
}).transform((val) => {
  const ratingNum = Math.max(1, Math.min(5, Math.round(val.starRating || 3))) as 1 | 2 | 3 | 4 | 5;
  const wordId = val.id || `tw_${val.headword.toLowerCase().trim().replace(/[^a-z0-9]/g, '_')}`;
  return {
    id: wordId,
    headword: val.headword,
    normalizedHeadword: val.normalizedHeadword || val.headword.toLowerCase().trim(),
    entryType: val.entryType || 'word',
    definitionZh: val.definitionZh || '',
    starRating: ratingNum,
    toeicScoreRange: val.toeicScoreRange || '400-990',
    category: val.category || '綜合商務',
    partsOfSpeech: val.partsOfSpeech || [],
    wordForms: val.wordForms || [],
    phoneticUS: val.phoneticUS || null,
    phoneticUK: val.phoneticUK || null,
    examples: val.examples || [],
    examTips: val.examTips || [],
    audioUSUrl: val.audioUSUrl || null,
    audioUKUrl: val.audioUKUrl || null,
    imageUrl: val.imageUrl || null,
    imageKeyword: val.imageKeyword || null,
    visualAnchor: val.visualAnchor,
    examFocus: val.examFocus,
    etymology: val.etymology,
    wordFamily: val.wordFamily,
    synonymDiscrimination: val.synonymDiscrimination,
    collocations: val.collocations,
    frequencyTier: val.frequencyTier,
    quizzes: val.quizzes || []
  };
});

export interface CourseSummary {
  id: string;
  title: string;
  description: string;
  toeicScoreRange: string;
  category: string;
  level: string;
  wordCount: number;
  fileName: string;
  checksum: string;
  sizeBytes?: number;
  version?: number;
}

export const CourseSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional().default(''),
  toeicScoreRange: z.string().optional().default('400-990'),
  category: z.string().optional().default('綜合商務'),
  level: z.string().optional().default('基礎'),
  wordCount: z.number().optional().default(0),
  fileName: z.string(),
  checksum: z.string().optional().default(''),
  sizeBytes: z.number().optional(),
  version: z.number().optional().default(3)
});

export interface CourseDetail {
  id: string;
  title: string;
  description: string;
  toeicScoreRange: string;
  category: string;
  level: string;
  version: number;
  wordCount: number;
  words: WordEntry[];
}

export const CourseDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional().default(''),
  toeicScoreRange: z.string().optional().default('400-990'),
  category: z.string().optional().default('綜合商務'),
  level: z.string().optional().default('基礎'),
  version: z.number().optional().default(1),
  wordCount: z.number().optional(),
  words: z.array(WordEntrySchema)
}).transform((val) => ({
  id: val.id,
  title: val.title,
  description: val.description || '',
  toeicScoreRange: val.toeicScoreRange || '400-990',
  category: val.category || '綜合商務',
  level: val.level || '基礎',
  version: val.version || 1,
  wordCount: typeof val.wordCount === 'number' ? val.wordCount : val.words.length,
  words: val.words
}));

export interface DatasetCatalog {
  version: number;
  generatedAt: string;
  totalWords: number;
  totalCourses: number;
  courses: CourseSummary[];
}

export const DatasetCatalogSchema = z.object({
  version: z.number(),
  generatedAt: z.string(),
  totalWords: z.number(),
  totalCourses: z.number(),
  courses: z.array(CourseSummarySchema)
});

export interface DatasetManifest {
  version: number;
  generatedAt: string;
  datasetSource: string;
  license: string;
  totalEntries: number;
  courses: Array<{
    id: string;
    path: string;
    checksum: string;
    count: number;
  }>;
}

export interface QAReport {
  generatedAt: string;
  sourceRows: number;
  validRows: number;
  dedupedRows: number;
  rejectedRows: Array<{
    row: unknown;
    reason: string;
  }>;
  missingDefinitions: number;
  missingExamples: number;
  distribution: {
    byCategory: Record<string, number>;
    byStarRating: Record<string, number>;
    byScoreRange: Record<string, number>;
    byEntryType: Record<string, number>;
  };
}
