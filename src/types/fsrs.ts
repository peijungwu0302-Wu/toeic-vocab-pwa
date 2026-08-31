import { FSRSState, Progress, ReviewLog } from './db';

export type FSRSRating = 1 | 2 | 3 | 4; // 1: Again, 2: Hard, 3: Good, 4: Easy

export interface IntervalPreviewItem {
  rating: FSRSRating;
  label: string; // '忘記 (Again)', '困難 (Hard)', '良好 (Good)', '簡單 (Easy)'
  intervalText: string; // e.g. '10 分鐘', '1 天', '3 天', '6 天'
  due: Date;
  state: FSRSState;
}

export interface FSRSReviewOutput {
  updatedProgress: Progress;
  reviewLog: ReviewLog;
}

export interface FSRSStatsSummary {
  retrievability: number; // 0.0 - 1.0
  retrievabilityPercentText: string; // e.g. '92.5%'
}
