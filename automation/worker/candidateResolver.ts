import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promptSha256 } from '../gemini/artifact';
import type { CandidateSnapshot } from './types';

export const FLAGSHIP_COURSE_IDS = new Set([
  'course-core-1200',
  'course-advanced-2500',
  'course-expert-high-part1',
  'course-expert-high-part2',
  'course-expert-high-part3',
]);

type CatalogCourse = { id: string; fileName: string };
type Catalog = { courses: CatalogCourse[] };
type Word = { id: string; headword: string; imagePrompt?: string | null };
type Course = { words: Word[] };

export type ResolvedCandidate = CandidateSnapshot & { datasetSource: 'catalog.json'; promptPreview: string };

export function resolveCandidateFromRecords(wordId: string, catalog: Catalog, courses: Map<string, Course>, datasetHash: string): ResolvedCandidate {
  for (const courseMeta of catalog.courses) {
    if (!FLAGSHIP_COURSE_IDS.has(courseMeta.id)) continue;
    const word = courses.get(courseMeta.id)?.words.find((item) => item.id === wordId);
    if (!word) continue;
    const promptText = word.imagePrompt?.trim();
    if (!promptText) throw new Error('CANDIDATE_PROMPT_MISSING');
    return {
      wordId: word.id,
      courseId: courseMeta.id,
      headword: word.headword,
      promptText,
      promptHash: promptSha256(promptText),
      datasetHash,
      datasetSource: 'catalog.json',
      promptPreview: promptText.length > 180 ? `${promptText.slice(0, 180)}…` : promptText,
    };
  }
  throw new Error('CANDIDATE_WORD_NOT_FOUND_IN_FLAGSHIP_SCOPE');
}

export async function resolveControlledCandidate(wordId: string, dataRoot = resolve(process.cwd(), 'public', 'data', 'v1')): Promise<ResolvedCandidate> {
  const catalogBytes = await readFile(join(dataRoot, 'catalog.json'));
  const catalog = JSON.parse(catalogBytes.toString('utf8')) as Catalog;
  const courseEntries = await Promise.all(catalog.courses
    .filter((course) => FLAGSHIP_COURSE_IDS.has(course.id))
    .map(async (course) => [course.id, JSON.parse((await readFile(join(dataRoot, 'courses', course.fileName))).toString('utf8')) as Course] as const));
  return resolveCandidateFromRecords(wordId, catalog, new Map(courseEntries), createHash('sha256').update(catalogBytes).digest('hex'));
}

