import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../src/db';
import { todayService } from '../src/services/todayService';
import { progressRepository } from '../src/repositories/progressRepository';
import { profileRepository } from '../src/repositories/profileRepository';
import { Word, Progress } from '../src/types/db';
import { TodaySession } from '../src/types/today';

describe('Phase 3: Resumable Today Guided Learning & Exact Due Count', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    await db.words.clear();
    await db.progress.clear();
    await db.reviewLogs.clear();
    await db.manualQueue.clear();
    await db.profiles.clear();
    await db.courseWords.clear();
    await db.courses.clear();
  });

  describe('A. Exact Uncapped Due Words Count', () => {
    it('returns exact uncapped count (>200) without truncation', async () => {
      const profileId = 'prof_due_test';
      const pastDate = new Date(Date.now() - 86400000).toISOString();

      // Seed 250 due words
      const progressEntries: Progress[] = [];
      for (let i = 0; i < 250; i++) {
        progressEntries.push({
          profileId,
          wordId: `w_due_${i}`,
          due: pastDate,
          stability: 2,
          difficulty: 5,
          elapsedDays: 1,
          scheduledDays: 1,
          reps: 1,
          lapses: 0,
          state: 2,
          lastReview: pastDate,
          updatedAt: pastDate
        });
      }
      await db.progress.bulkPut(progressEntries);

      // Verify uncapped count returns 250
      const count = await progressRepository.getDueWordsCount(profileId);
      expect(count).toBe(250);
    });

    it('excludes suspended cards and future due cards', async () => {
      const profileId = 'prof_filter_test';
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const futureDate = new Date(Date.now() + 86400000 * 5).toISOString();

      await db.progress.bulkPut([
        {
          profileId,
          wordId: 'w_due_normal',
          due: pastDate,
          stability: 2,
          difficulty: 5,
          elapsedDays: 1,
          scheduledDays: 1,
          reps: 1,
          lapses: 0,
          state: 2,
          lastReview: pastDate,
          updatedAt: pastDate
        },
        {
          profileId,
          wordId: 'w_due_suspended',
          due: pastDate,
          stability: 2,
          difficulty: 5,
          elapsedDays: 1,
          scheduledDays: 1,
          reps: 1,
          lapses: 0,
          state: 2,
          lastReview: pastDate,
          updatedAt: pastDate,
          isSuspended: true // Should be excluded
        },
        {
          profileId,
          wordId: 'w_future',
          due: futureDate, // Should be excluded
          stability: 10,
          difficulty: 3,
          elapsedDays: 0,
          scheduledDays: 10,
          reps: 3,
          lapses: 0,
          state: 2,
          lastReview: pastDate,
          updatedAt: pastDate
        }
      ]);

      const count = await progressRepository.getDueWordsCount(profileId);
      expect(count).toBe(1);
    });
  });

  describe('B. Today Guided Learning Session Lifecycle', () => {
    it('creates a structured session respecting activeCourseId and user target settings', async () => {
      const profile = await profileRepository.create({
        displayName: 'Learner One',
        dailyNewCardsTarget: 10,
        dailyReviewTarget: 20
      });

      // Update profile with activeCourseId
      await profileRepository.update(profile.id, { activeCourseId: 'course-advanced-2500' });

      // Create course and words
      await db.courses.put({
        id: 'course-advanced-2500',
        title: 'TOEIC 進階 2500 題庫',
        description: '高階商務考點',
        toeicScoreRange: '700-850',
        category: '商務',
        level: '進階',
        wordCount: 15,
        version: 1,
        isDownloaded: true
      });

      const words: Word[] = [];
      const courseWords = [];
      for (let i = 0; i < 15; i++) {
        const id = `w_adv_${i}`;
        words.push({
          id,
          headword: `advword${i}`,
          normalizedHeadword: `advword${i}`,
          entryType: 'word',
          definitionZh: `進階釋義 ${i}`,
          starRating: 3,
          toeicScoreRange: '700-850',
          category: '商務',
          partsOfSpeech: ['v'],
          wordForms: [],
          phoneticUS: null,
          phoneticUK: null,
          examples: [],
          examTips: [],
          audioUSUrl: null,
          audioUKUrl: null
        });
        courseWords.push({ courseId: 'course-advanced-2500', wordId: id, orderIndex: i });
      }
      await db.words.bulkPut(words);
      await db.courseWords.bulkPut(courseWords);

      // Create TodaySession
      const session = await todayService.createTodaySession(profile.id);

      expect(session.activeCourseId).toBe('course-advanced-2500');
      expect(session.profileId).toBe(profile.id);
      expect(session.newWordIds.length).toBe(10); // respected dailyNewCardsTarget = 10
      expect(session.dueWordIds.length).toBe(0); // no prior due words
      expect(session.phase).toBe('preview'); // with 0 due words, starts at preview
    });

    it('resumes exact phase and indices across reloads', async () => {
      const profileId = 'prof_resume_test';
      const session: TodaySession = {
        sessionId: 'sess_123',
        profileId,
        dateStr: todayService.getTodayDateStr(),
        activeCourseId: 'course-core-1200',
        phase: 'learn',
        dueWordIds: ['w_1', 'w_2'],
        newWordIds: ['w_3', 'w_4', 'w_5'],
        currentReviewIndex: 2,
        currentPreviewIndex: 3,
        currentLearnIndex: 1,
        quizUserAnswers: {},
        wrongWordIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isCompleted: false
      };

      todayService.saveTodaySession(session);

      const loaded = todayService.loadTodaySession(profileId);
      expect(loaded).not.toBeNull();
      expect(loaded?.phase).toBe('learn');
      expect(loaded?.currentLearnIndex).toBe(1);
      expect(loaded?.dueWordIds).toEqual(['w_1', 'w_2']);
      expect(loaded?.newWordIds).toEqual(['w_3', 'w_4', 'w_5']);
    });

    it('isolates today sessions between different profiles', async () => {
      const profA = 'prof_alice';
      const profB = 'prof_bob';
      const todayStr = todayService.getTodayDateStr();

      const sessionA: TodaySession = {
        sessionId: 'sess_A',
        profileId: profA,
        dateStr: todayStr,
        activeCourseId: 'course-core-1200',
        phase: 'review',
        dueWordIds: ['w_a1'],
        newWordIds: [],
        currentReviewIndex: 0,
        currentPreviewIndex: 0,
        currentLearnIndex: 0,
        quizUserAnswers: {},
        wrongWordIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isCompleted: false
      };

      const sessionB: TodaySession = {
        sessionId: 'sess_B',
        profileId: profB,
        dateStr: todayStr,
        activeCourseId: 'course-advanced-2500',
        phase: 'learn',
        dueWordIds: [],
        newWordIds: ['w_b1'],
        currentReviewIndex: 0,
        currentPreviewIndex: 0,
        currentLearnIndex: 0,
        quizUserAnswers: {},
        wrongWordIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isCompleted: false
      };

      todayService.saveTodaySession(sessionA);
      todayService.saveTodaySession(sessionB);

      const loadedA = todayService.loadTodaySession(profA);
      const loadedB = todayService.loadTodaySession(profB);

      expect(loadedA?.activeCourseId).toBe('course-core-1200');
      expect(loadedB?.activeCourseId).toBe('course-advanced-2500');
      expect(loadedA?.phase).toBe('review');
      expect(loadedB?.phase).toBe('learn');
    });

    it('abandons/clears session on command', async () => {
      const profileId = 'prof_abandon_test';
      const session: TodaySession = {
        sessionId: 'sess_abandon',
        profileId,
        dateStr: todayService.getTodayDateStr(),
        activeCourseId: 'course-core-1200',
        phase: 'review',
        dueWordIds: ['w_1'],
        newWordIds: [],
        currentReviewIndex: 0,
        currentPreviewIndex: 0,
        currentLearnIndex: 0,
        quizUserAnswers: {},
        wrongWordIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isCompleted: false
      };

      todayService.saveTodaySession(session);
      expect(todayService.loadTodaySession(profileId)).not.toBeNull();

      todayService.abandonSession(profileId);
      expect(todayService.loadTodaySession(profileId)).toBeNull();
    });
  });
});
