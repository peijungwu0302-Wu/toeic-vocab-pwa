import React from 'react';
import { ArrowLeft, ExternalLink, Database, Cpu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';

export const AttributionPage: React.FC = () => {
  return (
    <div className="space-y-6 pb-8 max-w-lg mx-auto">
      <div className="flex items-center space-x-2">
        <Link to="/settings">
          <Button size="sm" variant="outline" className="p-2 min-w-[36px] min-h-[36px]">
            <ArrowLeft size={16} />
          </Button>
        </Link>
        <h2 className="text-lg font-black text-slate-100">資料來源與開源授權聲明</h2>
      </div>

      {/* GitHub Project Repository Link */}
      <div className="bg-gradient-to-r from-slate-850 to-indigo-950/70 border border-indigo-500/30 rounded-2xl p-4 flex items-center justify-between shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center space-x-1.5">
            <span className="text-xs font-black text-indigo-400">專案原始碼與開發內容</span>
          </div>
          <p className="text-xs text-slate-300">
            若要查看本專案完整內容與進度，可造訪此 GitHub 專案：
          </p>
          <p className="text-[11px] text-slate-400 font-mono">
            peijungwu0302-Wu/toeic-vocab-pwa
          </p>
        </div>
        <a
          href="https://github.com/peijungwu0302-Wu/toeic-vocab-pwa"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-950/50 flex items-center space-x-1.5 active:scale-95"
        >
          <span>前往專案</span>
          <ExternalLink size={13} />
        </a>
      </div>

      {/* Dataset Attribution */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-5 space-y-3">
        <div className="flex items-center space-x-2 text-emerald-400">
          <Database size={20} />
          <h3 className="text-sm font-bold text-slate-100">單字資料集 (Vocabulary Dataset)</h3>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          本應用程式之多益單字資料庫收錄自開源專案 <strong className="text-emerald-400">toeic-vocab-tw</strong>。
        </p>

        <div className="bg-slate-900/90 rounded-xl p-3.5 border border-slate-800 space-y-1.5 text-xs">
          <div><span className="text-slate-400">資料集作者：</span> <span className="text-slate-200 font-medium">kknono668</span></div>
          <div>
            <span className="text-slate-400">原始資料庫連結：</span>{' '}
            <a
              href="https://huggingface.co/datasets/kknono668/toeic-vocab-tw"
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:underline inline-flex items-center"
            >
              Hugging Face Dataset <ExternalLink size={11} className="ml-1" />
            </a>
          </div>
          <div>
            <span className="text-slate-400">授權條款：</span>{' '}
            <a
              href="https://creativecommons.org/licenses/by-sa/4.0/"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-400 font-semibold hover:underline inline-flex items-center"
            >
              Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0) <ExternalLink size={11} className="ml-1" />
            </a>
          </div>
        </div>

        <div className="text-[11px] text-slate-400 leading-relaxed space-y-1 pt-1">
          <p>
            <strong>清洗與轉換說明：</strong> 本應用程式透過 ETL 腳本對原始 11,154 筆詞彙進行 Unicode 正規化、去除重複詞條、分類為單字/片語/句型，並依 TOEIC 分數區間（400-600、600-780、780-900、900+）切分成靜態課程模組，以支援 iPhone 離線下載與 FSRS 間隔重複排程。原始例句與定義語意均獲完整保留。
          </p>
        </div>
      </div>

      {/* FSRS Algorithm & Dexie */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-5 space-y-3">
        <div className="flex items-center space-x-2 text-blue-400">
          <Cpu size={20} />
          <h3 className="text-sm font-bold text-slate-100">演算法與技術架構</h3>
        </div>

        <div className="text-xs text-slate-300 space-y-2 leading-relaxed">
          <p>
            <strong>FSRS (Free Spaced Repetition Scheduler)：</strong> 採用 <code className="text-emerald-300">ts-fsrs</code>（MIT 授權）計算個人化難度 (D)、穩定度 (S) 與可提取度 (R)，實現科學化的長效記憶曲線。
          </p>
          <p>
            <strong>Dexie.js：</strong> 採用 <code className="text-emerald-300">dexie</code>（Apache-2.0 授權）封裝瀏覽器 IndexedDB 本機資料庫，提供 100% 離線可用與原子性評分交易。
          </p>
        </div>
      </div>

      {/* Trademark notice */}
      <div className="bg-slate-800/40 border border-slate-800 rounded-2xl p-4 text-[11px] text-slate-400 leading-relaxed">
        <p>
          <strong>商標聲明：</strong> TOEIC 為 Educational Testing Service (ETS) 在美國及其他國家之註冊商標。本應用程式為獨立開源學習工具，與 ETS 無任何贊助、背書或附屬關係。詞條難度星級與分數區間係由開源資料集作者提供並供學習分級參考，非 ETS 官方標準。
        </p>
      </div>
    </div>
  );
};
