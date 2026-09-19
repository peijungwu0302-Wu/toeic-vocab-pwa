/**
 * src/services/todayService.ts
 * Manages structured, resumable Today Guided Learning sessions.
 */

import { TodaySession, TodayPhase } from '../types/today';
import { progressRepository } from '../repositories/progressRepository';
import { courseRepository } from '../repositories/courseRepository';
import { profileRepository } from '../repositories/profileRepository';

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

    // Resolve active course id:
    // 1. preferredCourseId parameter
    // 2. profile.activeCourseId
    // 3. first downloaded course in database
    // 4. fallback to 'course-core-1200'
    let resolvedCourseId = preferredCourseId || profile?.activeCourseId || null;
    if (!resolvedCourseId) {
      const allCourses = await courseRepository.getAll();
      const firstDownloaded = allCourses.find(c => c.isDownloaded);
      resolvedCourseId = firstDownloaded ? firstDownloaded.id : 'course-core-1200';
    }

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
    if (existing && !existing.isCompleted) {
      return existing;
    }
    return this.createTodaySession(profileId, preferredCourseId);
  },

  abandonSession(profileId: string, customDateStr?: string): void {
    if (!profileId) return;
    const dateStr = customDateStr || this.getTodayDateStr();
    localStorage.removeItem(this.getSessionStorageKey(profileId, dateStr));
  }
};
