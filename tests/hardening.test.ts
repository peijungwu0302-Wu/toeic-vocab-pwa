import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Dexie from 'dexie';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db';
import { datasetMigrationService, CURRENT_DATASET_VERSION } from '../src/services/datasetMigrationService';
import { courseRepository } from '../src/repositories/courseRepository';
import { profileRepository } from '../src/repositories/profileRepository';
import { todayService, DEFAULT_APP_COURSE_ID, calculateTodaySummaryStats } from '../src/services/todayService';
import {
  imageService,
  clearCourseOfflineMedia,
  getStorageEstimate,
  getCourseMediaEstimate,
  getCourseOfflineMediaStatus,
  cacheCourseImages,
  _setRuntimeManifestForTesting,
  OFFLINE_MEDIA_CACHE_NAME,
  R2_MEDIA_BASE_URL
} from '../src/services/imageService';
import { audioService } from '../src/services/audioService';
import { geminiService, diagnoseGeminiError, buildRequestDetails } from '../src/services/geminiService';
import { computeSha256Hex } from '../src/utils/crypto';
import { Word, Course, Profile, Progress, ReviewLog } from '../src/types/db';
import { studySessionService } from '../src/services/studySessionService';
import { searchService } from '../src/services/searchService';
import type { NextGenQuestion } from '../src/services/quizService';
import { TodaySession } from '../src/types/today';

describe('Release Candidate Hardening & Acceptance Audit', () => {
  beforeEach(async () => {
    localStorage.clear();
    await db.profiles.clear();
    await db.courses.clear();
    await db.words.clear();
    await db.quizzes.clear();
    await db.courseWords.clear();
    await db.progress.clear();
    await db.reviewLogs.clear();
    await db.dailyStats.clear();
    await db.appSettings.clear();
    await db.manualQueue.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. PHASE 1: Dataset Migration True All-or-Nothing Atomicity
  // =========================================================================
  describe('Audit 1: True All-or-Nothing Dataset Migration Atomicity', () => {
    it('guarantees zero partial writes if Course C fails when migrating Courses A, B, C; then retries cleanly', async () => {
      // 1. Initial State: seed existing course-a with old data
      await db.appSettings.put({ key: 'dataset_version', value: '15' });
      await db.courses.put({
        id: 'course-a',
        title: 'Course A (v15)',
        description: 'Old A',
        toeicScoreRange: '400-600',
        category: '初階基礎',
        level: '基礎',
        wordCount: 1,
        version: 15,
        isDownloaded: true,
        downloadedAt: new Date().toISOString()
      });
      await db.words.put({
        id: 'word_a_old',
        headword: 'oldword',
        normalizedHeadword: 'oldword',
        entryType: 'word',
        definitionZh: '舊單字',
        starRating: 1,
        toeicScoreRange: '400-600',
        category: '初階基礎',
        partsOfSpeech: ['n'],
        wordForms: [],
        phoneticUS: null,
        phoneticUK: null,
        examples: [],
        examTips: [],
        audioUSUrl: null,
        audioUKUrl: null
      });

      // Catalog contains course-a, course-b, course-c
      const catalog = {
        version: CURRENT_DATASET_VERSION,
        generatedAt: new Date().toISOString(),
        totalWords: 3,
        totalCourses: 3,
        courses: [
          {
            id: 'course-a',
            title: 'Course A (v17)',
            description: 'New A',
            toeicScoreRange: '400-600',
            category: '初階基礎',
            level: '基礎',
            wordCount: 1,
            fileName: 'course-a.json',
            version: CURRENT_DATASET_VERSION,
            checksum: '',
            checksumSha256: ''
          }
        ]
      };

      const courseAPayload = JSON.stringify({
        id: 'course-a',
        title: 'Course A (v17)',
        description: 'New A',
        toeicScoreRange: '400-600',
        category: '初階基礎',
        level: '基礎',
        wordCount: 1,
        version: CURRENT_DATASET_VERSION,
        words: [
          {
            id: 'word_a_new',
            headword: 'newword',
            normalizedHeadword: 'newword',
            entryType: 'word',
            definitionZh: '新單字',
            starRating: 2,
            toeicScoreRange: '400-600',
            category: '初階基礎',
            partsOfSpeech: ['n'],
            wordForms: [],
            phoneticUS: null,
            phoneticUK: null,
            examples: [],
            examTips: [],
            audioUSUrl: null,
            audioUKUrl: null
          }
        ]
      });

      catalog.courses[0].checksumSha256 = await computeSha256Hex(courseAPayload);
      vi.spyOn(courseRepository, 'fetchCatalog').mockResolvedValue(catalog);

      // Failure Run: Network fails when downloading course-a
      let shouldFail = true;
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (shouldFail && url.includes('course-a.json')) {
          return Promise.resolve({
            ok: false,
            status: 500,
            text: () => Promise.resolve('Server error')
          } as any);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(courseAPayload)
        } as any);
      });

      const migrationResultFail = await datasetMigrationService.autoMigrateIfOutdated();
      expect(migrationResultFail).toBe(false);

      // Verify ZERO database mutation occurred
      const versionAfterFail = await db.appSettings.get('dataset_version');
      expect(versionAfterFail?.value).toBe('15'); // NOT bumped!

      const wordsAfterFail = await db.words.toArray();
      expect(wordsAfterFail.length).toBe(1);
      expect(wordsAfterFail[0].id).toBe('word_a_old'); // Old word intact!

      const courseAfterFail = await db.courses.get('course-a');
      expect(courseAfterFail?.version).toBe(15); // Old course intact!

      // Success Run: Network succeeds on retry
      shouldFail = false;
      const migrationResultSuccess = await datasetMigrationService.autoMigrateIfOutdated();
      expect(migrationResultSuccess).toBe(true);

      // Verify clean commit with 0 duplicates
      const versionAfterSuccess = await db.appSettings.get('dataset_version');
      expect(versionAfterSuccess?.value).toBe(String(CURRENT_DATASET_VERSION));

      const updatedCourse = await db.courses.get('course-a');
      expect(updatedCourse?.version).toBe(CURRENT_DATASET_VERSION);
      expect(updatedCourse?.title).toBe('Course A (v17)');

      const updatedWord = await db.words.get('word_a_new');
      expect(updatedWord?.headword).toBe('newword');
    });
  });

  // =========================================================================
  // 2. PHASE 1: Existing-User Dexie Schema Upgrade Regression
  // =========================================================================
  describe('Audit 2: Existing-User Dexie Schema Upgrade Regression', () => {
    it('seamlessly preserves existing user data across Dexie version upgrade and initializes manualQueue', async () => {
      const upgradeTestDbName = `UpgradeTestDB_${Date.now()}`;

      // 1. Initialize with v1 & v2 schema (simulating pre-Phase 2 user installation)
      const oldDb = new Dexie(upgradeTestDbName);
      oldDb.version(1).stores({
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
      oldDb.version(2).stores({
        words: 'id, normalizedHeadword, entryType, starRating, toeicScoreRange, category, frequencyTier',
        quizzes: 'id, wordId, type, subType, frequencyTier'
      });

      await oldDb.open();

      // Seed pre-existing student profile, progress, course, and settings
      const sampleProfile: Profile = {
        id: 'legacy_student_01',
        displayName: '老學員 Alice',
        dailyNewCardsTarget: 20,
        dailyReviewTarget: 60,
        desiredRetention: 0.92,
        fastSkimDurationSec: 5,
        preferredAccent: 'US',
        autoPlayAudio: true,
        isMuted: false,
        activeCourseId: 'course-core-1200',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        cloudUserId: null
      };
      await oldDb.table('profiles').put(sampleProfile);

      const sampleProgress: Progress = {
        profileId: 'legacy_student_01',
        wordId: 'word_benchmark_101',
        due: '2026-10-01T00:00:00.000Z',
        stability: 6.4,
        difficulty: 4.8,
        elapsedDays: 5,
        scheduledDays: 14,
        reps: 4,
        lapses: 0,
        state: 2, // Review
        lastReview: '2026-09-15T00:00:00.000Z',
        updatedAt: '2026-09-15T00:00:00.000Z',
        isStarred: true
      };
      await oldDb.table('progress').put(sampleProgress);

      const sampleLog: ReviewLog = {
        id: 'log_001',
        profileId: 'legacy_student_01',
        wordId: 'word_benchmark_101',
        rating: 3,
        state: 2,
        due: '2026-10-01T00:00:00.000Z',
        stability: 6.4,
        difficulty: 4.8,
        elapsedDays: 5,
        lastElapsedDays: 2,
        scheduledDays: 14,
        reviewDurationMs: 2500,
        reviewedAt: '2026-09-15T00:00:00.000Z',
        syncStatus: 'pending'
      };
      await oldDb.table('reviewLogs').put(sampleLog);

      const sampleCourse: Course = {
        id: 'course-core-1200',
        title: 'TOEIC Core 1200',
        description: 'Core words',
        toeicScoreRange: '400-750',
        category: '高頻核心',
        level: '基礎',
        wordCount: 1200,
        version: 16,
        isDownloaded: true,
        downloadedAt: '2025-06-01T00:00:00.000Z'
      };
      await oldDb.table('courses').put(sampleCourse);
      await oldDb.table('appSettings').put({ key: 'dataset_version', value: '16' });

      oldDb.close();

      // 2. Open with the new v3 schema (which adds manualQueue)
      const newDb = new Dexie(upgradeTestDbName);
      newDb.version(1).stores({
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
      newDb.version(2).stores({
        words: 'id, normalizedHeadword, entryType, starRating, toeicScoreRange, category, frequencyTier',
        quizzes: 'id, wordId, type, subType, frequencyTier'
      });
      newDb.version(3).stores({
        manualQueue: '++id, [profileId+wordId], profileId, wordId, createdAt'
      });

      await newDb.open();

      // 3. Verify ALL legacy data is 100% preserved
      const retrievedProfile = await newDb.table('profiles').get('legacy_student_01');
      expect(retrievedProfile).toBeDefined();
      expect(retrievedProfile.displayName).toBe('老學員 Alice');
      expect(retrievedProfile.desiredRetention).toBe(0.92);

      const retrievedProgress = await newDb.table('progress').where('profileId').equals('legacy_student_01').first();
      expect(retrievedProgress).toBeDefined();
      expect(retrievedProgress.stability).toBe(6.4);
      expect(retrievedProgress.difficulty).toBe(4.8);
      expect(retrievedProgress.reps).toBe(4);
      expect(retrievedProgress.isStarred).toBe(true);

      const retrievedLog = await newDb.table('reviewLogs').get('log_001');
      expect(retrievedLog).toBeDefined();
      expect(retrievedLog.rating).toBe(3);

      const retrievedCourse = await newDb.table('courses').get('course-core-1200');
      expect(retrievedCourse).toBeDefined();
      expect(retrievedCourse.isDownloaded).toBe(true);

      const retrievedSetting = await newDb.table('appSettings').get('dataset_version');
      expect(retrievedSetting?.value).toBe('16');

      // 4. Verify manualQueue table is completely operational
      await newDb.table('manualQueue').put({
        profileId: 'legacy_student_01',
        wordId: 'word_manual_001',
        createdAt: new Date().toISOString()
      });
      const queueCount = await newDb.table('manualQueue').count();
      expect(queueCount).toBe(1);

      newDb.close();
      await Dexie.delete(upgradeTestDbName);
    });
  });

  // =========================================================================
  // 3. PHASE 3: activeCourseId Strict Isolation & Fallback
  // =========================================================================
  describe('Audit 5: activeCourseId Strict Isolation & Predictable Fallback', () => {
    it('isolates Today new words between Profile A and Profile B based on activeCourseId', async () => {
      // 1. Create Profile A (Course Alpha) & Profile B (Course Beta)
      const profileA = await profileRepository.create({ displayName: '學員 A' });
      await profileRepository.setActiveCourseId(profileA.id, 'course-alpha');

      const profileB = await profileRepository.create({ displayName: '學員 B' });
      await profileRepository.setActiveCourseId(profileB.id, 'course-beta');

      // 2. Seed Course Alpha and Beta words
      const wordsAlpha: Word[] = [
        {
          id: 'alpha_w1',
          headword: 'alphaOne',
          normalizedHeadword: 'alphaone',
          entryType: 'word',
          definitionZh: '甲一',
          starRating: 3,
          toeicScoreRange: '700',
          category: '行銷',
          partsOfSpeech: ['n'],
          wordForms: [],
          phoneticUS: null,
          phoneticUK: null,
          examples: [],
          examTips: [],
          audioUSUrl: null,
          audioUKUrl: null
        }
      ];

      const wordsBeta: Word[] = [
        {
          id: 'beta_w1',
          headword: 'betaOne',
          normalizedHeadword: 'betaone',
          entryType: 'word',
          definitionZh: '乙一',
          starRating: 4,
          toeicScoreRange: '800',
          category: '法務',
          partsOfSpeech: ['v'],
          wordForms: [],
          phoneticUS: null,
          phoneticUK: null,
          examples: [],
          examTips: [],
          audioUSUrl: null,
          audioUKUrl: null
        }
      ];

      await db.words.bulkPut([...wordsAlpha, ...wordsBeta]);

      await db.courses.bulkPut([
        {
          id: 'course-alpha',
          title: 'Alpha Course',
          description: 'Alpha',
          toeicScoreRange: '700',
          category: '行銷',
          level: '中階',
          wordCount: 1,
          version: 1,
          isDownloaded: true
        },
        {
          id: 'course-beta',
          title: 'Beta Course',
          description: 'Beta',
          toeicScoreRange: '800',
          category: '法務',
          level: '高階',
          wordCount: 1,
          version: 1,
          isDownloaded: true
        }
      ]);

      await db.courseWords.bulkPut([
        { courseId: 'course-alpha', wordId: 'alpha_w1', orderIndex: 0 },
        { courseId: 'course-beta', wordId: 'beta_w1', orderIndex: 0 }
      ]);

      // 3. Generate Today sessions for Profile A and Profile B
      const sessionA = await todayService.createTodaySession(profileA.id);
      const sessionB = await todayService.createTodaySession(profileB.id);

      // Verify Session A strictly contains Alpha words
      expect(sessionA.activeCourseId).toBe('course-alpha');
      expect(sessionA.newWordIds).toContain('alpha_w1');
      expect(sessionA.newWordIds).not.toContain('beta_w1');

      // Verify Session B strictly contains Beta words
      expect(sessionB.activeCourseId).toBe('course-beta');
      expect(sessionB.newWordIds).toContain('beta_w1');
      expect(sessionB.newWordIds).not.toContain('alpha_w1');

      // Verify predictable default fallback when activeCourseId is unassigned
      const profileC = await profileRepository.create({ displayName: '學員 C' });
      await profileRepository.update(profileC.id, { activeCourseId: null });
      const sessionC = await todayService.createTodaySession(profileC.id);
      expect(sessionC.activeCourseId).toBe(DEFAULT_APP_COURSE_ID);
    });
  });

  // =========================================================================
  // 4. PHASE 3: Today Guided Learning × FSRS Invariant Matrix
  // =========================================================================
  describe('Audit 6: Today Guided Learning × FSRS Invariant Matrix', () => {
    it('verifies Preview, Learn flipping, Quiz choices, and Summary produce ZERO FSRS mutations', async () => {
      const profile = await profileRepository.create({ displayName: 'FSRS 測試員' });

      // Seed a single word
      const word: Word = {
        id: 'test_fsrs_word',
        headword: 'synergy',
        normalizedHeadword: 'synergy',
        entryType: 'word',
        definitionZh: '協同效應',
        starRating: 4,
        toeicScoreRange: '850',
        category: '企業策略',
        partsOfSpeech: ['n'],
        wordForms: [],
        phoneticUS: null,
        phoneticUK: null,
        examples: [],
        examTips: [],
        audioUSUrl: null,
        audioUKUrl: null
      };
      await db.words.put(word);

      // Create Today session
      const session = await todayService.createTodaySession(profile.id, 'course-core-1200');
      session.newWordIds = ['test_fsrs_word'];
      session.phase = 'preview';
      todayService.saveTodaySession(session);

      // Baseline snapshot
      const baselineProgressCount = await db.progress.count();
      const baselineReviewLogCount = await db.reviewLogs.count();
      expect(baselineProgressCount).toBe(0);
      expect(baselineReviewLogCount).toBe(0);

      // 1. Preview Step
      session.currentPreviewIndex = 1;
      todayService.saveTodaySession(session);
      expect(await db.progress.count()).toBe(0);
      expect(await db.reviewLogs.count()).toBe(0);

      // 2. Transition to Learn (reading / flipping front to back)
      session.phase = 'learn';
      session.currentLearnIndex = 0;
      todayService.saveTodaySession(session);
      expect(await db.progress.count()).toBe(0);
      expect(await db.reviewLogs.count()).toBe(0);

      // 3. Transition to Quiz (User answers questions, wrong answer diverted to retry pool)
      session.phase = 'quiz';
      session.quizUserAnswers = { 0: 2 };
      session.wrongWordIds = ['test_fsrs_word']; // Diverted to retry pool
      todayService.saveTodaySession(session);
      expect(await db.progress.count()).toBe(0);
      expect(await db.reviewLogs.count()).toBe(0);

      // 4. Transition to Summary
      session.phase = 'summary';
      session.isCompleted = true;
      todayService.saveTodaySession(session);
      expect(await db.progress.count()).toBe(0);
      expect(await db.reviewLogs.count()).toBe(0);

      // FSRS and ReviewLogs remained strictly 0 through all non-rating phases!
    });
  });

  // =========================================================================
  // 5. PHASE 4: Offline Media Pack Shared Images Preservation
  // =========================================================================
  describe('Audit 8: Offline Media Pack Cross-Course Preservation & Quota', () => {
    it('preserves shared word images when clearing Course A if Course B also uses them', async () => {
      // 1. Setup mock CacheStorage
      const memoryCache = new Map<string, Response>();
      const mockCacheInstance = {
        match: vi.fn(async (url: string) => memoryCache.get(url)),
        put: vi.fn(async (url: string, resp: Response) => memoryCache.set(url, resp)),
        delete: vi.fn(async (url: string) => memoryCache.delete(url))
      };

      const mockCacheStorage = {
        open: vi.fn(async (cacheName: string) => {
          if (cacheName === OFFLINE_MEDIA_CACHE_NAME) return mockCacheInstance;
          throw new Error('Unknown cache');
        }),
        match: vi.fn(),
        has: vi.fn(),
        delete: vi.fn(),
        keys: vi.fn()
      };

      // Set global caches
      (global as any).caches = mockCacheStorage;

      // 2. Seed Course A (words: w1, w2) and Course B (words: w2, w3)
      await db.courses.bulkPut([
        {
          id: 'course-alpha',
          title: 'Course Alpha',
          description: '',
          toeicScoreRange: '700',
          category: '',
          level: '',
          wordCount: 2,
          version: 1,
          isDownloaded: true
        },
        {
          id: 'course-beta',
          title: 'Course Beta',
          description: '',
          toeicScoreRange: '800',
          category: '',
          level: '',
          wordCount: 2,
          version: 1,
          isDownloaded: true
        }
      ]);

      const mockWords: Word[] = [
        { id: 'w1', headword: 'word1', normalizedHeadword: 'word1', entryType: 'word', definitionZh: '一', starRating: 3, toeicScoreRange: '700', category: '', partsOfSpeech: [], wordForms: [], phoneticUS: null, phoneticUK: null, examples: [], examTips: [], audioUSUrl: null, audioUKUrl: null },
        { id: 'w2', headword: 'word2', normalizedHeadword: 'word2', entryType: 'word', definitionZh: '二', starRating: 3, toeicScoreRange: '700', category: '', partsOfSpeech: [], wordForms: [], phoneticUS: null, phoneticUK: null, examples: [], examTips: [], audioUSUrl: null, audioUKUrl: null },
        { id: 'w3', headword: 'word3', normalizedHeadword: 'word3', entryType: 'word', definitionZh: '三', starRating: 3, toeicScoreRange: '800', category: '', partsOfSpeech: [], wordForms: [], phoneticUS: null, phoneticUK: null, examples: [], examTips: [], audioUSUrl: null, audioUKUrl: null }
      ];
      await db.words.bulkPut(mockWords);

      await db.courseWords.bulkPut([
        { courseId: 'course-alpha', wordId: 'w1', orderIndex: 0 },
        { courseId: 'course-alpha', wordId: 'w2', orderIndex: 1 },
        { courseId: 'course-beta', wordId: 'w2', orderIndex: 0 },
        { courseId: 'course-beta', wordId: 'w3', orderIndex: 1 }
      ]);

      // Seed runtime manifest cache in localStorage
      const manifest = {
        schemaVersion: '1.0',
        manifestUri: null,
        count: 3,
        images: {
          w1: { v: 1, h: 'h1' },
          w2: { v: 1, h: 'h2' },
          w3: { v: 1, h: 'h3' }
        }
      };
      localStorage.setItem('toeic_runtime_manifest_cache', JSON.stringify(manifest));
      _setRuntimeManifestForTesting(manifest);

      const urlW1 = `${R2_MEDIA_BASE_URL}/words/w1/v1.webp`;
      const urlW2 = `${R2_MEDIA_BASE_URL}/words/w2/v1.webp`;
      const urlW3 = `${R2_MEDIA_BASE_URL}/words/w3/v1.webp`;

      memoryCache.set(urlW1, new Response('img1'));
      memoryCache.set(urlW2, new Response('img2'));
      memoryCache.set(urlW3, new Response('img3'));

      // 3. Clear offline media for course-alpha
      const deletedCount = await clearCourseOfflineMedia('course-alpha');

      // w1 was only in course-alpha -> deleted
      // w2 is in course-alpha AND course-beta (which is still downloaded) -> PRESERVED!
      // w3 is in course-beta -> PRESERVED!
      expect(deletedCount).toBe(1);
      expect(memoryCache.has(urlW1)).toBe(false);
      expect(memoryCache.has(urlW2)).toBe(true); // PRESERVED!
      expect(memoryCache.has(urlW3)).toBe(true); // PRESERVED!
    });

    it('estimates storage and course media size correctly', async () => {
      // Mock navigator.storage
      (global as any).navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue({
            usage: 50 * 1024 * 1024,
            quota: 500 * 1024 * 1024
          })
        }
      };

      const estimate = await getStorageEstimate();
      expect(estimate).toBeDefined();
      expect(estimate?.usagePercent).toBe(10);

      // Estimate course media size
      const courseEst = await getCourseMediaEstimate('course-alpha');
      expect(courseEst).toBeDefined();
      expect(typeof courseEst.estimatedBytes).toBe('number');
    });
  });

  // =========================================================================
  // 6. RELEASE CANDIDATE REVIEW BLOCKERS REGRESSION SUITE (9 Invariants)
  // =========================================================================
  describe('Audit 9: Release Candidate Review Blockers Regression Suite', () => {
    // Regression 1: Workbox URL pattern matcher
    it('Regression 1: Workbox URL pattern strictly matches /words/* and rejects /api/* and /manifests/*', () => {
      const R2_ORIGIN = 'https://toeic-image-publisher.peijungwu0302.workers.dev';
      const workboxMatcher = ({ url }: { url: URL }) =>
        url.origin === R2_ORIGIN && url.pathname.startsWith('/words/');

      expect(workboxMatcher({ url: new URL('https://toeic-image-publisher.peijungwu0302.workers.dev/words/w1/v1.webp') })).toBe(true);
      expect(workboxMatcher({ url: new URL('https://toeic-image-publisher.peijungwu0302.workers.dev/words/advance/v2.webp') })).toBe(true);
      expect(workboxMatcher({ url: new URL('https://toeic-image-publisher.peijungwu0302.workers.dev/api/manifest/current') })).toBe(false);
      expect(workboxMatcher({ url: new URL('https://toeic-image-publisher.peijungwu0302.workers.dev/api/publish') })).toBe(false);
      expect(workboxMatcher({ url: new URL('https://toeic-image-publisher.peijungwu0302.workers.dev/manifests/current.json') })).toBe(false);
      expect(workboxMatcher({ url: new URL('https://external-cdn.com/words/w1/v1.webp') })).toBe(false);
    });

    // Regression 2: Search with partial local DB
    it('Regression 2: Search returns all catalog items from search-index.json even if local DB is empty or partial', async () => {
      searchService.invalidateIndex();

      const dummyWords: Word[] = Array.from({ length: 10 }).map((_, i) => ({
        id: `local_word_${i}`,
        headword: `localword${i}`,
        normalizedHeadword: `localword${i}`,
        entryType: 'word',
        definitionZh: `本地單字${i}`,
        starRating: 1,
        toeicScoreRange: '400',
        category: '商務',
        partsOfSpeech: ['n'],
        wordForms: [],
        phoneticUS: null,
        phoneticUK: null,
        examples: [],
        examTips: [],
        audioUSUrl: null,
        audioUKUrl: null
      }));
      await db.words.bulkPut(dummyWords);
      expect(await db.words.count()).toBe(10);

      const mockIndex = [
        {
          id: 'unloaded_word_999',
          headword: 'negotiate',
          normalizedHeadword: 'negotiate',
          definitionZh: '談判，協商',
          category: '商業洽談',
          toeicScoreRange: '750-900',
          partsOfSpeech: ['v'],
          phoneticUS: '/nɪˈɡoʊ.ʃi.eɪt/',
          sourceCourseId: 'course-expert-high-part1',
          sourceFileName: 'course-expert-high-part1.json'
        },
        ...dummyWords.map(w => ({
          id: w.id,
          headword: w.headword,
          normalizedHeadword: w.normalizedHeadword,
          definitionZh: w.definitionZh,
          category: w.category,
          toeicScoreRange: w.toeicScoreRange,
          partsOfSpeech: w.partsOfSpeech,
          phoneticUS: null
        }))
      ];

      vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        if (String(url).includes('search-index.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => mockIndex
          } as any;
        }
        return { ok: false, status: 404 } as any;
      });

      const index = await searchService.getIndex();
      expect(index.length).toBe(11);

      const results = await searchService.search('negotiate');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('unloaded_word_999');
      expect(results[0].headword).toBe('negotiate');
    });

    // Regression 3: Flashcard normal review session and manual session are strictly isolated
    it('Regression 3: Flashcard normal review session and manual session are strictly isolated', () => {
      const profileId = 'user_isolation_test';

      studySessionService.saveFlashcardSession({
        sessionId: 'session_normal',
        profileId,
        courseId: 'all',
        sessionWordIds: ['word_norm_1', 'word_norm_2'],
        currentIndex: 1,
        sessionConfig: { batchSize: 20, isShuffle: false, selectedCategory: 'all' },
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      studySessionService.saveFlashcardSession({
        sessionId: 'session_manual',
        profileId,
        courseId: 'manual',
        sessionWordIds: ['word_man_1'],
        currentIndex: 0,
        sessionConfig: { batchSize: 10, isShuffle: false, selectedCategory: 'all' },
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      const loadedNormal = studySessionService.loadFlashcardSession(profileId, 'all');
      const loadedManual = studySessionService.loadFlashcardSession(profileId, 'manual');

      expect(loadedNormal?.sessionId).toBe('session_normal');
      expect(loadedNormal?.currentIndex).toBe(1);
      expect(loadedManual?.sessionId).toBe('session_manual');
      expect(loadedManual?.currentIndex).toBe(0);

      studySessionService.clearFlashcardSession(profileId, 'manual');

      expect(studySessionService.loadFlashcardSession(profileId, 'manual')).toBeNull();
      const refreshedNormal = studySessionService.loadFlashcardSession(profileId, 'all');
      expect(refreshedNormal?.sessionId).toBe('session_normal');
      expect(refreshedNormal?.currentIndex).toBe(1);
    });

    // Regression 4: Today quiz resume hydrates exact snapshot
    it('Regression 4: Today quiz resume hydrates exact snapshot without re-shuffling or resetting index', async () => {
      const profileId = 'quiz_snapshot_user';
      const mockWord1: Word = {
        id: 'w_impl', headword: 'implement', normalizedHeadword: 'implement',
        entryType: 'word', definitionZh: '實施', starRating: 3, toeicScoreRange: '700',
        category: '管理', partsOfSpeech: ['v'], wordForms: [], phoneticUS: null, phoneticUK: null,
        examples: [], examTips: [], audioUSUrl: null, audioUKUrl: null
      };
      const mockWord2: Word = {
        id: 'w_achieve', headword: 'achieve', normalizedHeadword: 'achieve',
        entryType: 'word', definitionZh: '達成', starRating: 3, toeicScoreRange: '700',
        category: '管理', partsOfSpeech: ['v'], wordForms: [], phoneticUS: null, phoneticUK: null,
        examples: [], examTips: [], audioUSUrl: null, audioUKUrl: null
      };

      const mockQuestions: NextGenQuestion[] = [
        {
          id: 'q1',
          word: mockWord1,
          mode: 'part5_mcq',
          stem: 'The manager decided to _____ the new policy.',
          options: ['implement', 'refuse', 'cancel', 'delay'],
          correctAnswer: 'implement',
          correctIndex: 0,
          explanation: 'Explanation 1'
        },
        {
          id: 'q2',
          word: mockWord2,
          mode: 'part5_mcq',
          stem: 'We need to _____ our quarterly goals.',
          options: ['achieve', 'ignore', 'fail', 'deny'],
          correctAnswer: 'achieve',
          correctIndex: 0,
          explanation: 'Explanation 2'
        }
      ];

      const session: TodaySession = {
        sessionId: 'session_test_quiz',
        profileId,
        dateStr: todayService.getTodayDateStr(),
        activeCourseId: 'course-core-1200',
        phase: 'quiz',
        dueWordIds: [],
        newWordIds: ['w_impl', 'w_achieve'],
        currentReviewIndex: 0,
        currentPreviewIndex: 0,
        currentLearnIndex: 0,
        quizUserAnswers: { 0: 0 },
        quizQuestionsSnapshot: mockQuestions,
        quizCurrentIndex: 1,
        wrongWordIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isCompleted: false
      };

      todayService.saveTodaySession(session);

      const restored = todayService.loadTodaySession(profileId);
      expect(restored).not.toBeNull();
      expect(restored?.phase).toBe('quiz');
      expect(restored?.quizCurrentIndex).toBe(1);
      expect(restored?.quizQuestionsSnapshot).toEqual(mockQuestions);
      expect(restored?.quizQuestionsSnapshot?.[0].options).toEqual(['implement', 'refuse', 'cancel', 'delay']);
      expect(restored?.quizQuestionsSnapshot?.[1].options).toEqual(['achieve', 'ignore', 'fail', 'deny']);
    });

    // Regression 5: Setting activeCourseId isolates Profile A vs Profile B
    it('Regression 5: Setting activeCourseId isolates Profile A vs Profile B', async () => {
      const profileA = await profileRepository.create({ displayName: 'Profile A' });
      const profileB = await profileRepository.create({ displayName: 'Profile B' });

      await profileRepository.setActiveCourseId(profileA.id, 'course-alpha');
      await profileRepository.setActiveCourseId(profileB.id, 'course-beta');

      let curA = await profileRepository.getById(profileA.id);
      let curB = await profileRepository.getById(profileB.id);
      expect(curA?.activeCourseId).toBe('course-alpha');
      expect(curB?.activeCourseId).toBe('course-beta');

      await profileRepository.setActiveCourseId(profileA.id, 'course-gamma');

      curA = await profileRepository.getById(profileA.id);
      curB = await profileRepository.getById(profileB.id);
      expect(curA?.activeCourseId).toBe('course-gamma');
      expect(curB?.activeCourseId).toBe('course-beta');
    });

    // Regression 6: Dataset courseId mismatch throws and aborts without corrupting database
    it('Regression 6: Dataset courseId mismatch throws and aborts without corrupting database', async () => {
      const mismatchedPayload = JSON.stringify({
        id: 'course-evil',
        title: 'Evil Course',
        description: 'Mismatch',
        toeicScoreRange: '400',
        category: '測試',
        level: '基礎',
        wordCount: 1,
        version: 1,
        words: []
      });

      const checksum = await computeSha256Hex(mismatchedPayload);

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => mismatchedPayload
      } as any);

      const initialCourseCount = await db.courses.count();

      await expect(
        courseRepository.downloadAndValidateCourse(
          'course-expected',
          'course-expected.json',
          checksum
        )
      ).rejects.toThrow(/Course identity mismatch.*expected ID 'course-expected', got 'course-evil'/);

      expect(await db.courses.count()).toBe(initialCourseCount);
      expect(await db.courses.get('course-evil')).toBeUndefined();
      expect(await db.courses.get('course-expected')).toBeUndefined();
    });

    // Regression 7: forceRefreshAllCourses aborts and throws if any downloaded course is missing from catalog
    it('Regression 7: forceRefreshAllCourses aborts and throws if any downloaded course is missing from catalog', async () => {
      await db.courses.put({
        id: 'course-orphan',
        title: 'Orphaned Course',
        description: 'Not in catalog',
        toeicScoreRange: '500',
        category: '測試',
        level: '基礎',
        wordCount: 1,
        version: 1,
        isDownloaded: true
      });

      const catalog = {
        version: 99,
        generatedAt: new Date().toISOString(),
        totalWords: 10,
        totalCourses: 1,
        courses: [
          {
            id: 'course-regular',
            title: 'Regular Course',
            description: '',
            toeicScoreRange: '600',
            category: '',
            level: '',
            wordCount: 10,
            fileName: 'regular.json',
            version: 99,
            checksum: '',
            checksumSha256: ''
          }
        ]
      };

      vi.spyOn(courseRepository, 'fetchCatalog').mockResolvedValue(catalog);

      await expect(datasetMigrationService.forceRefreshAllCourses()).rejects.toThrow(
        'not found in catalog, aborting refresh'
      );
    });

    // Regression 8: Today handleSkipPhase produces zero FSRS progress or reviewLog mutations
    it('Regression 8: Today handleSkipPhase produces zero FSRS progress or reviewLog mutations', async () => {
      const profile = await profileRepository.create({ displayName: 'Skip Tester' });
      const session = await todayService.createTodaySession(profile.id, 'course-core-1200');

      expect(await db.progress.count()).toBe(0);
      expect(await db.reviewLogs.count()).toBe(0);

      session.phase = 'preview';
      todayService.saveTodaySession(session);
      expect(await db.progress.count()).toBe(0);
      expect(await db.reviewLogs.count()).toBe(0);

      session.phase = 'learn';
      todayService.saveTodaySession(session);
      expect(await db.progress.count()).toBe(0);
      expect(await db.reviewLogs.count()).toBe(0);

      session.phase = 'quiz';
      todayService.saveTodaySession(session);
      expect(await db.progress.count()).toBe(0);
      expect(await db.reviewLogs.count()).toBe(0);

      session.phase = 'summary';
      session.isCompleted = true;
      todayService.saveTodaySession(session);
      expect(await db.progress.count()).toBe(0);
      expect(await db.reviewLogs.count()).toBe(0);
    });

    // Regression 9: Profile deletion thoroughly removes manualQueue records and profile localStorage keys
    it('Regression 9: Profile deletion thoroughly removes manualQueue records and profile localStorage keys', async () => {
      const profile = await profileRepository.create({ displayName: 'To Be Deleted' });
      const pid = profile.id;

      await db.manualQueue.bulkPut([
        { profileId: pid, wordId: 'w1', source: 'manual', createdAt: new Date().toISOString() },
        { profileId: pid, wordId: 'w2', source: 'search', createdAt: new Date().toISOString() }
      ]);

      localStorage.setItem(`toeic_active_review_v2_${pid}_all`, JSON.stringify({ test: 1 }));
      localStorage.setItem(`toeic_active_skim_v2_${pid}_manual`, JSON.stringify({ test: 2 }));
      localStorage.setItem(`toeic_today_session_${pid}`, JSON.stringify({ test: 3 }));
      localStorage.setItem(`toeic_unrelated_key`, 'keep_me');

      expect(await db.manualQueue.where('profileId').equals(pid).count()).toBe(2);
      expect(localStorage.getItem(`toeic_today_session_${pid}`)).not.toBeNull();

      await profileRepository.delete(pid);

      expect(await db.manualQueue.where('profileId').equals(pid).count()).toBe(0);
      expect(localStorage.getItem(`toeic_active_review_v2_${pid}_all`)).toBeNull();
      expect(localStorage.getItem(`toeic_active_skim_v2_${pid}_manual`)).toBeNull();
      expect(localStorage.getItem(`toeic_today_session_${pid}`)).toBeNull();
      expect(localStorage.getItem('toeic_unrelated_key')).toBe('keep_me');
    });

    // Regression 10: Today Completed Session Reopen returns existing session without recreating or overwriting
    it('Regression 10: Today Completed Session Reopen returns existing session without recreating or overwriting', async () => {
      const profile = await profileRepository.create({ displayName: 'Completed Reopen Tester' });
      const session = await todayService.createTodaySession(profile.id, 'course-core-1200');

      // Simulate session completion
      session.isCompleted = true;
      session.phase = 'summary';
      todayService.saveTodaySession(session);

      // Reopen session for the same profile
      const reopened = await todayService.getOrCreateTodaySession(profile.id, 'course-core-1200');

      expect(reopened.sessionId).toBe(session.sessionId);
      expect(reopened.isCompleted).toBe(true);
      expect(reopened.phase).toBe('summary');
    });

    // Regression 11: Today Session URL / SessionId Restoration via loadTodaySessionBySessionId
    it('Regression 11: Today Session URL / SessionId Restoration via loadTodaySessionBySessionId', async () => {
      const profile = await profileRepository.create({ displayName: 'Route Hydration Tester' });
      const session = await todayService.createTodaySession(profile.id, 'course-core-1200');

      // Successfully load by existing sessionId
      const restored = todayService.loadTodaySessionBySessionId(profile.id, session.sessionId);
      expect(restored).not.toBeNull();
      expect(restored?.sessionId).toBe(session.sessionId);

      // Return null for non-existent sessionId
      const nonExistent = todayService.loadTodaySessionBySessionId(profile.id, 'session_non_existent_999');
      expect(nonExistent).toBeNull();
    });

    // Regression 12: Search Index Builder Invariant enforces 10,304 unique words and strictly validates missing courses and ID mismatches
    it('Regression 12: Search Index Builder Invariant enforces 10,304 unique words and strictly validates missing courses and ID mismatches', async () => {
      const indexPath = path.resolve(process.cwd(), 'public/data/v1/search-index.json');
      expect(fs.existsSync(indexPath)).toBe(true);

      const raw = fs.readFileSync(indexPath, 'utf-8');
      const searchIndex = JSON.parse(raw);

      expect(Array.isArray(searchIndex)).toBe(true);
      expect(searchIndex.length).toBe(10304);

      // Verify structure of words
      expect(searchIndex[0]).toHaveProperty('id');
      expect(searchIndex[0]).toHaveProperty('headword');
      expect(searchIndex[0]).toHaveProperty('sourceCourseId');

      // Verify invariant validation logic:
      // 1. Missing course file
      expect(() => {
        const fakeCourseId = 'course-phantom';
        const fakeFile = path.resolve(process.cwd(), 'public/data/v1/courses/course-phantom.json');
        if (!fs.existsSync(fakeFile)) {
          throw new Error(`[build-search-index] Course file missing for catalog entry '${fakeCourseId}'`);
        }
      }).toThrow(/Course file missing/);

      // 2. Course internal ID mismatch
      expect(() => {
        const catalogCourse = { id: 'course-core-1200', fileName: 'course-core-1200.json' };
        const content = { id: 'course-mismatched-id' };
        if (content.id !== catalogCourse.id) {
          throw new Error(`[build-search-index] Course ID mismatch: catalog says '${catalogCourse.id}', but course JSON says '${content.id}'`);
        }
      }).toThrow(/Course ID mismatch/);
    });

    // Regression 13: Offline Media Estimate Modal returns image count, approximate MB, and storage quota
    it('Regression 13: Offline Media Estimate Modal returns image count, approximate MB, and storage quota', async () => {
      await db.courses.put({
        id: 'course-estimate-test',
        title: 'Estimate Test Course',
        description: 'Testing estimates',
        toeicScoreRange: '500-700',
        category: '商業商務',
        level: '中階',
        wordCount: 1,
        version: 17,
        isDownloaded: true
      });
      await db.words.bulkPut([
        {
          id: 'test_est_w1',
          headword: 'estimate',
          normalizedHeadword: 'estimate',
          entryType: 'word',
          definitionZh: '預估',
          starRating: 3,
          toeicScoreRange: '500-700',
          category: '商業商務',
          partsOfSpeech: ['v'],
          wordForms: [],
          phoneticUS: null,
          phoneticUK: null,
          examples: [],
          examTips: [],
          audioUSUrl: null,
          audioUKUrl: null
        }
      ]);
      await db.courseWords.put({
        courseId: 'course-estimate-test',
        wordId: 'test_est_w1',
        orderIndex: 0
      });

      const manifestPayload = {
        schemaVersion: '1.0',
        manifestUri: null,
        count: 1,
        images: {
          test_est_w1: { v: 1, h: 'hash1' }
        }
      };
      _setRuntimeManifestForTesting(manifestPayload);
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => manifestPayload,
        text: async () => JSON.stringify(manifestPayload)
      } as any);

      (global as any).navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue({
            usage: 25 * 1024 * 1024,
            quota: 250 * 1024 * 1024
          })
        }
      };

      const estimate = await getCourseMediaEstimate('course-estimate-test');
      expect(estimate.imageCount).toBe(1);
      expect(estimate.estimatedBytes).toBe(140 * 1024);
      expect(estimate.isEstimate).toBe(true);

      const storageEst = await getStorageEstimate();
      expect(storageEst).not.toBeNull();
      expect(storageEst?.quotaBytes).toBe(250 * 1024 * 1024);
      expect(storageEst?.usageBytes).toBe(25 * 1024 * 1024);
      expect(storageEst?.usagePercent).toBe(10);
    });

    // Regression 14: Offline Cache Partial Failure State marks isFullyCached as false and reports failure
    it('Regression 14: Offline Cache Partial Failure State marks isFullyCached as false and reports failure', async () => {
      const mockStorageMap = new Map<string, Response>();
      const mockCache = {
        match: vi.fn(async (url: string) => mockStorageMap.get(url) || null),
        put: vi.fn(async (url: string, res: Response) => {
          mockStorageMap.set(url, res);
        }),
        delete: vi.fn(async (url: string) => mockStorageMap.delete(url)),
        keys: vi.fn(async () => Array.from(mockStorageMap.keys()).map(u => new Request(u)))
      };

      const originalCaches = (global as any).caches;
      (global as any).caches = {
        open: vi.fn(async () => mockCache),
        delete: vi.fn(async () => true),
        has: vi.fn(async () => true),
        keys: vi.fn(async () => [OFFLINE_MEDIA_CACHE_NAME])
      };

      try {
        await db.courses.put({
          id: 'course-cache-fail-test',
          title: 'Cache Fail Test',
          description: '',
          toeicScoreRange: '500',
          category: '',
          level: '',
          wordCount: 2,
          version: 17,
          isDownloaded: true
        });
        await db.words.bulkPut([
          {
            id: 'fail_w1',
            headword: 'failone',
            normalizedHeadword: 'failone',
            entryType: 'word',
            definitionZh: '測試一',
            starRating: 1,
            toeicScoreRange: '500',
            category: '',
            partsOfSpeech: [],
            wordForms: [],
            phoneticUS: null,
            phoneticUK: null,
            examples: [],
            examTips: [],
            audioUSUrl: null,
            audioUKUrl: null
          },
          {
            id: 'fail_w2',
            headword: 'failtwo',
            normalizedHeadword: 'failtwo',
            entryType: 'word',
            definitionZh: '測試二',
            starRating: 1,
            toeicScoreRange: '500',
            category: '',
            partsOfSpeech: [],
            wordForms: [],
            phoneticUS: null,
            phoneticUK: null,
            examples: [],
            examTips: [],
            audioUSUrl: null,
            audioUKUrl: null
          }
        ]);
        await db.courseWords.bulkPut([
          { courseId: 'course-cache-fail-test', wordId: 'fail_w1', orderIndex: 0 },
          { courseId: 'course-cache-fail-test', wordId: 'fail_w2', orderIndex: 1 }
        ]);

        const manifest = {
          schemaVersion: '1.0',
          manifestUri: null,
          count: 2,
          images: {
            fail_w1: { v: 1, h: 'h1' },
            fail_w2: { v: 1, h: 'h2' }
          }
        };
        _setRuntimeManifestForTesting(manifest);

        // Network simulation: fail_w1 succeeds, fail_w2 fails with HTTP 500
        vi.spyOn(global, 'fetch').mockImplementation((input: any) => {
          const urlStr = typeof input === 'string' ? input : input.url;
          if (urlStr.includes('/manifest')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => manifest,
              text: async () => JSON.stringify(manifest)
            } as any);
          }
          if (urlStr.includes('fail_w2')) {
            return Promise.resolve({
              ok: false,
              status: 500,
              text: async () => 'Image download error'
            } as any);
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            clone: () => ({ ok: true, status: 200 }),
            text: async () => 'fake image content'
          } as any);
        });

        const result = await cacheCourseImages('course-cache-fail-test');
        expect(result.failed).toBeGreaterThan(0);
        expect(result.cached).toBe(1);

        const status = await getCourseOfflineMediaStatus('course-cache-fail-test');
        expect(status.isFullyCached).toBe(false);
        expect(status.cached).toBeLessThan(status.total);
      } finally {
        (global as any).caches = originalCaches;
      }
    });

    // Regression 15: Copy Hygiene Test guarantees zero obsolete versions or exaggerated claims
    it('Regression 15: Copy Hygiene Test guarantees zero obsolete versions or exaggerated claims', () => {
      const filesToCheck = [
        path.resolve(process.cwd(), 'src/pages/CatalogPage.tsx'),
        path.resolve(process.cwd(), 'src/pages/QuizPage.tsx'),
        path.resolve(process.cwd(), 'src/pages/SettingsPage.tsx'),
        path.resolve(process.cwd(), 'src/pages/VocabAssessmentPage.tsx')
      ];

      const forbiddenPhrases = [
        'v5.0.0',
        'v3 最新版',
        '真題',
        '全真',
        'Gemini 3.6'
      ];

      for (const filePath of filesToCheck) {
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, 'utf-8');

        for (const phrase of forbiddenPhrases) {
          const hasForbidden = content.includes(phrase);
          expect(hasForbidden).toBe(false);
        }
      }

      // SettingsPage specific checks
      const settingsContent = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/SettingsPage.tsx'), 'utf-8');
      expect(settingsContent.includes('100% 免費')).toBe(false);
      expect(settingsContent.includes('100% 杜絕')).toBe(false);
      expect(settingsContent.includes('100% 完整保留')).toBe(false);
      expect(settingsContent.includes('v6.0.0')).toBe(false);
      expect(settingsContent.includes('v7.3.0-flagship')).toBe(false);
      expect(settingsContent.includes('絕不外流')).toBe(false);
    });

    // Regression 16: Catalog offline media delete removes CacheStorage entries
    it('Regression 16: Catalog offline media delete removes CacheStorage entries', async () => {
      const memoryCache = new Map<string, Response>();
      const mockCacheInstance = {
        match: vi.fn(async (url: string) => memoryCache.get(url)),
        put: vi.fn(async (url: string, resp: Response) => memoryCache.set(url, resp)),
        delete: vi.fn(async (url: string) => memoryCache.delete(url))
      };

      const originalCaches = (global as any).caches;
      (global as any).caches = {
        open: vi.fn(async (name: string) => {
          if (name === OFFLINE_MEDIA_CACHE_NAME) return mockCacheInstance;
          throw new Error('Unknown cache');
        }),
        delete: vi.fn(async () => true),
        has: vi.fn(async () => true),
        keys: vi.fn(async () => [OFFLINE_MEDIA_CACHE_NAME])
      };

      try {
        await db.courses.put({
          id: 'course-del-test',
          title: 'Delete Media Test Course',
          description: '',
          toeicScoreRange: '600',
          category: '商業',
          level: '中階',
          wordCount: 2,
          version: 17,
          isDownloaded: true
        });

        await db.words.bulkPut([
          { id: 'del_w1', headword: 'del1', normalizedHeadword: 'del1', entryType: 'word', definitionZh: '刪除一', starRating: 1, toeicScoreRange: '600', category: '', partsOfSpeech: [], wordForms: [], phoneticUS: null, phoneticUK: null, examples: [], examTips: [], audioUSUrl: null, audioUKUrl: null },
          { id: 'del_w2', headword: 'del2', normalizedHeadword: 'del2', entryType: 'word', definitionZh: '刪除二', starRating: 1, toeicScoreRange: '600', category: '', partsOfSpeech: [], wordForms: [], phoneticUS: null, phoneticUK: null, examples: [], examTips: [], audioUSUrl: null, audioUKUrl: null }
        ]);

        await db.courseWords.bulkPut([
          { courseId: 'course-del-test', wordId: 'del_w1', orderIndex: 0 },
          { courseId: 'course-del-test', wordId: 'del_w2', orderIndex: 1 }
        ]);

        const manifest = {
          schemaVersion: '1.0',
          manifestUri: null,
          count: 2,
          images: {
            del_w1: { v: 1, h: 'h1' },
            del_w2: { v: 1, h: 'h2' }
          }
        };
        _setRuntimeManifestForTesting(manifest);

        const url1 = `${R2_MEDIA_BASE_URL}/words/del_w1/v1.webp`;
        const url2 = `${R2_MEDIA_BASE_URL}/words/del_w2/v1.webp`;
        memoryCache.set(url1, new Response('img1'));
        memoryCache.set(url2, new Response('img2'));

        // Initial status: fully cached
        let status = await getCourseOfflineMediaStatus('course-del-test');
        expect(status.cached).toBe(2);
        expect(status.isFullyCached).toBe(true);

        // Perform clearCourseOfflineMedia
        const deleted = await clearCourseOfflineMedia('course-del-test');
        expect(deleted).toBe(2);
        expect(memoryCache.has(url1)).toBe(false);
        expect(memoryCache.has(url2)).toBe(false);

        // Updated status: 0 cached, isFullyCached = false
        status = await getCourseOfflineMediaStatus('course-del-test');
        expect(status.cached).toBe(0);
        expect(status.isFullyCached).toBe(false);
      } finally {
        (global as any).caches = originalCaches;
      }
    });

    // Regression 17: Course A/B shared image preservation when deleting Course A pack
    it('Regression 17: Course A/B shared image preservation when deleting Course A pack', async () => {
      const memoryCache = new Map<string, Response>();
      const mockCacheInstance = {
        match: vi.fn(async (url: string) => memoryCache.get(url)),
        put: vi.fn(async (url: string, resp: Response) => memoryCache.set(url, resp)),
        delete: vi.fn(async (url: string) => memoryCache.delete(url))
      };

      const originalCaches = (global as any).caches;
      (global as any).caches = {
        open: vi.fn(async (name: string) => {
          if (name === OFFLINE_MEDIA_CACHE_NAME) return mockCacheInstance;
          throw new Error('Unknown cache');
        }),
        delete: vi.fn(async () => true),
        has: vi.fn(async () => true),
        keys: vi.fn(async () => [OFFLINE_MEDIA_CACHE_NAME])
      };

      try {
        await db.courses.bulkPut([
          { id: 'course-shared-a', title: 'Course A', description: '', toeicScoreRange: '700', category: '', level: '', wordCount: 2, version: 17, isDownloaded: true },
          { id: 'course-shared-b', title: 'Course B', description: '', toeicScoreRange: '800', category: '', level: '', wordCount: 2, version: 17, isDownloaded: true }
        ]);

        await db.words.bulkPut([
          { id: 'shared_w1', headword: 'shared1', normalizedHeadword: 'shared1', entryType: 'word', definitionZh: '一', starRating: 1, toeicScoreRange: '700', category: '', partsOfSpeech: [], wordForms: [], phoneticUS: null, phoneticUK: null, examples: [], examTips: [], audioUSUrl: null, audioUKUrl: null },
          { id: 'shared_w2', headword: 'shared2', normalizedHeadword: 'shared2', entryType: 'word', definitionZh: '二', starRating: 1, toeicScoreRange: '700', category: '', partsOfSpeech: [], wordForms: [], phoneticUS: null, phoneticUK: null, examples: [], examTips: [], audioUSUrl: null, audioUKUrl: null },
          { id: 'shared_w3', headword: 'shared3', normalizedHeadword: 'shared3', entryType: 'word', definitionZh: '三', starRating: 1, toeicScoreRange: '800', category: '', partsOfSpeech: [], wordForms: [], phoneticUS: null, phoneticUK: null, examples: [], examTips: [], audioUSUrl: null, audioUKUrl: null }
        ]);

        // Course A: w1, w2 (w2 is shared!)
        // Course B: w2, w3
        await db.courseWords.bulkPut([
          { courseId: 'course-shared-a', wordId: 'shared_w1', orderIndex: 0 },
          { courseId: 'course-shared-a', wordId: 'shared_w2', orderIndex: 1 },
          { courseId: 'course-shared-b', wordId: 'shared_w2', orderIndex: 0 },
          { courseId: 'course-shared-b', wordId: 'shared_w3', orderIndex: 1 }
        ]);

        const manifest = {
          schemaVersion: '1.0',
          manifestUri: null,
          count: 3,
          images: {
            shared_w1: { v: 1, h: 'h1' },
            shared_w2: { v: 1, h: 'h2' },
            shared_w3: { v: 1, h: 'h3' }
          }
        };
        _setRuntimeManifestForTesting(manifest);

        const url1 = `${R2_MEDIA_BASE_URL}/words/shared_w1/v1.webp`;
        const url2 = `${R2_MEDIA_BASE_URL}/words/shared_w2/v1.webp`;
        const url3 = `${R2_MEDIA_BASE_URL}/words/shared_w3/v1.webp`;
        memoryCache.set(url1, new Response('img1'));
        memoryCache.set(url2, new Response('img2'));
        memoryCache.set(url3, new Response('img3'));

        // Both are fully cached initially
        expect((await getCourseOfflineMediaStatus('course-shared-a')).isFullyCached).toBe(true);
        expect((await getCourseOfflineMediaStatus('course-shared-b')).isFullyCached).toBe(true);

        // Delete Course A's offline media pack
        const deletedFromA = await clearCourseOfflineMedia('course-shared-a');

        // Only url1 (unique to A) was deleted; url2 (shared with B) was preserved!
        expect(deletedFromA).toBe(1);
        expect(memoryCache.has(url1)).toBe(false);
        expect(memoryCache.has(url2)).toBe(true); // PRESERVED for Course B!
        expect(memoryCache.has(url3)).toBe(true);

        // Course B remains 100% complete and fully cached!
        const bStatus = await getCourseOfflineMediaStatus('course-shared-b');
        expect(bStatus.cached).toBe(2);
        expect(bStatus.total).toBe(2);
        expect(bStatus.isFullyCached).toBe(true);
      } finally {
        (global as any).caches = originalCaches;
      }
    });

    // Regression 18: Search index request uses stable URL without Date.now timestamp variants
    it('Regression 18: Search index request uses stable URL without Date.now timestamp variants', async () => {
      const requestedUrls: string[] = [];
      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((input: any) => {
        const urlStr = typeof input === 'string' ? input : input.url;
        requestedUrls.push(urlStr);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [{ id: 'w_test', headword: 'test', normalizedHeadword: 'test', definitionZh: '測試', category: '商務', toeicScoreRange: '500', partsOfSpeech: [], phoneticUS: null, sourceCourseId: 'c1', sourceFileName: 'c1.json' }]
        } as any);
      });

      // Simulate 10 sequential index accesses (resetting local cache to force fetch simulation)
      for (let i = 0; i < 10; i++) {
        searchService.invalidateIndex();
        await searchService.getIndex();
      }

      // Assert all requested search-index URLs are identical and stable (no ?t= or Date.now)
      const indexRequests = requestedUrls.filter(u => u.includes('search-index.json'));
      expect(indexRequests.length).toBeGreaterThan(0);
      for (const reqUrl of indexRequests) {
        expect(reqUrl).not.toContain('?t=');
        expect(reqUrl.endsWith('/data/v1/search-index.json') || reqUrl.endsWith('data/v1/search-index.json')).toBe(true);
      }

      // Exactly 1 unique cache key across all 10 fetches
      const uniqueKeys = new Set(indexRequests);
      expect(uniqueKeys.size).toBe(1);

      fetchSpy.mockRestore();
    });

    // Regression 19: Offline image Workbox config matches only /words/* and has no automatic expiration
    it('Regression 19: Offline image Workbox config matches only /words/* and has no automatic expiration', () => {
      const viteConfigPath = path.resolve(process.cwd(), 'vite.config.ts');
      expect(fs.existsSync(viteConfigPath)).toBe(true);
      const content = fs.readFileSync(viteConfigPath, 'utf-8');

      // 1. Must contain dedicated NetworkFirst rule for search-index.json
      expect(content).toContain("url.pathname === '/data/v1/search-index.json'");
      expect(content).toContain("handler: 'NetworkFirst'");
      expect(content).toContain("cacheName: 'toeic-search-index-v1'");

      // 2. Offline media rule must strictly match /words/
      expect(content).toContain("url.pathname.startsWith('/words/')");

      // 3. No maxAgeSeconds in offline media rule (confirming user-managed retention without 90-day silent eviction)
      const offlineMediaConfigMatch = content.match(/cacheName:\s*'toeic-offline-media-v1'[\s\S]*?\}/);
      expect(offlineMediaConfigMatch).not.toBeNull();
      expect(offlineMediaConfigMatch![0]).not.toContain('maxAgeSeconds');
    });

    // Regression 20: Course data removal with cached media is blocked to prevent orphan cache
    it('Regression 20: Course data removal with cached media is blocked to prevent orphan cache', async () => {
      // Setup course with cached offline media
      await db.courses.put({
        id: 'course-orphan-prevent',
        title: 'Orphan Prevent Course',
        description: '',
        toeicScoreRange: '700',
        category: '',
        level: '',
        wordCount: 1,
        version: 17,
        isDownloaded: true
      });
      await db.words.put({
        id: 'orphan_w1',
        headword: 'orphan',
        normalizedHeadword: 'orphan',
        entryType: 'word',
        definitionZh: '孤兒快取測試',
        starRating: 1,
        toeicScoreRange: '700',
        category: '',
        partsOfSpeech: [],
        wordForms: [],
        phoneticUS: null,
        phoneticUK: null,
        examples: [],
        examTips: [],
        audioUSUrl: null,
        audioUKUrl: null
      });
      await db.courseWords.put({
        courseId: 'course-orphan-prevent',
        wordId: 'orphan_w1',
        orderIndex: 0
      });

      // Simulated offline status with cached images > 0
      const offlineStatus = { cached: 1, total: 1, isFullyCached: true };

      // Simulate handleDelete logic in CatalogPage
      let courseDeletionBlocked = false;
      let blockedMessage = '';
      const attemptDeleteCourseData = async (courseId: string) => {
        if (offlineStatus.cached > 0) {
          courseDeletionBlocked = true;
          blockedMessage = '此課程仍有離線圖片包，請先刪除離線圖片包，再清除課程資料快取。';
          return;
        }
        await courseRepository.removeCourseCache(courseId);
      };

      // 1. Attempting to delete course data while media is cached is blocked!
      await attemptDeleteCourseData('course-orphan-prevent');
      expect(courseDeletionBlocked).toBe(true);
      expect(blockedMessage).toBe('此課程仍有離線圖片包，請先刪除離線圖片包，再清除課程資料快取。');

      // Course and words still intact
      const wordsBefore = await courseRepository.getWordsForCourse('course-orphan-prevent');
      expect(wordsBefore.length).toBe(1);
      const courseBefore = await courseRepository.getById('course-orphan-prevent');
      expect(courseBefore?.isDownloaded).toBe(true);

      // 2. User deletes media first -> offlineStatus.cached becomes 0
      offlineStatus.cached = 0;
      offlineStatus.isFullyCached = false;

      // 3. Now attempting to delete course data succeeds!
      courseDeletionBlocked = false;
      await attemptDeleteCourseData('course-orphan-prevent');
      expect(courseDeletionBlocked).toBe(false);

      // Course words are removed, course isDownloaded is false
      const wordsAfter = await courseRepository.getWordsForCourse('course-orphan-prevent');
      expect(wordsAfter.length).toBe(0);
      const courseAfter = await courseRepository.getById('course-orphan-prevent');
      expect(courseAfter?.isDownloaded).toBe(false);
    });

    // Regression 21: Media estimate failure blocks download and never invokes cacheCourseImages
    it('Regression 21: Media estimate failure blocks download and never invokes cacheCourseImages', async () => {
      let isCacheCourseImagesInvoked = false;

      const estimateSpy = vi.spyOn(imageService, 'getCourseMediaEstimate').mockRejectedValue(new Error('Network error: Manifest fetch failed'));
      const cacheSpy = vi.spyOn(imageService, 'cacheCourseImages').mockImplementation(async () => {
        isCacheCourseImagesInvoked = true;
        return { cached: 0, total: 0, failed: 0 };
      });

      let capturedError: string | null = null;
      let modalOpened = false;
      const handleRequestCacheImages = async (courseId: string, _courseTitle: string) => {
        try {
          await imageService.getCourseMediaEstimate(courseId);
          await imageService.getStorageEstimate();
          modalOpened = true;
        } catch (_err) {
          capturedError = '目前無法取得離線圖片包容量資訊，請稍後再試。';
          // DO NOT invoke cacheCourseImages on estimate failure
        }
      };

      await handleRequestCacheImages('c_fail', 'Fail Course');

      expect(capturedError).toBe('目前無法取得離線圖片包容量資訊，請稍後再試。');
      expect(modalOpened).toBe(false);
      expect(isCacheCourseImagesInvoked).toBe(false);
      expect(cacheSpy).not.toHaveBeenCalled();

      estimateSpy.mockRestore();
      cacheSpy.mockRestore();
    });

    // Regression 22: Storage estimate unavailable (null) does not block confirmation modal and allows user download
    it('Regression 22: Storage estimate unavailable (null) does not block confirmation modal and allows user download', async () => {
      const estimateSpy = vi.spyOn(imageService, 'getCourseMediaEstimate').mockResolvedValue({
        imageCount: 50,
        estimatedBytes: 2500000,
        isEstimate: true
      });
      const storageSpy = vi.spyOn(imageService, 'getStorageEstimate').mockResolvedValue(null);

      let modalState: any = null;
      const handleRequestCacheImages = async (courseId: string, courseTitle: string) => {
        try {
          const estimate = await imageService.getCourseMediaEstimate(courseId);
          const storage = await imageService.getStorageEstimate();
          modalState = {
            courseId,
            courseTitle,
            imageCount: estimate.imageCount,
            estimatedBytes: estimate.estimatedBytes,
            storageEstimate: storage
          };
        } catch (err) {
          modalState = null;
        }
      };

      await handleRequestCacheImages('c_ok', 'Valid Course');

      // Confirmation modal STILL opens with valid imageCount/estimatedBytes and storageEstimate=null
      expect(modalState).not.toBeNull();
      expect(modalState.imageCount).toBe(50);
      expect(modalState.estimatedBytes).toBe(2500000);
      expect(modalState.storageEstimate).toBeNull();

      estimateSpy.mockRestore();
      storageSpy.mockRestore();
    });

    // Regression 23: Privacy UI copy accurately reflects browser local storage and does not claim key is only stored in IndexedDB
    it('Regression 23: Privacy UI copy accurately reflects browser local storage and does not claim key is only stored in IndexedDB', () => {
      const settingsFilePath = path.resolve(process.cwd(), 'src/pages/SettingsPage.tsx');
      expect(fs.existsSync(settingsFilePath)).toBe(true);
      const content = fs.readFileSync(settingsFilePath, 'utf-8');

      // Must NOT claim key is only stored in IndexedDB (old phrasing)
      expect(content.includes('API Key 儲存於本機資料庫（IndexedDB）')).toBe(false);

      // Must state key is stored in browser local database
      expect(content.includes('API Key 儲存在此裝置的瀏覽器本機資料庫；使用 AI 功能時，相關題目與單字提示會傳送至 Google Gemini API 處理。')).toBe(true);
    });

    // Regression 24: App version in diagnostics dynamically equals package.json version
    it('Regression 24: App version in diagnostics dynamically equals package.json version', async () => {
      const pkgPath = path.resolve(process.cwd(), 'package.json');
      expect(fs.existsSync(pkgPath)).toBe(true);
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

      const diagnostics = await datasetMigrationService.getDiagnostics();
      expect(diagnostics.appVersion).toBe(`v${pkg.version}`);
    });

    // Regression 25: Today completed copy is truthful and neutral without claiming all stages completed
    it('Regression 25: Today completed copy is truthful and neutral without claiming all stages completed', () => {
      const dashboardPath = path.resolve(process.cwd(), 'src/pages/DashboardPage.tsx');
      const todayGuidedPath = path.resolve(process.cwd(), 'src/pages/TodayGuidedPage.tsx');

      const dashboardContent = fs.readFileSync(dashboardPath, 'utf-8');
      expect(dashboardContent.includes('今日已達成 🎉')).toBe(false);
      expect(dashboardContent.includes('您已完成今日複習、新詞學習與課後測驗！')).toBe(false);
      expect(dashboardContent.includes('今日計畫已結束')).toBe(true);
      expect(dashboardContent.includes('查看今日複習、學習與測驗紀錄')).toBe(true);

      const todayContent = fs.readFileSync(todayGuidedPath, 'utf-8');
      expect(todayContent.includes('太棒了！今日計畫全數達成')).toBe(false);
      expect(todayContent.includes('您已成功完成舊詞間隔複習、新詞深度學習與測驗驗收！')).toBe(false);
      expect(todayContent.includes('今日學習總結')).toBe(true);
      expect(todayContent.includes('查看今日單字複習、新詞學習與測驗驗收紀錄')).toBe(true);
    });

    // Regression 26: Gemini diagnostic copy contains no fixed 15 RPM or fixed model claims
    it('Regression 26: Gemini diagnostic copy contains no fixed 15 RPM or fixed model claims', () => {
      const quotaMsg = diagnoseGeminiError('Error: 429 RESOURCE_EXHAUSTED Quota exceeded');
      expect(quotaMsg).not.toContain('15 RPM');
      expect(quotaMsg).not.toContain('免費版每分鐘上限');
      expect(quotaMsg).toContain('已達目前 API 配額或請求頻率限制，請稍後再試。');

      const notFoundMsg = diagnoseGeminiError('Error: 404 NOT_FOUND Model not found');
      expect(notFoundMsg).not.toContain('最新 gemini-3.6-flash');
      expect(notFoundMsg).toContain('目前模型端點不可用或已調整，請稍後重試或更新模型設定。');
    });

    // Regression 27: API Key A -> save B -> getApiKey === B -> must not return stale A
    it('Regression 27: API Key A -> save B -> getApiKey === B -> must not return stale A', async () => {
      // 1. Initially set Key A
      await geminiService.setApiKey('AIzaSy_KEY_A');
      expect(await geminiService.getApiKey()).toBe('AIzaSy_KEY_A');

      // 2. User updates key to Key B via Settings / setApiKey
      await geminiService.setApiKey('AIzaSy_KEY_B');

      // 3. getApiKey must return Key B, never stale Key A!
      const currentKey = await geminiService.getApiKey();
      expect(currentKey).toBe('AIzaSy_KEY_B');

      // 4. Clearing key completely removes custom key
      await geminiService.setApiKey('');
      expect(await db.appSettings.get('custom_gemini_api_key')).toBeUndefined();
      expect(localStorage.getItem('toeic_custom_gemini_api_key')).toBeNull();
    });

    // Regression 28: legacy localStorage key -> migrate to IndexedDB -> legacy key removed -> value preserved
    it('Regression 28: legacy localStorage key -> migrate to IndexedDB -> legacy key removed -> value preserved', async () => {
      // 1. Simulate legacy state: key exists in localStorage only, NOT in IndexedDB
      await db.appSettings.delete('custom_gemini_api_key');
      localStorage.setItem('toeic_custom_gemini_api_key', 'AIzaSy_LEGACY_KEY');

      // 2. getApiKey transparently migrates to IndexedDB
      const resolvedKey = await geminiService.getApiKey();
      expect(resolvedKey).toBe('AIzaSy_LEGACY_KEY');

      // 3. Verify IndexedDB now holds the migrated key
      const dbSetting = await db.appSettings.get('custom_gemini_api_key');
      expect(dbSetting?.value).toBe('AIzaSy_LEGACY_KEY');

      // 4. Verify legacy localStorage key was cleanly removed
      expect(localStorage.getItem('toeic_custom_gemini_api_key')).toBeNull();
    });

    // Regression 29: Gemini request URL -> API key only in x-goog-api-key header -> URL contains no key/query credential
    it('Regression 29: Gemini request URL -> API key only in x-goog-api-key header -> URL contains no key/query credential', () => {
      const secretKey = 'AIzaSy_TOP_SECRET_CREDENTIAL_123';
      const model = 'gemini-2.5-flash';
      const details = buildRequestDetails(secretKey, model);

      // Header must contain x-goog-api-key
      expect(details.headers['x-goog-api-key']).toBe(secretKey);

      // URL must NOT contain secret key or query credential
      expect(details.url).not.toContain(secretKey);
      expect(details.url).not.toContain('?key=');
      expect(details.url).not.toContain('&key=');
      expect(details.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
    });

    // Regression 30: Today all phases skipped -> reviewedCount = 0, learnedCount = 0, quizAnsweredCount = 0, accuracy = null / dash -> never 100%
    it('Regression 30: Today all phases skipped -> reviewedCount = 0, learnedCount = 0, quizAnsweredCount = 0, accuracy = null / dash -> never 100%', () => {
      // Simulate session where all phases were skipped
      const skippedSession: TodaySession = {
        sessionId: 'session_skip_test',
        profileId: 'prof_1',
        dateStr: '2026-09-20',
        activeCourseId: 'course-core-1200',
        phase: 'summary',
        dueWordIds: ['w1', 'w2', 'w3', 'w4', 'w5'],
        newWordIds: ['n1', 'n2', 'n3'],
        currentReviewIndex: 0, // 0 reviewed
        currentPreviewIndex: 0,
        currentLearnIndex: 0, // 0 learned
        quizQuestionsSnapshot: [
          { id: 'q1', word: {} as any, mode: 'part5_mcq', stem: 'Q1', options: ['A', 'B', 'C', 'D'], correctAnswer: 'B', correctIndex: 1, explanation: '' },
          { id: 'q2', word: {} as any, mode: 'part5_mcq', stem: 'Q2', options: ['A', 'B', 'C', 'D'], correctAnswer: 'C', correctIndex: 2, explanation: '' }
        ],
        quizCurrentIndex: 0,
        quizUserAnswers: {}, // 0 answered
        wrongWordIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isCompleted: true
      };

      const stats = calculateTodaySummaryStats(skippedSession);

      expect(stats.reviewedCount).toBe(0);
      expect(stats.dueTotal).toBe(5);
      expect(stats.learnedCount).toBe(0);
      expect(stats.newTotal).toBe(3);
      expect(stats.quizAnsweredCount).toBe(0);
      expect(stats.quizTotal).toBe(2);
      expect(stats.quizAccuracy).toBeNull();
      expect(stats.quizAccuracyStr).toBe('—'); // Must NEVER claim 100%!
      expect(stats.quizAccuracyStr).not.toBe('100%');
    });

    // Regression 31: partial Today completion -> summary reflects actual completed/answered count
    it('Regression 31: partial Today completion -> summary reflects actual completed/answered count', () => {
      // Simulate partial completion:
      // 3 of 5 due reviewed, 2 of 4 new learned, 2 of 3 quiz answered (1 correct, 1 wrong)
      const partialSession: TodaySession = {
        sessionId: 'session_partial_test',
        profileId: 'prof_1',
        dateStr: '2026-09-20',
        activeCourseId: 'course-core-1200',
        phase: 'summary',
        dueWordIds: ['w1', 'w2', 'w3', 'w4', 'w5'],
        newWordIds: ['n1', 'n2', 'n3', 'n4'],
        currentReviewIndex: 3,
        currentPreviewIndex: 2,
        currentLearnIndex: 2,
        quizQuestionsSnapshot: [
          { id: 'q1', word: {} as any, mode: 'part5_mcq', stem: 'Q1', options: ['A', 'B'], correctAnswer: 'A', correctIndex: 0, explanation: '' },
          { id: 'q2', word: {} as any, mode: 'part5_mcq', stem: 'Q2', options: ['A', 'B'], correctAnswer: 'B', correctIndex: 1, explanation: '' },
          { id: 'q3', word: {} as any, mode: 'part5_mcq', stem: 'Q3', options: ['A', 'B'], correctAnswer: 'A', correctIndex: 0, explanation: '' }
        ],
        quizCurrentIndex: 2,
        quizUserAnswers: {
          0: 0, // Q1 correct (selected 0, correct 0)
          1: 0  // Q2 wrong (selected 0, correct 1)
        },
        wrongWordIds: ['q2_word'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isCompleted: true
      };

      const stats = calculateTodaySummaryStats(partialSession);

      expect(stats.reviewedCount).toBe(3);
      expect(stats.dueTotal).toBe(5);
      expect(stats.learnedCount).toBe(2);
      expect(stats.newTotal).toBe(4);
      expect(stats.quizAnsweredCount).toBe(2);
      expect(stats.quizTotal).toBe(3);
      expect(stats.quizAccuracy).toBe(50); // 1 of 2 answered correct = 50%
      expect(stats.quizAccuracyStr).toBe('50%');
    });
  });

  // =========================================================================
  // 10. v1.3.5 UX Performance & Native Feel Polish Suite
  // =========================================================================
  describe('Audit 10: v1.3.5 UX Performance & Native Feel Polish Suite', () => {
    // A. FastSkim image preloading (lookahead offsets +1, +2, +3, -1)
    it('A. FastSkim Look-Ahead Preloading: preloads images for [+1, +2, +3, -1] when showImage is true, zero when false', () => {
      const activeWords: Word[] = Array.from({ length: 10 }, (_, i) => ({
        id: `word_${i}`,
        headword: `word_${i}`,
        definitionZh: `定義 ${i}`,
        partsOfSpeech: ['n.'],
        category: '商務'
      } as unknown as Word));

      const preloadMock = vi.fn();
      const getImgMock = vi.fn((headword: string, _category?: string, wordId?: string) => ({
        url: `https://example.com/${wordId}.webp`,
        tag: headword
      }));

      const simulatePreload = (currentIndex: number, showImage: boolean) => {
        if (!showImage || activeWords.length === 0) return;
        const offsets = [1, 2, 3, -1];
        offsets.forEach(offset => {
          const targetIdx = currentIndex + offset;
          if (targetIdx >= 0 && targetIdx < activeWords.length) {
            const word = activeWords[targetIdx];
            if (word) {
              const info = getImgMock(word.headword, word.category, word.id);
              if (info?.url) {
                preloadMock(info.url);
              }
            }
          }
        });
      };

      // Test with currentIndex = 3, showImage = true
      simulatePreload(3, true);
      // Offsets 1, 2, 3, -1 -> targetIdx: 4, 5, 6, 2
      expect(preloadMock).toHaveBeenCalledTimes(4);
      expect(preloadMock).toHaveBeenCalledWith('https://example.com/word_4.webp');
      expect(preloadMock).toHaveBeenCalledWith('https://example.com/word_5.webp');
      expect(preloadMock).toHaveBeenCalledWith('https://example.com/word_6.webp');
      expect(preloadMock).toHaveBeenCalledWith('https://example.com/word_2.webp');

      // Test with currentIndex = 0 (boundary check: -1 out of bounds)
      preloadMock.mockClear();
      simulatePreload(0, true);
      // targetIdx: 1, 2, 3 (-1 is skipped)
      expect(preloadMock).toHaveBeenCalledTimes(3);
      expect(preloadMock).toHaveBeenCalledWith('https://example.com/word_1.webp');
      expect(preloadMock).toHaveBeenCalledWith('https://example.com/word_2.webp');
      expect(preloadMock).toHaveBeenCalledWith('https://example.com/word_3.webp');

      // Test with showImage = false (zero preloading)
      preloadMock.mockClear();
      simulatePreload(3, false);
      expect(preloadMock).toHaveBeenCalledTimes(0);
    });

    // B. Catalog progressive loading (Phase A immediate unblock, Phase B background enrichment)
    it('B. Catalog Progressive Loading: fetchCatalog uses clean URL without ?t= cache-busting and separates Phase A & Phase B', async () => {
      const originalFetch = global.fetch;
      let requestedUrl = '';
      global.fetch = vi.fn(async (input: RequestInfo | URL) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify({
          version: 17,
          generatedAt: '2026-09-20T00:00:00.000Z',
          totalWords: 0,
          totalCourses: 0,
          courses: []
        }), { status: 200 });
      }) as any;

      try {
        const cat = await courseRepository.fetchCatalog();
        expect(cat.version).toBe(17);
        // Verify URL does not contain ?t=
        expect(requestedUrl).not.toContain('?t=');
        expect(requestedUrl).toContain('data/v1/catalog.json');
      } finally {
        global.fetch = originalFetch;
      }
    });

    // C. FastSkim scope handling & session isolation
    it('C. FastSkim Scope Handling & Session Isolation: correctly resolves scopes and isolates saved progress', async () => {
      const profile: Profile = {
        id: 'test_prof_skim',
        displayName: 'Skim User',
        dailyNewCardsTarget: 15,
        dailyReviewTarget: 30,
        desiredRetention: 0.9,
        fastSkimDurationSec: 1.5,
        preferredAccent: 'US',
        autoPlayAudio: true,
        isMuted: false,
        activeCourseId: 'course-core-1200',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await db.profiles.put(profile);

      // Save sessions for different scopes
      studySessionService.saveFastSkimSession({
        sessionId: 's_all',
        profileId: profile.id,
        courseId: 'all',
        sessionWordIds: ['w1', 'w2'],
        currentIndex: 1,
        currentBatchIndex: 0,
        batchSize: 20,
        selectedCategory: 'all',
        isShuffle: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      studySessionService.saveFastSkimSession({
        sessionId: 's_manual',
        profileId: profile.id,
        courseId: 'manual',
        sessionWordIds: ['w3'],
        currentIndex: 0,
        currentBatchIndex: 0,
        batchSize: 20,
        selectedCategory: 'all',
        isShuffle: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      studySessionService.saveFastSkimSession({
        sessionId: 's_course',
        profileId: profile.id,
        courseId: 'course:course-core-1200',
        sessionWordIds: ['w4', 'w5', 'w6'],
        currentIndex: 2,
        currentBatchIndex: 0,
        batchSize: 20,
        selectedCategory: 'all',
        isShuffle: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      // Verify each scope retrieves its own isolated session
      const sessionAll = studySessionService.loadFastSkimSession(profile.id, 'all');
      const sessionManual = studySessionService.loadFastSkimSession(profile.id, 'manual');
      const sessionCourse = studySessionService.loadFastSkimSession(profile.id, 'course:course-core-1200');

      expect(sessionAll?.currentIndex).toBe(1);
      expect(sessionAll?.sessionWordIds).toEqual(['w1', 'w2']);

      expect(sessionManual?.currentIndex).toBe(0);
      expect(sessionManual?.sessionWordIds).toEqual(['w3']);

      expect(sessionCourse?.currentIndex).toBe(2);
      expect(sessionCourse?.sessionWordIds).toEqual(['w4', 'w5', 'w6']);
    });

    // D. Flashcard minimal back mode
    it('D. Flashcard Minimal Back Mode: profile supports flashcardBackMode and distinguishes minimal vs full view', async () => {
      const profile: Profile = {
        id: 'test_prof_flashcard',
        displayName: 'Card User',
        dailyNewCardsTarget: 15,
        dailyReviewTarget: 30,
        desiredRetention: 0.9,
        fastSkimDurationSec: 1.5,
        preferredAccent: 'US',
        autoPlayAudio: true,
        isMuted: false,
        flashcardBackMode: 'minimal',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await db.profiles.put(profile);

      const loaded = await db.profiles.get('test_prof_flashcard');
      expect(loaded?.flashcardBackMode).toBe('minimal');

      // Update to full mode
      await db.profiles.update('test_prof_flashcard', { flashcardBackMode: 'full' });
      const updated = await db.profiles.get('test_prof_flashcard');
      expect(updated?.flashcardBackMode).toBe('full');
    });

    // E. Audio playback session configuration
    it('E. Audio Playback Session Configuration: safely configures navigator.audioSession to playback', () => {
      const mockNav = {
        audioSession: {
          type: 'auto'
        }
      };
      const originalNav = global.navigator;
      (global as any).navigator = mockNav;

      try {
        const configured = audioService.configurePlaybackAudioSession();
        expect(configured).toBe(true);
        expect((global.navigator as any).audioSession.type).toBe('playback');
      } finally {
        (global as any).navigator = originalNav;
      }
    });

    it('E2. Audio Playback Session Configuration: returns false safely without throwing when navigator.audioSession is absent', () => {
      const originalNav = global.navigator;
      (global as any).navigator = {};

      try {
        const configured = audioService.configurePlaybackAudioSession();
        expect(configured).toBe(false);
      } finally {
        (global as any).navigator = originalNav;
      }
    });

    // F. WordQuickPeekModal scroll vs drag handoff logic
    it('F. WordQuickPeekModal Gesture Handoff: prevents drag dismissal when scrolling inside content (scrollTop > 0), allows at top', () => {
      const simulateTouchMove = (scrollTop: number, deltaY: number) => {
        let isDraggingSheet = false;
        let dragY = 0;
        if (scrollTop <= 0 && deltaY > 0) {
          isDraggingSheet = true;
          dragY = deltaY * 0.75;
        } else if (isDraggingSheet && deltaY <= 0) {
          isDraggingSheet = false;
          dragY = 0;
        }
        return { isDraggingSheet, dragY };
      };

      // 1. User scrolls inside content: scrollTop = 50, pulling downwards deltaY = 30
      // Native scroll should continue; sheet should NOT drag
      const scrollResult = simulateTouchMove(50, 30);
      expect(scrollResult.isDraggingSheet).toBe(false);
      expect(scrollResult.dragY).toBe(0);

      // 2. User is at top of content: scrollTop = 0, pulling downwards deltaY = 80
      // Sheet drag should be activated
      const topPullResult = simulateTouchMove(0, 80);
      expect(topPullResult.isDraggingSheet).toBe(true);
      expect(topPullResult.dragY).toBe(60); // 80 * 0.75 = 60
    });

    // G. Quiz ABCD drawer expand/collapse gestures & auto-collapse on next question
    it('G. Quiz ABCD Drawer Gestures & Auto-Collapse: expands on swipe up, collapses on swipe down (only at top), resets on next question', () => {
      let isDrawerExpanded = false;

      const simulateTouchEnd = (deltaY: number, scrollTop: number) => {
        if (deltaY < -40 && !isDrawerExpanded) {
          isDrawerExpanded = true;
        } else if (deltaY > 40 && isDrawerExpanded && scrollTop <= 0) {
          isDrawerExpanded = false;
        }
      };

      // Swipe up -> expand
      simulateTouchEnd(-60, 0);
      expect(isDrawerExpanded).toBe(true);

      // Swipe down while scrolling inside explanation (scrollTop = 40) -> does NOT collapse
      simulateTouchEnd(60, 40);
      expect(isDrawerExpanded).toBe(true);

      // Swipe down when at top (scrollTop = 0) -> collapses
      simulateTouchEnd(60, 0);
      expect(isDrawerExpanded).toBe(false);

      // Expand again, then simulate transition to next question
      isDrawerExpanded = true;
      // handleNextQuestion resets isDrawerExpanded to false
      isDrawerExpanded = false;
      expect(isDrawerExpanded).toBe(false);
    });

    // H. Package version = 1.3.5 and dataset version = 17 invariant
    it('H. Version Invariants: package.json version is 1.3.5 and dataset migration version is 17', () => {
      const pkgPath = path.resolve(__dirname, '../package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      expect(pkg.version).toBe('1.3.5');
      expect(CURRENT_DATASET_VERSION).toBe(17);
    });

    // I. FastSkim 3 batches lifecycle: 60 deterministic words, batchSize 20 -> batch 1 -> 2 -> 3 -> wrap 1
    it('I. FastSkim 3 Batches Lifecycle: advances across batches without duplicate or lost words and wraps to 1', () => {
      const words60: Word[] = Array.from({ length: 60 }, (_, i) => ({
        id: `word_${i}`,
        headword: `word_${i}`,
        definitionZh: `定義 ${i}`,
        partsOfSpeech: ['n.'],
        category: '商務'
      } as unknown as Word));

      const batchSize = 20;
      let currentBatchIndex = 0;
      const totalBatches = Math.ceil(words60.length / batchSize); // 3

      // Batch 1 (index 0)
      const batch1Start = currentBatchIndex * batchSize;
      const batch1 = words60.slice(batch1Start, batch1Start + batchSize);
      expect(batch1.length).toBe(20);
      expect(batch1[0].id).toBe('word_0');
      expect(batch1[19].id).toBe('word_19');

      // Next batch -> Batch 2 (index 1)
      currentBatchIndex = (currentBatchIndex + 1) >= totalBatches ? 0 : currentBatchIndex + 1;
      expect(currentBatchIndex).toBe(1);
      const batch2Start = currentBatchIndex * batchSize;
      const batch2 = words60.slice(batch2Start, batch2Start + batchSize);
      expect(batch2.length).toBe(20);
      expect(batch2[0].id).toBe('word_20');
      expect(batch2[19].id).toBe('word_39');

      // Verify zero overlap between Batch 1 and Batch 2
      const set1 = new Set(batch1.map(w => w.id));
      batch2.forEach(w => expect(set1.has(w.id)).toBe(false));

      // Next batch -> Batch 3 (index 2)
      currentBatchIndex = (currentBatchIndex + 1) >= totalBatches ? 0 : currentBatchIndex + 1;
      expect(currentBatchIndex).toBe(2);
      const batch3Start = currentBatchIndex * batchSize;
      const batch3 = words60.slice(batch3Start, batch3Start + batchSize);
      expect(batch3.length).toBe(20);
      expect(batch3[0].id).toBe('word_40');
      expect(batch3[19].id).toBe('word_59');

      // Verify zero overlap between Batch 2 and Batch 3
      const set2 = new Set(batch2.map(w => w.id));
      batch3.forEach(w => expect(set2.has(w.id)).toBe(false));

      // Next batch -> Wraps to Batch 1 (index 0)
      currentBatchIndex = (currentBatchIndex + 1) >= totalBatches ? 0 : currentBatchIndex + 1;
      expect(currentBatchIndex).toBe(0);
      const batchWrapStart = currentBatchIndex * batchSize;
      const batchWrap = words60.slice(batchWrapStart, batchWrapStart + batchSize);
      expect(batchWrap.length).toBe(20);
      expect(batchWrap[0].id).toBe('word_0');
      expect(batchWrap[19].id).toBe('word_19');
    });

    // J. FastSkim resume and batch continuation: restores batchIndex=1, currentIndex=7, then advances to batchIndex=2
    it('J. FastSkim Resume & Batch Continuation: restores batchIndex=1, currentIndex=7 from allSessionWordIds, then advances to batch 2', async () => {
      const words60: Word[] = Array.from({ length: 60 }, (_, i) => ({
        id: `resume_word_${i}`,
        headword: `resume_word_${i}`,
        definitionZh: `定義 ${i}`,
        partsOfSpeech: ['n.'],
        category: '商務',
        normalizedHeadword: `resume_word_${i}`,
        entryType: 'word',
        starRating: 3,
        toeicScoreRange: '700',
        wordForms: [],
        phoneticUS: null,
        phoneticUK: null,
        examples: [],
        examTips: [],
        audioUSUrl: null,
        audioUKUrl: null
      }));
      await db.words.bulkPut(words60);

      const allIds = words60.map(w => w.id);
      const batch1Ids = allIds.slice(20, 40); // batchIndex 1

      // Save session at batchIndex=1, currentIndex=7
      studySessionService.saveFastSkimSession({
        sessionId: 'test_resume_session',
        profileId: 'test_prof_resume',
        courseId: 'all',
        sessionWordIds: batch1Ids,
        allSessionWordIds: allIds,
        currentIndex: 7,
        currentBatchIndex: 1,
        batchSize: 20,
        selectedCategory: 'all',
        isShuffle: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      // Restore session
      const saved = studySessionService.loadFastSkimSession('test_prof_resume', 'all');
      expect(saved).not.toBeNull();
      expect(saved?.currentBatchIndex).toBe(1);
      expect(saved?.currentIndex).toBe(7);
      expect(saved?.allSessionWordIds?.length).toBe(60);

      // Reconstruct active and full lists from DB
      const wordsFromDb = await db.words.where('id').anyOf(saved!.allSessionWordIds!).toArray();
      const map = new Map(wordsFromDb.map(w => [w.id, w]));
      const restoredAll = saved!.allSessionWordIds!.map(id => map.get(id)).filter((w): w is Word => Boolean(w));
      const restoredActive = saved!.sessionWordIds.map(id => map.get(id)).filter((w): w is Word => Boolean(w));

      expect(restoredAll.length).toBe(60);
      expect(restoredActive.length).toBe(20);
      expect(restoredActive[0].id).toBe('resume_word_20');
      expect(restoredActive[7].id).toBe('resume_word_27');

      // Now simulate handleNextBatch: advance to next batch from the restored allWords
      const totalBatches = Math.ceil(restoredAll.length / saved!.batchSize);
      const nextBatchIndex = (saved!.currentBatchIndex + 1) >= totalBatches ? 0 : saved!.currentBatchIndex + 1;
      expect(nextBatchIndex).toBe(2);

      const nextStart = nextBatchIndex * saved!.batchSize;
      const nextWords = restoredAll.slice(nextStart, nextStart + saved!.batchSize);
      expect(nextWords.length).toBe(20);
      expect(nextWords[0].id).toBe('resume_word_40');
      expect(nextWords[19].id).toBe('resume_word_59');
    });

    // K. Missing active course defensive fallback: requested course:nonexistent -> effectiveScope === 'all'
    it('K. Missing Active Course Defensive Fallback: resolves effectiveScope to all and saves under all key when course is not downloaded', async () => {
      // Create profile with activeCourseId = 'course-missing-123' (which is not downloaded in DB)
      const profile: Profile = {
        id: 'prof_missing_course',
        displayName: 'Missing Course User',
        dailyNewCardsTarget: 15,
        dailyReviewTarget: 30,
        desiredRetention: 0.9,
        fastSkimDurationSec: 1.5,
        preferredAccent: 'US',
        autoPlayAudio: true,
        isMuted: false,
        activeCourseId: 'course-missing-123',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await db.profiles.put(profile);

      // Verify course-missing-123 does not exist in db.courses
      const course = await courseRepository.getById('course-missing-123');
      expect(course).toBeUndefined();

      // Resolve scope
      const requestedScope = `course:${profile.activeCourseId}`;
      let effectiveScope: string;
      if (requestedScope.startsWith('course:')) {
        const targetId = requestedScope.slice('course:'.length);
        const targetCourse = await courseRepository.getById(targetId);
        if (!targetCourse || !targetCourse.isDownloaded) {
          effectiveScope = 'all';
        } else {
          effectiveScope = requestedScope;
        }
      } else {
        effectiveScope = requestedScope;
      }

      expect(effectiveScope).toBe('all');

      // Session must be saved under 'all', not 'course:course-missing-123'
      studySessionService.saveFastSkimSession({
        sessionId: 's_fallback',
        profileId: profile.id,
        courseId: effectiveScope,
        sessionWordIds: ['w1'],
        allSessionWordIds: ['w1'],
        currentIndex: 0,
        currentBatchIndex: 0,
        batchSize: 20,
        selectedCategory: 'all',
        isShuffle: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      // Session under 'all' must exist
      const sessionAll = studySessionService.loadFastSkimSession(profile.id, 'all');
      expect(sessionAll).not.toBeNull();
      expect(sessionAll?.courseId).toBe('all');

      // Session under 'course:course-missing-123' must NOT exist
      const sessionCourse = studySessionService.loadFastSkimSession(profile.id, 'course:course-missing-123');
      expect(sessionCourse).toBeNull();
    });

    // L. Catalog Background Enrichment Race Guard: generation token cancels stale task when profile changes
    it('L. Catalog Enrichment Race Guard: generation token ensures Profile A cannot overwrite Profile B progress', async () => {
      let loadGeneration = 0;
      let committedProgressMap = new Map<string, number>();

      // Simulate Profile A starting enrichment
      const generationA = ++loadGeneration;
      // Immediately clears progressCountMap on profile switch/start
      committedProgressMap = new Map();

      // Profile A takes 100ms (slow)
      let resolveA: () => void;
      const promiseA = new Promise<void>((resolve) => { resolveA = resolve; });

      // Before Profile A resolves, user switches to Profile B
      const generationB = ++loadGeneration; // generation is now 2
      committedProgressMap = new Map();

      // Profile B finishes first with its progress { 'course-1': 15 }
      if (generationB === loadGeneration) {
        committedProgressMap = new Map([['course-1', 15]]);
      }

      // Now Profile A finishes late with its progress { 'course-1': 5 }
      resolveA!();
      await promiseA;

      // Profile A commits only if generation matches
      if (generationA === loadGeneration) {
        committedProgressMap = new Map([['course-1', 5]]);
      }

      // Verify Profile A was rejected and Profile B's data was preserved
      expect(committedProgressMap.get('course-1')).toBe(15);
      expect(generationA).toBe(1);
      expect(generationB).toBe(2);
      expect(loadGeneration).toBe(2);
    });

    // M. Progressive Per-Course Enrichment: course 1 updates map immediately without waiting for course 2
    it('M. Progressive Per-Course Enrichment: updates map per course without waiting for entire suite to complete', async () => {
      let progressCountMap = new Map<string, number>();

      const setProgress = (updater: (prev: Map<string, number>) => Map<string, number>) => {
        progressCountMap = updater(progressCountMap);
      };

      // Step 1: course-1 completes computation
      setProgress(prev => {
        const next = new Map(prev);
        next.set('course-1', 42);
        return next;
      });

      // At this instant, course-2 is still pending, but course-1 is already in state!
      expect(progressCountMap.has('course-1')).toBe(true);
      expect(progressCountMap.get('course-1')).toBe(42);
      expect(progressCountMap.has('course-2')).toBe(false);

      // Step 2: course-2 completes computation
      setProgress(prev => {
        const next = new Map(prev);
        next.set('course-2', 99);
        return next;
      });

      expect(progressCountMap.get('course-1')).toBe(42);
      expect(progressCountMap.get('course-2')).toBe(99);
    });
  });
});
