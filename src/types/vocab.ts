import { z } from 'zod';

export type EntryType = 'word' | 'phrase' | 'pattern';

export interface ExampleSentence {
  id: string;
  english: string;
  chinese: string;
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
}

export const ExampleSentenceSchema = z.object({
  id: z.string(),
  english: z.string(),
  chinese: z.string()
});

export const WordFormSchema = z.object({
  partOfSpeech: z.string(),
  forms: z.array(z.string())
});

export const WordEntrySchema = z.object({
  id: z.string(),
  headword: z.string(),
  normalizedHeadword: z.string(),
  entryType: z.enum(['word', 'phrase', 'pattern']),
  definitionZh: z.string(),
  starRating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  toeicScoreRange: z.string(),
  category: z.string(),
  partsOfSpeech: z.array(z.string()),
  wordForms: z.array(WordFormSchema),
  phoneticUS: z.string().nullable(),
  phoneticUK: z.string().nullable(),
  examples: z.array(ExampleSentenceSchema),
  examTips: z.array(z.string()),
  audioUSUrl: z.string().nullable(),
  audioUKUrl: z.string().nullable()
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
}

export const CourseSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  toeicScoreRange: z.string(),
  category: z.string(),
  level: z.string(),
  wordCount: z.number(),
  fileName: z.string(),
  checksum: z.string(),
  sizeBytes: z.number().optional()
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
  description: z.string(),
  toeicScoreRange: z.string(),
  category: z.string(),
  level: z.string(),
  version: z.number(),
  wordCount: z.number(),
  words: z.array(WordEntrySchema)
});

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
