import React, { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  BookOpen,
  Zap,
  Repeat,
  HelpCircle,
  BarChart2,
  Settings,
  Cloud,
  CloudOff,
  RefreshCw,
  User,
  Search
} from 'lucide-react';
import { useProfile } from '../../contexts/ProfileContext';
import { useSync } from '../../contexts/SyncContext';
import { useNavigationStyle } from '../../contexts/NavigationStyleContext';
import { InstallPrompt } from '../pwa/InstallPrompt';
import { UpdatePrompt } from '../pwa/UpdatePrompt';
import { SearchModal } from '../ui/SearchModal';

export const AppLayout: React.FC = () => {
  const { activeProfile } = useProfile();
  const { syncState, triggerSync } = useSync();
  const { navStyle, navOffset } = useNavigationStyle();
  const location = useLocation();
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Check if current route is a focused study/quiz screen
  const isStudyScreen =
    location.pathname.startsWith('/skim') ||
    location.pathname.startsWith('/review') ||
    location.pathname.startsWith('/speedrun') ||
    location.pathname.startsWith('/quiz') ||
    location.pathname.startsWith('/assessment');

  // Auto-hide bottom nav during study sessions; reveal on demand via edge handle or tap
  const [isNavRevealedInStudy, setIsNavRevealedInStudy] = useState(false);
  const hideTimerRef = React.useRef<number | null>(null);
  const touchStartY = React.useRef<number | null>(null);

  // Auto collapse when entering or changing study routes
  React.useEffect(() => {
    setIsNavRevealedInStudy(false);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, [location.pathname]);

  const handleRevealNav = () => {
    setIsNavRevealedInStudy(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setIsNavRevealedInStudy(false);
    }, 4500);
  };

  const navItems = [
    { to: '/', label: '首頁', icon: LayoutDashboard },
    { to: '/catalog', label: '課程', icon: BookOpen },
    { to: '/review', label: '複習', icon: Repeat },
    { to: '/quiz', label: '測驗', icon: HelpCircle },
    { to: '/speedrun', label: '衝刺', icon: Zap },
    { to: '/stats', label: '統計', icon: BarChart2 },
    { to: '/settings', label: '設定', icon: Settings }
  ];

  return (
    <div className="fixed inset-0 flex flex-col w-full max-w-lg mx-auto bg-slate-900 border-x border-slate-800 shadow-2xl overflow-hidden select-none">
      <UpdatePrompt />

      {/* Top Header */}
      <header className="shrink-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-3.5 py-2 flex items-center justify-between pt-[max(8px,env(safe-area-inset-top))]">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center font-black text-white text-xs shadow-md shadow-emerald-900/40">
            T
          </div>
          <div>
            <h1 className="font-bold text-xs text-slate-100 leading-tight">TOEIC 速記</h1>
            <p className="text-[9px] text-emerald-400 font-medium">FSRS 智慧單字卡</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Global Dictionary Search Button */}
          <button
            onClick={() => setIsSearchOpen(true)}
            className="p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-emerald-400 transition-colors"
            title="字典搜尋"
          >
            <Search size={13} />
          </button>

          {/* Cloud Sync Status */}
          {syncState.status === 'syncing' ? (
            <button
              onClick={() => triggerSync()}
              className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-blue-950/60 border border-blue-800 text-[10px] text-blue-300"
              title="雲端同步中..."
            >
              <RefreshCw size={11} className="animate-spin text-blue-400" />
              <span>同步中</span>
            </button>
          ) : syncState.status === 'error' ? (
            <button
              onClick={() => triggerSync()}
              className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-rose-950/60 border border-rose-800 text-[10px] text-rose-300"
              title={syncState.lastError || '同步失敗，點擊重試'}
            >
              <CloudOff size={11} className="text-rose-400" />
              <span>重試</span>
            </button>
          ) : syncState.cloudUserEmail ? (
            <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800 text-[10px] text-emerald-300">
              <Cloud size={11} className="text-emerald-400" />
              <span>已同步</span>
            </div>
          ) : null}

          {/* Active Profile Pill */}
          <NavLink
            to="/settings"
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 transition-colors"
          >
            <User size={12} className="text-emerald-400" />
            <span className="max-w-[70px] truncate font-medium">
              {activeProfile?.displayName || '未選擇'}
            </span>
          </NavLink>
        </div>
      </header>

      {/* Global Dictionary Search Modal */}
      <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />

      {/* Main Content Area: Takes EXACT remaining space between header and bottom nav */}
      <main className={`flex-1 min-h-0 px-3.5 py-1.5 ${
        isStudyScreen
          ? 'overflow-hidden flex flex-col justify-between'
          : navStyle === 'classic'
            ? 'overflow-y-auto pb-4'
            : 'overflow-y-auto pb-20'
      }`}>
        <Outlet />
      </main>

      {/* iOS Safari Installation Banner */}
      <InstallPrompt />

      {/* 方案 1A：iOS 原生極簡手柄線 (Minimalist Grabber Line) */}
      {isStudyScreen && !isNavRevealedInStudy && (
        <button
          type="button"
          onClick={handleRevealNav}
          onTouchStart={(e) => {
            touchStartY.current = e.touches[0].clientY;
          }}
          onTouchMove={(e) => {
            if (touchStartY.current !== null) {
              const deltaY = touchStartY.current - e.touches[0].clientY;
              if (deltaY > 12) {
                handleRevealNav();
                touchStartY.current = null;
              }
            }
          }}
          className="fixed bottom-1.5 left-1/2 -translate-x-1/2 z-40 px-6 py-2 flex items-center justify-center cursor-pointer select-none active:scale-90 transition-transform"
          aria-label="展開導覽列"
          title="展開導覽列"
        >
          <span className="w-10 h-1 rounded-full bg-slate-400/40 hover:bg-slate-300/70 shadow-sm transition-colors" />
        </button>
      )}

      {/* Bottom Navigation Bar - Auto collapses during study screen, accessible via edge handle */}
      {navStyle === 'island' ? (
        // 方案 B：Apple Music 同款 · 懸浮膠囊島 (iOS 18 Floating Island)
        <nav
          className={`fixed left-3 right-3 max-w-[calc(32rem-1.5rem)] mx-auto rounded-[26px] bg-slate-900/90 backdrop-blur-2xl border border-white/15 shadow-2xl shadow-black/90 z-40 px-2 py-1.5 transition-all duration-300 ${
            isStudyScreen && !isNavRevealedInStudy
              ? 'translate-y-[200%] opacity-0 pointer-events-none'
              : 'translate-y-0 opacity-100 pointer-events-auto'
          }`}
          style={{ bottom: `${navOffset}px` }}
        >
          <div className="flex items-center justify-around">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex flex-col items-center justify-center transition-all min-w-[40px] ${
                      isActive
                        ? 'bg-emerald-500/20 text-emerald-400 font-bold px-2 py-1 rounded-2xl scale-105 border border-emerald-500/30'
                        : 'text-slate-400 hover:text-slate-200 font-medium px-1.5 py-1'
                    }`
                  }
                >
                  <Icon size={18} />
                  <span className="text-[10px] mt-0.5 tracking-tight leading-none">{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        </nav>
      ) : navStyle === 'flush' ? (
        // 方案 A：穿透毛玻璃 · 極致下沉貼底 (Ultra-Flush Frosted Glass)
        <nav
          className={`fixed left-0 right-0 max-w-lg mx-auto bg-slate-900/85 backdrop-blur-2xl border-t border-white/10 z-40 pb-2 transition-all duration-300 ${
            isStudyScreen && !isNavRevealedInStudy
              ? 'translate-y-[200%] opacity-0 pointer-events-none'
              : 'translate-y-0 opacity-100 pointer-events-auto'
          }`}
          style={{ bottom: `${navOffset}px` }}
        >
          <div className="flex items-center justify-around px-1 pt-1.5 pb-0">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex flex-col items-center justify-center py-0.5 px-1 rounded-xl transition-all min-w-[42px] ${
                      isActive
                        ? 'text-emerald-400 font-bold scale-105'
                        : 'text-slate-400 hover:text-slate-200 font-medium'
                    }`
                  }
                >
                  <Icon size={18} />
                  <span className="text-[10px] mt-0.5 tracking-tight leading-none">{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        </nav>
      ) : (
        // 傳統模式：經典全寬，目前模式
        <nav
          className={`fixed left-0 right-0 max-w-lg mx-auto bg-slate-900/98 backdrop-blur-md border-t border-slate-800 z-30 pb-2 transition-all duration-300 ${
            isStudyScreen && !isNavRevealedInStudy
              ? 'translate-y-[200%] opacity-0 pointer-events-none'
              : 'translate-y-0 opacity-100 pointer-events-auto'
          }`}
          style={{ bottom: `${navOffset}px` }}
        >
          <div className="flex items-center justify-around px-1 pt-1.5 pb-0">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex flex-col items-center justify-center py-0.5 px-1 rounded-xl transition-all min-w-[42px] ${
                      isActive
                        ? 'text-emerald-400 font-bold scale-105'
                        : 'text-slate-400 hover:text-slate-200 font-medium'
                    }`
                  }
                >
                  <Icon size={18} />
                  <span className="text-[10px] mt-0.5 tracking-tight leading-none">{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
};
