import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Flame,
  Zap,
  Repeat,
  BookOpen,
  ArrowRight,
  FileText,
  Printer,
  Sparkles,
  Quote
} from 'lucide-react';
import { useProfile } from '../contexts/ProfileContext';
import { progressRepository } from '../repositories/progressRepository';
import { statsRepository } from '../repositories/statsRepository';
import { courseRepository } from '../repositories/courseRepository';
import { freeApiService, DailyQuote } from '../services/freeApiService';
import { Course, DailyStat } from '../types/db';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { audioService } from '../services/audioService';

export const DashboardPage: React.FC = () => {
  const { activeProfile } = useProfile();
  const navigate = useNavigate();

  const [dueCount, setDueCount] = useState<number>(0);
  const [streakDays, setStreakDays] = useState<number>(0);
  const [todayStat, setTodayStat] = useState<DailyStat | null>(null);
  const [downloadedCourses, setDownloadedCourses] = useState<Course[]>([]);
  const [dailyQuote, setDailyQuote] = useState<DailyQuote | null>(null);

  const loadDashboardData = useCallback(async () => {
    if (!activeProfile) return;

    try {
      const profileId = activeProfile.id;

      // 1. Due words count
      const dueWords = await progressRepository.getDueWords(profileId, undefined, 200);
      setDueCount(dueWords.length);

      // 2. Streak
      const streak = await statsRepository.getStreakDays(profileId);
      setStreakDays(streak);

      // 3. Today's stats
      const recentStats = await statsRepository.getDailyStats(profileId, 1);
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const foundToday = recentStats.find(s => s.dateStr === todayStr);
      setTodayStat(foundToday || null);

      // 4. Downloaded courses
      const courses = await courseRepository.getAll();
      const downloaded = courses.filter(c => c.isDownloaded);
      setDownloadedCourses(downloaded);

      // 5. Free daily quote
      freeApiService.getDailyQuote().then(setDailyQuote);
    } catch (err) {
      console.error('[Dashboard] Failed to load data:', err);
    }
  }, [activeProfile]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const handleStartReview = async (courseId?: string) => {
    await audioService.unlockAudio();
    if (courseId) {
      navigate(`/review?courseId=${courseId}`);
    } else {
      navigate('/review');
    }
  };

  const handleStartSkim = async (courseId?: string) => {
    await audioService.unlockAudio();
    if (courseId) {
      navigate(`/skim?courseId=${courseId}`);
    } else {
      navigate('/skim');
    }
  };

  if (!activeProfile) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-400">正在載入學生資料...</p>
      </div>
    );
  }

  const todayLearned = todayStat?.newCardsLearned || 0;
  const targetNew = activeProfile.dailyNewCardsTarget || 15;
  const newProgressPercent = Math.min(100, Math.round((todayLearned / targetNew) * 100));
  const avatarUrl = freeApiService.getAvatarUrl(activeProfile.displayName);

  return (
    <div className="space-y-4 pb-6">
      {/* Top Welcome / Student Banner */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700/80 rounded-3xl p-4 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {/* Dynamic Vector SVG Avatar */}
            <div className="w-12 h-12 rounded-2xl bg-slate-950/60 border border-slate-700 overflow-hidden shadow-inner flex items-center justify-center">
              <img src={avatarUrl} alt={activeProfile.displayName} className="w-full h-full object-cover" />
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <h2 className="text-lg font-black text-slate-100">{activeProfile.displayName}</h2>
                <Badge variant="emerald">離線 PWA</Badge>
              </div>
              <p className="text-[11px] text-slate-400">今日目標：{targetNew} 單字 · FSRS 記憶曲線排程</p>
            </div>
          </div>

          <div className="flex items-center space-x-1 px-2.5 py-1 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300">
            <Flame size={18} className="fill-amber-500 text-amber-500 animate-pulse" />
            <div className="text-right">
              <div className="text-xs font-black leading-none">{streakDays} 天</div>
              <div className="text-[9px] text-amber-400/80">連續打卡</div>
            </div>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-3 gap-2 mt-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-2.5 text-center">
            <div className="text-xl font-black text-amber-400">{dueCount}</div>
            <div className="text-[10px] text-slate-400 font-medium mt-0.5">待複習字數</div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-2.5 text-center">
            <div className="text-xl font-black text-emerald-400">
              {todayLearned}<span className="text-xs text-slate-500 font-normal">/{targetNew}</span>
            </div>
            <div className="text-[10px] text-slate-400 font-medium mt-0.5">今日新單字</div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-2.5 text-center">
            <div className="text-xl font-black text-blue-400">{todayStat?.cardsReviewed || 0}</div>
            <div className="text-[10px] text-slate-400 font-medium mt-0.5">今日已複習</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex justify-between text-[10px] text-slate-400 mb-1">
            <span>今日目標達成率</span>
            <span className="font-bold text-emerald-400">{newProgressPercent}%</span>
          </div>
          <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
              style={{ width: `${newProgressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Daily Business Quote from Free Quotable API */}
      {dailyQuote && (
        <div className="p-3 rounded-2xl bg-slate-800/50 border border-slate-700/60 text-xs flex items-start space-x-2.5">
          <Quote size={15} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-slate-300 italic text-[11px] leading-relaxed">"{dailyQuote.quote}"</p>
            <p className="text-[10px] text-slate-500">— {dailyQuote.author}</p>
          </div>
        </div>
      )}

      {/* Next-Gen 4 Core Action Hub */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* 1. Flashcards (FSRS Review) */}
        <button
          onClick={() => handleStartReview()}
          className="flex flex-col items-start justify-between p-3.5 rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-800 hover:from-emerald-500 hover:to-emerald-700 text-white shadow-lg shadow-emerald-950/40 border border-emerald-500/40 transition-all active:scale-[0.98] text-left group min-h-[110px]"
        >
          <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center mb-1">
            <Repeat size={18} className="text-white" />
          </div>
          <div>
            <div className="text-xs text-emerald-200 font-medium">FSRS 記憶曲線</div>
            <div className="text-base font-black leading-tight mt-0.5">間隔重複複習</div>
            <div className="text-xs text-emerald-200/80 mt-0.5">
              {dueCount > 0 ? `${dueCount} 個單字到期` : '目前無逾期單字'}
            </div>
          </div>
        </button>

        {/* 2. Fast Skim (1.5s Rapid Muscle Memory) - PROMOTED TO CORE ACTION HUB! */}
        <button
          onClick={() => handleStartSkim()}
          className="flex flex-col items-start justify-between p-3.5 rounded-2xl bg-gradient-to-br from-amber-600 to-amber-800 hover:from-amber-500 hover:to-amber-700 text-white shadow-lg shadow-amber-950/40 border border-amber-500/40 transition-all active:scale-[0.98] text-left group min-h-[110px]"
        >
          <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center mb-1">
            <Zap size={18} className="text-white" />
          </div>
          <div>
            <div className="text-xs text-amber-200 font-medium">1.5秒無痛過詞</div>
            <div className="text-base font-black leading-tight mt-0.5">極速肌肉速讀</div>
            <div className="text-xs text-amber-200/80 mt-0.5">
              高頻預熱 · 沉浸聽音
            </div>
          </div>
        </button>

        {/* 3. Part 5 & Cloze Quiz Arena */}
        <Link
          to="/quiz"
          className="flex flex-col items-start justify-between p-3.5 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-800 hover:from-blue-500 hover:to-indigo-700 text-white shadow-lg shadow-indigo-950/40 border border-blue-500/40 transition-all active:scale-[0.98] text-left group min-h-[110px]"
        >
          <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center mb-1">
            <FileText size={18} className="text-white" />
          </div>
          <div>
            <div className="text-xs text-blue-200 font-medium">實戰題庫</div>
            <div className="text-base font-black leading-tight mt-0.5">Part 5 測驗競技場</div>
            <div className="text-xs text-blue-200/80 mt-0.5">
              選擇題 · 克漏字 · 詳解
            </div>
          </div>
        </Link>

        {/* 4. Speed Run 60s */}
        <Link
          to="/speedrun"
          className="flex flex-col items-start justify-between p-3.5 rounded-2xl bg-gradient-to-br from-rose-600 to-red-800 hover:from-rose-500 hover:to-red-700 text-white shadow-lg shadow-red-950/40 border border-rose-500/40 transition-all active:scale-[0.98] text-left group min-h-[110px]"
        >
          <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center mb-1">
            <Flame size={18} className="text-white" />
          </div>
          <div>
            <div className="text-xs text-rose-200 font-medium">1秒直覺反應</div>
            <div className="text-base font-black leading-tight mt-0.5">60秒極速衝刺</div>
            <div className="text-xs text-rose-200/80 mt-0.5">
              Combo 連擊搶分
            </div>
          </div>
        </Link>
      </div>

      {/* Auxiliary Learning Tools: Printable Cram Sheet & AI Vocab Assessment */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <Link
          to="/assessment"
          className="p-3 rounded-2xl bg-gradient-to-r from-indigo-950/80 to-purple-950/60 border border-indigo-500/40 hover:border-indigo-400/80 transition-all flex items-center justify-between group shadow-md"
        >
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
              <Sparkles size={16} className="text-indigo-400" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-100 flex items-center space-x-1">
                <span>AI 詞彙量落點評測</span>
                <Badge variant="purple">15題</Badge>
              </div>
              <p className="text-[11px] text-slate-400">診斷多益藍/金證書落點</p>
            </div>
          </div>
          <ArrowRight size={15} className="text-indigo-400 group-hover:translate-x-0.5 transition-transform" />
        </Link>

        <Link
          to="/cram-sheet"
          className="p-3 rounded-2xl bg-slate-800/80 border border-purple-500/30 hover:border-purple-400/60 transition-all flex items-center justify-between group shadow-md"
        >
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold">
              <Printer size={16} className="text-purple-400" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-100 flex items-center space-x-1">
                <span>考前 100 題紙本 PDF</span>
                <Badge variant="emerald">可列印</Badge>
              </div>
              <p className="text-[11px] text-slate-400">匯出實體紙本離線背誦</p>
            </div>
          </div>
          <ArrowRight size={15} className="text-purple-400 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>

      {/* Downloaded Courses Overview */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-200 flex items-center space-x-1.5">
            <BookOpen size={14} className="text-emerald-400" />
            <span>我的離線題庫 ({downloadedCourses.length})</span>
          </h3>
          <Link to="/catalog" className="text-[11px] text-emerald-400 hover:text-emerald-300 font-medium flex items-center">
            查看全部題庫 <ArrowRight size={11} className="ml-0.5" />
          </Link>
        </div>

        {downloadedCourses.length > 0 ? (
          <div className="space-y-2">
            {downloadedCourses.slice(0, 3).map((c) => (
              <div
                key={c.id}
                className="bg-slate-800/60 border border-slate-700/60 hover:border-slate-600 rounded-2xl p-3 flex items-center justify-between transition-colors"
              >
                <div className="min-w-0 flex-1 mr-2">
                  <div className="flex items-center space-x-1.5">
                    <Badge variant="blue">{c.toeicScoreRange}</Badge>
                    <span className="text-[11px] text-slate-400">{c.category}</span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-100 truncate mt-1">{c.title}</h4>
                  <p className="text-[10px] text-slate-400">{c.wordCount} 字 · {c.wordCount * 6} 題測驗</p>
                </div>

                <div className="flex items-center space-x-1 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleStartSkim(c.id)}
                    className="text-[11px] px-2 py-1"
                  >
                    速讀
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => handleStartReview(c.id)}
                    className="text-[11px] px-2.5 py-1"
                  >
                    複習
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-amber-950/40 border border-amber-800/60 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold text-amber-300">尚未下載離線單字庫</h4>
              <p className="text-[11px] text-amber-400/80 mt-0.5">前往分級題庫一鍵下載核心 1,200 字</p>
            </div>
            <Link to="/catalog">
              <Button size="sm" variant="primary">前往下載</Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};
