# 第三方資料來源與授權聲明 (Third Party Notices & Licenses)

本專案「TOEIC 速記 PWA」遵循開源與開放資料之授權規定，所使用的資料集與開放原始碼組件說明如下：

---

## 1. 單字資料集來源 (Vocabulary Dataset)

- **資料集名稱**：`toeic-vocab-tw`
- **作者 / 組織**：kknono668
- **原始來源**：[https://huggingface.co/datasets/kknono668/toeic-vocab-tw](https://huggingface.co/datasets/kknono668/toeic-vocab-tw)
- **授權條款**：[Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/)
- **清洗與轉換說明**：
  - 本應用程式透過 ETL 腳本對原始資料進行 Unicode 正規化、去除前後空白與重複詞條。
  - 對單字進行 `word`、`phrase`、`pattern` 詞條分類標註。
  - 根據 TOEIC 分數區間（如 550+、750+、860+、900+、990+）與星級進行課程模組切分，以支援漸進式離線下載與 FSRS 間隔重複排程。
  - 保留所有原始定義與例句內容，並未竄改原始語意。

---

## 2. 演算法與核心套件授權 (Core Libraries & Algorithms)

- **FSRS (Free Spaced Repetition Scheduler)**:
  - 套件：`ts-fsrs`
  - 授權：MIT License
  - 說明：採用現代化 DSR（Difficulty, Stability, Retrievability）記憶模型進行個人化複習時間排程。

- **Dexie.js**:
  - 套件：`dexie`, `dexie-react-hooks`
  - 授權：Apache License 2.0
  - 說明：瀏覽器本機 IndexedDB 儲存封裝。

- **React, Vite, Tailwind CSS, Lucide Icons, Framer Motion**:
  - 各套件均採 MIT 或相容開源授權發布。

---

## 3. 商標與聲明免責 (Disclaimer)

- 「TOEIC」為 Educational Testing Service (ETS) 在美國及其他國家/地區的註冊商標。
- 本應用程式為獨立開發之開源學習工具，非由 ETS 官方贊助、認可或附屬。
- 詞條難度星級與分數區間係由開源資料集作者提供並供學習分級參考，非 ETS 官方標準。
