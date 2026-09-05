import React, { useState, useRef } from 'react';
import { motion, useMotionValue, useTransform, PanInfo } from 'framer-motion';
import { Check, X } from 'lucide-react';

interface SwipeableCardProps {
  children: React.ReactNode;
  onSwipeLeft?: () => void; // 3: Good / Pass (掌握)
  onSwipeRight?: () => void; // 1: Again (忘記)
  onClick?: () => void;
  disabled?: boolean;
}

export const SwipeableCard: React.FC<SwipeableCardProps> = ({
  children,
  onSwipeLeft,
  onSwipeRight,
  onClick,
  disabled = false
}) => {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-7, 0, 7]);

  // Opacities for 2-direction horizontal swipe overlays (clear threshold)
  const rightAgainOpacity = useTransform(x, [45, 110], [0, 1]); // Drag Right -> Again
  const leftGoodOpacity = useTransform(x, [-45, -110], [0, 1]); // Drag Left -> Good

  const [isDragging, setIsDragging] = useState(false);
  const dragLockedRef = useRef<'vertical' | 'horizontal' | null>(null);

  const handleDragStart = () => {
    setIsDragging(true);
    dragLockedRef.current = null;
  };

  const handleDrag = (_: unknown, info: PanInfo) => {
    // Determine intention in the first micro-movements
    if (!dragLockedRef.current) {
      const absX = Math.abs(info.offset.x);
      const absY = Math.abs(info.offset.y);
      if (absY > 10 && absY > absX * 1.2) {
        dragLockedRef.current = 'vertical';
      } else if (absX > 10 && absX > absY * 1.3) {
        dragLockedRef.current = 'horizontal';
      }
    }
  };

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    setIsDragging(false);

    // If locked into vertical scrolling, NEVER trigger horizontal swipe
    if (dragLockedRef.current === 'vertical') {
      dragLockedRef.current = null;
      x.set(0);
      return;
    }

    const thresholdX = 85;
    const velocityThreshold = 380;
    const absX = Math.abs(info.offset.x);
    const absY = Math.abs(info.offset.y);

    // Strict Anti-misoperation:
    // 1. Vertical displacement must not be notable
    // 2. Horizontal displacement must be clearly dominant
    if (absY > 28 || absX < absY * 1.4) {
      dragLockedRef.current = null;
      x.set(0);
      return;
    }

    // Check horizontal swipes with responsive natural feel
    if (info.offset.x > thresholdX || (info.offset.x > 35 && info.velocity.x > velocityThreshold)) {
      try { navigator.vibrate?.([12]); } catch {}
      if (onSwipeRight) onSwipeRight(); // Right = Again
    } else if (info.offset.x < -thresholdX || (info.offset.x < -35 && info.velocity.x < -velocityThreshold)) {
      try { navigator.vibrate?.([12]); } catch {}
      if (onSwipeLeft) onSwipeLeft(); // Left = Good
    } else {
      x.set(0);
    }
    dragLockedRef.current = null;
  };

  return (
    <div className="relative w-full h-full perspective-1000 select-none touch-pan-y">
      <motion.div
        style={disabled ? {} : { x, rotate }}
        drag={disabled ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.45}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        onClick={() => {
          if (!isDragging && onClick) onClick();
        }}
        className={`w-full h-full relative ${disabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
      >
        {/* Dynamic Visual Swipe Overlays (Only visible during active horizontal swipe in enabled mode) */}
        {!disabled && (
          <>
            {/* Right Swipe: 💥 忘記 (AGAIN - Red) */}
            <motion.div
              style={{ opacity: rightAgainOpacity }}
              className="absolute top-6 left-6 z-30 pointer-events-none flex items-center space-x-2 px-4 py-2 rounded-2xl bg-rose-600/95 text-white font-black border-2 border-rose-300 shadow-2xl shadow-rose-950/60 backdrop-blur-md transform -rotate-12"
            >
              <X size={22} className="stroke-[3]" />
              <span className="text-sm tracking-wider">💥 忘記 (AGAIN)</span>
            </motion.div>

            {/* Left Swipe: 💡 掌握 (GOOD - Emerald Green) */}
            <motion.div
              style={{ opacity: leftGoodOpacity }}
              className="absolute top-6 right-6 z-30 pointer-events-none flex items-center space-x-2 px-4 py-2 rounded-2xl bg-emerald-600/95 text-white font-black border-2 border-emerald-300 shadow-2xl shadow-emerald-950/60 backdrop-blur-md transform rotate-12"
            >
              <Check size={22} className="stroke-[3]" />
              <span className="text-sm tracking-wider">💡 掌握 (GOOD)</span>
            </motion.div>
          </>
        )}

        {children}
      </motion.div>
    </div>
  );
};


