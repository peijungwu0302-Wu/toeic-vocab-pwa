import { WordEntry } from './vocab';
import { QuizItem } from './quiz';

export interface Profile {
  id: string; // UUID
  displayName: string;
  dailyNewCardsTarget: number;
  dailyReviewTarget: number;
  desiredRetention: number; // e.g. 0.9 (90%)
  fastSkimDurationSec: number; // 3-10s, default 4
  preferredAccent: 'US' | 'UK';
  autoPlayAudio: boolean;
  isMuted: boolean;
  createdAt: string; // ISO UTC
  updatedAt: string; // ISO UTC
  cloudUserId?: string | null;
}

export interface Course {
  id: string;
  title: string;
  description: string;
  toeicScoreRange: string;
  category: string;
  level: string;
  wordCount: number;
  version: number;
  isDownloaded: boolean;
  downloadedAt?: string | null;
}

export type Word = WordEntry;
export type { QuizItem };

export interface CourseWord {
  id?: number; // auto-increment
  courseId: string;
  wordId: string;
  orderIndex: number;
}

export type FSRSState = 0 | 1 | 2 | 3; // 0=New, 1=Learning, 2=Review, 3=Relearning

export interface Progress {
  id?: number;
  profileId: string;
  wordId: string;
  due: string; // ISO UTC
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: FSRSState;
  lastReview: string | null; // ISO UTC
  updatedAt: string; // ISO UTC
  isSuspended?: boolean;
  isStarred?: boolean;
}

export interface ReviewLog {
  id: string; // UUID (client-generated)
  profileId: string;
  wordId: string;
  rating: 1 | 2 | 3 | 4; // 1: Again (忘記), 2: Hard (不熟), 3: Good (掌握), 4: Easy (極熟相容)
  state: FSRSState;
  due: string; // ISO UTC
  stability: number;
  difficulty: number;
  elapsedDays: number;
  lastElapsedDays: number;
  scheduledDays: number;
  reviewDurationMs: number;
  reviewedAt: string; // ISO UTC
  syncStatus: 'synced' | 'pending' | 'failed';
}

export interface DailyStat {
  id?: number;
  profileId: string;
  dateStr: string; // 'YYYY-MM-DD' in local date
  newCardsLearned: number;
  cardsReviewed: number;
  againCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
  totalStudyTimeMs: number;
  updatedAt: string; // ISO UTC
}

export interface AppSettings {
  key: string;
  value: string;
}

export interface SyncQueueItem {
  id: string; // UUID
  profileId: string;
  entityType: 'progress' | 'reviewLog' | 'profile' | 'dailyStat';
  entityId: string;
  payload: string; // JSON string
  operation: 'upsert' | 'delete';
  status: 'pending' | 'processing' | 'failed';
  attempts: number;
  lastError?: string | null;
  createdAt: string; // ISO UTC
  nextAttemptAt: string; // ISO UTC
}

export interface DatasetMeta {
  version: number;
  appliedAt: string;
  totalWords: number;
}
