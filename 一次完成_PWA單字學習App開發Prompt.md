# ChatGPT 一次完成 PWA 單字學習 App：完整開發 Prompt

將本文件中「開始 Prompt」至「結束 Prompt」的全部內容，一次貼給具備程式碼工作區與終端機操作能力的 ChatGPT／Codex。若工作區已有舊專案，先附上或開啟該專案；若沒有，模型應從空目錄建立。

---

## 開始 Prompt

你是一位資深全端工程師、PWA 架構師、iOS WebKit 相容性工程師與測試工程師。請直接在目前工作區中，從零建立並驗證一個可部署、可安裝於 iPhone 主畫面、可離線使用的繁體中文 TOEIC 單字學習 PWA。

這不是只要架構建議或程式碼片段。你必須實際建立完整專案、安裝依賴、完成所有必要檔案、執行資料轉換、型別檢查、測試及 production build，修正錯誤後才交付。禁止留下 `TODO`、假資料 API、未實作函式、`throw new Error("not implemented")`、省略號或要求我自行補齊關鍵程式。

### 1. 專案目標與使用情境

- 使用者為一位教師與 3 位使用 iPhone 的學生。
- 第一版以自用及小規模教育用途為主。
- 三位學生通常使用各自的 iPhone，因此本機紀錄必須互不影響。
- 沒有強制跨裝置同步需求，但架構必須支援可選的 Supabase 同步。
- 即使完全沒有設定 Supabase，App 仍須完整可用，不得卡在登入畫面。
- 預設採 `local-only` 模式；設定 Supabase 環境變數後自動啟用 `cloud-sync` 模式。
- UI、錯誤訊息、安裝引導與說明文字使用繁體中文；程式碼識別字與註解使用英文。
- 不複製任何既有商業 App 的名稱、商標、圖片或像素級介面，只實作通用的快速瀏覽、主動回想與間隔重複學習流程。

### 2. 不可違反的工程原則

1. Local-first：每次評分先原子性寫入 IndexedDB，UI 立即前進；雲端同步不可阻塞翻卡。
2. 離線完整可用：已下載課程、FSRS 排程、統計、設定、備份功能在離線時都可運作。
3. 資料隔離：
   - local-only 模式以裝置內的 `localProfileId` 分隔資料。
   - 不同 iPhone 的瀏覽器儲存天然獨立。
   - 同一裝置若建立多個本機學生，也必須透過 `profileId` 隔離進度。
   - cloud-sync 模式使用 Supabase Auth UUID 與 RLS，任何學生不能讀寫其他學生紀錄。
4. 無資料遺失誇大：不得宣稱瀏覽器儲存「保證永不被清除」。必須提供 JSON 備份匯出／匯入；若啟用雲端，才提供跨裝置還原。
5. 不把完整單字 JSON import 進 JavaScript bundle。資料必須在 build 前清洗並切成靜態課程檔，由前端按需 fetch，之後寫入 Dexie。
6. 不預先打包大量 MP3 或圖片。發音預設使用 Web Speech API；若資料有合法遠端 audio URL，可嘗試播放並在失敗時退回語音合成。
7. 不承諾繞過 iOS autoplay。學習開始按鈕必須作為使用者手勢以解鎖音訊；播放失敗時顯示可重試的音訊按鈕，但不得阻斷學習。
8. 使用實際安裝版本的 `ts-fsrs` 型別與公開 API 實作，不可憑舊版印象假設 API。
9. 所有日期持久化為 UTC ISO 8601；畫面依裝置本地時區顯示與計算「今日」。
10. 所有複習 log 使用 client-generated UUID，雲端欄位有唯一約束，讓重試具 idempotency。

### 3. 技術堆疊

- Node.js 20 或 22 LTS。
- Vite + React + strict TypeScript。
- React Router。
- Tailwind CSS；可自行建立少量無依賴 UI primitives，不強制安裝完整元件庫。
- Framer Motion／Motion for React，用於卡片翻面與手勢。
- Dexie.js，封裝 IndexedDB。
- `ts-fsrs`，實作 FSRS 排程。
- `vite-plugin-pwa`，使用 Workbox。
- Zod，用於匯入資料、資料集與備份 runtime validation。
- Vitest + React Testing Library。
- Supabase JavaScript client 僅作為可選功能。
- ESLint + Prettier。

請使用目前相容的穩定版本，不要盲目固定已過時版本。完成後提交 lockfile。

### 4. 專案模式與環境變數

建立 `.env.example`：

```env
VITE_APP_NAME=TOEIC 速記
VITE_ENABLE_CLOUD_SYNC=false
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_DATASET_VERSION=1
```

規則：

- `VITE_ENABLE_CLOUD_SYNC !== "true"` 或 Supabase URL/key 缺少時，安全地使用 local-only 模式。
- 不可把 service role key 放進前端。
- Cloud 模式提供 email magic link 或 email/password 登入；選擇較容易在本機測試且 Supabase 支援良好的方式。
- Auth callback、登出與 session restore 都要處理。
- 沒啟用 Cloud 時不發出 Supabase 網路請求。

### 5. 單字資料來源與 ETL

主要資料來源為 Hugging Face dataset：

`https://huggingface.co/datasets/kknono668/toeic-vocab-tw`

其授權為 CC BY-SA 4.0。請建立 `THIRD_PARTY_NOTICES.md` 與 App 內「資料來源與授權」頁面，標註資料集名稱、作者／repository、連結、CC BY-SA 4.0 連結、是否經過清洗與格式轉換。不得移除 attribution。

不要讓 production build 依賴建置當下可連線到 Hugging Face。實作：

- `scripts/download-dataset.mjs`：明確執行時才下載原始 JSON；支援 `--input <local-json>` 使用本機檔案。
- `scripts/build-dataset.mjs`：清洗、驗證、去重並產生靜態資料。
- 若工作區沒有原始 dataset 且下載因網路限制失敗，建立小型且明確標記為 demo 的合法 seed dataset，讓 App 與測試仍可完整運作；README 必須清楚說明如何替換成正式資料，不能假裝 demo 是完整資料。

清洗規則：

- 正規化前後空白與 Unicode。
- 以 normalized lowercase headword + entry type 去除完全重複資料。
- 保留單字、片語、句型，不要全部錯當單字。
- `entryType` 為 `word | phrase | pattern`；判斷結果可由 ETL 產生並允許人工覆寫。
- 每一筆有穩定 deterministic ID，資料重新建置時不因排序改變而改 ID。
- 驗證繁中定義、星級 1–5、分數區間、例句陣列、分類及詞性。
- 不得自行把作者提供的星級或 TOEIC 分數區間描述為官方 TOEIC 標準。
- 缺少音標時允許為 null；不要用不可靠方式捏造 IPA。
- 產生 QA report：總筆數、去重數、缺少定義、缺少例句、各類別／星級／分數區間數量與被拒絕資料範例。

輸出到：

```text
public/data/v1/manifest.json
public/data/v1/catalog.json
public/data/v1/courses/<course-id>.json
public/data/v1/qa-report.json
```

課程可依 `toeic_score_range` 建立主要分級，並提供分類篩選。每個課程 JSON 避免過大；必要時再分成 page/chunk，manifest 記錄 checksum、筆數與檔案路徑。所有 JSON 由 Zod schema 驗證。

建立 app types，至少包含：

```ts
type EntryType = 'word' | 'phrase' | 'pattern';

interface WordEntry {
  id: string;
  headword: string;
  normalizedHeadword: string;
  entryType: EntryType;
  definitionZh: string;
  starRating: 1 | 2 | 3 | 4 | 5;
  toeicScoreRange: string;
  category: string;
  partsOfSpeech: string[];
  wordForms: Array<{ partOfSpeech: string; forms: string[] }>;
  phoneticUS: string | null;
  phoneticUK: string | null;
  examples: Array<{ id: string; english: string; chinese: string }>;
  examTips: string[];
  audioUSUrl: string | null;
  audioUKUrl: string | null;
}
```

不要把 `courseId` 固定放進 word 主體來限制一對一關係；以 course manifest／course-word membership 表達同一詞條可屬於多門課。

### 6. Dexie 本機資料庫

建立版本化 Dexie database，至少包含：

- `profiles`
- `courses`
- `words`
- `courseWords`
- `progress`
- `reviewLogs`
- `dailyStats`
- `appSettings`
- `syncQueue`
- `datasetMeta`

必要索引：

- progress：複合主鍵或唯一鍵 `[profileId+wordId]`、`[profileId+due]`、`[profileId+state]`
- reviewLogs：`id`、`[profileId+reviewedAt]`、`syncStatus`
- courseWords：`[courseId+wordId]`、`[courseId+orderIndex]`
- syncQueue：`id`、`status`、`nextAttemptAt`

所有 profile-specific row 必須包含 `profileId`。建立 repository/service layer，React component 不直接散落 Dexie query。

評分交易必須在同一個 Dexie transaction 中：

1. 寫入新的 FSRS progress。
2. 寫入 immutable review log。
3. 更新 daily stats。
4. cloud 模式時加入 sync queue。

若任何一步失敗，整筆 rollback，畫面顯示可恢復錯誤，不可跳到下一張。

### 7. 學生身分與紀錄隔離

local-only 首次啟動：

- 顯示建立本機學生資料頁，只需暱稱與可選每日目標。
- 產生 UUID `localProfileId`。
- 預設同一裝置只使用一個 profile，但設定頁可建立／切換／刪除多個本機 profile。
- 刪除 profile 前要求明確確認，並先提供匯出備份。
- profile chooser 不可洩漏其他 profile 的複習內容。

cloud-sync 模式：

- 登入後以 `auth.uid()` 作為 cloud user ID。
- 建立明確的 local profile ↔ cloud user 綁定流程。
- 首次綁定前顯示「上傳本機紀錄」或「以雲端紀錄取代」選擇，禁止默默覆寫。
- 正常同步採 deterministic merge：review log 依 UUID union；progress 由最新合法 review 序列／revision 決定，不可只用模糊的 last-write-wins 造成回退。
- 若完整 replay 太複雜，可指定單一裝置為當前 writer，遇到 revision conflict 停止該 word 的同步並提示使用者解決；不可靜默遺失資料。

### 8. FSRS 排程服務

封裝 `ts-fsrs`，不要在 UI component 內直接操作套件。

至少提供：

- `createInitialProgress(profileId, wordId, now)`
- `previewRatings(progress, now)`：回傳 Again/Hard/Good/Easy 四種預估 due 與人類可讀 interval。
- `review(progress, rating, now, durationMs)`：回傳 updated progress 與 immutable log。
- `getRetrievability(progress, now)`，若目前套件支援。

Rating 映射固定：1 Again、2 Hard、3 Good、4 Easy。保存 scheduler/version 訊息，以免未來升級套件後無法解釋舊資料。測試至少涵蓋：new card、四種 rating、逾期 review、連續 Again、UTC serialization、interval preview 不修改原 progress。

### 9. 核心學習流程

建立以下頁面：

1. Onboarding／本機學生建立或登入。
2. Dashboard：今日到期、今日新字目標、連續學習天數、課程入口、弱點／收藏。
3. Course Catalog：分數區間、分類、星級、單字／片語篩選；顯示是否已下載。
4. Fast Skim：快速瀏覽新字。
5. Flashcard Review：主動回想與四級評分。
6. Statistics：今日與近 7/30 日新學、複習、Again 比例、時長。
7. Settings：發音、快速瀏覽秒數、每日目標、保留率、資料下載管理、備份、雲端同步狀態、授權資訊。

Fast Skim：

- 預設每張 4 秒，可在 3–10 秒調整。
- 顯示 headword、entry type、音標（存在才顯示）、繁中解釋、第一例句、進度。
- 支援暫停、上一張、下一張、重新發音。
- 啟動必須由按鈕手勢觸發，以便嘗試音訊解鎖。
- `prefers-reduced-motion` 時停用大幅動畫。
- 倒數不可因頁面進背景後一次跳過多張；visibility 恢復時安全暫停或重算。

Flashcard：

- 正面顯示 headword、entry type、音訊按鈕；可選擇是否顯示圖像，不依賴圖片才能使用。
- 點擊翻面後顯示解釋、詞性、例句、考試提示。
- 尚未翻面前四級評分按鈕 disabled，避免誤觸。
- 四個按鈕顯示即時計算的 interval preview。
- 可滑動，但不要使用容易誤判的「左 Again／右 Good」作為唯一操作；滑動跨越門檻後仍給明確視覺提示，四按鈕永遠可用。
- Bottom controls 適應 `safe-area-inset-bottom`。
- 每張卡記錄從顯示到評分的 duration，visibility hidden 時不要累計背景時間。

### 10. 音訊

建立 AudioService singleton 與 React hook：

- 第一次「開始學習」手勢中初始化／resume AudioContext，播放極短 silent buffer。
- 遠端 audio URL 存在時可用 HTMLAudioElement 播放；處理 timeout、abort、network、NotAllowedError。
- 遠端失敗或 URL 不存在時用 `speechSynthesis`，語言 `en-US` 或 `en-GB`。
- voice 清單可能延遲載入，監聽 `voiceschanged`。
- 使用者快速切卡時停止上一段發音，避免重疊。
- 提供 mute、自動播放與 US/UK 偏好。
- 自動播放失敗不能重複彈出錯誤；顯示非阻斷提示與手動播放按鈕。
- 不聲稱能百分之百繞過 Safari autoplay。

### 11. PWA、iPhone 與快取

- 正確設定 `viewport-fit=cover`、standalone manifest、Apple touch icon 與 theme color。
- 使用 `100dvh`，並提供不支援時的 fallback；處理 safe area。
- 避免全頁 rubber-band 影響卡片，但不要破壞需要捲動的內容頁與 accessibility。
- 偵測 iOS Safari 且非 standalone，顯示可關閉的「分享 → 加入主畫面」教學。
- App shell precache；大型課程 JSON 不全部 precache。
- 靜態 dataset 使用 Cache First 或 Stale While Revalidate，檔名／manifest 有版本。
- navigation fallback 不可攔截 dataset JSON、icons 或非導覽請求。
- 新版 Service Worker 準備好時顯示「有新版本，重新載入」提示；不要在學生評分途中強制 reload。
- activate 時清理舊版 app cache，但不可清除 IndexedDB 學習紀錄。
- 使用 `navigator.storage.estimate()` 顯示估算用量；在使用者互動後可呼叫 `navigator.storage.persist()`，並如實顯示瀏覽器是否批准。
- 不寫死「iOS 50 MB 上限」等不正確假設。

### 12. 課程下載與離線管理

- catalog 很小，可啟動時取得。
- 點選課程後才下載對應 chunk，驗證 schema、version、checksum，再以 transaction 寫入 Dexie。
- 顯示下載大小／筆數／進度與取消。
- 中斷後可安全重試，不留下被視為完成的半套課程。
- 可刪除某課程的靜態 word cache，但若已有 progress/review log，不得刪除學習紀錄；重新下載後能恢復狀態。
- dataset 升版時使用 stable word IDs migration；顯示新增、修改、移除數量。對已移除但有歷史的 word 保留 tombstone metadata。

### 13. 備份與還原（local-only 必做）

建立版本化 JSON 備份：

- 匯出目前 profile 的設定、progress、review logs、daily stats、dataset version 與匯出時間。
- 預設不包含整套公開單字內容，避免檔案過大；只保存 word stable IDs 與必要 snapshot。
- 以 Zod 驗證匯入檔、schema version 與 profile ownership。
- 匯入前顯示摘要與衝突策略：新增、合併、取代。
- 取代屬破壞操作，必須再次確認並自動先產生目前資料備份。
- 提供 Web Share API／下載檔案；不支援 Web Share 時正常 fallback。
- 建立 migration framework，未來備份 schema 升版可轉換。

### 14. 可選 Supabase 後端

建立 `supabase/migrations/0001_initial.sql`，至少包含：

- `profiles`
- `user_word_progress`
- `review_logs`
- `user_settings`
- `sync_devices`

公開 dataset 維持靜態 JSON，不必複製到 PostgreSQL。必要規則：

- 所有 user tables 的 `user_id uuid not null references auth.users(id) on delete cascade`。
- RLS 全部啟用。
- SELECT/INSERT/UPDATE/DELETE policy 都以 `auth.uid() = user_id` 限制。
- INSERT policy 使用 `with check`，UPDATE 同時使用 `using` 與 `with check`。
- `review_logs.id` 為 client UUID primary key，重送用 `on conflict do nothing`。
- progress 唯一鍵 `(user_id, word_id)`，加入 `(user_id, due)` index。
- 權限只給 authenticated 所需操作。
- 不信任 client 傳入其他 `user_id`。

SyncEngine：

- App 啟動、登入、`online`、回到前景及 review 完成後節流觸發。
- 指數退避加 jitter，記錄 attempts、lastError、nextAttemptAt。
- 批次有上限。
- 網路狀態只能作提示，實際仍捕捉 request failure。
- 同步完成才將 queue item 標記完成／刪除。
- 提供同步狀態 UI：本機已保存、待同步筆數、最後成功時間、錯誤與重試。
- 不依賴 iOS 在 App 關閉後執行 Background Sync。

### 15. 教師使用需求

第一版不要建立可窺視所有學生資料的隱藏管理帳號。提供兩種安全方式：

- 學生從自己的設定頁匯出「學習摘要 JSON」或分享摘要文字給教師。
- 未來若需教師 dashboard，再以明確 consent 與獨立 teacher_student_grants 資料模型擴充。

目前至少實作可分享摘要：profile display name、日期範圍、完成新字數、複習數、正確／Again 比例、學習秒數、最常 Again 的前 20 個 word IDs/headwords。不得包含 email、token 或內部認證資料。

### 16. UI 與無障礙

- 以 iPhone 直向優先，亦需支援桌面與橫向。
- 視覺簡潔、字級清楚、觸控目標至少約 44×44 CSS px。
- color 不能是唯一狀態提示；按鈕同時有文字／icon／aria-label。
- 卡片翻面支援鍵盤；Again/Hard/Good/Easy 提供鍵盤快捷鍵 1–4。
- 適當 aria-live 宣告卡片切換與同步狀態，避免過度朗讀。
- 支援 dark mode 與 reduced motion。
- 空狀態、載入、離線、錯誤、資料損壞、無到期卡片都要有完整 UI。

### 17. 建議目錄

可以合理調整，但至少維持清楚分層：

```text
scripts/
public/data/
src/
  app/
  components/
  db/
  hooks/
  pages/
  repositories/
  services/
  styles/
  types/
  utils/
  validation/
supabase/migrations/
tests/
```

### 18. 測試與驗證

至少完成並實際執行：

- ETL unit tests：normalization、stable ID、dedupe、entry type、invalid row。
- FSRS unit tests。
- Dexie tests：profile isolation、評分 transaction、due query、備份 merge。
- Sync unit tests：idempotent retry、offline queue、401/session expiry、conflict。
- React component tests：先翻面才能評分、四按鈕、Fast Skim pause、安裝提示。
- 至少一條完整流程整合測試：建立 profile → 下載 demo course → skim → review → reload → progress 仍存在 → export backup。
- `npm run lint`
- `npm run typecheck`
- `npm run test -- --run` 或等效命令
- `npm run build`

若瀏覽器 E2E 工具可用，再增加 Playwright mobile viewport 測試；若環境不允許 Safari/WebKit 執行，README 明確列出 iPhone 實機驗收步驟，不得假裝已測過實機。

### 19. iPhone 實機驗收清單

在 README 列出：

- Safari 開啟、加入主畫面、standalone 啟動。
- 音訊首次手勢、連續切卡、靜音與失敗 fallback。
- 飛航模式下啟動已下載課程與評分。
- 關閉並重開 PWA 後進度保留。
- 三台 iPhone 使用相同網址但各自建立 profile，紀錄不互相出現。
- 清除網站資料的風險與備份還原。
- Service Worker 有新版時不在評分途中強制更新。
- Dynamic Island、Home Indicator、較小螢幕與字體放大。

### 20. 文件與 scripts

README 必須包含：

- 功能與架構摘要。
- 從零安裝及本機開發指令。
- 正式 dataset 下載／本機匯入／清洗指令。
- local-only 部署方式。
- Cloudflare Pages、Vercel 或 GitHub Pages 至少一種靜態部署方式；若支援子路徑，處理 Vite base path。
- Supabase migration 與環境變數設定。
- 三位學生如何各自建立帳號／本機 profile。
- 資料備份與還原。
- dataset 更新流程。
- iPhone 實機驗收。
- 已知平台限制，不使用「保證」「100%」等不實措辭。

`package.json` scripts 至少有：

```text
dev
build
preview
lint
typecheck
test
format
data:download
data:build
data:qa
```

### 21. 執行方式

請遵循以下順序直接工作，不要在每個階段等待我批准：

1. 檢查工作區與現有檔案；保留無關的使用者內容。
2. 若是空目錄，初始化專案。
3. 建立資料模型、ETL 與 demo／正式資料匯入流程。
4. 建立 Dexie、FSRS、備份及可選 Supabase sync。
5. 建立完整頁面與 PWA。
6. 安裝依賴並持續執行型別檢查與測試。
7. 執行 production build，修到通過。
8. 檢查 bundle：確認完整 dataset 沒被打進主要 JS chunk，大型 JSON 是獨立靜態資源。
9. 最後才回覆結果。

允許你在遇到套件實際 API 與本規格不一致時，依安裝版本的官方型別作必要調整；但不可刪除需求來迴避錯誤。若某項功能受瀏覽器客觀限制，實作可靠 fallback，並在 README 如實記錄。

### 22. 最終回覆格式

完成後只需清楚回報：

- 已完成的核心功能。
- local-only 與 cloud-sync 如何切換。
- 實際執行過的 lint、typecheck、test、build 結果。
- 正式資料集是否成功匯入；若只能使用 demo，給出一條可執行的正式匯入命令。
- 專案主要入口與 README 路徑。
- 尚需人工完成的外部設定，例如 Supabase project URL 或正式部署帳號。
- 未能在環境中驗證的 iPhone 實機項目。

不要在最終回覆貼出所有檔案全文，因為檔案應已實際存在於工作區。

## 結束 Prompt

