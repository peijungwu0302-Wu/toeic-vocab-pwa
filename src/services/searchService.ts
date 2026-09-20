/**
 * src/services/searchService.ts
 * Lightweight singleton search index and query engine for current catalog words.
 *
 * Replaces legacy 11,154 hardcoded loaders and heavy in-memory Word[] caching.
 * Provides ranked prefix/exact matching, debounce support, and stale-query cancellation.
 */

import { db } from '../db';
import { Word } from '../types/db';
import { CourseSummary } from '../types/vocab';
import { courseRepository } from '../repositories/courseRepository';

const getBaseDataUrl = (relPath: string): string => {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : base + '/';
  return `${prefix}${relPath.replace(/^\//, '')}`;
};

export interface SearchIndexItem {
  id: string;
  headword: string;
  normalizedHeadword: string;
  definitionZh: string;
  category: string;
  toeicScoreRange: string;
  partsOfSpeech: string[];
  phoneticUS: string | null;
  sourceCourseId?: string;
  sourceFileName?: string;
}

let indexCache: SearchIndexItem[] | null = null;
let indexPromise: Promise<SearchIndexItem[]> | null = null;

export const searchService = {
  /**
   * Reset index cache (e.g. after dataset migration or course download)
   */
  invalidateIndex(): void {
    indexCache = null;
    indexPromise = null;
  },

  /**
   * Build or retrieve the singleton lightweight search index.
   * Single Source of Truth: public/data/v1/search-index.json (10,304 words across 35 courses).
   * Does NOT restrict index universe based on local db.words count.
   */
  async getIndex(): Promise<SearchIndexItem[]> {
    if (indexCache && indexCache.length > 0) {
      return indexCache;
    }
    if (indexPromise) {
      return indexPromise;
    }

    indexPromise = (async () => {
      try {
        // 1. Primary Source of Truth: lightweight pre-compiled catalog search-index.json
        try {
          const res = await fetch(`${getBaseDataUrl('data/v1/search-index.json')}?t=${Date.now()}`);
          if (res.ok) {
            const data: SearchIndexItem[] = await res.json();
            if (Array.isArray(data) && data.length > 0) {
              indexCache = data;
              return data;
            }
          }
        } catch (fetchErr) {
          console.warn('[searchService] Failed to fetch pre-compiled search-index.json, falling back:', fetchErr);
        }

        // 2. Fallback: load dynamically from catalog.json courses
        try {
          const catalog = await courseRepository.fetchCatalog();
          const courseItems: SearchIndexItem[] = [];
          const seenWords = new Set<string>();

          const fetchPromises = catalog.courses.map(async (c: CourseSummary) => {
            try {
              const res = await fetch(getBaseDataUrl(`data/v1/courses/${c.fileName}`));
              if (!res.ok) return [];
              const data = await res.json();
              return Array.isArray(data?.words)
                ? data.words.map((w: any) => ({ ...w, sourceCourseId: c.id, sourceFileName: c.fileName }))
                : [];
            } catch {
              return [];
            }
          });

          const courseResults = await Promise.allSettled(fetchPromises);
          for (const res of courseResults) {
            if (res.status === 'fulfilled' && Array.isArray(res.value)) {
              for (const w of res.value) {
                const norm = (w.normalizedHeadword || w.headword || '').toLowerCase();
                if (norm && !seenWords.has(norm)) {
                  seenWords.add(norm);
                  courseItems.push({
                    id: w.id,
                    headword: w.headword,
                    normalizedHeadword: norm,
                    definitionZh: w.definitionZh || '',
                    category: w.category || '',
                    toeicScoreRange: w.toeicScoreRange || '',
                    partsOfSpeech: w.partsOfSpeech || [],
                    phoneticUS: w.phoneticUS || null,
                    sourceCourseId: w.sourceCourseId,
                    sourceFileName: w.sourceFileName
                  });
                }
              }
            }
          }

          if (courseItems.length > 0) {
            indexCache = courseItems;
            return courseItems;
          }
        } catch (catalogErr) {
          console.warn('[searchService] Failed to load catalog fallback, using local DB:', catalogErr);
        }

        // 3. Last-resort fallback: local IndexedDB
        const localWords = await db.words.toArray();
        const fallbackItems: SearchIndexItem[] = localWords.map(w => ({
          id: w.id,
          headword: w.headword,
          normalizedHeadword: (w.normalizedHeadword || w.headword).toLowerCase(),
          definitionZh: w.definitionZh || '',
          category: w.category || '',
          toeicScoreRange: w.toeicScoreRange || '',
          partsOfSpeech: w.partsOfSpeech || [],
          phoneticUS: w.phoneticUS || null
        }));

        indexCache = fallbackItems;
        return fallbackItems;
      } catch (err) {
        console.warn('[searchService] Failed to build search index:', err);
        indexCache = [];
        return [];
      } finally {
        indexPromise = null;
      }
    })();

    return indexPromise;
  },

  /**
   * Get total number of items in the search index.
   */
  async getIndexCount(): Promise<number> {
    const idx = await this.getIndex();
    return idx.length;
  },

  /**
   * Ranked search with AbortSignal cancellation.
   */
  async search(
    query: string,
    options?: { limit?: number; signal?: AbortSignal }
  ): Promise<SearchIndexItem[]> {
    const items = await this.getIndex();
    if (options?.signal?.aborted) return [];

    const limit = options?.limit ?? 50;
    const q = query.trim().toLowerCase();

    if (!q) {
      return items.slice(0, limit);
    }

    const exactMatches: SearchIndexItem[] = [];
    const prefixMatches: SearchIndexItem[] = [];
    const containsMatches: SearchIndexItem[] = [];
    const defMatches: SearchIndexItem[] = [];

    for (const item of items) {
      if (options?.signal?.aborted) return [];

      const norm = item.normalizedHeadword;
      if (norm === q) {
        exactMatches.push(item);
      } else if (norm.startsWith(q)) {
        prefixMatches.push(item);
      } else if (norm.includes(q)) {
        containsMatches.push(item);
      } else if (item.definitionZh.includes(q) || item.category.toLowerCase().includes(q)) {
        defMatches.push(item);
      }

      if (exactMatches.length + prefixMatches.length + containsMatches.length + defMatches.length >= limit * 2) {
        break;
      }
    }

    return [
      ...exactMatches,
      ...prefixMatches,
      ...containsMatches,
      ...defMatches
    ].slice(0, limit);
  },

  /**
   * Retrieve full Word details by ID from db.words or lazy-load from course file.
   */
  async getFullWord(wordId: string): Promise<Word | null> {
    try {
      const local = await db.words.get(wordId);
      if (local) return local;

      // Lazy-load from course file if not in local db
      const index = await this.getIndex();
      const entry = index.find(item => item.id === wordId);
      if (entry?.sourceFileName) {
        const res = await fetch(getBaseDataUrl(`data/v1/courses/${entry.sourceFileName}`));
        if (res.ok) {
          const courseData = await res.json();
          const found = courseData.words?.find((w: Word) => w.id === wordId);
          if (found) return found;
        }
      }
    } catch {
      /* ignore */
    }

    return null;
  }
};
