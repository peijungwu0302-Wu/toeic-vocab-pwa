import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'emerald' | 'blue' | 'amber' | 'purple' | 'slate' | 'rose';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'slate',
  className
}) => {
  const variants = {
    emerald: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60',
    blue: 'bg-blue-950/80 text-blue-300 border-blue-800/60',
    amber: 'bg-amber-950/80 text-amber-300 border-amber-800/60',
    purple: 'bg-purple-950/80 text-purple-300 border-purple-800/60',
    slate: 'bg-slate-800 text-slate-300 border-slate-700',
    rose: 'bg-rose-950/80 text-rose-300 border-rose-800/60'
  };

  return (
    <span
      className={twMerge(
        clsx(
          'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border',
          variants[variant],
          className
        )
      )}
    >
      {children}
    </span>
  );
};
