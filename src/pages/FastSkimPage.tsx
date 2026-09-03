import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  Settings2,
  X,
  Shuffle,
  ListFilter,
  Star,
  Repeat,
  Volume2,
  Sparkles,
  Image as ImageIcon,
  ImageOff
} from 'lucide-react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { useProfile } from '../contexts/ProfileContext';
import { useTypography } from '../contexts/TypographyContext';
import { courseRepository } from '../repositories/courseRepository';
import { progressRepository } from '../repositories/progressRepository';
import { Word } from '../types/db';
import { AudioButton } from '../components/ui/AudioButton';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { audioService } from '../services/audioService';
import { imageService } from '../services/imageService';

export const FastSkimPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { activeProfile, updateProfile } = useProfile();
  const { settings, updateSettings, headwordClass, definitionClass, exampleEnClass, exampleZhClass, supportingClass, zoomIn, zoomOut, currentPreset } = useTypography();

  const courseId = searchParams.get('courseId');

  const [allWords, setAllWords] = useState<Word[]>([]);
  const [activeWords, setActiveWords] = useState<Word[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [durationSec, setDurationSec] = useState(settings.fastSkimDurationSec || 1.5);
  const [remainingTime, setRemainingTime] = useState(durationSec);
  const [showImage, setShowImage] = useState(settings.fastSkimShowImage !== false);
  const [isLoading, setIsLoading] = useState(true);

  // Micro-session & Filters
  const [batchSize, setBatchSize] = useState<number>(20); // 15, 20, 30, 999 (all)
  const [currentBatchIndex, setCurrentBatchIndex] = useState<number>(0);
  const [isShuffle, setIsShuffle] = useState<boolean>(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [showRecapModal, setShowRecapModal] = useState<boolean>(false);
  const [starredWordIds, setStarredWordIds] = useState<Set<string>>(new Set());
  const [resumedNotice, setResumedNotice] = useState<string | null>(null);
  const [showProgressPopover, setShowProgressPopover] = useState<boolean>(false);
  const [imgFailed, setImgFailed] = useState(false);

  const timerRef = useRef<number | null>(null);

  // Load words & categories with Session Persistence
  const loadWords = useCallback(async () => {
    if (!activeProfile) return;
    try {
      setIsLoading(true);
      let loadedWords: Word[] = [];

      if (courseId) {
        loadedWords = await courseRepository.getWordsForCourse(courseId, {
          category: selectedCategory,
          shuffle: isShuffle
        });
      } else {
        loadedWords = await courseRepository.getAllDownloadedWords({
          category: selectedCategory,
          shuffle: isShuffle
        });
      }

      // Fallback: Auto-download course-core-1200 if local DB is clean
      if (loadedWords.length === 0) {
        try {
          await courseRepository.downloadAndSaveCourse('course-core-1200', 'course-core-1200.json');
          if (courseId) {
            loadedWords = await courseRepository.getWordsForCourse(courseId, {
              category: selectedCategory,
              shuffle: isShuffle
            });
          } else {
            loadedWords = await courseRepository.getAllDownloadedWords({
              category: selectedCategory,
              shuffle: isShuffle
            });
          }
        } catch (autoErr) {
          console.warn('[FastSkim] Auto-download fallback error:', autoErr);
        }
      }

      setAllWords(loadedWords);

      // Check saved session in localStorage (valid for 24 hours)
      const sessionKey = `toeic_active_skim_${courseId || 'all'}`;
      let restoredIndex = 0;
      let restoredBatch = 0;
      try {
        const raw = localStorage.getItem(sessionKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
            restoredIndex = parsed.currentIndex || 0;
            restoredBatch = parsed.currentBatchIndex || 0;
          }
        }
      } catch {}

      const batchStart = restoredBatch * batchSize;
      const initialBatch = batchSize >= 999 ? loadedWords : loadedWords.slice(batchStart, batchStart + batchSize);
      setActiveWords(initialBatch);

      if (restoredIndex > 0 && restoredIndex < initialBatch.length) {
        setCurrentIndex(restoredIndex);
        setCurrentBatchIndex(restoredBatch);
        setResumedNotice(`已為您恢復進度：第 ${restoredIndex + 1} / ${initialBatch.length} 詞 ↩️`);
        setShowProgressPopover(true);
      } else {
        setCurrentIndex(0);
        setCurrentBatchIndex(0);
      }
      setShowRecapModal(false);

      const cats = await courseRepository.getDownloadedCategories();
      setAvailableCategories(cats);
    } catch (err) {
      console.error('[FastSkim] Load words error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [courseId, activeProfile, selectedCategory, isShuffle, batchSize]);

  useEffect(() => {
    loadWords();
  }, [loadWords]);

  // Audio auto-play when card changes
  const playCurrentCardAudio = useCallback(async (word: Word) => {
    if (!activeProfile || activeProfile.isMuted || !activeProfile.autoPlayAudio) return;
    await audioService.playWord({
      headword: word.headword,
      audioUrl: word.audioUSUrl || word.audioUKUrl,
      accent: activeProfile.preferredAccent,
      isMuted: activeProfile.isMuted
    });
  }, [activeProfile]);

  // Auto-save session progress
  useEffect(() => {
    if (activeWords.length > 0 && !isLoading) {
      const sessionKey = `toeic_active_skim_${courseId || 'all'}`;
      try {
        localStorage.setItem(sessionKey, JSON.stringify({
          currentIndex,
          currentBatchIndex,
          timestamp: Date.now()
        }));
      } catch {}
    }
  }, [currentIndex, currentBatchIndex, activeWords.length, isLoading, courseId]);

  const handleRestartFromBeginning = () => {
    const sessionKey = `toeic_active_skim_${courseId || 'all'}`;
    try { localStorage.removeItem(sessionKey); } catch {}
    setCurrentIndex(0);
    setRemainingTime(durationSec);
    setResumedNotice(null);
  };

  const handleBatchComplete = useCallback(() => {
    const sessionKey = `toeic_active_skim_${courseId || 'all'}`;
    try { localStorage.removeItem(sessionKey); } catch {}
    setIsPaused(true);
    setShowRecapModal(true);
  }, [courseId]);

  const goToNext = useCallback(() => {
    if (activeWords.length === 0) return;
    if (currentIndex < activeWords.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setRemainingTime(durationSec);
    } else {
      handleBatchComplete();
    }
  }, [currentIndex, activeWords.length, durationSec, handleBatchComplete]);

  const goToPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      setRemainingTime(durationSec);
    }
  }, [currentIndex, durationSec]);

  // Play audio on new card
  useEffect(() => {
    if (activeWords.length > 0 && activeWords[currentIndex] && !showRecapModal) {
      playCurrentCardAudio(activeWords[currentIndex]);
    }
  }, [currentIndex, activeWords, showRecapModal, playCurrentCardAudio]);

  // Timer loop with background tab freeze protection
  useEffect(() => {
    if (isPaused || isLoading || showRecapModal || activeWords.length === 0) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const interval = 100; // update progress every 100ms
    timerRef.current = window.setInterval(() => {
      if (document.hidden) return;

      setRemainingTime((prev) => {
        if (prev <= 0.1) {
          goToNext();
          return durationSec;
        }
        return Math.max(0, prev - 0.1);
      });
    }, interval);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, isLoading, showRecapModal, activeWords.length, durationSec, goToNext]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPaused(prev => !prev);
      } else if (e.code === 'ArrowRight') {
        goToNext();
      } else if (e.code === 'ArrowLeft') {
        goToPrev();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToNext, goToPrev]);

  // Triple-layer scroll reset to top on word change
  useEffect(() => {
    setImgFailed(false);
    requestAnimationFrame(() => {
      document.querySelector('main')?.scrollTo({ top: 0, behavior: 'instant' });
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  }, [currentIndex]);

  useEffect(() => {
    if (resumedNotice || showProgressPopover) {
      const t = setTimeout(() => {
        setResumedNotice(null);
        setShowProgressPopover(false);
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [resumedNotice, showProgressPopover]);

  const handleDurationChange = async (newSec: number) => {
    setDurationSec(newSec);
    setRemainingTime(newSec);
    if (activeProfile) {
      await updateProfile({ fastSkimDurationSec: newSec });
    }
  };

  const handleNextBatch = () => {
    const nextStart = (currentBatchIndex + 1) * batchSize;
    if (nextStart >= allWords.length) {
      // Reached total end, restart from beginning
      setCurrentBatchIndex(0);
      setActiveWords(allWords.slice(0, batchSize));
    } else {
      setCurrentBatchIndex(prev => prev + 1);
      setActiveWords(allWords.slice(nextStart, nextStart + batchSize));
    }
    setCurrentIndex(0);
    setRemainingTime(durationSec);
    setShowRecapModal(false);
    setIsPaused(false);
  };

  const handleToggleStarWord = async (wordId: string) => {
    if (!activeProfile) return;
    const isNowStarred = await progressRepository.toggleStarred(activeProfile.id, wordId);
    setStarredWordIds(prev => {
      const next = new Set(prev);
      if (isNowStarred) next.add(wordId);
      else next.delete(wordId);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="text-center py-16 text-slate-400">
        <p className="text-xs">正在載入速讀單字庫...</p>
      </div>
    );
  }

  if (allWords.length === 0) {
    return (
      <div className="bg-slate-800/40 border border-slate-700/80 rounded-3xl p-8 text-center space-y-4 max-w-sm mx-auto mt-6">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
          <Settings2 size={26} />
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-100">尚未下載課程或無符合單字</h3>
          <p className="text-xs text-slate-400 mt-1">請先至「課程」頁面下載題庫，或更換分類篩選。</p>
        </div>
        <Button size="md" variant="primary" onClick={() => navigate('/catalog')}>
          前往課程題庫庫
        </Button>
      </div>
    );
  }

  const currentWord = activeWords[currentIndex] || activeWords[0];
  const progressPercent = Math.min(100, Math.max(0, ((durationSec - remainingTime) / durationSec) * 100));

  return (
    <div className="flex flex-col h-full justify-between max-w-md mx-auto space-y-1.5 pb-1 select-none touch-pan-y overscroll-y-contain">
      {/* Top Filter & Micro-session Bar */}
      <div className="relative z-50 space-y-1.5 shrink-0">
        <div className="flex items-center justify-between bg-slate-800/85 backdrop-blur-md border border-slate-750 rounded-2xl px-2.5 py-1 shadow-sm">
          <div className="flex items-center space-x-1.5">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="p-1 rounded-full text-slate-400 hover:text-slate-100 hover:bg-slate-700/60 transition-colors"
              aria-label="退出速讀"
              title="退出速讀"
            >
              <X size={16} />
            </button>

            {/* Interactive Progress Pill */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowProgressPopover(prev => !prev)}
                className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-600/60 text-emerald-300 font-bold text-[11px] shadow-sm transition-all active:scale-95 cursor-pointer"
                title="點擊查看進度與重新開始"
              >
                <span>{currentIndex + 1}</span>
                <span className="text-emerald-500/70">/</span>
                <span>{activeWords.length}</span>
                <span className="text-[8px] text-emerald-400/80 ml-0.5">▾</span>
              </button>

              {/* Anchored Progress Popover (Floats cleanly over card & image) */}
              <AnimatePresence>
                {(resumedNotice || showProgressPopover) && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-0 mt-2.5 z-[100] min-w-[210px] p-3 rounded-2xl bg-slate-900/98 border border-emerald-500/60 shadow-2xl shadow-black/90 backdrop-blur-xl flex flex-col space-y-2"
                  >
                    <div className="absolute -top-1.5 left-6 w-3 h-3 bg-slate-900 border-t border-l border-emerald-500/60 transform rotate-45" />

                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-emerald-300 flex items-center">
                        <Sparkles size={12} className="mr-1 text-emerald-400" />
                        速讀進度
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setResumedNotice(null);
                          setShowProgressPopover(false);
                        }}
                        className="text-slate-400 hover:text-slate-200 p-0.5"
                      >
                        <X size={13} />
                      </button>
                    </div>

                    <p className="text-[11px] text-slate-300 leading-tight">
                      {resumedNotice || `目前進度：第 ${currentIndex + 1} / ${activeWords.length} 詞`}
                    </p>

                    <div className="flex items-center space-x-2 pt-1 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={() => {
                          handleRestartFromBeginning();
                          setResumedNotice(null);
                          setShowProgressPopover(false);
                        }}
                        className="flex-1 py-1 px-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-white text-[11px] font-bold transition-colors text-center shadow-sm"
                      >
                        從第 1 詞開始 ↺
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <span className="text-[10px] text-slate-400">
              (第 {currentBatchIndex + 1} 節)
            </span>
          </div>

          <div className="flex items-center space-x-1">
            {/* Shuffle toggle */}
            <button
              type="button"
              onClick={() => setIsShuffle(prev => !prev)}
              aria-label={isShuffle ? '隨機洗牌已開啟' : '順序模式'}
              className={`p-1.5 rounded-lg text-xs font-semibold transition-colors ${
                isShuffle ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40' : 'bg-slate-900 text-slate-400 border border-slate-700/70'
              }`}
              title={isShuffle ? '隨機洗牌中' : '字母順序'}
            >
              <Shuffle size={13} />
            </button>

            {/* Batch size selector */}
            <select
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              aria-label="每小節單字量"
              className="px-1.5 py-0.5 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200 font-bold focus:outline-none"
            >
              <option value={15}>15字</option>
              <option value={20}>20字</option>
              <option value={30}>30字</option>
              <option value={999}>全部</option>
            </select>

            {/* Quick Font Size Stepper (A- / A+) */}
            <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded-lg px-1 py-0.5 space-x-0.5">
              <button
                type="button"
                onClick={zoomOut}
                disabled={currentPreset === 'compact'}
                className="text-[10px] font-bold px-0.5 text-slate-400 hover:text-emerald-400 disabled:opacity-30 transition-colors"
                title="縮小字體"
              >
                A-
              </button>
              <span className="text-[9px] text-slate-400 font-mono">
                {currentPreset === 'compact' ? '小' : currentPreset === 'standard' ? '中' : currentPreset === 'large' ? '大' : currentPreset === 'huge' ? '特' : currentPreset === 'giant' ? '超' : currentPreset === 'ultra' ? '尊' : '自'}
              </span>
              <button
                type="button"
                onClick={zoomIn}
                disabled={currentPreset === 'ultra'}
                className="text-[10px] font-bold px-0.5 text-slate-400 hover:text-emerald-400 disabled:opacity-30 transition-colors"
                title="放大字體"
              >
                A+
              </button>
            </div>
          </div>
        </div>

        {/* Category & Speed Pill Bar */}
        <div className="flex items-center justify-between px-1 text-xs">
          {/* Category Dropdown */}
          <div className="flex items-center space-x-1">
            <ListFilter size={12} className="text-slate-400" />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              aria-label="商務主題分類"
              className="bg-transparent text-xs text-slate-300 font-semibold focus:outline-none border-b border-slate-700 pb-0.5"
            >
              <option value="all" className="bg-slate-900">全部商務主題</option>
              {availableCategories.map(cat => (
                <option key={cat} value={cat} className="bg-slate-900">{cat}</option>
              ))}
            </select>
          </div>

          {/* Speed Pills: 1.0s, 1.5s, 2.0s, 3.0s, 4.0s + Image Toggle */}
          <div className="flex items-center space-x-1.5">
            {/* Image Toggle */}
            <button
              type="button"
              onClick={() => {
                const next = !showImage;
                setShowImage(next);
                updateSettings({ fastSkimShowImage: next });
              }}
              className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold transition-colors flex items-center space-x-1 ${
                showImage
                  ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title={showImage ? '配圖模式已開啟' : '純文字極速模式'}
            >
              {showImage ? <ImageIcon size={12} className="mr-0.5" /> : <ImageOff size={12} className="mr-0.5" />}
              <span>{showImage ? '圖文' : '純字'}</span>
            </button>

            {/* Speed Pills */}
            {[1.0, 1.5, 2.0, 3.0, 4.0].map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => {
                  handleDurationChange(sec);
                  updateSettings({ fastSkimDurationSec: sec });
                }}
                className={`px-1.5 py-0.5 text-[10px] font-bold rounded-md transition-all ${
                  durationSec === sec
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
                title={`${sec} 秒/字`}
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Flashcard View with IG Story Gestures (Swipe & Tap Sides) */}
      <div className="relative z-10 flex-1 flex flex-col justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentWord.id}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.4}
            onDragEnd={(_: unknown, info: PanInfo) => {
              if (info.offset.x < -40 || info.velocity.x < -200) {
                goToNext();
              } else if (info.offset.x > 40 || info.velocity.x > 200) {
                goToPrev();
              }
            }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const width = rect.width;
              if (clickX < width * 0.28) {
                goToPrev();
              } else if (clickX > width * 0.72) {
                goToNext();
              } else {
                setIsPaused(prev => !prev);
              }
            }}
            className="bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-700/80 rounded-3xl p-5 shadow-2xl flex flex-col justify-between min-h-[380px] relative overflow-hidden cursor-pointer select-none"
          >
            {/* Top Timer Bar */}
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-slate-900 z-10">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-100 ease-linear"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Associative Scenario Image Banner (Enlarged & uncropped 1:1 view) */}
            {showImage && !imgFailed && (
              <div className="relative -mx-5 -mt-5 mb-3 h-48 sm:h-52 overflow-hidden rounded-t-3xl border-b border-slate-700/60 shrink-0">
                <img
                  src={imageService.getImageForWord(currentWord.headword, currentWord.category).url}
                  alt={currentWord.headword}
                  onError={() => setImgFailed(true)}
                  className="w-full h-full object-cover object-center brightness-90 contrast-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent" />
                <div className="absolute bottom-2 left-3 flex items-center space-x-1.5">
                  <Badge variant="emerald">{currentWord.category}</Badge>
                </div>
              </div>
            )}

            {/* Headword & Tags */}
            <div>
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center space-x-1.5">
                  <Badge variant={currentWord.entryType === 'word' ? 'emerald' : 'purple'}>
                    {currentWord.entryType === 'word' ? '單字' : currentWord.entryType === 'phrase' ? '片語' : '句型'}
                  </Badge>
                  {!showImage && <span className="text-xs text-slate-400">{currentWord.category}</span>}
                </div>

                <div onClick={(e) => e.stopPropagation()}>
                  <AudioButton headword={currentWord.headword} audioUrl={currentWord.audioUSUrl} />
                </div>
              </div>

              {/* Click Word to Pronounce */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  audioService.playWord({
                    headword: currentWord.headword,
                    audioUrl: currentWord.audioUSUrl
                  });
                }}
                className={`cursor-pointer group active:scale-98 transition-transform select-none ${showImage ? "mt-1.5" : "mt-3"}`}
                title="點擊單字直接發音"
              >
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h2 className={`${headwordClass} text-slate-100 tracking-tight leading-tight group-hover:text-emerald-300 transition-colors flex items-center`}>
                    {currentWord.headword}
                    <Volume2 size={16} className="ml-2 text-emerald-400/60 group-hover:text-emerald-400 transition-all shrink-0" />
                  </h2>
                  {currentWord.partsOfSpeech && currentWord.partsOfSpeech.length > 0 && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-950/70 border border-emerald-700/60 text-emerald-300">
                      {currentWord.partsOfSpeech.join(', ')}
                    </span>
                  )}
                </div>
                {currentWord.phoneticUS && (
                  <p className={`${supportingClass} font-mono text-emerald-400/90 mt-0.5`}>
                    /{currentWord.phoneticUS}/
                  </p>
                )}
              </div>
            </div>

            {/* Definition & Examples */}
            <div className="my-2 space-y-2">
              <div className="p-3 rounded-2xl bg-slate-900/90 border border-slate-800">
                <div className="text-[10px] text-slate-400 font-semibold mb-0.5">中文釋義</div>
                <div className={`${definitionClass} text-emerald-300`}>
                  {currentWord.definitionZh}
                </div>
              </div>

              {currentWord.examples.length > 0 && (
                <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800/80">
                  <div className="text-[10px] text-emerald-400 font-bold mb-0.5 flex items-center space-x-1">
                    <Sparkles size={11} className="text-amber-400" />
                    <span>商務情境例句</span>
                  </div>
                  <p className={`text-slate-200 ${exampleEnClass}`}>
                    {currentWord.examples[0].en || currentWord.examples[0].english}
                  </p>
                  <p className={`text-emerald-400/90 ${exampleZhClass} mt-1`}>
                    {currentWord.examples[0].zh || currentWord.examples[0].chinese}
                  </p>
                </div>
              )}
            </div>

            {/* Bottom info bar */}
            <div className="text-[11px] text-slate-400 flex items-center justify-end border-t border-slate-800/70 pt-2">
              <span className="text-slate-400 font-mono">倒數 {remainingTime.toFixed(1)} 秒</span>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Floating Control Bar (Sticky & Uncuttable) */}
      <div className="flex items-center justify-center space-x-4 bg-slate-800/95 border border-slate-700/80 rounded-2xl py-2 px-6 shadow-xl backdrop-blur shrink-0 sticky bottom-0 z-20">
        <button
          type="button"
          onClick={goToPrev}
          disabled={currentIndex === 0}
          aria-label="上一個單字"
          className="p-3 rounded-xl bg-slate-900 hover:bg-slate-700 disabled:opacity-40 text-slate-200 transition-colors min-w-[48px] min-h-[48px] flex items-center justify-center"
        >
          <ChevronLeft size={22} />
        </button>

        <button
          type="button"
          onClick={() => setIsPaused(prev => !prev)}
          aria-label={isPaused ? '繼續速讀' : '暫停速讀'}
          className="p-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/40 transition-transform active:scale-95 min-w-[52px] min-h-[52px] flex items-center justify-center"
        >
          {isPaused ? <Play size={24} className="fill-white" /> : <Pause size={24} className="fill-white" />}
        </button>

        <button
          type="button"
          onClick={goToNext}
          aria-label="下一個單字"
          className="p-3 rounded-xl bg-slate-900 hover:bg-slate-700 text-slate-200 transition-colors min-w-[48px] min-h-[48px] flex items-center justify-center"
        >
          <ChevronRight size={22} />
        </button>
      </div>

      {/* Modal: Flash Recap at end of micro-session */}
      <Modal
        isOpen={showRecapModal}
        onClose={() => setShowRecapModal(false)}
        title="⚡ 小節快閃回顧 (Flash Recap)"
        maxWidth="lg"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span>本節完成：<strong className="text-emerald-400">{activeWords.length}</strong> 個單字</span>
            <span className="text-slate-400">點擊星號可直接加入收藏</span>
          </div>

          <div className="max-h-[50dvh] overflow-y-auto space-y-2 pr-1">
            {activeWords.map((w, idx) => {
              const isStarred = starredWordIds.has(w.id);
              return (
                <div
                  key={w.id}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs"
                >
                  <div className="flex items-center space-x-2.5 min-w-0 flex-1 mr-2">
                    <span className="text-[11px] font-bold text-slate-500 w-4 shrink-0">{idx + 1}.</span>
                    <div className="min-w-0">
                      <div className="font-bold text-slate-200 truncate">{w.headword}</div>
                      <div className="text-[11px] text-emerald-400 truncate">{w.definitionZh}</div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => audioService.playWord({ headword: w.headword, audioUrl: w.audioUSUrl })}
                      className="p-1.5 text-slate-400 hover:text-emerald-400 rounded-lg"
                      aria-label={`朗讀 ${w.headword}`}
                    >
                      <Volume2 size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleStarWord(w.id)}
                      className="p-1.5 text-slate-400 hover:text-amber-400 rounded-lg"
                      aria-label="收藏"
                    >
                      <Star size={16} className={isStarred ? 'fill-amber-400 text-amber-400' : ''} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-2 flex flex-col space-y-2">
            <Button size="lg" variant="primary" fullWidth onClick={handleNextBatch}>
              <Sparkles size={16} className="mr-1.5" /> 繼續下一小節速讀
            </Button>
            <Button
              size="md"
              variant="outline"
              fullWidth
              onClick={() => navigate(`/review${courseId ? `?courseId=${courseId}` : ''}`)}
            >
              <Repeat size={15} className="mr-1.5" /> 進入主動回想間隔複習
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
