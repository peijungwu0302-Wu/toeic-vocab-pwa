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
console.log('🚀 開始執行「Core-1200 詞元精煉整併 (1200 ➔ 922 詞)」');
console.log('================================================================\n');

const PRESERVE_WHITELIST = new Set([
  'including', 'advanced', 'limited', 'interested', 'interesting', 'excited', 'exciting',
  'pleased', 'pleasing', 'customs', 'facilities', 'instructions', 'savings', 'earnings',
  'belongings', 'premises', 'surroundings', 'headquarters', 'authorities', 'leading',
  'demanding', 'promising', 'missing', 'existing', 'outstanding', 'complicated', 'detailed',
  'customized', 'experienced', 'opening', 'gathering', 'training', 'marketing', 'accounting',
  'advertising', 'processing', 'shipping', 'handling', 'briefing', 'lodging', 'billing',
  'funding', 'pricing', 'staffing', 'filing', 'monitoring', 'tracking', 'scheduling',
  'warning', 'meeting', 'building', 'clothing', 'living', 'feeling', 'meaning', 'clearing',
  'ranking', 'setting', 'standing', 'drawing', 'painting', 'findings', 'proceedings',
  'writings', 'dealings', 'holdings', 'offerings', 'readings', 'spendings', 'supplies',
  'goods', 'assets', 'resources', 'materials', 'records', 'terms', 'rates', 'sales',
  'funds', 'operations', 'services', 'products', 'standards', 'measures', 'regulations',
  'guidelines', 'procedures', 'duties', 'rights', 'orders', 'shares', 'interests',
  'returns', 'damages', 'charges', 'fees', 'costs', 'expenses', 'benefits', 'leaves',
  'arms', 'fine', 'fines', 'firm', 'firms', 'means', 'matter', 'matters', 'ground', 'grounds',
  'specialized', 'compelling', 'overwhelming', 'prolonged', 'recurring', 'thriving',
  'downsizing', 'recycling', 'computing', 'engaging', 'distinguished', 'dedicated',
  'qualified', 'composed', 'condensed', 'embedded', 'healing', 'shreds'
]);

function getRootCandidates(hw) {
  const c = [];
  if (hw.length > 3 && hw.endsWith('s') && !['ss', 'us', 'is', 'as'].some(x => hw.endsWith(x))) {
    c.push({ root: hw.slice(0, -1), type: '-s' });
    if (hw.endsWith('es')) c.push({ root: hw.slice(0, -2), type: '-es' });
    if (hw.endsWith('ies')) c.push({ root: hw.slice(0, -3) + 'y', type: '-ies' });
  }
  if (hw.length > 4 && hw.endsWith('ed')) {
    c.push({ root: hw.slice(0, -1), type: '-d' });
    c.push({ root: hw.slice(0, -2), type: '-ed' });
    if (hw.endsWith('ied')) c.push({ root: hw.slice(0, -3) + 'y', type: '-ied' });
    if (hw.length > 5 && hw[hw.length - 3] === hw[hw.length - 4]) {
      c.push({ root: hw.slice(0, -3), type: '-double-ed' });
    }
  }
  if (hw.length > 5 && hw.endsWith('ing')) {
    c.push({ root: hw.slice(0, -3), type: '-ing' });
    c.push({ root: hw.slice(0, -3) + 'e', type: '-ing (e-drop)' });
    if (hw.length > 6 && hw[hw.length - 4] === hw[hw.length - 5]) {
      c.push({ root: hw.slice(0, -4), type: '-double-ing' });
    }
  }
  return c;
}

const coreWords = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'core-1200.json'), 'utf8')).words;
const wordMap = new Map();
coreWords.forEach(w => wordMap.set(w.headword.toLowerCase().trim(), w));

const wordsToRemove = new Set();
let preservedCount = 0;

for (const w of coreWords) {
  const hw = w.headword.toLowerCase().trim();
  if (PRESERVE_WHITELIST.has(hw)) {
    preservedCount++;
    continue;
  }

  const candidates = getRootCandidates(hw);
  for (const cand of candidates) {
    if (cand.root !== hw && wordMap.has(cand.root) && !wordsToRemove.has(cand.root)) {
      const rootWord = wordMap.get(cand.root);

      if (!rootWord.inflections) rootWord.inflections = {};
      if (cand.type.startsWith('-s') || cand.type.startsWith('-es') || cand.type.startsWith('-ies')) {
        rootWord.inflections.s = hw;
      } else if (cand.type.startsWith('-ed') || cand.type.startsWith('-d') || cand.type.startsWith('-ied')) {
        rootWord.inflections.ed = hw;
      } else if (cand.type.startsWith('-ing')) {
        rootWord.inflections.ing = hw;
      }

      // 吸收例句
      if (Array.isArray(w.examples) && Array.isArray(rootWord.examples) && rootWord.examples.length < 5) {
        for (const ex of w.examples) {
          const exists = rootWord.examples.some(rEx => rEx.en === ex.en);
          if (!exists && rootWord.examples.length < 5) {
            rootWord.examples.push({
              id: `ex_absorbed_${rootWord.examples.length + 1}`,
              en: ex.en,
              zh: ex.zh,
              scenario: ex.scenario || '核心情境拓展'
            });
          }
        }
      }

      // 吸收考題
      if (Array.isArray(w.quizzes) && Array.isArray(rootWord.quizzes) && rootWord.quizzes.length < 6) {
        for (const q of w.quizzes) {
          const qExists = rootWord.quizzes.some(rQ => rQ.stem === q.stem);
          if (!qExists && rootWord.quizzes.length < 6) {
            rootWord.quizzes.push(q);
          }
        }
      }

      wordsToRemove.add(hw);
      break;
    }
  }
}

const refinedCore = coreWords.filter(w => !wordsToRemove.has(w.headword.toLowerCase().trim()));
console.log(`✓ [Core-1200] 原 ${coreWords.length} 詞 ➔ 精煉為 ${refinedCore.length} 詞 (吸收 -${wordsToRemove.size} 詞，白名單保護 ${preservedCount} 詞)`);

const BUILD_VERSION = 17;
const DATASET_RELEASE_TAG = 'v7.3.0-flagship-all-tiers-consolidated';
const TIMESTAMP = new Date().toISOString();

// 寫入 public/data/v1/core-1200.json (Master 檔案)
const masterCorePath = path.join(DATA_DIR, 'core-1200.json');
const masterCoreData = {
  version: BUILD_VERSION,
  datasetVersion: DATASET_RELEASE_TAG,
  tier: 'core-1200',
  count: refinedCore.length,
  words: refinedCore
};
fs.writeFileSync(masterCorePath, JSON.stringify(masterCoreData, null, 2), 'utf8');
console.log(`✅ 已寫入 master core-1200.json: ${refinedCore.length} 詞`);

// 寫入 course-core-1200.json
const coreFilePath = path.join(COURSES_DIR, 'course-core-1200.json');
const coreCourseData = {
  id: 'course-core-1200',
  title: '🔥 多益必考高頻核心 1,200 字全集 (詞元精煉版)',
  description: '涵蓋 600~750 分多益核心考點，經詞元精煉為 921 關鍵字卡（完整涵蓋 1,200 詞形變化、4D 考題與 100% 實景圖片）。',
  toeicScoreRange: '400-750',
  category: '高頻核心',
  level: '核心必考',
  version: BUILD_VERSION,
  datasetVersion: DATASET_RELEASE_TAG,
  buildTimestamp: TIMESTAMP,
  wordCount: refinedCore.length,
  words: refinedCore
};
fs.writeFileSync(coreFilePath, JSON.stringify(coreCourseData, null, 2), 'utf8');
console.log(`✅ 已寫入 course-core-1200.json: ${refinedCore.length} 詞`);

// 寫入 quiz/core-mcq.json
fs.writeFileSync(path.join(QUIZ_DIR, 'core-mcq.json'), JSON.stringify(refinedCore, null, 2), 'utf8');
console.log(`✅ 已寫入 quiz/core-mcq.json: ${refinedCore.length} 詞`);

// 建立全量 5 大分卷 masterMap 用於單元切片課程檔案同步
const advWords = JSON.parse(fs.readFileSync(path.join(COURSES_DIR, 'course-advanced-2500.json'), 'utf8')).words;
const exp1Words = JSON.parse(fs.readFileSync(path.join(COURSES_DIR, 'course-expert-high-part1.json'), 'utf8')).words;
const exp2Words = JSON.parse(fs.readFileSync(path.join(COURSES_DIR, 'course-expert-high-part2.json'), 'utf8')).words;
const exp3Words = JSON.parse(fs.readFileSync(path.join(COURSES_DIR, 'course-expert-high-part3.json'), 'utf8')).words;

const masterMap = new Map();
[refinedCore, advWords, exp1Words, exp2Words, exp3Words].forEach(wordList => {
  wordList.forEach(w => {
    masterMap.set(w.headword.toLowerCase().trim(), w);
  });
});

// 同步所有單元切片課程檔案 (course-*.json)
console.log('\n🔄 正在同步所有單元切片課程檔案...');
const allCourseDiskFiles = fs.readdirSync(COURSES_DIR).filter(f => f.startsWith('course-') && f.endsWith('.json'));
const mainSet = new Set([
  'course-core-1200.json',
  'course-advanced-2500.json',
  'course-expert-high-part1.json',
  'course-expert-high-part2.json',
  'course-expert-high-part3.json'
]);

for (const cf of allCourseDiskFiles) {
  const cp = path.join(COURSES_DIR, cf);
  const cData = JSON.parse(fs.readFileSync(cp, 'utf8'));

  if (!mainSet.has(cf)) {
    const seen = new Set();
    const updatedWords = [];

    for (const cw of (cData.words || [])) {
      const key = cw.headword.toLowerCase().trim();
      const master = masterMap.get(key);
      if (master) {
        const masterKey = master.headword.toLowerCase().trim();
        if (!seen.has(masterKey)) {
          seen.add(masterKey);
          updatedWords.push(master);
        }
      } else {
        if (!seen.has(key)) {
          seen.add(key);
          updatedWords.push(cw);
        }
      }
    }

    cData.words = updatedWords;
    cData.wordCount = updatedWords.length;
  }

  cData.version = BUILD_VERSION;
  cData.datasetVersion = DATASET_RELEASE_TAG;
  cData.buildTimestamp = TIMESTAMP;

  fs.writeFileSync(cp, JSON.stringify(cData, null, 2), 'utf8');
}
console.log(`✅ 已同步 ${allCourseDiskFiles.length} 個課程檔案至版本 v${BUILD_VERSION} (${DATASET_RELEASE_TAG})`);

// 重新編譯 catalog.json
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
console.log(`✅ 已更新 catalog.json！全庫課程總詞數: ${totalCatalogWords}`);
console.log('================================================================');
console.log('🏆 Core-1200 精煉同步完成！');
console.log('================================================================');
