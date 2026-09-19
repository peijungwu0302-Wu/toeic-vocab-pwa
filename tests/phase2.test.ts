import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../src/db';
import { searchService } from '../src/services/searchService';
import { manualQueueService } from '../src/services/manualQueueService';
import { quizService } from '../src/services/quizService';
import { Word } from '../src/types/db';

describe('Phase 2: Search, Manual Practice Queue, Navigation & Sync Honesty', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    searchService.invalidateIndex();
    await db.words.clear();
    await db.progress.clear();
    await db.reviewLogs.clear();
    await db.manualQueue.clear();
  });

  describe('A. Search Index & Query Engine', () => {
    it('builds lightweight index and performs ranked matching (exact > prefix > contains > definition)', async () => {
      // Seed test words
      const sampleWords: Word[] = [
        {
          id: 'w_propose',
          headword: 'propose',
          normalizedHeadword: 'propose',
          entryType: 'word',
          definitionZh: '提議；建議',
          starRating: 3,
          toeicScoreRange: '600-750',
          category: '商務溝通',
          partsOfSpeech: ['v'],
          wordForms: [],
          phoneticUS: 'prəˈpoʊz',
          phoneticUK: null,
          examples: [],
          examTips: [],
          audioUSUrl: null,
          audioUKUrl: null
        },
        {
          id: 'w_proposes',
          headword: 'proposes',
          normalizedHeadword: 'proposes',
          entryType: 'word',
          definitionZh: '提議（第三人稱單數）',
          starRating: 3,
          toeicScoreRange: '600-750',
          category: '商務溝通',
          partsOfSpeech: ['v'],
          wordForms: [],
          phoneticUS: 'prəˈpoʊzɪz',
          phoneticUK: null,
          examples: [],
          examTips: [],
          audioUSUrl: null,
          audioUKUrl: null
        },
        {
          id: 'w_repropose',
          headword: 'repropose',
          normalizedHeadword: 'repropose',
          entryType: 'word',
          definitionZh: '重新提議',
          starRating: 4,
          toeicScoreRange: '750-900',
          category: '商務談判',
          partsOfSpeech: ['v'],
          wordForms: [],
          phoneticUS: 'ˌriːprəˈpoʊz',
          phoneticUK: null,
          examples: [],
          examTips: [],
          audioUSUrl: null,
          audioUKUrl: null
        },
        {
          id: 'w_suggest',
          headword: 'suggest',
          normalizedHeadword: 'suggest',
          entryType: 'word',
          definitionZh: '提議 (同義於 propose)',
          starRating: 3,
          toeicScoreRange: '500-650',
          category: '日常商務',
          partsOfSpeech: ['v'],
          wordForms: [],
          phoneticUS: 'səɡˈdʒest',
          phoneticUK: null,
          examples: [],
          examTips: [],
          audioUSUrl: null,
          audioUKUrl: null
        }
      ];

      await db.words.bulkPut(sampleWords);

      // Search for "propose"
      const results = await searchService.search('propose');
      expect(results.length).toBe(4);

      // Rank 1: exact match ("propose")
      expect(results[0].headword).toBe('propose');
      // Rank 2: prefix match ("proposes")
      expect(results[1].headword).toBe('proposes');
      // Rank 3: contains match ("repropose")
      expect(results[2].headword).toBe('repropose');
      // Rank 4: definition match ("suggest")
      expect(results[3].headword).toBe('suggest');
    });

    it('respects AbortSignal cancellation and returns empty without error', async () => {
      await db.words.put({
        id: 'w_1',
        headword: 'contract',
        normalizedHeadword: 'contract',
        entryType: 'word',
        definitionZh: '合約',
        starRating: 3,
        toeicScoreRange: '600-750',
        category: '商務契約',
        partsOfSpeech: ['n'],
        wordForms: [],
        phoneticUS: null,
        phoneticUK: null,
        examples: [],
        examTips: [],
        audioUSUrl: null,
        audioUKUrl: null
      });

      const controller = new AbortController();
      controller.abort(); // immediately abort
      const results = await searchService.search('contract', { signal: controller.signal });
      expect(results).toEqual([]);
    });

    it('retrieves full word correctly from IndexedDB', async () => {
      const fullWord: Word = {
        id: 'w_full_test',
        headword: 'dividend',
        normalizedHeadword: 'dividend',
        entryType: 'word',
        definitionZh: '紅利；股息',
        starRating: 4,
        toeicScoreRange: '750-900',
        category: '金融財務',
        partsOfSpeech: ['n'],
        wordForms: [],
        phoneticUS: 'ˈdɪvɪdend',
        phoneticUK: null,
        examples: [{
          en: 'The board approved a quarterly dividend payment.',
          zh: '董事會批准了季度股息發放。',
          scenario: '股東會議'
        }],
        examTips: ['高頻出現在投資報告情境'],
        audioUSUrl: null,
        audioUKUrl: null
      };
      await db.words.put(fullWord);

      const retrieved = await searchService.getFullWord('w_full_test');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.headword).toBe('dividend');
      expect(retrieved?.examples.length).toBe(1);
    });
  });

  describe('B. Manual Practice Queue & Non-mutating Invariant', () => {
    it('idempotently enqueues words and counts them accurately', async () => {
      const profileId = 'prof_alice';
      const added1 = await manualQueueService.enqueueWords(profileId, ['w_1', 'w_2'], 'search');
      expect(added1).toBe(2);

      // Enqueue duplicate w_1 and new w_3
      const added2 = await manualQueueService.enqueueWords(profileId, ['w_1', 'w_3'], 'search');
      expect(added2).toBe(1); // only w_3 was newly added

      const count = await manualQueueService.getQueueCount(profileId);
      expect(count).toBe(3);

      const inQueue1 = await manualQueueService.isInQueue(profileId, 'w_1');
      const inQueue4 = await manualQueueService.isInQueue(profileId, 'w_999');
      expect(inQueue1).toBe(true);
      expect(inQueue4).toBe(false);
    });

    it('STRICT INVARIANT: enqueuing does NOT create or mutate FSRS progress or review logs', async () => {
      const profileId = 'prof_fsrs_guard';
      const wordId = 'w_guard_word';

      // 1. Initial state: progress table and reviewLogs table are completely empty
      const initialProgress = await db.progress.where('profileId').equals(profileId).toArray();
      const initialLogs = await db.reviewLogs.where('profileId').equals(profileId).toArray();
      expect(initialProgress.length).toBe(0);
      expect(initialLogs.length).toBe(0);

      // 2. Enqueue into manual practice queue
      await manualQueueService.enqueueWords(profileId, [wordId], 'search');

      // 3. Verify manual queue has item
      const queueCount = await manualQueueService.getQueueCount(profileId);
      expect(queueCount).toBe(1);

      // 4. VERIFY: progress and reviewLogs are STILL completely untouched!
      const postProgress = await db.progress.where('profileId').equals(profileId).toArray();
      const postLogs = await db.reviewLogs.where('profileId').equals(profileId).toArray();
      expect(postProgress.length).toBe(0);
      expect(postLogs.length).toBe(0);
    });

    it('isolates manual queues between different student profiles', async () => {
      const profileA = 'student_a';
      const profileB = 'student_b';

      await manualQueueService.enqueueWords(profileA, ['w_a1', 'w_a2'], 'search');
      await manualQueueService.enqueueWords(profileB, ['w_b1'], 'quiz');

      const countA = await manualQueueService.getQueueCount(profileA);
      const countB = await manualQueueService.getQueueCount(profileB);

      expect(countA).toBe(2);
      expect(countB).toBe(1);

      const isAInB = await manualQueueService.isInQueue(profileB, 'w_a1');
      expect(isAInB).toBe(false);
    });

    it('dequeues and clears queue cleanly', async () => {
      const profileId = 'student_clear';
      await manualQueueService.enqueueWords(profileId, ['w_1', 'w_2', 'w_3'], 'search');

      await manualQueueService.dequeueWord(profileId, 'w_2');
      const countAfterDequeue = await manualQueueService.getQueueCount(profileId);
      expect(countAfterDequeue).toBe(2);
      expect(await manualQueueService.isInQueue(profileId, 'w_2')).toBe(false);

      await manualQueueService.clearQueue(profileId);
      expect(await manualQueueService.getQueueCount(profileId)).toBe(0);
    });
  });

  describe('C. Quiz Wrong Answers Redirection', () => {
    it('diverts quiz wrong answers into manual queue instead of fake FSRS ratings', async () => {
      const profileId = 'prof_quiz_student';
      const wrongWords: Word[] = [
        {
          id: 'w_wrong_1',
          headword: 'reconcile',
          normalizedHeadword: 'reconcile',
          entryType: 'word',
          definitionZh: '對帳；調和',
          starRating: 4,
          toeicScoreRange: '750-900',
          category: '財務會計',
          partsOfSpeech: ['v'],
          wordForms: [],
          phoneticUS: null,
          phoneticUK: null,
          examples: [],
          examTips: [],
          audioUSUrl: null,
          audioUKUrl: null
        },
        {
          id: 'w_wrong_2',
          headword: 'depreciation',
          normalizedHeadword: 'depreciation',
          entryType: 'word',
          definitionZh: '折舊；貶值',
          starRating: 4,
          toeicScoreRange: '750-900',
          category: '財務會計',
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

      // Call quizService.recordQuizWrongAnswers
      await quizService.recordQuizWrongAnswers(profileId, wrongWords);

      // Verify they are now in the manual queue
      const qCount = await manualQueueService.getQueueCount(profileId);
      expect(qCount).toBe(2);
      expect(await manualQueueService.isInQueue(profileId, 'w_wrong_1')).toBe(true);
      expect(await manualQueueService.isInQueue(profileId, 'w_wrong_2')).toBe(true);

      // Verify ZERO fake FSRS review logs were created!
      const logs = await db.reviewLogs.where('profileId').equals(profileId).toArray();
      expect(logs.length).toBe(0);

      // Verify progress records were NOT artificially altered with rating 1
      const progresses = await db.progress.where('profileId').equals(profileId).toArray();
      expect(progresses.length).toBe(0);
    });
  });
});
