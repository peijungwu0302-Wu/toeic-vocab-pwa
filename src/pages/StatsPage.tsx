import React, { useEffect, useState, useCallback } from 'react';
import {
  Flame,
  AlertTriangle,
  Award,
  Repeat
} from 'lucide-react';
import { useProfile } from '../contexts/ProfileContext';
import { statsRepository } from '../repositories/statsRepository';
import { DailyStat } from '../types/db';
import { Badge } from '../components/ui/Badge';

export const StatsPage: React.FC = () => {
  const { activeProfile } = useProfile();

  const [stats, setStats] = useState<DailyStat[]>([]);
  const [streak, setStreak] = useState(0);
  const [weakestWords, setWeakestWords] = useState<Array<{ wordId: string; headword: string; againCount: number }>>([]);
  const [selectedRange, setSelectedRange] = useState<7 | 30>(7);

  const loadStats = useCallback(async () => {
    if (!activeProfile) return;
    try {
      const profileId = activeProfile.id;

      const dailyStats = await statsRepository.getDailyStats(profileId, selectedRange);
      setStats(dailyStats);

      const streakDays = await statsRepository.getStreakDays(profileId);
      setStreak(streakDays);

      const weak = await statsRepository.getMostForgottenWords(profileId, 15);
      setWeakestWords(weak);
    } catch (err) {
      console.error('[StatsPage] Load error:', err);
    }
  }, [activeProfile, selectedRange]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  let totalNew = 0;
  let totalReviews = 0;
  let totalAgain = 0;
  let totalHard = 0;
  let totalGood = 0;
  let totalEasy = 0;

  for (const s of stats) {
    totalNew += s.newCardsLearned;
    totalReviews += s.cardsReviewed;
    totalAgain += s.againCount;
    totalHard += s.hardCount;
    totalGood += s.goodCount;
    totalEasy += s.easyCount;
  }

  const accuracy = totalReviews > 0
    ? Math.round(((totalGood + totalEasy) / totalReviews) * 100)
    : 100;

  return (
    <div className="space-y-5 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-100">學習統計與分析</h2>
          <p className="text-xs text-slate-400 mt-1">追蹤記憶曲線與複習成效</p>
        </div>

        <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700">
          <button
            type="button"
            onClick={() => setSelectedRange(7)}
            className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
              selectedRange === 7 ? 'bg-emerald-600 text-white' : 'text-slate-400'
            }`}
          >
            近 7 天
          </button>
          <button
            type="button"
            onClick={() => setSelectedRange(30)}
            className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
              selectedRange === 30 ? 'bg-emerald-600 text-white' : 'text-slate-400'
            }`}
          >
            近 30 天
          </button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
            <Flame size={22} className="fill-amber-400" />
          </div>
          <div>
            <div className="text-xl font-black text-slate-100">{streak} 天</div>
            <div className="text-[11px] text-slate-400">目前連續天數</div>
          </div>
        </div>

        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center">
            <Award size={22} />
          </div>
          <div>
            <div className="text-xl font-black text-teal-300">{totalNew} 字</div>
            <div className="text-[11px] text-slate-400">期間新學單字</div>
          </div>
        </div>

        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
            <Award size={22} />
          </div>
          <div>
            <div className="text-xl font-black text-emerald-400">{accuracy}%</div>
            <div className="text-[11px] text-slate-400">記憶良好率</div>
          </div>
        </div>

        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center">
            <Repeat size={22} />
          </div>
          <div>
            <div className="text-xl font-black text-slate-100">{totalReviews}</div>
            <div className="text-[11px] text-slate-400">總複習次數</div>
          </div>
        </div>
      </div>

      {/* Ratings Distribution */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-slate-200">評分回想分佈 (FSRS Ratings)</h3>

        <div className="grid grid-cols-4 gap-2 text-center pt-1">
          <div className="bg-rose-950/40 border border-rose-800/40 rounded-xl p-2.5">
            <div className="text-lg font-black text-rose-400">{totalAgain}</div>
            <div className="text-[10px] text-rose-300">忘記 (Again)</div>
          </div>

          <div className="bg-amber-950/40 border border-amber-800/40 rounded-xl p-2.5">
            <div className="text-lg font-black text-amber-400">{totalHard}</div>
            <div className="text-[10px] text-amber-300">困難 (Hard)</div>
          </div>

          <div className="bg-blue-950/40 border border-blue-800/40 rounded-xl p-2.5">
            <div className="text-lg font-black text-blue-400">{totalGood}</div>
            <div className="text-[10px] text-blue-300">良好 (Good)</div>
          </div>

          <div className="bg-emerald-950/40 border border-emerald-800/40 rounded-xl p-2.5">
            <div className="text-lg font-black text-emerald-400">{totalEasy}</div>
            <div className="text-[10px] text-emerald-300">簡單 (Easy)</div>
          </div>
        </div>
      </div>

      {/* Weakest Words List */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200 flex items-center space-x-1.5">
            <AlertTriangle size={16} className="text-amber-400" />
            <span>最常忘記的弱點單字 (Top {weakestWords.length})</span>
          </h3>
        </div>

        {weakestWords.length === 0 ? (
          <p className="text-xs text-slate-500 py-3 text-center">
            目前無常忘單字紀錄，繼續保持！
          </p>
        ) : (
          <div className="space-y-2">
            {weakestWords.map((w, idx) => (
              <div
                key={w.wordId}
                className="flex items-center justify-between bg-slate-900/80 border border-slate-800 rounded-xl px-3 py-2 text-xs"
              >
                <div className="flex items-center space-x-2.5">
                  <span className="text-[11px] font-bold text-slate-500 w-4">{idx + 1}.</span>
                  <span className="font-bold text-slate-200">{w.headword}</span>
                </div>
                <Badge variant="rose">忘記 {w.againCount} 次</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
