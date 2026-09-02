import { db } from '../db';
import { Course, CourseWord, Word } from '../types/db';
import { CourseDetailSchema, DatasetCatalog, DatasetCatalogSchema } from '../types/vocab';

function shuffleList<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const courseRepository = {
  async fetchCatalog(): Promise<DatasetCatalog> {
    const res = await fetch(`/data/v1/catalog.json?t=${Date.now()}`, { cache: 'no-cache' });
    if (!res.ok) {
      throw new Error(`Failed to fetch course catalog: HTTP ${res.status}`);
    }
    const data = await res.json();
    return DatasetCatalogSchema.parse(data);
  },

  async getAll(): Promise<Course[]> {
    return db.courses.toArray();
  },

  async getById(id: string): Promise<Course | undefined> {
    return db.courses.get(id);
  },

  async getWordsForCourse(
    courseId: string,
    options?: { category?: string; shuffle?: boolean }
  ): Promise<Word[]> {
    const courseWords = await db.courseWords.where('courseId').equals(courseId).sortBy('orderIndex');
    const wordIds = courseWords.map(cw => cw.wordId);
    let words = await db.words.where('id').anyOf(wordIds).toArray();

    // Filter by category if specified
    if (options?.category && options.category !== 'all') {
      words = words.filter(w => w.category === options.category);
    }

    if (options?.shuffle) {
      return shuffleList(words);
    }

    // Maintain orderIndex
    const wordMap = new Map(words.map(w => [w.id, w]));
    return wordIds.map(id => wordMap.get(id)).filter((w): w is Word => Boolean(w));
  },

  async getAllDownloadedWords(options?: { category?: string; shuffle?: boolean }): Promise<Word[]> {
    const allCourses = await db.courses.toArray();
    const downloadedCourses = allCourses.filter(c => c.isDownloaded);
    if (downloadedCourses.length === 0) {
      // Fallback: all words in DB
      let allWords = await db.words.toArray();
      if (options?.category && options.category !== 'all') {
        allWords = allWords.filter(w => w.category === options.category);
      }
      return options?.shuffle ? shuffleList(allWords) : allWords;
    }

    const courseIds = downloadedCourses.map(c => c.id);
    const courseWords = await db.courseWords.where('courseId').anyOf(courseIds).toArray();
    const wordIds = Array.from(new Set(courseWords.map(cw => cw.wordId)));
    let words = await db.words.where('id').anyOf(wordIds).toArray();

    if (options?.category && options.category !== 'all') {
      words = words.filter(w => w.category === options.category);
    }

    return options?.shuffle ? shuffleList(words) : words;
  },

  async getDownloadedCategories(): Promise<string[]> {
    const words = await db.words.toArray();
    const categories = new Set<string>();
    words.forEach(w => {
      if (w.category) categories.add(w.category);
    });
    return Array.from(categories);
  },

  // 🌟 Global Master Dictionary Search (All 11,154 Words)
  _masterCache: [] as Word[],
  async searchGlobalMasterWords(query: string, limit = 50): Promise<Word[]> {
    if (!this._masterCache || this._masterCache.length === 0) {
      try {
        const localWords = await db.words.toArray();
        if (localWords.length >= 10000) {
          this._masterCache = localWords;
        } else {
          // Fetch master datasets in parallel
          const [coreRes, advRes, exp1Res, exp2Res, exp3Res] = await Promise.allSettled([
            fetch('/data/v1/core-1200.json').then(r => r.json()),
            fetch('/data/v1/advanced-2500.json').then(r => r.json()),
            fetch('/data/v1/expert-high-part1.json').then(r => r.json()),
            fetch('/data/v1/expert-high-part2.json').then(r => r.json()),
            fetch('/data/v1/expert-high-part3.json').then(r => r.json())
          ]);

          const combined: Word[] = [...localWords];
          const seen = new Set(localWords.map(w => w.headword.toLowerCase()));

          [coreRes, advRes, exp1Res, exp2Res, exp3Res].forEach(res => {
            if (res.status === 'fulfilled' && Array.isArray(res.value?.words)) {
              res.value.words.forEach((w: Word) => {
                if (!seen.has(w.headword.toLowerCase())) {
                  seen.add(w.headword.toLowerCase());
                  combined.push(w);
                }
              });
            }
          });

          this._masterCache = combined;
        }
      } catch (err) {
        console.warn('Failed to load full master dictionary for search:', err);
        this._masterCache = await db.words.toArray();
      }
    }

    if (!query.trim()) {
      return this._masterCache.slice(0, limit);
    }

    const q = query.trim().toLowerCase();
    const exactMatches: Word[] = [];
    const prefixMatches: Word[] = [];
    const containsMatches: Word[] = [];

    for (const w of this._masterCache) {
      const hw = w.headword.toLowerCase();
      const zh = w.definitionZh || '';
      if (hw === q) {
        exactMatches.push(w);
      } else if (hw.startsWith(q)) {
        prefixMatches.push(w);
      } else if (hw.includes(q) || zh.includes(q)) {
        containsMatches.push(w);
      }
      if (exactMatches.length + prefixMatches.length + containsMatches.length >= limit * 2) {
        break;
      }
    }

    return [...exactMatches, ...prefixMatches, ...containsMatches].slice(0, limit);
  },

  async downloadAndSaveCourse(courseId: string, fileName: string): Promise<void> {
    const res = await fetch(`/data/v1/courses/${fileName}?t=${Date.now()}`, { cache: 'no-cache' });
    if (!res.ok) {
      throw new Error(`Failed to download course file ${fileName}: HTTP ${res.status}`);
    }
    const rawData = await res.json();
    const courseDetail = CourseDetailSchema.parse(rawData);

    await db.transaction('rw', [db.courses, db.words, db.courseWords], async () => {
      // Upsert course
      const courseRecord: Course = {
        id: courseDetail.id,
        title: courseDetail.title,
        description: courseDetail.description,
        toeicScoreRange: courseDetail.toeicScoreRange,
        category: courseDetail.category,
        level: courseDetail.level,
        wordCount: courseDetail.wordCount,
        version: courseDetail.version,
        isDownloaded: true,
        downloadedAt: new Date().toISOString()
      };
      await db.courses.put(courseRecord);

      // Upsert words
      await db.words.bulkPut(courseDetail.words);

      // Delete existing courseWords for this course and re-insert
      await db.courseWords.where('courseId').equals(courseId).delete();

      const courseWords: CourseWord[] = courseDetail.words.map((w, index) => ({
        courseId: courseDetail.id,
        wordId: w.id,
        orderIndex: index
      }));

      await db.courseWords.bulkAdd(courseWords);
    });
  },

  async removeCourseCache(courseId: string): Promise<void> {
    await db.transaction('rw', [db.courses, db.courseWords], async () => {
      await db.courses.update(courseId, {
        isDownloaded: false,
        downloadedAt: null
      });
      await db.courseWords.where('courseId').equals(courseId).delete();
      // Note: We deliberately do NOT delete words or student progress to preserve learning history
    });
  }
};
