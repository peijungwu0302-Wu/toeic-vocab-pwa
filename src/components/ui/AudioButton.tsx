import React, { useState } from 'react';
import { Volume2, VolumeX, Loader2 } from 'lucide-react';
import { audioService } from '../../services/audioService';
import { useProfile } from '../../contexts/ProfileContext';

interface AudioButtonProps {
  headword: string;
  audioUrl?: string | null;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const AudioButton: React.FC<AudioButtonProps> = ({
  headword,
  audioUrl,
  className = '',
  size = 'md'
}) => {
  const { activeProfile } = useProfile();
  const [isPlaying, setIsPlaying] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPlaying) return;

    setIsPlaying(true);
    try {
      await audioService.playWord({
        headword,
        audioUrl,
        accent: activeProfile?.preferredAccent || 'US',
        isMuted: activeProfile?.isMuted || false
      });
    } catch (err) {
      console.warn('[AudioButton] Playback error:', err);
    } finally {
      setIsPlaying(false);
    }
  };

  const isMuted = activeProfile?.isMuted;

  const sizeClasses = {
    sm: 'p-1.5 w-8 h-8',
    md: 'p-2 w-11 h-11',
    lg: 'p-3 w-14 h-14'
  };

  const iconSizes = {
    sm: 16,
    md: 20,
    lg: 26
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`發音：${headword}`}
      className={`inline-flex items-center justify-center rounded-full bg-slate-800/80 hover:bg-slate-700 active:scale-95 text-emerald-400 border border-slate-700/60 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/50 min-w-[44px] min-h-[44px] ${sizeClasses[size]} ${className}`}
      disabled={isPlaying}
    >
      {isPlaying ? (
        <Loader2 className="animate-spin text-emerald-400" size={iconSizes[size]} />
      ) : isMuted ? (
        <VolumeX className="text-slate-400" size={iconSizes[size]} />
      ) : (
        <Volume2 size={iconSizes[size]} />
      )}
    </button>
  );
};
