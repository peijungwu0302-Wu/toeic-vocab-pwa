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
    const res = await fetch('/data/v1/catalog.json');
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

  async downloadAndSaveCourse(courseId: string, fileName: string): Promise<void> {
    const res = await fetch(`/data/v1/courses/${fileName}`);
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
