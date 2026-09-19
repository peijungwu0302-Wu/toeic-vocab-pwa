/**
 * src/services/studySessionService.ts
 * Manages exact session identity and resume states for Flashcard and FastSkim.
 */

export interface FlashcardSessionState {
  sessionId: string;
  profileId: string;
  courseId: string;
  sessionWordIds: string[];
  currentIndex: number;
  sessionConfig: {
    batchSize: number;
    isShuffle: boolean;
    selectedCategory: string;
  };
  createdAt: number;
  updatedAt: number;
}

export interface FastSkimSessionState {
  sessionId: string;
  profileId: string;
  courseId: string;
  sessionWordIds: string[];
  currentIndex: number;
  currentBatchIndex: number;
  batchSize: number;
  selectedCategory: string;
  isShuffle: boolean;
  createdAt: number;
  updatedAt: number;
}

const FLASHCARD_SESSION_PREFIX = 'toeic_active_review_v2_';
const FASTSKIM_SESSION_PREFIX = 'toeic_active_skim_v2_';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export const studySessionService = {
  // --- FLASHCARD ---
  getFlashcardSessionKey(profileId: string, courseId: string = 'all'): string {
    return `${FLASHCARD_SESSION_PREFIX}${profileId}_${courseId || 'all'}`;
  },

  saveFlashcardSession(session: FlashcardSessionState): void {
    if (typeof window === 'undefined' || !session.profileId) return;
    try {
      const key = this.getFlashcardSessionKey(session.profileId, session.courseId);
      localStorage.setItem(key, JSON.stringify(session));
    } catch (e) {
      console.warn('[studySessionService] Failed to save flashcard session:', e);
    }
  },

  loadFlashcardSession(profileId: string, courseId: string = 'all'): FlashcardSessionState | null {
    if (typeof window === 'undefined' || !profileId) return null;
    try {
      const key = this.getFlashcardSessionKey(profileId, courseId);
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed: FlashcardSessionState = JSON.parse(raw);
      // Validate profile ownership and age
      if (parsed.profileId !== profileId) return null;
      if (Date.now() - parsed.updatedAt > SESSION_MAX_AGE_MS) {
        localStorage.removeItem(key);
        return null;
      }
      if (!Array.isArray(parsed.sessionWordIds) || parsed.sessionWordIds.length === 0) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  },

  clearFlashcardSession(profileId: string, courseId: string = 'all'): void {
    if (typeof window === 'undefined' || !profileId) return;
    try {
      const key = this.getFlashcardSessionKey(profileId, courseId);
      localStorage.removeItem(key);
    } catch {}
  },

  // --- FASTSKIM ---
  getFastSkimSessionKey(profileId: string, courseId: string = 'all'): string {
    return `${FASTSKIM_SESSION_PREFIX}${profileId}_${courseId || 'all'}`;
  },

  saveFastSkimSession(session: FastSkimSessionState): void {
    if (typeof window === 'undefined' || !session.profileId) return;
    try {
      const key = this.getFastSkimSessionKey(session.profileId, session.courseId);
      localStorage.setItem(key, JSON.stringify(session));
    } catch (e) {
      console.warn('[studySessionService] Failed to save fast skim session:', e);
    }
  },

  loadFastSkimSession(profileId: string, courseId: string = 'all'): FastSkimSessionState | null {
    if (typeof window === 'undefined' || !profileId) return null;
    try {
      const key = this.getFastSkimSessionKey(profileId, courseId);
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed: FastSkimSessionState = JSON.parse(raw);
      if (parsed.profileId !== profileId) return null;
      if (Date.now() - (parsed.updatedAt || parsed.createdAt) > SESSION_MAX_AGE_MS) {
        localStorage.removeItem(key);
        return null;
      }
      if (!Array.isArray(parsed.sessionWordIds) || parsed.sessionWordIds.length === 0) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  },

  clearFastSkimSession(profileId: string, courseId: string = 'all'): void {
    if (typeof window === 'undefined' || !profileId) return;
    try {
      const key = this.getFastSkimSessionKey(profileId, courseId);
      localStorage.removeItem(key);
    } catch {}
  }
};
