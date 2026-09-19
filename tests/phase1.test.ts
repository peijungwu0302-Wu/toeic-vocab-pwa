import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../src/db';
import { datasetMigrationService, CURRENT_DATASET_VERSION } from '../src/services/datasetMigrationService';
import { courseRepository } from '../src/repositories/courseRepository';
import { studySessionService } from '../src/services/studySessionService';
import { progressRepository } from '../src/repositories/progressRepository';
import { computeSha256Hex } from '../src/utils/crypto';

describe('Phase 1: Data Integrity & Session Correctness', () => {
  beforeEach(async () => {
    localStorage.clear();
    await db.words.clear();
    await db.courses.clear();
    await db.courseWords.clear();
    await db.progress.clear();
    await db.appSettings.clear();
  });

  describe('A. Dataset Migration Atomicity & Resilience', () => {
    it('computes SHA-256 hex correctly', async () => {
      const sampleText = '{"test": "toeic-vocab-integrity"}';
      const hash = await computeSha256Hex(sampleText);
      expect(hash).toHaveLength(64);
      expect(typeof hash).toBe('string');
      // Consistency test
      const hash2 = await computeSha256Hex(sampleText);
      expect(hash).toBe(hash2);
    });

    it('rejects course download when SHA-256 checksum mismatches and preserves existing words', async () => {
      // 1. Seed existing valid word in DB
      await db.words.put({
        id: 'existing_word_1',
        headword: 'resilient',
        normalizedHeadword: 'resilient',
        entryType: 'word',
        definitionZh: '具彈性的',
        starRating: 3,
        toeicScoreRange: '750-860',
        category: '綜合商務',
        partsOfSpeech: ['adj'],
        wordForms: [],
        phoneticUS: null,
        phoneticUK: null,
        examples: [],
        examTips: [],
        audioUSUrl: null,
        audioUKUrl: null
      });

      const validPayload = JSON.stringify({
        id: 'course-test',
        title: 'Test Course',
        description: 'Test',
        toeicScoreRange: '400-990',
        category: '綜合商務',
        level: '基礎',
        wordCount: 1,
        version: 1,
        words: [{
          id: 'new_word_1',
          headword: 'integrity',
          normalizedHeadword: 'integrity',
          entryType: 'word',
          definitionZh: '正直；完整性',
          starRating: 4,
          toeicScoreRange: '750-860',
          category: '綜合商務',
          partsOfSpeech: ['n'],
          wordForms: [],
          phoneticUS: null,
          phoneticUK: null,
          examples: [],
          examTips: [],
          audioUSUrl: null,
          audioUKUrl: null
        }]
      });

      // Mock fetch returning valid JSON payload
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(validPayload),
        json: () => Promise.resolve(JSON.parse(validPayload))
      } as any);

      // Expect checksum failure when expected hash is wrong
      await expect(
        courseRepository.downloadAndSaveCourse('course-test', 'course-test.json', 'wrong_expected_sha256_hash')
      ).rejects.toThrow(/checksum verification failed/i);

      // Verify that existing word in DB was NOT cleared
      const count = await db.words.count();
      expect(count).toBe(1);
      const existing = await db.words.get('existing_word_1');
      expect(existing?.headword).toBe('resilient');
    });

    it('preserves existing dataset and does not bump version if any course fails during migration', async () => {
      // Seed existing local dataset at v16
      await db.appSettings.put({ key: 'dataset_version', value: '16' });
      await db.courses.put({
        id: 'course-core-1200',
        title: 'Core 1200',
        description: 'Old core',
        toeicScoreRange: '400-750',
        category: '高頻核心',
        level: '核心',
        wordCount: 1,
        version: 16,
        isDownloaded: true,
        downloadedAt: new Date().toISOString()
      });
      await db.words.put({
        id: 'word_core_old',
        headword: 'benchmark',
        normalizedHeadword: 'benchmark',
        entryType: 'word',
        definitionZh: '基準',
        starRating: 3,
        toeicScoreRange: '600-750',
        category: '高頻核心',
        partsOfSpeech: ['n'],
        wordForms: [],
        phoneticUS: null,
        phoneticUK: null,
        examples: [],
        examTips: [],
        audioUSUrl: null,
        audioUKUrl: null
      });

      // Mock catalog fetch returning core-1200
      vi.spyOn(courseRepository, 'fetchCatalog').mockResolvedValue({
        version: CURRENT_DATASET_VERSION,
        generatedAt: new Date().toISOString(),
        totalWords: 1000,
        totalCourses: 1,
        courses: [{
          id: 'course-core-1200',
          title: 'Core 1200',
          description: 'New core',
          toeicScoreRange: '400-750',
          category: '高頻核心',
          level: '核心',
          wordCount: 1,
          fileName: 'course-core-1200.json',
          checksum: 'fake',
          version: CURRENT_DATASET_VERSION
        }]
      });

      // Mock download failure
      vi.spyOn(courseRepository, 'downloadAndSaveCourse').mockRejectedValueOnce(new Error('Network error 500'));

      const result = await datasetMigrationService.autoMigrateIfOutdated();
      expect(result).toBe(false);

      // Verify dataset_version was NOT updated to current version
      const ver = await db.appSettings.get('dataset_version');
      expect(ver?.value).toBe('16');

      // Verify old words survived completely untouched
      const wordsCount = await db.words.count();
      expect(wordsCount).toBe(1);
      const oldWord = await db.words.get('word_core_old');
      expect(oldWord?.headword).toBe('benchmark');
    });

    it('successfully upgrades dataset and sets version when all courses download and validate', async () => {
      await db.appSettings.put({ key: 'dataset_version', value: '16' });

      vi.spyOn(courseRepository, 'fetchCatalog').mockResolvedValue({
        version: CURRENT_DATASET_VERSION,
        generatedAt: new Date().toISOString(),
        totalWords: 1,
        totalCourses: 1,
        courses: [{
          id: 'course-core-1200',
          title: 'Core 1200',
          description: 'Core course',
          toeicScoreRange: '400-750',
          category: '高頻核心',
          level: '核心',
          wordCount: 1,
          fileName: 'course-core-1200.json',
          checksum: '',
          version: CURRENT_DATASET_VERSION
        }]
      });

      const corePayload = JSON.stringify({
        id: 'course-core-1200',
        title: 'Core 1200',
        description: 'Core course',
        toeicScoreRange: '400-750',
        category: '高頻核心',
        level: '核心',
        wordCount: 1,
        version: CURRENT_DATASET_VERSION,
        words: [{
          id: 'w_migrated_1',
          headword: 'negotiate',
          normalizedHeadword: 'negotiate',
          entryType: 'word',
          definitionZh: '談判',
          starRating: 3,
          toeicScoreRange: '600-750',
          category: '高頻核心',
          partsOfSpeech: ['v'],
          wordForms: [],
          phoneticUS: null,
          phoneticUK: null,
          examples: [],
          examTips: [],
          audioUSUrl: null,
          audioUKUrl: null
        }]
      });

      global.fetch = vi.fn().mockImplementation((_url: string) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(corePayload),
          json: () => Promise.resolve(JSON.parse(corePayload))
        } as any);
      });

      const result = await datasetMigrationService.autoMigrateIfOutdated();
      expect(result).toBe(true);

      const ver = await db.appSettings.get('dataset_version');
      expect(ver?.value).toBe(String(CURRENT_DATASET_VERSION));
    });
  });

  describe('B. Exact Session Resume & Profile Isolation', () => {
    it('persists and restores exact Flashcard session with identical word order', async () => {
      const profileA = 'profile_alice_123';
      const exactWordIds = ['w_id_30', 'w_id_10', 'w_id_99', 'w_id_05'];

      studySessionService.saveFlashcardSession({
        sessionId: 'fs_session_test_1',
        profileId: profileA,
        courseId: 'course-core-1200',
        sessionWordIds: exactWordIds,
        currentIndex: 2,
        sessionConfig: {
          batchSize: 20,
          isShuffle: true,
          selectedCategory: 'all'
        },
        createdAt: Date.now() - 10000,
        updatedAt: Date.now() - 1000
      });

      const restored = studySessionService.loadFlashcardSession(profileA, 'course-core-1200');
      expect(restored).not.toBeNull();
      expect(restored?.sessionId).toBe('fs_session_test_1');
      expect(restored?.currentIndex).toBe(2);
      expect(restored?.sessionWordIds).toEqual(exactWordIds);
    });

    it('strictly isolates Flashcard sessions across Profile A and Profile B', async () => {
      const profileA = 'user_profile_A';
      const profileB = 'user_profile_B';

      studySessionService.saveFlashcardSession({
        sessionId: 'fs_session_A',
        profileId: profileA,
        courseId: 'all',
        sessionWordIds: ['w_A1', 'w_A2'],
        currentIndex: 1,
        sessionConfig: { batchSize: 20, isShuffle: false, selectedCategory: 'all' },
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      // Profile B attempting to load from the same courseId gets null
      const sessionB = studySessionService.loadFlashcardSession(profileB, 'all');
      expect(sessionB).toBeNull();

      // Profile A loads successfully
      const sessionA = studySessionService.loadFlashcardSession(profileA, 'all');
      expect(sessionA?.sessionId).toBe('fs_session_A');
    });

    it('strictly isolates FastSkim sessions and preserves exact sequence', async () => {
      const profileA = 'profile_alpha';
      const profileB = 'profile_beta';
      const sequence = ['w_skim_4', 'w_skim_2', 'w_skim_9'];

      studySessionService.saveFastSkimSession({
        sessionId: 'skim_sess_1',
        profileId: profileA,
        courseId: 'course-core-1200',
        sessionWordIds: sequence,
        currentIndex: 1,
        currentBatchIndex: 0,
        batchSize: 20,
        selectedCategory: 'all',
        isShuffle: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      // Profile B cannot see Profile A's fast skim progress
      expect(studySessionService.loadFastSkimSession(profileB, 'course-core-1200')).toBeNull();

      // Profile A restores exact sequence
      const restored = studySessionService.loadFastSkimSession(profileA, 'course-core-1200');
      expect(restored?.sessionWordIds).toEqual(sequence);
      expect(restored?.currentIndex).toBe(1);
    });

    it('progressRepository.getStudyItemsByWordIds preserves exact word ordering', async () => {
      const profileId = 'test_profile_order';

      // Insert unordered words into DB
      await db.words.bulkPut([
        { id: 'w_order_1', headword: 'first', normalizedHeadword: 'first', entryType: 'word', definitionZh: '第一', starRating: 3, toeicScoreRange: '400', category: '綜合商務', partsOfSpeech: ['adj'], wordForms: [], phoneticUS: null, phoneticUK: null, examples: [], examTips: [], audioUSUrl: null, audioUKUrl: null },
        { id: 'w_order_2', headword: 'second', normalizedHeadword: 'second', entryType: 'word', definitionZh: '第二', starRating: 3, toeicScoreRange: '400', category: '綜合商務', partsOfSpeech: ['adj'], wordForms: [], phoneticUS: null, phoneticUK: null, examples: [], examTips: [], audioUSUrl: null, audioUKUrl: null },
        { id: 'w_order_3', headword: 'third', normalizedHeadword: 'third', entryType: 'word', definitionZh: '第三', starRating: 3, toeicScoreRange: '400', category: '綜合商務', partsOfSpeech: ['adj'], wordForms: [], phoneticUS: null, phoneticUK: null, examples: [], examTips: [], audioUSUrl: null, audioUKUrl: null }
      ]);

      // Request in reverse shuffled order
      const requestedOrder = ['w_order_3', 'w_order_1', 'w_order_2'];
      const items = await progressRepository.getStudyItemsByWordIds(profileId, requestedOrder);

      expect(items.map(it => it.word.id)).toEqual(['w_order_3', 'w_order_1', 'w_order_2']);
      expect(items[0].word.headword).toBe('third');
      expect(items[1].word.headword).toBe('first');
      expect(items[2].word.headword).toBe('second');
    });

    it('expires study sessions older than 24 hours', () => {
      const profileId = 'user_expired_check';
      const expiredTime = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago

      studySessionService.saveFlashcardSession({
        sessionId: 'old_sess',
        profileId,
        courseId: 'all',
        sessionWordIds: ['w1', 'w2'],
        currentIndex: 1,
        sessionConfig: { batchSize: 20, isShuffle: false, selectedCategory: 'all' },
        createdAt: expiredTime,
        updatedAt: expiredTime
      });

      const restored = studySessionService.loadFlashcardSession(profileId, 'all');
      expect(restored).toBeNull();
    });
  });
});
