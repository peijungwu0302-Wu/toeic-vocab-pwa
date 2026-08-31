import React, { useState } from 'react';
import { motion, useMotionValue, useTransform, PanInfo } from 'framer-motion';
import { Check, X, Star } from 'lucide-react';

interface SwipeableCardProps {
  children: React.ReactNode;
  onSwipeLeft?: () => void; // Again / Hard
  onSwipeRight?: () => void; // Good / Easy
  onSwipeUp?: () => void; // Star
  onClick?: () => void;
  disabled?: boolean;
}

export const SwipeableCard: React.FC<SwipeableCardProps> = ({
  children,
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onClick,
  disabled = false
}) => {
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const rotate = useTransform(x, [-200, 0, 200], [-18, 0, 18]);
  const rightOpacity = useTransform(x, [30, 100], [0, 1]);
  const leftOpacity = useTransform(x, [-30, -100], [0, 1]);
  const upOpacity = useTransform(y, [-30, -100], [0, 1]);

  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    setIsDragging(false);
    const threshold = 90;
    const velocityThreshold = 400;

    if (info.offset.x > threshold || info.velocity.x > velocityThreshold) {
      if (onSwipeRight) onSwipeRight();
    } else if (info.offset.x < -threshold || info.velocity.x < -velocityThreshold) {
      if (onSwipeLeft) onSwipeLeft();
    } else if (info.offset.y < -threshold || info.velocity.y < -velocityThreshold) {
      if (onSwipeUp) onSwipeUp();
    }
  };

  return (
    <div className="relative w-full h-full perspective-1000 select-none">
      <motion.div
        style={{ x, y, rotate }}
        drag={disabled ? false : true}
        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
        dragElastic={0.7}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={handleDragEnd}
        onClick={() => {
          if (!isDragging && onClick) onClick();
        }}
        className="w-full h-full cursor-grab active:cursor-grabbing relative"
      >
        {/* Visual Swipe Overlays */}
        {!disabled && (
          <>
            {/* Right Swipe: GOOD (Green) */}
            <motion.div
              style={{ opacity: rightOpacity }}
              className="absolute top-6 left-6 z-30 pointer-events-none flex items-center space-x-1.5 px-4 py-2 rounded-2xl bg-emerald-600/90 text-white font-black border-2 border-emerald-400 shadow-2xl backdrop-blur-md transform -rotate-12"
            >
              <Check size={22} className="stroke-[3]" />
              <span className="text-sm tracking-wide">記住了 (GOOD)</span>
            </motion.div>

            {/* Left Swipe: AGAIN (Red) */}
            <motion.div
              style={{ opacity: leftOpacity }}
              className="absolute top-6 right-6 z-30 pointer-events-none flex items-center space-x-1.5 px-4 py-2 rounded-2xl bg-rose-600/90 text-white font-black border-2 border-rose-400 shadow-2xl backdrop-blur-md transform rotate-12"
            >
              <X size={22} className="stroke-[3]" />
              <span className="text-sm tracking-wide">忘記了 (AGAIN)</span>
            </motion.div>

            {/* Up Swipe: STAR (Gold) */}
            <motion.div
              style={{ opacity: upOpacity }}
              className="absolute bottom-10 left-1/2 -translate-x-1/2 z-30 pointer-events-none flex items-center space-x-1.5 px-4 py-2 rounded-2xl bg-amber-500/90 text-white font-black border-2 border-amber-300 shadow-2xl backdrop-blur-md"
            >
              <Star size={20} className="fill-white" />
              <span className="text-sm tracking-wide">加入重點收藏</span>
            </motion.div>
          </>
        )}

        {children}
      </motion.div>
    </div>
  );
};
