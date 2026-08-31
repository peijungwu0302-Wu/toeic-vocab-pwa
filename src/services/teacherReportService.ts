import { db } from '../db';
import { statsRepository } from '../repositories/statsRepository';

export interface TeacherShareSummary {
  studentName: string;
  generatedAt: string;
  dateRange: string;
  newCardsLearned: number;
  totalReviews: number;
  retentionRateText: string;
  againRateText: string;
  totalStudyMinutes: number;
  streakDays: number;
  weakestWords: Array<{ headword: string; againCount: number }>;
}

export const teacherReportService = {
  async generateSummary(profileId: string, days = 7): Promise<TeacherShareSummary> {
    const profile = await db.profiles.get(profileId);
    if (!profile) throw new Error('Profile not found');

    const stats = await statsRepository.getDailyStats(profileId, days);
    const streak = await statsRepository.getStreakDays(profileId);
    const weakestWords = await statsRepository.getMostForgottenWords(profileId, 15);

    let newCardsLearned = 0;
    let totalReviews = 0;
    let againCount = 0;
    let goodEasyCount = 0;
    let totalStudyTimeMs = 0;

    for (const s of stats) {
      newCardsLearned += s.newCardsLearned;
      totalReviews += s.cardsReviewed;
      againCount += s.againCount;
      goodEasyCount += (s.goodCount + s.easyCount);
      totalStudyTimeMs += s.totalStudyTimeMs;
    }

    const retentionRate = totalReviews > 0 ? ((goodEasyCount / totalReviews) * 100).toFixed(1) : '100.0';
    const againRate = totalReviews > 0 ? ((againCount / totalReviews) * 100).toFixed(1) : '0.0';

    const startDate = stats.length > 0 ? stats[0].dateStr : '今日';
    const endDate = stats.length > 0 ? stats[stats.length - 1].dateStr : '今日';

    return {
      studentName: profile.displayName,
      generatedAt: new Date().toISOString(),
      dateRange: `${startDate} ~ ${endDate} (近 ${days} 天)`,
      newCardsLearned,
      totalReviews,
      retentionRateText: `${retentionRate}%`,
      againRateText: `${againRate}%`,
      totalStudyMinutes: Math.round(totalStudyTimeMs / 60000),
      streakDays: streak,
      weakestWords: weakestWords.map(w => ({ headword: w.headword, againCount: w.againCount }))
    };
  },

  formatAsTextMessage(summary: TeacherShareSummary): string {
    let text = `📊 【TOEIC 速記】學生學習進度週報\n`;
    text += `👤 學生：${summary.studentName}\n`;
    text += `📅 期間：${summary.dateRange}\n`;
    text += `🔥 連續學習天數：${summary.streakDays} 天\n`;
    text += `⏱️ 總學習時間：${summary.totalStudyMinutes} 分鐘\n`;
    text += `✨ 新學單字量：${summary.newCardsLearned} 字\n`;
    text += `🔄 複習總次數：${summary.totalReviews} 次\n`;
    text += `🎯 記憶良好率：${summary.retentionRateText} (忘記率: ${summary.againRateText})\n`;

    if (summary.weakestWords.length > 0) {
      text += `\n⚠️ 需加強輔導單字 (Top ${summary.weakestWords.length})：\n`;
      summary.weakestWords.forEach((w, idx) => {
        text += ` ${idx + 1}. ${w.headword} (忘記 ${w.againCount} 次)\n`;
      });
    }

    text += `\n（本報告由 TOEIC 速記 PWA 自動生成）`;
    return text;
  }
};
