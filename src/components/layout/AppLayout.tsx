import React from 'react';
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
  User
} from 'lucide-react';
import { useProfile } from '../../contexts/ProfileContext';
import { useSync } from '../../contexts/SyncContext';
import { InstallPrompt } from '../pwa/InstallPrompt';
import { UpdatePrompt } from '../pwa/UpdatePrompt';

export const AppLayout: React.FC = () => {
  const { activeProfile } = useProfile();
  const { syncState, triggerSync } = useSync();
  const location = useLocation();

  // Hide bottom nav bar on focused immersive study screens if needed, or keep compact
  const isStudyScreen = location.pathname.startsWith('/skim') || location.pathname.startsWith('/review');

  const navItems = [
    { to: '/', label: '首頁', icon: LayoutDashboard },
    { to: '/catalog', label: '課程', icon: BookOpen },
    { to: '/skim', label: '速讀', icon: Zap },
    { to: '/review', label: '複習', icon: Repeat },
    { to: '/quiz', label: '測驗', icon: HelpCircle },
    { to: '/stats', label: '統計', icon: BarChart2 },
    { to: '/settings', label: '設定', icon: Settings }
  ];

  return (
    <div className="flex flex-col min-h-dvh max-w-lg mx-auto bg-slate-900 border-x border-slate-800 shadow-2xl relative">
      <UpdatePrompt />

      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex items-center justify-between pt-[max(12px,env(safe-area-inset-top))]">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center font-black text-white text-sm shadow-md shadow-emerald-900/40">
            T
          </div>
          <div>
            <h1 className="font-bold text-sm text-slate-100 leading-tight">TOEIC 速記</h1>
            <p className="text-[10px] text-emerald-400 font-medium">FSRS 智慧單字卡</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Cloud Sync Status */}
          {syncState.status === 'syncing' ? (
            <button
              onClick={() => triggerSync()}
              className="flex items-center space-x-1 px-2 py-1 rounded-full bg-blue-950/60 border border-blue-800 text-[11px] text-blue-300"
              title="雲端同步中..."
            >
              <RefreshCw size={12} className="animate-spin text-blue-400" />
              <span>同步中</span>
            </button>
          ) : syncState.status === 'error' ? (
            <button
              onClick={() => triggerSync()}
              className="flex items-center space-x-1 px-2 py-1 rounded-full bg-rose-950/60 border border-rose-800 text-[11px] text-rose-300"
              title={syncState.lastError || '同步失敗，點擊重試'}
            >
              <CloudOff size={12} className="text-rose-400" />
              <span>重試</span>
            </button>
          ) : syncState.cloudUserEmail ? (
            <div className="flex items-center space-x-1 px-2 py-1 rounded-full bg-emerald-950/60 border border-emerald-800 text-[11px] text-emerald-300">
              <Cloud size={12} className="text-emerald-400" />
              <span>已同步</span>
            </div>
          ) : null}

          {/* Active Profile Pill */}
          <NavLink
            to="/settings"
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 transition-colors"
          >
            <User size={13} className="text-emerald-400" />
            <span className="max-w-[70px] truncate font-medium">
              {activeProfile?.displayName || '未選擇'}
            </span>
          </NavLink>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 pb-24 px-4 py-4 overflow-y-auto">
        <Outlet />
      </main>

      {/* iOS Safari Installation Banner */}
      <InstallPrompt />

      {/* Bottom Tab Bar */}
      <nav
        className={`fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-slate-900/95 backdrop-blur-lg border-t border-slate-800/80 z-30 transition-transform duration-200 ${
          isStudyScreen ? 'translate-y-0' : ''
        }`}
        style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-center justify-around px-2 pt-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all min-w-[50px] min-h-[44px] ${
                    isActive
                      ? 'text-emerald-400 font-bold scale-105'
                      : 'text-slate-400 hover:text-slate-200 font-medium'
                  }`
                }
              >
                <Icon size={20} />
                <span className="text-[10px] mt-1 tracking-tight">{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
