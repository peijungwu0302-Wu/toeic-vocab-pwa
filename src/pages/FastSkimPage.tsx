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
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useProfile } from '../contexts/ProfileContext';
import { courseRepository } from '../repositories/courseRepository';
import { progressRepository } from '../repositories/progressRepository';
import { Word } from '../types/db';
import { AudioButton } from '../components/ui/AudioButton';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { audioService } from '../services/audioService';

export const FastSkimPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { activeProfile, updateProfile } = useProfile();

  const courseId = searchParams.get('courseId');

  const [allWords, setAllWords] = useState<Word[]>([]);
  const [activeWords, setActiveWords] = useState<Word[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [durationSec, setDurationSec] = useState(activeProfile?.fastSkimDurationSec || 4);
  const [remainingTime, setRemainingTime] = useState(durationSec);
  const [isLoading, setIsLoading] = useState(true);

  // Micro-session & Filters
  const [batchSize, setBatchSize] = useState<number>(20); // 15, 20, 30, 999 (all)
  const [currentBatchIndex, setCurrentBatchIndex] = useState<number>(0);
  const [isShuffle, setIsShuffle] = useState<boolean>(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [showRecapModal, setShowRecapModal] = useState<boolean>(false);
  const [starredWordIds, setStarredWordIds] = useState<Set<string>>(new Set());

  const timerRef = useRef<number | null>(null);

  // Load words & categories
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

      setAllWords(loadedWords);

      // Slice to first batch
      const initialBatch = batchSize >= 999 ? loadedWords : loadedWords.slice(0, batchSize);
      setActiveWords(initialBatch);
      setCurrentIndex(0);
      setCurrentBatchIndex(0);
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

  const handleBatchComplete = useCallback(() => {
    setIsPaused(true);
    setShowRecapModal(true);
  }, []);

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
    <div className="flex flex-col h-full justify-between max-w-md mx-auto space-y-2 pb-1 select-none overflow-hidden">
      {/* Top Filter & Micro-session Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between bg-slate-800/80 border border-slate-700/70 rounded-2xl px-3.5 py-2 shadow-sm">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-emerald-400">
              第 {currentIndex + 1} / {activeWords.length} 字
            </span>
            <span className="text-[10px] text-slate-400">
              (第 {currentBatchIndex + 1} 小節)
            </span>
          </div>

          <div className="flex items-center space-x-1.5">
            {/* Shuffle toggle */}
            <button
              type="button"
              onClick={() => setIsShuffle(prev => !prev)}
              aria-label={isShuffle ? '隨機洗牌已開啟' : '順序模式'}
              className={`p-1.5 rounded-lg text-xs font-semibold transition-colors ${
                isShuffle ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40' : 'bg-slate-900 text-slate-400'
              }`}
              title={isShuffle ? '隨機洗牌中' : '字母順序'}
            >
              <Shuffle size={14} />
            </button>

            {/* Batch size selector */}
            <select
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              aria-label="每小節單字量"
              className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200 font-bold focus:outline-none"
            >
              <option value={15}>15字/節</option>
              <option value={20}>20字/節</option>
              <option value={30}>30字/節</option>
              <option value={999}>全部</option>
            </select>

            <button
              type="button"
              onClick={() => navigate('/')}
              className="text-slate-400 hover:text-slate-200 p-1"
              aria-label="退出速讀"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Category & Speed Pill Bar */}
        <div className="flex items-center justify-between px-1">
          {/* Category Dropdown */}
          <div className="flex items-center space-x-1">
            <ListFilter size={13} className="text-slate-400" />
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

          {/* Speed Pills: 1s, 2s, 3s, 4s, 6s */}
          <div className="flex items-center space-x-1">
            {[1, 2, 3, 4, 6].map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => handleDurationChange(sec)}
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

      {/* Main Flashcard View */}
      <div className="flex-1 flex flex-col justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentWord.id}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-700/80 rounded-3xl p-6 shadow-2xl flex flex-col justify-between min-h-[360px] relative overflow-hidden"
          >
            {/* Top Timer Bar */}
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-slate-900">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-100 ease-linear"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Headword & Tags */}
            <div>
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center space-x-1.5">
                  <Badge variant={currentWord.entryType === 'word' ? 'emerald' : 'purple'}>
                    {currentWord.entryType === 'word' ? '單字' : currentWord.entryType === 'phrase' ? '片語' : '句型'}
                  </Badge>
                  <span className="text-xs text-slate-400">{currentWord.category}</span>
                </div>

                <AudioButton headword={currentWord.headword} audioUrl={currentWord.audioUSUrl} />
              </div>

              <div className="mt-4">
                <h2 className="text-3xl font-black text-slate-100 tracking-tight leading-tight">
                  {currentWord.headword}
                </h2>
                {currentWord.phoneticUS && (
                  <p className="text-sm font-mono text-emerald-400/90 mt-1">
                    /{currentWord.phoneticUS}/
                  </p>
                )}
              </div>
            </div>

            {/* Definition & Examples */}
            <div className="my-3 space-y-3">
              <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800">
                <div className="text-[11px] text-slate-400 font-semibold mb-0.5">中文釋義</div>
                <div className="text-lg font-bold text-emerald-300">
                  {currentWord.definitionZh}
                </div>
              </div>

              {currentWord.examples.length > 0 && (
                <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800/80">
                  <div className="text-[11px] text-slate-400 font-semibold mb-0.5">商務情境例句</div>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    {currentWord.examples[0].english}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {currentWord.examples[0].chinese}
                  </p>
                </div>
              )}
            </div>

            {/* Bottom info bar */}
            <div className="text-[11px] text-slate-400 flex items-center justify-between border-t border-slate-800 pt-3">
              <span>詞性：{currentWord.partsOfSpeech.join(', ')}</span>
              <span className="text-slate-400 font-mono">剩餘 {remainingTime.toFixed(1)} 秒</span>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Floating Control Bar */}
      <div className="flex items-center justify-center space-x-4 bg-slate-800/90 border border-slate-700/80 rounded-2xl py-2.5 px-6 shadow-xl backdrop-blur">
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
