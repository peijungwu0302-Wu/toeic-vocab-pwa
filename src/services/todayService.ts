/**
 * src/services/todayService.ts
 * Manages structured, resumable Today Guided Learning sessions.
 */

import { TodaySession, TodayPhase } from '../types/today';
import { progressRepository } from '../repositories/progressRepository';
import { profileRepository } from '../repositories/profileRepository';

export const DEFAULT_APP_COURSE_ID = 'course-core-1200';

export const todayService = {
  getTodayDateStr(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  },

  getSessionStorageKey(profileId: string, dateStr: string): string {
    return `toeic_today_session_v1_${profileId}_${dateStr}`;
  },

  loadTodaySession(profileId: string, customDateStr?: string): TodaySession | null {
    if (!profileId) return null;
    const dateStr = customDateStr || this.getTodayDateStr();
    const raw = localStorage.getItem(this.getSessionStorageKey(profileId, dateStr));
    if (!raw) return null;

    try {
      const session = JSON.parse(raw) as TodaySession;
      if (session.profileId !== profileId) return null;
      return session;
    } catch {
      return null;
    }
  },

  loadTodaySessionBySessionId(profileId: string, sessionId: string): TodaySession | null {
    if (!profileId || !sessionId) return null;
    const current = this.loadTodaySession(profileId);
    if (current && current.sessionId === sessionId) {
      return current;
    }
    const prefix = `toeic_today_session_v1_${profileId}_`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw) as TodaySession;
            if (parsed.profileId === profileId && parsed.sessionId === sessionId) {
              return parsed;
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
    return null;
  },

  saveTodaySession(session: TodaySession): void {
    if (!session || !session.profileId) return;
    session.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(
        this.getSessionStorageKey(session.profileId, session.dateStr),
        JSON.stringify(session)
      );
    } catch (err) {
      console.warn('[todayService] Failed to persist session:', err);
    }
  },

  async createTodaySession(
    profileId: string,
    preferredCourseId?: string | null,
    customDateStr?: string
  ): Promise<TodaySession> {
    const dateStr = customDateStr || this.getTodayDateStr();
    const profile = await profileRepository.getById(profileId);

    // Resolve active course id strictly:
    // 1. preferredCourseId parameter (if explicitly provided)
    // 2. profile.activeCourseId
    // 3. Fallback to standard DEFAULT_APP_COURSE_ID
    const resolvedCourseId = preferredCourseId || profile?.activeCourseId || DEFAULT_APP_COURSE_ID;

    const reviewBatchTarget = profile?.dailyReviewTarget || 30;
    const newCardsTarget = profile?.dailyNewCardsTarget || 15;

    // Fetch due words and new words
    const dueItems = await progressRepository.getDueWords(
      profileId,
      resolvedCourseId,
      reviewBatchTarget,
      { shuffle: true }
    );
    const newItems = await progressRepository.getNewWordsForCourse(
      profileId,
      resolvedCourseId,
      newCardsTarget,
      { shuffle: false }
    );

    const dueWordIds = dueItems.map(i => i.word.id);
    const newWordIds = newItems.map(i => i.word.id);

    let initialPhase: TodayPhase = 'review';
    if (dueWordIds.length === 0) {
      initialPhase = newWordIds.length > 0 ? 'preview' : 'summary';
    }

    const nowIso = new Date().toISOString();
    const session: TodaySession = {
      sessionId: `today_${profileId}_${dateStr}_${Date.now()}`,
      profileId,
      dateStr,
      activeCourseId: resolvedCourseId,
      phase: initialPhase,
      dueWordIds,
      newWordIds,
      currentReviewIndex: 0,
      currentPreviewIndex: 0,
      currentLearnIndex: 0,
      quizUserAnswers: {},
      wrongWordIds: [],
      createdAt: nowIso,
      updatedAt: nowIso,
      isCompleted: initialPhase === 'summary'
    };

    this.saveTodaySession(session);
    return session;
  },

  async getOrCreateTodaySession(
    profileId: string,
    preferredCourseId?: string | null
  ): Promise<TodaySession> {
    const existing = this.loadTodaySession(profileId);
    if (existing) {
      return existing;
    }
    return this.createTodaySession(profileId, preferredCourseId);
  },

  abandonSession(profileId: string, customDateStr?: string): void {
    if (!profileId) return;
    const dateStr = customDateStr || this.getTodayDateStr();
    localStorage.removeItem(this.getSessionStorageKey(profileId, dateStr));
  },

  calculateSummaryStats(session: TodaySession): TodaySummaryStats {
    return calculateTodaySummaryStats(session);
  }
};

export interface TodaySummaryStats {
  reviewedCount: number;
  dueTotal: number;
  learnedCount: number;
  newTotal: number;
  quizAnsweredCount: number;
  quizTotal: number;
  quizAccuracy: number | null;
  quizAccuracyStr: string;
}

export function calculateTodaySummaryStats(session: TodaySession): TodaySummaryStats {
  const reviewedCount = Math.min(Math.max(0, session.currentReviewIndex || 0), (session.dueWordIds || []).length);
  const learnedCount = Math.min(Math.max(0, session.currentLearnIndex || 0), (session.newWordIds || []).length);

  const answeredEntries = Object.entries(session.quizUserAnswers || {});
  const quizAnsweredCount = answeredEntries.length;
  const quizTotal = session.quizQuestionsSnapshot?.length || 0;

  let quizCorrectCount = 0;
  for (const [idxStr, selectedOpt] of answeredEntries) {
    const qIdx = parseInt(idxStr, 10);
    const q = session.quizQuestionsSnapshot?.[qIdx];
    if (q && q.correctIndex === selectedOpt) {
      quizCorrectCount++;
    }
  }

  const quizAccuracy = quizAnsweredCount > 0
    ? Math.round((quizCorrectCount / quizAnsweredCount) * 100)
    : null;

  const quizAccuracyStr = quizAccuracy !== null ? `${quizAccuracy}%` : '—';

  return {
    reviewedCount,
    dueTotal: (session.dueWordIds || []).length,
    learnedCount,
    newTotal: (session.newWordIds || []).length,
    quizAnsweredCount,
    quizTotal,
    quizAccuracy,
    quizAccuracyStr
  };
}
