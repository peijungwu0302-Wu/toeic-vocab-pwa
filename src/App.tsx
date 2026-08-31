import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProfileProvider, useProfile } from './contexts/ProfileContext';
import { SyncProvider } from './contexts/SyncContext';
import { AppLayout } from './components/layout/AppLayout';
import { OnboardingPage } from './pages/OnboardingPage';
import { DashboardPage } from './pages/DashboardPage';
import { CatalogPage } from './pages/CatalogPage';
import { FastSkimPage } from './pages/FastSkimPage';
import { FlashcardPage } from './pages/FlashcardPage';
import { QuizPage } from './pages/QuizPage';
import { StatsPage } from './pages/StatsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AttributionPage } from './pages/AttributionPage';

const AppRoutes: React.FC = () => {
  const { activeProfile, isLoading } = useProfile();

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-900 text-slate-400">
        <div className="text-center space-y-2">
          <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs">正在載入 TOEIC 速記...</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route
        path="/"
        element={activeProfile ? <AppLayout /> : <Navigate to="/onboarding" replace />}
      >
        <Route index element={<DashboardPage />} />
        <Route path="catalog" element={<CatalogPage />} />
        <Route path="skim" element={<FastSkimPage />} />
        <Route path="review" element={<FlashcardPage />} />
        <Route path="quiz" element={<QuizPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="attribution" element={<AttributionPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <ProfileProvider>
        <SyncProvider>
          <AppRoutes />
        </SyncProvider>
      </ProfileProvider>
    </BrowserRouter>
  );
};

export default App;
