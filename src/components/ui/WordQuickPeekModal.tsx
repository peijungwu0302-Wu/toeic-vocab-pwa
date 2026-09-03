import React, { useState, useEffect } from 'react';
import { Volume2, Star, Sparkles, X, BookOpen } from 'lucide-react';
import { motion, PanInfo } from 'framer-motion';
import { Word, Progress } from '../../types/db';
import { audioService } from '../../services/audioService';
import { progressRepository } from '../../repositories/progressRepository';
import { useProfile } from '../../contexts/ProfileContext';
import { Badge } from './Badge';

interface WordQuickPeekModalProps {
  word: Word | null;
  isOpen: boolean;
  onClose: () => void;
}

export const WordQuickPeekModal: React.FC<WordQuickPeekModalProps> = ({
  word,
  isOpen,
  onClose
}) => {
  const { activeProfile } = useProfile();
  const [isStarred, setIsStarred] = useState(false);

  useEffect(() => {
    if (word && activeProfile) {
      progressRepository.getByWordId(activeProfile.id, word.id).then((p: Progress | undefined) => {
        setIsStarred(Boolean(p?.isStarred));
      });
    }
  }, [word, activeProfile]);

  if (!isOpen || !word) return null;

  const handleToggleStar = async () => {
    if (!word || !activeProfile) return;
    const newStar = await progressRepository.toggleStarred(activeProfile.id, word.id);
    setIsStarred(newStar);
  };

  const handlePlayAudio = () => {
    audioService.playWord({
      headword: word.headword,
      audioUrl: word.audioUSUrl || word.audioUKUrl
    });
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in select-none cursor-pointer"
    >
      <motion.div
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDragEnd={(_: unknown, info: PanInfo) => {
          if (info.offset.y > 60 || info.velocity.y > 300) {
            onClose();
          }
        }}
        className="w-full max-w-lg max-h-[82dvh] bg-slate-900 border border-slate-700/80 rounded-t-[32px] sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top iOS Grabber Bar with pull-down gesture affordance */}
        <div className="w-full flex flex-col items-center pt-2.5 pb-1 cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1.5 rounded-full bg-slate-500/80" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-2 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <BookOpen size={16} className="text-emerald-400" />
            <span className="text-xs font-bold text-slate-300">多益關聯詞速查 (Word Peek)</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="關閉"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-slate-100">
          {/* Headword & Pronunciation (Click anywhere on word to play audio) */}
          <div className="flex items-start justify-between">
            <div
              onClick={handlePlayAudio}
              className="cursor-pointer group active:scale-98 transition-transform select-none flex-1"
              title="點擊單字直接發音"
            >
              <div className="flex items-baseline space-x-2.5 flex-wrap">
                <h2 className="text-2xl font-black text-white tracking-tight group-hover:text-emerald-300 transition-colors flex items-center">
                  {word.headword}
                  <Volume2 size={16} className="ml-2 text-emerald-400/70 group-hover:text-emerald-400 group-hover:scale-110 transition-all" />
                </h2>
                {word.partsOfSpeech && word.partsOfSpeech.length > 0 && (
                  <Badge variant="emerald">{word.partsOfSpeech.join(', ')}</Badge>
                )}
                {word.category && (
                  <span className="text-xs text-slate-400 font-medium">{word.category}</span>
                )}
              </div>
              {word.phoneticUS && (
                <p className="font-mono text-sm text-emerald-400 mt-0.5">/{word.phoneticUS}/</p>
              )}
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <button
                type="button"
                onClick={handlePlayAudio}
                className="p-2.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 transition-colors"
                title="發音"
              >
                <Volume2 size={18} />
              </button>
              <button
                type="button"
                onClick={handleToggleStar}
                className={`p-2.5 rounded-xl border transition-colors ${
                  isStarred
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-amber-300'
                }`}
                title={isStarred ? '已收藏' : '加入收藏'}
              >
                <Star size={18} className={isStarred ? 'fill-amber-400' : ''} />
              </button>
            </div>
          </div>

          {/* Chinese Definition */}
          <div className="p-3.5 rounded-2xl bg-slate-800/80 border border-slate-700/80">
            <div className="text-[10px] text-slate-400 font-bold mb-1">中文核心釋義</div>
            <div className="text-base font-bold text-emerald-300 leading-relaxed">
              {word.definitionZh}
            </div>
          </div>

          {/* Business Examples */}
          {Array.isArray(word.examples) && word.examples.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] text-slate-400 font-bold flex items-center space-x-1">
                <Sparkles size={12} className="text-amber-400" />
                <span>商務真實情境例句</span>
              </div>
              <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-1.5">
                <p className="text-xs text-slate-200 font-medium leading-relaxed">
                  {word.examples[0].en || word.examples[0].english}
                </p>
                <p className="text-xs text-emerald-400/90 leading-relaxed">
                  {word.examples[0].zh || word.examples[0].chinese}
                </p>
              </div>
            </div>
          )}

          {/* Core Exam Pitfalls / Collocations if present */}
          {word.examTips && word.examTips.length > 0 && (
            <div className="p-3 rounded-2xl bg-slate-800/60 border border-slate-700/70 text-xs">
              <div className="text-[10px] text-amber-400 font-bold mb-1">🎯 多益核心考點 / 搭配語塊</div>
              <p className="text-slate-300 leading-relaxed">{word.examTips.join('；')}</p>
            </div>
          )}
          {word.examFocus?.trapWarning && (
            <div className="p-3 rounded-2xl bg-amber-950/40 border border-amber-800/50 text-xs">
              <div className="text-[10px] text-amber-400 font-bold mb-1">⚠️ 考場避坑提示</div>
              <p className="text-amber-200/90 leading-relaxed">{word.examFocus.trapWarning}</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-3.5 border-t border-slate-800 bg-slate-900/95 flex space-x-2">
          <button
            type="button"
            onClick={handleToggleStar}
            className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 border ${
              isStarred
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
            }`}
          >
            <Star size={14} className={isStarred ? 'fill-amber-400' : ''} />
            <span>{isStarred ? '已收藏此關聯詞' : '⭐ 收藏至個人生詞庫'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="py-2.5 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition-colors"
          >
            關閉
          </button>
        </div>
      </motion.div>
    </div>
  );
};
