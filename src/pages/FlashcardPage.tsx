import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Star,
  Sparkles,
  X,
  Shuffle,
  AlertCircle,
  HelpCircle,
  Lightbulb,
  Volume2,
  Bot,
  Send,
  Loader2,
  Layers,
  GitBranch,
  Target,
  ChevronDown,
  ChevronUp
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
import { WordQuickPeekModal } from '../components/ui/WordQuickPeekModal';
import { db } from '../db';

interface StudyItem {
  word: Word;
  progress: Progress;
}

interface ClickableSentenceProps {
  text: string;
  className?: string;
  onWordClick: (word: string) => void;
}

const ClickableSentence: React.FC<ClickableSentenceProps> = ({ text, className = '', onWordClick }) => {
  const tokens = text.match(/([a-zA-Z0-9'\-]+|[^a-zA-Z0-9'\-]+)/g) || [text];

  return (
    <span className={className}>
      {tokens.map((token, i) => {
        const isWord = /^[a-zA-Z0-9'\-]+$/.test(token) && token.length > 1;
        if (!isWord) {
          return <span key={i}>{token}</span>;
        }
        return (
          <span
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              onWordClick(token);
            }}
            className="hover:text-emerald-300 hover:underline cursor-pointer transition-colors active:opacity-75"
            title={`點擊速查「${token}」`}
          >
            {token}
          </span>
        );
      })}
    </span>
  );
};

const formatWordFamilyItem = (raw: string) => {
  const head = raw.trim().replace(/^[•\-\*\s]+/, '').split(/[\s,()（）:]+/)[0];
  let zh = '';
  if (raw.includes('(') || raw.includes('（')) {
    const match = raw.match(/[\(（]([^\)）]+)[\)）]/);
    if (match) zh = match[1];
  } else if (raw.includes(' ')) {
    const parts = raw.trim().split(/\s+/);
    if (parts.length > 1 && /[\u4e00-\u9fa5]/.test(parts.slice(1).join(''))) {
      zh = parts.slice(1).join('');
    }
  }
  return { head, zh };
};

export const FlashcardPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { activeProfile } = useProfile();
  const { syncState } = useSync();
  const { zoomIn, zoomOut, currentPreset, pixelMetrics, headwordClass, definitionClass, exampleEnClass, exampleZhClass, supportingClass } = useTypography();

  const courseId = searchParams.get('courseId');

  const [queue, setQueue] = useState<StudyItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isStarred, setIsStarred] = useState(false);
  const [intervalPreviews, setIntervalPreviews] = useState<IntervalPreviewItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [imgFailed, setImgFailed] = useState(false);
  const [resumedNotice, setResumedNotice] = useState<string | null>(null);
  const [showProgressPopover, setShowProgressPopover] = useState(false);
  const cardBackScrollRef = useRef<HTMLDivElement>(null);

  // Micro-sessions & Filters
  const [batchSize, setBatchSize] = useState<number>(20);
  const [isShuffle, setIsShuffle] = useState<boolean>(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [preConfidence, setPreConfidence] = useState<'confident' | 'unsure' | null>(null);

  // Morphology & Word Family
  const [morphology, setMorphology] = useState<MorphologyInfo | null>(null);

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

  // Word Quick Peek Modal State (Derivative & Synonym interactive flashcard)
  const [peekWord, setPeekWord] = useState<Word | null>(null);
  const [isPeekOpen, setIsPeekOpen] = useState(false);
  const [showFullExamTips, setShowFullExamTips] = useState(false);

  const handleOpenPeekWord = useCallback(async (rawTerm: string) => {
    const clean = rawTerm.trim().toLowerCase().replace(/^[•\-\*\s]+/, '').split(/[\s,()（）:]+/)[0];
    if (!clean) return;

    try {
      const target = clean.toLowerCase();
      // 1. Check local active course in IndexedDB
      let found = await db.words.where('normalizedHeadword').equals(target).first()
        || await db.words.filter(w => w.headword.toLowerCase() === target).first();

      // 2. Cross-Course Master Dictionary Lookup (All 11,154 Words)
      if (!found) {
        found = (await courseRepository.findGlobalMasterWord(target)) || undefined;
      }

      if (found) {
        setPeekWord(found);
        setIsPeekOpen(true);
      } else {
        // Extract Chinese translation from string if available (e.g. "agendum (少用)" -> "少用")
        const extractedZh = rawTerm.includes('(') || rawTerm.includes('（') || rawTerm.includes(' ')
          ? rawTerm.replace(/^[a-zA-Z\s\-]+/, '').replace(/^[\(（\s]+/, '').replace(/[\)）\s]+$/, '')
          : '';

        setPeekWord({
          id: `peek-${clean}`,
          headword: clean,
          normalizedHeadword: target,
          entryType: 'word',
          definitionZh: extractedZh || '延伸單字',
          starRating: 3,
          toeicScoreRange: '550-750',
          category: '延伸補充',
          partsOfSpeech: ['衍生詞'],
          wordForms: [],
          phoneticUS: null,
          phoneticUK: null,
          examples: [],
          examTips: [],
          audioUSUrl: null,
          audioUKUrl: null
        });
        setIsPeekOpen(true);
      }
    } catch (err) {
      console.warn('Word peek fallback:', err);
      setPeekWord({
        id: `peek-${clean}`,
        headword: clean,
        normalizedHeadword: clean.toLowerCase(),
        entryType: 'word',
        definitionZh: '延伸單字',
        starRating: 3,
        toeicScoreRange: '550-750',
        category: '延伸補充',
        partsOfSpeech: ['衍生詞'],
        wordForms: [],
        phoneticUS: null,
        phoneticUK: null,
        examples: [],
        examTips: [],
        audioUSUrl: null,
        audioUKUrl: null
      });
      setIsPeekOpen(true);
    }
  }, []);

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

        // 3. Fallback: Auto-load default core 1,200 course if local DB is clean
        if (items.length === 0) {
          try {
            await courseRepository.downloadAndSaveCourse('course-core-1200', 'course-core-1200.json');
            const autoWords = await progressRepository.getNewWordsForCourse(
              profileId,
              'course-core-1200',
              batchSize,
              { category: selectedCategory, shuffle: isShuffle }
            );
            items.push(...autoWords);
          } catch (autoErr) {
            console.warn('[FlashcardPage] Auto-download fallback error:', autoErr);
          }
        }
      }

      // Check saved review session in localStorage (valid for 24 hours)
      const sessionKey = `toeic_active_review_${profileId}_${courseId || 'all'}`;
      let restoredIndex = 0;
      try {
        const raw = localStorage.getItem(sessionKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
            restoredIndex = parsed.currentIndex || 0;
          }
        }
      } catch {}

      setQueue(items);

      if (restoredIndex > 0 && restoredIndex < items.length) {
        setCurrentIndex(restoredIndex);
        setResumedNotice(`已為您恢復進度：第 ${restoredIndex + 1} / ${items.length} 詞 ↩️`);
        setShowProgressPopover(true);
      } else {
        setCurrentIndex(0);
      }

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

  // Auto-dismiss resumedNotice & popover after 4s
  useEffect(() => {
    if (resumedNotice || showProgressPopover) {
      const t = setTimeout(() => {
        setResumedNotice(null);
        setShowProgressPopover(false);
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [resumedNotice, showProgressPopover]);

  // Auto-save review session progress
  useEffect(() => {
    if (queue.length > 0 && !isLoading && activeProfile) {
      const sessionKey = `toeic_active_review_${activeProfile.id}_${courseId || 'all'}`;
      try {
        localStorage.setItem(sessionKey, JSON.stringify({
          currentIndex,
          timestamp: Date.now()
        }));
      } catch {}
    }
  }, [currentIndex, queue.length, isLoading, activeProfile, courseId]);

  const handleRestartReviewFromBeginning = () => {
    if (activeProfile) {
      const sessionKey = `toeic_active_review_${activeProfile.id}_${courseId || 'all'}`;
      try { localStorage.removeItem(sessionKey); } catch {}
    }
    setCurrentIndex(0);
    setIsFlipped(false);
    setResumedNotice(null);
  };

  const currentItem = queue[currentIndex];

  useEffect(() => {
    if (currentItem && activeProfile) {
      setIsStarred(Boolean(currentItem.progress.isStarred));
      setIsFlipped(false);
      setShowFullExamTips(false);
      setPreConfidence(null);
      setImgFailed(false);
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

      // Triple-layer instant scroll reset to top for new card
      requestAnimationFrame(() => {
        cardBackScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
        document.querySelector('main')?.scrollTo({ top: 0, behavior: 'instant' });
        window.scrollTo({ top: 0, behavior: 'instant' });
      });
    }
  }, [currentIndex, queue, activeProfile, currentItem]);

  const handleToggleStar = async () => {
    if (!currentItem || !activeProfile) return;
    const newStar = await progressRepository.toggleStarred(activeProfile.id, currentItem.word.id);
    setIsStarred(newStar);
  };

  const handleFlipCard = useCallback(() => {
    setIsFlipped(prev => {
      if (!prev) {
        // Flipping to back: ensure view starts at top
        requestAnimationFrame(() => {
          cardBackScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
          document.querySelector('main')?.scrollTo({ top: 0, behavior: 'instant' });
          window.scrollTo({ top: 0, behavior: 'instant' });
        });
      }
      return !prev;
    });
  }, []);

  const handlePreConfidenceSelect = (type: 'confident' | 'unsure') => {
    setPreConfidence(type);
    setIsFlipped(true);
    requestAnimationFrame(() => {
      cardBackScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
      document.querySelector('main')?.scrollTo({ top: 0, behavior: 'instant' });
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
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
        if (cardBackScrollRef.current) {
          cardBackScrollRef.current.scrollTop = 0;
        }
        setCurrentIndex(prev => prev + 1);
      } else {
        // Session completed!
        if (activeProfile) {
          const sessionKey = `toeic_active_review_${activeProfile.id}_${courseId || 'all'}`;
          try { localStorage.removeItem(sessionKey); } catch {}
        }
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

  // Empty queue screen (No words in queue)
  if (queue.length === 0) {
    return (
      <div className="min-h-[70dvh] flex flex-col justify-center items-center max-w-sm mx-auto text-center space-y-4 px-4">
        <div className="w-16 h-16 rounded-3xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
          <Sparkles size={32} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-100">本機尚未下載題庫或已無新單字</h2>
          <p className="text-xs text-slate-400 mt-1">請點擊下方按鈕一鍵載入高頻核心 1,200 詞題庫。</p>
        </div>
        <div className="w-full space-y-2 pt-2">
          <Button
            size="lg"
            fullWidth
            variant="primary"
            onClick={async () => {
              setIsLoading(true);
              try {
                await courseRepository.downloadAndSaveCourse('course-core-1200', 'course-core-1200.json');
                await loadStudyQueue();
              } catch (err) {
                alert('載入失敗：' + (err as Error).message);
              } finally {
                setIsLoading(false);
              }
            }}
          >
            🔥 立即載入核心 1,200 必考題庫
          </Button>
          <Button size="md" fullWidth variant="outline" onClick={() => navigate('/catalog')}>
            前往課程目錄挑選
          </Button>
        </div>
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
    <div className="flex flex-col h-full justify-between w-full max-w-md mx-auto space-y-1 pb-1 select-none overscroll-y-contain touch-pan-y overflow-x-hidden">
      {/* 🚀 Unified Immersive Study Header (Never overflows, 100% symmetrically centered) */}
      <div className="relative z-50 flex items-center justify-between w-full bg-slate-800/85 backdrop-blur-md border border-slate-750 rounded-2xl px-2 py-1 shadow-sm shrink-0 text-xs gap-1">
        {/* Left: Exit button + Interactive Progress Pill with Popover */}
        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="p-1 rounded-full text-slate-400 hover:text-slate-100 hover:bg-slate-700/60 transition-colors"
            aria-label="離開複習"
            title="退出複習"
          >
            <X size={16} />
          </button>

          {/* Interactive Progress Pill (Tap to toggle bubble popover) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowProgressPopover(prev => !prev)}
              className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-600/60 text-emerald-300 font-bold text-[11px] shadow-sm transition-all active:scale-95 cursor-pointer"
              title="點擊查看進度與重新開始"
            >
              <span>{currentIndex + 1}</span>
              <span className="text-emerald-500/70">/</span>
              <span>{queue.length}</span>
              <span className="text-[8px] text-emerald-400/80 ml-0.5">▾</span>
            </button>

            {/* Bubble Popover right beneath progress pill (100% Solid Opaque Pitch-Black) */}
            <AnimatePresence>
              {(resumedNotice || showProgressPopover) && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  style={{ backgroundColor: '#020617', opacity: 1 }}
                  className="absolute top-full left-0 mt-2.5 z-[100] min-w-[220px] p-3.5 rounded-2xl bg-slate-950 border-2 border-emerald-500 shadow-[0_12px_40px_rgba(0,0,0,0.95)] flex flex-col space-y-2.5"
                >
                  {/* Upward triangle caret pointing to progress pill */}
                  <div
                    style={{ backgroundColor: '#020617' }}
                    className="absolute -top-1.5 left-6 w-3 h-3 bg-slate-950 border-t-2 border-l-2 border-emerald-500 transform rotate-45"
                  />

                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-emerald-400 flex items-center">
                      <Sparkles size={12} className="mr-1 text-emerald-400" />
                      學習進度
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setResumedNotice(null);
                        setShowProgressPopover(false);
                      }}
                      className="text-slate-400 hover:text-slate-100 p-0.5"
                    >
                      <X size={13} />
                    </button>
                  </div>

                  <p className="text-xs text-slate-100 font-bold leading-relaxed">
                    {resumedNotice || `目前進度：第 ${currentIndex + 1} / ${queue.length} 詞`}
                  </p>

                  <div className="flex items-center space-x-2 pt-1 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        handleRestartReviewFromBeginning();
                        setResumedNotice(null);
                        setShowProgressPopover(false);
                      }}
                      className="flex-1 py-1 px-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-white text-[11px] font-bold transition-colors text-center shadow-sm"
                    >
                      從第 1 詞開始 ↺
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px] text-slate-300">
                    <span className="text-[10px] text-slate-400 font-medium">每節題量：</span>
                    <div className="flex items-center space-x-1">
                      {[15, 20, 30].map((size) => (
                        <button
                          key={size}
                          type="button"
                          onClick={() => {
                            setBatchSize(size);
                            setShowProgressPopover(false);
                          }}
                          className={`px-2 py-0.5 rounded-md font-bold text-[10px] transition-colors ${
                            batchSize === size
                              ? 'bg-emerald-600 text-white shadow-sm'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {size}字
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Center: Clean Category Dropdown */}
        <div className="flex-1 min-w-0 max-w-[125px] flex items-center justify-center px-0.5">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            aria-label="主題篩選"
            className="w-full truncate bg-slate-900/90 border border-slate-700/80 rounded-lg px-2 py-0.5 text-[11px] text-slate-300 font-medium focus:outline-none text-center cursor-pointer"
          >
            <option value="all" className="bg-slate-900">全部商務主題</option>
            {availableCategories.map(cat => (
              <option key={cat} value={cat} className="bg-slate-900">{cat}</option>
            ))}
          </select>
        </div>

        {/* Right: Quick Action Controls (Font, Shuffle, Star, AI) */}
        <div className="flex items-center space-x-1 shrink-0">
          {/* Quick Font Size Stepper (A- / A+) */}
          <div className="flex items-center bg-slate-900/90 border border-slate-700/80 rounded-lg px-1 py-0.5 space-x-0.5">
            <button
              type="button"
              onClick={zoomOut}
              disabled={currentPreset === 'compact'}
              className="text-[10px] font-bold px-0.5 text-slate-400 hover:text-emerald-400 disabled:opacity-30 transition-colors"
              title="縮小字體"
            >
              A-
            </button>
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

          {/* Shuffle Toggle */}
          <button
            type="button"
            onClick={() => setIsShuffle(prev => !prev)}
            aria-label={isShuffle ? '隨機洗牌已開啟' : '順序模式'}
            className={`p-1.5 rounded-lg text-xs font-semibold transition-colors ${
              isShuffle ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40' : 'bg-slate-900/90 text-slate-400 border border-slate-700/70'
            }`}
            title={isShuffle ? '隨機洗牌中' : '順序'}
          >
            <Shuffle size={13} />
          </button>

          {/* Star Button */}
          <button
            type="button"
            onClick={handleToggleStar}
            aria-label={isStarred ? '取消收藏' : '收藏單字'}
            className="p-1 text-slate-400 hover:text-amber-400 transition-colors"
            title="收藏"
          >
            <Star size={15} className={isStarred ? 'fill-amber-400 text-amber-400' : ''} />
          </button>

          {/* AI Coach */}
          <button
            type="button"
            onClick={() => setIsAiModalOpen(true)}
            className="p-1 rounded-lg text-amber-400 hover:text-amber-300 bg-amber-950/40 border border-amber-800/40 transition-colors"
            title="AI 商務教練"
          >
            <Bot size={13} />
          </button>
        </div>
      </div>

      {/* Swipeable 3D Flashcard */}
      <div className="relative z-10 flex-1 flex flex-col min-h-0 py-0.5">
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
              {/* Associative Scenario Image Banner (Enlarged & uncropped 1:1 view) */}
              {!imgFailed && (
                <div className="relative -mx-4 -mt-4 mb-2.5 h-48 sm:h-52 overflow-hidden rounded-t-3xl border-b border-slate-700/60 shrink-0">
                  <img
                    src={finalImageUrl}
                    alt={word.headword}
                    onError={() => setImgFailed(true)}
                    className="w-full h-full object-cover object-center brightness-90 contrast-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent" />
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

                {/* Click Word Title to Pronounce */}
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    audioService.playWord({
                      headword: word.headword,
                      audioUrl: word.audioUSUrl || word.audioUKUrl
                    });
                  }}
                  className="text-center cursor-pointer group active:scale-98 transition-transform select-none py-1"
                  title="點擊單字直接發音"
                >
                  <h2 className={`${headwordClass} text-slate-100 tracking-tight leading-tight group-hover:text-emerald-300 transition-colors flex items-center justify-center`}>
                    {word.headword}
                    <Volume2 size={16} className="ml-2 text-emerald-400/60 group-hover:text-emerald-400 transition-all shrink-0" />
                  </h2>
                  {word.phoneticUS && (
                    <p className={`${supportingClass} font-mono text-emerald-400/90 mt-1`}>
                      /{word.phoneticUS}/
                    </p>
                  )}

                  {/* Inflection / Tenses / Forms Capsule on Front */}
                  {((word.inflections && (word.inflections.s || word.inflections.ed || word.inflections.ing)) || (word.wordForms && word.wordForms.length > 0)) && (
                    <div className="mt-2 flex flex-wrap justify-center items-center gap-1 text-[10px]">
                      <span className="px-2.5 py-0.5 rounded-full bg-slate-950/70 border border-emerald-500/40 text-emerald-300 font-mono flex items-center space-x-1 shadow-sm">
                        <span className="text-[9px] text-slate-400 font-sans">形態:</span>
                        <span>
                          {word.inflections
                            ? [word.inflections.s, word.inflections.ed, word.inflections.ing].filter(Boolean).join(' · ')
                            : word.wordForms?.[0]?.forms?.slice(1).join(' · ')}
                        </span>
                      </span>
                    </div>
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
              className={`absolute inset-0 w-full h-full bg-slate-900 border ${
                isStarred ? 'border-amber-500/50' : 'border-emerald-500/40'
              } rounded-3xl shadow-2xl flex flex-col justify-between [backface-visibility:hidden] [transform:rotateY(180deg)] overflow-hidden cursor-default`}
            >
              {/* Scrollable Container Inside Card (Edge-to-edge top image, smooth non-blocking vertical scroll) */}
              <div
                ref={cardBackScrollRef}
                style={{ WebkitOverflowScrolling: 'touch', willChange: 'scroll-position', touchAction: 'pan-y' }}
                className="overflow-y-auto overflow-x-hidden flex-1 min-h-0 overscroll-y-contain touch-pan-y"
              >
                {/* 🌟 具象商務情境圖片橫幅 (頂部左右 100% 貼齊外框 · 圓角契合 · 零溢出) */}
                {!imgFailed && (
                  <div className="relative w-full h-48 sm:h-52 overflow-hidden rounded-t-3xl border-b border-slate-700/60 shrink-0">
                    <img
                      src={finalImageUrl}
                      alt={word.headword}
                      onError={() => setImgFailed(true)}
                      className="w-full h-full object-cover object-center brightness-90 contrast-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/20 to-transparent" />
                  </div>
                )}

                {/* Text Content Body (Consistent padding & native smooth scrolling) */}
                <div className="p-3.5 space-y-3 touch-pan-y select-none" style={{ touchAction: 'pan-y' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5">
                      <Badge variant="emerald">{word.partsOfSpeech.join(', ')}</Badge>
                      <span className="text-xs text-slate-400">{word.category}</span>
                    </div>
                    <AudioButton headword={word.headword} audioUrl={word.audioUSUrl} size="sm" />
                  </div>

                  {/* Headword & Meaning (Click word to pronounce) */}
                  <div>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        audioService.playWord({
                          headword: word.headword,
                          audioUrl: word.audioUSUrl || word.audioUKUrl
                        });
                      }}
                      className="cursor-pointer group select-none touch-pan-y"
                      style={{ touchAction: 'pan-y' }}
                      title="點擊單字直接發音"
                    >
                      <h3 className={`${headwordClass} text-slate-100 group-hover:text-emerald-300 transition-colors flex items-center`}>
                        {word.headword}
                        <Volume2 size={16} className="ml-2 text-emerald-400/60 group-hover:text-emerald-400 transition-all shrink-0" />
                      </h3>
                    </div>
                    <div className="mt-1 p-2 rounded-xl bg-slate-900/90 border border-slate-800 touch-pan-y" style={{ touchAction: 'pan-y' }}>
                      <div className={`${definitionClass} text-emerald-300`}>
                        {word.definitionZh}
                      </div>
                    </div>
                  </div>

                  {/* 🌟 1. 核心專屬具象商務例句 (第一記憶錨點) */}
                  {currentExamples.length > 0 && (
                    <div className="p-3 rounded-2xl bg-slate-900/90 border border-emerald-500/30 text-xs space-y-2 shadow-sm touch-pan-y select-none" style={{ touchAction: 'pan-y' }}>
                      <div className="flex items-center justify-between">
                        <div className="text-[10px] text-emerald-400 font-bold tracking-wider flex items-center space-x-1">
                          <Sparkles size={11} className="text-amber-400 shrink-0" />
                          <span>核心商務例句</span>
                        </div>
                        <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 text-[9px] text-emerald-300 border border-emerald-800/50 font-semibold inline-block">
                          🏢 {currentExamples[0]?.scenario || word.category || '商務溝通'}
                        </span>
                      </div>

                      <div
                        onClick={() => audioService.speakSentence(currentExamples[0]?.en || currentExamples[0]?.english || '')}
                        className="cursor-pointer hover:bg-slate-800/70 p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 transition-colors group touch-pan-y"
                        style={{ touchAction: 'pan-y' }}
                        title="點擊播放例句真人朗讀"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-slate-100 ${exampleEnClass} flex-1`}>
                            <ClickableSentence
                              text={currentExamples[0]?.en || currentExamples[0]?.english || ''}
                              onWordClick={handleOpenPeekWord}
                            />
                          </p>
                          <Volume2 size={13} className="text-slate-400 group-hover:text-emerald-400 shrink-0 mt-0.5" />
                        </div>
                        <p className={`text-emerald-400/90 ${exampleZhClass} mt-1`}>
                          {currentExamples[0]?.zh || currentExamples[0]?.chinese}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* 🎯 2. 多益考點與避坑提醒 (examFocus) */}
                  {word.examFocus && (
                    <div className="p-3 rounded-2xl bg-indigo-950/40 border border-indigo-700/50 space-y-1.5 shadow-sm touch-pan-y select-none" style={{ touchAction: 'pan-y' }}>
                      <div className="text-indigo-300 font-bold" style={{ fontSize: `${Math.max(14, pixelMetrics.supportingPx + 1)}px` }}>
                        <span>🎯 多益核心考點：{word.examFocus.primaryBusinessSense}</span>
                      </div>
                      {word.examFocus.trapWarning && (
                        <p className="text-amber-300/90 leading-relaxed" style={{ fontSize: `${Math.max(13, pixelMetrics.supportingPx)}px` }}>
                          ⚠️ <strong>考場避坑</strong>：{word.examFocus.trapWarning}
                        </p>
                      )}
                    </div>
                  )}

                  {/* 🔗 3. 常考商務搭配語塊 (collocations - 取代舊版套版搭配詞) */}
                  {word.collocations && word.collocations.length > 0 && (
                    <div className="p-3 rounded-2xl bg-slate-950/80 border border-teal-800/50 space-y-2 shadow-sm touch-pan-y select-none" style={{ touchAction: 'pan-y' }}>
                      <div className="text-teal-400 font-bold flex items-center justify-between" style={{ fontSize: `${Math.max(14, pixelMetrics.supportingPx + 1)}px` }}>
                        <span>🔗 常考商務搭配語塊 (Collocations)</span>
                        <span className="text-teal-500/80 font-semibold" style={{ fontSize: `${Math.max(11, pixelMetrics.supportingPx - 1)}px` }}>必考黃金語塊</span>
                      </div>
                      <div className="grid grid-cols-1 gap-1.5">
                        {word.collocations.map((c: any, cIdx: number) => (
                          <div
                            key={cIdx}
                            style={{ touchAction: 'pan-y' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              audioService.speakSentence(c.en);
                            }}
                            className="px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-850 border border-slate-800 hover:border-teal-700/60 cursor-pointer flex items-center justify-between touch-pan-y group transition-colors"
                            title="點擊朗讀此搭配詞"
                          >
                            <span className="text-emerald-300 font-bold flex items-center" style={{ fontSize: `${Math.max(14, pixelMetrics.supportingPx + 1)}px` }}>
                              {c.en}
                              <Volume2 size={12} className="ml-1.5 text-slate-500 group-hover:text-emerald-400 opacity-60 group-hover:opacity-100 transition-opacity" />
                            </span>
                            <span className="text-slate-300 font-medium" style={{ fontSize: `${Math.max(13, pixelMetrics.supportingPx)}px` }}>{c.zh}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 🧩 4. 詞根字首拆解與構詞記憶 (etymology / morphology) */}
                  {(word.etymology || morphology) && (
                    <div className="p-3 rounded-2xl bg-slate-950/80 border border-amber-800/50 space-y-2 shadow-sm touch-pan-y select-none" style={{ touchAction: 'pan-y' }}>
                      <div className="text-amber-400 font-bold flex items-center" style={{ fontSize: `${Math.max(14, pixelMetrics.supportingPx + 1)}px` }}>
                        <Layers size={14} className="mr-1.5" /> 詞根字首拆解與構詞記憶
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {word.etymology?.prefix && (
                          <span className="px-2.5 py-1 rounded-lg bg-amber-950/40 border border-amber-700/50 text-amber-200" style={{ fontSize: `${Math.max(12, pixelMetrics.supportingPx)}px` }}>
                            <strong className="text-amber-300">前綴</strong>：{word.etymology.prefix}
                          </span>
                        )}
                        {word.etymology?.root && (
                          <span className="px-2.5 py-1 rounded-lg bg-amber-950/40 border border-amber-700/50 text-amber-200" style={{ fontSize: `${Math.max(12, pixelMetrics.supportingPx)}px` }}>
                            <strong className="text-amber-300">字根</strong>：{word.etymology.root}
                          </span>
                        )}
                        {word.etymology?.suffix && (
                          <span className="px-2.5 py-1 rounded-lg bg-amber-950/40 border border-amber-700/50 text-amber-200" style={{ fontSize: `${Math.max(12, pixelMetrics.supportingPx)}px` }}>
                            <strong className="text-amber-300">字尾</strong>：{word.etymology.suffix}
                          </span>
                        )}
                        {!word.etymology && morphology?.roots.map((r, idx) => (
                          <span key={idx} className="px-2.5 py-1 rounded-lg bg-amber-950/40 border border-amber-700/50 text-amber-200" style={{ fontSize: `${Math.max(12, pixelMetrics.supportingPx)}px` }}>
                            <strong className="text-amber-300">{r.part}</strong>：{r.meaning}
                          </span>
                        ))}
                      </div>

                      <p className="text-slate-200 leading-relaxed pt-1" style={{ fontSize: `${Math.max(13, pixelMetrics.supportingPx)}px` }}>
                        💡 <strong>構詞記憶</strong>：{word.etymology?.memoryHook || morphology?.mnemonic}
                      </p>

                      {/* Word Family 派生詞 (點擊直達關聯詞微型閃卡) */}
                      {(word.wordFamily || (morphology?.wordFamily && morphology.wordFamily.length > 1)) && (
                        <div className="pt-1.5 border-t border-slate-800/80 space-y-1">
                          <div className="text-[10px] font-bold text-slate-400 flex items-center justify-between">
                            <span className="flex items-center">
                              <GitBranch size={11} className="mr-1 text-emerald-400" /> 派生詞與同根詞：
                            </span>
                            <span className="text-[9px] text-slate-500">點擊速查閃卡 ↗</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 text-[10px]">
                            {word.wordFamily?.noun?.map((n: string, idx: number) => {
                              const item = formatWordFamilyItem(n);
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  style={{ touchAction: 'pan-y' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenPeekWord(n);
                                  }}
                                  className="px-2 py-0.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-blue-500/60 text-slate-200 cursor-pointer transition-colors flex items-center space-x-1 shadow-sm touch-pan-y"
                                  title="點擊速查此衍生詞"
                                >
                                  <span className="text-blue-400 font-bold">n.</span>
                                  <span>{item.head}</span>
                                  {item.zh && <span className="text-slate-400 text-[9px]">({item.zh})</span>}
                                  <span className="text-[8px] text-blue-400 opacity-80">↗</span>
                                </button>
                              );
                            })}
                            {word.wordFamily?.adjective?.map((a: string, idx: number) => {
                              const item = formatWordFamilyItem(a);
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  style={{ touchAction: 'pan-y' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenPeekWord(a);
                                  }}
                                  className="px-2 py-0.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-emerald-500/60 text-slate-200 cursor-pointer transition-colors flex items-center space-x-1 shadow-sm touch-pan-y"
                                  title="點擊速查此衍生詞"
                                >
                                  <span className="text-emerald-400 font-bold">adj.</span>
                                  <span>{item.head}</span>
                                  {item.zh && <span className="text-slate-400 text-[9px]">({item.zh})</span>}
                                  <span className="text-[8px] text-emerald-400 opacity-80">↗</span>
                                </button>
                              );
                            })}
                            {word.wordFamily?.cognates?.map((c: string, idx: number) => {
                              const item = formatWordFamilyItem(c);
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  style={{ touchAction: 'pan-y' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenPeekWord(c);
                                  }}
                                  className="px-2 py-0.5 rounded-lg bg-purple-950/50 hover:bg-purple-900/60 border border-purple-800/60 hover:border-purple-500 text-purple-300 cursor-pointer transition-colors flex items-center space-x-1 shadow-sm touch-pan-y"
                                  title="點擊速查此衍生詞"
                                >
                                  <span>🔗 {item.head}</span>
                                  {item.zh && <span className="text-purple-300/80 text-[9px]">({item.zh})</span>}
                                  <span className="text-[8px] text-purple-400 opacity-80">↗</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 🔄 5. 多益同反義詞微辨析 (synonymDiscrimination - 點擊直達關聯詞微型閃卡) */}
                  {word.synonymDiscrimination && (
                    <div className="p-2.5 rounded-xl bg-slate-950/80 border border-blue-800/40 space-y-1 text-xs shadow-sm touch-pan-y select-none" style={{ touchAction: 'pan-y' }}>
                      <div className="flex items-center justify-between text-blue-400 font-bold text-[11px]">
                        <span>🔄 多益同義替換與微辨析</span>
                        <span className="text-[9px] text-blue-500/80">點擊速查 ↗</span>
                      </div>
                      {word.synonymDiscrimination.synonyms && word.synonymDiscrimination.synonyms.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 text-[10px] items-center">
                          <span className="text-slate-400 text-[10px]">同義詞：</span>
                          {word.synonymDiscrimination.synonyms.map((s: string, sIdx: number) => (
                            <button
                              key={sIdx}
                              type="button"
                              style={{ touchAction: 'pan-y' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenPeekWord(s);
                              }}
                              className="px-2 py-0.5 rounded-lg bg-blue-950/80 hover:bg-blue-900/80 text-blue-300 border border-blue-700/50 hover:border-blue-400 transition-colors flex items-center space-x-1 cursor-pointer shadow-sm touch-pan-y"
                              title="點擊預覽此同義詞閃卡"
                            >
                              <span>{s}</span>
                              <span className="text-[8px] text-blue-400 opacity-80">↗</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {word.synonymDiscrimination.discrimination && (
                        <p className="text-slate-300 text-[10px] leading-relaxed pt-0.5">
                          💡 <strong>考點微辨析</strong>：{word.synonymDiscrimination.discrimination}
                        </p>
                      )}
                    </div>
                  )}

                  {/* 🏢 6. 進階延伸商務例句 (全量平鋪於最底部 · 營運與策略場景) */}
                  {currentExamples.length > 1 && (
                    <div className="p-3 rounded-2xl bg-slate-900/90 border border-teal-800/40 text-xs space-y-2.5 shadow-sm touch-pan-y select-none" style={{ touchAction: 'pan-y' }}>
                      <div className="flex items-center justify-between text-teal-400 font-bold text-[11px]">
                        <span className="flex items-center">
                          <Sparkles size={12} className="mr-1.5 text-amber-400" />
                          進階商務延伸例句（營運與策略拓展）
                        </span>
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                          +{currentExamples.length - 1} 句
                        </span>
                      </div>

                      <div className="space-y-2 pt-1">
                        {currentExamples.slice(1).map((ex: any, exIdx: number) => (
                          <div
                            key={exIdx}
                            style={{ touchAction: 'pan-y' }}
                            onClick={() => audioService.speakSentence(ex.en || ex.english || '')}
                            className="cursor-pointer hover:bg-slate-800/70 p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 transition-colors group touch-pan-y"
                            title="點擊播放例句真人朗讀"
                          >
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <span className="px-1.5 py-0.5 rounded bg-teal-950/80 text-[9px] text-teal-300 border border-teal-800/50 font-semibold">
                                🏢 {ex.scenario || (exIdx === 0 ? '營運管理' : '策略拓展')}
                              </span>
                              <Volume2 size={13} className="text-slate-500 group-hover:text-teal-400 shrink-0" />
                            </div>
                            <p className={`text-slate-100 ${exampleEnClass}`}>
                              <ClickableSentence
                                text={ex.en || ex.english || ''}
                                onWordClick={handleOpenPeekWord}
                              />
                            </p>
                            <p className={`text-teal-400/90 ${exampleZhClass} mt-1`}>
                              {ex.zh || ex.chinese}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 📖 7. 多益名師 5 大官方出題分析與解題秘笈 (可折疊收納) */}
                  {word.examTips && word.examTips.length > 0 && (
                    <div className="rounded-2xl bg-slate-900/90 border border-slate-800 text-xs shadow-sm overflow-hidden touch-pan-y select-none" style={{ touchAction: 'pan-y' }}>
                      <button
                        type="button"
                        style={{ touchAction: 'pan-y' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowFullExamTips(prev => !prev);
                        }}
                        className="w-full p-3 flex items-center justify-between text-slate-300 hover:text-emerald-300 transition-colors font-bold touch-pan-y"
                      >
                        <span className="flex items-center text-slate-200" style={{ fontSize: `${Math.max(13, pixelMetrics.supportingPx)}px` }}>
                          <HelpCircle size={14} className="mr-1.5 text-emerald-400" />
                          多益官方考點深度拆解與解題秘笈 ({word.examTips.length} 條)
                        </span>
                        <span className="text-emerald-400 flex items-center space-x-0.5 text-[11px]">
                          <span>{showFullExamTips ? '收起' : '展開秘笈'}</span>
                          {showFullExamTips ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </span>
                      </button>
                      {showFullExamTips && (
                        <div className="p-3 pt-0 border-t border-slate-800/80 space-y-2 text-slate-300">
                          {word.examTips.map((tip: string, idx: number) => (
                            <div key={idx} className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/90 leading-relaxed text-slate-200" style={{ fontSize: `${Math.max(12, pixelMetrics.supportingPx - 1)}px` }}>
                              {tip}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
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
            className="sticky bottom-0 z-30 pt-2 pb-1.5 bg-slate-900/95 backdrop-blur-md border-t border-slate-800/80 w-full shrink-0 shadow-2xl"
          >
            <div className="grid grid-cols-3 gap-2">
              {/* 1. Again (忘記) */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRate(1);
                }}
                className="flex flex-col items-center justify-center p-2 rounded-2xl bg-rose-950/90 hover:bg-rose-900 active:scale-95 border border-rose-700 text-white shadow-lg min-h-[56px] transition-all"
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
                className="flex flex-col items-center justify-center p-2 rounded-2xl bg-amber-950/90 hover:bg-amber-900 active:scale-95 border border-amber-700 text-white shadow-lg min-h-[56px] transition-all"
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
                className="flex flex-col items-center justify-center p-2 rounded-2xl bg-emerald-950/90 hover:bg-emerald-900 active:scale-95 border border-emerald-600 text-white shadow-lg min-h-[56px] transition-all"
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

      {/* Word Quick Peek Modal (Bottom Sheet for Derivatives & Synonyms) */}
      <WordQuickPeekModal
        word={peekWord}
        isOpen={isPeekOpen}
        onClose={() => setIsPeekOpen(false)}
      />
    </div>
  );
};
