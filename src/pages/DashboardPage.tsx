import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Flame,
  Zap,
  Repeat,
  BookOpen,
  Star,
  ArrowRight,
  DownloadCloud
} from 'lucide-react';
import { useProfile } from '../contexts/ProfileContext';
import { progressRepository } from '../repositories/progressRepository';
import { statsRepository } from '../repositories/statsRepository';
import { courseRepository } from '../repositories/courseRepository';
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
  const [starredCount, setStarredCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  const loadDashboardData = useCallback(async () => {
    if (!activeProfile) return;

    try {
      setIsLoading(true);
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

      // 5. Starred count
      const starred = await progressRepository.getStarredWords(profileId);
      setStarredCount(starred.length);
    } catch (err) {
      console.error('[Dashboard] Failed to load data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeProfile]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const handleStartReview = async (courseId?: string) => {
    // User touch gesture unlocks audio
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

  return (
    <div className="space-y-5 pb-6">
      {/* Top Welcome / Streak Banner */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700/80 rounded-3xl p-5 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-black text-slate-100">{activeProfile.displayName}</h2>
              <Badge variant="emerald">iPhone 離線版</Badge>
            </div>
            <p className="text-xs text-slate-400 mt-1">今天也是提升多益實力的好日子！</p>
          </div>

          <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300">
            <Flame size={20} className="fill-amber-500 text-amber-500 animate-pulse" />
            <div className="text-right">
              <div className="text-sm font-black leading-none">{streakDays}</div>
              <div className="text-[10px] text-amber-400/80">連續天數</div>
            </div>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-3 gap-2.5 mt-5">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 text-center">
            <div className="text-2xl font-black text-amber-400">{dueCount}</div>
            <div className="text-[11px] text-slate-400 font-medium mt-0.5">待複習字數</div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 text-center">
            <div className="text-2xl font-black text-emerald-400">
              {todayLearned}<span className="text-xs text-slate-500 font-normal">/{targetNew}</span>
            </div>
            <div className="text-[11px] text-slate-400 font-medium mt-0.5">今日新單字</div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 text-center">
            <div className="text-2xl font-black text-blue-400">{todayStat?.cardsReviewed || 0}</div>
            <div className="text-[11px] text-slate-400 font-medium mt-0.5">今日已複習</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="flex justify-between text-[11px] text-slate-400 mb-1">
            <span>今日新字目標進度</span>
            <span className="font-bold text-emerald-400">{newProgressPercent}%</span>
          </div>
          <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
              style={{ width: `${newProgressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Main Action CTAs */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => handleStartReview()}
          className="flex flex-col items-start justify-between p-4 rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-800 hover:from-emerald-500 hover:to-emerald-700 text-white shadow-lg shadow-emerald-950/40 border border-emerald-500/40 transition-all active:scale-[0.98] text-left group min-h-[120px]"
        >
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center mb-2">
            <Repeat size={22} className="text-white" />
          </div>
          <div>
            <div className="text-xs text-emerald-200 font-medium">主動回想</div>
            <div className="text-base font-black leading-tight mt-0.5">間隔重複複習</div>
            <div className="text-[11px] text-emerald-200/80 mt-1">
              {dueCount > 0 ? `${dueCount} 個單字已到期` : '目前無逾期單字'}
            </div>
          </div>
        </button>

        <button
          onClick={() => handleStartSkim()}
          className="flex flex-col items-start justify-between p-4 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-800 hover:from-blue-500 hover:to-indigo-700 text-white shadow-lg shadow-indigo-950/40 border border-blue-500/40 transition-all active:scale-[0.98] text-left group min-h-[120px]"
        >
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center mb-2">
            <Zap size={22} className="text-white" />
          </div>
          <div>
            <div className="text-xs text-blue-200 font-medium">快速瀏覽</div>
            <div className="text-base font-black leading-tight mt-0.5">速讀新字卡</div>
            <div className="text-[11px] text-blue-200/80 mt-1">
              自動計時 · 例句發音
            </div>
          </div>
        </button>
      </div>

      {/* No downloaded courses prompt */}
      {downloadedCourses.length === 0 && !isLoading && (
        <div className="bg-amber-950/40 border border-amber-800/60 rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <DownloadCloud size={22} />
            </div>
            <div>
              <h4 className="text-sm font-bold text-amber-300">尚未下載離線題庫</h4>
              <p className="text-xs text-amber-400/80 mt-0.5">前往課程頁面下載多益分級字庫</p>
            </div>
          </div>
          <Link to="/catalog">
            <Button size="sm" variant="primary">
              前往下載
            </Button>
          </Link>
        </div>
      )}

      {/* Downloaded Courses List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200 flex items-center space-x-1.5">
            <BookOpen size={16} className="text-emerald-400" />
            <span>我的離線課程 ({downloadedCourses.length})</span>
          </h3>
          <Link to="/catalog" className="text-xs text-emerald-400 hover:text-emerald-300 font-medium flex items-center">
            瀏覽更多課程 <ArrowRight size={13} className="ml-1" />
          </Link>
        </div>

        {downloadedCourses.length > 0 ? (
          <div className="space-y-2">
            {downloadedCourses.slice(0, 4).map((c) => (
              <div
                key={c.id}
                className="bg-slate-800/60 border border-slate-700/60 hover:border-slate-600 rounded-2xl p-3.5 flex items-center justify-between transition-colors"
              >
                <div className="min-w-0 flex-1 mr-3">
                  <div className="flex items-center space-x-2">
                    <Badge variant="blue">{c.toeicScoreRange}</Badge>
                    <span className="text-xs text-slate-400">{c.category}</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-100 truncate mt-1">{c.title}</h4>
                  <p className="text-[11px] text-slate-400">{c.wordCount} 個單字 · 離線已就緒</p>
                </div>

                <div className="flex items-center space-x-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleStartSkim(c.id)}
                    className="text-xs px-2.5 py-1"
                  >
                    <Zap size={13} className="mr-1 text-blue-400" /> 速讀
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => handleStartReview(c.id)}
                    className="text-xs px-2.5 py-1"
                  >
                    <Repeat size={13} className="mr-1" /> 複習
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-slate-800/30 border border-dashed border-slate-700 rounded-2xl p-6 text-center">
            <p className="text-xs text-slate-400">目前尚無離線課程，點擊上方按鈕下載多益官方題庫單字。</p>
          </div>
        )}
      </div>

      {/* Starred / Weak Words Practice */}
      {starredCount > 0 && (
        <div className="bg-slate-800/50 border border-amber-500/30 rounded-2xl p-3.5 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <Star size={20} className="fill-amber-400 text-amber-400" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-200">重點收藏單字</h4>
              <p className="text-[11px] text-amber-400/90">{starredCount} 個已標註星號單字</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleStartReview('starred')}
          >
            複習收藏
          </Button>
        </div>
      )}
    </div>
  );
};
