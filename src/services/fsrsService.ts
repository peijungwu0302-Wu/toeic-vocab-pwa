import {
  fsrs,
  createEmptyCard,
  Rating as FSRSRatingEnum,
  State as FSRSStateEnum,
  type Card as FSRSCard,
  type RecordLogItem
} from 'ts-fsrs';
import { v4 as uuidv4 } from 'uuid';
import { FSRSState, Progress, ReviewLog } from '../types/db';
import { FSRSRating, IntervalPreviewItem, FSRSReviewOutput } from '../types/fsrs';

function formatInterval(scheduledDays: number, due: Date, now: Date): string {
  const diffMs = due.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / (60 * 1000));
  const diffHours = Math.round(diffMs / (60 * 60 * 1000));

  if (diffMinutes <= 1) return '< 1 分鐘';
  if (diffMinutes < 60) return `${diffMinutes} 分鐘`;
  if (diffHours < 24) return `${diffHours} 小時`;

  const days = Math.round(scheduledDays) || Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 1) return '1 天';
  if (days < 30) return `${days} 天`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} 個月`;
  const years = (days / 365).toFixed(1);
  return `${years} 年`;
}

function progressToFSRSCard(progress: Progress): FSRSCard {
  return {
    due: new Date(progress.due),
    stability: progress.stability,
    difficulty: progress.difficulty,
    elapsed_days: progress.elapsedDays,
    scheduled_days: progress.scheduledDays,
    reps: progress.reps,
    lapses: progress.lapses,
    learning_steps: 0,
    state: progress.state as unknown as FSRSStateEnum,
    last_review: progress.lastReview ? new Date(progress.lastReview) : undefined
  };
}

function fsrsCardToProgress(card: FSRSCard, profileId: string, wordId: string, now: Date, isSuspended = false, isStarred = false): Progress {
  return {
    profileId,
    wordId,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as number as FSRSState,
    lastReview: card.last_review ? card.last_review.toISOString() : now.toISOString(),
    updatedAt: now.toISOString(),
    isSuspended,
    isStarred
  };
}

export const fsrsService = {
  createInitialProgress(profileId: string, wordId: string, now: Date = new Date()): Progress {
    const emptyCard = createEmptyCard(now);
    return fsrsCardToProgress(emptyCard, profileId, wordId, now);
  },

  previewRatings(progress: Progress, now: Date = new Date(), requestRetention = 0.9): IntervalPreviewItem[] {
    const scheduler = fsrs({
      request_retention: requestRetention,
      enable_fuzz: false
    });

    const card = progressToFSRSCard(progress);
    const repeatResults = scheduler.repeat(card, now);

    const ratingsMap: Array<{ rating: FSRSRating; label: string; fsrsRating: FSRSRatingEnum }> = [
      { rating: 1, label: '忘記 (Again)', fsrsRating: FSRSRatingEnum.Again },
      { rating: 2, label: '困難 (Hard)', fsrsRating: FSRSRatingEnum.Hard },
      { rating: 3, label: '良好 (Good)', fsrsRating: FSRSRatingEnum.Good },
      { rating: 4, label: '簡單 (Easy)', fsrsRating: FSRSRatingEnum.Easy }
    ];

    return ratingsMap.map(item => {
      const itemRecord: RecordLogItem = (repeatResults as unknown as Record<number, RecordLogItem>)[item.fsrsRating];
      const nextCard = itemRecord.card;
      return {
        rating: item.rating,
        label: item.label,
        intervalText: formatInterval(nextCard.scheduled_days, nextCard.due, now),
        due: nextCard.due,
        state: nextCard.state as number as FSRSState
      };
    });
  },

  review(
    progress: Progress,
    rating: FSRSRating,
    now: Date = new Date(),
    durationMs = 0,
    requestRetention = 0.9
  ): FSRSReviewOutput {
    const scheduler = fsrs({
      request_retention: requestRetention,
      enable_fuzz: false
    });

    const card = progressToFSRSCard(progress);
    const repeatResults = scheduler.repeat(card, now);

    const ratingEnumMap: Record<FSRSRating, FSRSRatingEnum> = {
      1: FSRSRatingEnum.Again,
      2: FSRSRatingEnum.Hard,
      3: FSRSRatingEnum.Good,
      4: FSRSRatingEnum.Easy
    };

    const recordLog = (repeatResults as unknown as Record<number, RecordLogItem>)[ratingEnumMap[rating]];
    const updatedCard = recordLog.card;
    const log = recordLog.log;

    const updatedProgress = fsrsCardToProgress(
      updatedCard,
      progress.profileId,
      progress.wordId,
      now,
      progress.isSuspended,
      progress.isStarred
    );

    const reviewLog: ReviewLog = {
      id: uuidv4(),
      profileId: progress.profileId,
      wordId: progress.wordId,
      rating,
      state: log.state as number as FSRSState,
      due: updatedCard.due.toISOString(),
      stability: updatedCard.stability,
      difficulty: updatedCard.difficulty,
      elapsedDays: log.elapsed_days,
      lastElapsedDays: log.last_elapsed_days,
      scheduledDays: log.scheduled_days,
      reviewDurationMs: Math.max(0, durationMs),
      reviewedAt: now.toISOString(),
      syncStatus: 'pending'
    };

    return {
      updatedProgress,
      reviewLog
    };
  },

  getRetrievability(progress: Progress, now: Date = new Date(), requestRetention = 0.9): number {
    if (progress.state === 0 || progress.reps === 0) return 1.0;
    const scheduler = fsrs({ request_retention: requestRetention });
    const card = progressToFSRSCard(progress);
    const retrievabilityStr = scheduler.get_retrievability(card, now);
    // Parse "94.68%" or number
    if (typeof retrievabilityStr === 'number') {
      return retrievabilityStr;
    }
    const parsed = parseFloat(String(retrievabilityStr).replace('%', ''));
    return isNaN(parsed) ? 1.0 : parsed / 100;
  }
};
