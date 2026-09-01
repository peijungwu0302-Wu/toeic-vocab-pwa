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
import { InstallPrompt } from '../pwa/InstallPrompt';
import { UpdatePrompt } from '../pwa/UpdatePrompt';
import { SearchModal } from '../ui/SearchModal';

export const AppLayout: React.FC = () => {
  const { activeProfile } = useProfile();
  const { syncState, triggerSync } = useSync();
  const location = useLocation();
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Check if current route is a focused study/quiz screen
  const isStudyScreen =
    location.pathname.startsWith('/skim') ||
    location.pathname.startsWith('/review') ||
    location.pathname.startsWith('/speedrun') ||
    location.pathname.startsWith('/quiz') ||
    location.pathname.startsWith('/assessment');

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
    <div className="flex flex-col h-dvh max-h-dvh max-w-lg mx-auto bg-slate-900 border-x border-slate-800 shadow-2xl relative overflow-hidden select-none">
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
        isStudyScreen ? 'overflow-hidden flex flex-col justify-between' : 'overflow-y-auto pb-4'
      }`}>
        <Outlet />
      </main>

      {/* iOS Safari Installation Banner */}
      <InstallPrompt />

      {/* Bottom Navigation Bar - ALWAYS Accessible across all tabs */}
      <nav
        className="shrink-0 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800/80 z-30"
        style={{ paddingBottom: 'max(6px, env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-center justify-around px-2 pt-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center py-1 px-1.5 rounded-xl transition-all min-w-[46px] min-h-[42px] ${
                    isActive
                      ? 'text-emerald-400 font-bold scale-105'
                      : 'text-slate-400 hover:text-slate-200 font-medium'
                  }`
                }
              >
                <Icon size={19} />
                <span className="text-[10px] mt-0.5 tracking-tight">{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
