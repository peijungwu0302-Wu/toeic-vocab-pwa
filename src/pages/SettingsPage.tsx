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
  Copy
} from 'lucide-react';
import { useProfile } from '../contexts/ProfileContext';
import { useSync } from '../contexts/SyncContext';
import { backupService } from '../services/backupService';
import { teacherReportService } from '../services/teacherReportService';
import { BackupDataV1, ImportPreviewSummary, ImportStrategy } from '../types/backup';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';

export const SettingsPage: React.FC = () => {
  const { activeProfile, profiles, switchProfile, createProfile, updateProfile, deleteProfile } = useProfile();
  const { syncState, triggerSync } = useSync();

  const [isNewProfileModalOpen, setIsNewProfileModalOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileTarget, setNewProfileTarget] = useState(15);

  const [storageUsageMB, setStorageUsageMB] = useState<string>('0');
  const [isPersisted, setIsPersisted] = useState<boolean | null>(null);

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

  // Load storage estimation
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
  }, []);

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
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div>
        <h2 className="text-xl font-black text-slate-100">設定與系統管理</h2>
        <p className="text-xs text-slate-400 mt-1">管理學生身分、發音、資料備份與雲端同步</p>
      </div>

      {/* 1. Profile Management */}
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

      {/* 2. Study Preferences */}
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

      {/* 3. Backup & Restore (Local-first) */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-slate-200 flex items-center space-x-1.5">
          <Download size={16} className="text-blue-400" />
          <span>資料備份與還原 (JSON)</span>
        </h3>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          瀏覽器儲存雖快，但仍可能受 iOS 清理。建議定期匯出備份檔案保存進度。
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

      {/* 4. Teacher Share Progress */}
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

      {/* 5. Storage & Persistence */}
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

      {/* 6. Optional Cloud Sync Status */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200 flex items-center space-x-1.5">
            <Cloud size={16} className="text-indigo-400" />
            <span>雲端同步 (Supabase)</span>
          </h3>
          <Badge variant={syncState.cloudUserEmail ? 'emerald' : 'slate'}>
            {syncState.cloudUserEmail ? '已連線' : '本機 Local-only'}
          </Badge>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          {syncState.cloudUserEmail
            ? `已綁定帳號：${syncState.cloudUserEmail}`
            : '預設為純本機離線運作。若設定 Supabase 環境變數後可自動跨裝置同步。'}
        </p>

        {syncState.cloudUserEmail && (
          <Button size="sm" variant="outline" onClick={() => triggerSync()}>
            手動立即同步
          </Button>
        )}
      </div>

      {/* 7. License & Notices */}
      <div className="text-center pt-2">
        <Link
          to="/attribution"
          className="text-xs text-slate-400 hover:text-emerald-400 transition-colors inline-flex items-center space-x-1"
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
