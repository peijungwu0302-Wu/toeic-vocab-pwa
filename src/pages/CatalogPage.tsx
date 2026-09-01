import React, { useEffect, useState, useCallback } from 'react';
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
  RefreshCw
} from 'lucide-react';
import { courseRepository } from '../repositories/courseRepository';
import { progressRepository } from '../repositories/progressRepository';
import { useProfile } from '../contexts/ProfileContext';
import { CourseSummary, DatasetCatalog } from '../types/vocab';
import { Course, Word } from '../types/db';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { audioService } from '../services/audioService';

export const CatalogPage: React.FC = () => {
  const { activeProfile } = useProfile();
  const navigate = useNavigate();

  const [catalog, setCatalog] = useState<DatasetCatalog | null>(null);
  const [downloadedMap, setDownloadedMap] = useState<Map<string, Course>>(new Map());
  const [progressCountMap, setProgressCountMap] = useState<Map<string, number>>(new Map());
  
  // Dual-Track Mode: 'high_freq' (6 high-yield units) vs 'full_library' (33 granular courses)
  const [catalogMode, setCatalogMode] = useState<'high_freq' | 'full_library'>('high_freq');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [downloadingCourseId, setDownloadingCourseId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState(false);

  // Expanded Unit Words state
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);
  const [courseWordsMap, setCourseWordsMap] = useState<Map<string, Word[]>>(new Map());
  const [loadingWordsCourseId, setLoadingWordsCourseId] = useState<string | null>(null);

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

      // 3. Fetch student's progress counts per course
      if (activeProfile) {
        const studentProgress = await progressRepository.getAllForProfile(activeProfile.id);
        const learnedWordIds = new Set(studentProgress.map(p => p.wordId));

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
            🟢 v5.0.0 視覺圖 ＋ 3+3 全真題庫
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
          收錄全庫 <strong className="text-emerald-400">11,154 字</strong> 與 <strong className="text-amber-400">66,924 題大模型全真測驗</strong> ＋ <strong className="text-teal-300">33,462 句商務例句與視覺生圖錨點</strong>，全面通過 7 重語法門禁質檢與 1:1 繁中中譯。
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
              <p className="text-xs font-bold text-emerald-100 truncate">發現全新精編真題庫（v3 最新版）</p>
              <p className="text-[11px] text-emerald-300/80 truncate">包含 1:1 專屬題幹翻譯與唯一正解校正，點擊立即同步</p>
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
          <span>📚 11,154 字全量分級庫</span>
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
            const learnedCount = progressCountMap.get(c.id) || 0;
            const progressPercent = c.wordCount > 0 ? Math.round((learnedCount / c.wordCount) * 100) : 0;
            const isExpanded = expandedCourseId === c.id;
            const wordsList = courseWordsMap.get(c.id) || [];
            const isLoadingWords = loadingWordsCourseId === c.id;

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
                        {c.version ? `${c.version} 精編` : 'v3 精編'}
                      </span>
                      <span className="text-[11px] text-slate-400">{c.category}</span>
                    </div>

                    {isDownloaded ? (
                      <span className="inline-flex items-center text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-full shrink-0">
                        <CheckCircle size={12} className="mr-1" /> 已就緒 (v3.0)
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

                  <div className="flex items-center space-x-1.5">
                    {isDownloaded ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleDelete(c.id)}
                          title="清除快取"
                          aria-label="清除快取"
                          className="p-2 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-700/50 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
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
    </div>
  );
};
