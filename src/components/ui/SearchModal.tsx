import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  X,
  Volume2,
  Star,
  Plus,
  BookOpen,
  Check,
  Layers,
  GitBranch
} from 'lucide-react';
import { courseRepository } from '../../repositories/courseRepository';
import { progressRepository } from '../../repositories/progressRepository';
import { fsrsService } from '../../services/fsrsService';
import { audioService } from '../../services/audioService';
import { morphologyService, MorphologyInfo } from '../../services/morphologyService';
import { imageService } from '../../services/imageService';
import { Word, Progress } from '../../types/db';
import { db } from '../../db';
import { useProfile } from '../../contexts/ProfileContext';
import { Badge } from './Badge';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({ isOpen, onClose }) => {
  const { activeProfile } = useProfile();
  const [searchResults, setSearchResults] = useState<Word[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedWord, setSelectedWord] = useState<Word | null>(null);
  const [isStarred, setIsStarred] = useState(false);
  const [addedMessage, setAddedMessage] = useState(false);
  const [morphology, setMorphology] = useState<MorphologyInfo | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      let isMounted = true;
      setIsLoading(true);
      courseRepository.searchGlobalMasterWords(query).then(words => {
        if (isMounted) {
          setSearchResults(words);
          setIsLoading(false);
        }
      });
      setTimeout(() => inputRef.current?.focus(), 100);
      return () => { isMounted = false; };
    } else {
      setQuery('');
      setSelectedWord(null);
    }
  }, [isOpen, query]);

  useEffect(() => {
    if (selectedWord && activeProfile) {
      progressRepository.getByWordId(activeProfile.id, selectedWord.id).then((p: Progress | undefined) => {
        setIsStarred(Boolean(p?.isStarred));
      });
      const morph = morphologyService.getMorphology(selectedWord.headword, selectedWord.category);
      setMorphology(morph);
    }
  }, [selectedWord, activeProfile]);

  const handleToggleStar = async () => {
    if (!selectedWord || !activeProfile) return;
    await db.words.put(selectedWord);
    const newStarred = await progressRepository.toggleStarred(activeProfile.id, selectedWord.id);
    setIsStarred(newStarred);
  };

  const handleAddToTodayReview = async () => {
    if (!selectedWord || !activeProfile) return;
    await db.words.put(selectedWord);
    const existing = await progressRepository.getByWordId(activeProfile.id, selectedWord.id);
    if (!existing) {
      const init = fsrsService.createInitialProgress(activeProfile.id, selectedWord.id);
      await db.progress.put(init);
    }
    setAddedMessage(true);
    setTimeout(() => setAddedMessage(false), 2000);
  };

  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [pullOffset, setPullOffset] = useState<number>(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartY(e.touches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY !== null) {
      const delta = e.touches[0].clientY - touchStartY;
      if (delta > 0) {
        setPullOffset(delta);
      }
    }
  };

  const handleTouchEnd = () => {
    if (pullOffset > 85) {
      onClose();
    }
    setTouchStartY(null);
    setPullOffset(0);
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: pullOffset > 0 ? `translateY(${pullOffset}px)` : undefined,
          transition: touchStartY === null ? 'transform 0.2s ease-out' : 'none'
        }}
        className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col h-[82dvh] sm:h-[80dvh] max-h-[90dvh] overflow-hidden select-none"
      >
        {/* iOS Pull Indicator / Grabber Handle Bar (藥丸導引條) */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="pt-2.5 pb-1 flex items-center justify-center sm:hidden cursor-grab active:cursor-grabbing shrink-0"
        >
          <div className="w-10 h-1.5 rounded-full bg-slate-600 hover:bg-slate-500 transition-colors" />
        </div>

        {/* Search Header */}
        <div className="px-4 pb-3 sm:pt-3 border-b border-slate-800 flex items-center space-x-2 shrink-0">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋 11,154 個單字、中文釋義或主題..."
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-emerald-500 font-medium"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-200 rounded-xl bg-slate-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Word Details Modal View or Word List */}
        {selectedWord ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setSelectedWord(null)}
                className="text-xs text-emerald-400 font-bold hover:underline"
              >
                ← 返回搜尋結果
              </button>
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={handleToggleStar}
                  className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-amber-400"
                >
                  <Star size={15} className={isStarred ? 'fill-amber-400 text-amber-400' : ''} />
                </button>
                <button
                  onClick={handleAddToTodayReview}
                  className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 font-bold"
                >
                  {addedMessage ? <Check size={13} /> : <Plus size={13} />}
                  <span>{addedMessage ? '已加入複習' : '加入複習'}</span>
                </button>
              </div>
            </div>

            {/* 🌟 Word Context Image Banner in Search Modal */}
            {(() => {
              const imgInfo = imageService.getImageForWord(selectedWord.headword, selectedWord.category);
              return (
                <div className="relative rounded-2xl overflow-hidden border border-slate-700 shadow-md h-32 bg-slate-800">
                  <img
                    src={imgInfo.url}
                    alt={selectedWord.headword}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-900/20 to-transparent" />
                  <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between">
                    <span className="text-[10px] text-emerald-300 font-bold px-2 py-0.5 rounded-full bg-slate-950/80 border border-emerald-700/50">
                      📸 具象情境：{imgInfo.tag}
                    </span>
                    <span className="text-[9px] text-slate-400">
                      {selectedWord.category}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Word Header */}
            <div className="p-4 rounded-2xl bg-gradient-to-b from-slate-800 to-slate-850 border border-slate-700 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5">
                  <Badge variant="emerald">{selectedWord.partsOfSpeech.join(', ')}</Badge>
                  <Badge variant="blue">{selectedWord.toeicScoreRange}</Badge>
                  <span className="text-[11px] text-slate-400">{selectedWord.category}</span>
                </div>
                <button
                  onClick={() => audioService.speakSentence(selectedWord.headword)}
                  className="p-2 rounded-xl bg-slate-900 text-emerald-400 hover:scale-105"
                >
                  <Volume2 size={18} />
                </button>
              </div>

              <div>
                <h3 className="text-2xl font-black text-slate-100">{selectedWord.headword}</h3>
                {selectedWord.phoneticUS && (
                  <p className="text-xs font-mono text-emerald-400">/{selectedWord.phoneticUS}/</p>
                )}
              </div>

              <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 text-sm font-bold text-emerald-300">
                {selectedWord.definitionZh}
              </div>
            </div>

            {/* Morphology */}
            {morphology && (
              <div className="p-3 rounded-2xl bg-slate-800/80 border border-amber-800/40 space-y-2">
                <div className="text-amber-400 font-bold flex items-center">
                  <Layers size={13} className="mr-1.5" /> 詞根詞綴與構詞記憶
                </div>
                <div className="flex flex-wrap gap-1">
                  {morphology.roots.map((r, idx) => (
                    <span key={idx} className="px-2 py-0.5 rounded bg-amber-950/40 border border-amber-700/50 text-[10px] text-amber-200">
                      <strong className="text-amber-300">{r.part}</strong>：{r.meaning}
                    </span>
                  ))}
                </div>
                <p className="text-slate-300 text-[11px]">{morphology.mnemonic}</p>

                {morphology.wordFamily && morphology.wordFamily.length > 1 && (
                  <div className="pt-2 border-t border-slate-700/60 space-y-1">
                    <div className="text-[10px] font-bold text-slate-400 flex items-center">
                      <GitBranch size={11} className="mr-1 text-emerald-400" /> 派生詞家族：
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[10px]">
                      {morphology.wordFamily.map((wf, wfIdx) => (
                        <div key={wfIdx} className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-200 truncate">
                          <strong className="text-emerald-400">{wf.word}</strong> <span className="text-slate-400">({wf.pos})</span> {wf.meaning}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 3 Business Examples */}
            {selectedWord.examples && selectedWord.examples.length > 0 && (
              <div className="p-3 rounded-2xl bg-slate-800/80 border border-slate-700 space-y-2">
                <div className="text-[11px] font-bold text-slate-200 flex items-center">
                  <BookOpen size={13} className="mr-1.5 text-emerald-400" /> 3 組商務例句
                </div>
                <div className="space-y-2">
                  {selectedWord.examples.slice(0, 3).map((ex, idx) => (
                    <div
                      key={idx}
                      onClick={() => audioService.speakSentence(ex.en || ex.english || '')}
                      className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 cursor-pointer hover:border-emerald-700/60 transition-colors group"
                    >
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="text-[9px] text-emerald-300 font-bold px-1.5 py-0.5 bg-emerald-950/60 rounded">
                          情境：{ex.scenario || '商務溝通'}
                        </span>
                        <Volume2 size={12} className="text-slate-400 group-hover:text-emerald-400" />
                      </div>
                      <p className="text-slate-200 text-xs font-medium">{ex.en || ex.english}</p>
                      <p className="text-slate-400 text-[10px] mt-0.5">{ex.zh || ex.chinese}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Search Results List with Thumbnail Images */
          <div className="flex-1 overflow-y-auto p-2 divide-y divide-slate-800">
            {isLoading ? (
              <div className="text-center py-12 text-slate-400 text-xs flex items-center justify-center space-x-2">
                <span className="inline-block w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                <span>正在全庫 11,154 詞庫中檢索...</span>
              </div>
            ) : searchResults.length > 0 ? (
              searchResults.map((w) => {
                const img = imageService.getImageForWord(w.headword, w.category);
                return (
                  <div
                    key={w.id}
                    onClick={() => setSelectedWord(w)}
                    className="p-2.5 hover:bg-slate-800/60 cursor-pointer flex items-center justify-between rounded-xl transition-colors group"
                  >
                    {/* Thumbnail */}
                    <div className="w-11 h-11 rounded-lg overflow-hidden border border-slate-700/80 mr-3 shrink-0 bg-slate-800 relative">
                      <img
                        src={img.url}
                        alt={w.headword}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        loading="lazy"
                      />
                    </div>

                    <div className="min-w-0 flex-1 mr-2">
                      <div className="flex items-center space-x-1.5">
                        <span className="text-xs font-black text-slate-100 group-hover:text-emerald-400 transition-colors">
                          {w.headword}
                        </span>
                        {w.phoneticUS && (
                          <span className="text-[10px] font-mono text-emerald-400/80">/{w.phoneticUS}/</span>
                        )}
                        <span className="text-[9px] px-1 rounded bg-slate-800 text-slate-400">{w.partsOfSpeech?.[0]}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">{w.definitionZh}</p>
                    </div>

                    <div className="flex items-center space-x-1.5 shrink-0">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-950/60 text-blue-300 border border-blue-800/40">
                        {w.toeicScoreRange}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          audioService.speakSentence(w.headword);
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-800"
                        title="朗讀發音"
                      >
                        <Volume2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-12 text-slate-500 text-xs">
                查無符合「{query}」的單字
              </div>
            )}
          </div>
        )}

        {/* Footer info */}
        <div className="p-3 border-t border-slate-800 bg-slate-900/90 text-center text-[10px] text-slate-500 shrink-0">
          全庫共 11,154 個多益單字 · 離線本機秒級檢索
        </div>
      </div>
    </div>
  );
};
