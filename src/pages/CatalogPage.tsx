import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DownloadCloud,
  CheckCircle,
  Trash2,
  Repeat,
  Search,
  Loader2,
  AlertCircle,
  Flame,
  ChevronDown,
  ChevronUp,
  Volume2,
  FileText,
  Layers,
  BookOpen,
  Sparkles,
  RefreshCw,
  Zap,
  Image as ImageIcon,
  ImageOff
} from 'lucide-react';
import { courseRepository } from '../repositories/courseRepository';
import { progressRepository } from '../repositories/progressRepository';
import { useProfile } from '../contexts/ProfileContext';
import { CourseSummary, DatasetCatalog } from '../types/vocab';
import { Course, Word } from '../types/db';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { audioService } from '../services/audioService';
import { imageService } from '../services/imageService';

export const CatalogPage: React.FC = () => {
  const { activeProfile, setActiveCourseId } = useProfile();
  const navigate = useNavigate();

  const isMountedRef = useRef(true);
  const loadGenerationRef = useRef(0);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [catalog, setCatalog] = useState<DatasetCatalog | null>(null);
  const [downloadedMap, setDownloadedMap] = useState<Map<string, Course>>(new Map());
  const [progressCountMap, setProgressCountMap] = useState<Map<string, number>>(new Map());
  
  // Dual-Track Mode: 'high_freq' (6 high-yield units) vs 'full_library' (33 granular courses)
  const [catalogMode, setCatalogMode] = useState<'high_freq' | 'full_library'>('high_freq');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [downloadingCourseId, setDownloadingCourseId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEnriching, setIsEnriching] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState(false);
  const [cachingImagesCourseId, setCachingImagesCourseId] = useState<string | null>(null);
  const [cachingProgress, setCachingProgress] = useState<{ current: number; total: number } | null>(null);
  const [cachingSuccessMsg, setCachingSuccessMsg] = useState<string | null>(null);

  // Media estimate confirmation modal
  const [mediaEstimateModal, setMediaEstimateModal] = useState<{
    courseId: string;
    courseTitle: string;
    imageCount: number;
    estimatedBytes: number;
    storageEstimate: { usageBytes: number; quotaBytes: number; usagePercent: number } | null;
  } | null>(null);
  const [deleteMediaModal, setDeleteMediaModal] = useState<{
    courseId: string;
    courseTitle: string;
    cached: number;
    total: number;
  } | null>(null);
  const [isPreparingEstimate, setIsPreparingEstimate] = useState<string | null>(null);
  const [isDeletingMedia, setIsDeletingMedia] = useState<string | null>(null);

  // Offline status map for downloaded courses: courseId -> { total, cached, isFullyCached }
  const [offlineStatusMap, setOfflineStatusMap] = useState<Map<string, { total: number; cached: number; isFullyCached: boolean }>>(new Map());

  // Expanded Unit Words state
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);
  const [courseWordsMap, setCourseWordsMap] = useState<Map<string, Word[]>>(new Map());
  const [loadingWordsCourseId, setLoadingWordsCourseId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    try {
      setIsLoading(true);
      setErrorMessage(null);

      // Phase A: Critical UI - Fetch catalog and downloaded courses in parallel
      const [cat, localCourses] = await Promise.all([
        courseRepository.fetchCatalog(),
        courseRepository.getAll()
      ]);

      if (!isMountedRef.current || generation !== loadGenerationRef.current) return;

      setCatalog(cat);

      const map = new Map<string, Course>();
      localCourses.forEach(c => {
        if (c.isDownloaded) map.set(c.id, c);
      });
      setDownloadedMap(map);

      // Immediately unblock the critical UI
      setIsLoading(false);

      // Phase B: Asynchronous Background Enrichment
      if (activeProfile) {
        const currentProfileId = activeProfile.id;
        // Immediately clear old progressCountMap so Profile B never displays Profile A's old numbers
        setProgressCountMap(new Map());
        setIsEnriching(true);

        (async () => {
          try {
            const studentProgress = await progressRepository.getAllForProfile(currentProfileId);
            if (!isMountedRef.current || generation !== loadGenerationRef.current) return;

            const learnedWordIds = new Set(studentProgress.map(p => p.wordId));
            const downloadedCourses = localCourses.filter(c => c.isDownloaded);

            // Progressive per-course enrichment for progress counts
            for (const c of downloadedCourses) {
              if (!isMountedRef.current || generation !== loadGenerationRef.current) return;
              const courseWords = await courseRepository.getWordsForCourse(c.id);
              if (!isMountedRef.current || generation !== loadGenerationRef.current) return;
              const learnedCount = courseWords.filter(w => learnedWordIds.has(w.id)).length;

              setProgressCountMap(prev => {
                if (!isMountedRef.current || generation !== loadGenerationRef.current) return prev;
                const next = new Map(prev);
                next.set(c.id, learnedCount);
                return next;
              });
            }

            // Progressive per-course enrichment for offline media statuses
            for (const c of downloadedCourses) {
              if (!isMountedRef.current || generation !== loadGenerationRef.current) return;
              const status = await imageService.getCourseOfflineMediaStatus(c.id);
              if (!isMountedRef.current || generation !== loadGenerationRef.current) return;

              setOfflineStatusMap(prev => {
                if (!isMountedRef.current || generation !== loadGenerationRef.current) return prev;
                const next = new Map(prev);
                next.set(c.id, status);
                return next;
              });
            }
          } catch (enrichErr) {
            console.warn('[CatalogPage] Background enrichment non-critical warning:', enrichErr);
          } finally {
            if (isMountedRef.current && generation === loadGenerationRef.current) {
              setIsEnriching(false);
            }
          }
        })();
      }
    } catch (err) {
      console.error('[CatalogPage] Load error:', err);
      if (isMountedRef.current && generation === loadGenerationRef.current) {
        setErrorMessage('無法載入課程清單，請確認網路連線或靜態檔案。');
        setIsLoading(false);
      }
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
    // Prevent orphan offline image cache: must delete media pack first
    const offlineStatus = offlineStatusMap.get(courseId);
    if (offlineStatus && offlineStatus.cached > 0) {
      const msg = '此課程仍有離線圖片包，請先刪除離線圖片包，再清除課程資料快取。';
      setErrorMessage(msg);
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        alert(msg);
      }
      return;
    }

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

  const handleToggleExpand = async (courseId: string) => {
    if (expandedCourseId === courseId) {
      setExpandedCourseId(null);
      return;
    }

    setExpandedCourseId(courseId);
    if (!courseWordsMap.has(courseId)) {
      try {
        setLoadingWordsCourseId(courseId);
        const words = await courseRepository.getWordsForCourse(courseId);
        setCourseWordsMap(prev => new Map(prev).set(courseId, words));
      } catch (err) {
        console.error('[CatalogPage] Failed to fetch course words:', err);
      } finally {
        setLoadingWordsCourseId(null);
      }
    }
  };

  const handleStartReview = async (courseId: string) => {
    await audioService.unlockAudio();
    navigate(`/review?courseId=${courseId}`);
  };

  const handleStartQuiz = async (courseId: string) => {
    await audioService.unlockAudio();
    navigate(`/quiz?courseId=${courseId}`);
  };

  const handleStartSkim = async (courseId: string) => {
    await audioService.unlockAudio();
    navigate(`/skim?courseId=${courseId}`);
  };

  const allCourses = catalog?.courses || [];

  // Detect if any downloaded course is running an older dataset version
  const outdatedCourses = allCourses.filter(c => {
    const downloaded = downloadedMap.get(c.id);
    return Boolean(downloaded) && (downloaded?.version || 1) < (c.version || 3);
  });
  const hasAnyUpdate = outdatedCourses.length > 0;

  const handleSyncAllUpdates = async () => {
    try {
      setIsSyncingAll(true);
      setErrorMessage(null);
      for (const c of outdatedCourses) {
        await courseRepository.downloadAndSaveCourse(c.id, c.fileName);
      }
      await loadData();
      setSyncSuccessMsg(true);
      setTimeout(() => setSyncSuccessMsg(false), 4000);
    } catch (err) {
      console.error('[CatalogPage] Sync all error:', err);
      setErrorMessage(`更新同步失敗：${(err as Error).message}`);
    } finally {
      setIsSyncingAll(false);
    }
  };

  const handleRequestCacheImages = async (courseId: string, courseTitle: string) => {
    try {
      setIsPreparingEstimate(courseId);
      setErrorMessage(null);
      const estimate = await imageService.getCourseMediaEstimate(courseId);
      const storage = await imageService.getStorageEstimate();
      setMediaEstimateModal({
        courseId,
        courseTitle,
        imageCount: estimate.imageCount,
        estimatedBytes: estimate.estimatedBytes,
        storageEstimate: storage
      });
    } catch (err) {
      console.warn('[CatalogPage] Failed to get media estimate:', err);
      setErrorMessage('目前無法取得離線圖片包容量資訊，請稍後再試。');
    } finally {
      setIsPreparingEstimate(null);
    }
  };

  const executeCacheImages = async (courseId: string) => {
    setMediaEstimateModal(null);
    setCachingImagesCourseId(courseId);
    setCachingProgress({ current: 0, total: 0 });
    setCachingSuccessMsg(null);
    try {
      const res = await imageService.cacheCourseImages(courseId, (cached, total) => {
        setCachingProgress({ current: cached, total });
      });
      const status = await imageService.getCourseOfflineMediaStatus(courseId);
      setOfflineStatusMap(prev => new Map(prev).set(courseId, status));

      if (res.failed === 0 && status.isFullyCached) {
        setCachingSuccessMsg(`已成功快取 ${res.cached} 張單字實景圖，離線圖片包完整！`);
      } else if (res.failed > 0) {
        setCachingSuccessMsg(`快取進度：${res.cached}/${res.cached + res.failed} 張，${res.failed} 張失敗，可重試`);
      } else {
        setCachingSuccessMsg(`已快取 ${res.cached} 張圖片（共 ${status.total} 張，離線包部分完成）`);
      }
      setTimeout(() => setCachingSuccessMsg(null), 5000);
    } catch (err) {
      setErrorMessage((err as Error).message || '快取圖片失敗');
    } finally {
      setCachingImagesCourseId(null);
      setCachingProgress(null);
    }
  };

  const handleRequestDeleteMedia = (courseId: string, courseTitle: string) => {
    const status = offlineStatusMap.get(courseId);
    if (!status || status.cached === 0) return;
    setDeleteMediaModal({
      courseId,
      courseTitle,
      cached: status.cached,
      total: status.total
    });
  };

  const executeDeleteMedia = async (courseId: string) => {
    setDeleteMediaModal(null);
    setIsDeletingMedia(courseId);
    try {
      const deletedCount = await imageService.clearCourseOfflineMedia(courseId);
      const updatedStatus = await imageService.getCourseOfflineMediaStatus(courseId);
      setOfflineStatusMap(prev => new Map(prev).set(courseId, updatedStatus));
      setCachingSuccessMsg(`已成功移除 ${deletedCount} 張離線快取圖片，本機單字與學習進度均完整保留！`);
      setTimeout(() => setCachingSuccessMsg(null), 5000);
    } catch (err) {
      setErrorMessage(`刪除圖片包失敗：${(err as Error).message}`);
    } finally {
      setIsDeletingMedia(null);
    }
  };

  // Filter courses by mode
  const displayedCourses = allCourses.filter(c => {
    const isHighFreq =
      c.id.startsWith('course-core') ||
      c.id.startsWith('course-advanced') ||
      c.id.startsWith('course-expert') ||
      c.id.startsWith('course-phrases') ||
      c.id.startsWith('course-foundation-550-part1') ||
      c.id.startsWith('course-intermediate-750-part1') ||
      c.id.startsWith('course-master-990-part1');

    if (catalogMode === 'high_freq' && !isHighFreq) {
      return false;
    }

    const matchesSearch =
      !searchQuery.trim() ||
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.category.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesSearch;
  });

  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-black text-slate-100">TOEIC 題庫與高頻專屬單元</h2>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
            視覺圖解 ＋ 題型練習
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
          收錄多益情境分級單字與題型練習，搭配商務例句與視覺概念生圖，提供繁中解析。
        </p>
      </div>

      {/* Global Version Update Notification Banner */}
      {hasAnyUpdate && (
        <div className="bg-gradient-to-r from-emerald-950/80 to-teal-950/80 border border-emerald-600/70 rounded-2xl p-3.5 flex items-center justify-between shadow-lg shadow-emerald-950/30">
          <div className="flex items-center space-x-2.5 min-w-0 mr-2">
            <span className="p-2 rounded-xl bg-emerald-900/80 text-emerald-300 shrink-0">
              <Sparkles size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-emerald-100 truncate">發現新版精編題庫</p>
              <p className="text-[11px] text-emerald-300/80 truncate">包含專屬題幹翻譯與正解解析，點擊立即同步</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={handleSyncAllUpdates}
            disabled={isSyncingAll}
            className="text-xs shrink-0 font-bold px-3 shadow-md"
          >
            {isSyncingAll ? (
              <>
                <Loader2 size={13} className="animate-spin mr-1" /> 同步中...
              </>
            ) : (
              <>
                <RefreshCw size={13} className="mr-1" /> 一鍵同步
              </>
            )}
          </Button>
        </div>
      )}

      {syncSuccessMsg && (
        <div className="bg-emerald-950/90 border border-emerald-500 rounded-xl p-2.5 text-xs text-emerald-200 text-center font-bold">
          ✅ 題庫已全面同步為最新精編版本！
        </div>
      )}

      {cachingSuccessMsg && (
        <div className="bg-teal-950/90 border border-teal-500 rounded-xl p-2.5 text-xs text-teal-200 text-center font-bold animate-in fade-in duration-200">
          🖼️ {cachingSuccessMsg}
        </div>
      )}

      {/* Dual-Track Mode Toggle */}
      <div className="flex rounded-2xl bg-slate-800/90 p-1 border border-slate-700">
        <button
          type="button"
          onClick={() => setCatalogMode('high_freq')}
          className={`flex-1 py-2.5 rounded-xl font-black text-xs transition-all flex items-center justify-center space-x-1.5 ${
            catalogMode === 'high_freq'
              ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-950/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Flame size={15} />
          <span>🔥 多益必考高頻單元</span>
        </button>

        <button
          type="button"
          onClick={() => setCatalogMode('full_library')}
          className={`flex-1 py-2.5 rounded-xl font-black text-xs transition-all flex items-center justify-center space-x-1.5 ${
            catalogMode === 'full_library'
              ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-950/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers size={15} />
          <span>📚 多益全量分級庫</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="搜尋單元名稱、高頻單字或商務主題..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
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
          <span className="text-xs">正在載入題庫與高頻單元...</span>
        </div>
      ) : displayedCourses.length === 0 ? (
        <div className="bg-slate-800/30 border border-dashed border-slate-700 rounded-2xl p-8 text-center">
          <p className="text-xs text-slate-400">沒有符合搜尋或篩選條件的單元。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayedCourses.map((c) => {
            const isDownloaded = downloadedMap.has(c.id);
            const isDownloading = downloadingCourseId === c.id;
            const hasProgress = progressCountMap.has(c.id);
            const learnedCount = progressCountMap.get(c.id) || 0;
            const progressPercent = c.wordCount > 0 ? Math.round((learnedCount / c.wordCount) * 100) : 0;
            const isExpanded = expandedCourseId === c.id;
            const wordsList = courseWordsMap.get(c.id) || [];
            const isLoadingWords = loadingWordsCourseId === c.id;
            const offlineStatus = offlineStatusMap.get(c.id);
            const isOfflineStatusChecking = isEnriching && !offlineStatus;

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
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">
                        {c.version ? `v${c.version}` : '最新版'}
                      </span>
                      <span className="text-[11px] text-slate-400">{c.category}</span>
                    </div>

                    {isDownloaded ? (
                      <span className="inline-flex items-center text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-full shrink-0">
                        <CheckCircle size={12} className="mr-1" /> 已就緒{c.version ? ` (v${c.version})` : ''}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400 shrink-0">
                        {c.wordCount} 字 · 未下載
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
                      <span>學習進度：{hasProgress ? `${learnedCount} / ${c.wordCount} 字` : '計算中...'}</span>
                      <span className="font-bold text-emerald-400">{hasProgress ? `${progressPercent}%` : '...'}</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
                      <div
                        className={`h-full bg-emerald-500 rounded-full transition-all duration-300 ${!hasProgress ? 'animate-pulse opacity-40 w-1/4' : ''}`}
                        style={{ width: hasProgress ? `${progressPercent}%` : undefined }}
                      />
                    </div>
                  </div>
                )}

                {/* Expand Unit Words Accordion Button */}
                {isDownloaded && (
                  <button
                    type="button"
                    onClick={() => handleToggleExpand(c.id)}
                    className="w-full py-1.5 px-3 rounded-xl bg-slate-900/80 hover:bg-slate-900 border border-slate-700/80 text-slate-300 text-xs font-semibold flex items-center justify-between transition-colors"
                  >
                    <span className="flex items-center space-x-1.5">
                      <BookOpen size={13} className="text-emerald-400" />
                      <span>{isExpanded ? '收合單字清單' : `展開單字清單 (${c.wordCount} 字)`}</span>
                    </span>
                    {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>
                )}

                {/* Expandable Word List Drawer */}
                {isExpanded && (
                  <div className="p-3 rounded-2xl bg-slate-900/95 border border-slate-700/80 space-y-2 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800 pb-1.5">
                      <span className="font-bold text-slate-200">本單元收錄單字 ({wordsList.length} 字)：</span>
                      <span className="text-[10px]">點擊單字可直接試聽發音</span>
                    </div>

                    {isLoadingWords ? (
                      <div className="py-4 text-center text-xs text-slate-400 flex items-center justify-center space-x-2">
                        <Loader2 size={16} className="animate-spin text-emerald-400" />
                        <span>正在載入單字清單...</span>
                      </div>
                    ) : (
                      <div className="max-h-60 overflow-y-auto divide-y divide-slate-800/80 pr-1 space-y-1">
                        {wordsList.map((w, wIdx) => (
                          <div
                            key={w.id || wIdx}
                            className="py-1.5 px-2 rounded-lg hover:bg-slate-800/60 flex items-center justify-between text-xs group transition-colors"
                          >
                            <div className="min-w-0 flex-1 mr-2">
                              <div className="flex items-center space-x-1.5">
                                <span className="font-bold text-slate-100">{w.headword}</span>
                                {w.phoneticUS && (
                                  <span className="text-[10px] font-mono text-emerald-400/90">/{w.phoneticUS}/</span>
                                )}
                                <span className="text-[9px] px-1 rounded bg-slate-800 text-slate-400">{w.partsOfSpeech?.[0]}</span>
                              </div>
                              <p className="text-[11px] text-slate-400 truncate mt-0.5">{w.definitionZh}</p>
                            </div>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                audioService.speakSentence(w.headword);
                              }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors"
                              title="試聽朗讀"
                            >
                              <Volume2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Bottom Actions */}
                <div className="flex items-center justify-between pt-1 border-t border-slate-700/50">
                  <div className="text-[11px] text-slate-400 flex items-center space-x-1.5">
                    <span>{c.wordCount} 字</span>
                    <span>·</span>
                    <span className="text-emerald-400 font-medium">{c.wordCount * 6} 題測驗</span>
                  </div>

                  <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                    {isDownloaded ? (
                      <>
                        {activeProfile?.activeCourseId === c.id ? (
                          <span className="text-[11px] font-bold text-teal-400 bg-teal-950/80 border border-teal-700/60 px-2.5 py-1 rounded-lg inline-flex items-center shrink-0">
                            <CheckCircle size={12} className="mr-1 text-teal-400" /> 今日課程 ✓
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setActiveCourseId(c.id)}
                            className="text-xs px-2.5 text-teal-300 border-teal-700/60 hover:bg-teal-950/40"
                            title="設為今日課程"
                          >
                            <Sparkles size={12} className="mr-1 text-teal-400" /> 設為今日課程
                          </Button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRequestCacheImages(c.id, c.title)}
                          disabled={cachingImagesCourseId === c.id || isPreparingEstimate === c.id}
                          title={
                            offlineStatusMap.get(c.id)?.isFullyCached
                              ? `離線圖片包完整 (${offlineStatusMap.get(c.id)?.cached}/${offlineStatusMap.get(c.id)?.total})`
                              : (offlineStatusMap.get(c.id)?.cached ?? 0) > 0
                              ? `下載離線圖片包 (已快取 ${offlineStatusMap.get(c.id)?.cached}/${offlineStatusMap.get(c.id)?.total})`
                              : '下載離線圖片包'
                          }
                          aria-label="下載離線圖片包"
                          className={`p-2 rounded-lg transition-colors flex items-center space-x-1 ${
                            offlineStatusMap.get(c.id)?.isFullyCached
                              ? 'text-teal-400 hover:text-teal-300 bg-teal-500/10 hover:bg-teal-500/20'
                              : 'text-slate-400 hover:text-teal-300 hover:bg-slate-700/50'
                          }`}
                        >
                          {cachingImagesCourseId === c.id ? (
                            <>
                              <Loader2 size={13} className="animate-spin text-teal-400" />
                              <span className="text-[10px] text-teal-300 font-mono">
                                {cachingProgress ? `${cachingProgress.current}/${cachingProgress.total}` : '...'}
                              </span>
                            </>
                          ) : isPreparingEstimate === c.id ? (
                            <Loader2 size={13} className="animate-spin text-teal-400" />
                          ) : isOfflineStatusChecking ? (
                            <Loader2 size={13} className="animate-spin text-slate-500" />
                          ) : (
                            <ImageIcon size={14} />
                          )}
                        </button>
                        {(offlineStatusMap.get(c.id)?.cached ?? 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => handleRequestDeleteMedia(c.id, c.title)}
                            disabled={isDeletingMedia === c.id || cachingImagesCourseId === c.id}
                            title={`刪除離線圖片包 (已快取 ${offlineStatusMap.get(c.id)?.cached}/${offlineStatusMap.get(c.id)?.total} 張)`}
                            aria-label="刪除離線圖片包"
                            className="p-2 text-slate-400 hover:text-amber-400 rounded-lg hover:bg-slate-700/50 transition-colors"
                          >
                            {isDeletingMedia === c.id ? (
                              <Loader2 size={13} className="animate-spin text-amber-400" />
                            ) : (
                              <ImageOff size={14} />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(c.id)}
                          title="清除課程資料快取"
                          aria-label="清除課程資料快取"
                          className="p-2 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-700/50 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStartSkim(c.id)}
                          className="text-xs px-2.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/40"
                        >
                          <Zap size={13} className="mr-1 text-amber-400" /> 速讀
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStartQuiz(c.id)}
                          className="text-xs px-2.5"
                        >
                          <FileText size={13} className="mr-1 text-blue-400" /> 測驗
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handleStartReview(c.id)}
                          className="text-xs px-3"
                        >
                          <Repeat size={13} className="mr-1" /> 複習
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
                            <DownloadCloud size={14} className="mr-1.5" /> 下載單元
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

      {/* Offline Media Pack Download Confirmation Modal */}
      {mediaEstimateModal && (
        <Modal
          isOpen={Boolean(mediaEstimateModal)}
          onClose={() => setMediaEstimateModal(null)}
          title="下載離線圖片包"
          maxWidth="sm"
        >
          <div className="p-5 space-y-4 text-slate-300 text-xs leading-relaxed">
            <div className="bg-slate-800/80 rounded-xl p-3.5 border border-slate-700/60 space-y-2">
              <div className="text-sm font-bold text-slate-100 truncate">
                {mediaEstimateModal.courseTitle}
              </div>
              <div className="flex justify-between items-center text-slate-300">
                <span>單字實景圖片：</span>
                <span className="font-mono font-bold text-teal-400">{mediaEstimateModal.imageCount} 張</span>
              </div>
              <div className="flex justify-between items-center text-slate-300">
                <span>預估所需容量：</span>
                <span className="font-mono font-bold text-amber-400">
                  約 {(mediaEstimateModal.estimatedBytes / 1024 / 1024).toFixed(1)} MB
                </span>
              </div>
              {mediaEstimateModal.storageEstimate && (
                <div className="pt-2 border-t border-slate-700/50 flex justify-between items-center text-[11px] text-slate-400">
                  <span>瀏覽器空間使用：</span>
                  <span className="font-mono">
                    約 {(mediaEstimateModal.storageEstimate.usageBytes / 1024 / 1024).toFixed(1)} MB / {(mediaEstimateModal.storageEstimate.quotaBytes / 1024 / 1024).toFixed(0)} MB ({mediaEstimateModal.storageEstimate.usagePercent}%)
                  </span>
                </div>
              )}
            </div>

            <p className="text-slate-400 text-[11px]">
              下載完成後，無網路離線狀態下亦可正常瀏覽商務情境圖解。
            </p>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMediaEstimateModal(null)}
              >
                取消
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => executeCacheImages(mediaEstimateModal.courseId)}
                className="bg-teal-600 hover:bg-teal-500 text-white font-bold"
              >
                確認下載
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Offline Media Pack Delete Confirmation Modal */}
      {deleteMediaModal && (
        <Modal
          isOpen={Boolean(deleteMediaModal)}
          onClose={() => setDeleteMediaModal(null)}
          title="刪除離線圖片包"
          maxWidth="sm"
        >
          <div className="p-5 space-y-4 text-slate-300 text-xs leading-relaxed">
            <div className="bg-slate-800/80 rounded-xl p-3.5 border border-slate-700/60 space-y-2">
              <div className="text-sm font-bold text-slate-100 truncate">
                {deleteMediaModal.courseTitle}
              </div>
              <div className="flex justify-between items-center text-slate-300">
                <span>目前已快取圖片：</span>
                <span className="font-mono font-bold text-amber-400">
                  {deleteMediaModal.cached} / {deleteMediaModal.total} 張
                </span>
              </div>
            </div>

            <div className="text-xs space-y-2 text-slate-300">
              <p className="font-semibold text-amber-300">⚠️ 確認事項：</p>
              <ul className="list-disc pl-4 space-y-1 text-slate-400">
                <li>僅釋放本課程已下載之離線圖庫快取空間。</li>
                <li><span className="text-emerald-400 font-medium">絕不刪除</span> 您的任何學習進度、複習紀錄或測驗成績。</li>
                <li><span className="text-emerald-400 font-medium">絕不刪除</span> 本機課程單字資料（仍可正常學習與查閱）。</li>
                <li>若其他已下載課程共用相同單字圖片，共用圖片將自動完整保留。</li>
              </ul>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDeleteMediaModal(null)}
              >
                取消
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => executeDeleteMedia(deleteMediaModal.courseId)}
                className="bg-rose-600 hover:bg-rose-500 text-white font-bold"
              >
                確認刪除圖片包
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
