import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';

export const UpdatePrompt: React.FC = () => {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    // Dynamic import to avoid SSR / mock issues
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        const update = registerSW({
          onNeedRefresh() {
            setNeedRefresh(true);
          },
          onOfflineReady() {
            console.log('[PWA] App is ready for offline use.');
          }
        });
        setUpdateSW(() => update);
      })
      .catch(() => {
        // PWA virtual module not loaded in standard dev or tests
      });
  }, []);

  if (!needRefresh) return null;

  return (
    <div className="fixed top-4 left-4 right-4 z-50 bg-indigo-900/90 border border-indigo-500/50 text-white p-3 rounded-2xl shadow-xl backdrop-blur flex items-center justify-between">
      <div className="flex items-center space-x-2 text-xs">
        <RefreshCw size={16} className="text-indigo-300 animate-spin" />
        <span>發現新版本，更新後可獲得最新字庫與功能</span>
      </div>
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          if (updateSW) updateSW();
        }}
      >
        立即更新
      </Button>
    </div>
  );
};
