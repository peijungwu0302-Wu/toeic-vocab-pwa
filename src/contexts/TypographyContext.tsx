import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';

export type HeadwordSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
export type ExampleEnSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
export type ExampleZhSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
export type DefinitionSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';

export type TypographyPreset = 'compact' | 'standard' | 'large' | 'huge' | 'giant' | 'ultra';

export interface TypographySettings {
  headwordSize: HeadwordSize;
  exampleEnSize: ExampleEnSize;
  exampleZhSize: ExampleZhSize;
  definitionSize: DefinitionSize;
  fontScalePercent: number; // 75 ~ 175%
  fastSkimDurationSec: number;
  fastSkimShowImage: boolean;
}

const DEFAULT_SETTINGS: TypographySettings = {
  headwordSize: 'md',
  exampleEnSize: 'md',
  exampleZhSize: 'sm',
  definitionSize: 'md',
  fontScalePercent: 100,
  fastSkimDurationSec: 1.5,
  fastSkimShowImage: true
};

interface TypographyContextType {
  settings: TypographySettings;
  updateSettings: (newSettings: Partial<TypographySettings>) => void;
  resetSettings: () => void;
  applyPreset: (preset: TypographyPreset) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  currentPreset: TypographyPreset | 'custom';
  // CSS Class mappings
  headwordClass: string;
  exampleEnClass: string;
  exampleZhClass: string;
  definitionClass: string;
}

const TypographyContext = createContext<TypographyContextType | undefined>(undefined);

const STORAGE_KEY = 'toeic_typography_settings_v2';

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

  const applyPreset = (preset: TypographyPreset) => {
    switch (preset) {
      case 'compact':
        setSettings(prev => ({
          ...prev,
          headwordSize: 'sm',
          exampleEnSize: 'xs',
          exampleZhSize: 'xs',
          definitionSize: 'sm',
          fontScalePercent: 85
        }));
        break;
      case 'standard':
        setSettings(prev => ({
          ...prev,
          headwordSize: 'md',
          exampleEnSize: 'md',
          exampleZhSize: 'sm',
          definitionSize: 'md',
          fontScalePercent: 100
        }));
        break;
      case 'large':
        setSettings(prev => ({
          ...prev,
          headwordSize: 'lg',
          exampleEnSize: 'lg',
          exampleZhSize: 'md',
          definitionSize: 'lg',
          fontScalePercent: 115
        }));
        break;
      case 'huge':
        setSettings(prev => ({
          ...prev,
          headwordSize: 'xl',
          exampleEnSize: 'xl',
          exampleZhSize: 'lg',
          definitionSize: 'xl',
          fontScalePercent: 130
        }));
        break;
      case 'giant': // 大一級
        setSettings(prev => ({
          ...prev,
          headwordSize: '2xl',
          exampleEnSize: '2xl',
          exampleZhSize: 'xl',
          definitionSize: '2xl',
          fontScalePercent: 150
        }));
        break;
      case 'ultra': // 大二級 (護眼至尊)
        setSettings(prev => ({
          ...prev,
          headwordSize: '3xl',
          exampleEnSize: '3xl',
          exampleZhSize: '2xl',
          definitionSize: '3xl',
          fontScalePercent: 175
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
      case '2xl': return 'text-5xl md:text-6xl font-black tracking-tight';
      case '3xl': return 'text-6xl md:text-7xl font-black tracking-tight leading-none';
    }
  }, [settings.headwordSize]);

  const exampleEnClass = useMemo(() => {
    switch (settings.exampleEnSize) {
      case 'xs': return 'text-[11px] md:text-xs leading-relaxed';
      case 'sm': return 'text-xs md:text-[13px] leading-relaxed';
      case 'md': return 'text-[13px] md:text-sm leading-relaxed font-medium';
      case 'lg': return 'text-sm md:text-base leading-relaxed font-semibold';
      case 'xl': return 'text-base md:text-lg leading-relaxed font-bold';
      case '2xl': return 'text-lg md:text-xl leading-relaxed font-bold';
      case '3xl': return 'text-xl md:text-2xl leading-relaxed font-black';
    }
  }, [settings.exampleEnSize]);

  const exampleZhClass = useMemo(() => {
    switch (settings.exampleZhSize) {
      case 'xs': return 'text-[10px] md:text-[11px] leading-normal';
      case 'sm': return 'text-[11px] md:text-xs leading-normal font-medium';
      case 'md': return 'text-xs md:text-sm leading-normal font-semibold';
      case 'lg': return 'text-sm md:text-base leading-normal font-bold';
      case 'xl': return 'text-base md:text-lg leading-normal font-bold';
      case '2xl': return 'text-lg md:text-xl leading-normal font-black';
    }
  }, [settings.exampleZhSize]);

  const definitionClass = useMemo(() => {
    switch (settings.definitionSize) {
      case 'sm': return 'text-sm md:text-base font-bold';
      case 'md': return 'text-base md:text-lg font-bold';
      case 'lg': return 'text-lg md:text-xl font-extrabold';
      case 'xl': return 'text-xl md:text-2xl font-black';
      case '2xl': return 'text-2xl md:text-3xl font-black';
      case '3xl': return 'text-3xl md:text-4xl font-black';
    }
  }, [settings.definitionSize]);

  const currentPreset: TypographyPreset | 'custom' = useMemo(() => {
    if (settings.headwordSize === 'sm' && settings.exampleEnSize === 'xs') return 'compact';
    if (settings.headwordSize === 'md' && settings.exampleEnSize === 'md') return 'standard';
    if (settings.headwordSize === 'lg' && settings.exampleEnSize === 'lg') return 'large';
    if (settings.headwordSize === 'xl' && settings.exampleEnSize === 'xl') return 'huge';
    if (settings.headwordSize === '2xl' && settings.exampleEnSize === '2xl') return 'giant';
    if (settings.headwordSize === '3xl' && settings.exampleEnSize === '3xl') return 'ultra';
    return 'custom';
  }, [settings]);

  const PRESET_ORDER: TypographyPreset[] = ['compact', 'standard', 'large', 'huge', 'giant', 'ultra'];

  const zoomIn = () => {
    const idx = PRESET_ORDER.indexOf(currentPreset as TypographyPreset);
    if (idx !== -1 && idx < PRESET_ORDER.length - 1) {
      applyPreset(PRESET_ORDER[idx + 1]);
    } else if (currentPreset === 'custom') {
      applyPreset('large');
    }
  };

  const zoomOut = () => {
    const idx = PRESET_ORDER.indexOf(currentPreset as TypographyPreset);
    if (idx > 0) {
      applyPreset(PRESET_ORDER[idx - 1]);
    } else if (currentPreset === 'custom') {
      applyPreset('standard');
    }
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
