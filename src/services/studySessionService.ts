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
  allSessionWordIds?: string[];
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
    } catch {
      /* ignore */
    }
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
    } catch {
      /* ignore */
    }
  },

  /**
   * Partitions words into a slice for the given batch index.
   */
  partitionWordsIntoBatch<T>(allWords: T[], batchIndex: number, batchSize: number): T[] {
    if (batchSize >= 999) return allWords;
    const start = batchIndex * batchSize;
    return allWords.slice(start, start + batchSize);
  },

  /**
   * Calculates the next batch index, wrapping to 0 when end is reached.
   */
  getNextBatchIndex(currentBatchIndex: number, totalWords: number, batchSize: number): number {
    if (totalWords === 0) return 0;
    const totalBatches = Math.ceil(totalWords / batchSize) || 1;
    return (currentBatchIndex + 1) >= totalBatches ? 0 : currentBatchIndex + 1;
  },

  /**
   * Repartitions an existing session's fixed ordering to a new batchSize starting at batch 0.
   */
  repartitionSession<T>(allWords: T[], newBatchSize: number): {
    batchIndex: number;
    activeWords: T[];
    batchSize: number;
  } {
    return {
      batchIndex: 0,
      activeWords: this.partitionWordsIntoBatch(allWords, 0, newBatchSize),
      batchSize: newBatchSize
    };
  }
};
