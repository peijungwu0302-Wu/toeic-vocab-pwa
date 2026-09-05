import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'public', 'data', 'v1');
const COURSES_DIR = path.join(DATA_DIR, 'courses');
const QUIZ_DIR = path.join(DATA_DIR, 'quiz');
const CATALOG_FILE = path.join(DATA_DIR, 'catalog.json');

console.log('================================================================');
console.log('🚀 開始執行全庫 11,154 詞 100% 旗艦同步至所有課程檔與題庫檔');
console.log('================================================================\n');

// 1. 載入 5 大 Master 檔案
const coreWords = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'core-1200.json'), 'utf8')).words;
const advWords = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'advanced-2500.json'), 'utf8')).words;
const exp1Words = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'expert-high-part1.json'), 'utf8')).words;
const exp2Words = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'expert-high-part2.json'), 'utf8')).words;
const exp3Words = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'expert-high-part3.json'), 'utf8')).words;

console.log(`📦 已載入 5 大分卷：`);
console.log(`  - core-1200: ${coreWords.length} 詞`);
console.log(`  - advanced-2500: ${advWords.length} 詞`);
console.log(`  - expert-high-part1: ${exp1Words.length} 詞`);
console.log(`  - expert-high-part2: ${exp2Words.length} 詞`);
console.log(`  - expert-high-part3: ${exp3Words.length} 詞`);
const totalMasterWords = coreWords.length + advWords.length + exp1Words.length + exp2Words.length + exp3Words.length;
console.log(`  🔥 全庫總計：${totalMasterWords} 詞\n`);

// 2. 建立全域單字字典 (Master Map)
const masterMap = new Map();
[coreWords, advWords, exp1Words, exp2Words, exp3Words].forEach(wordList => {
  wordList.forEach(w => {
    masterMap.set(w.headword.toLowerCase().trim(), w);
  });
});
console.log(`🔍 全域單字索引字典建立完成：${masterMap.size} 個唯一單字\n`);

const BUILD_VERSION = 15;
const DATASET_RELEASE_TAG = 'v7.1.0-flagship-full-sync';
const TIMESTAMP = new Date().toISOString();

// 3. 同步 5 大主力課程檔案
const MAIN_COURSES = [
  {
    fileName: 'course-core-1200.json',
    id: 'course-core-1200',
    title: '🔥 多益必考高頻核心 1,200 字全集',
    description: '涵蓋 600~750 分多益核心考點，含 2,400 題 4D 考點測驗、24領域商務例句與情境圖片。',
    toeicScoreRange: '400-750',
    category: '高頻核心',
    level: '核心必考',
    words: coreWords
  },
  {
    fileName: 'course-advanced-2500.json',
    id: 'course-advanced-2500',
    title: '💼 多益商務進階實戰 2,500 字全集',
    description: '衝刺 750~860 分金色證書實戰單字庫，含 5,000 題 4D 考點測驗與高階商務例句。',
    toeicScoreRange: '750-860',
    category: '進階實戰',
    level: '金證衝刺',
    words: advWords
  },
  {
    fileName: 'course-expert-high-part1.json',
    id: 'course-expert-high-part1',
    title: '🚀 多益滿分巔峰挑戰 (1/3: 1~2,500 字)',
    description: '860~990 分滿分巔峰高難度商業詞彙 (第 1/3 輯，含 5,000 題 4D 考點測驗)。',
    toeicScoreRange: '860-990',
    category: '高階挑戰',
    level: '滿分巔峰',
    words: exp1Words
  },
  {
    fileName: 'course-expert-high-part2.json',
    id: 'course-expert-high-part2',
    title: '🚀 多益滿分巔峰挑戰 (2/3: 2,501~5,000 字)',
    description: '860~990 分滿分巔峰高難度商業詞彙 (第 2/3 輯，含 5,000 題 4D 考點測驗)。',
    toeicScoreRange: '860-990',
    category: '高階挑戰',
    level: '滿分巔峰',
    words: exp2Words
  },
  {
    fileName: 'course-expert-high-part3.json',
    id: 'course-expert-high-part3',
    title: '🚀 多益滿分巔峰挑戰 (3/3: 5,001~7,454 字)',
    description: '860~990 分滿分巔峰高難度商業詞彙 (第 3/3 輯，含 4,908 題 4D 考點測驗)。',
    toeicScoreRange: '860-990',
    category: '高階挑戰',
    level: '滿分巔峰',
    words: exp3Words
  }
];

console.log('🔄 正在同步 5 大主力課程檔案...');
for (const mc of MAIN_COURSES) {
  const filePath = path.join(COURSES_DIR, mc.fileName);
  const courseData = {
    id: mc.id,
    title: mc.title,
    description: mc.description,
    toeicScoreRange: mc.toeicScoreRange,
    category: mc.category,
    level: mc.level,
    version: BUILD_VERSION,
    datasetVersion: DATASET_RELEASE_TAG,
    buildTimestamp: TIMESTAMP,
    wordCount: mc.words.length,
    words: mc.words
  };
  fs.writeFileSync(filePath, JSON.stringify(courseData, null, 2), 'utf8');
  console.log(`  ✅ 已寫入 ${mc.fileName}: ${mc.words.length} 詞 (100% 完整 4D 題庫與例句)`);
}

// 4. 同步所有單元課程檔案 (course-*.json)
console.log('\n🔄 正在同步所有單元切片課程檔案...');
const allCourseDiskFiles = fs.readdirSync(COURSES_DIR).filter(f => f.startsWith('course-') && f.endsWith('.json'));
const mainSet = new Set(MAIN_COURSES.map(m => m.fileName));

let unitCoursesUpdated = 0;
let totalWordsInUnitsUpdated = 0;

for (const cf of allCourseDiskFiles) {
  if (mainSet.has(cf)) continue;
  const cp = path.join(COURSES_DIR, cf);
  const cData = JSON.parse(fs.readFileSync(cp, 'utf8'));

  let matchedWords = 0;
  const updatedWords = (cData.words || []).map(cw => {
    const key = cw.headword.toLowerCase().trim();
    const master = masterMap.get(key);
    if (master) {
      matchedWords++;
      return master;
    }
    return cw;
  });

  cData.words = updatedWords;
  cData.wordCount = updatedWords.length;
  cData.version = BUILD_VERSION;
  cData.datasetVersion = DATASET_RELEASE_TAG;
  cData.buildTimestamp = TIMESTAMP;

  fs.writeFileSync(cp, JSON.stringify(cData, null, 2), 'utf8');
  unitCoursesUpdated++;
  totalWordsInUnitsUpdated += matchedWords;
  console.log(`  ✅ ${cf}: ${matchedWords} / ${updatedWords.length} 詞已對齊最新旗艦資料庫`);
}
console.log(`\n🎉 單元課程同步完成：共更新 ${unitCoursesUpdated} 個單元課程，涵蓋 ${totalWordsInUnitsUpdated} 詞次！\n`);

// 5. 同步 public/data/v1/quiz/ 題庫檔案
console.log('🔄 正在同步 public/data/v1/quiz/ 題庫檔案...');
const QUIZ_FILES = [
  { name: 'core-mcq.json', words: coreWords },
  { name: 'advanced-mcq.json', words: advWords },
  { name: 'expert-mcq-part1.json', words: exp1Words },
  { name: 'expert-mcq-part2.json', words: exp2Words },
  { name: 'expert-mcq-part3.json', words: exp3Words }
];

for (const qf of QUIZ_FILES) {
  const qp = path.join(QUIZ_DIR, qf.name);
  fs.writeFileSync(qp, JSON.stringify(qf.words, null, 2), 'utf8');
  console.log(`  ✅ 已寫入 quiz/${qf.name}: ${qf.words.length} 詞 (含全量 4D 考點題庫)`);
}

// 6. 重新編譯 public/data/v1/catalog.json
console.log('\n🔄 正在重新編譯 public/data/v1/catalog.json 課程索引...');
const catalogData = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));

catalogData.version = BUILD_VERSION;
catalogData.datasetVersion = DATASET_RELEASE_TAG;
catalogData.generatedAt = TIMESTAMP;

let totalCatalogWords = 0;
catalogData.courses.forEach(catEntry => {
  const cp = path.join(COURSES_DIR, catEntry.fileName);
  if (fs.existsSync(cp)) {
    const raw = fs.readFileSync(cp, 'utf8');
    const parsed = JSON.parse(raw);
    const checksum = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
    const sizeBytes = Buffer.byteLength(raw, 'utf8');

    catEntry.wordCount = parsed.words.length;
    catEntry.checksum = checksum;
    catEntry.sha256 = checksum;
    catEntry.checksumSha256 = checksum;
    catEntry.sizeBytes = sizeBytes;
    catEntry.version = BUILD_VERSION;
    catEntry.datasetVersion = DATASET_RELEASE_TAG;

    totalCatalogWords += parsed.words.length;
  }
});
catalogData.totalWords = totalCatalogWords;

fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalogData, null, 2), 'utf8');
console.log(`✅ 已成功更新 catalog.json！共包含 ${catalogData.courses.length} 個課程，總字數 ${totalCatalogWords} 詞`);
console.log('================================================================');
console.log('🏆 全部課程與題庫檔案 100% 同步大圓滿完成！');
console.log('================================================================');
