import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db';
import { syncEngine } from '../src/services/syncEngine';

describe('Sync Engine & Offline Queue Tests', () => {
  beforeEach(async () => {
    await db.syncQueue.clear();
  });

  it('correctly reports initial sync state and offline status', () => {
    const state = syncEngine.getState();
    expect(state.status).toBeDefined();
    expect(state.pendingCount).toBeDefined();
  });

  it('accurately tracks pending queue items count', async () => {
    await db.syncQueue.add({
      id: 'queue-1',
      profileId: 'prof-1',
      entityType: 'progress',
      entityId: 'tw_w_1',
      payload: JSON.stringify({ wordId: 'tw_w_1' }),
      operation: 'upsert',
      status: 'pending',
      attempts: 0,
      createdAt: new Date().toISOString(),
      nextAttemptAt: new Date().toISOString()
    });

    const count = await syncEngine.checkPendingCount();
    expect(count).toBe(1);
  });
});
