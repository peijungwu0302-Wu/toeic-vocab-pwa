import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'public', 'data', 'v1');
const QUIZ_DIR = path.join(DATA_DIR, 'quiz');
const COURSES_DIR = path.join(DATA_DIR, 'courses');

console.log('='.repeat(70));
console.log('🔄 同步五大分卷題庫至 Master 資料庫與 44 門課程檔案');
console.log('='.repeat(70));

const phaseFiles = [
  'core-mcq.json',
  'advanced-mcq.json',
  'expert-mcq-part1.json',
  'expert-mcq-part2.json',
  'expert-mcq-part3.json'
];

const quizMap = new Map();
let totalLoadedWords = 0;

for (const pf of phaseFiles) {
  const pPath = path.join(QUIZ_DIR, pf);
  if (!fs.existsSync(pPath)) {
    console.warn(`[Sync] Warning: Phase file not found: ${pf}`);
    continue;
  }
  const items = JSON.parse(fs.readFileSync(pPath, 'utf8'));
  console.log(`📂 讀取 ${pf} (${items.length} 詞)...`);
  for (const item of items) {
    if (item.headword) {
      quizMap.set(item.headword.toLowerCase().trim(), item);
      totalLoadedWords++;
    }
  }
}

console.log(`✅ 成功載入 ${totalLoadedWords} 筆全真試題資料（唯一鍵數：${quizMap.size}）`);

// Update master tier files
const masterFiles = [
  'core-1200.json',
  'advanced-2500.json',
  'expert-high-part1.json',
  'expert-high-part2.json',
  'expert-high-part3.json'
];

function getGuaranteedWordId(w, qData) {
  if (w.id) return w.id;
  if (qData && qData.id) return qData.id;
  const rawHw = (w.headword || qData?.headword || '').toLowerCase().trim();
  const clean = rawHw.replace(/[^a-z0-9]/g, '_');
  const hash = crypto.createHash('md5').update(rawHw).digest('hex').slice(0, 8);
  return `tw_${clean.slice(0, 20)}_${hash}`;
}

for (const mf of masterFiles) {
  const mPath = path.join(DATA_DIR, mf);
  if (!fs.existsSync(mPath)) continue;

  const mData = JSON.parse(fs.readFileSync(mPath, 'utf8'));
  const updatedWords = (mData.words || []).map(w => {
    const qData = quizMap.get(w.headword.toLowerCase().trim());
    const wordId = getGuaranteedWordId(w, qData);
    if (qData) {
      return {
        ...w,
        id: wordId,
        visualAnchor: qData.visualAnchor || w.visualAnchor,
        examples: qData.examples && qData.examples.length > 0 ? qData.examples : w.examples,
        quizzes: qData.quizzes && qData.quizzes.length > 0 ? qData.quizzes : w.quizzes
      };
    }
    return { ...w, id: wordId };
  });

  fs.writeFileSync(mPath, JSON.stringify({
    ...mData,
    version: 5,
    datasetVersion: 'v5.0.0-llm-bespoke-visual',
    buildTimestamp: new Date().toISOString(),
    words: updatedWords
  }), 'utf8');

  console.log(`✅ ${mf} 已同步更新為 v5.0 (含 3 例句 + visualAnchor + 3+3 全真題目)`);
}

// Update all course files
const courseFiles = fs.readdirSync(COURSES_DIR).filter(f => f.startsWith('course-') && f.endsWith('.json'));
console.log(`\n📚 正在同步全量 ${courseFiles.length} 門課程檔案...`);

for (const cf of courseFiles) {
  const cp = path.join(COURSES_DIR, cf);
  const cData = JSON.parse(fs.readFileSync(cp, 'utf8'));
  const updatedWords = (cData.words || []).map(w => {
    const qData = quizMap.get(w.headword.toLowerCase().trim());
    const wordId = getGuaranteedWordId(w, qData);
    if (qData) {
      return {
        ...w,
        id: wordId,
        visualAnchor: qData.visualAnchor || w.visualAnchor,
        examples: qData.examples && qData.examples.length > 0 ? qData.examples : w.examples,
        quizzes: qData.quizzes && qData.quizzes.length > 0 ? qData.quizzes : w.quizzes
      };
    }
    return { ...w, id: wordId };
  });

  fs.writeFileSync(cp, JSON.stringify({
    ...cData,
    version: 5,
    datasetVersion: 'v5.0.0-llm-bespoke-visual',
    buildTimestamp: new Date().toISOString(),
    words: updatedWords
  }), 'utf8');
}
console.log(`✅ 全量 ${courseFiles.length} 門課程檔案已同步升級至 v5.0.0！`);

// Update catalog.json
const catalogPath = path.join(DATA_DIR, 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

catalog.version = 5;
catalog.datasetVersion = 'v5.0.0-llm-bespoke-visual';
catalog.buildTimestamp = new Date().toISOString();

for (const c of catalog.courses) {
  c.version = 5;
  c.datasetVersion = 'v5.0.0-llm-bespoke-visual';
  const cPath = path.join(COURSES_DIR, c.fileName);
  if (fs.existsSync(cPath)) {
    const fileBuf = fs.readFileSync(cPath);
    c.sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
    c.sizeBytes = fileBuf.length;
  }
}

fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
console.log(`✅ catalog.json 已更新至 v5.0.0！`);

// Clean legacy unused quiz files
const legacyFiles = ['core-cloze.json', 'advanced-cloze.json', 'expert-cloze.json', 'expert-mcq.json'];
for (const lf of legacyFiles) {
  const lp = path.join(QUIZ_DIR, lf);
  if (fs.existsSync(lp)) {
    fs.unlinkSync(lp);
    console.log(`🧹 已清理歷史廢棄檔案: ${lf}`);
  }
}

console.log('\n' + '='.repeat(70));
console.log('🎉 五大分卷題庫與全量課程資料集全面同步完成！');
console.log('='.repeat(70));
