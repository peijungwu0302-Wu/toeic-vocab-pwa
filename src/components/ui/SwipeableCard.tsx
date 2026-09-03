import React, { useState } from 'react';
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
  const rotate = useTransform(x, [-200, 0, 200], [-14, 0, 14]);

  // Opacities for 2-direction horizontal swipe overlays
  const rightAgainOpacity = useTransform(x, [30, 100], [0, 1]); // Drag Right -> Again
  const leftGoodOpacity = useTransform(x, [-30, -100], [0, 1]); // Drag Left -> Good

  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    setIsDragging(false);
    const thresholdX = 80;
    const velocityThreshold = 350;

    // Strict directional axis locking:
    // If vertical displacement is substantial (|offset.y| >= |offset.x| * 0.75), user is scrolling vertically!
    // Never trigger horizontal card swipe on vertical reading scrolls!
    const isHorizontalDominant = Math.abs(info.offset.x) > Math.abs(info.offset.y) * 1.35;
    if (!isHorizontalDominant) {
      return;
    }

    // Check horizontal swipes with horizontal dominance guaranteed
    if (info.offset.x > thresholdX || info.velocity.x > velocityThreshold) {
      if (onSwipeRight) onSwipeRight(); // Right = Again
    } else if (info.offset.x < -thresholdX || info.velocity.x < -velocityThreshold) {
      if (onSwipeLeft) onSwipeLeft(); // Left = Good
    }
  };

  return (
    <div className="relative w-full h-full perspective-1000 select-none touch-pan-y">
      <motion.div
        style={{ x, rotate }}
        drag={disabled ? false : 'x'}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.65}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={handleDragEnd}
        onClick={() => {
          if (!isDragging && onClick) onClick();
        }}
        className="w-full h-full cursor-grab active:cursor-grabbing relative"
      >
        {/* Dynamic Visual Swipe Overlays */}
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

