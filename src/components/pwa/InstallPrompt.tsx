import React, { useState, useEffect } from 'react';
import { Share, PlusSquare, X } from 'lucide-react';

export const InstallPrompt: React.FC = () => {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // Detect iOS Safari and non-standalone
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream: unknown }).MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as unknown as { standalone?: boolean }).standalone;
    const hasDismissed = localStorage.getItem('ios_pwa_prompt_dismissed');

    if (isIOS && !isStandalone && !hasDismissed) {
      setShowPrompt(true);
    }
  }, []);

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('ios_pwa_prompt_dismissed', 'true');
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-40 bg-slate-800/95 border border-emerald-500/40 text-slate-100 p-4 rounded-2xl shadow-2xl backdrop-blur-md animate-fade-in">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <PlusSquare size={22} />
          </div>
          <div>
            <h4 className="font-bold text-sm text-emerald-300">安裝至 iPhone 主畫面</h4>
            <p className="text-xs text-slate-300 mt-0.5">獲得最流暢的離線全螢幕背單字體驗</p>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          aria-label="關閉安裝提示"
          className="text-slate-400 hover:text-slate-200 p-1"
        >
          <X size={18} />
        </button>
      </div>

      <div className="mt-3 pt-3 border-t border-slate-700/60 text-xs text-slate-300 flex items-center space-x-2">
        <span>點擊 Safari 底部的</span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-700 text-blue-400 font-semibold">
          <Share size={12} className="mr-1 inline" /> 分享
        </span>
        <span>→ 選擇</span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-700 text-emerald-400 font-semibold">
          加入主畫面
        </span>
      </div>
    </div>
  );
};
