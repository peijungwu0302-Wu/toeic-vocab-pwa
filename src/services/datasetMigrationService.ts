import { db } from '../db';
import { courseRepository, type ValidatedCourseData } from '../repositories/courseRepository';

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

      // 4. Download and validate ALL required courses in memory first.
      // If ANY single course download or checksum fails, abort immediately without touching DB!
      const validatedList: ValidatedCourseData[] = [];
      for (const target of requiredTargets) {
        try {
          const validated = await courseRepository.downloadAndValidateCourse(target.id, target.fileName, target.checksum);
          validatedList.push(validated);
        } catch (courseErr) {
          console.error(`[DatasetMigration] Failed to download/validate course ${target.id}:`, courseErr);
          // Halt upgrade immediately: ZERO database writes have taken place!
          return false;
        }
      }

      // 5. Commit all validated courses and update version in a SINGLE atomic Dexie transaction
      await db.transaction('rw', [db.courses, db.words, db.courseWords, db.appSettings], async () => {
        for (const item of validatedList) {
          await db.courses.put(item.courseRecord);
          await db.words.bulkPut(item.words);
          await db.courseWords.where('courseId').equals(item.courseRecord.id).delete();
          await db.courseWords.bulkAdd(item.courseWords);
        }

        await db.appSettings.put({
          key: 'dataset_version',
          value: String(CURRENT_DATASET_VERSION)
        });
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
   * True all-or-nothing: pre-validates in memory, then writes in single Dexie transaction.
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

    // Pre-validate all courses in memory
    const validatedList: ValidatedCourseData[] = [];
    for (const target of requiredTargets) {
      const validated = await courseRepository.downloadAndValidateCourse(target.id, target.fileName, target.checksum);
      validatedList.push(validated);
    }

    // Atomic all-or-nothing transaction commit
    await db.transaction('rw', [db.courses, db.words, db.courseWords, db.appSettings], async () => {
      for (const item of validatedList) {
        await db.courses.put(item.courseRecord);
        await db.words.bulkPut(item.words);
        await db.courseWords.where('courseId').equals(item.courseRecord.id).delete();
        await db.courseWords.bulkAdd(item.courseWords);
      }

      await db.appSettings.put({
        key: 'dataset_version',
        value: String(CURRENT_DATASET_VERSION)
      });
    });
  }
};
