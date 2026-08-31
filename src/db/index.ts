import Dexie, { type Table } from 'dexie';
import {
  Profile,
  Course,
  Word,
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
  courseWords!: Table<CourseWord, number>;
  progress!: Table<Progress, number>;
  reviewLogs!: Table<ReviewLog, string>;
  dailyStats!: Table<DailyStat, number>;
  appSettings!: Table<AppSettings, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  datasetMeta!: Table<DatasetMeta, number>;

  constructor() {
    super('ToeicVocabDB');

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
  }
}

export const db = new AppDatabase();
