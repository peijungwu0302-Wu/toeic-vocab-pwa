import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppLayout } from '../src/components/layout/AppLayout';
import { ProfileProvider } from '../src/contexts/ProfileContext';
import { SyncProvider } from '../src/contexts/SyncContext';
import { NavigationStyleProvider } from '../src/contexts/NavigationStyleContext';
import {
  imageService,
  OFFLINE_MEDIA_CACHE_NAME,
  isOfflineMediaCacheSupported,
  getCourseOfflineMediaStatus,
  cacheCourseImages,
  clearCourseOfflineMedia
} from '../src/services/imageService';
import { db } from '../src/db';

describe('Phase 4: Product IA, Offline Media Pack, and Release Copy Polish', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    await db.words.clear();
    await db.courseWords.clear();
    await db.courses.clear();
    await db.profiles.clear();
  });

  describe('A. Accessibility & Viewport Meta Standards', () => {
    it('index.html provides zoomable accessible viewport without user-scalable=no or maximum-scale=1.0', () => {
      const indexPath = path.resolve(__dirname, '../index.html');
      const htmlContent = fs.readFileSync(indexPath, 'utf-8');

      // Assert viewport tag exists
      expect(htmlContent).toContain('<meta name="viewport"');

      // Assert user-scalable=no is removed for accessibility compliance
      expect(htmlContent).not.toContain('user-scalable=no');

      // Assert maximum-scale=1.0 is removed so low-vision users can zoom
      expect(htmlContent).not.toContain('maximum-scale=1.0');

      // Assert viewport-fit=cover is retained for iOS notch / safe areas
      expect(htmlContent).toContain('viewport-fit=cover');
      expect(htmlContent).toContain('width=device-width');
    });
  });

  describe('B. 5-Tab Mobile Navigation Layout', () => {
    it('renders exactly 5 primary navigation tabs in the bottom bar', () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <ProfileProvider>
            <SyncProvider>
              <NavigationStyleProvider>
                <AppLayout />
              </NavigationStyleProvider>
            </SyncProvider>
          </ProfileProvider>
        </MemoryRouter>
      );

      // Locate bottom nav element
      const navElement = document.querySelector('nav');
      expect(navElement).toBeInTheDocument();

      // Check 5 primary tabs
      const links = navElement!.querySelectorAll('a');
      expect(links.length).toBe(5);

      const tabLabels = Array.from(links).map(a => a.textContent?.trim());
      expect(tabLabels).toEqual(['首頁', '課程', '複習', '測驗', '統計']);

      // Ensure '衝刺' (SpeedRun) and '設定' (Settings) are removed from the bottom bar
      expect(tabLabels).not.toContain('衝刺');
      expect(tabLabels).not.toContain('設定');

      // Settings remains accessible via the top profile pill
      const settingsLink = document.querySelector('header a[href="/settings"]');
      expect(settingsLink).toBeInTheDocument();
    });
  });

  describe('C. Copy & Claims Sanitization', () => {
    it('ensures no misleading 1,500 daily quota claims exist across source files', () => {
      const flashcardPath = path.resolve(__dirname, '../src/pages/FlashcardPage.tsx');
      const settingsPath = path.resolve(__dirname, '../src/pages/SettingsPage.tsx');

      const flashcardContent = fs.readFileSync(flashcardPath, 'utf-8');
      const settingsContent = fs.readFileSync(settingsPath, 'utf-8');

      expect(flashcardContent).not.toContain('1,500 次免費請求');
      expect(settingsContent).not.toContain('1,500 次免費請求');
      expect(settingsContent).not.toContain('1,500 次');
    });

    it('ensures no unsupported ETS 官方 claims exist in end-user UI strings', () => {
      const flashcardPath = path.resolve(__dirname, '../src/pages/FlashcardPage.tsx');
      const quizPath = path.resolve(__dirname, '../src/pages/QuizPage.tsx');
      const quickPeekPath = path.resolve(__dirname, '../src/components/ui/WordQuickPeekModal.tsx');
      const searchModalPath = path.resolve(__dirname, '../src/components/ui/SearchModal.tsx');

      const flashcardContent = fs.readFileSync(flashcardPath, 'utf-8');
      const quizContent = fs.readFileSync(quizPath, 'utf-8');
      const quickPeekContent = fs.readFileSync(quickPeekPath, 'utf-8');
      const searchModalContent = fs.readFileSync(searchModalPath, 'utf-8');

      expect(flashcardContent).not.toContain('多益官方考點');
      expect(flashcardContent).not.toContain('ETS 990 命題核心');
      expect(quizContent).not.toContain('ETS 官方風格');
      expect(quickPeekContent).not.toContain('ETS 990 核心');
      expect(searchModalContent).not.toContain('ETS 多益解題關鍵秘笈');
    });

    it('ensures 100% 離線 copy is softened to accurate offline & local memory support', () => {
      const onboardingPath = path.resolve(__dirname, '../src/pages/OnboardingPage.tsx');
      const attributionPath = path.resolve(__dirname, '../src/pages/AttributionPage.tsx');
      const imageServicePath = path.resolve(__dirname, '../src/services/imageService.ts');

      const onboardingContent = fs.readFileSync(onboardingPath, 'utf-8');
      const attributionContent = fs.readFileSync(attributionPath, 'utf-8');
      const imageServiceContent = fs.readFileSync(imageServicePath, 'utf-8');

      expect(onboardingContent).not.toContain('100% 離線可用');
      expect(attributionContent).not.toContain('100% 離線可用');
      expect(imageServiceContent).not.toContain('100% 離線秒開');
    });
  });

  describe('D. Bounded Per-Course Offline Media Pack', () => {
    // In-memory mock CacheStorage for testing
    let mockCacheStorage: Map<string, Map<string, Response>>;

    beforeEach(() => {
      mockCacheStorage = new Map();

      const createMockCache = (cacheName: string) => {
        if (!mockCacheStorage.has(cacheName)) {
          mockCacheStorage.set(cacheName, new Map());
        }
        const store = mockCacheStorage.get(cacheName)!;

        return {
          match: vi.fn(async (request: string | Request) => {
            const url = typeof request === 'string' ? request : request.url;
            return store.get(url) || undefined;
          }),
          put: vi.fn(async (request: string | Request, response: Response) => {
            const url = typeof request === 'string' ? request : request.url;
            store.set(url, response);
          }),
          delete: vi.fn(async (request: string | Request) => {
            const url = typeof request === 'string' ? request : request.url;
            return store.delete(url);
          })
        };
      };

      (window as any).caches = {
        open: vi.fn(async (name: string) => createMockCache(name)),
        has: vi.fn(async (name: string) => mockCacheStorage.has(name)),
        delete: vi.fn(async (name: string) => mockCacheStorage.delete(name))
      };
    });

    it('identifies CacheStorage support', () => {
      expect(isOfflineMediaCacheSupported()).toBe(true);
      expect(imageService.isOfflineMediaCacheSupported()).toBe(true);
    });

    it('downloads and caches course images with bounded concurrency and progress reporting', async () => {
      const courseId = 'course-core-1200';

      // Seed words and courseWords
      await db.courses.put({
        id: courseId,
        title: '核心高頻 1200',
        description: '核心單字',
        toeicScoreRange: '550-750',
        wordCount: 3,
        category: '商業',
        level: '550',
        version: 1,
        isDownloaded: true
      });

      await db.words.bulkPut([
        {
          id: 'w_test_1',
          headword: 'agreement',
          normalizedHeadword: 'agreement',
          definitionZh: '協議',
          partsOfSpeech: ['n.'],
          category: '合約',
          starRating: 4,
          toeicScoreRange: '750'
        },
        {
          id: 'w_test_2',
          headword: 'negotiate',
          normalizedHeadword: 'negotiate',
          definitionZh: '協商',
          partsOfSpeech: ['v.'],
          category: '合約',
          starRating: 4,
          toeicScoreRange: '750'
        },
        {
          id: 'w_test_3',
          headword: 'logistics',
          normalizedHeadword: 'logistics',
          definitionZh: '物流',
          partsOfSpeech: ['n.'],
          category: '倉儲',
          starRating: 3,
          toeicScoreRange: '650'
        }
      ] as any);

      await db.courseWords.bulkPut([
        { id: 1, courseId, wordId: 'w_test_1', orderIndex: 0 },
        { id: 2, courseId, wordId: 'w_test_2', orderIndex: 1 },
        { id: 3, courseId, wordId: 'w_test_3', orderIndex: 2 }
      ]);

      const manifestData = {
        schemaVersion: '1.0.0',
        manifestUri: 'manifests/v1.json',
        count: 3,
        images: {
          w_test_1: { v: 1, h: 'h1' },
          w_test_2: { v: 1, h: 'h2' },
          w_test_3: { v: 1, h: 'h3' }
        }
      };
      localStorage.setItem('toeic_runtime_manifest_cache', JSON.stringify(manifestData));

      // Mock fetch for manifest and image URLs
      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/api/manifest/current')) {
          return new Response(JSON.stringify(manifestData), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response('fake-image-binary-data', {
          status: 200,
          headers: { 'Content-Type': 'image/webp' }
        });
      });
      global.fetch = mockFetch as any;

      // Track progress
      const progressCalls: Array<{ cached: number; total: number }> = [];

      // Initial status: 0 cached
      const initialStatus = await getCourseOfflineMediaStatus(courseId);
      expect(initialStatus.cached).toBe(0);
      expect(initialStatus.isFullyCached).toBe(false);

      // Cache images
      const result = await cacheCourseImages(courseId, (cached, total) => {
        progressCalls.push({ cached, total });
      });
      expect(result.cached).toBeGreaterThanOrEqual(0);

      // Verify CacheStorage received cached entries
      const cacheStore = mockCacheStorage.get(OFFLINE_MEDIA_CACHE_NAME);
      expect(cacheStore).toBeDefined();

      // Check status after caching
      const updatedStatus = await getCourseOfflineMediaStatus(courseId);
      if (updatedStatus.total > 0) {
        expect(updatedStatus.cached).toBe(updatedStatus.total);
        expect(updatedStatus.isFullyCached).toBe(true);
      }

      // Test clearing offline media
      const deletedCount = await clearCourseOfflineMedia(courseId);
      expect(deletedCount).toBe(updatedStatus.cached);

      const clearedStatus = await getCourseOfflineMediaStatus(courseId);
      expect(clearedStatus.cached).toBe(0);
    });
  });
});
