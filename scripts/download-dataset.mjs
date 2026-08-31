#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const RAW_DATA_DIR = path.join(ROOT_DIR, 'data-raw');
const OUTPUT_FILE = path.join(RAW_DATA_DIR, 'toeic_vocabulary.json');

const HF_PRIMARY_URL = 'https://huggingface.co/datasets/kknono668/toeic-vocab-tw/resolve/main/toeic_vocabulary.json';
const HF_SECONDARY_URL = 'https://huggingface.co/datasets/kknono668/toeic-vocab-tw/resolve/main/data/toeic_vocabulary.json';

// Minimal legal demo seed dataset for offline fallback
const DEMO_SEED_DATA = [
  {
    english_word: "accommodate",
    chinese_definition: "容納；提供住宿；配合，適應",
    star_rating: 4,
    toeic_score_range: "600-780",
    category: "商務差旅",
    parts_of_speech: ["verb"],
    word_forms: [
      { part_of_speech: "verb", forms: ["accommodate", "accommodates", "accommodating", "accommodated"] },
      { part_of_speech: "noun", forms: ["accommodation", "accommodations"] }
    ],
    examples: [
      { english: "The conference hall can accommodate up to 500 attendees.", chinese: "該會議廳最多可容納 500 位與會者。" },
      { english: "We will do our best to accommodate your special requests.", chinese: "我們將盡最大努力配合您的特殊要求。" }
    ],
    exam_tips: [
      "常考雙重涵義：第一為物理空間『容納』，第二為商務協商『滿足/配合需求』(accommodate one's request)。",
      "名詞形式 accommodation 常以複數形式 accommodations 表示『住宿』。"
    ]
  },
  {
    english_word: "agenda",
    chinese_definition: "議程；待議事項",
    star_rating: 5,
    toeic_score_range: "400-600",
    category: "商務會議",
    parts_of_speech: ["noun"],
    word_forms: [
      { part_of_speech: "noun", forms: ["agenda", "agendas"] }
    ],
    examples: [
      { english: "The next item on the agenda is the quarterly budget review.", chinese: "議程上的下一項是季度預算審查。" },
      { english: "Please send any agenda additions before noon tomorrow.", chinese: "若有任何議程增補，請於明天中午前送出。" }
    ],
    exam_tips: [
      "常見片語：on the agenda (在議程上)、set the agenda (訂定議程)。",
      "聽力第三、四部分常出現會議開頭的主持人陳述。"
    ]
  },
  {
    english_word: "look forward to",
    chinese_definition: "期待，盼望",
    star_rating: 5,
    toeic_score_range: "400-600",
    category: "商務書信",
    parts_of_speech: ["phrase"],
    word_forms: [
      { part_of_speech: "phrase", forms: ["look forward to", "looks forward to", "looking forward to", "looked forward to"] }
    ],
    examples: [
      { english: "We look forward to hearing from you soon.", chinese: "我們期待盡快收到您的回信。" },
      { english: "I am looking forward to working with your team on this project.", chinese: "我非常期待在這個專案中與您的團隊合作。" }
    ],
    exam_tips: [
      "文法關鍵考點：to 為介系詞，後方必須接動名詞 (V-ing) 或名詞，不可接原形動詞！",
      "商務 Email 信末結尾最常見客套語。"
    ]
  },
  {
    english_word: "be eligible for",
    chinese_definition: "有資格獲得；符合...條件",
    star_rating: 4,
    toeic_score_range: "600-780",
    category: "人力資源",
    parts_of_speech: ["phrase"],
    word_forms: [
      { part_of_speech: "phrase", forms: ["be eligible for", "is eligible for", "are eligible for", "was eligible for"] }
    ],
    examples: [
      { english: "Full-time employees are eligible for annual bonuses and health insurance.", chinese: "全職員工有資格獲得年終獎金與健康保險。" }
    ],
    exam_tips: [
      "搭配介系詞：be eligible for + 名詞；be eligible to + 原形動詞 (be eligible to receive).",
      "在員工手冊與福利公告中出現頻率極高。"
    ]
  },
  {
    english_word: "feasibility",
    chinese_definition: "可行性",
    star_rating: 4,
    toeic_score_range: "780-900",
    category: "專案企劃",
    parts_of_speech: ["noun"],
    word_forms: [
      { part_of_speech: "noun", forms: ["feasibility"] },
      { part_of_speech: "adjective", forms: ["feasible"] }
    ],
    examples: [
      { english: "We need to conduct a feasibility study before securing investors.", chinese: "在尋求投資者之前，我們需要進行可行性研究。" }
    ],
    exam_tips: [
      "固定搭配：feasibility study (可行性評估/報告)。",
      "形容詞 feasible 常與 workable 或 viable 互相 Paraphrase。"
    ]
  },
  {
    english_word: "reimburse",
    chinese_definition: "核銷；退還；償還款項",
    star_rating: 5,
    toeic_score_range: "600-780",
    category: "財務會計",
    parts_of_speech: ["verb"],
    word_forms: [
      { part_of_speech: "verb", forms: ["reimburse", "reimburses", "reimbursing", "reimbursed"] },
      { part_of_speech: "noun", forms: ["reimbursement"] }
    ],
    examples: [
      { english: "The company will reimburse travel expenses if receipts are submitted within 14 days.", chinese: "若於 14 天內提交收據，公司將核銷差旅費用。" }
    ],
    exam_tips: [
      "常考名詞 reimbursement (費用核銷)，與 receipt (收據)、expense report (支出報告) 一同出現在 Part 7 內部備忘錄。"
    ]
  }
];

// CLI arguments parsing
const args = process.argv.slice(2);
let inputPath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--input' && args[i + 1]) {
    inputPath = path.resolve(process.cwd(), args[i + 1]);
    i++;
  }
}

async function downloadDataset() {
  if (!fs.existsSync(RAW_DATA_DIR)) {
    fs.mkdirSync(RAW_DATA_DIR, { recursive: true });
  }

  if (inputPath) {
    console.log(`[ETL] Using specified local input file: ${inputPath}`);
    if (!fs.existsSync(inputPath)) {
      console.error(`[ETL] Error: Local file not found: ${inputPath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(inputPath, 'utf8');
    fs.writeFileSync(OUTPUT_FILE, content, 'utf8');
    console.log(`[ETL] Copied local dataset to ${OUTPUT_FILE}`);
    return;
  }

  console.log(`[ETL] Downloading dataset from Hugging Face (${HF_PRIMARY_URL})...`);
  try {
    const res = await fetch(HF_PRIMARY_URL, {
      headers: { 'User-Agent': 'TOEIC-Vocab-PWA-ETL/1.0' }
    });

    if (!res.ok) {
      console.warn(`[ETL] Primary URL returned HTTP ${res.status}, trying fallback URL...`);
      const res2 = await fetch(HF_SECONDARY_URL, {
        headers: { 'User-Agent': 'TOEIC-Vocab-PWA-ETL/1.0' }
      });
      if (!res2.ok) {
        throw new Error(`Failed to fetch dataset from secondary URL: HTTP ${res2.status}`);
      }
      const data = await res2.text();
      fs.writeFileSync(OUTPUT_FILE, data, 'utf8');
      console.log(`[ETL] Downloaded dataset successfully to ${OUTPUT_FILE} (${data.length} bytes)`);
      return;
    }

    const data = await res.text();
    fs.writeFileSync(OUTPUT_FILE, data, 'utf8');
    console.log(`[ETL] Downloaded dataset successfully to ${OUTPUT_FILE} (${data.length} bytes)`);
  } catch (error) {
    console.warn(`[ETL] Remote download failed: ${error.message}`);
    if (fs.existsSync(OUTPUT_FILE)) {
      console.log(`[ETL] Existing local dataset file found at ${OUTPUT_FILE}, proceeding with existing data.`);
      return;
    }
    console.warn(`[ETL] Creating fallback demo seed dataset with ${DEMO_SEED_DATA.length} items at ${OUTPUT_FILE}`);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(DEMO_SEED_DATA, null, 2), 'utf8');
    console.warn(`[ETL] NOTICE: Fallback demo data created. Run 'npm run data:download' with an internet connection or '--input <path>' to build the full 11,000+ dataset.`);
  }
}

downloadDataset();
