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
  const touchZoneRef = useRef<'fast' | 'content'>('content');
  const dragDirectionLockedRef = useRef<'vertical' | 'horizontal' | null>(null);

  const handleDragStart = (event: MouseEvent | TouchEvent | PointerEvent) => {
    setIsDragging(true);
    dragDirectionLockedRef.current = null;

    // Detect if touch originated in the upper fast-swipe zone
    const target = (event as any)?.target as HTMLElement | null;
    const isFastZone = Boolean(target?.closest?.('[data-swipe-zone="fast"]'));
    touchZoneRef.current = isFastZone ? 'fast' : 'content';
  };

  const handleDrag = (_: unknown, info: PanInfo) => {
    const absX = Math.abs(info.offset.x);
    const absY = Math.abs(info.offset.y);

    if (touchZoneRef.current === 'fast') {
      // In fast zone, we prioritize horizontal swipe
      if (!dragDirectionLockedRef.current && absX > 8) {
        dragDirectionLockedRef.current = 'horizontal';
      }
      return;
    }

    // In content (reading) zone, detect initial direction intent
    if (!dragDirectionLockedRef.current) {
      if (absY > 12 && absY > absX * 1.3) {
        // Clear vertical scroll intent -> lock out horizontal dragging to keep 120Hz scrolling pure
        dragDirectionLockedRef.current = 'vertical';
      } else if (absX > 15 && absX > absY * 1.1) {
        dragDirectionLockedRef.current = 'horizontal';
      }
    } else if (dragDirectionLockedRef.current === 'vertical') {
      // Breakout check: if user subsequently sweeps horizontally over a significant distance (> 70px)
      // and horizontal clearly dominates, break out and restore horizontal swipe!
      if (absX > 70 && absX > absY * 1.05) {
        dragDirectionLockedRef.current = 'horizontal';
      }
    }
  };

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    setIsDragging(false);

    const isFastZone = touchZoneRef.current === 'fast';
    const absX = Math.abs(info.offset.x);
    const absY = Math.abs(info.offset.y);

    // If still locked in vertical reading in content zone without horizontal breakout
    if (!isFastZone && dragDirectionLockedRef.current === 'vertical' && absX < 75) {
      dragDirectionLockedRef.current = null;
      x.set(0);
      return;
    }

    let isSwipeTriggered = false;
    let direction: 'left' | 'right' | null = null;

    if (isFastZone) {
      // Upper Fast Zone (Plan B): very responsive
      const fastThresholdX = 45;
      const fastVelocity = 220;
      if (info.offset.x > fastThresholdX || (info.offset.x > 25 && info.velocity.x > fastVelocity)) {
        isSwipeTriggered = true;
        direction = 'right';
      } else if (info.offset.x < -fastThresholdX || (info.offset.x < -25 && info.velocity.x < -fastVelocity)) {
        isSwipeTriggered = true;
        direction = 'left';
      }
    } else {
      // Content Reading Zone (Plan A): dynamic ratio + long sweep override
      // 1. Long Sweep Override: if user dragged across screen (> 75px) with arc motion (absX > absY * 1.05)
      // 2. Flick: brisk horizontal flick (> 320px/s)
      const contentThresholdX = 75;
      const contentVelocity = 320;

      const isHorizontalDominant = absX > absY * 1.05;
      const isQuickFlick = absX > 30 && Math.abs(info.velocity.x) > contentVelocity && Math.abs(info.velocity.x) > Math.abs(info.velocity.y) * 1.2;

      if ((absX > contentThresholdX && isHorizontalDominant) || isQuickFlick) {
        if (info.offset.x > 0) {
          isSwipeTriggered = true;
          direction = 'right';
        } else {
          isSwipeTriggered = true;
          direction = 'left';
        }
      }
    }

    if (isSwipeTriggered && direction) {
      try { navigator.vibrate?.([12]); } catch {}
      if (direction === 'right' && onSwipeRight) {
        onSwipeRight();
      } else if (direction === 'left' && onSwipeLeft) {
        onSwipeLeft();
      }
    } else {
      x.set(0);
    }

    dragDirectionLockedRef.current = null;
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


