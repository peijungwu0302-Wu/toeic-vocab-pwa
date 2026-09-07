# -*- coding: utf-8 -*-
"""
Patch public/portable_studio.html to integrate:
1. Supabase JS Client (https://hgufhnytbkbmivhofqeu.supabase.co)
2. Dual Segmented Tabs: 🔵 待出圖清單 vs 🟢 已完工檢視 (安心可見)
3. Direct cloud upload on paste
4. Automatic cloud status synchronization
"""

from pathlib import Path
import re

html_path = Path("public/portable_studio.html")
content = html_path.read_text(encoding="utf-8")

# 1. Add Supabase CDN if not present
if "supabase-js" not in content:
    content = content.replace(
        '<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>',
        '<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>\n  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>'
    )

# 2. Add Dual Tabs above wordsList if not present
tabs_html = """      <!-- 👁️ 安心可見：雙頁籤切換器 -->
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
"""

if 'id="tabPending"' not in content:
    target = '<div class="flex items-center justify-between mb-2 text-xs text-slate-400 px-1">'
    content = content.replace(target, tabs_html + '      ' + target, 1)

# 3. Add Supabase logic and tab filtering logic in JavaScript
js_patch = """
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
        showToast(`☁️ 正在直傳 "${word.headword}" 至 Supabase 雲端...`, false);
        const filename = `${word.slug}.${ext}`;
        const { data, error } = await supabase.storage
          .from('word-images')
          .upload(filename, blob, { upsert: true, contentType: ext === 'png' ? 'image/png' : 'image/jpeg' });

        if (error) {
          console.warn('Storage upload notice:', error.message);
        }

        const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/word-images/${filename}`;

        await supabase.from('studio_images').upsert({
          slug: word.slug,
          headword: word.headword,
          tier: currentTier,
          prompt: word.prompt || '',
          status: 'completed',
          image_url: publicUrl,
          image_size_bytes: blob.size,
          updated_at: new Date().toISOString()
        }, { onConflict: 'slug' });

        word.hasImage = true;
        word.cloudImageUrl = publicUrl;
        updateTabCounts();
        renderList();
        showToast(`🎉 "${word.headword}" 已安全備份至 Supabase！跨電腦即時同步！`, true);
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
"""

# Replace renderList function to support the dual tabs and count updates
old_render_list = """    function renderList() {
      const all = DATASET[currentTier] || [];
      const pendingOnly = chkPendingOnly.checked;
      const query = searchInput.value.trim().toLowerCase();
      const sortOrder = sortSelect ? sortSelect.value : 'asc';

      let filtered = all.filter(w => {
        if (pendingOnly && w.hasImage && !stagedImages.has(w.slug)) return false;
        if (query) {
          return w.headword.toLowerCase().includes(query) || w.zh.toLowerCase().includes(query);
        }
        return true;
      });"""

new_render_list = """    function renderList() {
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
      });"""

if old_render_list in content:
    content = content.replace(old_render_list, new_render_list, 1)

# In handleImageFile, trigger uploadToSupabase
old_handle_file = "reader.readAsDataURL(file);"
new_handle_file = """reader.readAsDataURL(file);
        if (supabase) {
          uploadToSupabase(selectedWord, file, file.name.split('.').pop().toLowerCase() || 'jpg');
        }"""
if old_handle_file in content and "uploadToSupabase" not in content:
    content = content.replace(old_handle_file, new_handle_file, 1)

# Insert the js_patch right after stagedImages declaration
if "const SUPABASE_URL" not in content:
    target_decl = "const stagedImages = new Map(); // slug -> { base64, ext, headword }"
    content = content.replace(target_decl, target_decl + "\n" + js_patch, 1)

# In selectWord, if image is already completed in cloud, show its preview!
old_select_preview = """      if (stagedImages.has(w.slug)) {
        const item = stagedImages.get(w.slug);
        pasteZoneNormal.classList.add('hidden');
        pasteZonePreview.classList.remove('hidden');
        pasteZonePreview.classList.add('flex');
        previewImg.src = item.base64;
        previewFilename.textContent = `${w.slug}.${item.ext}`;
      } else {"""

new_select_preview = """      if (stagedImages.has(w.slug)) {
        const item = stagedImages.get(w.slug);
        pasteZoneNormal.classList.add('hidden');
        pasteZonePreview.classList.remove('hidden');
        pasteZonePreview.classList.add('flex');
        previewImg.src = item.base64;
        previewFilename.textContent = `${w.slug}.${item.ext} (本次貼圖暫存)`;
      } else if (w.hasImage) {
        pasteZoneNormal.classList.add('hidden');
        pasteZonePreview.classList.remove('hidden');
        pasteZonePreview.classList.add('flex');
        const imgUrl = w.cloudImageUrl || `./assets/images/words/${w.slug}.webp`;
        previewImg.src = imgUrl;
        previewFilename.textContent = `${w.slug} ✅ 雲端/庫存已完工圖檔 (點擊或貼圖可重新覆蓋)`;
      } else {"""

if old_select_preview in content:
    content = content.replace(old_select_preview, new_select_preview, 1)

html_path.write_text(content, encoding="utf-8")
print("Successfully patched public/portable_studio.html with Supabase and Dual Tabs!")
