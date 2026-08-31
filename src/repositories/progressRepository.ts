import Dexie from 'dexie';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { Progress, ReviewLog, SyncQueueItem, Word } from '../types/db';
import { FSRSRating } from '../types/fsrs';
import { fsrsService } from '../services/fsrsService';

function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shuffleList<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const progressRepository = {
  async getByWordId(profileId: string, wordId: string): Promise<Progress | undefined> {
    return db.progress.where('[profileId+wordId]').equals([profileId, wordId]).first();
  },

  async getAllForProfile(profileId: string): Promise<Progress[]> {
    return db.progress.where('profileId').equals(profileId).toArray();
  },

  async getDueWords(
    profileId: string,
    courseId?: string,
    limit = 50,
    options?: { category?: string; shuffle?: boolean }
  ): Promise<{ word: Word; progress: Progress }[]> {
    const nowIso = new Date().toISOString();

    // Query progress where due <= now and not suspended
    let dueList = await db.progress
      .where('[profileId+due]')
      .between([profileId, Dexie.minKey], [profileId, nowIso], true, true)
      .toArray();

    dueList = dueList.filter(p => !p.isSuspended);

    if (courseId && courseId !== 'all') {
      const courseWords = await db.courseWords.where('courseId').equals(courseId).toArray();
      const courseWordIdSet = new Set(courseWords.map(cw => cw.wordId));
      dueList = dueList.filter(p => courseWordIdSet.has(p.wordId));
    }

    if (dueList.length === 0) return [];

    const wordIds = dueList.map(p => p.wordId);
    let words = await db.words.where('id').anyOf(wordIds).toArray();

    if (options?.category && options.category !== 'all') {
      words = words.filter(w => w.category === options.category);
    }

    const wordMap = new Map(words.map(w => [w.id, w]));
    let result: { word: Word; progress: Progress }[] = [];

    for (const p of dueList) {
      const w = wordMap.get(p.wordId);
      if (w) {
        result.push({ word: w, progress: p });
      }
    }

    if (options?.shuffle) {
      result = shuffleList(result);
    }

    return result.slice(0, limit);
  },

  async getNewWordsForCourse(
    profileId: string,
    courseId: string,
    limit = 15,
    options?: { category?: string; shuffle?: boolean }
  ): Promise<{ word: Word; progress: Progress }[]> {
    let wordIds: string[] = [];

    if (courseId === 'all') {
      const allDownloaded = await db.words.toArray();
      wordIds = allDownloaded.map(w => w.id);
    } else {
      const courseWords = await db.courseWords.where('courseId').equals(courseId).sortBy('orderIndex');
      wordIds = courseWords.map(cw => cw.wordId);
    }

    // Find which wordIds already have progress for this profile
    const existingProgress = await db.progress.where('profileId').equals(profileId).toArray();
    const existingWordIdSet = new Set(existingProgress.map(p => p.wordId));

    const newWordIds = wordIds.filter(id => !existingWordIdSet.has(id));
    if (newWordIds.length === 0) return [];

    let words = await db.words.where('id').anyOf(newWordIds).toArray();
    if (options?.category && options.category !== 'all') {
      words = words.filter(w => w.category === options.category);
    }

    if (options?.shuffle) {
      words = shuffleList(words);
    }

    const selectedWords = words.slice(0, limit);
    const now = new Date();

    return selectedWords.map(w => {
      const initProgress = fsrsService.createInitialProgress(profileId, w.id, now);
      return { word: w, progress: initProgress };
    });
  },

  async recordReviewTransaction(params: {
    profileId: string;
    wordId: string;
    rating: FSRSRating;
    durationMs: number;
    desiredRetention?: number;
    enableCloudSync?: boolean;
    now?: Date;
  }): Promise<{ updatedProgress: Progress; reviewLog: ReviewLog }> {
    const now = params.now || new Date();
    const dateStr = getLocalDateString(now);

    return await db.transaction(
      'rw',
      [db.progress, db.reviewLogs, db.dailyStats, db.syncQueue],
      async () => {
        // 1. Get current progress or create initial
        let currentProgress = await db.progress
          .where('[profileId+wordId]')
          .equals([params.profileId, params.wordId])
          .first();

        const isNewCard = !currentProgress || currentProgress.state === 0 || currentProgress.reps === 0;

        if (!currentProgress) {
          currentProgress = fsrsService.createInitialProgress(params.profileId, params.wordId, now);
        }

        // 2. Compute FSRS step
        const { updatedProgress, reviewLog } = fsrsService.review(
          currentProgress,
          params.rating,
          now,
          params.durationMs,
          params.desiredRetention ?? 0.9
        );

        // 3. Save progress
        if (currentProgress.id) {
          updatedProgress.id = currentProgress.id;
          await db.progress.put(updatedProgress);
        } else {
          const insertedId = await db.progress.add(updatedProgress);
          updatedProgress.id = insertedId as number;
        }

        // 4. Save review log
        await db.reviewLogs.add(reviewLog);

        // 5. Update daily stats
        let stat = await db.dailyStats
          .where('[profileId+dateStr]')
          .equals([params.profileId, dateStr])
          .first();

        if (!stat) {
          stat = {
            profileId: params.profileId,
            dateStr,
            newCardsLearned: isNewCard ? 1 : 0,
            cardsReviewed: 1,
            againCount: params.rating === 1 ? 1 : 0,
            hardCount: params.rating === 2 ? 1 : 0,
            goodCount: params.rating === 3 ? 1 : 0,
            easyCount: params.rating === 4 ? 1 : 0,
            totalStudyTimeMs: params.durationMs,
            updatedAt: now.toISOString()
          };
          await db.dailyStats.add(stat);
        } else {
          stat.cardsReviewed += 1;
          if (isNewCard) {
            stat.newCardsLearned += 1;
          }
          if (params.rating === 1) stat.againCount += 1;
          else if (params.rating === 2) stat.hardCount += 1;
          else if (params.rating === 3) stat.goodCount += 1;
          else if (params.rating === 4) stat.easyCount += 1;

          stat.totalStudyTimeMs += params.durationMs;
          stat.updatedAt = now.toISOString();
          await db.dailyStats.put(stat);
        }

        // 6. Enqueue sync if cloud mode is enabled
        if (params.enableCloudSync) {
          const queueItem1: SyncQueueItem = {
            id: uuidv4(),
            profileId: params.profileId,
            entityType: 'progress',
            entityId: params.wordId,
            payload: JSON.stringify(updatedProgress),
            operation: 'upsert',
            status: 'pending',
            attempts: 0,
            createdAt: now.toISOString(),
            nextAttemptAt: now.toISOString()
          };
          const queueItem2: SyncQueueItem = {
            id: uuidv4(),
            profileId: params.profileId,
            entityType: 'reviewLog',
            entityId: reviewLog.id,
            payload: JSON.stringify(reviewLog),
            operation: 'upsert',
            status: 'pending',
            attempts: 0,
            createdAt: now.toISOString(),
            nextAttemptAt: now.toISOString()
          };
          await db.syncQueue.bulkAdd([queueItem1, queueItem2]);
        }

        return { updatedProgress, reviewLog };
      }
    );
  },

  async toggleStarred(profileId: string, wordId: string): Promise<boolean> {
    return await db.transaction('rw', [db.progress], async () => {
      let progress = await db.progress
        .where('[profileId+wordId]')
        .equals([profileId, wordId])
        .first();

      const now = new Date();
      if (!progress) {
        progress = fsrsService.createInitialProgress(profileId, wordId, now);
        progress.isStarred = true;
        await db.progress.add(progress);
        return true;
      } else {
        const nextStarred = !progress.isStarred;
        await db.progress.update(progress.id!, {
          isStarred: nextStarred,
          updatedAt: now.toISOString()
        });
        return nextStarred;
      }
    });
  },

  async getStarredWords(profileId: string): Promise<{ word: Word; progress: Progress }[]> {
    const list = await db.progress.where('profileId').equals(profileId).filter(p => !!p.isStarred).toArray();
    if (list.length === 0) return [];
    const wordIds = list.map(p => p.wordId);
    const words = await db.words.where('id').anyOf(wordIds).toArray();
    const wordMap = new Map(words.map(w => [w.id, w]));

    return list
      .map(p => ({ word: wordMap.get(p.wordId)!, progress: p }))
      .filter(item => Boolean(item.word));
  }
};
