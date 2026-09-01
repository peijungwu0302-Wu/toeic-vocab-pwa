import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft, Sparkles } from 'lucide-react';
import { courseRepository } from '../repositories/courseRepository';
import { Word } from '../types/db';
import { Button } from '../components/ui/Button';

export const PrintableCramPage: React.FC = () => {
  const navigate = useNavigate();
  const [words, setWords] = useState<Word[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    courseRepository.getAllDownloadedWords({ shuffle: false }).then((downloaded) => {
      setWords(downloaded.slice(0, 100));
      setIsLoading(false);
    });
  }, []);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-4 pb-8 max-w-2xl mx-auto">
      {/* Non-print controls header */}
      <div className="print:hidden space-y-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-center space-x-1 text-xs text-slate-400 hover:text-slate-200"
          >
            <ArrowLeft size={14} />
            <span>返回儀表板</span>
          </button>

          <Button size="sm" variant="primary" onClick={handlePrint}>
            <Printer size={15} className="mr-1.5" /> 列印 / 另存為 PDF
          </Button>
        </div>

        <div className="p-4 rounded-2xl bg-slate-800/80 border border-slate-700/80 text-xs space-y-1">
          <h2 className="text-sm font-bold text-slate-100 flex items-center">
            <Sparkles size={16} className="text-amber-400 mr-1.5" />
            多益考前 100 題衝刺單字總複習清單 (Printable Cram Sheet)
          </h2>
          <p className="text-slate-400 leading-relaxed">
            支援直接使用瀏覽器列印為實體紙本或 PDF 檔案，方便考前 30 分鐘或搭捷運離線遮蔽作答。
          </p>
        </div>
      </div>

      {/* Printable Sheet Content */}
      <div className="bg-slate-900 text-slate-100 print:bg-white print:text-black rounded-3xl p-6 print:p-0 space-y-4 print:space-y-3">
        {/* Printable Header */}
        <div className="border-b border-slate-800 print:border-black pb-3 text-center print:text-left flex justify-between items-end">
          <div>
            <h1 className="text-xl font-black text-slate-100 print:text-black">
              TOEIC 多益高頻衝刺 100 核心單字精選表
            </h1>
            <p className="text-xs text-slate-400 print:text-gray-600 mt-0.5">
              高頻商務場景 · 詞性變化 · 多益考點解析
            </p>
          </div>
          <div className="text-[11px] text-slate-400 print:text-gray-500 font-mono">
            日期：{new Date().toISOString().slice(0, 10)}
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-slate-400">正在整理單字清單...</div>
        ) : words.length === 0 ? (
          <div className="text-center py-12 text-slate-400">尚未下載題庫，請先至課程頁面下載。</div>
        ) : (
          <div className="divide-y divide-slate-800 print:divide-gray-300">
            {words.map((w, idx) => {
              const firstExample = w.examples?.[0];
              return (
                <div key={w.id} className="py-2.5 space-y-1 print:py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold font-mono text-slate-400 print:text-gray-500 w-6">
                        {String(idx + 1).padStart(2, '0')}.
                      </span>
                      <span className="text-sm font-black text-slate-100 print:text-black tracking-wide">
                        {w.headword}
                      </span>
                      {w.phoneticUS && (
                        <span className="text-[11px] font-mono text-emerald-400 print:text-emerald-700">
                          /{w.phoneticUS}/
                        </span>
                      )}
                      <span className="px-1.5 py-0.2 rounded bg-slate-800 print:bg-gray-200 text-[10px] font-semibold text-slate-300 print:text-gray-700">
                        {w.partsOfSpeech.join(', ')}
                      </span>
                    </div>

                    <div className="font-bold text-emerald-300 print:text-black text-right">
                      {w.definitionZh}
                    </div>
                  </div>

                  {/* Business Example with blank */}
                  {firstExample && (
                    <div className="pl-8 text-[11px] text-slate-300 print:text-gray-700 leading-relaxed">
                      <span>💼 {firstExample.en || firstExample.english}</span>
                      <span className="text-slate-400 print:text-gray-500 ml-2">
                        ({firstExample.zh || firstExample.chinese})
                      </span>
                    </div>
                  )}

                  {/* Exam Tip */}
                  {w.examTips && w.examTips.length > 0 && (
                    <div className="pl-8 text-[10px] text-amber-300/90 print:text-amber-800">
                      💡 考點：{w.examTips[0]}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
