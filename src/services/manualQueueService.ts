/**
 * src/services/manualQueueService.ts
 * Manages the user's manual practice queue (saved from search, quiz wrong answers, or manual bookmarking).
 *
 * CRITICAL INVARIANT:
 * Enqueuing or managing manual practice queue items MUST NEVER mutate FSRS ratings,
 * state, stability, difficulty, interval, progress records, or review logs.
 */

import { db } from '../db';
import { Word } from '../types/db';

export const manualQueueService = {
  /**
   * Idempotently enqueue words for a profile without touching FSRS.
   * Returns the count of newly enqueued items.
   */
  async enqueueWords(
    profileId: string,
    wordIds: string[],
    source: 'search' | 'quiz' | 'manual' = 'manual'
  ): Promise<number> {
    if (!profileId || !wordIds || wordIds.length === 0) return 0;

    let addedCount = 0;
    const now = new Date().toISOString();

    await db.transaction('rw', db.manualQueue, async () => {
      for (const wordId of wordIds) {
        if (!wordId) continue;
        const existing = await db.manualQueue
          .where('[profileId+wordId]')
          .equals([profileId, wordId])
          .first();

        if (!existing) {
          await db.manualQueue.add({
            profileId,
            wordId,
            source,
            createdAt: now
          });
          addedCount++;
        }
      }
    });

    return addedCount;
  },

  /**
   * Dequeue a word from the profile's manual queue.
   */
  async dequeueWord(profileId: string, wordId: string): Promise<void> {
    if (!profileId || !wordId) return;
    await db.manualQueue
      .where('[profileId+wordId]')
      .equals([profileId, wordId])
      .delete();
  },

  /**
   * Check if a word is currently in the manual practice queue.
   */
  async isInQueue(profileId: string, wordId: string): Promise<boolean> {
    if (!profileId || !wordId) return false;
    const item = await db.manualQueue
      .where('[profileId+wordId]')
      .equals([profileId, wordId])
      .first();
    return Boolean(item);
  },

  /**
   * Get all words currently in the manual practice queue for a profile,
   * ordered by most recently added.
   */
  async getQueueWords(profileId: string): Promise<Word[]> {
    if (!profileId) return [];
    const queueItems = await db.manualQueue
      .where('profileId')
      .equals(profileId)
      .reverse()
      .sortBy('createdAt');

    if (queueItems.length === 0) return [];

    const wordIds = queueItems.map(q => q.wordId);
    const wordsMap = new Map<string, Word>();
    const foundWords = await db.words.where('id').anyOf(wordIds).toArray();
    for (const w of foundWords) {
      wordsMap.set(w.id, w);
    }

    const ordered: Word[] = [];
    for (const id of wordIds) {
      const w = wordsMap.get(id);
      if (w) ordered.push(w);
    }
    return ordered;
  },

  /**
   * Get count of words in the manual queue for a profile.
   */
  async getQueueCount(profileId: string): Promise<number> {
    if (!profileId) return 0;
    return await db.manualQueue.where('profileId').equals(profileId).count();
  },

  /**
   * Clear all manual queue items for a profile.
   */
  async clearQueue(profileId: string): Promise<void> {
    if (!profileId) return;
    await db.manualQueue.where('profileId').equals(profileId).delete();
  }
};
