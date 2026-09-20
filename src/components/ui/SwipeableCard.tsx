import React, { useRef } from 'react';
import { motion, useMotionValue, useTransform, PanInfo } from 'framer-motion';
import { Check, X, RotateCw, RotateCcw, ArrowRight } from 'lucide-react';

interface SwipeableCardProps {
  children: React.ReactNode;
  onSwipeLeft?: () => void; // Rate 3, Flip to back, or History Forward
  onSwipeRight?: () => void; // Rate 1 or History Backward
  onClick?: () => void;
  disabled?: boolean;
  handPreference?: 'left' | 'right';
  overlayMode?: 'review' | 'front' | 'rewind' | 'none';
  canSwipeLeft?: boolean;
  canSwipeRight?: boolean;
}

export const SwipeableCard: React.FC<SwipeableCardProps> = ({
  children,
  onSwipeLeft,
  onSwipeRight,
  onClick,
  disabled = false,
  handPreference = 'left',
  overlayMode = 'review',
  canSwipeLeft = true,
  canSwipeRight = true,
}) => {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-7, 0, 7]);

  // Opacities for 2-direction horizontal swipe overlays (smooth fade-in from 30px to 80px)
  const rightAgainOpacity = useTransform(x, [30, 80], [0, 1]); // Drag Right
  const leftGoodOpacity = useTransform(x, [-30, -80], [0, 1]); // Drag Left

  const touchZoneRef = useRef<'fast' | 'content'>('content');
  const dragDirectionLockedRef = useRef<'vertical' | 'horizontal' | null>(null);

  const hasSwipedRef = useRef(false);
  const dragDistanceRef = useRef(0);
  const lastActionTimeRef = useRef(0);

  const isActionLocked = () => {
    const now = Date.now();
    if (now - lastActionTimeRef.current < 260) return true;
    lastActionTimeRef.current = now;
    return false;
  };

  const handleDragStart = (event: MouseEvent | TouchEvent | PointerEvent) => {
    hasSwipedRef.current = false;
    dragDistanceRef.current = 0;
    dragDirectionLockedRef.current = null;

    // Detect if touch originated in the upper fast-swipe zone
    const target = (event as any)?.target as HTMLElement | null;
    const isFastZone = Boolean(target?.closest?.('[data-swipe-zone="fast"]'));
    touchZoneRef.current = isFastZone ? 'fast' : 'content';
  };

  const handleDrag = (_: unknown, info: PanInfo) => {
    const absX = Math.abs(info.offset.x);
    const absY = Math.abs(info.offset.y);
    dragDistanceRef.current = Math.hypot(absX, absY);

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
      const contentThresholdX = 70;
      const contentVelocity = 290;

      let ratioMultiplier = 1.05;
      if (handPreference === 'left') {
        if (info.offset.x < 0 && info.offset.y >= -15) {
          ratioMultiplier = 0.85;
        } else if (info.offset.x > 0 && info.offset.y <= 20) {
          ratioMultiplier = 0.9;
        }
      } else {
        if (info.offset.x > 0 && info.offset.y >= -15) {
          ratioMultiplier = 0.85;
        } else if (info.offset.x < 0 && info.offset.y <= 20) {
          ratioMultiplier = 0.9;
        }
      }

      const isHorizontalDominant = absX > absY * ratioMultiplier;
      const isQuickFlick = absX > 28 && Math.abs(info.velocity.x) > contentVelocity && Math.abs(info.velocity.x) > Math.abs(info.velocity.y) * 1.15;

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
      if (isActionLocked()) {
        x.set(0);
        return;
      }
      hasSwipedRef.current = true;
      try { navigator.vibrate?.([12]); } catch { /* ignore */ }
      if (direction === 'right' && canSwipeRight && onSwipeRight) {
        onSwipeRight();
      } else if (direction === 'left' && canSwipeLeft && onSwipeLeft) {
        onSwipeLeft();
      } else {
        x.set(0);
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
          if (!disabled && !hasSwipedRef.current && dragDistanceRef.current <= 12 && onClick) {
            if (isActionLocked()) return;
            onClick();
          }
        }}
        className={`w-full h-full relative ${disabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
      >
        {/* Dynamic Visual Swipe Overlays (Only visible during active horizontal swipe in enabled mode) */}
        {!disabled && overlayMode !== 'none' && (
          <>
            {/* Mode: review (Back of card: Again / Good) */}
            {overlayMode === 'review' && (
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

            {/* Mode: front (Front of active card: Swipe Left -> Flip to Back, Swipe Right -> Rewind to Previous Word) */}
            {overlayMode === 'front' && (
              <>
                {/* Right Swipe: ↺ 回看上一詞 */}
                {canSwipeRight && (
                  <motion.div
                    style={{ opacity: rightAgainOpacity }}
                    className="absolute top-6 left-6 z-30 pointer-events-none flex items-center space-x-2 px-4 py-2 rounded-2xl bg-amber-600/95 text-white font-black border-2 border-amber-300 shadow-2xl shadow-amber-950/60 backdrop-blur-md transform -rotate-12"
                  >
                    <RotateCcw size={22} className="stroke-[3]" />
                    <span className="text-sm tracking-wider">↺ 回看上一詞</span>
                  </motion.div>
                )}

                {/* Left Swipe: 📖 翻到背面 */}
                {canSwipeLeft && (
                  <motion.div
                    style={{ opacity: leftGoodOpacity }}
                    className="absolute top-6 right-6 z-30 pointer-events-none flex items-center space-x-2 px-4 py-2 rounded-2xl bg-indigo-600/95 text-white font-black border-2 border-indigo-300 shadow-2xl shadow-indigo-950/60 backdrop-blur-md transform rotate-12"
                  >
                    <RotateCw size={22} className="stroke-[3]" />
                    <span className="text-sm tracking-wider">📖 翻到背面</span>
                  </motion.div>
                )}
              </>
            )}

            {/* Mode: rewind (Viewing history: Swipe Left -> Forward towards current, Swipe Right -> earlier history) */}
            {overlayMode === 'rewind' && (
              <>
                {/* Right Swipe: ↺ 回看更早 (if canSwipeRight) */}
                {canSwipeRight && (
                  <motion.div
                    style={{ opacity: rightAgainOpacity }}
                    className="absolute top-6 left-6 z-30 pointer-events-none flex items-center space-x-2 px-4 py-2 rounded-2xl bg-amber-600/95 text-white font-black border-2 border-amber-300 shadow-2xl shadow-amber-950/60 backdrop-blur-md transform -rotate-12"
                  >
                    <RotateCcw size={22} className="stroke-[3]" />
                    <span className="text-sm tracking-wider">↺ 回看更早</span>
                  </motion.div>
                )}

                {/* Left Swipe: ➔ 返回題目 */}
                {canSwipeLeft && (
                  <motion.div
                    style={{ opacity: leftGoodOpacity }}
                    className="absolute top-6 right-6 z-30 pointer-events-none flex items-center space-x-2 px-4 py-2 rounded-2xl bg-emerald-600/95 text-white font-black border-2 border-emerald-300 shadow-2xl shadow-emerald-950/60 backdrop-blur-md transform rotate-12"
                  >
                    <ArrowRight size={22} className="stroke-[3]" />
                    <span className="text-sm tracking-wider">➔ 返回題目</span>
                  </motion.div>
                )}
              </>
            )}
          </>
        )}

        {children}
      </motion.div>
    </div>
  );
};


