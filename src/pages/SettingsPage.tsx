import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  Plus,
  Trash2,
  Download,
  Upload,
  Share2,
  HardDrive,
  Cloud,
  Check,
  ExternalLink,
  ShieldCheck,
  Copy,
  Key,
  Eye,
  EyeOff,
  Sparkles,
  Mail,
  Send,
  LogOut,
  Type,
  Sliders
} from 'lucide-react';
import { useProfile } from '../contexts/ProfileContext';
import { useSync } from '../contexts/SyncContext';
import { useTypography } from '../contexts/TypographyContext';
import { backupService } from '../services/backupService';
import { teacherReportService } from '../services/teacherReportService';
import { getSupabaseClient } from '../services/supabaseClient';
import { datasetMigrationService } from '../services/datasetMigrationService';
import { db } from '../db';
import { BackupDataV1, ImportPreviewSummary, ImportStrategy } from '../types/backup';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';

export const SettingsPage: React.FC = () => {
  const { activeProfile, profiles, switchProfile, createProfile, updateProfile, deleteProfile } = useProfile();
  const { syncState, triggerSync } = useSync();
  const { settings, updateSettings, resetSettings, applyPreset, pixelMetrics, headwordClass, definitionClass, exampleEnClass, exampleZhClass } = useTypography();

  const [isNewProfileModalOpen, setIsNewProfileModalOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileTarget, setNewProfileTarget] = useState(15);

  const [storageUsageMB, setStorageUsageMB] = useState<string>('0');
  const [isPersisted, setIsPersisted] = useState<boolean | null>(null);

  // Custom Gemini API Key State
  const [customApiKey, setCustomApiKey] = useState<string>('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [keySavedMessage, setKeySavedMessage] = useState(false);

  // Backup & Import
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportPreviewSummary | null>(null);
  const [importData, setImportData] = useState<BackupDataV1 | null>(null);
  const [importStrategy, setImportStrategy] = useState<ImportStrategy>('merge');
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Teacher share
  const [teacherShareModalOpen, setTeacherShareModalOpen] = useState(false);
  const [teacherMessage, setTeacherMessage] = useState('');
  const [copied, setCopied] = useState(false);

  // Cloud Magic Link Login State
  const [loginEmail, setLoginEmail] = useState('');
  const [isSendingMagicLink, setIsSendingMagicLink] = useState(false);
  const [magicLinkSentMsg, setMagicLinkSentMsg] = useState<string | null>(null);
  const [magicLinkError, setMagicLinkError] = useState<string | null>(null);

  // Dataset Version & Real-Time Diagnostics
  const [isRefreshingDataset, setIsRefreshingDataset] = useState(false);
  const [datasetRefreshMsg, setDatasetRefreshMsg] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<any | null>(null);

  const loadDiagnostics = async () => {
    try {
      const diag = await datasetMigrationService.getDiagnostics();
      setDiagnostics(diag);
    } catch {}
  };

  useEffect(() => {
    loadDiagnostics();
  }, []);

  const handleForceRefreshDataset = async () => {
    try {
      setIsRefreshingDataset(true);
      setDatasetRefreshMsg(null);
      await datasetMigrationService.forceRefreshAllCourses();
      await loadDiagnostics();
      setDatasetRefreshMsg('✅ 題庫已成功刷新至最新 v6.0.0！不背單詞 VIP 級 3 階梯例句、詞根字首、同反義微辨析與搭配語塊已更新完畢。');
      setTimeout(() => setDatasetRefreshMsg(null), 5000);
    } catch (err) {
      alert(`刷新題庫失敗：${(err as Error).message}`);
    } finally {
      setIsRefreshingDataset(false);
    }
  };

  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail.trim()) return;
    setIsSendingMagicLink(true);
    setMagicLinkSentMsg(null);
    setMagicLinkError(null);

    const client = getSupabaseClient();
    if (!client) {
      setMagicLinkError('尚未啟用 Supabase 雲端環境變數 (VITE_ENABLE_CLOUD_SYNC=true)。');
      setIsSendingMagicLink(false);
      return;
    }

    try {
      const { error } = await client.auth.signInWithOtp({
        email: loginEmail.trim(),
        options: {
          emailRedirectTo: window.location.origin
        }
      });
      if (error) throw error;
      setMagicLinkSentMsg(`已發送登入魔法連結至 ${loginEmail}！請至信箱點擊連結登入。`);
    } catch (err: any) {
      setMagicLinkError(err.message || '登入連結發送失敗，請確認 Email 是否正確。');
    } finally {
      setIsSendingMagicLink(false);
    }
  };

  const handleLogout = async () => {
    const client = getSupabaseClient();
    if (client) {
      await client.auth.signOut();
      window.location.reload();
    }
  };

  // Load storage estimation & API Key from DB
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.storage) {
      if (navigator.storage.estimate) {
        navigator.storage.estimate().then((estimate) => {
          if (estimate.usage) {
            setStorageUsageMB((estimate.usage / (1024 * 1024)).toFixed(1));
          }
        });
      }
      if (navigator.storage.persisted) {
        navigator.storage.persisted().then((persisted) => {
          setIsPersisted(persisted);
        });
      }
    }

    db.appSettings.get('custom_gemini_api_key').then(setting => {
      if (setting && setting.value) {
        setCustomApiKey(setting.value);
      }
    });
  }, []);

  const handleSaveApiKey = async () => {
    setIsSavingKey(true);
    try {
      await db.appSettings.put({
        key: 'custom_gemini_api_key',
        value: customApiKey.trim()
      });
      setKeySavedMessage(true);
      setTimeout(() => setKeySavedMessage(false), 2500);
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleRequestPersist = async () => {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      const granted = await navigator.storage.persist();
      setIsPersisted(granted);
      if (granted) {
        alert('瀏覽器已批准持久化儲存，學習進度將受到系統保護。');
      } else {
        alert('瀏覽器暫未批准永久儲存（通常需將 App 加入 iPhone 主畫面後才可啟用）。');
      }
    }
  };

  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim()) return;
    await createProfile(newProfileName.trim(), newProfileTarget);
    setNewProfileName('');
    setIsNewProfileModalOpen(false);
  };

  const handleDeleteProfile = async (id: string, name: string) => {
    if (profiles.length <= 1) {
      alert('至少需保留一個學生身分。');
      return;
    }
    if (confirm(`確定要刪除「${name}」的所有本機紀錄嗎？此動作無法復原。（建議先點擊下方匯出備份）`)) {
      await deleteProfile(id);
    }
  };

  const handleExportBackup = async () => {
    if (!activeProfile) return;
    try {
      await backupService.exportToFile(activeProfile.id);
    } catch (err) {
      alert(`匯出失敗：${(err as Error).message}`);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setImportError(null);
      const text = await file.text();
      const { data, summary } = backupService.parseAndValidateBackup(text);
      setImportData(data);
      setImportSummary(summary);
      setImportModalOpen(true);
    } catch (err) {
      console.error('Import parse error:', err);
      alert(`備份檔案格式不符或損壞：${(err as Error).message}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExecuteImport = async () => {
    if (!activeProfile || !importData) return;
    try {
      await backupService.importBackup(activeProfile.id, importData, importStrategy);
      setImportModalOpen(false);
      alert('備份資料已成功匯入！');
      window.location.reload();
    } catch (err) {
      setImportError(`匯入失敗：${(err as Error).message}`);
    }
  };

  const handleOpenTeacherShare = async () => {
    if (!activeProfile) return;
    try {
      const summary = await teacherReportService.generateSummary(activeProfile.id, 7);
      const text = teacherReportService.formatAsTextMessage(summary);
      setTeacherMessage(text);
      setTeacherShareModalOpen(true);
      setCopied(false);
    } catch (err) {
      alert(`產生週報失敗：${(err as Error).message}`);
    }
  };

  const handleCopyTeacherMessage = () => {
    navigator.clipboard.writeText(teacherMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div>
        <h2 className="text-xl font-black text-slate-100">設定與系統管理</h2>
        <p className="text-xs text-slate-400 mt-1">管理學生身分、免費 AI Key、備份與雲端同步</p>
      </div>

      {/* 1. Custom Gemini API Key Panel */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200 flex items-center space-x-1.5">
            <Sparkles size={16} className="text-amber-400" />
            <span>自訂 Gemini API Key（選填 · 100% 免費）</span>
          </h3>
          <Badge variant={customApiKey.trim() ? 'emerald' : 'blue'}>
            {customApiKey.trim() ? '🟢 個人 Key 直連' : '🔵 預設離線模式'}
          </Badge>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          Google AI Studio 提供每日 <strong className="text-slate-200">1,500 次免費請求</strong>。填入個人 API Key 可享受零等待 AI 造句批改與對話模擬，資料純存本機絕不外流。
        </p>

        <div className="space-y-2 pt-1">
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              placeholder="貼上 AIzaSy..."
              value={customApiKey}
              onChange={(e) => setCustomApiKey(e.target.value)}
              className="w-full pl-9 pr-10 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 text-xs font-mono focus:outline-none focus:border-emerald-500"
            />
            <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <button
              type="button"
              onClick={() => setShowApiKey(prev => !prev)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-emerald-400 hover:underline flex items-center"
            >
              <span>免費取得 Google API Key</span>
              <ExternalLink size={11} className="ml-1" />
            </a>

            <Button size="sm" variant="primary" onClick={handleSaveApiKey} disabled={isSavingKey}>
              {keySavedMessage ? (
                <>
                  <Check size={14} className="mr-1" /> 已儲存
                </>
              ) : (
                '儲存設定'
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* 2. Profile Management */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200 flex items-center space-x-1.5">
            <Users size={16} className="text-emerald-400" />
            <span>學生身分切換 ({profiles.length})</span>
          </h3>
          <button
            type="button"
            onClick={() => setIsNewProfileModalOpen(true)}
            className="flex items-center space-x-1 text-xs text-emerald-400 hover:text-emerald-300 font-semibold"
          >
            <Plus size={14} />
            <span>新增學生</span>
          </button>
        </div>

        <div className="space-y-2">
          {profiles.map((p) => {
            const isActive = activeProfile?.id === p.id;
            return (
              <div
                key={p.id}
                onClick={() => !isActive && switchProfile(p.id)}
                className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                  isActive
                    ? 'bg-emerald-950/40 border-emerald-500/60 shadow-sm'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${
                    isActive ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {p.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-slate-100">{p.displayName}</span>
                      {isActive && <Badge variant="emerald">目前使用</Badge>}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      目標：{p.dailyNewCardsTarget} 字/天 · {p.preferredAccent} 發音
                    </p>
                  </div>
                </div>

                {profiles.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteProfile(p.id, p.displayName);
                    }}
                    className="p-2 text-slate-500 hover:text-rose-400 rounded-lg transition-colors"
                    title="刪除學生"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Study Preferences */}
      {activeProfile && (
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 space-y-4">
          <h3 className="text-sm font-bold text-slate-200">個人學習偏好</h3>

          {/* Daily new target */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-slate-200">每日新字目標</div>
              <div className="text-[11px] text-slate-400">每日建議學習新單字數量</div>
            </div>
            <select
              value={activeProfile.dailyNewCardsTarget}
              onChange={(e) => updateProfile({ dailyNewCardsTarget: Number(e.target.value) })}
              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 font-bold focus:outline-none"
            >
              <option value={10}>10 字 / 天</option>
              <option value={15}>15 字 / 天</option>
              <option value={20}>20 字 / 天</option>
              <option value={30}>30 字 / 天</option>
            </select>
          </div>

          {/* Accent choice */}
          <div className="flex items-center justify-between border-t border-slate-700/50 pt-3">
            <div>
              <div className="text-xs font-semibold text-slate-200">發音口音偏好</div>
              <div className="text-[11px] text-slate-400">美式英語 (US) / 英式英語 (UK)</div>
            </div>
            <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-700">
              {(['US', 'UK'] as const).map((accent) => (
                <button
                  key={accent}
                  type="button"
                  onClick={() => updateProfile({ preferredAccent: accent })}
                  className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                    activeProfile.preferredAccent === accent
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {accent}
                </button>
              ))}
            </div>
          </div>

          {/* Auto play audio toggle */}
          <div className="flex items-center justify-between border-t border-slate-700/50 pt-3">
            <div>
              <div className="text-xs font-semibold text-slate-200">自動播放發音</div>
              <div className="text-[11px] text-slate-400">翻開卡片時自動朗讀單字</div>
            </div>
            <button
              type="button"
              onClick={() => updateProfile({ autoPlayAudio: !activeProfile.autoPlayAudio })}
              className={`w-12 h-6 rounded-full transition-colors relative ${
                activeProfile.autoPlayAudio ? 'bg-emerald-600' : 'bg-slate-700'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                  activeProfile.autoPlayAudio ? 'left-7' : 'left-1'
                }`}
              />
            </button>
          </div>

        </div>
      )}

      {/* 3. 🎨 閱讀字體與視覺排版自訂 (Typography & Layout Customization) */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200 flex items-center space-x-1.5">
            <Type size={16} className="text-emerald-400" />
            <span>閱讀字體與排版自訂 (Typography & Layout)</span>
          </h3>
          <span className="text-[10px] text-slate-400">即時生效 · 所見即所得</span>
        </div>

        {/* 👁️ Live Preview Card (所見即所得預覽卡片) */}
        <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-700/80 rounded-2xl p-3.5 shadow-inner space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1.5">
              <span className="px-2 py-0.5 rounded-md bg-emerald-950/80 text-[10px] text-emerald-300 border border-emerald-800/50 font-bold">
                單字
              </span>
              <span className="text-[11px] text-slate-400">🏢 辦公行政</span>
            </div>
            <span className="text-[10px] text-amber-400 font-semibold flex items-center">
              <Sparkles size={11} className="mr-1" /> 效果即時預覽
            </span>
          </div>

          <div>
            <h4 className={`${headwordClass} text-slate-100 tracking-tight leading-tight`}>
              contract
            </h4>
            <p className="text-xs font-mono text-emerald-400/90 mt-0.5">
              /ˈkɑːntrækt/
            </p>
          </div>

          <div className="p-2 rounded-xl bg-slate-900/90 border border-slate-800">
            <div className="text-[10px] text-slate-400 font-semibold mb-0.5">中文釋義</div>
            <div className={`${definitionClass} text-emerald-300`}>
              合約、契約；簽訂合約
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/60 border border-emerald-500/30 space-y-1">
            <div className="text-[10px] text-emerald-400 font-bold flex items-center space-x-1">
              <Sparkles size={10} className="text-amber-400" />
              <span>🌟 專屬具象商務例句 (1:1 錨定配圖)</span>
            </div>
            <p className={`text-slate-100 ${exampleEnClass}`}>
              Both executive teams finalized and signed the commercial contract in the boardroom.
            </p>
            <p className={`text-emerald-400/90 ${exampleZhClass} mt-1`}>
              兩位主管團隊在董事會議室正式敲定並簽署了該商業合約。
            </p>
          </div>
        </div>

        {/* Global Quick Presets (全局快速檔位) */}
        <div className="space-y-1.5 pt-1">
          <div className="text-xs font-bold text-slate-300 flex items-center justify-between">
            <span>全局一鍵預設檔位</span>
            <button
              type="button"
              onClick={resetSettings}
              className="text-[11px] text-slate-400 hover:text-slate-200 underline"
            >
              重設為預設值
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
            {[
              { id: 'compact', label: '📱 緊湊' },
              { id: 'standard', label: '🖥️ 標準' },
              { id: 'large', label: '👓 大字' },
              { id: 'huge', label: '👴 特大' },
              { id: 'giant', label: '🔍 超大 (+1級)' },
              { id: 'ultra', label: '🛡️ 護眼至尊 (+2級)' }
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id as any)}
                className="py-2 px-1 rounded-xl bg-slate-900 border border-slate-700 text-[11px] font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition-all text-center"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* 自由無級比例縮放 (Continuous Free Scale Slider up to 200%) */}
        <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-700/60 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-200 flex items-center">
              <Sliders size={14} className="mr-1.5 text-emerald-400" />
              自由自訂比例縮放 (最高允許 200% 雙倍護眼)
            </span>
            <span className="font-mono font-bold text-emerald-400 text-sm">
              {settings.fontScalePercent || 100}%
            </span>
          </div>
          <input
            type="range"
            min={75}
            max={200}
            step={5}
            value={settings.fontScalePercent || 100}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (val <= 85) applyPreset('compact');
              else if (val <= 105) applyPreset('standard');
              else if (val <= 125) applyPreset('large');
              else if (val <= 150) applyPreset('huge');
              else if (val <= 180) applyPreset('giant');
              else applyPreset('ultra');
              updateSettings({ fontScalePercent: val });
            }}
            className="w-full accent-emerald-500 cursor-pointer h-2 bg-slate-800 rounded-lg appearance-none"
          />
          <div className="flex justify-between text-[10px] text-slate-500 font-mono">
            <span>75% 緊湊</span>
            <span>100% 標準</span>
            <span>120% 大字</span>
            <span>140% 特大</span>
            <span>170% 超大(+1)</span>
            <span>200% 至尊(+2)</span>
          </div>
        </div>

        {/* 物理像素即時對照看板 (Live Physical Pixel Matrix) */}
        <div className="p-3 bg-slate-900/90 rounded-xl border border-emerald-500/30 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-emerald-400 flex items-center">
              <Sparkles size={13} className="mr-1 text-amber-400" />
              物理像素換算對照 (Live px Matrix · 隨心所欲調整)
            </span>
            <span className="text-[10px] text-slate-400">真實顯示數值</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 text-center flex flex-col justify-between overflow-hidden min-h-[85px]">
              <span className="text-[10px] text-slate-400 block mb-0.5">核心單字</span>
              <div
                style={{ fontSize: `${Math.min(36, pixelMetrics.headwordPx)}px` }}
                className="font-black text-slate-100 tracking-tight leading-tight truncate my-auto"
              >
                contract
              </div>
              <span className="font-mono text-emerald-400 text-[10px] mt-0.5">{pixelMetrics.headwordPx} px</span>
            </div>

            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 text-center flex flex-col justify-between overflow-hidden min-h-[85px]">
              <span className="text-[10px] text-slate-400 block mb-0.5">中文釋義</span>
              <div
                style={{ fontSize: `${Math.min(30, pixelMetrics.definitionPx)}px` }}
                className="font-bold text-emerald-300 tracking-tight leading-tight truncate my-auto"
              >
                合約；協議
              </div>
              <span className="font-mono text-emerald-400 text-[10px] mt-0.5">{pixelMetrics.definitionPx} px</span>
            </div>

            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 text-center flex flex-col justify-between overflow-hidden min-h-[85px]">
              <span className="text-[10px] text-slate-400 block mb-0.5">例句英文</span>
              <div
                style={{ fontSize: `${Math.min(26, pixelMetrics.exampleEnPx)}px` }}
                className="font-semibold text-slate-200 tracking-tight leading-tight truncate my-auto"
              >
                Sign contract.
              </div>
              <span className="font-mono text-emerald-400 text-[10px] mt-0.5">{pixelMetrics.exampleEnPx} px</span>
            </div>

            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 text-center flex flex-col justify-between overflow-hidden min-h-[85px]">
              <span className="text-[10px] text-slate-400 block mb-0.5">音標/考點/搭配</span>
              <div
                style={{ fontSize: `${Math.min(24, pixelMetrics.supportingPx)}px` }}
                className="font-semibold text-teal-300 tracking-tight leading-tight truncate my-auto"
              >
                /kɑːntrækt/
              </div>
              <span className="font-mono text-emerald-400 text-[10px] mt-0.5">{pixelMetrics.supportingPx} px</span>
            </div>
          </div>
        </div>

        {/* Granular Individual Controls (分項獨立微調 · 雙向聯動) */}
        <div className="space-y-3 pt-2 border-t border-slate-700/60">
          <div className="text-xs font-bold text-slate-300">分項獨立自訂大小 (雙向聯動)</div>

          {/* 1. Headword Size */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
            <div>
              <div className="text-xs font-semibold text-slate-200">單字英文標題大小</div>
              <div className="text-[10px] text-slate-400">卡片正反面核心單字標題</div>
            </div>
            <div className="flex flex-wrap bg-slate-900 p-1 rounded-lg border border-slate-700 gap-0.5">
              {[
                { id: 'sm', label: '小 (20px)', scale: 85 },
                { id: 'md', label: '標準 (28px)', scale: 100 },
                { id: 'lg', label: '大 (34px)', scale: 120 },
                { id: 'xl', label: '特 (40px)', scale: 140 },
                { id: '2xl', label: '超 (48px)', scale: 170 },
                { id: '3xl', label: '尊 (56px)', scale: 200 }
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => updateSettings({ headwordSize: item.id as any, fontScalePercent: item.scale })}
                  className={`px-2 py-1 text-[11px] font-bold rounded-md transition-all ${
                    settings.headwordSize === item.id
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Example EN Size */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-t border-slate-700/40 pt-2.5">
            <div>
              <div className="text-xs font-semibold text-slate-200">例句英文本文字體</div>
              <div className="text-[10px] text-slate-400">具象長句英文本文字體大小</div>
            </div>
            <div className="flex flex-wrap bg-slate-900 p-1 rounded-lg border border-slate-700 gap-0.5">
              {[
                { id: 'xs', label: '12px', scale: 85 },
                { id: 'sm', label: '14px', scale: 95 },
                { id: 'md', label: '15px (標準)', scale: 100 },
                { id: 'lg', label: '18px', scale: 120 },
                { id: 'xl', label: '21px', scale: 140 },
                { id: '2xl', label: '26px', scale: 170 },
                { id: '3xl', label: '30px', scale: 200 }
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => updateSettings({ exampleEnSize: item.id as any, fontScalePercent: item.scale })}
                  className={`px-2 py-1 text-[11px] font-bold rounded-md transition-all ${
                    settings.exampleEnSize === item.id
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Example ZH Size */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-t border-slate-700/40 pt-2.5">
            <div>
              <div className="text-xs font-semibold text-slate-200">例句中文翻譯字體</div>
              <div className="text-[10px] text-slate-400">綠色繁中對譯文字大小</div>
            </div>
            <div className="flex flex-wrap bg-slate-900 p-1 rounded-lg border border-slate-700 gap-0.5">
              {[
                { id: 'xs', label: '11px', scale: 85 },
                { id: 'sm', label: '13px (標準)', scale: 100 },
                { id: 'md', label: '16px', scale: 120 },
                { id: 'lg', label: '18px', scale: 140 },
                { id: 'xl', label: '22px', scale: 170 },
                { id: '2xl', label: '26px', scale: 200 }
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => updateSettings({ exampleZhSize: item.id as any, fontScalePercent: item.scale })}
                  className={`px-2 py-1 text-[11px] font-bold rounded-md transition-all ${
                    settings.exampleZhSize === item.id
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* 4. Definition Size */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-t border-slate-700/40 pt-2.5">
            <div>
              <div className="text-xs font-semibold text-slate-200">單字中文釋義大小</div>
              <div className="text-[10px] text-slate-400">卡片背面核心中文釋義</div>
            </div>
            <div className="flex flex-wrap bg-slate-900 p-1 rounded-lg border border-slate-700 gap-0.5">
              {[
                { id: 'sm', label: '14px', scale: 85 },
                { id: 'md', label: '17px (標準)', scale: 100 },
                { id: 'lg', label: '20px', scale: 120 },
                { id: 'xl', label: '24px', scale: 140 },
                { id: '2xl', label: '29px', scale: 170 },
                { id: '3xl', label: '34px', scale: 200 }
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => updateSettings({ definitionSize: item.id as any, fontScalePercent: item.scale })}
                  className={`px-2 py-1 text-[11px] font-bold rounded-md transition-all ${
                    settings.definitionSize === item.id
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 5. Fast Skim Speed & Image Preferences (速讀偏好) */}
        <div className="space-y-3 pt-2 border-t border-slate-700/60">
          <div className="text-xs font-bold text-slate-300">速讀模式偏好設定</div>

          {/* Fast Skim Default Duration */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-slate-200">速讀預設停留秒數</div>
              <div className="text-[10px] text-slate-400">支援 1.5 秒等小數點精確快閃</div>
            </div>
            <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-700">
              {[1.0, 1.5, 2.0, 3.0, 4.0].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => {
                    updateSettings({ fastSkimDurationSec: sec });
                    updateProfile({ fastSkimDurationSec: sec });
                  }}
                  className={`px-2 py-1 text-xs font-bold rounded-md transition-all ${
                    settings.fastSkimDurationSec === sec
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>

          {/* Fast Skim Image Toggle */}
          <div className="flex items-center justify-between border-t border-slate-700/40 pt-2.5">
            <div>
              <div className="text-xs font-semibold text-slate-200">速讀專屬配圖開關</div>
              <div className="text-[10px] text-slate-400">圖文雙軌直覺速讀 vs 純文字極速模式</div>
            </div>
            <button
              type="button"
              onClick={() => updateSettings({ fastSkimShowImage: !settings.fastSkimShowImage })}
              className={`w-12 h-6 rounded-full transition-colors relative ${
                settings.fastSkimShowImage !== false ? 'bg-emerald-600' : 'bg-slate-700'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                  settings.fastSkimShowImage !== false ? 'left-7' : 'left-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* 4. Backup & Restore (Local-first) */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-slate-200 flex items-center space-x-1.5">
          <Download size={16} className="text-blue-400" />
          <span>資料備份與還原 (JSON)</span>
        </h3>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          純離線匯出個人學習與 FSRS 排程進度，支援多裝置移轉。
        </p>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button size="md" variant="outline" onClick={handleExportBackup}>
            <Download size={15} className="mr-1.5" /> 匯出備份
          </Button>

          <Button
            size="md"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={15} className="mr-1.5" /> 匯入備份
          </Button>
          <input
            type="file"
            ref={fileInputRef}
            accept=".json"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </div>

      {/* 5. Teacher Share Progress */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-slate-200 flex items-center space-x-1.5">
          <Share2 size={16} className="text-purple-400" />
          <span>教師進度回報</span>
        </h3>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          一鍵產生隱私安全的學習週報（包含完成字數、良好率與常忘單字），方便傳送給教師。
        </p>

        <Button size="md" variant="primary" fullWidth onClick={handleOpenTeacherShare}>
          <Share2 size={15} className="mr-1.5" /> 產生學生學習週報
        </Button>
      </div>

      {/* 6. Storage & Persistence */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-slate-200 flex items-center space-x-1.5">
          <HardDrive size={16} className="text-teal-400" />
          <span>儲存空間與持久化</span>
        </h3>

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">目前本機資料估算用量：</span>
          <span className="font-bold text-slate-200">{storageUsageMB} MB</span>
        </div>

        <div className="flex items-center justify-between text-xs border-t border-slate-700/50 pt-2">
          <span className="text-slate-400">持久化儲存授權狀態：</span>
          <span className="font-bold text-slate-200">
            {isPersisted === true ? (
              <span className="text-emerald-400 flex items-center">
                <ShieldCheck size={14} className="mr-1" /> 已保護
              </span>
            ) : (
              <button
                type="button"
                onClick={handleRequestPersist}
                className="text-xs text-blue-400 hover:underline"
              >
                點擊申請保護
              </button>
            )}
          </span>
        </div>
      </div>

      {/* 7. Cloud Sync & Magic Link Login */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200 flex items-center space-x-1.5">
            <Cloud size={16} className="text-indigo-400" />
            <span>雲端帳號與網路連結登入</span>
          </h3>
          <Badge variant={syncState.cloudUserEmail ? 'emerald' : 'slate'}>
            {syncState.cloudUserEmail ? '🟢 已連線' : '🔵 本機模式'}
          </Badge>
        </div>

        {syncState.cloudUserEmail ? (
          <div className="space-y-3">
            <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-700 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-100">{syncState.cloudUserEmail}</p>
                <p className="text-[10px] text-emerald-400 mt-0.5">跨裝置進度已即時同步</p>
              </div>
              <div className="flex space-x-1.5">
                <Button size="sm" variant="outline" onClick={() => triggerSync()}>
                  立即同步
                </Button>
                <Button size="sm" variant="danger" onClick={handleLogout}>
                  <LogOut size={13} className="mr-1" /> 登出
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              輸入 Email 即可接收<strong>「免密碼網路登入連結 (Magic Link)」</strong>，點擊信件連結即可無縫跨手機、平板與電腦同步學習進度。
            </p>

            <form onSubmit={handleSendMagicLink} className="space-y-2">
              <div className="relative">
                <input
                  type="email"
                  required
                  placeholder="請輸入您的 Email (如 user@example.com)"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="w-full pl-9 pr-24 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-indigo-500"
                />
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <button
                  type="submit"
                  disabled={isSendingMagicLink}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors flex items-center space-x-1 shadow-sm"
                >
                  {isSendingMagicLink ? (
                    <span>發送中...</span>
                  ) : (
                    <>
                      <Send size={11} />
                      <span>寄送連結</span>
                    </>
                  )}
                </button>
              </div>

              {magicLinkSentMsg && (
                <div className="text-emerald-300 bg-emerald-950/60 p-2 rounded-lg border border-emerald-700 text-xs font-medium">
                  {magicLinkSentMsg}
                </div>
              )}

              {magicLinkError && (
                <div className="text-rose-300 bg-rose-950/60 p-2 rounded-lg border border-rose-800 text-xs">
                  {magicLinkError}
                </div>
              )}
            </form>
          </div>
        )}
      </div>

      {/* 8. Dataset Version & Real-time Diagnostics (版本診斷面板) */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200 flex items-center space-x-1.5">
            <Sparkles size={16} className="text-teal-400" />
            <span>系統版本與題庫診斷面板</span>
          </h3>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-teal-500/20 text-teal-300 border border-teal-500/40">
            {diagnostics?.appVersion || 'v6.0.0'}
          </span>
        </div>

        {/* Diagnostic Metadata Grid */}
        <div className="grid grid-cols-2 gap-2 bg-slate-950/70 p-3 rounded-xl border border-slate-800 text-[11px]">
          <div>
            <span className="text-slate-500 block">📱 應用程式版本：</span>
            <span className="font-bold text-slate-200">{diagnostics?.appVersion || 'v6.0.0'}</span>
          </div>
          <div>
            <span className="text-slate-500 block">👑 題庫架構規格：</span>
            <span className="font-bold text-emerald-400">{diagnostics?.datasetReleaseTag || 'v6.0.0-bbword-vip'}</span>
          </div>
          <div className="pt-1.5 border-t border-slate-800/80">
            <span className="text-slate-500 block">💾 本機已快取單字：</span>
            <span className="font-bold text-blue-400">{diagnostics?.cachedWordsCount ?? 0} 詞</span>
          </div>
          <div className="pt-1.5 border-t border-slate-800/80">
            <span className="text-slate-500 block">🔄 本機儲存庫狀態：</span>
            <span className={`font-bold ${diagnostics?.isUpToDate ? 'text-emerald-400' : 'text-amber-400'}`}>
              v{diagnostics?.localIndexedDbVersion ?? 1} {diagnostics?.isUpToDate ? '🟢 最新' : '🟡 待升級'}
            </span>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          收錄全量 <strong className="text-emerald-400">11,154 詞</strong> 之「不背單詞 VIP 級」<strong className="text-teal-300">3 階梯商務例句、8K生圖提示詞、字根字首拆解、多益考點陷阱、詞族衍生樹與同反義微辨析</strong>。手機端若有快取延遲，可點擊下方按鈕一鍵熱升級（個人學習進度與 FSRS 曲線 100% 完整保留）。
        </p>

        <Button
          size="sm"
          variant="outline"
          onClick={handleForceRefreshDataset}
          disabled={isRefreshingDataset}
          className="w-full justify-center border-teal-600/50 text-teal-300 hover:bg-teal-950/40"
        >
          {isRefreshingDataset ? (
            <>
              <span className="w-3 h-3 border-2 border-teal-400 border-t-transparent rounded-full animate-spin mr-1.5" />
              <span>正在熱升級題庫快取中...</span>
            </>
          ) : (
            <>
              <span>🔄 立即刷新本機題庫至最新 v6.0.0 (保留學習進度)</span>
            </>
          )}
        </Button>

        {datasetRefreshMsg && (
          <div className="text-emerald-300 bg-emerald-950/60 p-2 rounded-lg border border-emerald-700 text-xs font-medium text-center">
            {datasetRefreshMsg}
          </div>
        )}
      </div>

      {/* 9. License & Notices */}
      <div className="text-center pt-2 pb-4">
        <Link
          to="/attribution"
          className="text-xs text-slate-400 hover:text-emerald-400 transition-colors inline-flex items-center space-x-1.5 py-1 px-3 rounded-full hover:bg-slate-800/60"
        >
          <span>資料來源、CC BY-SA 4.0 授權與第三方聲明</span>
          <ExternalLink size={12} />
        </Link>
      </div>

      {/* Modal: New Profile */}
      <Modal
        isOpen={isNewProfileModalOpen}
        onClose={() => setIsNewProfileModalOpen(false)}
        title="建立新學生身分"
      >
        <form onSubmit={handleCreateProfile} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">學生暱稱</label>
            <input
              type="text"
              required
              placeholder="例如：Alex"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">每日新字目標</label>
            <select
              value={newProfileTarget}
              onChange={(e) => setNewProfileTarget(Number(e.target.value))}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 text-sm"
            >
              <option value={10}>10 字 / 天</option>
              <option value={15}>15 字 / 天</option>
              <option value={25}>25 字 / 天</option>
            </select>
          </div>
          <div className="pt-2 flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => setIsNewProfileModalOpen(false)}>
              取消
            </Button>
            <Button type="submit" variant="primary">
              建立學生
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Import Preview */}
      <Modal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="確認匯入備份資料"
      >
        {importSummary && (
          <div className="space-y-4 text-xs">
            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
              <div><span className="text-slate-400">備份學生名稱：</span> <span className="font-bold text-slate-100">{importSummary.profileName}</span></div>
              <div><span className="text-slate-400">匯出時間：</span> <span className="text-slate-300">{importSummary.exportedAt.slice(0, 19).replace('T', ' ')}</span></div>
              <div><span className="text-slate-400">進度記錄筆數：</span> <span className="text-emerald-400 font-bold">{importSummary.totalProgress} 筆</span></div>
              <div><span className="text-slate-400">複習日誌筆數：</span> <span className="text-blue-400 font-bold">{importSummary.totalLogs} 筆</span></div>
            </div>

            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">匯入衝突策略</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setImportStrategy('merge')}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    importStrategy === 'merge'
                      ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-bold">合併更新 (推薦)</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">保留最新複習紀錄</div>
                </button>

                <button
                  type="button"
                  onClick={() => setImportStrategy('replace')}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    importStrategy === 'replace'
                      ? 'bg-rose-950/40 border-rose-500 text-rose-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-bold text-rose-300">完全取代</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">以備份覆蓋本機資料</div>
                </button>
              </div>
            </div>

            {importError && (
              <div className="text-rose-400 bg-rose-950/40 p-2.5 rounded-lg border border-rose-800">
                {importError}
              </div>
            )}

            <div className="pt-2 flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setImportModalOpen(false)}>
                取消
              </Button>
              <Button type="button" variant="primary" onClick={handleExecuteImport}>
                確認匯入
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Teacher Share */}
      <Modal
        isOpen={teacherShareModalOpen}
        onClose={() => setTeacherShareModalOpen(false)}
        title="學生學習進度週報"
      >
        <div className="space-y-4">
          <textarea
            readOnly
            value={teacherMessage}
            rows={12}
            className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 font-mono text-xs leading-relaxed focus:outline-none select-all"
          />

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">
              可直接貼至 LINE、Email 或通訊軟體
            </span>
            <Button size="sm" variant="primary" onClick={handleCopyTeacherMessage}>
              {copied ? (
                <>
                  <Check size={14} className="mr-1" /> 已複製到剪貼簿
                </>
              ) : (
                <>
                  <Copy size={14} className="mr-1" /> 複製週報文字
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
