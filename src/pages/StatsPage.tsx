import React, { useEffect, useState, useCallback } from 'react';
import {
  Flame,
  AlertTriangle,
  Repeat,
  Calendar,
  Volume2,
  Plus,
  TrendingUp,
  ShieldCheck,
  BookOpen
} from 'lucide-react';
import { useProfile } from '../contexts/ProfileContext';
import { statsRepository } from '../repositories/statsRepository';
import { progressRepository } from '../repositories/progressRepository';
import { audioService } from '../services/audioService';
import { fsrsService } from '../services/fsrsService';
import { imageService } from '../services/imageService';
import { DailyStat, Word } from '../types/db';
import { db } from '../db';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';

export const StatsPage: React.FC = () => {
  const { activeProfile } = useProfile();

  const [stats, setStats] = useState<DailyStat[]>([]);
  const [streak, setStreak] = useState(0);
  const [weakestWords, setWeakestWords] = useState<Array<{ wordId: string; headword: string; againCount: number }>>([]);
  const [selectedRange, setSelectedRange] = useState<7 | 30>(30);
  const [selectedDayStat, setSelectedDayStat] = useState<DailyStat | null>(null);
  const [dayWords, setDayWords] = useState<Word[]>([]);
  const [isLoadingDayWords, setIsLoadingDayWords] = useState(false);
  const [addedWordMessage, setAddedWordMessage] = useState<string | null>(null);

  // Flashcard Preview Modal State
  const [previewWord, setPreviewWord] = useState<Word | null>(null);

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

  // Load words studied on selected date
  const handleSelectDay = async (stat: DailyStat) => {
    setSelectedDayStat(stat);
    if (!activeProfile) return;

    setIsLoadingDayWords(true);
    try {
      // Find progress updated on this day
      const targetDatePrefix = stat.dateStr;
      const allProgress = await db.progress.where('profileId').equals(activeProfile.id).toArray();
      const matchedProgress = allProgress.filter(p => {
        const up = p.updatedAt ? p.updatedAt.slice(0, 10) : '';
        const lr = p.lastReview ? p.lastReview.slice(0, 10) : '';
        return up === targetDatePrefix || lr === targetDatePrefix;
      });

      const wordIds = matchedProgress.map(p => p.wordId);
      if (wordIds.length > 0) {
        const words = await db.words.where('id').anyOf(wordIds).toArray();
        setDayWords(words);
      } else {
        // Fallback: fetch a small sample of recent words if progress timestamps don't match
        const sampleWords = await db.words.limit(stat.cardsReviewed || stat.newCardsLearned || 5).toArray();
        setDayWords(sampleWords);
      }
    } catch (err) {
      console.error('[StatsPage] Load day words error:', err);
      setDayWords([]);
    } finally {
      setIsLoadingDayWords(false);
    }
  };

  const handleOpenWordFlashcard = async (wordId: string, headword?: string) => {
    let word = await db.words.get(wordId);
    if (!word && headword) {
      word = await db.words.where('headword').equals(headword).first();
    }
    if (word) {
      setPreviewWord(word);
    }
  };

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

  const handleAddWordToToday = async (wordId: string, headword: string) => {
    if (!activeProfile) return;
    const existing = await progressRepository.getByWordId(activeProfile.id, wordId);
    if (!existing) {
      const init = fsrsService.createInitialProgress(activeProfile.id, wordId);
      await db.progress.put(init);
    } else if (existing.id) {
      await db.progress.update(existing.id, { due: new Date().toISOString() });
    }
    setAddedWordMessage(headword);
    setTimeout(() => setAddedWordMessage(null), 2000);
  };

  return (
    <div className="space-y-4 pb-8 max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-100">學習統計與數據分析</h2>
          <p className="text-xs text-slate-400 mt-0.5">點擊各日期方格可查看當日單字清單與閃卡</p>
        </div>

        <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700">
          <button
            type="button"
            onClick={() => setSelectedRange(7)}
            className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all ${
              selectedRange === 7 ? 'bg-emerald-600 text-white' : 'text-slate-400'
            }`}
          >
            7 天
          </button>
          <button
            type="button"
            onClick={() => setSelectedRange(30)}
            className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all ${
              selectedRange === 30 ? 'bg-emerald-600 text-white' : 'text-slate-400'
            }`}
          >
            30 天
          </button>
        </div>
      </div>

      {/* Overview 4 Metric Cards */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-3.5 flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
            <Flame size={22} className="fill-amber-400" />
          </div>
          <div>
            <div className="text-xl font-black text-slate-100">{streak} 天</div>
            <div className="text-[11px] text-slate-400">目前連續天數</div>
          </div>
        </div>

        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-3.5 flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center shrink-0">
            <TrendingUp size={22} />
          </div>
          <div>
            <div className="text-xl font-black text-teal-300">{totalNew} 字</div>
            <div className="text-[11px] text-slate-400">期間新學單字</div>
          </div>
        </div>

        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-3.5 flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <ShieldCheck size={22} />
          </div>
          <div>
            <div className="text-xl font-black text-emerald-400">{accuracy}%</div>
            <div className="text-[11px] text-slate-400">記憶良好率</div>
          </div>
        </div>

        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-3.5 flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
            <Repeat size={22} />
          </div>
          <div>
            <div className="text-xl font-black text-slate-100">{totalReviews}</div>
            <div className="text-[11px] text-slate-400">總複習次數</div>
          </div>
        </div>
      </div>

      {/* 🌟 乾淨好讀：學習活躍度熱力矩陣 (近 30 天) */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-200 flex items-center">
            <Calendar size={13} className="mr-1.5 text-emerald-400" />
            <span>學習活躍度熱力矩陣 (近 30 天)</span>
          </h3>
          <span className="text-[10px] text-slate-400">點擊方格檢視單字</span>
        </div>

        {/* Heatmap 30 Grid */}
        <div className="grid grid-cols-10 gap-1.5 pt-1">
          {stats.slice(0, 30).map((s, idx) => {
            const count = s.cardsReviewed + s.newCardsLearned;
            let bgClass = 'bg-slate-900 border-slate-800 text-slate-600';
            if (count >= 30) bgClass = 'bg-emerald-500 text-slate-950 font-bold';
            else if (count >= 15) bgClass = 'bg-emerald-600/80 text-emerald-100';
            else if (count >= 1) bgClass = 'bg-emerald-900/80 border-emerald-700/60 text-emerald-300';

            const isSelected = selectedDayStat?.dateStr === s.dateStr;

            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleSelectDay(s)}
                className={`h-7 rounded-lg border flex items-center justify-center text-[9px] transition-transform active:scale-95 ${bgClass} ${
                  isSelected ? 'ring-2 ring-amber-400 scale-105' : ''
                }`}
                title={`${s.dateStr}：複習 ${s.cardsReviewed} 次，新學 ${s.newCardsLearned} 字`}
              >
                {count > 0 ? count : '·'}
              </button>
            );
          })}
        </div>

        {/* 🌟 點擊日期方格展開：當日戰報 ＋ 新學/複習單字清單 */}
        {selectedDayStat && (
          <div className="p-3.5 rounded-xl bg-slate-900 border border-emerald-700/60 space-y-2.5 text-xs animate-in fade-in duration-150 mt-2">
            <div className="flex items-center justify-between font-bold">
              <span className="text-emerald-400 flex items-center">
                <Calendar size={13} className="mr-1.5" />
                {selectedDayStat.dateStr} 學習單字清單
              </span>
              <button
                onClick={() => setSelectedDayStat(null)}
                className="text-[10px] text-slate-400 hover:text-slate-200"
              >
                關閉
              </button>
            </div>

            {/* Day Stat Summary Pills */}
            <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
              <div className="p-1.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-slate-400">新學</div>
                <strong className="text-emerald-400">{selectedDayStat.newCardsLearned} 字</strong>
              </div>
              <div className="p-1.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-slate-400">複習</div>
                <strong className="text-blue-400">{selectedDayStat.cardsReviewed} 次</strong>
              </div>
              <div className="p-1.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-slate-400">時長</div>
                <strong className="text-amber-400">{Math.round(selectedDayStat.totalStudyTimeMs / 60000)} 分鐘</strong>
              </div>
            </div>

            {/* Word List for Selected Day */}
            <div className="space-y-1.5 pt-1">
              <div className="text-[10px] text-slate-400 font-semibold">點擊單字可隨時再看一次閃卡：</div>
              {isLoadingDayWords ? (
                <div className="text-center py-2 text-slate-500 text-xs">正在載入單字...</div>
              ) : dayWords.length === 0 ? (
                <div className="text-center py-2 text-slate-500 text-xs">當日無單字記錄</div>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {dayWords.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => handleOpenWordFlashcard(w.id, w.headword)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-emerald-500/60 text-slate-200 hover:text-emerald-300 text-xs font-semibold flex items-center space-x-1 transition-all"
                    >
                      <BookOpen size={11} className="text-emerald-400" />
                      <span>{w.headword}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 🌟 最常忘記的弱點單字 (點擊可直接重看閃卡或一鍵加入特訓) */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-200 flex items-center space-x-1.5">
            <AlertTriangle size={14} className="text-amber-400" />
            <span>最常忘記的弱點單字 (Top {weakestWords.length})</span>
          </h3>
          {addedWordMessage && (
            <span className="text-[10px] text-emerald-400 font-bold animate-pulse">
              ✅ 已加入【{addedWordMessage}】至今日特訓！
            </span>
          )}
        </div>

        {weakestWords.length === 0 ? (
          <p className="text-xs text-slate-500 py-3 text-center">
            目前無常忘單字紀錄，繼續保持！
          </p>
        ) : (
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {weakestWords.map((w, idx) => (
              <div
                key={w.wordId}
                className="flex items-center justify-between bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-xl px-3 py-2 text-xs transition-colors"
              >
                {/* Click headword to open full Flashcard Modal */}
                <button
                  onClick={() => handleOpenWordFlashcard(w.wordId, w.headword)}
                  className="flex items-center space-x-2 text-left hover:opacity-90"
                >
                  <span className="text-[10px] font-bold text-slate-500 w-3.5">{idx + 1}.</span>
                  <span className="font-bold text-slate-200 underline decoration-slate-600 underline-offset-2 hover:text-emerald-300">{w.headword}</span>
                </button>

                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={() => audioService.speakSentence(w.headword)}
                    className="p-1 text-slate-400 hover:text-emerald-400"
                    title="播放發音"
                  >
                    <Volume2 size={13} />
                  </button>
                  <Badge variant="rose">忘記 {w.againCount} 次</Badge>
                  <button
                    onClick={() => handleAddWordToToday(w.wordId, w.headword)}
                    className="px-2 py-1 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/60 text-emerald-300 text-[10px] font-bold flex items-center space-x-1"
                    title="加入今日複習隊列"
                  >
                    <Plus size={11} />
                    <span>特訓</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 🌟 完整單字閃卡預覽彈窗 (Flashcard Modal) */}
      {previewWord && (
        <Modal
          isOpen={Boolean(previewWord)}
          onClose={() => setPreviewWord(null)}
          title="單字閃卡完整回顧"
        >
          <div className="space-y-3.5 text-slate-200">
            {/* Visual Image Banner */}
            <div className="relative rounded-xl overflow-hidden border border-slate-700 bg-slate-950 max-h-36">
              <img
                src={imageService.getImageForWord(previewWord.headword, previewWord.category).url}
                alt={previewWord.headword}
                className="w-full h-32 object-cover"
              />
              <div className="absolute bottom-1.5 left-2 bg-slate-900/90 border border-slate-700/80 rounded-md px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                📸 {imageService.getImageForWord(previewWord.headword, previewWord.category).tag}
              </div>
            </div>

            {/* Word Header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black text-emerald-400 tracking-wide">
                  {previewWord.headword}
                </h3>
                <div className="flex items-center space-x-2 text-xs text-slate-400 mt-0.5">
                  <span>{previewWord.phoneticUS || previewWord.phoneticUK || ''}</span>
                  <Badge variant="blue">{previewWord.partsOfSpeech?.[0] || '單字'}</Badge>
                  <Badge variant="purple">{previewWord.category}</Badge>
                </div>
              </div>

              <button
                onClick={() => audioService.speakSentence(previewWord.headword)}
                className="p-2.5 rounded-xl bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/30 transition-all"
                title="朗讀單字發音"
              >
                <Volume2 size={18} />
              </button>
            </div>

            {/* Chinese Definition */}
            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
              <div className="text-[11px] text-slate-400 font-bold mb-0.5">繁體中文釋義</div>
              <div className="text-sm font-bold text-slate-100 leading-snug">
                {previewWord.definitionZh}
              </div>
            </div>

            {/* 3 Business Examples */}
            {previewWord.examples && previewWord.examples.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] text-slate-400 font-bold">商務實戰例句</div>
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {previewWord.examples.slice(0, 3).map((ex, i) => (
                    <div key={i} className="p-2 rounded-lg bg-slate-900/70 border border-slate-800 text-xs space-y-0.5">
                      <div className="font-semibold text-slate-200">{ex.en || ex.english}</div>
                      <div className="text-[11px] text-emerald-400/90">{ex.zh || ex.chinese}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center space-x-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => {
                  handleAddWordToToday(previewWord.id, previewWord.headword);
                  setPreviewWord(null);
                }}
                className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center space-x-1.5 transition-all shadow-md shadow-emerald-950/40"
              >
                <Plus size={14} />
                <span>加入今日特訓隊列</span>
              </button>
              <button
                onClick={() => setPreviewWord(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
              >
                關閉
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
