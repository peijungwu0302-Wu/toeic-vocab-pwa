import { db } from '../db';
import { courseRepository } from '../repositories/courseRepository';

export const CURRENT_DATASET_VERSION = 5;

export const datasetMigrationService = {
  /**
   * Automatically migrates local IndexedDB words and courses to v5 (v5.0.0-llm-bespoke-visual).
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

      // 3. Refresh each downloaded course with the latest v3.0 JSON
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

      // 4. Mark dataset as upgraded to v3
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
   * Force refresh all local courses to the latest v3.0 dataset
   */
  async forceRefreshAllCourses(): Promise<void> {
    const catalog = await courseRepository.fetchCatalog();
    const allCatalogCourses = catalog.courses || [];
    const localCourses = await db.courses.toArray();
    const downloadedCourses = localCourses.filter(c => c.isDownloaded);

    for (const downloaded of downloadedCourses) {
      const catalogEntry = allCatalogCourses.find(c => c.id === downloaded.id);
      if (catalogEntry) {
        await courseRepository.downloadAndSaveCourse(catalogEntry.id, catalogEntry.fileName);
      }
    }

    await db.appSettings.put({
      key: 'dataset_version',
      value: String(CURRENT_DATASET_VERSION)
    });
  }
};
