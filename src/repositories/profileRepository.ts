import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { Profile } from '../types/db';

const ACTIVE_PROFILE_KEY = 'active_profile_id';

export const profileRepository = {
  async getAll(): Promise<Profile[]> {
    return db.profiles.toArray();
  },

  async getById(id: string): Promise<Profile | undefined> {
    return db.profiles.get(id);
  },

  async getActiveProfileId(): Promise<string | null> {
    const setting = await db.appSettings.get(ACTIVE_PROFILE_KEY);
    return setting ? setting.value : null;
  },

  async setActiveProfileId(id: string): Promise<void> {
    await db.appSettings.put({ key: ACTIVE_PROFILE_KEY, value: id });
  },

  async create(data: {
    displayName: string;
    dailyNewCardsTarget?: number;
    dailyReviewTarget?: number;
    desiredRetention?: number;
    preferredAccent?: 'US' | 'UK';
  }): Promise<Profile> {
    const now = new Date().toISOString();
    const newProfile: Profile = {
      id: uuidv4(),
      displayName: data.displayName.trim() || '學生',
      dailyNewCardsTarget: data.dailyNewCardsTarget ?? 15,
      dailyReviewTarget: data.dailyReviewTarget ?? 50,
      desiredRetention: data.desiredRetention ?? 0.9,
      fastSkimDurationSec: 4,
      preferredAccent: data.preferredAccent ?? 'US',
      autoPlayAudio: true,
      isMuted: false,
      createdAt: now,
      updatedAt: now,
      cloudUserId: null
    };

    await db.profiles.add(newProfile);

    // If no active profile, set this as active
    const currentActive = await this.getActiveProfileId();
    if (!currentActive) {
      await this.setActiveProfileId(newProfile.id);
    }

    return newProfile;
  },

  async update(id: string, updates: Partial<Profile>): Promise<void> {
    const now = new Date().toISOString();
    await db.profiles.update(id, {
      ...updates,
      updatedAt: now
    });
  },

  async delete(id: string): Promise<void> {
    await db.transaction('rw', [db.profiles, db.progress, db.reviewLogs, db.dailyStats, db.syncQueue, db.appSettings], async () => {
      await db.profiles.delete(id);
      await db.progress.where('profileId').equals(id).delete();
      await db.reviewLogs.where('profileId').equals(id).delete();
      await db.dailyStats.where('profileId').equals(id).delete();
      await db.syncQueue.where('profileId').equals(id).delete();

      const activeId = await this.getActiveProfileId();
      if (activeId === id) {
        const remaining = await db.profiles.toArray();
        if (remaining.length > 0) {
          await this.setActiveProfileId(remaining[0].id);
        } else {
          await db.appSettings.delete(ACTIVE_PROFILE_KEY);
        }
      }
    });
  }
};
