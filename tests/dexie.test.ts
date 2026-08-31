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
});
