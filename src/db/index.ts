import Dexie, { type Table } from 'dexie';
import {
  Profile,
  Course,
  Word,
  QuizItem,
  CourseWord,
  Progress,
  ReviewLog,
  DailyStat,
  AppSettings,
  SyncQueueItem,
  DatasetMeta
} from '../types/db';

export class AppDatabase extends Dexie {
  profiles!: Table<Profile, string>;
  courses!: Table<Course, string>;
  words!: Table<Word, string>;
  quizzes!: Table<QuizItem, string>;
  courseWords!: Table<CourseWord, number>;
  progress!: Table<Progress, number>;
  reviewLogs!: Table<ReviewLog, string>;
  dailyStats!: Table<DailyStat, number>;
  appSettings!: Table<AppSettings, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  datasetMeta!: Table<DatasetMeta, number>;

  constructor() {
    super('ToeicVocabDB');

    // Version 1 (Initial Release)
    this.version(1).stores({
      profiles: 'id, displayName, createdAt',
      courses: 'id, toeicScoreRange, category, level, isDownloaded',
      words: 'id, normalizedHeadword, entryType, starRating, toeicScoreRange, category',
      courseWords: '++id, [courseId+wordId], [courseId+orderIndex], courseId, wordId',
      progress: '++id, [profileId+wordId], [profileId+due], [profileId+state], profileId, wordId, due, state',
      reviewLogs: 'id, [profileId+reviewedAt], profileId, wordId, reviewedAt, syncStatus',
      dailyStats: '++id, [profileId+dateStr], profileId, dateStr',
      appSettings: 'key',
      syncQueue: 'id, [profileId+status], status, nextAttemptAt, createdAt',
      datasetMeta: 'version'
    });

    // Version 2 (Quiz, Scenario Images, Frequency Tier & 6-Question Matrix)
    this.version(2).stores({
      words: 'id, normalizedHeadword, entryType, starRating, toeicScoreRange, category, frequencyTier',
      quizzes: 'id, wordId, type, subType, frequencyTier'
    });
  }
}

export const db = new AppDatabase();
