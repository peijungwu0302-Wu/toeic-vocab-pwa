import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const WORDS_DIR = path.join(ROOT_DIR, 'public', 'assets', 'images', 'words');
const OUTPUT_FILE = path.join(ROOT_DIR, 'public', 'portable_studio.html');

const diskSlugs = new Set(
  fs.existsSync(WORDS_DIR)
    ? fs.readdirSync(WORDS_DIR).map(f => f.replace(/\.(webp|jpg)$/, '').toLowerCase())
    : []
);

function slugify(text) {
  return text.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

const tiers = [
  { id: 'core-1200', name: '🔥 高頻核心 1200 (僅 5 詞待補)' },
  { id: 'advanced-2500', name: '💼 商務進階 2500 (金證衝刺主力庫)' },
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
      return {
        headword: w.headword,
        slug,
        pos: (w.partsOfSpeech || []).join(', ') || 'n.',
        zh: w.definitionZh || '',
        en: va.shortEn || ex1.en || '',
        theme: va.domainTheme || '',
        prompt: va.imagePrompt || '',
        hasImage: diskSlugs.has(slug)
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
    <!-- Tier Selector -->
    <div class="flex items-center gap-2 flex-wrap">
      <label class="text-xs font-medium text-slate-400">選擇題庫：</label>
      <select id="tierSelect" class="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2 focus:ring-2 focus:ring-sky-500 focus:outline-none">
        ${tiers.map(t => `<option value="${t.id}">${t.name}</option>`).join('\n        ')}
      </select>
      
      <div class="flex items-center gap-1.5 ml-2">
        <input type="checkbox" id="chkPendingOnly" class="rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-sky-500" checked />
        <label for="chkPendingOnly" class="text-xs text-slate-300 cursor-pointer">僅顯示待生圖單字</label>
      </div>
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

        <div id="focusCard" class="hidden flex-col h-full space-y-5">
          <!-- Header -->
          <div class="flex items-baseline justify-between border-b border-slate-800 pb-4">
            <div>
              <div class="flex items-center gap-2">
                <h2 id="focusWord" class="text-2xl font-black text-white"></h2>
                <span id="focusPos" class="text-xs bg-slate-800 text-sky-400 border border-slate-700 px-2 py-0.5 rounded-lg"></span>
              </div>
              <p id="focusZh" class="text-sm text-slate-300 font-medium mt-1"></p>
            </div>
            <span id="focusTheme" class="text-xs bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2.5 py-1 rounded-full"></span>
          </div>

          <!-- Sentence -->
          <div class="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5 space-y-1">
            <div class="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <span>📖 多益具象考點句</span>
            </div>
            <p id="focusEn" class="text-xs text-slate-200 leading-relaxed"></p>
          </div>

          <!-- Prompt & Copy Button -->
          <div class="space-y-2 flex-1 flex flex-col">
            <div class="flex items-center justify-between">
              <label class="text-xs font-bold text-sky-400 flex items-center gap-1.5">
                <span>🎨 1:1 發光看板概念插畫 Prompt</span>
              </label>
              <button id="btnCopyPrompt" class="bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 shadow-md shadow-sky-600/20 transition active:scale-95">
                <span>📋 複製生圖 Prompt</span>
              </button>
            </div>
            <textarea id="focusPrompt" readonly class="w-full flex-1 bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-xs text-slate-300 font-mono resize-none focus:outline-none focus:border-sky-500 select-all"></textarea>
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
                <span class="text-xs font-bold text-emerald-400 flex items-center gap-1">✅ 圖片已成功載入暫存！</span>
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
    let currentTier = 'advanced-2500';
    let currentWords = [];
    let selectedWord = null;
    const stagedImages = new Map(); // slug -> { base64, ext, headword }

    const tierSelect = document.getElementById('tierSelect');
    const chkPendingOnly = document.getElementById('chkPendingOnly');
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
      const pendingOnly = chkPendingOnly.checked;
      const query = searchInput.value.trim().toLowerCase();

      currentWords = all.filter(w => {
        if (pendingOnly && w.hasImage && !stagedImages.has(w.slug)) return false;
        if (query) {
          return w.headword.toLowerCase().includes(query) || w.zh.toLowerCase().includes(query);
        }
        return true;
      });

      listTotal.textContent = currentWords.length;
      wordsList.innerHTML = '';

      if (currentWords.length === 0) {
        wordsList.innerHTML = '<div class=\"text-center py-8 text-xs text-slate-500\">無符合單字</div>';
        return;
      }

      currentWords.forEach(w => {
        const isStaged = stagedImages.has(w.slug);
        const isDone = w.hasImage || isStaged;
        const isSelected = selectedWord && selectedWord.slug === w.slug;

        const card = document.createElement('div');
        card.className = 'bg-slate-900/80 hover:bg-slate-850 border border-slate-800 p-3 rounded-xl cursor-pointer transition flex items-center justify-between gap-3 ' + (isSelected ? 'card-active bg-slate-850' : '');
        card.innerHTML = \`
          <div class=\"flex items-center gap-3 overflow-hidden\">
            <span class=\"w-2.5 h-2.5 rounded-full flex-shrink-0 \${isStaged ? 'bg-emerald-400 shadow-sm shadow-emerald-400' : isDone ? 'bg-sky-400' : 'bg-slate-600'}\"></span>
            <div class=\"overflow-hidden\">
              <div class=\"flex items-center gap-2\">
                <span class=\"font-bold text-sm text-white truncate\">\${w.headword}</span>
                <span class=\"text-[10px] text-slate-400\">\${w.pos}</span>
              </div>
              <p class=\"text-xs text-slate-400 truncate\">\${w.zh}</p>
            </div>
          </div>
          <div class=\"flex-shrink-0 text-right\">
            <span class=\"text-[11px] px-2 py-0.5 rounded-full border \${isStaged ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : isDone ? 'bg-sky-500/10 text-sky-400 border-sky-500/20' : 'bg-slate-800 text-slate-400 border-slate-700'}\">
              \${isStaged ? '已暫存' : isDone ? '庫存有圖' : '待出圖'}
            </span>
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

      if (stagedImages.has(w.slug)) {
        const item = stagedImages.get(w.slug);
        pasteZoneNormal.classList.add('hidden');
        pasteZonePreview.classList.remove('hidden');
        pasteZonePreview.classList.add('flex');
        previewImg.src = item.base64;
        previewFilename.textContent = \`\${w.slug}.\${item.ext}\`;
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
        showToast('🎉 本清單待辦已全部瀏覽完畢！', true);
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

    tierSelect.onchange = () => {
      currentTier = tierSelect.value;
      selectedWord = null;
      renderList();
      if (currentWords.length > 0) selectWord(currentWords[0]);
    };

    chkPendingOnly.onchange = () => renderList();
    searchInput.oninput = () => renderList();

    // Initial
    renderList();
    if (currentWords.length > 0) selectWord(currentWords[0]);
  </script>
</body>
</html>`;

fs.writeFileSync(OUTPUT_FILE, htmlContent, 'utf8');
console.log(`✅ 已生成獨立離線外出工作台: ${OUTPUT_FILE}`);
console.log(`  體積: ${(Buffer.byteLength(htmlContent, 'utf8') / 1024).toFixed(1)} KB (自帶全量單字資料與 Prompt)`);
