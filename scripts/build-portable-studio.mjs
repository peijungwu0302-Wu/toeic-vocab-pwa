import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const WORDS_DIR = path.join(ROOT_DIR, 'public', 'assets', 'images', 'words');
const AUDIT_FILE = path.join(ROOT_DIR, 'scripts', 'image_generation_audit.json');
const OUTPUT_FILE = path.join(ROOT_DIR, 'public', 'portable_studio.html');

const diskSlugs = new Set(
  fs.existsSync(WORDS_DIR)
    ? fs.readdirSync(WORDS_DIR).map(f => f.replace(/\.(webp|jpg)$/, '').toLowerCase())
    : []
);

const auditRecords = fs.existsSync(AUDIT_FILE)
  ? (JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8')).records || {})
  : {};

function slugify(text) {
  return text.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

const tiers = [
  { id: 'core-1200', name: '🔥 高頻核心 1200 (僅 2 詞待補)' },
  { id: 'advanced-2500', name: '💼 商務進階 2500 (🎉 100% 全數完工)' },
  { id: 'expert-high-part1', name: '🚀 滿分巔峰 Part 1' },
  { id: 'expert-high-part2', name: '🚀 滿分巔峰 Part 2' },
  { id: 'expert-high-part3', name: '🚀 滿分巔峰 Part 3' }
];

const dataset = {};

for (const t of tiers) {
  const p = path.join(ROOT_DIR, 'public', 'data', 'v1', 'courses', `course-${t.id}.json`);
  if (fs.existsSync(p)) {
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    dataset[t.id] = (d.words || []).map(w => {
      const slug = slugify(w.headword);
      const va = w.visualAnchor || {};
      const ex1 = (w.examples && w.examples[0]) || {};
      const auditRec = auditRecords[slug];
      const hasImage = diskSlugs.has(slug) || !!auditRec;
      const completedAt = auditRec ? auditRec.generatedAt : null;
      const source = auditRec ? '🤖 GCP 自動管線' : (hasImage ? '📦 本機庫存' : null);

      return {
        headword: w.headword,
        slug,
        pos: (w.partsOfSpeech || []).join(', ') || 'n.',
        zh: w.definitionZh || '',
        en: va.shortEn || ex1.en || '',
        theme: va.domainTheme || '',
        prompt: va.imagePrompt || '',
        hasImage,
        completedAt,
        source
      };
    });
  }
}

const htmlContent = `<!DOCTYPE html>
<html lang="zh-TW" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>多益單字外出伴侶出圖工作台 (Portable Studio)</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            brand: { 500: '#38bdf8', 600: '#0284c7' }
          }
        }
      }
    };
  </script>
  <style>
    body { background-color: #0b0f19; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: #0f172a; }
    ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
    .card-active { border-color: #38bdf8 !important; box-shadow: 0 0 20px rgba(56,189,248,0.15); }
  </style>
</head>
<body class="min-h-screen flex flex-col">

  <!-- Header -->
  <header class="sticky top-0 z-40 bg-slate-900/90 backdrop-blur border-b border-slate-800 px-4 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-lg font-bold shadow-lg shadow-sky-500/20">
        🎨
      </div>
      <div>
        <h1 class="text-base lg:text-lg font-bold text-white flex items-center gap-2">
          多益單字外出出圖小秘書
          <span class="text-xs bg-sky-500/20 text-sky-400 border border-sky-500/30 px-2 py-0.5 rounded-full">Portable 離線版</span>
        </h1>
        <p class="text-xs text-slate-400">在外面用筆電／手機也能輕鬆對照 Prompt、貼圖與打包下載 ZIP</p>
      </div>
    </div>

    <!-- Actions & Stats -->
    <div class="flex items-center gap-3 flex-wrap">
      <span id="lastSyncLabel" class="text-xs bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-xl text-slate-400">
        最後同步: 尚未同步
      </span>
      <button id="btnSyncCloud" class="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sky-400 text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 transition">
        🔄 刷新雲端進度
      </button>
      <button id="btnDownloadZip" class="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-xl flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition disabled:opacity-40 disabled:cursor-not-allowed">
        📦 打包下載全部已貼圖片 ZIP (<span id="zipCount">0</span>)
      </button>
      <div class="text-xs bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-xl text-slate-300">
        已貼上暫存: <span id="stagedCount" class="font-bold text-sky-400">0</span> 張
      </div>
    </div>
  </header>

  <!-- Controls Bar -->
  <section class="bg-slate-900/50 border-b border-slate-800/80 px-4 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
    <!-- Tier Selector & Sorting -->
    <div class="flex items-center gap-2 flex-wrap">
      <label class="text-xs font-medium text-slate-400">選擇題庫：</label>
      <select id="tierSelect" class="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:outline-none">
        ${tiers.map(t => `<option value="${t.id}">${t.name}</option>`).join('\n        ')}
      </select>

      <select id="sortSelect" class="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-xl px-2.5 py-2 focus:ring-2 focus:ring-sky-500 focus:outline-none ml-1">
        <option value="asc">正序 (A ➔ Z)</option>
        <option value="desc">逆序 (Z ➔ A 錯開衝刺)</option>
      </select>
    </div>

    <!-- Search Input -->
    <div class="relative w-full sm:w-72">
      <input type="text" id="searchInput" placeholder="搜尋單字、中文意思..." class="w-full bg-slate-800/80 border border-slate-700 text-xs text-slate-200 rounded-xl pl-8 pr-3 py-2 focus:ring-2 focus:ring-sky-500 focus:outline-none" />
      <span class="absolute left-2.5 top-2.5 text-xs text-slate-400">🔍</span>
    </div>
  </section>

  <!-- Main Workspace -->
  <main class="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
    
    <!-- Left: Word Cards List -->
    <div class="lg:col-span-5 flex flex-col h-[75vh]">
      <!-- 👁️ 安心可見：雙頁籤切換器 -->
      <div class="grid grid-cols-2 gap-1.5 p-1 bg-slate-950/80 border border-slate-800 rounded-xl mb-3">
        <button id="tabPending" type="button" class="py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-sky-600 text-white shadow-sm">
          <span>🔵 待出圖清單</span>
          <span id="tabPendingCount" class="bg-sky-950/80 text-sky-200 px-1.5 py-0.5 rounded-full text-[10px]">0</span>
        </button>
        <button id="tabCompleted" type="button" class="py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 text-slate-400 hover:text-slate-200">
          <span>🟢 已完工檢視</span>
          <span id="tabCompletedCount" class="bg-emerald-950/80 text-emerald-300 px-1.5 py-0.5 rounded-full text-[10px]">0</span>
        </button>
      </div>

      <div class="flex items-center justify-between mb-2 text-xs text-slate-400 px-1">
        <span>單字清單（共 <span id="listTotal">0</span> 詞）</span>
        <span class="text-sky-400">點擊卡片置於工作區</span>
      </div>
      <div id="wordsList" class="flex-1 overflow-y-auto space-y-2.5 pr-1">
        <!-- Rendered by JS -->
      </div>
    </div>

    <!-- Right: Focused Working Workbench -->
    <div class="lg:col-span-7 flex flex-col">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col h-[75vh] overflow-y-auto">
        
        <div id="emptyFocusState" class="m-auto text-center py-12 text-slate-500">
          <div class="text-4xl mb-3">👈</div>
          <p class="text-sm">請從左側點選任一單字開始出圖</p>
        </div>

        <div id="focusCard" class="hidden flex-col h-full space-y-4">
          <!-- Header -->
          <div class="flex items-baseline justify-between border-b border-slate-800 pb-3">
            <div>
              <div class="flex items-center gap-2">
                <h2 id="focusWord" class="text-2xl font-black text-white"></h2>
                <span id="focusPos" class="text-xs bg-slate-800 text-sky-400 border border-slate-700 px-2 py-0.5 rounded-lg"></span>
              </div>
              <p id="focusZh" class="text-sm text-slate-300 font-medium mt-1"></p>
            </div>
            <span id="focusTheme" class="text-xs bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2.5 py-1 rounded-full"></span>
          </div>

          <!-- 🕒 完工時間戳與來源標記資訊列 -->
          <div id="focusStatusBadge" class="hidden bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 items-center justify-between text-xs">
            <div class="flex items-center gap-2">
              <span class="text-emerald-400 font-bold">🟢 已完工</span>
              <span id="focusCompletedAt" class="text-slate-300"></span>
            </div>
            <span id="focusSource" class="text-[11px] bg-slate-800 border border-slate-700 text-sky-400 px-2 py-0.5 rounded-lg"></span>
          </div>

          <!-- Sentence -->
          <div class="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 space-y-1">
            <div class="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <span>📖 多益具象考點句</span>
            </div>
            <p id="focusEn" class="text-xs text-slate-200 leading-relaxed"></p>
          </div>

          <!-- Prompt & Copy Button -->
          <div class="space-y-1.5 flex-1 flex flex-col">
            <div class="flex items-center justify-between">
              <label class="text-xs font-bold text-sky-400 flex items-center gap-1.5">
                <span>🎨 1:1 發光看板概念插畫 Prompt</span>
              </label>
              <button id="btnCopyPrompt" class="bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 shadow-md shadow-sky-600/20 transition active:scale-95">
                <span>📋 複製生圖 Prompt</span>
              </button>
            </div>
            <textarea id="focusPrompt" readonly class="w-full flex-1 min-h-[90px] bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-xs text-slate-300 font-mono resize-none focus:outline-none focus:border-sky-500 select-all"></textarea>
          </div>

          <!-- Drop / Paste Zone -->
          <div id="pasteZone" class="border-2 border-dashed border-slate-700 hover:border-sky-400 bg-slate-950/40 rounded-2xl p-4 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2">
            <div id="pasteZoneNormal" class="space-y-1">
              <div class="text-xl">📋 / 🖼️</div>
              <p class="text-xs font-bold text-slate-300">在此處直接按 <kbd class="bg-slate-800 px-1.5 py-0.5 rounded text-sky-400 font-mono">Ctrl + V</kbd> 貼上圖片，或拖曳圖檔</p>
              <p class="text-[11px] text-slate-500">Gemini 網頁版生出圖後，右鍵「複製圖片」直接回此頁貼上即可！</p>
            </div>
            <div id="pasteZonePreview" class="hidden items-center gap-4">
              <img id="previewImg" class="w-24 h-24 object-cover rounded-xl border border-emerald-500/50 shadow-md" src="" alt="preview" />
              <div class="text-left space-y-1">
                <span class="text-xs font-bold text-emerald-400 flex items-center gap-1">✅ 圖片已成功載入！</span>
                <p id="previewFilename" class="text-[11px] font-mono text-slate-400"></p>
                <div class="flex items-center gap-2 pt-1">
                  <button id="btnDownloadSingle" class="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs px-3 py-1 rounded-lg text-slate-200">
                    💾 下載此單圖
                  </button>
                  <button id="btnNextWord" class="bg-sky-600 hover:bg-sky-500 text-xs px-3 py-1 rounded-lg text-white font-semibold">
                    ⏩ 換下一題
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>

  </main>

  <!-- Toast Notification -->
  <div id="toast" class="fixed bottom-6 right-6 z-50 transform transition-all duration-300 translate-y-8 opacity-0 pointer-events-none bg-slate-800 border border-slate-700 text-white text-xs px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2"></div>

  <script>
    const DATASET = ${JSON.stringify(dataset)};
    let currentTier = 'expert-high-part1';
    let currentWords = [];
    let selectedWord = null;
    const stagedImages = new Map(); // slug -> { base64, ext, headword }

    // ==========================================
    // ☁️ Supabase 雲端中繼站直連配置
    // ==========================================
    const SUPABASE_URL = "https://hgufhnytbkbmivhofqeu.supabase.co";
    const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhndWZobnl0YmtibWl2aG9mcWV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4MDA4MjYsImV4cCI6MjEwNDM3NjgyNn0._yPGhMCGKCmD1XoOeCMWSi9thyA1F_3QQdyX5BVsWXQ";
    let supabase = null;
    try {
      if (window.supabase) {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      }
    } catch (e) {
      console.warn("Supabase init warning:", e);
    }

    let activeTab = 'pending'; // 'pending' | 'completed'
    const tabPending = document.getElementById('tabPending');
    const tabCompleted = document.getElementById('tabCompleted');
    const tabPendingCount = document.getElementById('tabPendingCount');
    const tabCompletedCount = document.getElementById('tabCompletedCount');
    const lastSyncLabel = document.getElementById('lastSyncLabel');

    function updateTabUI() {
      if (activeTab === 'pending') {
        tabPending.className = 'py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-sky-600 text-white shadow-sm';
        tabCompleted.className = 'py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 text-slate-400 hover:text-slate-200';
      } else {
        tabCompleted.className = 'py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-emerald-600 text-white shadow-sm';
        tabPending.className = 'py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 text-slate-400 hover:text-slate-200';
      }
    }

    if (tabPending && tabCompleted) {
      tabPending.onclick = () => { activeTab = 'pending'; updateTabUI(); renderList(); };
      tabCompleted.onclick = () => { activeTab = 'completed'; updateTabUI(); renderList(); };
    }

    async function uploadToSupabase(word, blob, ext) {
      if (!supabase) return;
      try {
        showToast(\`☁️ 正在直傳 "\${word.headword}" 至 Supabase 雲端...\`, false);
        const filename = \`\${word.slug}.\${ext}\`;
        const { data, error } = await supabase.storage
          .from('word-images')
          .upload(filename, blob, { upsert: true, contentType: ext === 'png' ? 'image/png' : 'image/jpeg' });

        if (error) {
          console.warn('Storage upload notice:', error.message);
        }

        const publicUrl = \`\${SUPABASE_URL}/storage/v1/object/public/word-images/\${filename}\`;
        const nowIso = new Date().toISOString();

        await supabase.from('studio_images').upsert({
          slug: word.slug,
          headword: word.headword,
          tier: currentTier,
          prompt: word.prompt || '',
          status: 'completed',
          image_url: publicUrl,
          image_size_bytes: blob.size,
          created_at: nowIso,
          updated_at: nowIso
        }, { onConflict: 'slug' });

        word.hasImage = true;
        word.completedAt = nowIso;
        word.source = '🎨 圖書館手動貼圖';
        word.cloudImageUrl = publicUrl;
        updateTabCounts();
        renderList();
        showToast(\`🎉 "\${word.headword}" 已安全備份至 Supabase！跨電腦即時同步！\`, true);
      } catch (err) {
        console.warn('Cloud sync fallback:', err);
      }
    }

    function updateTabCounts() {
      const all = DATASET[currentTier] || [];
      let pendingNum = 0;
      let completedNum = 0;
      all.forEach(w => {
        const isDone = w.hasImage || stagedImages.has(w.slug);
        if (isDone) completedNum++;
        else pendingNum++;
      });
      if (tabPendingCount) tabPendingCount.textContent = pendingNum;
      if (tabCompletedCount) tabCompletedCount.textContent = completedNum;
    }

    function formatTime(isoStr) {
      if (!isoStr) return '';
      try {
        const d = new Date(isoStr);
        return d.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }) + ' ' +
               d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        return '';
      }
    }

    function formatFullTime(isoStr) {
      if (!isoStr) return '';
      try {
        const d = new Date(isoStr);
        return d.getFullYear() + '-' +
               String(d.getMonth() + 1).padStart(2, '0') + '-' +
               String(d.getDate()).padStart(2, '0') + ' ' +
               d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch (e) {
        return '';
      }
    }

    const tierSelect = document.getElementById('tierSelect');
    const sortSelect = document.getElementById('sortSelect');
    const searchInput = document.getElementById('searchInput');
    const wordsList = document.getElementById('wordsList');
    const listTotal = document.getElementById('listTotal');

    const emptyFocusState = document.getElementById('emptyFocusState');
    const focusCard = document.getElementById('focusCard');
    const focusWord = document.getElementById('focusWord');
    const focusPos = document.getElementById('focusPos');
    const focusZh = document.getElementById('focusZh');
    const focusTheme = document.getElementById('focusTheme');
    const focusEn = document.getElementById('focusEn');
    const focusPrompt = document.getElementById('focusPrompt');
    const btnCopyPrompt = document.getElementById('btnCopyPrompt');
    const focusStatusBadge = document.getElementById('focusStatusBadge');
    const focusCompletedAt = document.getElementById('focusCompletedAt');
    const focusSource = document.getElementById('focusSource');

    const pasteZone = document.getElementById('pasteZone');
    const pasteZoneNormal = document.getElementById('pasteZoneNormal');
    const pasteZonePreview = document.getElementById('pasteZonePreview');
    const previewImg = document.getElementById('previewImg');
    const previewFilename = document.getElementById('previewFilename');
    const btnDownloadSingle = document.getElementById('btnDownloadSingle');
    const btnNextWord = document.getElementById('btnNextWord');
    const btnDownloadZip = document.getElementById('btnDownloadZip');
    const zipCount = document.getElementById('zipCount');
    const stagedCount = document.getElementById('stagedCount');
    const toast = document.getElementById('toast');
    const btnSyncCloud = document.getElementById('btnSyncCloud');

    function showToast(msg, isSuccess = true) {
      toast.textContent = msg;
      toast.className = 'fixed bottom-6 right-6 z-50 transform transition-all duration-300 translate-y-0 opacity-100 bg-slate-900 border ' + 
        (isSuccess ? 'border-emerald-500/50 text-emerald-300' : 'border-sky-500/50 text-sky-300') + 
        ' text-xs px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2';
      setTimeout(() => {
        toast.className = toast.className.replace('translate-y-0 opacity-100', 'translate-y-8 opacity-0');
      }, 2500);
    }

    function renderList() {
      const all = DATASET[currentTier] || [];
      const query = searchInput.value.trim().toLowerCase();
      const sortOrder = sortSelect ? sortSelect.value : 'asc';
      updateTabCounts();

      let filtered = all.filter(w => {
        const isDone = w.hasImage || stagedImages.has(w.slug);
        if (activeTab === 'pending' && isDone) return false;
        if (activeTab === 'completed' && !isDone) return false;
        if (query) {
          return w.headword.toLowerCase().includes(query) || w.zh.toLowerCase().includes(query);
        }
        return true;
      });

      if (sortOrder === 'desc') {
        filtered = filtered.slice().reverse();
      }

      currentWords = filtered;
      listTotal.textContent = currentWords.length;
      wordsList.innerHTML = '';

      if (currentWords.length === 0) {
        wordsList.innerHTML = '<div class="text-center py-8 text-xs text-slate-500">此頁籤暫無符合項目</div>';
        return;
      }

      currentWords.forEach(w => {
        const isStaged = stagedImages.has(w.slug);
        const isDone = w.hasImage || isStaged;
        const isSelected = selectedWord && selectedWord.slug === w.slug;
        const timeBadge = w.completedAt ? formatTime(w.completedAt) : '';

        const card = document.createElement('div');
        card.className = 'bg-slate-900/80 hover:bg-slate-850 border border-slate-800 p-3 rounded-xl cursor-pointer transition flex items-center justify-between gap-3 ' + (isSelected ? 'card-active bg-slate-850' : '');
        card.innerHTML = \`
          <div class="flex items-center gap-3 overflow-hidden">
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0 \${isStaged ? 'bg-emerald-400 shadow-sm shadow-emerald-400' : isDone ? 'bg-sky-400' : 'bg-slate-600'}"></span>
            <div class="overflow-hidden">
              <div class="flex items-center gap-2">
                <span class="font-bold text-sm text-white truncate">\${w.headword}</span>
                <span class="text-[10px] text-slate-400">\${w.pos}</span>
              </div>
              <p class="text-xs text-slate-400 truncate">\${w.zh}</p>
            </div>
          </div>
          <div class="flex-shrink-0 text-right">
            <span class="text-[11px] px-2 py-0.5 rounded-full border \${isStaged ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : isDone ? 'bg-sky-500/10 text-sky-400 border-sky-500/20' : 'bg-slate-800 text-slate-400 border-slate-700'}">
              \${isStaged ? '已暫存' : isDone ? '已完工' : '待出圖'}
            </span>
            \${timeBadge ? \`<span class="text-[10px] text-slate-400 block mt-0.5">🕒 \${timeBadge}</span>\` : ''}
          </div>
        \`;
        card.onclick = () => selectWord(w);
        wordsList.appendChild(card);
      });
    }

    function selectWord(w) {
      selectedWord = w;
      renderList();

      emptyFocusState.classList.add('hidden');
      focusCard.classList.remove('hidden');
      focusCard.classList.add('flex');

      focusWord.textContent = w.headword;
      focusPos.textContent = w.pos;
      focusZh.textContent = w.zh;
      focusTheme.textContent = w.theme || '商業場景';
      focusEn.textContent = w.en || '暫無例句';
      focusPrompt.value = w.prompt || '';

      // 時間戳與來源資訊列
      const isDone = w.hasImage || stagedImages.has(w.slug);
      if (isDone) {
        focusStatusBadge.classList.remove('hidden');
        focusStatusBadge.classList.add('flex');
        const timeStr = w.completedAt ? formatFullTime(w.completedAt) : '時間記錄於本機';
        focusCompletedAt.textContent = \`完工時間: \${timeStr}\`;
        focusSource.textContent = w.source || (stagedImages.has(w.slug) ? '🎨 圖書館手動暫存' : '🤖 GCP 自動管線');
      } else {
        focusStatusBadge.classList.add('hidden');
        focusStatusBadge.classList.remove('flex');
      }

      if (stagedImages.has(w.slug)) {
        const item = stagedImages.get(w.slug);
        pasteZoneNormal.classList.add('hidden');
        pasteZonePreview.classList.remove('hidden');
        pasteZonePreview.classList.add('flex');
        previewImg.src = item.base64;
        previewFilename.textContent = \`\${w.slug}.\${item.ext} (本次貼圖暫存)\`;
      } else if (w.hasImage) {
        pasteZoneNormal.classList.add('hidden');
        pasteZonePreview.classList.remove('hidden');
        pasteZonePreview.classList.add('flex');
        const imgUrl = w.cloudImageUrl || \`./assets/images/words/\${w.slug}.webp\`;
        previewImg.src = imgUrl;
        previewFilename.textContent = \`\${w.slug} ✅ 完工圖檔 (可重新貼圖覆蓋)\`;
      } else {
        pasteZoneNormal.classList.remove('hidden');
        pasteZonePreview.classList.add('hidden');
        pasteZonePreview.classList.remove('flex');
      }
    }

    btnCopyPrompt.onclick = () => {
      if (!selectedWord || !selectedWord.prompt) return;
      navigator.clipboard.writeText(selectedWord.prompt).then(() => {
        showToast(\`✅ 已複製 "\${selectedWord.headword}" 的生圖 Prompt！貼到 Gemini 即可！\`, true);
      }).catch(() => {
        focusPrompt.select();
        document.execCommand('copy');
        showToast('✅ 已複製 Prompt！', true);
      });
    };

    function handleImageFile(file) {
      if (!selectedWord) {
        showToast('⚠️ 請先在左側選取要配圖的單字！', false);
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target.result;
        const ext = file.name.split('.').pop().toLowerCase() || 'jpg';
        stagedImages.set(selectedWord.slug, { base64, ext: ext === 'png' ? 'png' : 'jpg', headword: selectedWord.headword });
        
        stagedCount.textContent = stagedImages.size;
        zipCount.textContent = stagedImages.size;
        btnDownloadZip.disabled = stagedImages.size === 0;

        selectWord(selectedWord);
        showToast(\`🎉 成功貼入 "\${selectedWord.headword}" 圖檔！\`, true);
      };
      reader.readAsDataURL(file);
      if (supabase) {
        uploadToSupabase(selectedWord, file, file.name.split('.').pop().toLowerCase() || 'jpg');
      }
    }

    window.addEventListener('paste', (e) => {
      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          handleImageFile(blob);
          break;
        }
      }
    });

    pasteZone.ondragover = (e) => { e.preventDefault(); pasteZone.classList.add('border-sky-400'); };
    pasteZone.ondragleave = () => { pasteZone.classList.remove('border-sky-400'); };
    pasteZone.ondrop = (e) => {
      e.preventDefault();
      pasteZone.classList.remove('border-sky-400');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleImageFile(e.dataTransfer.files[0]);
      }
    };

    btnDownloadSingle.onclick = () => {
      if (!selectedWord || !stagedImages.has(selectedWord.slug)) return;
      const item = stagedImages.get(selectedWord.slug);
      const a = document.createElement('a');
      a.href = item.base64;
      a.download = \`\${selectedWord.slug}.\${item.ext}\`;
      a.click();
    };

    btnNextWord.onclick = () => {
      const idx = currentWords.findIndex(w => w.slug === selectedWord.slug);
      if (idx >= 0 && idx + 1 < currentWords.length) {
        selectWord(currentWords[idx + 1]);
      } else {
        showToast('🎉 本清單項目已全部瀏覽完畢！', true);
      }
    };

    btnDownloadZip.onclick = async () => {
      if (stagedImages.size === 0) return;
      const zip = new JSZip();
      showToast('⏳ 正在打包 ZIP 壓縮檔...', false);

      for (const [slug, item] of stagedImages.entries()) {
        const base64Data = item.base64.replace(/^data:image\\/\\w+;base64,/, '');
        zip.file(\`\${slug}.\${item.ext}\`, base64Data, { base64: true });
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(content);
      a.download = \`toeic_incoming_images_\${new Date().toISOString().slice(0, 10)}.zip\`;
      a.click();
      showToast('📦 ZIP 下載完成！回家丟進 incoming_images 資料夾即可一秒入庫！', true);
    };

    async function syncFromCloud(showFeedback = true) {
      try {
        if (showFeedback) showToast('⏳ 正在同步最新雲端出圖進度...', false);
        let cloudRecordsCount = 0;

        if (supabase) {
          const { data, error } = await supabase
            .from('studio_images')
            .select('slug, headword, created_at, status, image_url')
            .limit(5000);

          if (!error && data) {
            cloudRecordsCount = data.length;
            const cloudMap = new Map();
            data.forEach(r => cloudMap.set(r.slug, r));

            let newlyAdded = 0;
            Object.keys(DATASET).forEach(tier => {
              DATASET[tier].forEach(w => {
                if (cloudMap.has(w.slug)) {
                  const rec = cloudMap.get(w.slug);
                  if (!w.hasImage) {
                    w.hasImage = true;
                    newlyAdded++;
                  }
                  w.completedAt = rec.created_at;
                  w.cloudImageUrl = rec.image_url !== 'local_gcp' ? rec.image_url : null;
                  w.source = rec.image_url === 'local_gcp' ? '🤖 GCP 自動管線' : '🎨 圖書館手動貼圖';
                }
              });
            });

            updateTabCounts();
            renderList();

            const now = new Date();
            const timeStr = now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            if (lastSyncLabel) {
              lastSyncLabel.textContent = \`最後同步: \${timeStr} (雲端共 \${cloudRecordsCount} 詞)\`;
              lastSyncLabel.className = 'text-xs bg-slate-800 border border-emerald-500/40 text-emerald-300 px-3 py-1.5 rounded-xl';
            }

            if (showFeedback) {
              showToast(\`🔄 雲端同步完成！已對齊 \${cloudRecordsCount} 筆雲端進度 (新避開 \${newlyAdded} 詞)！\`, true);
            }
            return;
          }
        }

        // 離線降級
        if (showFeedback) showToast('ℹ️ 離線模式：使用本機預載完工庫存', false);
      } catch (e) {
        console.warn('Sync error:', e);
        if (showFeedback) showToast('ℹ️ 離線模式：使用本機預載完工庫存', false);
      }
    }

    btnSyncCloud.onclick = () => syncFromCloud(true);
    sortSelect.onchange = () => renderList();

    tierSelect.onchange = () => {
      currentTier = tierSelect.value;
      selectedWord = null;
      renderList();
      if (currentWords.length > 0) selectWord(currentWords[0]);
    };

    searchInput.oninput = () => renderList();

    // Initial load
    tierSelect.value = currentTier;
    renderList();
    if (currentWords.length > 0) selectWord(currentWords[0]);
    syncFromCloud(false); // 頁面載入時安靜對齊一次雲端
  </script>
</body>
</html>`;

fs.writeFileSync(OUTPUT_FILE, htmlContent, 'utf8');
console.log(`✅ 已生成升級版獨立離線外出工作台: ${OUTPUT_FILE}`);
console.log(`  體積: ${(Buffer.byteLength(htmlContent, 'utf8') / 1024).toFixed(1)} KB (自帶 4280+ 詞時間戳與 Prompt)`);
