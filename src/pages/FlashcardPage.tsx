import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Star,
  Sparkles,
  X,
  ChevronDown,
  Shuffle,
  ListFilter,
  AlertCircle,
  HelpCircle,
  Lightbulb
} from 'lucide-react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useProfile } from '../contexts/ProfileContext';
import { useSync } from '../contexts/SyncContext';
import { progressRepository } from '../repositories/progressRepository';
import { courseRepository } from '../repositories/courseRepository';
import { fsrsService } from '../services/fsrsService';
import { audioService } from '../services/audioService';
import { Word, Progress } from '../types/db';
import { FSRSRating, IntervalPreviewItem } from '../types/fsrs';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { AudioButton } from '../components/ui/AudioButton';
import { SwipeableCard } from '../components/ui/SwipeableCard';

interface StudyItem {
  word: Word;
  progress: Progress;
}

export const FlashcardPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { activeProfile } = useProfile();
  const { syncState } = useSync();

  const courseId = searchParams.get('courseId');

  const [queue, setQueue] = useState<StudyItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isStarred, setIsStarred] = useState(false);
  const [intervalPreviews, setIntervalPreviews] = useState<IntervalPreviewItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Micro-sessions & Filters
  const [batchSize, setBatchSize] = useState<number>(20);
  const [isShuffle, setIsShuffle] = useState<boolean>(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [preConfidence, setPreConfidence] = useState<'confident' | 'unsure' | null>(null);

  const [sessionResults, setSessionResults] = useState<{
    reviewedCount: number;
    againCount: number;
    hardCount: number;
    goodCount: number;
    easyCount: number;
  }>({
    reviewedCount: 0,
    againCount: 0,
    hardCount: 0,
    goodCount: 0,
    easyCount: 0
  });

  const cardStartTimeRef = useRef<number>(Date.now());
  const hiddenTimeAccumulatorRef = useRef<number>(0);
  const hideTimestampRef = useRef<number | null>(null);

  // Track visibility to exclude background time
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        hideTimestampRef.current = Date.now();
      } else if (hideTimestampRef.current) {
        hiddenTimeAccumulatorRef.current += Date.now() - hideTimestampRef.current;
        hideTimestampRef.current = null;
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Load study items
  const loadStudyQueue = useCallback(async () => {
    if (!activeProfile) return;
    try {
      setIsLoading(true);
      const profileId = activeProfile.id;
      let items: StudyItem[] = [];

      if (courseId === 'starred') {
        items = await progressRepository.getStarredWords(profileId);
      } else {
        // 1. Get due cards
        const dueItems = await progressRepository.getDueWords(
          profileId,
          courseId || undefined,
          batchSize,
          { category: selectedCategory, shuffle: isShuffle }
        );
        items.push(...dueItems);

        // 2. If due cards are fewer than batchSize, add new cards up to batch limit
        if (items.length < batchSize) {
          let targetCourseId = courseId;
          if (!targetCourseId) {
            const downloaded = await courseRepository.getAll();
            const firstDownloaded = downloaded.find(c => c.isDownloaded);
            if (firstDownloaded) targetCourseId = firstDownloaded.id;
          }

          if (targetCourseId) {
            const newWords = await progressRepository.getNewWordsForCourse(
              profileId,
              targetCourseId,
              batchSize - items.length,
              { category: selectedCategory, shuffle: isShuffle }
            );
            items.push(...newWords);
          }
        }
      }

      setQueue(items);
      setCurrentIndex(0);
      setIsFlipped(false);
      setPreConfidence(null);
      cardStartTimeRef.current = Date.now();
      hiddenTimeAccumulatorRef.current = 0;

      const cats = await courseRepository.getDownloadedCategories();
      setAvailableCategories(cats);
    } catch (err) {
      console.error('[FlashcardPage] Load queue error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeProfile, courseId, batchSize, selectedCategory, isShuffle]);

  useEffect(() => {
    loadStudyQueue();
  }, [loadStudyQueue]);

  const currentItem = queue[currentIndex];

  useEffect(() => {
    if (currentItem && activeProfile) {
      setIsStarred(Boolean(currentItem.progress.isStarred));
      setIsFlipped(false);
      setPreConfidence(null);
      cardStartTimeRef.current = Date.now();
      hiddenTimeAccumulatorRef.current = 0;

      const previews = fsrsService.previewRatings(
        currentItem.progress,
        new Date(),
        activeProfile.desiredRetention || 0.9
      );
      setIntervalPreviews(previews);

      // Auto play audio if enabled
      if (activeProfile.autoPlayAudio && !activeProfile.isMuted) {
        audioService.playWord({
          headword: currentItem.word.headword,
          audioUrl: currentItem.word.audioUSUrl || currentItem.word.audioUKUrl,
          accent: activeProfile.preferredAccent,
          isMuted: activeProfile.isMuted
        });
      }
    }
  }, [currentIndex, queue, activeProfile, currentItem]);

  const handleToggleStar = async () => {
    if (!currentItem || !activeProfile) return;
    const newStar = await progressRepository.toggleStarred(activeProfile.id, currentItem.word.id);
    setIsStarred(newStar);
  };

  const handleFlipCard = useCallback(() => {
    setIsFlipped(prev => !prev);
  }, []);

  const handlePreConfidenceSelect = (type: 'confident' | 'unsure') => {
    setPreConfidence(type);
    setIsFlipped(true);
  };

  const handleRate = useCallback(async (rating: FSRSRating) => {
    if (!currentItem || !activeProfile) return;

    // Calculate actual active review duration in ms
    const totalElapsedMs = Date.now() - cardStartTimeRef.current;
    const durationMs = Math.max(500, totalElapsedMs - hiddenTimeAccumulatorRef.current);

    try {
      await progressRepository.recordReviewTransaction({
        profileId: activeProfile.id,
        wordId: currentItem.word.id,
        rating,
        durationMs,
        desiredRetention: activeProfile.desiredRetention || 0.9,
        enableCloudSync: Boolean(syncState.cloudUserEmail)
      });

      // Update session metrics
      setSessionResults(prev => ({
        reviewedCount: prev.reviewedCount + 1,
        againCount: rating === 1 ? prev.againCount + 1 : prev.againCount,
        hardCount: rating === 2 ? prev.hardCount + 1 : prev.hardCount,
        goodCount: rating === 3 ? prev.goodCount + 1 : prev.goodCount,
        easyCount: rating === 4 ? prev.easyCount + 1 : prev.easyCount
      }));

      // Next card
      if (currentIndex < queue.length - 1) {
        setCurrentIndex(prev => prev + 1);
      } else {
        // Session completed!
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 }
        });
        setCurrentIndex(queue.length);
      }
    } catch (err) {
      console.error('[FlashcardPage] Rating error:', err);
      alert('評分寫入失敗，請重試。');
    }
  }, [currentItem, activeProfile, syncState.cloudUserEmail, currentIndex, queue.length]);

  // Swipe Handlers
  const handleSwipeLeft = () => {
    // Left swipe = Again (1)
    if (isFlipped) {
      handleRate(1);
    } else {
      setIsFlipped(true);
    }
  };

  const handleSwipeRight = () => {
    // Right swipe = Good (3)
    if (isFlipped) {
      handleRate(3);
    } else {
      setIsFlipped(true);
    }
  };

  const handleSwipeUp = () => {
    handleToggleStar();
  };

  // Keyboard shortcut listener (Space to flip, 1-4 for ratings)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        handleFlipCard();
      } else if (isFlipped) {
        if (e.key === '1') handleRate(1);
        else if (e.key === '2') handleRate(2);
        else if (e.key === '3') handleRate(3);
        else if (e.key === '4') handleRate(4);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFlipped, handleRate, handleFlipCard]);

  if (isLoading) {
    return (
      <div className="text-center py-16 text-slate-400">
        <p className="text-xs">正在載入複習單字卡...</p>
      </div>
    );
  }

  // Session Completed Screen
  if (currentIndex >= queue.length) {
    const accuracy = sessionResults.reviewedCount > 0
      ? Math.round(((sessionResults.goodCount + sessionResults.easyCount) / sessionResults.reviewedCount) * 100)
      : 100;

    return (
      <div className="min-h-[75dvh] flex flex-col justify-center items-center max-w-sm mx-auto text-center space-y-6">
        <div className="w-20 h-20 rounded-3xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shadow-xl shadow-emerald-950/40">
          <Sparkles size={42} />
        </div>

        <div>
          <h2 className="text-2xl font-black text-slate-100">本節複習完成！</h2>
          <p className="text-xs text-slate-400 mt-1.5">
            成功複習了 <span className="text-emerald-400 font-bold">{sessionResults.reviewedCount}</span> 個單字，良好率達 <span className="text-emerald-400 font-bold">{accuracy}%</span>。
          </p>
        </div>

        {/* Rating Breakdown */}
        <div className="w-full bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 grid grid-cols-4 gap-2">
          <div className="text-center">
            <div className="text-base font-black text-rose-400">{sessionResults.againCount}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">忘記 (1)</div>
          </div>
          <div className="text-center">
            <div className="text-base font-black text-amber-400">{sessionResults.hardCount}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">困難 (2)</div>
          </div>
          <div className="text-center">
            <div className="text-base font-black text-blue-400">{sessionResults.goodCount}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">良好 (3)</div>
          </div>
          <div className="text-center">
            <div className="text-base font-black text-emerald-400">{sessionResults.easyCount}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">簡單 (4)</div>
          </div>
        </div>

        <div className="w-full space-y-2 pt-2">
          <Button size="lg" fullWidth variant="primary" onClick={() => navigate('/')}>
            返回儀表板
          </Button>
          <Button size="md" fullWidth variant="outline" onClick={() => loadStudyQueue()}>
            繼續下一組複習
          </Button>
        </div>
      </div>
    );
  }

  const { word, progress } = currentItem;

  return (
    <div className="flex flex-col h-[calc(100dvh-130px)] justify-between max-w-md mx-auto space-y-2.5 pb-2 select-none">
      {/* Top Header & Micro-session Controls */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between bg-slate-800/80 border border-slate-700/70 rounded-2xl px-3.5 py-1.5 shadow-sm">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-emerald-400">
              第 {currentIndex + 1} / {queue.length} 字
            </span>
            <Badge variant="blue">{word.toeicScoreRange}</Badge>
          </div>

          <div className="flex items-center space-x-1.5">
            <button
              type="button"
              onClick={() => setIsShuffle(prev => !prev)}
              aria-label={isShuffle ? '隨機洗牌已開啟' : '順序模式'}
              className={`p-1.5 rounded-lg text-xs font-semibold transition-colors ${
                isShuffle ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40' : 'bg-slate-900 text-slate-400'
              }`}
              title={isShuffle ? '隨機洗牌中' : '順序'}
            >
              <Shuffle size={14} />
            </button>

            <select
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              aria-label="複習題量"
              className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200 font-bold focus:outline-none"
            >
              <option value={15}>15字/組</option>
              <option value={20}>20字/組</option>
              <option value={30}>30字/組</option>
            </select>

            <button
              type="button"
              onClick={handleToggleStar}
              aria-label={isStarred ? '取消收藏' : '收藏單字'}
              className="p-1.5 text-slate-400 hover:text-amber-400 transition-colors"
            >
              <Star size={17} className={isStarred ? 'fill-amber-400 text-amber-400' : ''} />
            </button>

            <button
              type="button"
              onClick={() => navigate('/')}
              className="text-slate-400 hover:text-slate-200 p-1"
              aria-label="離開複習"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Category filter */}
        <div className="flex items-center space-x-1 px-1">
          <ListFilter size={12} className="text-slate-400" />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            aria-label="主題篩選"
            className="bg-transparent text-[11px] text-slate-400 focus:outline-none"
          >
            <option value="all" className="bg-slate-900">全部商務主題</option>
            {availableCategories.map(cat => (
              <option key={cat} value={cat} className="bg-slate-900">{cat}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Swipeable 3D Flashcard */}
      <div className="flex-1 flex flex-col justify-center">
        <SwipeableCard
          onSwipeLeft={handleSwipeLeft}
          onSwipeRight={handleSwipeRight}
          onSwipeUp={handleSwipeUp}
          onClick={handleFlipCard}
        >
          <motion.div
            animate={{ rotateY: isFlipped ? 180 : 0 }}
            transition={{ duration: 0.26, ease: 'easeInOut' }}
            className="w-full h-full min-h-[350px] relative rounded-3xl [transform-style:preserve-3d]"
          >
            {/* Card FRONT */}
            <div
              className={`absolute inset-0 w-full h-full bg-gradient-to-b from-slate-800 to-slate-900 border ${
                isStarred ? 'border-amber-500/50 shadow-amber-950/20' : 'border-slate-700/80'
              } rounded-3xl p-5 shadow-2xl flex flex-col justify-between [backface-visibility:hidden]`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <Badge variant={word.entryType === 'word' ? 'emerald' : 'purple'}>
                    {word.entryType === 'word' ? '單字' : word.entryType === 'phrase' ? '片語' : '句型'}
                  </Badge>
                  <span className="text-xs text-slate-400">{word.category}</span>
                </div>

                <div className="mt-8 text-center">
                  <h2 className="text-3xl font-black text-slate-100 tracking-tight leading-tight">
                    {word.headword}
                  </h2>
                  {word.phoneticUS && (
                    <p className="text-sm font-mono text-emerald-400/90 mt-1.5">
                      /{word.phoneticUS}/
                    </p>
                  )}
                </div>
              </div>

              {/* Two-step calibration pre-confidence buttons */}
              <div className="space-y-3">
                <div className="flex flex-col items-center justify-center space-y-2">
                  <AudioButton headword={word.headword} audioUrl={word.audioUSUrl} size="lg" />
                  <p className="text-[11px] text-slate-500">👈 左滑忘記 · 右滑記住 👉</p>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePreConfidenceSelect('unsure');
                    }}
                    className="flex items-center justify-center space-x-1.5 py-2.5 px-3 rounded-xl bg-slate-900/90 hover:bg-slate-750 border border-slate-700 text-slate-300 text-xs font-semibold active:scale-98 transition-all"
                  >
                    <HelpCircle size={15} className="text-amber-400" />
                    <span>🤔 沒印象 / 不熟</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePreConfidenceSelect('confident');
                    }}
                    className="flex items-center justify-center space-x-1.5 py-2.5 px-3 rounded-xl bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-600/50 text-emerald-300 text-xs font-semibold active:scale-98 transition-all"
                  >
                    <Lightbulb size={15} className="text-emerald-400" />
                    <span>💡 我記得意思</span>
                  </button>
                </div>
              </div>

              <div className="text-center pt-2 border-t border-slate-800 text-[10px] text-slate-400 flex items-center justify-between">
                <span>{progress.reps > 0 ? `複習第 ${progress.reps} 次` : '新單字'}</span>
                <span className="text-emerald-400 font-medium flex items-center">
                  點擊翻面 <ChevronDown size={12} className="ml-0.5" />
                </span>
              </div>
            </div>

            {/* Card BACK */}
            <div
              className={`absolute inset-0 w-full h-full bg-gradient-to-b from-slate-850 to-slate-900 border ${
                isStarred ? 'border-amber-500/50' : 'border-emerald-500/40'
              } rounded-3xl p-5 shadow-2xl flex flex-col justify-between [backface-visibility:hidden] [transform:rotateY(180deg)] overflow-y-auto`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Badge variant="emerald">{word.partsOfSpeech.join(', ')}</Badge>
                    <span className="text-xs text-slate-400">{word.category}</span>
                  </div>
                  <AudioButton headword={word.headword} audioUrl={word.audioUSUrl} size="sm" />
                </div>

                {/* Headword & Meaning */}
                <div>
                  <h3 className="text-2xl font-black text-slate-100">{word.headword}</h3>
                  <div className="mt-1.5 p-3 rounded-xl bg-slate-900/90 border border-slate-800">
                    <div className="text-lg font-bold text-emerald-300">
                      {word.definitionZh}
                    </div>
                  </div>
                </div>

                {/* Examples */}
                {word.examples.length > 0 && (
                  <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs space-y-1">
                    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                      商務情境例句
                    </div>
                    <p className="text-slate-200 leading-relaxed font-medium">
                      {word.examples[0].english}
                    </p>
                    <p className="text-slate-400 text-[11px]">
                      {word.examples[0].chinese}
                    </p>
                  </div>
                )}

                {/* Exam tips */}
                {word.examTips && word.examTips.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-amber-950/20 border border-amber-800/40 text-[11px] space-y-1">
                    <div className="text-[10px] text-amber-400 font-bold flex items-center">
                      <Sparkles size={11} className="mr-1" /> 多益解題關鍵
                    </div>
                    <p className="text-amber-200/90 leading-relaxed">
                      {word.examTips[0]}
                    </p>
                  </div>
                )}
              </div>

              {/* Downgrade '記錯了' option if pre-confidence was confident */}
              {preConfidence === 'confident' && (
                <div className="pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRate(1); // downgrade directly to Again
                    }}
                    className="w-full py-1.5 px-3 rounded-xl bg-rose-950/60 hover:bg-rose-900/80 border border-rose-700/60 text-rose-300 text-xs font-bold flex items-center justify-center space-x-1.5 transition-colors"
                  >
                    <AlertCircle size={14} />
                    <span>💥 我記錯意思了！（一鍵降級為 Again）</span>
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </SwipeableCard>
      </div>

      {/* FSRS 4 Rating Buttons (Active when flipped) */}
      <div className="space-y-1.5 pt-1" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
        <div className="grid grid-cols-4 gap-2">
          {/* 1. Again */}
          <button
            type="button"
            disabled={!isFlipped}
            onClick={(e) => {
              e.stopPropagation();
              handleRate(1);
            }}
            className="flex flex-col items-center justify-center p-2 rounded-2xl bg-rose-950/80 hover:bg-rose-900 active:scale-95 border border-rose-800/80 text-white disabled:opacity-30 disabled:pointer-events-none transition-all shadow-md min-h-[56px]"
          >
            <div className="text-xs font-bold text-rose-300">忘記 (1)</div>
            <div className="text-[10px] text-rose-200/80 font-mono mt-0.5">
              {intervalPreviews[0]?.intervalText || '< 1分'}
            </div>
          </button>

          {/* 2. Hard */}
          <button
            type="button"
            disabled={!isFlipped}
            onClick={(e) => {
              e.stopPropagation();
              handleRate(2);
            }}
            className="flex flex-col items-center justify-center p-2 rounded-2xl bg-amber-950/80 hover:bg-amber-900 active:scale-95 border border-amber-800/80 text-white disabled:opacity-30 disabled:pointer-events-none transition-all shadow-md min-h-[56px]"
          >
            <div className="text-xs font-bold text-amber-300">困難 (2)</div>
            <div className="text-[10px] text-amber-200/80 font-mono mt-0.5">
              {intervalPreviews[1]?.intervalText || '1天'}
            </div>
          </button>

          {/* 3. Good */}
          <button
            type="button"
            disabled={!isFlipped}
            onClick={(e) => {
              e.stopPropagation();
              handleRate(3);
            }}
            className="flex flex-col items-center justify-center p-2 rounded-2xl bg-blue-950/80 hover:bg-blue-900 active:scale-95 border border-blue-800/80 text-white disabled:opacity-30 disabled:pointer-events-none transition-all shadow-md min-h-[56px]"
          >
            <div className="text-xs font-bold text-blue-300">良好 (3)</div>
            <div className="text-[10px] text-blue-200/80 font-mono mt-0.5">
              {intervalPreviews[2]?.intervalText || '3天'}
            </div>
          </button>

          {/* 4. Easy */}
          <button
            type="button"
            disabled={!isFlipped}
            onClick={(e) => {
              e.stopPropagation();
              handleRate(4);
            }}
            className="flex flex-col items-center justify-center p-2 rounded-2xl bg-emerald-950/80 hover:bg-emerald-900 active:scale-95 border border-emerald-800/80 text-white disabled:opacity-30 disabled:pointer-events-none transition-all shadow-md min-h-[56px]"
          >
            <div className="text-xs font-bold text-emerald-300">簡單 (4)</div>
            <div className="text-[10px] text-emerald-200/80 font-mono mt-0.5">
              {intervalPreviews[3]?.intervalText || '6天'}
            </div>
          </button>
        </div>

        {!isFlipped && (
          <div className="text-center text-[10px] text-slate-500">
            🔒 點擊卡片翻面或點上方按鈕解鎖評分
          </div>
        )}
      </div>
    </div>
  );
};
