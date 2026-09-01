import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play,
  RotateCcw,
  CheckCircle,
  XCircle,
  Sparkles,
  Flame,
  ArrowRight,
  ListFilter,
  Layers,
  HelpCircle,
  Bot,
  ChevronDown,
  ChevronUp,
  Loader2
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { useProfile } from '../contexts/ProfileContext';
import { courseRepository } from '../repositories/courseRepository';
import { quizService, NextGenQuestion, NextGenQuizMode } from '../services/quizService';
import { audioService } from '../services/audioService';
import { QuizSessionSummary } from '../types/quiz';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { AudioButton } from '../components/ui/AudioButton';

export const QuizPage: React.FC = () => {
  const navigate = useNavigate();
  const { activeProfile } = useProfile();

  // Quiz state
  const [selectedMode, setSelectedMode] = useState<NextGenQuizMode>('part5_mcq');
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [isAiGenerating, setIsAiGenerating] = useState<boolean>(false);
  const [recentTestedWordIds, setRecentTestedWordIds] = useState<string[]>([]);

  const [isStarted, setIsStarted] = useState<boolean>(false);
  const [questions, setQuestions] = useState<NextGenQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, number>>({});
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isAnswered, setIsAnswered] = useState<boolean>(false);

  // Collapsible Answer Drawer State
  const [isDrawerExpanded, setIsDrawerExpanded] = useState<boolean>(false);

  // Streak & Timer
  const [streak, setStreak] = useState<number>(0);
  const [maxStreak, setMaxStreak] = useState<number>(0);
  const [startTime, setStartTime] = useState<number>(0);

  // Summary & lapses
  const [summary, setSummary] = useState<QuizSessionSummary | null>(null);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isEnqueuing, setIsEnqueuing] = useState<boolean>(false);
  const [enqueuedSuccess, setEnqueuedSuccess] = useState<boolean>(false);

  // Load available categories
  useEffect(() => {
    courseRepository.getDownloadedCategories().then(cats => {
      setAvailableCategories(cats);
    });
  }, []);

  const handleStartQuiz = async (customMode?: NextGenQuizMode) => {
    await audioService.unlockAudio();

    const mode = customMode || selectedMode;

    const downloadedWords = await courseRepository.getAllDownloadedWords({
      category: selectedCategory,
      shuffle: true
    });

    if (downloadedWords.length === 0) {
      alert('目前尚無已下載課程，請先至「課程」頁面下載單字題庫。');
      navigate('/catalog');
      return;
    }

    let generated: NextGenQuestion[] = [];

    if (mode === 'ai_live') {
      setIsAiGenerating(true);
      try {
        generated = await quizService.generateAiLiveQuestions(downloadedWords, Math.min(5, questionCount));
      } finally {
        setIsAiGenerating(false);
      }
    } else {
      generated = quizService.generateNextGenQuestions(
        downloadedWords,
        mode,
        questionCount,
        recentTestedWordIds
      );
    }

    // Save tested word IDs into recency filter cache
    const newlyTestedIds = generated.map(q => q.word.id);
    setRecentTestedWordIds(prev => [...newlyTestedIds, ...prev].slice(0, 80));

    setQuestions(generated);
    setCurrentIdx(0);
    setUserAnswers({});
    setSelectedOption(null);
    setIsAnswered(false);
    setIsDrawerExpanded(false);
    setStreak(0);
    setMaxStreak(0);
    setStartTime(Date.now());
    setIsCompleted(false);
    setSummary(null);
    setEnqueuedSuccess(false);
    setIsStarted(true);

    if (mode === 'listening' && generated.length > 0) {
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

    audioService.playWord({
      headword: currentQ.word.headword,
      audioUrl: currentQ.word.audioUSUrl
    });

    if (isCorrect) {
      const nextStreak = streak + 1;
      setStreak(nextStreak);
      if (nextStreak > maxStreak) setMaxStreak(nextStreak);
    } else {
      setStreak(0);
    }
  };

  const handleNextQuestion = useCallback(() => {
    if (currentIdx < questions.length - 1) {
      const nextIdx = currentIdx + 1;
      setCurrentIdx(nextIdx);
      setSelectedOption(null);
      setIsAnswered(false);
      setIsDrawerExpanded(false);

      if (selectedMode === 'listening') {
        setTimeout(() => {
          audioService.playWord({
            headword: questions[nextIdx].word.headword,
            audioUrl: questions[nextIdx].word.audioUSUrl
          });
        }, 300);
      }
    } else {
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      const res = quizService.calculateSummary(questions, userAnswers, elapsedSec);
      setSummary(res);
      setIsCompleted(true);

      if (res.scorePercentage >= 80) {
        confetti({
          particleCount: 80,
          spread: 70,
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
      <div className="space-y-4 pb-6 max-w-md mx-auto">
        <div>
          <h2 className="text-xl font-black text-slate-100">多益實戰模擬測驗</h2>
          <p className="text-xs text-slate-400 mt-1">
            4 種全真題型 ＋ 支援 Gemini 3.6-Flash AI 名師即時原創出題！
          </p>
        </div>

        {/* 🤖 1-Click AI Master Quiz Banner */}
        <div className="p-4 rounded-3xl bg-gradient-to-r from-indigo-900/60 via-purple-900/60 to-slate-900 border border-indigo-500/50 shadow-xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="p-2 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/40">
                <Bot size={20} />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-100 flex items-center">
                  <span>🤖 AI 名師即時擬真出題</span>
                  <span className="ml-1.5 px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40">
                    Gemini 3.6
                  </span>
                </h3>
                <p className="text-[11px] text-slate-300">由 AI 即時生成 ETS 官方風格長難句與原創干擾項</p>
              </div>
            </div>
          </div>

          <Button
            size="md"
            variant="primary"
            fullWidth
            disabled={isAiGenerating}
            onClick={() => handleStartQuiz('ai_live')}
            className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-black text-xs py-2.5 shadow-lg shadow-indigo-950/50"
          >
            {isAiGenerating ? (
              <><Loader2 size={15} className="animate-spin mr-1.5" /> AI 名師正在出題中...</>
            ) : (
              <><Sparkles size={15} className="mr-1.5" /> 立即生成 AI 擬真測驗 (5 題)</>
            )}
          </Button>
        </div>

        {/* Mode Selector */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-300 flex items-center">
            <Layers size={13} className="mr-1 text-emerald-400" />
            <span>常規測驗模式</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'part5_mcq', label: 'Part 5 選擇', desc: '4 個商務單字語意辨析' },
              { id: 'cloze_fill', label: '克漏字填空', desc: '商務語境情境填空' },
              { id: 'listening', label: '聽力詞義選答', desc: '美英真人發音辨識' },
              { id: 'meaning', label: '中英字義速配', desc: '瞬時記憶快速檢驗' }
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedMode(m.id as NextGenQuizMode)}
                className={`p-3 rounded-2xl border text-left transition-all ${
                  selectedMode === m.id
                    ? 'bg-emerald-950/60 border-emerald-500 text-slate-100 shadow-md shadow-emerald-950/30'
                    : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="font-bold text-xs text-slate-100">{m.label}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-400 flex items-center">
              <ListFilter size={12} className="mr-1" /> 主題情境
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-200 font-bold focus:outline-none"
            >
              <option value="all">全部商務主題</option>
              {availableCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-400">測驗題數</label>
            <select
              value={questionCount}
              onChange={(e) => setQuestionCount(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-200 font-bold focus:outline-none"
            >
              <option value={5}>5 題（快速）</option>
              <option value={10}>10 題（標準）</option>
              <option value={20}>20 題（深度）</option>
            </select>
          </div>
        </div>

        <Button size="lg" variant="primary" fullWidth onClick={() => handleStartQuiz()} className="py-3 font-black text-sm">
          <Play size={17} className="mr-1.5 fill-white" /> 開始常規測驗
        </Button>
      </div>
    );
  }

  // Summary View
  if (isCompleted && summary) {
    return (
      <div className="space-y-4 pb-6 max-w-md mx-auto text-center animate-fade-in">
        <div className="p-6 rounded-3xl bg-slate-850 border border-slate-700 shadow-2xl space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto shadow-inner">
            <Sparkles size={32} />
          </div>

          <div>
            <h2 className="text-2xl font-black text-slate-100">測驗完成！</h2>
            <p className="text-xs text-slate-400 mt-1">
              耗時 {summary.timeSpentSec} 秒 · 連勝紀錄 {maxStreak} 題
            </p>
          </div>

          <div className="text-4xl font-black text-emerald-400 font-mono">
            {summary.scorePercentage}%
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800">
              <div className="text-slate-400">答對題數</div>
              <div className="text-base font-bold text-emerald-400 mt-0.5">{summary.correctCount} 題</div>
            </div>
            <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800">
              <div className="text-slate-400">答錯題數</div>
              <div className="text-base font-bold text-rose-400 mt-0.5">{summary.wrongCount} 題</div>
            </div>
          </div>

          {summary.wrongWords.length > 0 && (
            <div className="pt-2 border-t border-slate-800 space-y-2 text-left">
              <div className="text-xs font-bold text-rose-400">
                ⚠️ 答錯單字清單（{summary.wrongWords.length} 字）：
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                {summary.wrongWords.map((w) => (
                  <div key={w.id} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-xs flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-200">{w.headword}</span>
                      <span className="text-[11px] text-slate-400 ml-2">{w.definitionZh}</span>
                    </div>
                    <Badge variant="rose">複習</Badge>
                  </div>
                ))}
              </div>

              <Button
                size="sm"
                variant="outline"
                fullWidth
                disabled={isEnqueuing || enqueuedSuccess}
                onClick={handleEnqueueWrongAnswers}
                className="mt-2"
              >
                {enqueuedSuccess ? '✅ 已成功加入複習佇列' : isEnqueuing ? '加入中...' : '📥 一鍵將錯題加入 FSRS 複習隊列'}
              </Button>
            </div>
          )}
        </div>

        <div className="flex space-x-2">
          <Button size="md" variant="outline" fullWidth onClick={() => setIsStarted(false)}>
            <RotateCcw size={16} className="mr-1" /> 重選模式
          </Button>
          <Button size="md" variant="primary" fullWidth onClick={() => handleStartQuiz()}>
            <Play size={16} className="mr-1 fill-white" /> 再測一次
          </Button>
        </div>
      </div>
    );
  }

  const currentQ = questions[currentIdx];

  // Active Quiz View
  return (
    <div className="flex flex-col h-full justify-between max-w-md mx-auto space-y-2 pb-2 select-none overscroll-none touch-pan-y relative overflow-hidden">
      {/* Top Header & Progress */}
      <div className="space-y-1.5 shrink-0">
        <div className="flex items-center justify-between bg-slate-800/80 border border-slate-700/70 rounded-2xl px-3.5 py-1.5 shadow-sm">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-emerald-400">
              第 {currentIdx + 1} / {questions.length} 題
            </span>
            <Badge variant={currentQ.isAiLive ? 'purple' : 'blue'}>
              {currentQ.isAiLive ? '🤖 Gemini 3.6 AI 出題' : selectedMode === 'part5_mcq' ? 'Part 5 選擇' : selectedMode === 'cloze_fill' ? '克漏字' : selectedMode === 'listening' ? '聽力' : '字義'}
            </Badge>
          </div>

          <div className="flex items-center space-x-2">
            {streak > 1 && (
              <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold animate-pulse">
                <Flame size={12} className="fill-amber-400 text-amber-400" />
                <span>{streak} 連勝</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setIsStarted(false)}
              className="text-slate-400 hover:text-slate-200 p-1"
              aria-label="退出測驗"
            >
              <XCircle size={17} />
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

      {/* Middle Scrollable Area: Question Card + 4 Option Buttons */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-2.5 pr-1">
        {/* Question Card */}
        <div className="bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-700/80 rounded-3xl p-4 shadow-2xl flex flex-col justify-center items-center text-center min-h-[130px] space-y-2">
          {selectedMode === 'listening' ? (
            <div className="space-y-2">
              <AudioButton headword={currentQ.word.headword} audioUrl={currentQ.word.audioUSUrl} size="lg" />
              <div className="text-xs font-bold text-blue-300">
                {currentQ.stem}
              </div>
              {isAnswered && (
                <div className="text-sm font-black text-slate-100 mt-1">
                  {currentQ.word.headword} · {currentQ.word.definitionZh}
                </div>
              )}
            </div>
          ) : (
            <div className="w-full space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                <span className="font-semibold text-emerald-400">{currentQ.word.category}</span>
                <span>{currentQ.word.toeicScoreRange}</span>
              </div>

              {/* Stem sentence */}
              <div className="text-sm font-black text-slate-100 leading-snug px-1 text-left">
                {currentQ.stem}
              </div>

              {/* 🌟 答題後即時浮現題幹中文整句中譯 */}
              {isAnswered && currentQ.stemTranslation && (
                <div className="p-2.5 rounded-xl bg-emerald-950/50 border border-emerald-700/50 text-emerald-200 text-xs text-left leading-relaxed animate-in fade-in duration-200">
                  <span className="text-[10px] text-emerald-400 font-bold block mb-0.5">📖 繁中題幹翻譯：</span>
                  {currentQ.stemTranslation}
                </div>
              )}

              {/* Cloze Hint chip */}
              {currentQ.clozeHint && (
                <div className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-amber-950/50 border border-amber-800/40 text-[10px] text-amber-300">
                  <HelpCircle size={11} />
                  <span>{currentQ.clozeHint}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 4 Option Buttons */}
        <div className="space-y-2">
          {currentQ.options.map((opt, optIdx) => {
            let btnStyle = 'bg-slate-800/90 border-slate-700 hover:border-slate-600 text-slate-200';

            if (isAnswered) {
              if (optIdx === currentQ.correctIndex) {
                btnStyle = 'bg-emerald-950/90 border-emerald-500 text-emerald-200 shadow-md shadow-emerald-950/40';
              } else if (selectedOption === optIdx) {
                btnStyle = 'bg-rose-950/90 border-rose-500 text-rose-200 shadow-md shadow-rose-950/40';
              } else {
                btnStyle = 'bg-slate-900/70 border-slate-800 text-slate-400 opacity-70';
              }
            }

            const analysis = currentQ.optionAnalyses?.find(a => a.option === opt);

            return (
              <button
                key={optIdx}
                type="button"
                disabled={isAnswered}
                onClick={() => handleAnswerSelect(optIdx)}
                className={`w-full p-3 rounded-2xl border text-left font-semibold text-xs transition-all flex items-start justify-between active:scale-[0.98] ${btnStyle}`}
              >
                <div className="flex flex-col space-y-1 text-left w-full pr-2">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-5 h-5 rounded-md bg-slate-900/80 flex items-center justify-center text-[10px] font-bold text-slate-400 shrink-0">
                      {String.fromCharCode(65 + optIdx)}
                    </div>
                    <span className="font-bold text-sm text-slate-100">{opt}</span>
                    {isAnswered && optIdx === currentQ.correctIndex && (
                      <Badge variant="emerald">正解</Badge>
                    )}
                  </div>

                  {/* 🌟 答題後直接在選項框內寫出中文釋義、詞性與破題點 */}
                  {isAnswered && analysis && (
                    <div className="text-[11px] font-normal leading-relaxed pl-7 text-slate-300 animate-in fade-in duration-150">
                      {analysis.explanation}
                    </div>
                  )}
                </div>

                <div className="shrink-0 pt-0.5">
                  {isAnswered && optIdx === currentQ.correctIndex && (
                    <CheckCircle size={18} className="text-emerald-400" />
                  )}
                  {isAnswered && optIdx !== currentQ.correctIndex && selectedOption === optIdx && (
                    <XCircle size={18} className="text-rose-400" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 🌟 Post-Answer Collapsible Bottom Drawer (伸縮抽屜) */}
      {isAnswered && (
        <div className={`shrink-0 space-y-2 pt-1 border-t border-slate-800 bg-slate-900/95 z-30 transition-all duration-300 ease-out ${
          isDrawerExpanded ? 'max-h-[60dvh]' : 'max-h-[170px]'
        } flex flex-col justify-between`}>
          <div className="p-3 rounded-2xl bg-slate-850 border border-slate-700/80 text-xs space-y-2 shadow-lg overflow-y-auto flex-1">
            {/* Header with Expand / Collapse Button */}
            <div className="flex items-center justify-between text-[11px] font-bold">
              <span className="text-emerald-400">
                正確答案：【{String.fromCharCode(65 + currentQ.correctIndex)}】{currentQ.correctAnswer}
              </span>

              <button
                type="button"
                onClick={() => setIsDrawerExpanded(prev => !prev)}
                className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 text-[10px] font-bold flex items-center space-x-1 border border-slate-700"
              >
                <span>{isDrawerExpanded ? '收合精簡' : '🔍 展開完整 ABCD 剖析'}</span>
                {isDrawerExpanded ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              </button>
            </div>

            {/* Quick Summary Tip */}
            <p className="text-slate-300 leading-relaxed text-[11px]">
              {currentQ.explanation}
            </p>

            {/* Expanded Detailed Option Dissections (顯示完整條列式去冗餘剖析) */}
            {isDrawerExpanded && currentQ.optionAnalyses && currentQ.optionAnalyses.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-slate-800 animate-in fade-in duration-200">
                <div className="text-[10px] font-bold text-amber-400 flex items-center">
                  <Sparkles size={11} className="mr-1" /> 各選項考點精準剖析：
                </div>
                <div className="space-y-1">
                  {currentQ.optionAnalyses.map((item, idx) => (
                    <div key={idx} className="p-2 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] flex items-start space-x-2">
                      <span className={`px-1.5 py-0.2 rounded font-bold shrink-0 text-[10px] ${item.isCorrect ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-900 text-slate-400'}`}>
                        {String.fromCharCode(65 + idx)}
                      </span>
                      <span className="text-slate-300 leading-tight">
                        <strong className="text-slate-100">{item.option}</strong>：{item.explanation}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Prominently Pinned Next Question Button */}
          <Button size="md" variant="primary" fullWidth onClick={handleNextQuestion} className="py-2.5 text-xs font-bold shadow-lg shadow-emerald-950/50 shrink-0">
            <span>{currentIdx < questions.length - 1 ? '下一題' : '查看測驗成績'}</span>
            <ArrowRight size={15} className="ml-1.5" />
          </Button>
        </div>
      )}
    </div>
  );
};
