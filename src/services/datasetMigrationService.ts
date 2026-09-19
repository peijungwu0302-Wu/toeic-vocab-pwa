import { db } from '../db';
import { courseRepository } from '../repositories/courseRepository';

export const CURRENT_DATASET_VERSION = 17;
export const DATASET_RELEASE_TAG = 'v7.3.0-flagship-all-tiers-consolidated';
export const APP_RELEASE_VERSION = 'v1.3.4 (Rewind Peek & Front Gestures)';

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
   * Automatically migrates local IndexedDB words and courses to current dataset version.
   * Runs silently in the background on App startup without interrupting the user.
   * Guaranteed Atomic & Resilient:
   * - Never clears db.words globally at start
   * - Verifies schema and SHA-256 checksum per course
   * - If any course download/validation fails, existing dataset is completely preserved and version is NOT upgraded
   * - Only marks dataset_version as current when all required courses succeed
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
      if (allCatalogCourses.length === 0) {
        console.warn('[DatasetMigration] Catalog returned 0 courses, aborting upgrade.');
        return false;
      }

      // 2. Find all downloaded courses on this device
      const localCourses = await db.courses.toArray();
      const downloadedCourses = localCourses.filter(c => c.isDownloaded);

      // 3. Determine required courses to migrate
      const requiredTargets: Array<{ id: string; fileName: string; checksum?: string }> = [];

      if (downloadedCourses.length > 0) {
        for (const downloaded of downloadedCourses) {
          const entry = allCatalogCourses.find(c => c.id === downloaded.id);
          if (!entry) {
            console.warn(`[DatasetMigration] Downloaded course ${downloaded.id} not found in catalog, aborting.`);
            return false;
          }
          requiredTargets.push({
            id: entry.id,
            fileName: entry.fileName,
            checksum: entry.checksumSha256 || entry.sha256 || entry.checksum
          });
        }
      } else {
        // Cold install: default to course-core-1200
        const defaultCourse = allCatalogCourses.find(c => c.id === 'course-core-1200') || allCatalogCourses[0];
        requiredTargets.push({
          id: defaultCourse.id,
          fileName: defaultCourse.fileName,
          checksum: defaultCourse.checksumSha256 || defaultCourse.sha256 || defaultCourse.checksum
        });
      }

      // 4. Download and atomically upsert each course without wiping words globally
      for (const target of requiredTargets) {
        try {
          await courseRepository.downloadAndSaveCourse(target.id, target.fileName, target.checksum);
        } catch (courseErr) {
          console.error(`[DatasetMigration] Failed to migrate course ${target.id}:`, courseErr);
          // Halt upgrade immediately: preserve existing valid words and do NOT bump dataset_version
          return false;
        }
      }

      // 5. Only mark dataset as upgraded if ALL required courses succeeded
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
   * Force refresh all local courses to the latest dataset version.
   * Does NOT wipe words before successful download to prevent corrupted/empty state.
   */
  async forceRefreshAllCourses(): Promise<void> {
    const catalog = await courseRepository.fetchCatalog();
    const allCatalogCourses = catalog.courses || [];
    const localCourses = await db.courses.toArray();
    const downloadedCourses = localCourses.filter(c => c.isDownloaded);

    const requiredTargets: Array<{ id: string; fileName: string; checksum?: string }> = [];

    if (downloadedCourses.length > 0) {
      for (const downloaded of downloadedCourses) {
        const entry = allCatalogCourses.find(c => c.id === downloaded.id);
        if (entry) {
          requiredTargets.push({
            id: entry.id,
            fileName: entry.fileName,
            checksum: entry.checksumSha256 || entry.sha256 || entry.checksum
          });
        }
      }
    } else if (allCatalogCourses.length > 0) {
      const defaultCourse = allCatalogCourses.find(c => c.id === 'course-core-1200') || allCatalogCourses[0];
      if (defaultCourse) {
        requiredTargets.push({
          id: defaultCourse.id,
          fileName: defaultCourse.fileName,
          checksum: defaultCourse.checksumSha256 || defaultCourse.sha256 || defaultCourse.checksum
        });
      }
    }

    // Atomic per-course update
    for (const target of requiredTargets) {
      await courseRepository.downloadAndSaveCourse(target.id, target.fileName, target.checksum);
    }

    await db.appSettings.put({
      key: 'dataset_version',
      value: String(CURRENT_DATASET_VERSION)
    });
  }
};
