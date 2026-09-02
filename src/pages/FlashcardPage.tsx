import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Star,
  Sparkles,
  X,
  Shuffle,
  ListFilter,
  AlertCircle,
  HelpCircle,
  Lightbulb,
  Volume2,
  BookOpen,
  Bot,
  Send,
  Loader2,
  Layers,
  GitBranch,
  Target
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useProfile } from '../contexts/ProfileContext';
import { useSync } from '../contexts/SyncContext';
import { useTypography } from '../contexts/TypographyContext';
import { progressRepository } from '../repositories/progressRepository';
import { courseRepository } from '../repositories/courseRepository';
import { fsrsService } from '../services/fsrsService';
import { audioService } from '../services/audioService';
import { imageService } from '../services/imageService';
import { morphologyService, MorphologyInfo } from '../services/morphologyService';
import { geminiService, SentenceEvaluationResult, NuanceExplanationResult, MnemonicResult, InstantQuizResult } from '../services/geminiService';
import { Word, Progress } from '../types/db';
import { FSRSRating, IntervalPreviewItem } from '../types/fsrs';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { AudioButton } from '../components/ui/AudioButton';
import { Modal } from '../components/ui/Modal';
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
  const { headwordClass, definitionClass, exampleEnClass, exampleZhClass } = useTypography();

  const courseId = searchParams.get('courseId');

  const [queue, setQueue] = useState<StudyItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isStarred, setIsStarred] = useState(false);
  const [intervalPreviews, setIntervalPreviews] = useState<IntervalPreviewItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [imgFailed, setImgFailed] = useState(false);

  // Micro-sessions & Filters
  const [batchSize, setBatchSize] = useState<number>(20);
  const [isShuffle, setIsShuffle] = useState<boolean>(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [preConfidence, setPreConfidence] = useState<'confident' | 'unsure' | null>(null);

  // Morphology & Word Family
  const [morphology, setMorphology] = useState<MorphologyInfo | null>(null);
  const [activeTabExample, setActiveTabExample] = useState<number>(0);

  // AI Tools Drawer States
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiModalType, setAiModalType] = useState<'mnemonic' | 'instant_quiz' | 'sentence' | 'nuance'>('mnemonic');
  
  // API Key Quick Config in Modal
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [quickApiKey, setQuickApiKey] = useState('');
  const [testingApiKey, setTestingApiKey] = useState(false);
  const [apiKeyTestResult, setApiKeyTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // 1-Click Mnemonic
  const [aiMnemonicText, setAiMnemonicText] = useState<MnemonicResult | null>(null);
  const [loadingMnemonic, setLoadingMnemonic] = useState(false);

  // 1-Click Instant Part 5 Question
  const [aiQuizItem, setAiQuizItem] = useState<InstantQuizResult | null>(null);
  const [loadingAiQuiz, setLoadingAiQuiz] = useState(false);
  const [aiQuizSelectedOpt, setAiQuizSelectedOpt] = useState<number | null>(null);

  // Sentence & Nuance
  const [userSentenceInput, setUserSentenceInput] = useState('');
  const [evaluatingSentence, setEvaluatingSentence] = useState(false);
  const [sentenceResult, setSentenceResult] = useState<SentenceEvaluationResult | null>(null);
  const [nuanceCompareWord, setNuanceCompareWord] = useState('');
  const [evaluatingNuance, setEvaluatingNuance] = useState(false);
  const [nuanceResult, setNuanceResult] = useState<NuanceExplanationResult | null>(null);

  const [sessionResults, setSessionResults] = useState<{
    reviewedCount: number;
    againCount: number;
    hardCount: number;
    goodCount: number;
  }>({
    reviewedCount: 0,
    againCount: 0,
    hardCount: 0,
    goodCount: 0
  });

  const cardStartTimeRef = useRef<number>(Date.now());
  const hiddenTimeAccumulatorRef = useRef<number>(0);
  const hideTimestampRef = useRef<number | null>(null);

  // Track visibility
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

        // 2. Add new cards up to batch limit
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
      setImgFailed(false);
      setActiveTabExample(0);
      setAiMnemonicText(null);
      setAiQuizItem(null);
      setAiQuizSelectedOpt(null);
      setSentenceResult(null);
      setNuanceResult(null);
      setUserSentenceInput('');
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

      // Load curated morphology
      const morph = morphologyService.getMorphology(currentItem.word.headword, currentItem.word.category);
      setMorphology(morph);
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
        goodCount: rating === 3 || rating === 4 ? prev.goodCount + 1 : prev.goodCount
      }));

      // Next card immediately without flipping back
      if (currentIndex < queue.length - 1) {
        setCurrentIndex(prev => prev + 1);
      } else {
        // Session completed!
        confetti({
          particleCount: 90,
          spread: 80,
          origin: { y: 0.6 }
        });
        setCurrentIndex(queue.length);
      }
    } catch (err) {
      console.error('[FlashcardPage] Rating error:', err);
    }
  }, [currentItem, activeProfile, syncState.cloudUserEmail, currentIndex, queue.length]);

  // Horizontal Swipe Handlers
  const handleSwipeLeft = () => {
    // 👈 Left Swipe = 💡 掌握 (Good - 3)
    if (isFlipped) {
      handleRate(3);
    } else {
      setIsFlipped(true);
    }
  };

  const handleSwipeRight = () => {
    // 👉 Right Swipe = 💥 忘記 (Again - 1)
    if (isFlipped) {
      handleRate(1);
    } else {
      setIsFlipped(true);
    }
  };

  // Keyboard shortcut listener (Space to flip, 1-3 for ratings)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!isFlipped) handleFlipCard();
      } else if (isFlipped) {
        if (e.key === '1') handleRate(1);
        else if (e.key === '2') handleRate(2);
        else if (e.key === '3') handleRate(3);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFlipped, handleRate, handleFlipCard]);

  // Initial API Key load
  useEffect(() => {
    geminiService.getApiKey().then(k => {
      if (k) setQuickApiKey(k);
    });
  }, []);

  // Handle Testing & Saving API Key
  const handleTestAndSaveApiKey = async () => {
    if (!quickApiKey.trim()) return;
    setTestingApiKey(true);
    setApiKeyTestResult(null);
    try {
      const test = await geminiService.testApiKey(quickApiKey);
      if (test.success) {
        await geminiService.setApiKey(quickApiKey);
        setApiKeyTestResult({ success: true, message: `✅ ${test.message}！已成功綁定，立即啟用 Live AI 生成。` });
        // Refresh items with live API
        handleGenerateMnemonic();
        handleGenerateInstantQuiz();
      } else {
        setApiKeyTestResult({ success: false, message: `❌ ${test.message}` });
      }
    } catch (err) {
      setApiKeyTestResult({ success: false, message: `連線失敗：${(err as Error).message}` });
    } finally {
      setTestingApiKey(false);
    }
  };

  // Handle 1-Click Mnemonic Generation
  const handleGenerateMnemonic = useCallback(async () => {
    if (!currentItem) return;
    setLoadingMnemonic(true);
    try {
      const rootsStr = morphology?.roots.map(r => `${r.part}(${r.meaning})`).join('+') || '';
      const res = await geminiService.generateMnemonicStory(
        currentItem.word.headword,
        currentItem.word.definitionZh,
        rootsStr
      );
      setAiMnemonicText(res);
    } finally {
      setLoadingMnemonic(false);
    }
  }, [currentItem, morphology]);

  // Handle 1-Click Instant Part 5 Exam Question
  const handleGenerateInstantQuiz = useCallback(async () => {
    if (!currentItem) return;
    setLoadingAiQuiz(true);
    setAiQuizSelectedOpt(null);
    try {
      const item = await geminiService.generateInstantExamQuestion(
        currentItem.word.headword,
        currentItem.word.definitionZh,
        currentItem.word.partsOfSpeech?.[0] || '單字'
      );
      setAiQuizItem(item);
    } finally {
      setLoadingAiQuiz(false);
    }
  }, [currentItem]);

  // Auto-generate AI story & quiz immediately on modal open based on active tab
  useEffect(() => {
    if (isAiModalOpen && currentItem) {
      if (aiModalType === 'mnemonic' && !aiMnemonicText && !loadingMnemonic) {
        handleGenerateMnemonic();
      } else if (aiModalType === 'instant_quiz' && !aiQuizItem && !loadingAiQuiz) {
        handleGenerateInstantQuiz();
      }
    }
  }, [isAiModalOpen, aiModalType, currentItem, aiMnemonicText, aiQuizItem, loadingMnemonic, loadingAiQuiz, handleGenerateMnemonic, handleGenerateInstantQuiz]);

  // Handle Sentence Submission
  const handleEvaluateSentenceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentItem || !userSentenceInput.trim()) return;
    setEvaluatingSentence(true);
    try {
      const result = await geminiService.evaluateSentence(currentItem.word.headword, userSentenceInput);
      setSentenceResult(result);
    } finally {
      setEvaluatingSentence(false);
    }
  };

  // Handle Nuance Submission
  const handleEvaluateNuanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentItem || !nuanceCompareWord.trim()) return;
    setEvaluatingNuance(true);
    try {
      const result = await geminiService.explainNuance(currentItem.word.headword, nuanceCompareWord);
      setNuanceResult(result);
    } finally {
      setEvaluatingNuance(false);
    }
  };

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
      ? Math.round((sessionResults.goodCount / sessionResults.reviewedCount) * 100)
      : 100;

    return (
      <div className="min-h-[75dvh] flex flex-col justify-center items-center max-w-sm mx-auto text-center space-y-6">
        <div className="w-20 h-20 rounded-3xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shadow-xl shadow-emerald-950/40">
          <Sparkles size={42} />
        </div>

        <div>
          <h2 className="text-2xl font-black text-slate-100">本節複習完成！</h2>
          <p className="text-xs text-slate-400 mt-1.5">
            成功複習了 <span className="text-emerald-400 font-bold">{sessionResults.reviewedCount}</span> 個單字，掌握率達 <span className="text-emerald-400 font-bold">{accuracy}%</span>。
          </p>
        </div>

        {/* Rating Breakdown */}
        <div className="w-full bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 grid grid-cols-3 gap-2">
          <div className="text-center">
            <div className="text-base font-black text-rose-400">{sessionResults.againCount}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">💥 忘記 (1)</div>
          </div>
          <div className="text-center">
            <div className="text-base font-black text-amber-400">{sessionResults.hardCount}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">🤔 不熟 (2)</div>
          </div>
          <div className="text-center">
            <div className="text-base font-black text-emerald-400">{sessionResults.goodCount}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">💡 掌握 (3)</div>
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
  
  // 100% authentic bespoke examples directly from dataset (Zero template fallback)
  const currentExamples = Array.isArray(word.examples) && word.examples.length > 0
    ? word.examples
    : [];

  // High-associative business imagery
  const imgInfo = imageService.getImageForWord(word.headword, word.category);
  const finalImageUrl = imgInfo.url;

  return (
    <div className="flex flex-col h-full justify-between max-w-md mx-auto space-y-1.5 pb-2 select-none overscroll-none touch-none">
      {/* Top Header & Micro-session Controls */}
      <div className="space-y-1 shrink-0">
        <div className="flex items-center justify-between bg-slate-800/80 border border-slate-700/70 rounded-2xl px-3 py-1.5 shadow-sm">
          <div className="flex items-center space-x-1.5">
            <span className="text-xs font-bold text-emerald-400">
              第 {currentIndex + 1} / {queue.length} 字
            </span>
            <Badge variant="blue">{word.toeicScoreRange}</Badge>
            <Badge variant={word.frequencyTier === 'core_1200' ? 'emerald' : 'purple'}>
              {word.frequencyTier === 'core_1200' ? '高頻核心' : '商務實戰'}
            </Badge>
          </div>

          <div className="flex items-center space-x-1">
            <button
              type="button"
              onClick={() => setIsShuffle(prev => !prev)}
              aria-label={isShuffle ? '隨機洗牌已開啟' : '順序模式'}
              className={`p-1.5 rounded-lg text-xs font-semibold transition-colors ${
                isShuffle ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40' : 'bg-slate-900 text-slate-400'
              }`}
              title={isShuffle ? '隨機洗牌中' : '順序'}
            >
              <Shuffle size={13} />
            </button>

            <select
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              aria-label="複習題量"
              className="px-1.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200 font-bold focus:outline-none"
            >
              <option value={15}>15字</option>
              <option value={20}>20字</option>
              <option value={30}>30字</option>
            </select>

            <button
              type="button"
              onClick={handleToggleStar}
              aria-label={isStarred ? '取消收藏' : '收藏單字'}
              className="p-1 text-slate-400 hover:text-amber-400 transition-colors"
            >
              <Star size={16} className={isStarred ? 'fill-amber-400 text-amber-400' : ''} />
            </button>

            <button
              type="button"
              onClick={() => navigate('/')}
              className="text-slate-400 hover:text-slate-200 p-1"
              aria-label="離開複習"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Category filter & AI Tools */}
        <div className="flex items-center justify-between px-1 text-[11px]">
          <div className="flex items-center space-x-1 text-slate-400">
            <ListFilter size={12} />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              aria-label="主題篩選"
              className="bg-transparent text-slate-400 focus:outline-none"
            >
              <option value="all" className="bg-slate-900">全部商務主題</option>
              {availableCategories.map(cat => (
                <option key={cat} value={cat} className="bg-slate-900">{cat}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => setIsAiModalOpen(true)}
            className="flex items-center space-x-1 text-amber-400 hover:text-amber-300 font-bold text-[11px] px-2 py-0.5 rounded-lg bg-amber-950/40 border border-amber-800/40"
          >
            <Bot size={12} />
            <span>AI 商務教練</span>
          </button>
        </div>
      </div>

      {/* Swipeable 3D Flashcard */}
      <div className="flex-1 flex flex-col justify-center min-h-0 py-1">
        <SwipeableCard
          onSwipeLeft={handleSwipeLeft}
          onSwipeRight={handleSwipeRight}
        >
          <motion.div
            animate={{ rotateY: isFlipped ? 180 : 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="w-full h-full min-h-[350px] relative rounded-3xl [transform-style:preserve-3d]"
          >
            {/* Card FRONT (Clickable to Flip) */}
            <div
              onClick={handleFlipCard}
              className={`absolute inset-0 w-full h-full bg-gradient-to-b from-slate-800 to-slate-900 border cursor-pointer ${
                isStarred ? 'border-amber-500/50 shadow-amber-950/20' : 'border-slate-700/80'
              } rounded-3xl p-4 shadow-2xl flex flex-col justify-between [backface-visibility:hidden] overflow-hidden`}
            >
              {/* Associative Scenario Image Banner */}
              {!imgFailed && (
                <div className="relative -mx-4 -mt-4 mb-2.5 h-28 overflow-hidden rounded-t-3xl border-b border-slate-700/60">
                  <img
                    src={finalImageUrl}
                    alt={word.headword}
                    onError={() => setImgFailed(true)}
                    className="w-full h-full object-cover brightness-85"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent" />
                  <div className="absolute bottom-2 left-3 flex items-center space-x-1.5">
                    <Badge variant="emerald">{word.category}</Badge>
                  </div>
                </div>
              )}

              <div>
                {imgFailed && (
                  <div className="flex items-center justify-between mb-3">
                    <Badge variant={word.entryType === 'word' ? 'emerald' : 'purple'}>
                      {word.entryType === 'word' ? '單字' : '片語'}
                    </Badge>
                    <span className="text-xs text-slate-400">{word.category}</span>
                  </div>
                )}

                <div className="text-center">
                  <h2 className={`${headwordClass} text-slate-100 tracking-tight leading-tight`}>
                    {word.headword}
                  </h2>
                  {word.phoneticUS && (
                    <p className="text-sm font-mono text-emerald-400/90 mt-1">
                      /{word.phoneticUS}/
                    </p>
                  )}
                </div>

                {/* Roots Affixes preview on front */}
                {morphology && morphology.roots.length > 0 && (
                  <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                    {morphology.roots.map((r, rIdx) => (
                      <span key={rIdx} className="px-2 py-0.5 rounded-md bg-slate-950/70 border border-slate-700/70 text-[10px] text-amber-300 font-mono">
                        {r.part} <span className="text-slate-400">({r.meaning})</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Two-step calibration pre-confidence buttons */}
              <div className="space-y-2">
                <div className="flex flex-col items-center justify-center space-y-1">
                  <AudioButton headword={word.headword} audioUrl={word.audioUSUrl} size="md" />
                  <p className="text-[10px] text-slate-500">👈 左滑掌握 · 右滑忘記 👉</p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePreConfidenceSelect('unsure');
                    }}
                    className="flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl bg-slate-900/90 hover:bg-slate-750 border border-slate-700 text-slate-300 text-xs font-semibold active:scale-98 transition-all"
                  >
                    <HelpCircle size={14} className="text-amber-400" />
                    <span>🤔 沒印象 / 不熟</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePreConfidenceSelect('confident');
                    }}
                    className="flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-600/50 text-emerald-300 text-xs font-semibold active:scale-98 transition-all"
                  >
                    <Lightbulb size={14} className="text-emerald-400" />
                    <span>💡 我記得意思</span>
                  </button>
                </div>
              </div>

              <div className="text-center pt-1 border-t border-slate-800 text-[10px] text-slate-400 flex items-center justify-between">
                <span>{progress.reps > 0 ? `複習第 ${progress.reps} 次` : '新單字'}</span>
                <span className="text-emerald-400 font-medium">點擊翻面查看詳解與例句</span>
              </div>
            </div>

            {/* Card BACK (Clicking inside will NEVER flip back to front!) */}
            <div
              onClick={(e) => e.stopPropagation()}
              className={`absolute inset-0 w-full h-full bg-gradient-to-b from-slate-850 to-slate-900 border ${
                isStarred ? 'border-amber-500/50' : 'border-emerald-500/40'
              } rounded-3xl p-3.5 shadow-2xl flex flex-col justify-between [backface-visibility:hidden] [transform:rotateY(180deg)] overflow-hidden cursor-default`}
            >
              {/* Scrollable Container Inside Card (Smooth vertical reading with zero drag interference) */}
              <div className="space-y-2.5 overflow-y-auto max-h-[calc(100dvh-230px)] overscroll-contain touch-pan-y pr-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <Badge variant="emerald">{word.partsOfSpeech.join(', ')}</Badge>
                    <span className="text-xs text-slate-400">{word.category}</span>
                  </div>
                  <AudioButton headword={word.headword} audioUrl={word.audioUSUrl} size="sm" />
                </div>

                {/* Headword & Meaning */}
                <div>
                  <h3 className={`${headwordClass} text-slate-100`}>{word.headword}</h3>
                  <div className="mt-1 p-2 rounded-xl bg-slate-900/90 border border-slate-800">
                    <div className={`${definitionClass} text-emerald-300`}>
                      {word.definitionZh}
                    </div>
                  </div>
                </div>

                {/* 🧩 詞根詞綴與構詞記憶 */}
                {morphology && (
                  <div className="p-2.5 rounded-xl bg-slate-950/80 border border-amber-800/40 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-amber-400 font-bold text-[11px]">
                      <span className="flex items-center"><Layers size={12} className="mr-1" /> 詞根詞綴與構詞記憶</span>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {morphology.roots.map((r, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded bg-amber-950/40 border border-amber-700/50 text-[10px] text-amber-200">
                          <strong className="text-amber-300">{r.part}</strong>：{r.meaning}
                        </span>
                      ))}
                    </div>

                    <p className="text-slate-300 text-[11px] leading-relaxed pt-0.5">
                      💡 <strong>構詞記憶</strong>：{morphology.mnemonic}
                    </p>

                    {/* Word Family 派生詞 */}
                    {morphology.wordFamily && morphology.wordFamily.length > 1 && (
                      <div className="pt-1.5 border-t border-slate-800/80 space-y-1">
                        <div className="text-[10px] font-bold text-slate-400 flex items-center">
                          <GitBranch size={11} className="mr-1 text-emerald-400" /> 派生詞家族：
                        </div>
                        <div className="grid grid-cols-2 gap-1 text-[10px]">
                          {morphology.wordFamily.map((wf, wfIdx) => (
                            <div key={wfIdx} className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-200 truncate">
                              <strong className="text-emerald-400">{wf.word}</strong> <span className="text-slate-400">({wf.pos})</span> {wf.meaning}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 🌟 具象畫面感第一例句 (1:1 呼應配圖 · 記憶錨點) */}
                {currentExamples.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-slate-900/90 border border-emerald-500/30 text-xs space-y-2 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] text-emerald-400 font-bold tracking-wider flex items-center space-x-1">
                        <Sparkles size={11} className="text-amber-400 shrink-0" />
                        <span>專屬具象商務例句</span>
                      </div>
                      <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 text-[9px] text-emerald-300 border border-emerald-800/50 font-semibold inline-block">
                        🏢 {currentExamples[0]?.scenario || word.category || '商務溝通'}
                      </span>
                    </div>

                    {/* Hero Primary Example */}
                    <div
                      onClick={() => audioService.speakSentence(currentExamples[0]?.en || currentExamples[0]?.english || '')}
                      className="cursor-pointer hover:bg-slate-800/70 p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 transition-colors group"
                      title="點擊播放例句真人朗讀"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-slate-100 ${exampleEnClass} flex-1`}>
                          {currentExamples[0]?.en || currentExamples[0]?.english}
                        </p>
                        <Volume2 size={14} className="text-slate-400 group-hover:text-emerald-400 shrink-0 mt-0.5" />
                      </div>
                      <p className={`text-emerald-400/90 ${exampleZhClass} mt-1.5`}>
                        {currentExamples[0]?.zh || currentExamples[0]?.chinese}
                      </p>
                    </div>

                    {/* 進階延伸例句摺疊區 (可選展開) */}
                    {currentExamples.length > 1 && (
                      <div className="pt-1 border-t border-slate-800/60">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveTabExample(prev => prev === 0 ? 1 : 0);
                          }}
                          className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center justify-between w-full py-0.5 transition-colors font-medium"
                        >
                          <span className="flex items-center">
                            <BookOpen size={10} className="mr-1 text-slate-500" />
                            {activeTabExample > 0 ? '收起延伸例句' : '查看更多情境延伸例句...'}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                            {activeTabExample > 0 ? '收起' : `+${currentExamples.length - 1}`}
                          </span>
                        </button>

                        {activeTabExample > 0 && (
                          <div className="space-y-1.5 pt-1.5">
                            {currentExamples.slice(1).map((ex, idx) => (
                              <div
                                key={idx}
                                onClick={() => audioService.speakSentence(ex.en || ex.english || '')}
                                className="p-2 rounded-lg bg-slate-950/50 border border-slate-800/60 hover:bg-slate-800/50 cursor-pointer group"
                              >
                                <div className="flex items-start justify-between gap-1">
                                  <p className="text-slate-300 text-[11px] leading-relaxed">
                                    {ex.en || ex.english}
                                  </p>
                                  <Volume2 size={12} className="text-slate-500 group-hover:text-emerald-400 shrink-0 mt-0.5" />
                                </div>
                                <p className="text-slate-400 text-[10px] mt-0.5">
                                  {ex.zh || ex.chinese}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 多益考點搭配詞 */}
                {morphology && morphology.collocations && morphology.collocations.length > 0 && (
                  <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800 text-[11px] space-y-1">
                    <div className="text-[10px] text-emerald-400 font-bold">🎯 多益常考高頻搭配詞：</div>
                    <div className="flex flex-wrap gap-1">
                      {morphology.collocations.map((col, cIdx) => (
                        <span key={cIdx} className="px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 text-slate-300 text-[10px]">
                          {col}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Downgrade '記錯了' option if pre-confidence was confident */}
              {preConfidence === 'confident' && (
                <div className="pt-1 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRate(1);
                    }}
                    className="w-full py-1 px-2 rounded-xl bg-rose-950/60 hover:bg-rose-900/80 border border-rose-700/60 text-rose-300 text-xs font-bold flex items-center justify-center space-x-1.5 transition-colors"
                  >
                    <AlertCircle size={13} />
                    <span>💥 我記錯意思了！（直接排入忘記）</span>
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </SwipeableCard>
      </div>

      {/* Slide-Up FSRS Rating Bar (Visible ONLY when flipped, docked cleanly at bottom) */}
      <AnimatePresence>
        {isFlipped && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="space-y-1 pt-1 shrink-0 z-20"
          >
            <div className="grid grid-cols-3 gap-2">
              {/* 1. Again (忘記) */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRate(1);
                }}
                className="flex flex-col items-center justify-center p-2 rounded-2xl bg-rose-950/90 hover:bg-rose-900 active:scale-95 border border-rose-700 text-white shadow-lg min-h-[52px] transition-all"
              >
                <div className="text-xs font-black text-rose-300">💥 忘記 (1)</div>
                <div className="text-[10px] text-rose-200/80 font-mono mt-0.5">
                  {intervalPreviews[0]?.intervalText || '< 1分'}
                </div>
              </button>

              {/* 2. Hard (不熟) */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRate(2);
                }}
                className="flex flex-col items-center justify-center p-2 rounded-2xl bg-amber-950/90 hover:bg-amber-900 active:scale-95 border border-amber-700 text-white shadow-lg min-h-[52px] transition-all"
              >
                <div className="text-xs font-black text-amber-300">🤔 不熟 (2)</div>
                <div className="text-[10px] text-amber-200/80 font-mono mt-0.5">
                  {intervalPreviews[1]?.intervalText || '1天'}
                </div>
              </button>

              {/* 3. Good (掌握) */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRate(3);
                }}
                className="flex flex-col items-center justify-center p-2 rounded-2xl bg-emerald-950/90 hover:bg-emerald-900 active:scale-95 border border-emerald-600 text-white shadow-lg min-h-[52px] transition-all"
              >
                <div className="text-xs font-black text-emerald-300">💡 掌握 (3)</div>
                <div className="text-[10px] text-emerald-200/80 font-mono mt-0.5">
                  {intervalPreviews[2]?.intervalText || '3天'}
                </div>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Tools Modal (4 Great Lazy Tools) */}
      <Modal isOpen={isAiModalOpen} onClose={() => setIsAiModalOpen(false)} title={`🤖 AI 商務教練 · ${word.headword}`}>
        <div className="space-y-3.5 text-xs">
          {/* API Key Status & Inline Quick Config */}
          <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <span className="text-[11px] font-bold text-slate-300">AI 運算引擎：</span>
                {quickApiKey.trim() ? (
                  <span className="inline-flex items-center text-[10px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-700/60 px-2 py-0.5 rounded-full">
                    🟢 Google Gemini Live API 連線中
                  </span>
                ) : (
                  <span className="inline-flex items-center text-[10px] font-bold text-blue-400 bg-blue-950/60 border border-blue-800/60 px-2 py-0.5 rounded-full">
                    🔵 離線範本模式 (未設定 API Key)
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowApiKeyInput(prev => !prev)}
                className="text-[10px] text-amber-400 hover:text-amber-300 underline font-semibold flex items-center"
              >
                {showApiKeyInput ? '收合設定' : '🔑 設定/測試 API Key'}
              </button>
            </div>

            {/* Inline API Key Quick Input & Test */}
            {showApiKeyInput && (
              <div className="pt-2 border-t border-slate-800/80 space-y-2 animate-in fade-in duration-150">
                <p className="text-[10px] text-slate-400">
                  Google AI Studio 每日提供 1,500 次免費請求。貼上您的 Key 即可啟用 Gemini 2.0 大模型即時運算：
                </p>
                <div className="flex space-x-1.5">
                  <input
                    type="password"
                    placeholder="貼上 AIzaSy..."
                    value={quickApiKey}
                    onChange={(e) => setQuickApiKey(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs font-mono focus:outline-none focus:border-emerald-500"
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={testingApiKey || !quickApiKey.trim()}
                    onClick={handleTestAndSaveApiKey}
                  >
                    {testingApiKey ? <Loader2 size={13} className="animate-spin" /> : '測試並儲存'}
                  </Button>
                </div>

                {apiKeyTestResult && (
                  <div className={`p-2 rounded-lg text-[10px] ${
                    apiKeyTestResult.success ? 'bg-emerald-950/80 border border-emerald-700 text-emerald-300' : 'bg-rose-950/80 border border-rose-700 text-rose-300'
                  }`}>
                    {apiKeyTestResult.message}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-900 p-1 border border-slate-700">
            <button
              type="button"
              onClick={() => setAiModalType('mnemonic')}
              className={`py-1.5 rounded-lg font-bold transition-colors ${
                aiModalType === 'mnemonic' ? 'bg-emerald-600 text-white' : 'text-slate-400'
              }`}
            >
              💡 1秒記憶故事
            </button>
            <button
              type="button"
              onClick={() => setAiModalType('instant_quiz')}
              className={`py-1.5 rounded-lg font-bold transition-colors ${
                aiModalType === 'instant_quiz' ? 'bg-emerald-600 text-white' : 'text-slate-400'
              }`}
            >
              🎯 1鍵考我一題
            </button>
            <button
              type="button"
              onClick={() => setAiModalType('sentence')}
              className={`py-1.5 rounded-lg font-bold transition-colors ${
                aiModalType === 'sentence' ? 'bg-emerald-600 text-white' : 'text-slate-400'
              }`}
            >
              ✍️ 商務造句批改
            </button>
            <button
              type="button"
              onClick={() => setAiModalType('nuance')}
              className={`py-1.5 rounded-lg font-bold transition-colors ${
                aiModalType === 'nuance' ? 'bg-emerald-600 text-white' : 'text-slate-400'
              }`}
            >
              🔍 易混淆詞對比
            </button>
          </div>

          {/* 1. 1-Click Mnemonic Story */}
          {aiModalType === 'mnemonic' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[11px]">結合字根字首與現代職場情境：</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loadingMnemonic}
                  onClick={handleGenerateMnemonic}
                  className="py-0.5 px-2 text-[10px]"
                >
                  {loadingMnemonic ? <Loader2 size={11} className="animate-spin" /> : <><Sparkles size={11} className="mr-1 text-amber-400" /> 重新生成</>}
                </Button>
              </div>

              {aiMnemonicText && (
                <div className="p-3.5 rounded-xl bg-slate-900 border border-amber-800/40 text-slate-200 text-xs leading-relaxed space-y-1.5">
                  <div className="flex items-center justify-between text-amber-400 font-bold">
                    <span className="flex items-center"><Sparkles size={13} className="mr-1" /> 專屬商務記憶故事：</span>
                    {aiMnemonicText.isLiveAi && (
                      <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.2 rounded font-mono">
                        ✨ Live: {aiMnemonicText.modelUsed}
                      </span>
                    )}
                  </div>
                  <p className="pt-1 text-slate-200 leading-relaxed font-medium">{aiMnemonicText.mnemonic}</p>
                </div>
              )}
            </div>
          )}

          {/* 2. 1-Click Instant Part 5 Question */}
          {aiModalType === 'instant_quiz' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[11px]">
                  核心單字：<strong className="text-emerald-400">{word.headword}</strong>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loadingAiQuiz}
                  onClick={handleGenerateInstantQuiz}
                  className="py-0.5 px-2 text-[10px]"
                >
                  {loadingAiQuiz ? <Loader2 size={11} className="animate-spin" /> : <><Target size={11} className="mr-1 text-blue-400" /> 重新出題</>}
                </Button>
              </div>

              {aiQuizItem && (
                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-700 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-bold">多益 Part 5 擬真考題</span>
                    {aiQuizItem.isLiveAi && (
                      <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.2 rounded font-mono">
                        ✨ Live: {aiQuizItem.modelUsed}
                      </span>
                    )}
                  </div>

                  <p className="font-bold text-slate-100 text-sm leading-snug">{aiQuizItem.stem}</p>

                  {/* 🌟 答題後浮現題幹中文翻譯 */}
                  {aiQuizSelectedOpt !== null && aiQuizItem.stemTranslation && (
                    <div className="p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-700/60 text-emerald-200 text-xs text-left leading-relaxed animate-in fade-in duration-200">
                      <span className="text-[10px] text-emerald-400 font-bold block mb-0.5">📖 繁中題幹翻譯：</span>
                      {aiQuizItem.stemTranslation}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    {aiQuizItem.options.map((opt, oIdx) => {
                      const analysis = aiQuizItem.optionAnalyses?.find(a => a.option === opt);
                      const isAnswered = aiQuizSelectedOpt !== null;
                      const isCorrect = opt === aiQuizItem.answer;
                      const isSelected = aiQuizSelectedOpt === oIdx;

                      let btnStyle = 'bg-slate-800/80 border-slate-700 text-slate-200';
                      if (isAnswered) {
                        if (isCorrect) {
                          btnStyle = 'bg-emerald-950/90 border-emerald-500 text-emerald-200 shadow-md shadow-emerald-950/40';
                        } else if (isSelected) {
                          btnStyle = 'bg-rose-950/90 border-rose-500 text-rose-200 shadow-md shadow-rose-950/40';
                        } else {
                          btnStyle = 'bg-slate-900/70 border-slate-800 text-slate-400 opacity-70';
                        }
                      }

                      return (
                        <button
                          key={oIdx}
                          type="button"
                          disabled={isAnswered}
                          onClick={() => setAiQuizSelectedOpt(oIdx)}
                          className={`w-full p-2.5 rounded-xl border text-left font-semibold transition-all flex items-start justify-between ${btnStyle}`}
                        >
                          <div className="flex flex-col space-y-1 text-left w-full pr-2">
                            <div className="flex items-center space-x-2">
                              <span className="text-slate-400 font-mono text-xs">{String.fromCharCode(65 + oIdx)}.</span>
                              <span className="font-bold text-sm text-slate-100">{opt}</span>
                              {isAnswered && isCorrect && (
                                <Badge variant="emerald">正確答案</Badge>
                              )}
                            </div>

                            {/* 🌟 答題後顯示選項中文、詞性與詳解 */}
                            {isAnswered && analysis && (
                              <div className="text-[11px] font-normal leading-relaxed pl-5 text-slate-300 animate-in fade-in duration-150">
                                {analysis.explanation}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {aiQuizSelectedOpt !== null && (
                    <div className="pt-2 border-t border-slate-800 space-y-1.5">
                      <div className="text-[11px] text-amber-400 font-bold">💡 考點解析：</div>
                      <p className="text-slate-300 text-[11px] leading-relaxed">{aiQuizItem.explanation}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 3. Sentence Writing Coach */}
          {aiModalType === 'sentence' && (
            <div className="space-y-3">
              <p className="text-slate-400 leading-relaxed">
                用 <span className="text-emerald-400 font-bold">{word.headword}</span> 寫一句商務英文，AI 即時評分並提供高階潤飾：
              </p>

              <form onSubmit={handleEvaluateSentenceSubmit} className="space-y-2">
                <textarea
                  value={userSentenceInput}
                  onChange={(e) => setUserSentenceInput(e.target.value)}
                  placeholder={`例如：Our team will ${word.headword} the client's request...`}
                  rows={3}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono text-xs"
                />
                <Button type="submit" size="sm" fullWidth variant="primary" disabled={evaluatingSentence || !userSentenceInput.trim()}>
                  {evaluatingSentence ? <><Loader2 size={14} className="animate-spin mr-1.5" /> 正在呼叫 Gemini 批改...</> : <><Send size={14} className="mr-1.5" /> 送出批改</>}
                </Button>
              </form>

              {sentenceResult && (
                <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-700 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-200">得分：<span className="text-emerald-400 text-base">{sentenceResult.score}</span> / 10</span>
                    {sentenceResult.isLiveAi && (
                      <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.2 rounded font-mono">
                        ✨ Live: {sentenceResult.modelUsed}
                      </span>
                    )}
                  </div>
                  <p className="text-slate-300 leading-relaxed">{sentenceResult.feedback}</p>
                  
                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    <div className="text-[10px] text-emerald-400 font-bold">✨ 高階商務潤飾句：</div>
                    <div className="p-2 rounded bg-slate-950/80 text-slate-200 font-medium">
                      💼 {sentenceResult.betterVersions.formal}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 4. Nuance Explainer */}
          {aiModalType === 'nuance' && (
            <div className="space-y-3">
              <p className="text-slate-400 leading-relaxed">
                輸入你想與 <span className="text-emerald-400 font-bold">{word.headword}</span> 比較的同義詞或易混淆詞：
              </p>

              <form onSubmit={handleEvaluateNuanceSubmit} className="flex space-x-2">
                <input
                  type="text"
                  value={nuanceCompareWord}
                  onChange={(e) => setNuanceCompareWord(e.target.value)}
                  placeholder="例如：benefit, edge, merit..."
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
                />
                <Button type="submit" size="sm" variant="primary" disabled={evaluatingNuance || !nuanceCompareWord.trim()}>
                  {evaluatingNuance ? <Loader2 size={14} className="animate-spin" /> : '對比'}
                </Button>
              </form>

              {nuanceResult && (
                <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-700 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-200">近義詞微細差異分析</span>
                    {nuanceResult.isLiveAi && (
                      <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.2 rounded font-mono">
                        ✨ Live: {nuanceResult.modelUsed}
                      </span>
                    )}
                  </div>
                  <p className="text-slate-300 font-medium">{nuanceResult.summary}</p>
                  <div className="space-y-1.5 pt-1">
                    {nuanceResult.differences.map((diff, idx) => (
                      <div key={idx} className="p-2 rounded bg-slate-950/80 space-y-1">
                        <div className="text-[10px] text-amber-400 font-bold">{diff.aspect}</div>
                        <div className="text-slate-300"><span className="text-emerald-400 font-bold">{word.headword}：</span>{diff.word1Usage}</div>
                        <div className="text-slate-300"><span className="text-blue-400 font-bold">{nuanceCompareWord}：</span>{diff.word2Usage}</div>
                      </div>
                    ))}
                  </div>
                  <div className="p-2 rounded-lg bg-amber-950/30 border border-amber-800/40 text-amber-200 text-[11px]">
                    💡 {nuanceResult.toeicTrapTip}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
