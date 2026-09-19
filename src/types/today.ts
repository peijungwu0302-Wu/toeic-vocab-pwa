/**
 * src/types/today.ts
 * Types for the structured, resumable Today Guided Learning session.
 */

import type { NextGenQuestion } from '../services/quizService';

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
  quizQuestionsSnapshot?: NextGenQuestion[];
  quizCurrentIndex?: number;
  quizUserAnswers: Record<number, number>;
  wrongWordIds: string[];
  createdAt: string;
  updatedAt: string;
  isCompleted: boolean;
}
