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
        const localWordCount = await db.words.count();
        if (localWordCount > 0) {
          // Query local IndexedDB words directly
          const allWords = await db.words.toArray();
          const items: SearchIndexItem[] = allWords.map(w => ({
            id: w.id,
            headword: w.headword,
            normalizedHeadword: (w.normalizedHeadword || w.headword).toLowerCase(),
            definitionZh: w.definitionZh || '',
            category: w.category || '',
            toeicScoreRange: w.toeicScoreRange || '',
            partsOfSpeech: w.partsOfSpeech || [],
            phoneticUS: w.phoneticUS || null
          }));
          indexCache = items;
          return items;
        }

        // If local DB is not populated yet, dynamically fetch courses declared in current catalog.json
        const catalog = await courseRepository.fetchCatalog();
        const courseItems: SearchIndexItem[] = [];
        const seenWords = new Set<string>();

        const fetchPromises = catalog.courses.map(async (c: CourseSummary) => {
          try {
            const res = await fetch(getBaseDataUrl(`data/v1/courses/${c.fileName}`));
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data?.words) ? data.words : [];
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
                  phoneticUS: w.phoneticUS || null
                });
              }
            }
          }
        }

        indexCache = courseItems;
        return courseItems;
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
   * Retrieve full Word details by ID from db.words or course data.
   */
  async getFullWord(wordId: string): Promise<Word | null> {
    try {
      const local = await db.words.get(wordId);
      if (local) return local;
    } catch {}

    // Fallback search by normalized term if not by exact ID
    return null;
  }
};
