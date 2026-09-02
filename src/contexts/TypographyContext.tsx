import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';

export type HeadwordSize = 'sm' | 'md' | 'lg' | 'xl';
export type ExampleEnSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type ExampleZhSize = 'xs' | 'sm' | 'md' | 'lg';
export type DefinitionSize = 'sm' | 'md' | 'lg' | 'xl';

export interface TypographySettings {
  headwordSize: HeadwordSize;
  exampleEnSize: ExampleEnSize;
  exampleZhSize: ExampleZhSize;
  definitionSize: DefinitionSize;
  fastSkimDurationSec: number;
  fastSkimShowImage: boolean;
}

const DEFAULT_SETTINGS: TypographySettings = {
  headwordSize: 'md',
  exampleEnSize: 'md',
  exampleZhSize: 'sm',
  definitionSize: 'md',
  fastSkimDurationSec: 1.5,
  fastSkimShowImage: true
};

interface TypographyContextType {
  settings: TypographySettings;
  updateSettings: (newSettings: Partial<TypographySettings>) => void;
  resetSettings: () => void;
  applyPreset: (preset: 'compact' | 'standard' | 'large' | 'huge') => void;
  zoomIn: () => void;
  zoomOut: () => void;
  currentPreset: 'compact' | 'standard' | 'large' | 'huge' | 'custom';
  // CSS Class mappings
  headwordClass: string;
  exampleEnClass: string;
  exampleZhClass: string;
  definitionClass: string;
}

const TypographyContext = createContext<TypographyContextType | undefined>(undefined);

const STORAGE_KEY = 'toeic_typography_settings_v1';

export const TypographyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<TypographySettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      }
    } catch {}
    return DEFAULT_SETTINGS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {}
  }, [settings]);

  const updateSettings = (newSettings: Partial<TypographySettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  const resetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
  };

  const applyPreset = (preset: 'compact' | 'standard' | 'large' | 'huge') => {
    switch (preset) {
      case 'compact':
        setSettings(prev => ({
          ...prev,
          headwordSize: 'sm',
          exampleEnSize: 'xs',
          exampleZhSize: 'xs',
          definitionSize: 'sm'
        }));
        break;
      case 'standard':
        setSettings(prev => ({
          ...prev,
          headwordSize: 'md',
          exampleEnSize: 'md',
          exampleZhSize: 'sm',
          definitionSize: 'md'
        }));
        break;
      case 'large':
        setSettings(prev => ({
          ...prev,
          headwordSize: 'lg',
          exampleEnSize: 'lg',
          exampleZhSize: 'md',
          definitionSize: 'lg'
        }));
        break;
      case 'huge':
        setSettings(prev => ({
          ...prev,
          headwordSize: 'xl',
          exampleEnSize: 'xl',
          exampleZhSize: 'lg',
          definitionSize: 'xl'
        }));
        break;
    }
  };

  // Dynamic CSS Class Mappings
  const headwordClass = useMemo(() => {
    switch (settings.headwordSize) {
      case 'sm': return 'text-xl md:text-2xl font-black';
      case 'md': return 'text-2xl md:text-3xl font-black';
      case 'lg': return 'text-3xl md:text-4xl font-black';
      case 'xl': return 'text-4xl md:text-5xl font-black';
    }
  }, [settings.headwordSize]);

  const exampleEnClass = useMemo(() => {
    switch (settings.exampleEnSize) {
      case 'xs': return 'text-[11px] md:text-xs leading-relaxed';
      case 'sm': return 'text-xs md:text-[13px] leading-relaxed';
      case 'md': return 'text-[13px] md:text-sm leading-relaxed font-medium';
      case 'lg': return 'text-sm md:text-base leading-relaxed font-semibold';
      case 'xl': return 'text-base md:text-lg leading-relaxed font-bold';
    }
  }, [settings.exampleEnSize]);

  const exampleZhClass = useMemo(() => {
    switch (settings.exampleZhSize) {
      case 'xs': return 'text-[10px] md:text-[11px] leading-normal';
      case 'sm': return 'text-[11px] md:text-xs leading-normal font-medium';
      case 'md': return 'text-xs md:text-sm leading-normal font-semibold';
      case 'lg': return 'text-sm md:text-base leading-normal font-bold';
    }
  }, [settings.exampleZhSize]);

  const definitionClass = useMemo(() => {
    switch (settings.definitionSize) {
      case 'sm': return 'text-sm md:text-base font-bold';
      case 'md': return 'text-base md:text-lg font-bold';
      case 'lg': return 'text-lg md:text-xl font-extrabold';
      case 'xl': return 'text-xl md:text-2xl font-black';
    }
  }, [settings.definitionSize]);

  const currentPreset: 'compact' | 'standard' | 'large' | 'huge' | 'custom' = useMemo(() => {
    if (settings.headwordSize === 'sm' && settings.exampleEnSize === 'xs') return 'compact';
    if (settings.headwordSize === 'md' && settings.exampleEnSize === 'md') return 'standard';
    if (settings.headwordSize === 'lg' && settings.exampleEnSize === 'lg') return 'large';
    if (settings.headwordSize === 'xl' && settings.exampleEnSize === 'xl') return 'huge';
    return 'custom';
  }, [settings]);

  const zoomIn = () => {
    if (currentPreset === 'compact') applyPreset('standard');
    else if (currentPreset === 'standard') applyPreset('large');
    else if (currentPreset === 'large') applyPreset('huge');
  };

  const zoomOut = () => {
    if (currentPreset === 'huge') applyPreset('large');
    else if (currentPreset === 'large') applyPreset('standard');
    else if (currentPreset === 'standard' || currentPreset === 'custom') applyPreset('compact');
  };

  return (
    <TypographyContext.Provider
      value={{
        settings,
        updateSettings,
        resetSettings,
        applyPreset,
        zoomIn,
        zoomOut,
        currentPreset,
        headwordClass,
        exampleEnClass,
        exampleZhClass,
        definitionClass
      }}
    >
      {children}
    </TypographyContext.Provider>
  );
};

export const useTypography = () => {
  const context = useContext(TypographyContext);
  if (!context) {
    throw new Error('useTypography must be used within a TypographyProvider');
  }
  return context;
};
