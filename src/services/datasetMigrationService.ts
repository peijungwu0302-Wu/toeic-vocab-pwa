import { db } from '../db';
import { courseRepository } from '../repositories/courseRepository';

export const CURRENT_DATASET_VERSION = 12;
export const DATASET_RELEASE_TAG = 'v6.2.0-bbword-vip-lexicon';
export const APP_RELEASE_VERSION = 'v1.1.3 (Official Release)';

export interface DatasetDiagnostics {
  appVersion: string;
  datasetReleaseTag: string;
  indexedDbMigrationVersion: number;
  localIndexedDbVersion: number;
  cachedWordsCount: number;
  cachedCoursesCount: number;
  isUpToDate: boolean;
}

export const datasetMigrationService = {
  /**
   * Get real-time diagnostic information for the user UI
   */
  async getDiagnostics(): Promise<DatasetDiagnostics> {
    try {
      const versionSetting = await db.appSettings.get('dataset_version');
      const currentLocalVersion = versionSetting ? parseInt(versionSetting.value, 10) : 1;
      const cachedWordsCount = await db.words.count();
      const localCourses = await db.courses.toArray();
      const cachedCoursesCount = localCourses.filter(c => c.isDownloaded).length;

      return {
        appVersion: APP_RELEASE_VERSION,
        datasetReleaseTag: DATASET_RELEASE_TAG,
        indexedDbMigrationVersion: CURRENT_DATASET_VERSION,
        localIndexedDbVersion: currentLocalVersion,
        cachedWordsCount,
        cachedCoursesCount,
        isUpToDate: currentLocalVersion >= CURRENT_DATASET_VERSION
      };
    } catch {
      return {
        appVersion: APP_RELEASE_VERSION,
        datasetReleaseTag: DATASET_RELEASE_TAG,
        indexedDbMigrationVersion: CURRENT_DATASET_VERSION,
        localIndexedDbVersion: 1,
        cachedWordsCount: 0,
        cachedCoursesCount: 0,
        isUpToDate: false
      };
    }
  },

  /**
   * Automatically migrates local IndexedDB words and courses to v6 (v6.0.0-bbword-vip-lexicon).
   * Runs silently in the background on App startup without interrupting the user.
   */
  async autoMigrateIfOutdated(): Promise<boolean> {
    try {
      const versionSetting = await db.appSettings.get('dataset_version');
      const currentLocalVersion = versionSetting ? parseInt(versionSetting.value, 10) : 1;

      if (currentLocalVersion >= CURRENT_DATASET_VERSION) {
        return false;
      }

      console.log(`[DatasetMigration] Upgrading local IndexedDB from v${currentLocalVersion} to v${CURRENT_DATASET_VERSION}...`);

      // 1. Fetch latest catalog
      const catalog = await courseRepository.fetchCatalog();
      const allCatalogCourses = catalog.courses || [];

      // 2. Find all downloaded courses on this device
      const localCourses = await db.courses.toArray();
      const downloadedCourses = localCourses.filter(c => c.isDownloaded);

      // 3. Clear legacy words cache to eliminate any stale +ing artifacts
      await db.words.clear();

      // 4. Refresh each downloaded course with the latest v5.0 JSON
      if (downloadedCourses.length > 0) {
        for (const downloaded of downloadedCourses) {
          const catalogEntry = allCatalogCourses.find(c => c.id === downloaded.id);
          if (catalogEntry) {
            try {
              await courseRepository.downloadAndSaveCourse(catalogEntry.id, catalogEntry.fileName);
            } catch (courseErr) {
              console.warn(`[DatasetMigration] Failed to update course ${downloaded.id}:`, courseErr);
            }
          }
        }
      } else if (allCatalogCourses.length > 0) {
        // Automatically download core-1200 course if no courses were cached yet
        const defaultCourse = allCatalogCourses.find(c => c.id === 'course-core-1200') || allCatalogCourses[0];
        if (defaultCourse) {
          try {
            await courseRepository.downloadAndSaveCourse(defaultCourse.id, defaultCourse.fileName);
          } catch (defaultErr) {
            console.warn('[DatasetMigration] Failed to download default core course:', defaultErr);
          }
        }
      }

      // 5. Mark dataset as upgraded to v5
      await db.appSettings.put({
        key: 'dataset_version',
        value: String(CURRENT_DATASET_VERSION)
      });

      console.log(`[DatasetMigration] Successfully updated all local courses to v${CURRENT_DATASET_VERSION}!`);
      return true;
    } catch (err) {
      console.warn('[DatasetMigration] Background dataset migration error:', err);
      return false;
    }
  },

  /**
   * Force refresh all local courses to the latest v5.0 dataset
   */
  async forceRefreshAllCourses(): Promise<void> {
    const catalog = await courseRepository.fetchCatalog();
    const allCatalogCourses = catalog.courses || [];
    const localCourses = await db.courses.toArray();
    const downloadedCourses = localCourses.filter(c => c.isDownloaded);

    // Completely purge old word cache in Dexie
    await db.words.clear();

    if (downloadedCourses.length > 0) {
      for (const downloaded of downloadedCourses) {
        const catalogEntry = allCatalogCourses.find(c => c.id === downloaded.id);
        if (catalogEntry) {
          await courseRepository.downloadAndSaveCourse(catalogEntry.id, catalogEntry.fileName);
        }
      }
    } else if (allCatalogCourses.length > 0) {
      const defaultCourse = allCatalogCourses.find(c => c.id === 'course-core-1200') || allCatalogCourses[0];
      if (defaultCourse) {
        await courseRepository.downloadAndSaveCourse(defaultCourse.id, defaultCourse.fileName);
      }
    }

    await db.appSettings.put({
      key: 'dataset_version',
      value: String(CURRENT_DATASET_VERSION)
    });
  }
};
