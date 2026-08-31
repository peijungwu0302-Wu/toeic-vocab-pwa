import { describe, it, expect } from 'vitest';
import { fsrsService } from '../src/services/fsrsService';

describe('FSRS Service Unit Tests', () => {
  const profileId = 'test-profile-uuid';
  const wordId = 'tw_w_test123';
  const now = new Date('2026-09-01T12:00:00.000Z');

  it('creates initial empty progress with state 0 (New)', () => {
    const progress = fsrsService.createInitialProgress(profileId, wordId, now);

    expect(progress.profileId).toBe(profileId);
    expect(progress.wordId).toBe(wordId);
    expect(progress.state).toBe(0);
    expect(progress.reps).toBe(0);
    expect(progress.lapses).toBe(0);
    expect(progress.stability).toBe(0);
    expect(progress.difficulty).toBe(0);
  });

  it('previews 4 ratings without modifying original progress', () => {
    const original = fsrsService.createInitialProgress(profileId, wordId, now);
    const originalJson = JSON.stringify(original);

    const previews = fsrsService.previewRatings(original, now, 0.9);

    expect(previews).toHaveLength(4);
    expect(previews[0].rating).toBe(1); // Again
    expect(previews[1].rating).toBe(2); // Hard
    expect(previews[2].rating).toBe(3); // Good
    expect(previews[3].rating).toBe(4); // Easy

    // Check interval text exists
    expect(previews[0].intervalText).toBeTruthy();
    expect(previews[2].intervalText).toBeTruthy();

    // Verify original was not mutated
    expect(JSON.stringify(original)).toBe(originalJson);
  });

  it('performs review for Good (3) and produces updated progress and immutable log', () => {
    const initial = fsrsService.createInitialProgress(profileId, wordId, now);
    const result = fsrsService.review(initial, 3, now, 4200, 0.9);

    expect(result.updatedProgress.reps).toBe(1);
    expect(result.updatedProgress.stability).toBeGreaterThan(0);
    expect(result.updatedProgress.difficulty).toBeGreaterThan(0);
    expect(result.updatedProgress.lastReview).toBe(now.toISOString());

    expect(result.reviewLog.profileId).toBe(profileId);
    expect(result.reviewLog.wordId).toBe(wordId);
    expect(result.reviewLog.rating).toBe(3);
    expect(result.reviewLog.reviewDurationMs).toBe(4200);
    expect(result.reviewLog.reviewedAt).toBe(now.toISOString());
  });

  it('handles lapse on review card and enters relearning state properly', () => {
    let progress = fsrsService.createInitialProgress(profileId, wordId, now);

    // Initial review with Easy (4) graduates card to Review state (2)
    const res1 = fsrsService.review(progress, 4, now, 3000);
    progress = res1.updatedProgress;
    expect(progress.state).toBe(2); // State.Review

    // 8 days later, student forgets card: Again (1)
    const review2Date = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    const res2 = fsrsService.review(progress, 1, review2Date, 3500);

    expect(res2.updatedProgress.lapses).toBe(1);
    expect(res2.updatedProgress.state).toBe(3); // State.Relearning
  });

  it('serializes all timestamps to standard UTC ISO 8601 strings', () => {
    const initial = fsrsService.createInitialProgress(profileId, wordId, now);
    const { updatedProgress, reviewLog } = fsrsService.review(initial, 3, now);

    expect(new Date(updatedProgress.due).toISOString()).toBe(updatedProgress.due);
    expect(new Date(reviewLog.due).toISOString()).toBe(reviewLog.due);
    expect(new Date(reviewLog.reviewedAt).toISOString()).toBe(reviewLog.reviewedAt);
  });
});
