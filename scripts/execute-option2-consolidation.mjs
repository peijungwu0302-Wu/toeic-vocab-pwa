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
console.log('🚀 開始執行「選項 2：非核心 4 大分卷詞元精煉整併」與「Core-1200 視覺共享」');
console.log('================================================================\n');

// 權威特殊考點白名單（100% 絕對豁免保護）
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

  // 🌟 特殊獨立語意質變高階詞 (特考點白名單保護)
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

// 1. 載入 5 大 Master 檔案
const coreWords = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'core-1200.json'), 'utf8')).words;
const advWords = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'advanced-2500.json'), 'utf8')).words;
const exp1Words = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'expert-high-part1.json'), 'utf8')).words;
const exp2Words = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'expert-high-part2.json'), 'utf8')).words;
const exp3Words = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'expert-high-part3.json'), 'utf8')).words;

function consolidateList(wordList, tierName) {
  const wordMap = new Map();
  wordList.forEach(w => wordMap.set(w.headword.toLowerCase().trim(), w));

  const wordsToRemove = new Set();
  let preservedCount = 0;

  for (const w of wordList) {
    const hw = w.headword.toLowerCase().trim();
    if (PRESERVE_WHITELIST.has(hw)) {
      preservedCount++;
      continue;
    }

    const candidates = getRootCandidates(hw);
    for (const cand of candidates) {
      if (cand.root !== hw && wordMap.has(cand.root) && !wordsToRemove.has(cand.root)) {
        const rootWord = wordMap.get(cand.root);

        // 吸收形態標記 (inflections)
        if (!rootWord.inflections) rootWord.inflections = {};
        if (cand.type.startsWith('-s') || cand.type.startsWith('-es') || cand.type.startsWith('-ies')) {
          rootWord.inflections.s = hw;
        } else if (cand.type.startsWith('-ed') || cand.type.startsWith('-d') || cand.type.startsWith('-ied')) {
          rootWord.inflections.ed = hw;
        } else if (cand.type.startsWith('-ing')) {
          rootWord.inflections.ing = hw;
        }

        // 吸收優質例句 (避免重複，擴充至最多 4~5 句)
        if (Array.isArray(w.examples) && Array.isArray(rootWord.examples) && rootWord.examples.length < 5) {
          for (const ex of w.examples) {
            const exists = rootWord.examples.some(rEx => rEx.en === ex.en);
            if (!exists && rootWord.examples.length < 5) {
              rootWord.examples.push({
                id: `ex_absorbed_${rootWord.examples.length + 1}`,
                en: ex.en,
                zh: ex.zh,
                scenario: ex.scenario || '商務延伸'
              });
            }
          }
        }

        // 吸收 4D 考題至原型題庫池 (quizzes)
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

  const refined = wordList.filter(w => !wordsToRemove.has(w.headword.toLowerCase().trim()));
  console.log(`  ✓ [${tierName}] 原 ${wordList.length} 詞 ➔ 精煉為 ${refined.length} 詞 (吸收 -${wordsToRemove.size} 詞，白名單保護 ${preservedCount} 詞)`);
  return refined;
}

console.log('🔄 正在對 4 大非核心分卷執行詞元精煉吸收...');
const refinedAdv = consolidateList(advWords, 'advanced-2500');
const refinedExp1 = consolidateList(exp1Words, 'expert-high-part1');
const refinedExp2 = consolidateList(exp2Words, 'expert-high-part2');
const refinedExp3 = consolidateList(exp3Words, 'expert-high-part3');

const totalAbsorbed = (advWords.length - refinedAdv.length) +
                      (exp1Words.length - refinedExp1.length) +
                      (exp2Words.length - refinedExp2.length) +
                      (exp3Words.length - refinedExp3.length);

console.log(`\n🎉 非核心 4 大分卷精煉完成！共成功吸收 ${totalAbsorbed} 筆機械屈折單字（直接省下 ${totalAbsorbed} 張生圖額度）！\n`);

// 2. 建立全域單字字典 (Master Map) 用於單元課程切片同步
const masterMap = new Map();
[coreWords, refinedAdv, refinedExp1, refinedExp2, refinedExp3].forEach(wordList => {
  wordList.forEach(w => {
    masterMap.set(w.headword.toLowerCase().trim(), w);
  });
});

const BUILD_VERSION = 16;
const DATASET_RELEASE_TAG = 'v7.2.0-flagship-consolidated-option2';
const TIMESTAMP = new Date().toISOString();

// 3. 寫入 5 大主力課程檔案
const MAIN_COURSES = [
  {
    fileName: 'course-core-1200.json',
    id: 'course-core-1200',
    title: '🔥 多益必考高頻核心 1,200 字全集',
    description: '涵蓋 600~750 分多益核心考點，含 2,400 題 4D 考點測驗、24領域商務例句與視覺共享技術。',
    toeicScoreRange: '400-750',
    category: '高頻核心',
    level: '核心必考',
    words: coreWords
  },
  {
    fileName: 'course-advanced-2500.json',
    id: 'course-advanced-2500',
    title: '💼 多益商務進階實戰 2,500 字全集 (詞元精煉版)',
    description: '衝刺 750~860 分金色證書實戰單字庫（經詞元精煉去冗餘，含完整形態膠囊與 4D 考題）。',
    toeicScoreRange: '750-860',
    category: '進階實戰',
    level: '金證衝刺',
    words: refinedAdv
  },
  {
    fileName: 'course-expert-high-part1.json',
    id: 'course-expert-high-part1',
    title: '🚀 多益滿分巔峰挑戰 (1/3: 詞元精煉版)',
    description: '860~990 分滿分巔峰高難度商業詞彙 (第 1/3 輯，含 4D 考點測驗與詞形膠囊)。',
    toeicScoreRange: '860-990',
    category: '高階挑戰',
    level: '滿分巔峰',
    words: refinedExp1
  },
  {
    fileName: 'course-expert-high-part2.json',
    id: 'course-expert-high-part2',
    title: '🚀 多益滿分巔峰挑戰 (2/3: 詞元精煉版)',
    description: '860~990 分滿分巔峰高難度商業詞彙 (第 2/3 輯，含 4D 考點測驗與詞形膠囊)。',
    toeicScoreRange: '860-990',
    category: '高階挑戰',
    level: '滿分巔峰',
    words: refinedExp2
  },
  {
    fileName: 'course-expert-high-part3.json',
    id: 'course-expert-high-part3',
    title: '🚀 多益滿分巔峰挑戰 (3/3: 詞元精煉版)',
    description: '860~990 分滿分巔峰高難度商業詞彙 (第 3/3 輯，含 4D 考點測驗與詞形膠囊)。',
    toeicScoreRange: '860-990',
    category: '高階挑戰',
    level: '滿分巔峰',
    words: refinedExp3
  }
];

console.log('🔄 正在同步更新 5 大主力課程檔案...');
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
  console.log(`  ✅ 已寫入 ${mc.fileName}: ${mc.words.length} 詞`);
}

// 4. 同步所有單元課程檔案 (course-*.json)
console.log('\n🔄 正在同步所有單元切片課程檔案...');
const allCourseDiskFiles = fs.readdirSync(COURSES_DIR).filter(f => f.startsWith('course-') && f.endsWith('.json'));
const mainSet = new Set(MAIN_COURSES.map(m => m.fileName));

for (const cf of allCourseDiskFiles) {
  if (mainSet.has(cf)) continue;
  const cp = path.join(COURSES_DIR, cf);
  const cData = JSON.parse(fs.readFileSync(cp, 'utf8'));

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
  cData.version = BUILD_VERSION;
  cData.datasetVersion = DATASET_RELEASE_TAG;
  cData.buildTimestamp = TIMESTAMP;

  fs.writeFileSync(cp, JSON.stringify(cData, null, 2), 'utf8');
  console.log(`  ✅ ${cf}: 精煉後為 ${updatedWords.length} 詞`);
}

// 5. 同步 public/data/v1/quiz/ 題庫檔案
console.log('\n🔄 正在同步 public/data/v1/quiz/ 題庫檔案...');
const QUIZ_FILES = [
  { name: 'core-mcq.json', words: coreWords },
  { name: 'advanced-mcq.json', words: refinedAdv },
  { name: 'expert-mcq-part1.json', words: refinedExp1 },
  { name: 'expert-mcq-part2.json', words: refinedExp2 },
  { name: 'expert-mcq-part3.json', words: refinedExp3 }
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
console.log('🏆 選項 2 詞元精煉整併與 Core-1200 視覺共享 100% 大圓滿完成！');
console.log('================================================================');
