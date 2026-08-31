import { z } from 'zod';

export const BackupSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string(),
  appVersion: z.string(),
  datasetVersion: z.number(),
  profile: z.object({
    id: z.string(),
    displayName: z.string(),
    dailyNewCardsTarget: z.number(),
    dailyReviewTarget: z.number(),
    desiredRetention: z.number(),
    fastSkimDurationSec: z.number(),
    preferredAccent: z.enum(['US', 'UK']),
    autoPlayAudio: z.boolean(),
    isMuted: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    cloudUserId: z.string().nullable().optional()
  }),
  progress: z.array(
    z.object({
      wordId: z.string(),
      due: z.string(),
      stability: z.number(),
      difficulty: z.number(),
      elapsedDays: z.number(),
      scheduledDays: z.number(),
      reps: z.number(),
      lapses: z.number(),
      state: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
      lastReview: z.string().nullable(),
      updatedAt: z.string(),
      isSuspended: z.boolean().optional(),
      isStarred: z.boolean().optional()
    })
  ),
  reviewLogs: z.array(
    z.object({
      id: z.string(),
      wordId: z.string(),
      rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      state: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
      due: z.string(),
      stability: z.number(),
      difficulty: z.number(),
      elapsedDays: z.number(),
      lastElapsedDays: z.number(),
      scheduledDays: z.number(),
      reviewDurationMs: z.number(),
      reviewedAt: z.string(),
      syncStatus: z.enum(['synced', 'pending', 'failed'])
    })
  ),
  dailyStats: z.array(
    z.object({
      dateStr: z.string(),
      newCardsLearned: z.number(),
      cardsReviewed: z.number(),
      againCount: z.number(),
      hardCount: z.number(),
      goodCount: z.number(),
      easyCount: z.number(),
      totalStudyTimeMs: z.number(),
      updatedAt: z.string()
    })
  ),
  appSettings: z.array(
    z.object({
      key: z.string(),
      value: z.string()
    })
  )
});

export type BackupDataV1 = z.infer<typeof BackupSchemaV1>;

export type ImportStrategy = 'merge' | 'replace' | 'append';

export interface ImportPreviewSummary {
  profileName: string;
  exportedAt: string;
  totalProgress: number;
  totalLogs: number;
  totalDailyStats: number;
  datasetVersion: number;
}
