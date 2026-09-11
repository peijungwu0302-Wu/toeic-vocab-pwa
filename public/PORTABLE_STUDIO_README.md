# 🎨 多益單字外出出圖小秘書 · 審計伴侶工作台 (Portable Studio) - 說明手冊

> **檔案位置**：`public/portable_studio.html`  
> **線上即時網址**：[https://toeic-vocab-pwa-delta.vercel.app/portable_studio.html](https://toeic-vocab-pwa-delta.vercel.app/portable_studio.html)  
> **架構特性**：純前端單一 HTML 檔案、零外部後端依賴、全離線可用、自帶全量題庫與提示詞資料集。

---

## 📖 產品定位與設計初衷

**Portable Studio** 是專為「TOEIC 速記 PWA」打造的輔助審計工作台。它的核心使命是：
1. **隨身便攜（Portable）**：無論在筆電、平板或手機上，隨時隨地檢視 5 大題庫的 v4 故事板提示詞與考點例句。
2. **直觀審計（Visual QA）**：即時查看哪些單字已成功生成圖片、哪些單字尚待出圖，杜絕缺圖或錯圖。
3. **外出協作與手動貼圖（Paste & Pack ZIP）**：在外用網頁版 Gemini 生圖時，可直接複製圖片貼上暫存，一鍵打包下載 ZIP 檔帶回本機入庫。
4. **雲端進度同步（Supabase Real-time Sync）**：透過極輕量純文字中繼站，追蹤自動管線與手動出圖的完工標記與時間戳。

---

## 🌟 核心功能全覽

### 1. 雙頁籤進度過濾器 (Dual-Tab Filter)
* 🔵 **待出圖清單 (Pending)**：
  - 即時篩選出尚未落盤的單字清單。
  - 按鈕直接顯示剩餘待補數量（例如目前 Part 2 僅剩 879 詞）。
* 🟢 **已完工檢視 (Completed)**：
  - 檢視所有已驗證完工的單字卡片與生成成果。

### 2. 五大題庫切換與逆向錯開 (Tier & Sorting)
* **五大分級題庫**：
  * 🔥 高頻核心 1200 (`core-1200`)
  * 💼 商務進階 2500 (`advanced-2500`)
  * 🚀 滿分巔峰 Part 1 (`expert-high-part1`)
  * 🚀 滿分巔峰 Part 2 (`expert-high-part2`)
  * 🚀 滿分巔峰 Part 3 (`expert-high-part3`)
* **錯開排序模式**：
  * `A ➔ Z 正序`：標準檢視。
  * `Z ➔ A 逆序`：適合外出使用手機手動生圖時，與本機背景自動管線（A ➔ Z）**雙向對開、兩端合圍**，絕不撞題重複花費。

### 3. 工作台專注檢視區 (Workbench)
點擊左側任一單字卡片，右側工作區即時展開完整資訊：
* **單字標題與詞性**（Headword & Parts of Speech）。
* **多益情境中譯**（繁體中文精確定義）。
* **產業領域主題標籤**（如：半導體晶圓、航太國防採購、綠能永續等）。
* **多益具象考點句**（字體放大 2 號 + 專屬情境中文翻譯）。
* **🎨 1:1 發光看板概念插畫 Prompt**：
  - 顯示 100% 符合 user-approved 的 v4 故事板提示詞。
  - 提供 **「📋 複製生圖 Prompt」** 一鍵複製至剪貼簿。

### 4. 剪貼簿極速貼圖與打包 (Paste Zone & ZIP Export)
* **`Ctrl + V` 瞬貼**：在 Gemini 網頁版產出圖後，右鍵複製圖片，切回本頁直接按 `Ctrl + V`（或手機長按貼上），即可將圖片綁定該單字。
* **即時預覽與跳題**：支援載入預覽，提供 `💾 下載此單圖` 或 `⏩ 換下一題`。
* **📦 一鍵打包下載 ZIP**：外出貼上的暫存圖片，點擊頂部按鈕即可整批打包下載為標準命名的 ZIP 檔（如 `words_export.zip`），回本機直接解壓縮至 `public/assets/images/words/` 即可完成落盤！

### 5. 雲端雙向打勾同步 (Supabase Sync)
* 與 Supabase `studio_images` 資料表即時連線。
* 當本機 GCP 自動管線每產出一張圖，便發送 ~150 bytes 輕量文字打勾，包含：
  - 完工時間戳（`completedAt`，例如 `2026-09-11 08:21:50`）。
  - 產出來源標記（`🤖 GCP 自動管線` 或 `🌐 Web 手動上傳`）。
* 外出打開手機版 Portable Studio，點擊 **「🔄 刷新雲端進度」** 即可與本機即時對齊進度。

---

## 🛠️ 開發與同步操作指南 (Workflow)

### 1. 如何更新伴侶程式內的題庫與圖片標記？
當本機執行完生圖任務或更新了提示詞，只需執行專屬同步腳本：
```bash
python scripts/sync_portable_dataset.py
```
此腳本會自動完成：
1. 讀取 `public/data/v1/courses/course-*.json` 最新 v4 提示詞。
2. 掃描 `public/assets/images/words/` 檢查磁碟 WebP 圖片。
3. 自動建立連字號與底線相容別名（如 `warm-up.webp` ⇄ `warm_up.webp`）。
4. 自動注入更新 `public/portable_studio.html` 與 `dist/portable_studio.html` 內嵌的 `DATASET`。

### 2. 如何發布更新至線上版？
```bash
# 1. 建置前端打包
cmd.exe /c "npm run build"

# 2. 推送至 GitHub 觸發 Vercel 自動部署
git add public/portable_studio.html dist/portable_studio.html
git commit -m "feat(studio): sync latest dataset and image status"
git push origin main
```
約 30 秒後，線上網址 [https://toeic-vocab-pwa-delta.vercel.app/portable_studio.html](https://toeic-vocab-pwa-delta.vercel.app/portable_studio.html) 即會更新為最新狀態。

---

## 📁 技術規格清單

| 項目 | 規格細節 |
| :--- | :--- |
| **檔案型態** | 單一自主靜態 HTML 檔案（Zero Build Step） |
| **前端樣式** | Tailwind CSS (via CDN) + 暗色沉浸式主題 (Dark Theme) |
| **ZIP 壓縮引擎** | JSZip v3.10.1 (via CDN) |
| **雲端中繼庫** | Supabase JS Client v2 (匿名 Key 安全讀取) |
| **圖檔相容性** | 優先載入本地 WebP，支援 Base64 快取與雲端圖片代理 |
| **內嵌資料量** | 10,071+ 筆完整多益詞彙、例句、v4 Prompt 與出圖狀態 |
| **相容裝置** | 桌面 Chrome/Safari/Edge、iPhone Safari (PWA)、Android Chrome |
