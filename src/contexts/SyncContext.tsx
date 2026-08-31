import React, { createContext, useContext, useEffect, useState } from 'react';
import { SyncState } from '../types/sync';
import { syncEngine } from '../services/syncEngine';

interface SyncContextValue {
  syncState: SyncState;
  triggerSync: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [syncState, setSyncState] = useState<SyncState>(syncEngine.getState());

  useEffect(() => {
    const unsubscribe = syncEngine.subscribe((state) => {
      setSyncState(state);
    });
    return unsubscribe;
  }, []);

  const triggerSync = async () => {
    await syncEngine.processQueue();
  };

  return (
    <SyncContext.Provider value={{ syncState, triggerSync }}>
      {children}
    </SyncContext.Provider>
  );
};

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSync must be used within a SyncProvider');
  }
  return context;
}
