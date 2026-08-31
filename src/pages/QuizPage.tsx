import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Headphones,
  Zap,
  CheckCircle,
  XCircle,
  Sparkles,
  RotateCcw,
  ArrowRight,
  Flame,
  Check
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { useProfile } from '../contexts/ProfileContext';
import { courseRepository } from '../repositories/courseRepository';
import { quizService } from '../services/quizService';
import { audioService } from '../services/audioService';
import { QuizMode, QuizQuestion, QuizSessionSummary } from '../types/quiz';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { AudioButton } from '../components/ui/AudioButton';

export const QuizPage: React.FC = () => {
  const { activeProfile } = useProfile();
  const navigate = useNavigate();

  // Setup state
  const [selectedMode, setSelectedMode] = useState<QuizMode>('meaning');
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [isStarted, setIsStarted] = useState<boolean>(false);

  // Active quiz state
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, number>>({});
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isAnswered, setIsAnswered] = useState<boolean>(false);
  const [streak, setStreak] = useState<number>(0);
  const [maxStreak, setMaxStreak] = useState<number>(0);
  const [startTime, setStartTime] = useState<number>(Date.now());
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [summary, setSummary] = useState<QuizSessionSummary | null>(null);
  const [isEnqueuing, setIsEnqueuing] = useState<boolean>(false);
  const [enqueuedSuccess, setEnqueuedSuccess] = useState<boolean>(false);

  const autoNextTimerRef = useRef<number | null>(null);

  // Load available categories
  useEffect(() => {
    courseRepository.getDownloadedCategories().then(cats => {
      setAvailableCategories(cats);
    });
  }, []);

  const handleStartQuiz = async () => {
    await audioService.unlockAudio();

    const downloadedWords = await courseRepository.getAllDownloadedWords({
      category: selectedCategory,
      shuffle: true
    });

    if (downloadedWords.length === 0) {
      alert('目前尚無已下載課程，請先至「課程」頁面下載單字題庫。');
      navigate('/catalog');
      return;
    }

    const generated = quizService.generateQuestions(downloadedWords, selectedMode, questionCount);
    setQuestions(generated);
    setCurrentIdx(0);
    setUserAnswers({});
    setSelectedOption(null);
    setIsAnswered(false);
    setStreak(0);
    setMaxStreak(0);
    setStartTime(Date.now());
    setIsCompleted(false);
    setSummary(null);
    setEnqueuedSuccess(false);
    setIsStarted(true);

    // If listening mode, play first audio immediately
    if (selectedMode === 'listening' && generated.length > 0) {
      setTimeout(() => {
        audioService.playWord({
          headword: generated[0].word.headword,
          audioUrl: generated[0].word.audioUSUrl
        });
      }, 400);
    }
  };

  const handleAnswerSelect = (optionIdx: number) => {
    if (isAnswered) return;

    const currentQ = questions[currentIdx];
    const isCorrect = optionIdx === currentQ.correctIndex;

    setSelectedOption(optionIdx);
    setIsAnswered(true);
    setUserAnswers(prev => ({ ...prev, [currentIdx]: optionIdx }));

    // Pronounce word on answer
    audioService.playWord({
      headword: currentQ.word.headword,
      audioUrl: currentQ.word.audioUSUrl
    });

    // Update streak
    if (isCorrect) {
      const nextStreak = streak + 1;
      setStreak(nextStreak);
      if (nextStreak > maxStreak) setMaxStreak(nextStreak);
    } else {
      setStreak(0);
    }

    // Auto next after 1.2s
    autoNextTimerRef.current = window.setTimeout(() => {
      handleNextQuestion();
    }, 1200);
  };

  const handleNextQuestion = useCallback(() => {
    if (autoNextTimerRef.current) {
      clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }

    if (currentIdx < questions.length - 1) {
      const nextIdx = currentIdx + 1;
      setCurrentIdx(nextIdx);
      setSelectedOption(null);
      setIsAnswered(false);

      if (selectedMode === 'listening') {
        setTimeout(() => {
          audioService.playWord({
            headword: questions[nextIdx].word.headword,
            audioUrl: questions[nextIdx].word.audioUSUrl
          });
        }, 300);
      }
    } else {
      // Completed quiz
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      const res = quizService.calculateSummary(questions, userAnswers, elapsedSec);
      setSummary(res);
      setIsCompleted(true);

      if (res.scorePercentage >= 80) {
        confetti({
          particleCount: 70,
          spread: 60,
          origin: { y: 0.6 }
        });
      }
    }
  }, [currentIdx, questions, selectedMode, startTime, userAnswers]);

  const handleEnqueueWrongAnswers = async () => {
    if (!activeProfile || !summary || summary.wrongWords.length === 0) return;
    setIsEnqueuing(true);
    try {
      await quizService.recordQuizWrongAnswers(activeProfile.id, summary.wrongWords);
      setEnqueuedSuccess(true);
    } catch (err) {
      console.error('[QuizPage] Enqueue error:', err);
    } finally {
      setIsEnqueuing(false);
    }
  };

  // Setup / Mode Selection View
  if (!isStarted) {
    return (
      <div className="space-y-5 pb-6 max-w-md mx-auto">
        <div>
          <h2 className="text-xl font-black text-slate-100">多益實戰測驗 (Quiz Arena)</h2>
          <p className="text-xs text-slate-400 mt-1">
            四選一秒殺題與聽力盲聽辨析，全面強化實戰直覺反應。
          </p>
        </div>

        {/* Mode Cards */}
        <div className="space-y-3">
          <div
            onClick={() => setSelectedMode('meaning')}
            className={`p-4 rounded-2xl border transition-all cursor-pointer ${
              selectedMode === 'meaning'
                ? 'bg-emerald-950/40 border-emerald-500 shadow-lg shadow-emerald-950/30'
                : 'bg-slate-800/80 border-slate-700/80 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <Zap size={22} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-100">四選一快速字義測驗</h3>
                  {selectedMode === 'meaning' && <Badge variant="emerald">已選擇</Badge>}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  看到英文單字迅速選出正確中文，強化 Part 5/6 閱讀秒殺速度。
                </p>
              </div>
            </div>
          </div>

          <div
            onClick={() => setSelectedMode('listening')}
            className={`p-4 rounded-2xl border transition-all cursor-pointer ${
              selectedMode === 'listening'
                ? 'bg-blue-950/40 border-blue-500 shadow-lg shadow-blue-950/30'
                : 'bg-slate-800/80 border-slate-700/80 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center">
                <Headphones size={22} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-100">多益聽力盲聽辨義測驗</h3>
                  {selectedMode === 'listening' && <Badge variant="blue">已選擇</Badge>}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  隱藏拼字，純聽音檔即時選義，鍛鍊 Part 1~4 聽力即時語意捕捉。
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Options */}
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 space-y-4 text-xs">
          {/* Question count */}
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-300">測驗題數</span>
            <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-700">
              {[10, 20, 30].map(cnt => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => setQuestionCount(cnt)}
                  className={`px-3 py-1 font-bold rounded-lg transition-all ${
                    questionCount === cnt
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cnt} 題
                </button>
              ))}
            </div>
          </div>

          {/* Category filter */}
          <div className="flex items-center justify-between border-t border-slate-700/50 pt-3">
            <span className="font-semibold text-slate-300">商務主題</span>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 font-bold focus:outline-none"
            >
              <option value="all">全部商務主題</option>
              {availableCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Start Button */}
        <Button size="lg" variant="primary" fullWidth onClick={handleStartQuiz}>
          <span>開始多益測驗</span>
          <ArrowRight size={18} className="ml-2" />
        </Button>
      </div>
    );
  }

  // Completed Quiz View
  if (isCompleted && summary) {
    return (
      <div className="min-h-[80dvh] flex flex-col justify-center items-center max-w-sm mx-auto text-center space-y-5 pb-6">
        <div className={`w-20 h-20 rounded-3xl flex items-center justify-center shadow-xl ${
          summary.scorePercentage >= 80 ? 'bg-emerald-500/20 text-emerald-400 shadow-emerald-950/40' : 'bg-amber-500/20 text-amber-400 shadow-amber-950/40'
        }`}>
          <Sparkles size={40} />
        </div>

        <div>
          <h2 className="text-2xl font-black text-slate-100">測驗完成！</h2>
          <div className="text-3xl font-black text-emerald-400 mt-2">
            {summary.scorePercentage} <span className="text-base text-slate-400 font-normal">分</span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            答對 {summary.correctCount} / {summary.totalQuestions} 題 · 耗時 {summary.timeSpentSec} 秒 · 最高連勝 {maxStreak}
          </p>
        </div>

        {/* Incorrect Words Recap */}
        {summary.wrongWords.length > 0 && (
          <div className="w-full bg-slate-800/80 border border-rose-800/60 rounded-2xl p-4 text-left space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-rose-300">
                需加強錯題 ({summary.wrongWords.length})
              </span>
              <Badge variant="rose">已自動標註</Badge>
            </div>

            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
              {summary.wrongWords.map((w, idx) => (
                <div key={w.id} className="text-xs flex justify-between p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="font-bold text-slate-200">{idx + 1}. {w.headword}</span>
                  <span className="text-rose-300 truncate max-w-[120px]">{w.definitionZh}</span>
                </div>
              ))}
            </div>

            {!enqueuedSuccess ? (
              <Button
                size="sm"
                variant="danger"
                fullWidth
                disabled={isEnqueuing}
                onClick={handleEnqueueWrongAnswers}
              >
                {isEnqueuing ? '排程寫入中...' : '一鍵將錯題加入 FSRS 待複習庫'}
              </Button>
            ) : (
              <div className="text-xs text-emerald-400 flex items-center justify-center font-semibold py-1">
                <Check size={15} className="mr-1" /> 已將錯題排入待複習佇列！
              </div>
            )}
          </div>
        )}

        <div className="w-full space-y-2 pt-2">
          <Button size="lg" fullWidth variant="primary" onClick={handleStartQuiz}>
            <RotateCcw size={16} className="mr-1.5" /> 重新測驗
          </Button>
          <Button size="md" fullWidth variant="outline" onClick={() => setIsStarted(false)}>
            更換測驗模式
          </Button>
        </div>
      </div>
    );
  }

  const currentQ = questions[currentIdx];

  // Active Quiz View
  return (
    <div className="flex flex-col h-[calc(100dvh-130px)] justify-between max-w-md mx-auto space-y-3 pb-2 select-none">
      {/* Top Header & Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between bg-slate-800/80 border border-slate-700/70 rounded-2xl px-4 py-2 shadow-sm">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-emerald-400">
              第 {currentIdx + 1} / {questions.length} 題
            </span>
            <Badge variant={selectedMode === 'listening' ? 'blue' : 'emerald'}>
              {selectedMode === 'listening' ? '聽力測驗' : '字義測驗'}
            </Badge>
          </div>

          <div className="flex items-center space-x-2">
            {streak > 1 && (
              <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-bold animate-pulse">
                <Flame size={13} className="fill-amber-400 text-amber-400" />
                <span>{streak} 連勝</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setIsStarted(false)}
              className="text-slate-400 hover:text-slate-200 p-1"
              aria-label="退出測驗"
            >
              <XCircle size={18} />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
            style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Question Card */}
      <div className="bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-700/80 rounded-3xl p-6 shadow-2xl flex flex-col justify-center items-center text-center min-h-[170px] space-y-3">
        {selectedMode === 'listening' ? (
          <div className="space-y-2">
            <AudioButton headword={currentQ.word.headword} audioUrl={currentQ.word.audioUSUrl} size="lg" />
            <div className="text-xs font-bold text-blue-300">
              {currentQ.prompt}
            </div>
            {isAnswered && (
              <div className="text-sm font-black text-slate-100 mt-1">
                {currentQ.word.headword}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-center space-x-2 mb-2">
              <Badge variant="blue">{currentQ.word.toeicScoreRange}</Badge>
              <span className="text-xs text-slate-400">{currentQ.word.category}</span>
            </div>
            <h2 className="text-3xl font-black text-slate-100 tracking-tight">
              {currentQ.word.headword}
            </h2>
            {currentQ.word.phoneticUS && (
              <p className="text-xs font-mono text-emerald-400/90 mt-1">
                /{currentQ.word.phoneticUS}/
              </p>
            )}
          </div>
        )}
      </div>

      {/* 4 Option Buttons */}
      <div className="space-y-2.5">
        {currentQ.options.map((opt, optIdx) => {
          let btnStyle = 'bg-slate-800/90 border-slate-700 hover:border-slate-600 text-slate-200';

          if (isAnswered) {
            if (opt.isCorrect) {
              btnStyle = 'bg-emerald-950/80 border-emerald-500 text-emerald-300 shadow-md shadow-emerald-950/40';
            } else if (selectedOption === optIdx) {
              btnStyle = 'bg-rose-950/80 border-rose-500 text-rose-300 shadow-md shadow-rose-950/40';
            } else {
              btnStyle = 'bg-slate-900/60 border-slate-800 text-slate-500 opacity-60';
            }
          }

          return (
            <button
              key={optIdx}
              type="button"
              disabled={isAnswered}
              onClick={() => handleAnswerSelect(optIdx)}
              className={`w-full p-3.5 rounded-2xl border text-left font-semibold text-xs transition-all flex items-center justify-between active:scale-[0.98] min-h-[50px] ${btnStyle}`}
            >
              <div className="flex items-center space-x-3">
                <div className="w-6 h-6 rounded-lg bg-slate-900/80 flex items-center justify-center text-[11px] font-bold text-slate-400">
                  {String.fromCharCode(65 + optIdx)}
                </div>
                <span>{opt.text}</span>
              </div>

              {isAnswered && opt.isCorrect && (
                <CheckCircle size={18} className="text-emerald-400 shrink-0 ml-2" />
              )}
              {isAnswered && !opt.isCorrect && selectedOption === optIdx && (
                <XCircle size={18} className="text-rose-400 shrink-0 ml-2" />
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom Manual Next Button if answered */}
      <div className="pt-1">
        {isAnswered && (
          <Button size="md" variant="primary" fullWidth onClick={handleNextQuestion}>
            <span>{currentIdx < questions.length - 1 ? '下一題' : '查看成績總結'}</span>
            <ArrowRight size={16} className="ml-1.5" />
          </Button>
        )}
      </div>
    </div>
  );
};
