import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db';
import { profileRepository } from '../src/repositories/profileRepository';
import { progressRepository } from '../src/repositories/progressRepository';
import { backupService } from '../src/services/backupService';
import { Word } from '../src/types/db';

describe('Dexie Database & Repositories Tests', () => {
  beforeEach(async () => {
    await db.profiles.clear();
    await db.courses.clear();
    await db.words.clear();
    await db.quizzes.clear();
    await db.courseWords.clear();
    await db.progress.clear();
    await db.reviewLogs.clear();
    await db.dailyStats.clear();
    await db.syncQueue.clear();
    await db.appSettings.clear();
  });

  it('isolates learning progress across multiple local student profiles', async () => {
    const student1 = await profileRepository.create({ displayName: '學生 A' });
    const student2 = await profileRepository.create({ displayName: '學生 B' });

    const word: Word = {
      id: 'tw_w_demo01',
      headword: 'accommodate',
      normalizedHeadword: 'accommodate',
      entryType: 'word',
      definitionZh: '容納；配合',
      starRating: 4,
      toeicScoreRange: '600-780',
      category: '商務差旅',
      partsOfSpeech: ['verb'],
      wordForms: [],
      phoneticUS: null,
      phoneticUK: null,
      examples: [],
      examTips: [],
      audioUSUrl: null,
      audioUKUrl: null
    };
    await db.words.put(word);

    // Student 1 reviews with Good (3)
    await progressRepository.recordReviewTransaction({
      profileId: student1.id,
      wordId: word.id,
      rating: 3,
      durationMs: 3000
    });

    const prog1 = await progressRepository.getByWordId(student1.id, word.id);
    const prog2 = await progressRepository.getByWordId(student2.id, word.id);

    expect(prog1).toBeDefined();
    expect(prog1?.reps).toBe(1);
    expect(prog2).toBeUndefined(); // Student 2 has no progress for this word
  });

  it('atomically executes review transaction (progress + reviewLog + dailyStats)', async () => {
    const student = await profileRepository.create({ displayName: 'Alex' });
    const wordId = 'tw_w_demo02';

    const { updatedProgress, reviewLog } = await progressRepository.recordReviewTransaction({
      profileId: student.id,
      wordId,
      rating: 4, // Easy
      durationMs: 2500
    });

    expect(updatedProgress.wordId).toBe(wordId);
    expect(reviewLog.rating).toBe(4);

    const savedProg = await db.progress.where('profileId').equals(student.id).first();
    const savedLog = await db.reviewLogs.where('profileId').equals(student.id).first();
    const savedStat = await db.dailyStats.where('profileId').equals(student.id).first();

    expect(savedProg).toBeDefined();
    expect(savedLog).toBeDefined();
    expect(savedStat).toBeDefined();
    expect(savedStat?.cardsReviewed).toBe(1);
    expect(savedStat?.easyCount).toBe(1);
  });

  it('exports and merges backup data correctly', async () => {
    const student = await profileRepository.create({ displayName: 'Emma' });
    await progressRepository.recordReviewTransaction({
      profileId: student.id,
      wordId: 'tw_w_demo03',
      rating: 3,
      durationMs: 2000
    });

    const backup = await backupService.generateBackup(student.id);
    expect(backup.profile.displayName).toBe('Emma');
    expect(backup.progress).toHaveLength(1);
    expect(backup.reviewLogs).toHaveLength(1);

    // Create a new target student and import backup
    const newStudent = await profileRepository.create({ displayName: 'Emma New Device' });
    await backupService.importBackup(newStudent.id, backup, 'merge');

    const importedProgress = await progressRepository.getAllForProfile(newStudent.id);
    expect(importedProgress).toHaveLength(1);
    expect(importedProgress[0].wordId).toBe('tw_w_demo03');
  });

  it('supports Dexie Version 2 schema with quizzes and word frequencyTier', async () => {
    const word: Word = {
      id: 'tw_w_v2_test',
      headword: 'negotiate',
      normalizedHeadword: 'negotiate',
      entryType: 'word',
      definitionZh: '協商；談判',
      starRating: 5,
      toeicScoreRange: '600-780',
      category: '商業談判',
      partsOfSpeech: ['verb'],
      wordForms: [],
      phoneticUS: 'nɪˈɡoʊʃieɪt',
      phoneticUK: null,
      imageUrl: 'https://images.unsplash.com/photo-1542744173-8e7e53415bb0',
      frequencyTier: 'core_1200',
      examples: [
        {
          id: 'ex_1',
          en: 'We need to negotiate the terms of the contract.',
          zh: '我們需要針對合約條款進行協商。',
          scenario: '合約法律'
        }
      ],
      examTips: [],
      audioUSUrl: null,
      audioUKUrl: null
    };

    await db.words.put(word);
    const savedWord = await db.words.where('frequencyTier').equals('core_1200').first();
    expect(savedWord).toBeDefined();
    expect(savedWord?.imageUrl).toContain('unsplash');
    expect(savedWord?.examples[0].en).toBe('We need to negotiate the terms of the contract.');

    // Save 6 Quizzes Matrix
    await db.quizzes.bulkPut([
      {
        id: 'q_test_mcq_1',
        wordId: word.id,
        type: 'multiple_choice',
        subType: 'vocab_choice',
        stem: 'Both parties agreed to _____ the contract terms.',
        options: ['negotiate', 'cancel', 'dismiss', 'violate'],
        answer: 'negotiate',
        explanation: '本題考查商務情境單字搭配。',
        frequencyTier: 'core_1200'
      },
      {
        id: 'q_test_cloze_1',
        wordId: word.id,
        type: 'cloze_fill',
        subType: 'collocation_cloze',
        stem: 'The delegates will _____ the bilateral agreement next week.',
        options: ['negotiate', 'refuse', 'ignore', 'delay'],
        answer: 'negotiate',
        clozeHint: '提示：協商 (v.)',
        explanation: '克漏字填空解析。',
        frequencyTier: 'core_1200'
      }
    ]);

    const wordQuizzes = await db.quizzes.where('wordId').equals(word.id).toArray();
    expect(wordQuizzes).toHaveLength(2);

    const mcqQuizzes = await db.quizzes.where('type').equals('multiple_choice').toArray();
    expect(mcqQuizzes).toHaveLength(1);
    expect(mcqQuizzes[0].subType).toBe('vocab_choice');
  });
});

