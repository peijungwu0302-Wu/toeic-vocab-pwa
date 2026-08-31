import { db } from '../db';
import { DailyStat, ReviewLog } from '../types/db';

export const statsRepository = {
  async getDailyStats(profileId: string, days = 30): Promise<DailyStat[]> {
    const stats = await db.dailyStats
      .where('profileId')
      .equals(profileId)
      .sortBy('dateStr');

    return stats.slice(-days);
  },

  async getRecentReviewLogs(profileId: string, limit = 50): Promise<ReviewLog[]> {
    const logs = await db.reviewLogs
      .where('profileId')
      .equals(profileId)
      .reverse()
      .sortBy('reviewedAt');

    return logs.slice(0, limit);
  },

  async getStreakDays(profileId: string): Promise<number> {
    const stats = await db.dailyStats
      .where('profileId')
      .equals(profileId)
      .sortBy('dateStr');

    if (stats.length === 0) return 0;

    const dateSet = new Set(stats.map(s => s.dateStr));
    let streak = 0;
    const now = new Date();

    // Check today or yesterday
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const checkDate = new Date(now);

    if (!dateSet.has(todayStr)) {
      // Check yesterday
      checkDate.setDate(checkDate.getDate() - 1);
    }

    while (true) {
      const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
      if (dateSet.has(dateStr)) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    return streak;
  },

  async getMostForgottenWords(profileId: string, limit = 20): Promise<Array<{ wordId: string; headword: string; againCount: number }>> {
    const logs = await db.reviewLogs.where('profileId').equals(profileId).toArray();
    const againCountMap = new Map<string, number>();

    for (const log of logs) {
      if (log.rating === 1) {
        againCountMap.set(log.wordId, (againCountMap.get(log.wordId) || 0) + 1);
      }
    }

    const sorted = Array.from(againCountMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    if (sorted.length === 0) return [];

    const wordIds = sorted.map(s => s[0]);
    const words = await db.words.where('id').anyOf(wordIds).toArray();
    const wordMap = new Map(words.map(w => [w.id, w.headword]));

    return sorted.map(([wordId, count]) => ({
      wordId,
      headword: wordMap.get(wordId) || wordId,
      againCount: count
    }));
  }
};
