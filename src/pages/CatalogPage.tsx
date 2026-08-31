import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DownloadCloud,
  CheckCircle,
  Trash2,
  Zap,
  Repeat,
  Search,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { courseRepository } from '../repositories/courseRepository';
import { progressRepository } from '../repositories/progressRepository';
import { useProfile } from '../contexts/ProfileContext';
import { CourseSummary, DatasetCatalog } from '../types/vocab';
import { Course } from '../types/db';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { audioService } from '../services/audioService';

export const CatalogPage: React.FC = () => {
  const { activeProfile } = useProfile();
  const navigate = useNavigate();

  const [catalog, setCatalog] = useState<DatasetCatalog | null>(null);
  const [downloadedMap, setDownloadedMap] = useState<Map<string, Course>>(new Map());
  const [progressCountMap, setProgressCountMap] = useState<Map<string, number>>(new Map());
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [downloadingCourseId, setDownloadingCourseId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);

      // 1. Fetch catalog
      const cat = await courseRepository.fetchCatalog();
      setCatalog(cat);

      // 2. Fetch downloaded courses
      const localCourses = await courseRepository.getAll();
      const map = new Map<string, Course>();
      localCourses.forEach(c => {
        if (c.isDownloaded) map.set(c.id, c);
      });
      setDownloadedMap(map);

      // 3. Fetch student's progress counts per course if profile exists
      if (activeProfile) {
        const studentProgress = await progressRepository.getAllForProfile(activeProfile.id);
        const learnedWordIds = new Set(studentProgress.map(p => p.wordId));

        // For downloaded courses, count learned
        const countMap = new Map<string, number>();
        for (const c of localCourses) {
          if (c.isDownloaded) {
            const courseWords = await courseRepository.getWordsForCourse(c.id);
            const learnedCount = courseWords.filter(w => learnedWordIds.has(w.id)).length;
            countMap.set(c.id, learnedCount);
          }
        }
        setProgressCountMap(countMap);
      }
    } catch (err) {
      console.error('[CatalogPage] Load error:', err);
      setErrorMessage('無法載入課程清單，請確認網路連線或靜態檔案。');
    } finally {
      setIsLoading(false);
    }
  }, [activeProfile]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDownload = async (courseSummary: CourseSummary) => {
    try {
      setDownloadingCourseId(courseSummary.id);
      setErrorMessage(null);
      await courseRepository.downloadAndSaveCourse(courseSummary.id, courseSummary.fileName);
      await loadData();
    } catch (err) {
      console.error('[CatalogPage] Download error:', err);
      setErrorMessage(`下載失敗：${(err as Error).message}`);
    } finally {
      setDownloadingCourseId(null);
    }
  };

  const handleDelete = async (courseId: string) => {
    if (!confirm('確定要清除此課程的離線單字快取嗎？（已記錄的個人學習進度不會遺失，再次下載後可復原）')) {
      return;
    }
    try {
      await courseRepository.removeCourseCache(courseId);
      await loadData();
    } catch (err) {
      console.error('[CatalogPage] Delete error:', err);
    }
  };

  const handleStartReview = async (courseId: string) => {
    await audioService.unlockAudio();
    navigate(`/review?courseId=${courseId}`);
  };

  const handleStartSkim = async (courseId: string) => {
    await audioService.unlockAudio();
    navigate(`/skim?courseId=${courseId}`);
  };

  const filterOptions = [
    { key: 'all', label: '全部' },
    { key: '400-600', label: '400-600' },
    { key: '600-780', label: '600-780' },
    { key: '780-900', label: '780-900' },
    { key: '片語句型', label: '片語句型' }
  ];

  const filteredCourses = (catalog?.courses || []).filter(c => {
    const matchesFilter =
      selectedFilter === 'all' ||
      c.toeicScoreRange === selectedFilter ||
      c.category.includes(selectedFilter);

    const matchesSearch =
      !searchQuery.trim() ||
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-black text-slate-100">TOEIC 分級課程題庫</h2>
        <p className="text-xs text-slate-400 mt-1">
          共收錄 11,000+ 多益高頻詞彙，按需下載至 iPhone 離線學習。
        </p>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="搜尋課程名稱、單字或主題..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      {/* Filter Tabs */}
      <div className="flex space-x-1.5 overflow-x-auto pb-1 scrollbar-none">
        {filterOptions.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setSelectedFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
              selectedFilter === f.key
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/60'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="bg-rose-950/50 border border-rose-800/80 rounded-xl p-3 text-xs text-rose-300 flex items-center space-x-2">
          <AlertCircle size={16} className="shrink-0 text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-400 flex flex-col items-center">
          <Loader2 className="animate-spin text-emerald-400 mb-2" size={28} />
          <span className="text-xs">正在載入課程目錄...</span>
        </div>
      ) : filteredCourses.length === 0 ? (
        <div className="bg-slate-800/30 border border-dashed border-slate-700 rounded-2xl p-8 text-center">
          <p className="text-xs text-slate-400">沒有符合搜尋或篩選條件的課程。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredCourses.map((c) => {
            const isDownloaded = downloadedMap.has(c.id);
            const isDownloading = downloadingCourseId === c.id;
            const learnedCount = progressCountMap.get(c.id) || 0;
            const progressPercent = c.wordCount > 0 ? Math.round((learnedCount / c.wordCount) * 100) : 0;
            const sizeKb = c.sizeBytes ? (c.sizeBytes / 1024).toFixed(0) : '900';

            return (
              <div
                key={c.id}
                className="bg-slate-800/70 border border-slate-700/70 hover:border-slate-600 rounded-2xl p-4 shadow-sm transition-all space-y-3"
              >
                {/* Top badges & title */}
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                      <Badge variant="blue">{c.toeicScoreRange}</Badge>
                      <Badge variant="emerald">{c.level}</Badge>
                      <span className="text-[11px] text-slate-400">{c.category}</span>
                    </div>

                    {isDownloaded ? (
                      <span className="inline-flex items-center text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-full shrink-0">
                        <CheckCircle size={12} className="mr-1" /> 已就緒
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400 shrink-0">
                        約 {sizeKb} KB
                      </span>
                    )}
                  </div>

                  <h3 className="text-sm font-bold text-slate-100 mt-2">{c.title}</h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{c.description}</p>
                </div>

                {/* Progress bar if downloaded */}
                {isDownloaded && (
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                      <span>學習進度：{learnedCount} / {c.wordCount} 字</span>
                      <span className="font-bold text-emerald-400">{progressPercent}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Bottom Actions */}
                <div className="flex items-center justify-between pt-1 border-t border-slate-700/50">
                  <div className="text-[11px] text-slate-400">
                    {c.wordCount} 個詞條
                  </div>

                  <div className="flex items-center space-x-2">
                    {isDownloaded ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleDelete(c.id)}
                          title="清除快取"
                          aria-label="清除快取"
                          className="p-2 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-700/50 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
                        >
                          <Trash2 size={15} />
                        </button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStartSkim(c.id)}
                        >
                          <Zap size={14} className="mr-1 text-blue-400" /> 速讀
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handleStartReview(c.id)}
                        >
                          <Repeat size={14} className="mr-1" /> 複習
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={isDownloading}
                        onClick={() => handleDownload(c)}
                        className="min-w-[110px]"
                      >
                        {isDownloading ? (
                          <>
                            <Loader2 size={14} className="mr-1.5 animate-spin" /> 下載中...
                          </>
                        ) : (
                          <>
                            <DownloadCloud size={14} className="mr-1.5" /> 下載課程
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
