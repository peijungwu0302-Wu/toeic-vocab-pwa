export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export interface SyncState {
  status: SyncStatus;
  isOnline: boolean;
  pendingCount: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  cloudUserEmail?: string | null;
}

export interface SyncConflictItem {
  wordId: string;
  headword: string;
  localLastReview: string | null;
  remoteLastReview: string | null;
  localRating: number;
  remoteRating: number;
}
