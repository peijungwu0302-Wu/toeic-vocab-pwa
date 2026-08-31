import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db';
import { profileRepository } from '../src/repositories/profileRepository';
import { progressRepository } from '../src/repositories/progressRepository';
import { statsRepository } from '../src/repositories/statsRepository';
import { backupService } from '../src/services/backupService';
import { teacherReportService } from '../src/services/teacherReportService';
import { Word, Course } from '../src/types/db';

describe('End-to-End Learning Flow Integration Test', () => {
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

  it('runs complete flow: onboarding -> course download -> review card -> check stats -> export backup -> teacher report', async () => {
    // 1. Create student profile (Onboarding)
    const student = await profileRepository.create({
      displayName: '小明',
      dailyNewCardsTarget: 15
    });
    expect(student.id).toBeTruthy();
    expect(student.displayName).toBe('小明');

    // 2. Simulate course download
    const course: Course = {
      id: 'course-foundation-550',
      title: '基礎奠定核心單字 (TOEIC 400-600)',
      description: '多益入門必備單字',
      toeicScoreRange: '400-600',
      category: '綜合商務',
      level: '基礎',
      wordCount: 2,
      version: 1,
      isDownloaded: true,
      downloadedAt: new Date().toISOString()
    };
    await db.courses.put(course);

    const words: Word[] = [
      {
        id: 'tw_w_int_01',
        headword: 'schedule',
        normalizedHeadword: 'schedule',
        entryType: 'word',
        definitionZh: '預定；行程表',
        starRating: 5,
        toeicScoreRange: '400-600',
        category: '辦公日常',
        partsOfSpeech: ['verb', 'noun'],
        wordForms: [],
        phoneticUS: 'ˈskedʒuːl',
        phoneticUK: 'ˈʃedjuːl',
        examples: [{ id: 'ex1', english: 'The flight is scheduled to depart at 9 AM.', chinese: '班機預定早上九點起飛。' }],
        examTips: ['常用搭配 on schedule (準時)'],
        audioUSUrl: null,
        audioUKUrl: null
      },
      {
        id: 'tw_w_int_02',
        headword: 'contract',
        normalizedHeadword: 'contract',
        entryType: 'word',
        definitionZh: '合約；簽約',
        starRating: 5,
        toeicScoreRange: '400-600',
        category: '商務合約',
        partsOfSpeech: ['noun', 'verb'],
        wordForms: [],
        phoneticUS: 'ˈkɑːntrækt',
        phoneticUK: 'ˈkɒntrækt',
        examples: [{ id: 'ex2', english: 'They signed a five-year contract.', chinese: '他們簽署了一份為期五年的合約。' }],
        examTips: ['常見動詞搭配 sign / terminate a contract'],
        audioUSUrl: null,
        audioUKUrl: null
      }
    ];
    await db.words.bulkPut(words);
    await db.courseWords.bulkAdd([
      { courseId: course.id, wordId: words[0].id, orderIndex: 0 },
      { courseId: course.id, wordId: words[1].id, orderIndex: 1 }
    ]);

    // 3. Review first word with Good (3)
    const reviewResult1 = await progressRepository.recordReviewTransaction({
      profileId: student.id,
      wordId: words[0].id,
      rating: 3, // Good
      durationMs: 4000
    });
    expect(reviewResult1.updatedProgress.reps).toBe(1);

    // 4. Review second word with Again (1)
    const reviewResult2 = await progressRepository.recordReviewTransaction({
      profileId: student.id,
      wordId: words[1].id,
      rating: 1, // Again
      durationMs: 5000
    });
    expect(reviewResult2.updatedProgress.reps).toBe(1);

    // 5. Verify stats & streak
    const stats = await statsRepository.getDailyStats(student.id, 7);
    expect(stats).toHaveLength(1);
    expect(stats[0].cardsReviewed).toBe(2);
    expect(stats[0].newCardsLearned).toBe(2);
    expect(stats[0].againCount).toBe(1);
    expect(stats[0].goodCount).toBe(1);

    const streak = await statsRepository.getStreakDays(student.id);
    expect(streak).toBe(1);

    const weakWords = await statsRepository.getMostForgottenWords(student.id, 10);
    expect(weakWords).toHaveLength(1);
    expect(weakWords[0].headword).toBe('contract');

    // 6. Generate teacher report
    const teacherReport = await teacherReportService.generateSummary(student.id, 7);
    expect(teacherReport.studentName).toBe('小明');
    expect(teacherReport.totalReviews).toBe(2);
    expect(teacherReport.weakestWords).toHaveLength(1);

    const formattedMessage = teacherReportService.formatAsTextMessage(teacherReport);
    expect(formattedMessage).toContain('小明');
    expect(formattedMessage).toContain('contract');

    // 7. Generate JSON Backup
    const backup = await backupService.generateBackup(student.id);
    expect(backup.schemaVersion).toBe(1);
    expect(backup.progress).toHaveLength(2);
    expect(backup.reviewLogs).toHaveLength(2);
  });
});
