import { db } from '../db';
import { SyncQueueItem } from '../types/db';
import { SyncState } from '../types/sync';
import { getSupabaseClient, isCloudConfigured } from './supabaseClient';

type Listener = (state: SyncState) => void;

class SyncEngine {
  private listeners: Set<Listener> = new Set();
  private state: SyncState = {
    status: 'idle',
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pendingCount: 0,
    lastSyncedAt: null,
    lastError: null,
    cloudUserEmail: null
  };

  private syncTimer: number | null = null;
  private isProcessing = false;
  private currentAttempts = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.updateState({ isOnline: true });
        this.scheduleSync(500);
      });
      window.addEventListener('offline', () => {
        this.updateState({ isOnline: false, status: 'offline' });
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.state.isOnline) {
          this.scheduleSync(1000);
        }
      });
    }

    this.checkPendingCount();
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private updateState(updates: Partial<SyncState>) {
    this.state = { ...this.state, ...updates };
    this.listeners.forEach(l => l(this.state));
  }

  public getState(): SyncState {
    return this.state;
  }

  public async checkPendingCount(): Promise<number> {
    try {
      const count = await db.syncQueue.where('status').equals('pending').count();
      this.updateState({ pendingCount: count });
      return count;
    } catch {
      return 0;
    }
  }

  public scheduleSync(delayMs = 2000) {
    if (!isCloudConfigured() || !this.state.isOnline) return;

    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }

    this.syncTimer = window.setTimeout(() => {
      this.processQueue();
    }, delayMs);
  }

  public async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    if (!isCloudConfigured()) {
      this.updateState({ status: 'idle' });
      return;
    }

    const client = getSupabaseClient();
    if (!client) return;

    const { data: { session } } = await client.auth.getSession();
    if (!session || !session.user) {
      this.updateState({ cloudUserEmail: null, status: 'idle' });
      return;
    }

    this.updateState({
      cloudUserEmail: session.user.email,
      status: 'syncing',
      lastError: null
    });

    this.isProcessing = true;

    try {
      const pendingItems = await db.syncQueue
        .where('status')
        .equals('pending')
        .limit(50)
        .toArray();

      if (pendingItems.length === 0) {
        this.updateState({
          status: 'idle',
          pendingCount: 0,
          lastSyncedAt: new Date().toISOString()
        });
        this.currentAttempts = 0;
        this.isProcessing = false;
        return;
      }

      const processedIds: string[] = [];

      for (const item of pendingItems) {
        try {
          await this.syncItem(item, session.user.id);
          processedIds.push(item.id);
        } catch (itemErr) {
          console.warn(`[SyncEngine] Item ${item.id} sync error:`, itemErr);
          await db.syncQueue.update(item.id, {
            attempts: item.attempts + 1,
            lastError: (itemErr as Error).message || String(itemErr)
          });
        }
      }

      if (processedIds.length > 0) {
        await db.syncQueue.where('id').anyOf(processedIds).delete();
      }

      const remaining = await this.checkPendingCount();
      this.currentAttempts = 0;
      this.updateState({
        status: 'idle',
        pendingCount: remaining,
        lastSyncedAt: new Date().toISOString()
      });

      if (remaining > 0) {
        this.scheduleSync(1000);
      }
    } catch (err) {
      console.warn('[SyncEngine] Sync cycle error:', err);
      this.currentAttempts++;
      // Exponential backoff with jitter
      const backoffMs = Math.min(60000, Math.pow(2, this.currentAttempts) * 1000 + Math.random() * 1000);
      this.updateState({
        status: 'error',
        lastError: (err as Error).message || '同步錯誤'
      });
      this.scheduleSync(backoffMs);
    } finally {
      this.isProcessing = false;
    }
  }

  private async syncItem(item: SyncQueueItem, userId: string): Promise<void> {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase client unavailable');

    const data = JSON.parse(item.payload);

    if (item.entityType === 'progress') {
      const { error } = await client.from('user_word_progress').upsert({
        user_id: userId,
        word_id: data.wordId,
        due: data.due,
        stability: data.stability,
        difficulty: data.difficulty,
        elapsed_days: data.elapsedDays,
        scheduled_days: data.scheduledDays,
        reps: data.reps,
        lapses: data.lapses,
        state: data.state,
        last_review: data.lastReview,
        is_suspended: data.isSuspended || false,
        is_starred: data.isStarred || false,
        updated_at: data.updatedAt
      }, {
        onConflict: 'user_id,word_id'
      });

      if (error) throw error;
    } else if (item.entityType === 'reviewLog') {
      const { error } = await client.from('review_logs').upsert({
        id: data.id,
        user_id: userId,
        word_id: data.wordId,
        rating: data.rating,
        state: data.state,
        due: data.due,
        stability: data.stability,
        difficulty: data.difficulty,
        elapsed_days: data.elapsedDays,
        last_elapsed_days: data.lastElapsedDays,
        scheduled_days: data.scheduledDays,
        review_duration_ms: data.reviewDurationMs,
        reviewed_at: data.reviewedAt
      }, {
        onConflict: 'id'
      });

      if (error) throw error;
    }
  }
}

export const syncEngine = new SyncEngine();
