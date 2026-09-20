import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Sparkles,
  Eye,
  Trophy,
  ArrowRight,
  Volume2,
  CheckCircle,
  XCircle,
  X,
  Check
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { useProfile } from '../contexts/ProfileContext';
import { todayService } from '../services/todayService';
import { manualQueueService } from '../services/manualQueueService';
import { quizService, NextGenQuestion } from '../services/quizService';
import { audioService } from '../services/audioService';
import { progressRepository } from '../repositories/progressRepository';
import { courseRepository } from '../repositories/courseRepository';
import { imageService, OFFLINE_PLACEHOLDER_URL } from '../services/imageService';
import { TodaySession, TodayPhase } from '../types/today';
import { Word } from '../types/db';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';

export const TodayGuidedPage: React.FC = () => {
  const { activeProfile } = useProfile();
  const navigate = useNavigate();
  const { sessionId: paramSessionId } = useParams<{ sessionId?: string }>();

  const [session, setSession] = useState<TodaySession | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [courseTitle, setCourseTitle] = useState<string>('');

  // Loaded full words
  const [dueWords, setDueWords] = useState<Word[]>([]);
  const [newWords, setNewWords] = useState<Word[]>([]);

  // Flashcard flip state (for Review & Learn phases)
  const [isFlipped, setIsFlipped] = useState<boolean>(false);

  // Quiz state
  const [quizQuestions, setQuizQuestions] = useState<NextGenQuestion[]>([]);
  const [quizCurrentIdx, setQuizCurrentIdx] = useState<number>(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isQuizAnswered, setIsQuizAnswered] = useState<boolean>(false);

  // Load or resume session
  const initSession = useCallback(async () => {
    if (!activeProfile) return;
    setIsLoading(true);

    try {
      let curSession: TodaySession;
      if (paramSessionId) {
        const loaded = todayService.loadTodaySessionBySessionId(activeProfile.id, paramSessionId);
        curSession = loaded || (await todayService.getOrCreateTodaySession(activeProfile.id));
      } else {
        curSession = await todayService.getOrCreateTodaySession(activeProfile.id);
      }

      // Replace URL to stable session route if missing or differs
      if (!paramSessionId || paramSessionId !== curSession.sessionId) {
        navigate(`/today/session/${curSession.sessionId}`, { replace: true });
      }

      setSession(curSession);

      // Fetch course info
      if (curSession.activeCourseId) {
        courseRepository.getById(curSession.activeCourseId).then(c => {
          if (c) setCourseTitle(c.title);
        });
      }

      // Load words
      if (curSession.dueWordIds.length > 0) {
        const dWords = await progressRepository.getStudyItemsByWordIds(
          activeProfile.id,
          curSession.dueWordIds
        );
        setDueWords(dWords.map(d => d.word));
      }

      if (curSession.newWordIds.length > 0) {
        const nWords = await progressRepository.getStudyItemsByWordIds(
          activeProfile.id,
          curSession.newWordIds
        );
        setNewWords(nWords.map(n => n.word));
      }

      // If at quiz phase, restore from snapshot or generate once
      if (curSession.phase === 'quiz') {
        let qs = curSession.quizQuestionsSnapshot;
        if (!qs || qs.length === 0) {
          if (curSession.newWordIds.length > 0) {
            const nWords = await progressRepository.getStudyItemsByWordIds(
              activeProfile.id,
              curSession.newWordIds
            );
            qs = quizService.generateNextGenQuestions(
              nWords.map(n => n.word),
              'part5_mcq',
              Math.min(5, nWords.length)
            );
            curSession.quizQuestionsSnapshot = qs;
            curSession.quizCurrentIndex = curSession.quizCurrentIndex ?? 0;
            todayService.saveTodaySession(curSession);
          }
        }
        if (qs && qs.length > 0) {
          setQuizQuestions(qs);
          const savedQIdx = curSession.quizCurrentIndex ?? 0;
          const safeQIdx = Math.min(Math.max(0, savedQIdx), qs.length - 1);
          setQuizCurrentIdx(safeQIdx);
          if (curSession.quizUserAnswers && curSession.quizUserAnswers[safeQIdx] !== undefined) {
            setSelectedOption(curSession.quizUserAnswers[safeQIdx]);
            setIsQuizAnswered(true);
          } else {
            setSelectedOption(null);
            setIsQuizAnswered(false);
          }
        }
      }
    } catch (err) {
      console.error('[TodayGuidedPage] Init failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeProfile, paramSessionId, navigate]);

  useEffect(() => {
    initSession();
  }, [initSession]);

  // Persist session whenever it updates
  const updateSession = (updated: TodaySession) => {
    setSession(updated);
    todayService.saveTodaySession(updated);
  };

  // 1. REVIEW PHASE HANDLERS
  const handleReviewRating = async (rating: 1 | 2 | 3) => {
    if (!session || !activeProfile || dueWords.length === 0) return;
    const currentWord = dueWords[session.currentReviewIndex];
    if (!currentWord) return;

    // Record real FSRS review
    try {
      await progressRepository.recordReviewTransaction({
        profileId: activeProfile.id,
        wordId: currentWord.id,
        rating,
        durationMs: 3000,
        desiredRetention: activeProfile.desiredRetention || 0.9,
        enableCloudSync: false
      });
    } catch (err) {
      console.warn('[TodayGuidedPage] Review record error:', err);
    }

    setIsFlipped(false);
    const nextIdx = session.currentReviewIndex + 1;
    if (nextIdx < dueWords.length) {
      updateSession({
        ...session,
        currentReviewIndex: nextIdx
      });
    } else {
      // Review complete -> Next phase
      const nextPhase: TodayPhase = session.newWordIds.length > 0 ? 'preview' : 'summary';
      updateSession({
        ...session,
        currentReviewIndex: nextIdx,
        phase: nextPhase,
        isCompleted: nextPhase === 'summary'
      });
      if (nextPhase === 'summary') {
        confetti({ particleCount: 60, spread: 60 });
      }
    }
  };

  // 2. PREVIEW PHASE HANDLERS
  const handleProceedToLearn = () => {
    if (!session) return;
    updateSession({
      ...session,
      phase: 'learn',
      currentLearnIndex: 0
    });
    setIsFlipped(false);
  };

  // 3. LEARN PHASE HANDLERS
  const handleLearnRating = async (rating: 1 | 2 | 3) => {
    if (!session || !activeProfile || newWords.length === 0) return;
    const currentWord = newWords[session.currentLearnIndex];
    if (!currentWord) return;

    // Record FSRS initial learning
    try {
      await progressRepository.recordReviewTransaction({
        profileId: activeProfile.id,
        wordId: currentWord.id,
        rating,
        durationMs: 4000,
        desiredRetention: activeProfile.desiredRetention || 0.9,
        enableCloudSync: false
      });
    } catch (err) {
      console.warn('[TodayGuidedPage] Learn record error:', err);
    }

    setIsFlipped(false);
    const nextIdx = session.currentLearnIndex + 1;
    if (nextIdx < newWords.length) {
      updateSession({
        ...session,
        currentLearnIndex: nextIdx
      });
    } else {
      // Learn complete -> Transition to Quiz!
      let questions = session.quizQuestionsSnapshot;
      if (!questions || questions.length === 0) {
        questions = quizService.generateNextGenQuestions(
          newWords,
          'part5_mcq',
          Math.min(5, newWords.length)
        );
      }
      setQuizQuestions(questions);
      setQuizCurrentIdx(0);
      setSelectedOption(null);
      setIsQuizAnswered(false);

      updateSession({
        ...session,
        currentLearnIndex: nextIdx,
        quizQuestionsSnapshot: questions,
        quizCurrentIndex: 0,
        phase: questions.length > 0 ? 'quiz' : 'summary',
        isCompleted: questions.length === 0
      });
      if (questions.length === 0) {
        confetti({ particleCount: 70, spread: 70 });
      }
    }
  };

  // 4. QUIZ PHASE HANDLERS
  const handleQuizAnswer = (optionIdx: number) => {
    if (isQuizAnswered || !session || !activeProfile) return;
    const currentQ = quizQuestions[quizCurrentIdx];
    if (!currentQ) return;

    setSelectedOption(optionIdx);
    setIsQuizAnswered(true);

    const isCorrect = optionIdx === currentQ.correctIndex;
    audioService.playWord({ headword: currentQ.word.headword, audioUrl: currentQ.word.audioUSUrl });

    const newAnswers = { ...session.quizUserAnswers, [quizCurrentIdx]: optionIdx };
    const newWrongs = [...session.wrongWordIds];
    if (!isCorrect && !newWrongs.includes(currentQ.word.id)) {
      newWrongs.push(currentQ.word.id);
      // Divert wrong answer to manual queue
      manualQueueService.enqueueWords(activeProfile.id, [currentQ.word.id], 'quiz').catch(() => {});
    }

    updateSession({
      ...session,
      quizUserAnswers: newAnswers,
      wrongWordIds: newWrongs
    });
  };

  const handleNextQuizQuestion = () => {
    if (!session) return;
    if (quizCurrentIdx < quizQuestions.length - 1) {
      const nextQIdx = quizCurrentIdx + 1;
      setQuizCurrentIdx(nextQIdx);
      setSelectedOption(null);
      setIsQuizAnswered(false);
      updateSession({
        ...session,
        quizCurrentIndex: nextQIdx
      });
    } else {
      // Quiz complete -> Summary!
      updateSession({
        ...session,
        phase: 'summary',
        isCompleted: true
      });
      confetti({ particleCount: 100, spread: 80, origin: { y: 0.6 } });
    }
  };

  // Skip Phase Handler (Produces ZERO FSRS mutations)
  const handleSkipPhase = () => {
    if (!session) return;
    setIsFlipped(false);

    if (session.phase === 'review') {
      const nextPhase: TodayPhase = session.newWordIds.length > 0 ? 'preview' : 'summary';
      updateSession({
        ...session,
        phase: nextPhase,
        isCompleted: nextPhase === 'summary'
      });
      if (nextPhase === 'summary') {
        confetti({ particleCount: 60, spread: 60 });
      }
    } else if (session.phase === 'preview') {
      updateSession({
        ...session,
        phase: 'learn'
      });
    } else if (session.phase === 'learn') {
      let questions = session.quizQuestionsSnapshot;
      if (!questions || questions.length === 0) {
        questions = quizService.generateNextGenQuestions(
          newWords,
          'part5_mcq',
          Math.min(5, newWords.length)
        );
      }
      setQuizQuestions(questions);
      setQuizCurrentIdx(0);
      setSelectedOption(null);
      setIsQuizAnswered(false);

      updateSession({
        ...session,
        quizQuestionsSnapshot: questions,
        quizCurrentIndex: 0,
        phase: questions.length > 0 ? 'quiz' : 'summary',
        isCompleted: questions.length === 0
      });
      if (questions.length === 0) {
        confetti({ particleCount: 70, spread: 70 });
      }
    } else if (session.phase === 'quiz') {
      updateSession({
        ...session,
        phase: 'summary',
        isCompleted: true
      });
      confetti({ particleCount: 80, spread: 70 });
    }
  };

  // Top Phase Navigation Component
  const renderPhaseHeader = () => {
    if (!session) return null;
    const phases: { id: TodayPhase; label: string; count: number }[] = [
      { id: 'review', label: '1. 舊詞複習', count: session.dueWordIds.length },
      { id: 'preview', label: '2. 新詞預熱', count: session.newWordIds.length },
      { id: 'learn', label: '3. 深度掌握', count: session.newWordIds.length },
      { id: 'quiz', label: '4. 課後驗收', count: quizQuestions.length || Math.min(5, session.newWordIds.length) },
      { id: 'summary', label: '5. 今日總結', count: 0 }
    ];

    const currentPhaseIdx = phases.findIndex(p => p.id === session.phase);

    return (
      <div className="bg-slate-900 border-b border-slate-800 px-3 py-2 shrink-0 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="p-1 rounded-lg bg-emerald-500/20 text-emerald-400">
              <Sparkles size={14} />
            </span>
            <span className="text-xs font-black text-slate-100">今日學習計畫</span>
            {courseTitle && (
              <span className="text-[10px] text-slate-400 truncate max-w-[140px]">
                · {courseTitle}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-1">
            {session.phase !== 'summary' && (
              <button
                type="button"
                onClick={handleSkipPhase}
                className="px-2 py-0.5 rounded text-[10px] font-bold text-slate-400 hover:text-amber-300 hover:bg-slate-800/80 transition-colors"
                title="跳過此階段"
              >
                跳過階段 ⏭
              </button>
            )}
            <button
              onClick={() => navigate('/')}
              className="p-1 text-slate-400 hover:text-slate-200"
              title="暫存並退出"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Phase progress chips */}
        <div className="flex items-center space-x-1 overflow-x-auto pb-0.5 scrollbar-none text-[10px]">
          {phases.map((p, idx) => {
            const isCurrent = p.id === session.phase;
            const isPast = idx < currentPhaseIdx;
            return (
              <div
                key={p.id}
                className={`px-2 py-0.5 rounded-lg whitespace-nowrap font-bold flex items-center space-x-1 transition-colors ${
                  isCurrent
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : isPast
                    ? 'bg-slate-800 text-slate-400'
                    : 'bg-slate-850 text-slate-500'
                }`}
              >
                {isPast ? <Check size={10} className="text-emerald-400" /> : null}
                <span>{p.label}</span>
                {p.count > 0 && <span>({p.count})</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (isLoading || !session) {
    return (
      <div className="min-h-[60dvh] flex flex-col items-center justify-center space-y-3">
        <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-slate-400">正在為您準備今日學習計畫...</p>
      </div>
    );
  }

  // --- PHASE 1: REVIEW ---
  if (session.phase === 'review') {
    const currentWord = dueWords[session.currentReviewIndex];
    if (!currentWord) {
      // Auto-advance if empty
      updateSession({
        ...session,
        phase: session.newWordIds.length > 0 ? 'preview' : 'summary'
      });
      return null;
    }

    const imgInfo = imageService.getImageForWord(currentWord.headword, currentWord.category, currentWord.id);

    return (
      <div className="flex flex-col h-full justify-between max-w-md mx-auto pb-2">
        {renderPhaseHeader()}

        <div className="flex-1 flex flex-col justify-center px-4 py-3 min-h-0 overflow-y-auto">
          <div className="flex justify-between items-center text-xs text-slate-400 mb-2">
            <span className="font-bold text-emerald-400">
              複習進度：{session.currentReviewIndex + 1} / {dueWords.length}
            </span>
            <Badge variant="blue">{currentWord.toeicScoreRange}</Badge>
          </div>

          {/* Flashcard */}
          <div
            onClick={() => setIsFlipped(!isFlipped)}
            className="w-full rounded-3xl bg-slate-850 border border-slate-700 shadow-xl p-5 flex flex-col items-center justify-center text-center cursor-pointer transition-all space-y-3 min-h-[260px] relative overflow-hidden"
          >
            {/* Image Thumbnail */}
            <div className="w-24 h-24 rounded-2xl overflow-hidden border border-slate-700 shadow-md relative bg-slate-900 shrink-0">
              <img
                src={imgInfo.url}
                alt={currentWord.headword}
                onError={(e) => {
                  if (e.currentTarget.src !== OFFLINE_PLACEHOLDER_URL) {
                    e.currentTarget.src = OFFLINE_PLACEHOLDER_URL;
                  }
                }}
                className="w-full h-full object-cover"
              />
            </div>

            <div className="space-y-1">
              <h2 className="text-3xl font-black text-slate-100">{currentWord.headword}</h2>
              {currentWord.phoneticUS && (
                <p className="text-xs font-mono text-emerald-400">/{currentWord.phoneticUS}/</p>
              )}
            </div>

            <div className="pt-2">
              {isFlipped ? (
                <div className="space-y-2 animate-fade-in">
                  <div className="text-base font-bold text-emerald-300">
                    {currentWord.definitionZh}
                  </div>
                  {currentWord.examples?.[0] && (
                    <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-left text-xs text-slate-300">
                      <p className="font-medium text-slate-200">{currentWord.examples[0].en || currentWord.examples[0].english}</p>
                      <p className="text-slate-400 text-[11px] mt-0.5">{currentWord.examples[0].zh || currentWord.examples[0].chinese}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500">點擊卡片翻面看中文釋義 👆</p>
              )}
            </div>
          </div>
        </div>

        {/* 3-Button FSRS Rating */}
        <div className="p-3 border-t border-slate-800 bg-slate-900/90 grid grid-cols-3 gap-2 shrink-0">
          <Button size="md" variant="danger" onClick={() => handleReviewRating(1)}>
            💥 忘記 (1)
          </Button>
          <Button size="md" variant="outline" onClick={() => handleReviewRating(2)}>
            🤔 不熟 (2)
          </Button>
          <Button size="md" variant="primary" onClick={() => handleReviewRating(3)}>
            💡 掌握 (3)
          </Button>
        </div>
      </div>
    );
  }

  // --- PHASE 2: PREVIEW ---
  if (session.phase === 'preview') {
    return (
      <div className="flex flex-col h-full justify-between max-w-md mx-auto pb-2">
        {renderPhaseHeader()}

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          <div>
            <h3 className="text-base font-bold text-slate-100 flex items-center">
              <Eye size={16} className="mr-1.5 text-emerald-400" />
              今日新單字速覽預熱（{newWords.length} 詞）
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              先快速看過今日預計學習的單字與釋義，建立肌肉記憶：
            </p>
          </div>

          <div className="space-y-2">
            {newWords.map((w, idx) => (
              <div
                key={w.id}
                className="p-3 rounded-2xl bg-slate-850 border border-slate-800 flex items-center justify-between"
              >
                <div className="min-w-0 flex-1 mr-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-emerald-400">#{idx + 1}</span>
                    <span className="text-sm font-black text-slate-100">{w.headword}</span>
                    {w.phoneticUS && (
                      <span className="text-[10px] font-mono text-slate-400">/{w.phoneticUS}/</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 mt-1 truncate">{w.definitionZh}</p>
                </div>
                <button
                  onClick={() => audioService.speakSentence(w.headword)}
                  className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-emerald-400"
                >
                  <Volume2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="p-3 border-t border-slate-800 bg-slate-900/90 shrink-0">
          <Button size="lg" variant="primary" fullWidth onClick={handleProceedToLearn} className="py-3 font-bold text-sm">
            <span>開始深度學習新單字</span>
            <ArrowRight size={16} className="ml-1.5" />
          </Button>
        </div>
      </div>
    );
  }

  // --- PHASE 3: LEARN ---
  if (session.phase === 'learn') {
    const currentWord = newWords[session.currentLearnIndex];
    if (!currentWord) {
      updateSession({
        ...session,
        phase: 'quiz'
      });
      return null;
    }

    const imgInfo = imageService.getImageForWord(currentWord.headword, currentWord.category, currentWord.id);

    return (
      <div className="flex flex-col h-full justify-between max-w-md mx-auto pb-2">
        {renderPhaseHeader()}

        <div className="flex-1 flex flex-col justify-center px-4 py-3 min-h-0 overflow-y-auto">
          <div className="flex justify-between items-center text-xs text-slate-400 mb-2">
            <span className="font-bold text-emerald-400">
              新詞學習：{session.currentLearnIndex + 1} / {newWords.length}
            </span>
            <Badge variant="emerald">初次學習</Badge>
          </div>

          {/* Learn Card */}
          <div
            onClick={() => setIsFlipped(!isFlipped)}
            className="w-full rounded-3xl bg-slate-850 border border-slate-700 shadow-xl p-5 flex flex-col items-center justify-center text-center cursor-pointer transition-all space-y-3 min-h-[280px] relative overflow-hidden"
          >
            <div className="w-24 h-24 rounded-2xl overflow-hidden border border-slate-700 shadow-md relative bg-slate-900 shrink-0">
              <img
                src={imgInfo.url}
                alt={currentWord.headword}
                onError={(e) => {
                  if (e.currentTarget.src !== OFFLINE_PLACEHOLDER_URL) {
                    e.currentTarget.src = OFFLINE_PLACEHOLDER_URL;
                  }
                }}
                className="w-full h-full object-cover"
              />
            </div>

            <div className="space-y-1">
              <h2 className="text-3xl font-black text-slate-100">{currentWord.headword}</h2>
              {currentWord.phoneticUS && (
                <p className="text-xs font-mono text-emerald-400">/{currentWord.phoneticUS}/</p>
              )}
            </div>

            <div className="pt-2 w-full">
              {isFlipped ? (
                <div className="space-y-2 animate-fade-in text-left">
                  <div className="text-base font-bold text-emerald-300 text-center">
                    {currentWord.definitionZh}
                  </div>
                  {currentWord.examples?.[0] && (
                    <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300">
                      <p className="font-medium text-slate-100">{currentWord.examples[0].en || currentWord.examples[0].english}</p>
                      <p className="text-slate-400 text-[11px] mt-0.5">{currentWord.examples[0].zh || currentWord.examples[0].chinese}</p>
                    </div>
                  )}
                  {currentWord.collocations?.[0] && (
                    <div className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-emerald-300">
                      📚 高頻搭配：{currentWord.collocations[0].en} ({currentWord.collocations[0].zh})
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500">點擊卡片翻面掌握例句與商務搭配 👆</p>
              )}
            </div>
          </div>
        </div>

        {/* 3-Button Rating */}
        <div className="p-3 border-t border-slate-800 bg-slate-900/90 grid grid-cols-3 gap-2 shrink-0">
          <Button size="md" variant="danger" onClick={() => handleLearnRating(1)}>
            💥 忘記 (1)
          </Button>
          <Button size="md" variant="outline" onClick={() => handleLearnRating(2)}>
            🤔 不熟 (2)
          </Button>
          <Button size="md" variant="primary" onClick={() => handleLearnRating(3)}>
            💡 掌握 (3)
          </Button>
        </div>
      </div>
    );
  }

  // --- PHASE 4: QUIZ ---
  if (session.phase === 'quiz') {
    if (quizQuestions.length === 0) {
      updateSession({ ...session, phase: 'summary', isCompleted: true });
      return null;
    }

    const currentQ = quizQuestions[quizCurrentIdx];

    return (
      <div className="flex flex-col h-full justify-between max-w-md mx-auto pb-2">
        {renderPhaseHeader()}

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          <div className="flex justify-between items-center text-xs text-slate-400">
            <span className="font-bold text-purple-400">
              驗收測驗：第 {quizCurrentIdx + 1} / {quizQuestions.length} 題
            </span>
            <Badge variant="purple">今日學習檢驗</Badge>
          </div>

          {/* Stem sentence */}
          <div className="p-4 rounded-3xl bg-slate-850 border border-slate-700 shadow-xl space-y-2">
            <div className="text-sm font-black text-slate-100 leading-relaxed">
              {currentQ.stem}
            </div>
            {isQuizAnswered && currentQ.stemTranslation && (
              <div className="p-2.5 rounded-xl bg-emerald-950/50 border border-emerald-700/50 text-emerald-200 text-xs">
                📖 {currentQ.stemTranslation}
              </div>
            )}
          </div>

          {/* Options */}
          <div className="space-y-2">
            {currentQ.options.map((opt, optIdx) => {
              let style = 'bg-slate-800/90 border-slate-700 text-slate-200';
              if (isQuizAnswered) {
                if (optIdx === currentQ.correctIndex) {
                  style = 'bg-emerald-950/90 border-emerald-500 text-emerald-200';
                } else if (selectedOption === optIdx) {
                  style = 'bg-rose-950/90 border-rose-500 text-rose-200';
                } else {
                  style = 'bg-slate-900 border-slate-800 text-slate-400 opacity-60';
                }
              }

              return (
                <button
                  key={optIdx}
                  disabled={isQuizAnswered}
                  onClick={() => handleQuizAnswer(optIdx)}
                  className={`w-full p-3 rounded-2xl border text-left font-semibold text-xs transition-all flex items-center justify-between ${style}`}
                >
                  <div className="flex items-center space-x-2">
                    <span className="w-5 h-5 rounded-md bg-slate-900 flex items-center justify-center text-[10px] font-bold text-slate-400">
                      {String.fromCharCode(65 + optIdx)}
                    </span>
                    <span className="font-bold text-sm">{opt}</span>
                  </div>
                  {isQuizAnswered && optIdx === currentQ.correctIndex && (
                    <CheckCircle size={17} className="text-emerald-400" />
                  )}
                  {isQuizAnswered && selectedOption === optIdx && optIdx !== currentQ.correctIndex && (
                    <XCircle size={17} className="text-rose-400" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {isQuizAnswered && (
          <div className="p-3 border-t border-slate-800 bg-slate-900/90 shrink-0">
            <Button size="md" variant="primary" fullWidth onClick={handleNextQuizQuestion} className="py-2.5 font-bold text-xs">
              <span>{quizCurrentIdx < quizQuestions.length - 1 ? '下一題' : '完成今日學習'}</span>
              <ArrowRight size={15} className="ml-1.5" />
            </Button>
          </div>
        )}
      </div>
    );
  }

  // --- PHASE 5: SUMMARY ---
  const wrongCount = session.wrongWordIds.length;
  const correctCount = Math.max(0, quizQuestions.length - wrongCount);
  const quizAccuracy = quizQuestions.length > 0 ? Math.round((correctCount / quizQuestions.length) * 100) : 100;

  return (
    <div className="flex flex-col h-full justify-between max-w-md mx-auto pb-2">
      {renderPhaseHeader()}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-center min-h-0">
        <div className="w-16 h-16 rounded-3xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto shadow-inner mt-2">
          <Trophy size={32} />
        </div>

        <div>
          <h2 className="text-2xl font-black text-slate-100">今日學習總結</h2>
          <p className="text-xs text-slate-400 mt-1">
            查看今日單字複習、新詞學習與測驗驗收紀錄
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="p-3 rounded-2xl bg-slate-850 border border-slate-800">
            <div className="text-slate-400 text-[10px]">複習舊詞</div>
            <div className="text-base font-bold text-emerald-400 mt-0.5">{session.dueWordIds.length} 詞</div>
          </div>
          <div className="p-3 rounded-2xl bg-slate-850 border border-slate-800">
            <div className="text-slate-400 text-[10px]">新學單字</div>
            <div className="text-base font-bold text-emerald-400 mt-0.5">{session.newWordIds.length} 詞</div>
          </div>
          <div className="p-3 rounded-2xl bg-slate-850 border border-slate-800">
            <div className="text-slate-400 text-[10px]">驗收正確率</div>
            <div className="text-base font-bold text-purple-400 mt-0.5">{quizAccuracy}%</div>
          </div>
        </div>

        {wrongCount > 0 && (
          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 text-left text-xs space-y-1.5">
            <div className="text-slate-300 font-bold flex items-center">
              <span>⚠️ 測驗答錯單字（已自動收錄至重點練習隊列）：</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {session.wrongWordIds.map((id, idx) => (
                <span key={idx} className="px-2 py-0.5 rounded bg-rose-950/60 border border-rose-800/60 text-rose-300 text-[10px] font-mono">
                  {id}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-slate-800 bg-slate-900/90 space-y-2 shrink-0">
        <Button size="lg" variant="primary" fullWidth onClick={() => navigate('/')} className="py-3 font-black text-sm">
          返回首頁
        </Button>
      </div>
    </div>
  );
};
