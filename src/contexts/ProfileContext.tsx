import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { Profile } from '../types/db';
import { profileRepository } from '../repositories/profileRepository';

interface ProfileContextValue {
  activeProfile: Profile | null;
  profiles: Profile[];
  isLoading: boolean;
  createProfile: (name: string, dailyTarget?: number) => Promise<Profile>;
  switchProfile: (id: string) => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  refreshProfiles: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export const ProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refreshProfiles = useCallback(async () => {
    try {
      const all = await profileRepository.getAll();
      if (!isMountedRef.current) return;
      setProfiles(all);

      const activeId = await profileRepository.getActiveProfileId();
      if (!isMountedRef.current) return;

      if (activeId) {
        const found = all.find(p => p.id === activeId);
        if (found) {
          setActiveProfile(found);
        } else if (all.length > 0) {
          setActiveProfile(all[0]);
          await profileRepository.setActiveProfileId(all[0].id);
        } else {
          setActiveProfile(null);
        }
      } else if (all.length > 0) {
        setActiveProfile(all[0]);
        await profileRepository.setActiveProfileId(all[0].id);
      } else {
        setActiveProfile(null);
      }
    } catch (err) {
      console.error('[ProfileContext] Error refreshing profiles:', err);
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    refreshProfiles();
  }, [refreshProfiles]);

  const createProfile = async (name: string, dailyTarget = 15) => {
    const created = await profileRepository.create({
      displayName: name,
      dailyNewCardsTarget: dailyTarget
    });
    await refreshProfiles();
    return created;
  };

  const switchProfile = async (id: string) => {
    await profileRepository.setActiveProfileId(id);
    await refreshProfiles();
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!activeProfile) return;
    await profileRepository.update(activeProfile.id, updates);
    await refreshProfiles();
  };

  const deleteProfile = async (id: string) => {
    await profileRepository.delete(id);
    await refreshProfiles();
  };

  return (
    <ProfileContext.Provider
      value={{
        activeProfile,
        profiles,
        isLoading,
        createProfile,
        switchProfile,
        updateProfile,
        deleteProfile,
        refreshProfiles
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
};

export function useProfile(): ProfileContextValue {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return context;
}
