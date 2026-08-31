import { db } from '../db';
import { BackupDataV1, BackupSchemaV1, ImportPreviewSummary, ImportStrategy } from '../types/backup';
import { Progress, ReviewLog, DailyStat } from '../types/db';

export const backupService = {
  async generateBackup(profileId: string): Promise<BackupDataV1> {
    const profile = await db.profiles.get(profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    const progress = await db.progress.where('profileId').equals(profileId).toArray();
    const reviewLogs = await db.reviewLogs.where('profileId').equals(profileId).toArray();
    const dailyStats = await db.dailyStats.where('profileId').equals(profileId).toArray();
    const appSettings = await db.appSettings.toArray();

    const backup: BackupDataV1 = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '1.0.0',
      datasetVersion: 1,
      profile: {
        id: profile.id,
        displayName: profile.displayName,
        dailyNewCardsTarget: profile.dailyNewCardsTarget,
        dailyReviewTarget: profile.dailyReviewTarget,
        desiredRetention: profile.desiredRetention,
        fastSkimDurationSec: profile.fastSkimDurationSec,
        preferredAccent: profile.preferredAccent,
        autoPlayAudio: profile.autoPlayAudio,
        isMuted: profile.isMuted,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        cloudUserId: profile.cloudUserId
      },
      progress: progress.map(p => ({
        wordId: p.wordId,
        due: p.due,
        stability: p.stability,
        difficulty: p.difficulty,
        elapsedDays: p.elapsedDays,
        scheduledDays: p.scheduledDays,
        reps: p.reps,
        lapses: p.lapses,
        state: p.state,
        lastReview: p.lastReview,
        updatedAt: p.updatedAt,
        isSuspended: p.isSuspended,
        isStarred: p.isStarred
      })),
      reviewLogs: reviewLogs.map(l => ({
        id: l.id,
        wordId: l.wordId,
        rating: l.rating,
        state: l.state,
        due: l.due,
        stability: l.stability,
        difficulty: l.difficulty,
        elapsedDays: l.elapsedDays,
        lastElapsedDays: l.lastElapsedDays,
        scheduledDays: l.scheduledDays,
        reviewDurationMs: l.reviewDurationMs,
        reviewedAt: l.reviewedAt,
        syncStatus: l.syncStatus
      })),
      dailyStats: dailyStats.map(s => ({
        dateStr: s.dateStr,
        newCardsLearned: s.newCardsLearned,
        cardsReviewed: s.cardsReviewed,
        againCount: s.againCount,
        hardCount: s.hardCount,
        goodCount: s.goodCount,
        easyCount: s.easyCount,
        totalStudyTimeMs: s.totalStudyTimeMs,
        updatedAt: s.updatedAt
      })),
      appSettings: appSettings.map(s => ({ key: s.key, value: s.value }))
    };

    return backup;
  },

  async exportToFile(profileId: string): Promise<void> {
    const backup = await this.generateBackup(profileId);
    const jsonStr = JSON.stringify(backup, null, 2);
    const fileName = `toeic_backup_${backup.profile.displayName}_${backup.exportedAt.slice(0, 10)}.json`;

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([jsonStr], fileName, { type: 'application/json' })] })) {
      try {
        const file = new File([jsonStr], fileName, { type: 'application/json' });
        await navigator.share({
          title: 'TOEIC 速記學習備份',
          files: [file]
        });
        return;
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.warn('[BackupService] Web Share failed, falling back to download:', err);
        } else {
          return;
        }
      }
    }

    // Fallback standard browser download
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  parseAndValidateBackup(jsonString: string): { data: BackupDataV1; summary: ImportPreviewSummary } {
    const raw = JSON.parse(jsonString);
    const data = BackupSchemaV1.parse(raw);

    const summary: ImportPreviewSummary = {
      profileName: data.profile.displayName,
      exportedAt: data.exportedAt,
      totalProgress: data.progress.length,
      totalLogs: data.reviewLogs.length,
      totalDailyStats: data.dailyStats.length,
      datasetVersion: data.datasetVersion
    };

    return { data, summary };
  },

  async importBackup(targetProfileId: string, backup: BackupDataV1, strategy: ImportStrategy): Promise<void> {
    const targetProfile = await db.profiles.get(targetProfileId);
    if (!targetProfile) {
      throw new Error(`Target profile does not exist: ${targetProfileId}`);
    }

    if (strategy === 'replace') {
      // Auto create a snapshot backup before destructive replace
      const autoSnapshot = await this.generateBackup(targetProfileId);
      const snapshotKey = `auto_backup_${targetProfileId}_${Date.now()}`;
      await db.appSettings.put({ key: snapshotKey, value: JSON.stringify(autoSnapshot) });

      await db.transaction('rw', [db.profiles, db.progress, db.reviewLogs, db.dailyStats], async () => {
        // Delete current learning data for this profile
        await db.progress.where('profileId').equals(targetProfileId).delete();
        await db.reviewLogs.where('profileId').equals(targetProfileId).delete();
        await db.dailyStats.where('profileId').equals(targetProfileId).delete();

        // Update profile preferences
        await db.profiles.update(targetProfileId, {
          dailyNewCardsTarget: backup.profile.dailyNewCardsTarget,
          dailyReviewTarget: backup.profile.dailyReviewTarget,
          desiredRetention: backup.profile.desiredRetention,
          fastSkimDurationSec: backup.profile.fastSkimDurationSec,
          preferredAccent: backup.profile.preferredAccent,
          autoPlayAudio: backup.profile.autoPlayAudio,
          isMuted: backup.profile.isMuted,
          updatedAt: new Date().toISOString()
        });

        // Insert new records
        const newProgress: Progress[] = backup.progress.map(p => ({
          ...p,
          profileId: targetProfileId
        }));
        await db.progress.bulkAdd(newProgress);

        const newLogs: ReviewLog[] = backup.reviewLogs.map(l => ({
          ...l,
          profileId: targetProfileId
        }));
        await db.reviewLogs.bulkAdd(newLogs);

        const newStats: DailyStat[] = backup.dailyStats.map(s => ({
          ...s,
          profileId: targetProfileId
        }));
        await db.dailyStats.bulkAdd(newStats);
      });
    } else if (strategy === 'merge') {
      await db.transaction('rw', [db.progress, db.reviewLogs, db.dailyStats], async () => {
        // 1. Merge review logs by ID (idempotent)
        for (const log of backup.reviewLogs) {
          const exists = await db.reviewLogs.get(log.id);
          if (!exists) {
            await db.reviewLogs.add({
              ...log,
              profileId: targetProfileId
            });
          }
        }

        // 2. Merge progress: keep whichever has newer lastReview / updatedAt
        for (const impProg of backup.progress) {
          const current = await db.progress
            .where('[profileId+wordId]')
            .equals([targetProfileId, impProg.wordId])
            .first();

          if (!current) {
            await db.progress.add({
              ...impProg,
              profileId: targetProfileId
            });
          } else {
            const currentDate = new Date(current.lastReview || current.updatedAt).getTime();
            const importDate = new Date(impProg.lastReview || impProg.updatedAt).getTime();
            if (importDate > currentDate) {
              await db.progress.put({
                ...impProg,
                id: current.id,
                profileId: targetProfileId
              });
            }
          }
        }

        // 3. Merge daily stats: add up numbers or keep max
        for (const stat of backup.dailyStats) {
          const current = await db.dailyStats
            .where('[profileId+dateStr]')
            .equals([targetProfileId, stat.dateStr])
            .first();

          if (!current) {
            await db.dailyStats.add({
              ...stat,
              profileId: targetProfileId
            });
          } else {
            await db.dailyStats.update(current.id!, {
              newCardsLearned: Math.max(current.newCardsLearned, stat.newCardsLearned),
              cardsReviewed: Math.max(current.cardsReviewed, stat.cardsReviewed),
              againCount: Math.max(current.againCount, stat.againCount),
              hardCount: Math.max(current.hardCount, stat.hardCount),
              goodCount: Math.max(current.goodCount, stat.goodCount),
              easyCount: Math.max(current.easyCount, stat.easyCount),
              totalStudyTimeMs: Math.max(current.totalStudyTimeMs, stat.totalStudyTimeMs),
              updatedAt: new Date().toISOString()
            });
          }
        }
      });
    }
  }
};
