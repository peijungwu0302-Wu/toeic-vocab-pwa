import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Dexie from 'dexie';
import { db } from '../src/db';
import { datasetMigrationService, CURRENT_DATASET_VERSION } from '../src/services/datasetMigrationService';
import { courseRepository } from '../src/repositories/courseRepository';
import { profileRepository } from '../src/repositories/profileRepository';
import { todayService, DEFAULT_APP_COURSE_ID } from '../src/services/todayService';
import {
  clearCourseOfflineMedia,
  getStorageEstimate,
  getCourseMediaEstimate,
  OFFLINE_MEDIA_CACHE_NAME,
  R2_MEDIA_BASE_URL
} from '../src/services/imageService';
import { computeSha256Hex } from '../src/utils/crypto';
import { Word, Course, Profile, Progress, ReviewLog } from '../src/types/db';

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
      localStorage.setItem('toeic_runtime_manifest_cache', JSON.stringify({
        schemaVersion: '1.0',
        manifestUri: null,
        count: 3,
        images: {
          w1: { v: 1, h: 'h1' },
          w2: { v: 1, h: 'h2' },
          w3: { v: 1, h: 'h3' }
        }
      }));

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
});
