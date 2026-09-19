/**
 * src/types/today.ts
 * Types for the structured, resumable Today Guided Learning session.
 */

export type TodayPhase = 'review' | 'preview' | 'learn' | 'quiz' | 'summary';

export interface TodaySession {
  sessionId: string;
  profileId: string;
  dateStr: string;
  activeCourseId: string;
  phase: TodayPhase;
  dueWordIds: string[];
  newWordIds: string[];
  currentReviewIndex: number;
  currentPreviewIndex: number;
  currentLearnIndex: number;
  quizUserAnswers: Record<number, number>;
  wrongWordIds: string[];
  createdAt: string;
  updatedAt: string;
  isCompleted: boolean;
}
