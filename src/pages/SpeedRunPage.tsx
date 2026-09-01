import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Timer,
  Zap,
  Flame,
  Trophy,
  RotateCcw,
  Sparkles,
  XCircle
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { courseRepository } from '../repositories/courseRepository';
import { audioService } from '../services/audioService';
import { Word } from '../types/db';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';

interface SpeedRunQuestion {
  word: Word;
  correctAnswer: string;
  options: string[];
  correctIndex: number;
}

export const SpeedRunPage: React.FC = () => {
  const navigate = useNavigate();

  const [gameState, setGameState] = useState<'idle' | 'playing' | 'gameover'>('idle');
  const [timeLeft, setTimeLeft] = useState<number>(60);
  const [score, setScore] = useState<number>(0);
  const [combo, setCombo] = useState<number>(0);
  const [maxCombo, setMaxCombo] = useState<number>(0);
  const [highScore, setHighScore] = useState<number>(0);

  const [questions, setQuestions] = useState<SpeedRunQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isAnswered, setIsAnswered] = useState<boolean>(false);

  const timerRef = useRef<number | null>(null);

  // Load local highscore
  useEffect(() => {
    const saved = localStorage.getItem('toeic_speedrun_highscore');
    if (saved) setHighScore(Number(saved));
  }, []);

  const prepareQuestions = useCallback(async () => {
    const downloadedWords = await courseRepository.getAllDownloadedWords({ shuffle: true });
    if (downloadedWords.length < 4) {
      alert('請先至「課程」頁面下載單字庫後再進行極速挑戰！');
      navigate('/catalog');
      return [];
    }

    const shuffled = [...downloadedWords].sort(() => Math.random() - 0.5);
    const qs: SpeedRunQuestion[] = shuffled.map((targetWord) => {
      const correct = targetWord.definitionZh;
      const others = downloadedWords.filter(w => w.id !== targetWord.id).sort(() => Math.random() - 0.5).slice(0, 3);
      const distractors = others.map(w => w.definitionZh);
      while (distractors.length < 3) distractors.push('（選項）');

      const rawOpts = [correct, ...distractors].sort(() => Math.random() - 0.5);
      return {
        word: targetWord,
        correctAnswer: correct,
        options: rawOpts,
        correctIndex: rawOpts.indexOf(correct)
      };
    });

    return qs;
  }, [navigate]);

  const handleStartGame = async () => {
    await audioService.unlockAudio();
    const qs = await prepareQuestions();
    if (qs.length === 0) return;

    setQuestions(qs);
    setCurrentIdx(0);
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setTimeLeft(60);
    setSelectedOption(null);
    setIsAnswered(false);
    setGameState('playing');
  };

  // Timer Countdown
  useEffect(() => {
    if (gameState === 'playing') {
      timerRef.current = window.setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            setGameState('gameover');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [gameState]);

  // Handle Game Over
  useEffect(() => {
    if (gameState === 'gameover') {
      if (score > highScore) {
        setHighScore(score);
        localStorage.setItem('toeic_speedrun_highscore', String(score));
        confetti({
          particleCount: 100,
          spread: 80,
          origin: { y: 0.6 }
        });
      }
    }
  }, [gameState, score, highScore]);

  const handleOptionSelect = (optionIdx: number) => {
    if (isAnswered || gameState !== 'playing') return;

    const currentQ = questions[currentIdx];
    const isCorrect = optionIdx === currentQ.correctIndex;

    setSelectedOption(optionIdx);
    setIsAnswered(true);

    if (isCorrect) {
      const nextCombo = combo + 1;
      const comboBonus = Math.floor(nextCombo / 3) * 10;
      const points = 100 + comboBonus;
      setScore(prev => prev + points);
      setCombo(nextCombo);
      if (nextCombo > maxCombo) setMaxCombo(nextCombo);

      // Pronounce
      audioService.playWord({ headword: currentQ.word.headword, audioUrl: currentQ.word.audioUSUrl });
    } else {
      setCombo(0);
    }

    // Fast advance
    setTimeout(() => {
      if (currentIdx < questions.length - 1) {
        setCurrentIdx(prev => prev + 1);
        setSelectedOption(null);
        setIsAnswered(false);
      } else {
        setGameState('gameover');
      }
    }, 280);
  };

  const currentQ = questions[currentIdx];

  // 1. Idle Start View
  if (gameState === 'idle') {
    return (
      <div className="min-h-[75dvh] flex flex-col justify-center items-center max-w-sm mx-auto text-center space-y-6 pb-6">
        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-amber-500 to-red-600 flex items-center justify-center text-white shadow-2xl shadow-red-950/60 animate-bounce">
          <Zap size={48} className="fill-white" />
        </div>

        <div>
          <h2 className="text-2xl font-black text-slate-100">60 秒多益極速衝刺賽</h2>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed max-w-xs mx-auto">
            考驗考場上 <strong className="text-emerald-400">1 秒直覺反應力</strong>！在 60 秒內連續秒殺單字，維持連擊觸發 Combo 加分！
          </p>
        </div>

        {/* Highscore card */}
        <div className="w-full p-4 rounded-2xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-amber-400 font-bold text-xs">
            <Trophy size={16} />
            <span>個人最高紀錄</span>
          </div>
          <span className="text-lg font-black text-amber-400">{highScore} 分</span>
        </div>

        <Button size="lg" variant="primary" fullWidth onClick={handleStartGame} className="py-4 text-base font-black">
          <span>⚡ 開始 60 秒衝刺挑戰</span>
        </Button>
      </div>
    );
  }

  // 2. Game Over Screen
  if (gameState === 'gameover') {
    const isNewHigh = score >= highScore && score > 0;

    return (
      <div className="min-h-[75dvh] flex flex-col justify-center items-center max-w-sm mx-auto text-center space-y-5 pb-6">
        <div className="w-20 h-20 rounded-3xl bg-amber-500/20 text-amber-400 flex items-center justify-center shadow-xl shadow-amber-950/40">
          <Trophy size={40} className="fill-amber-400" />
        </div>

        <div>
          <h2 className="text-2xl font-black text-slate-100">時間到！挑戰結算</h2>
          {isNewHigh && (
            <div className="inline-flex items-center space-x-1 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold mt-2 animate-pulse">
              <Sparkles size={14} />
              <span>🎉 創下個人新高紀錄！</span>
            </div>
          )}
        </div>

        {/* Results grid */}
        <div className="w-full bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 grid grid-cols-2 gap-3 text-center">
          <div className="p-2.5 rounded-xl bg-slate-900/80">
            <div className="text-2xl font-black text-emerald-400">{score}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">最終得分</div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-900/80">
            <div className="text-2xl font-black text-amber-400">{maxCombo} 連勝</div>
            <div className="text-[10px] text-slate-400 mt-0.5">最高 Combo</div>
          </div>
        </div>

        <div className="w-full space-y-2 pt-2">
          <Button size="lg" fullWidth variant="primary" onClick={handleStartGame}>
            <RotateCcw size={16} className="mr-1.5" /> 再戰一次 (60s)
          </Button>
          <Button size="md" fullWidth variant="outline" onClick={() => navigate('/')}>
            返回儀表板
          </Button>
        </div>
      </div>
    );
  }

  // 3. Active Playing Screen
  return (
    <div className="flex flex-col h-[calc(100dvh-130px)] justify-between max-w-md mx-auto space-y-2 pb-2 select-none overscroll-none touch-pan-y">
      {/* Top Header & Fast Stats */}
      <div className="flex items-center justify-between bg-slate-800/80 border border-slate-700/70 rounded-2xl px-4 py-2 shadow-sm">
        {/* Timer */}
        <div className={`flex items-center space-x-1.5 text-sm font-black ${timeLeft <= 10 ? 'text-rose-400 animate-ping' : 'text-slate-100'}`}>
          <Timer size={16} />
          <span>{timeLeft}s</span>
        </div>

        {/* Combo */}
        {combo > 1 && (
          <div className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-black animate-bounce">
            <Flame size={14} className="fill-amber-400 text-amber-400" />
            <span>{combo} COMBO!</span>
          </div>
        )}

        {/* Current Score */}
        <div className="text-sm font-black text-emerald-400">
          {score} <span className="text-[10px] text-slate-400 font-normal">分</span>
        </div>

        <button
          type="button"
          onClick={() => setGameState('gameover')}
          className="text-slate-500 hover:text-slate-300"
          aria-label="提前結束"
        >
          <XCircle size={17} />
        </button>
      </div>

      {/* Speed Question Card */}
      {currentQ && (
        <div className="bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-700/80 rounded-3xl p-5 shadow-2xl flex flex-col justify-center items-center text-center min-h-[140px] space-y-2">
          <div className="flex items-center space-x-1.5">
            <Badge variant="blue">{currentQ.word.toeicScoreRange}</Badge>
            <span className="text-[11px] text-slate-400">{currentQ.word.category}</span>
          </div>

          <h2 className="text-3xl font-black text-slate-100 tracking-tight">
            {currentQ.word.headword}
          </h2>

          {currentQ.word.phoneticUS && (
            <p className="text-xs font-mono text-emerald-400/90">
              /{currentQ.word.phoneticUS}/
            </p>
          )}
        </div>
      )}

      {/* 4 Fast Option Buttons */}
      {currentQ && (
        <div className="space-y-2">
          {currentQ.options.map((opt, optIdx) => {
            let btnStyle = 'bg-slate-800/90 border-slate-700 text-slate-200 active:scale-95';

            if (isAnswered) {
              if (optIdx === currentQ.correctIndex) {
                btnStyle = 'bg-emerald-600 border-emerald-400 text-white shadow-lg shadow-emerald-950/60 scale-[1.02]';
              } else if (selectedOption === optIdx) {
                btnStyle = 'bg-rose-600 border-rose-400 text-white';
              } else {
                btnStyle = 'bg-slate-900/40 border-slate-800 text-slate-600 opacity-40';
              }
            }

            return (
              <button
                key={optIdx}
                type="button"
                disabled={isAnswered}
                onClick={() => handleOptionSelect(optIdx)}
                className={`w-full p-3.5 rounded-2xl border text-center font-bold text-xs transition-all min-h-[48px] ${btnStyle}`}
              >
                <span>{opt}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
