import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, CheckCircle2, ArrowRight } from 'lucide-react';
import { useProfile } from '../contexts/ProfileContext';
import { Button } from '../components/ui/Button';
import { audioService } from '../services/audioService';

export const OnboardingPage: React.FC = () => {
  const { createProfile } = useProfile();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [dailyTarget, setDailyTarget] = useState(15);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      // User gesture unlocks audio
      await audioService.unlockAudio();
      await createProfile(name.trim(), dailyTarget);
      navigate('/');
    } catch (err) {
      console.error('Failed to create profile:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[85dvh] flex flex-col justify-center items-center px-4 max-w-sm mx-auto">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-white shadow-xl shadow-emerald-900/30 mb-6">
        <GraduationCap size={36} />
      </div>

      <div className="text-center mb-8">
        <h2 className="text-2xl font-black text-slate-100">歡迎使用 TOEIC 速記</h2>
        <p className="text-sm text-slate-400 mt-2">
          採用 FSRS 間隔重複演算法，專為 iPhone 離線學習設計的單字卡。
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full bg-slate-800/80 border border-slate-700/80 rounded-2xl p-6 shadow-xl space-y-5">
        <div>
          <label htmlFor="studentName" className="block text-xs font-semibold text-slate-300 mb-1.5">
            學生暱稱 / 姓名
          </label>
          <input
            id="studentName"
            type="text"
            required
            placeholder="例如：Alex、Emma 或 學生1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            autoFocus
          />
          <p className="text-[11px] text-slate-400 mt-1">
            本機資料完全獨立隔離，多位學生可於同一裝置各自記錄進度。
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
            每日新字目標
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[10, 15, 25].map((target) => (
              <button
                key={target}
                type="button"
                onClick={() => setDailyTarget(target)}
                className={`py-2.5 rounded-xl border text-sm font-bold transition-all ${
                  dailyTarget === target
                    ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300 shadow-sm'
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {target} 字 / 天
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2">
          <Button
            type="submit"
            size="lg"
            fullWidth
            disabled={!name.trim() || isSubmitting}
            className="group"
          >
            <span>開始建立並進入 App</span>
            <ArrowRight size={18} className="ml-2 group-hover:translate-x-1 transition-transform" />
          </Button>
        </div>
      </form>

      <div className="mt-8 flex items-center space-x-2 text-xs text-slate-500">
        <CheckCircle2 size={14} className="text-emerald-500" />
        <span>100% 離線可用 · 零強制廣告 · 隱私無虞</span>
      </div>
    </div>
  );
};
