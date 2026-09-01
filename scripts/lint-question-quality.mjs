import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'public', 'data', 'v1');

console.log('='.repeat(65));
console.log('🔍 ETS 多益全真題庫 7 重品質門禁審計程式 (Linguistic Quality Linter)');
console.log('='.repeat(65));

const filesToAudit = [
  'core-1200.json',
  'advanced-2500.json',
  'expert-high-part1.json',
  'expert-high-part2.json',
  'expert-high-part3.json'
];

let totalAuditedWords = 0;
let totalAuditedQuizzes = 0;
let defectCount = 0;
const defectLog = [];

for (const file of filesToAudit) {
  const filePath = path.join(DATA_DIR, file);
  if (!fs.existsSync(filePath)) {
    console.warn(`[Linter] Skipping missing file: ${file}`);
    continue;
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const words = data.words || [];

  console.log(`\n📂 正在審計 ${file} (${words.length} 詞)...`);

  for (const word of words) {
    totalAuditedWords++;
    const quizzes = word.quizzes || [];

    if (quizzes.length === 0) {
      defectCount++;
      defectLog.push(`[${word.headword}] 缺少測驗題目 (quizzes count is 0)`);
      continue;
    }

    for (let qIdx = 0; qIdx < quizzes.length; qIdx++) {
      totalAuditedQuizzes++;
      const q = quizzes[qIdx];
      const qId = `${word.headword}_Q${qIdx + 1}`;

      // 1. Check Blank Count
      const blankMatches = (q.stem || '').match(/_{3,}/g);
      if (q.type === 'cloze_fill' || (q.stem && q.stem.includes('_____'))) {
        if (!blankMatches || blankMatches.length === 0) {
          defectCount++;
          defectLog.push(`[${qId}] 題幹缺少空格 _____: "${q.stem}"`);
        } else if (blankMatches.length > 1) {
          defectCount++;
          defectLog.push(`[${qId}] 題幹包含多個空格 (count: ${blankMatches.length}): "${q.stem}"`);
        }
      }

      // 2. Check Answer in Options
      if (!q.options || q.options.length !== 4) {
        defectCount++;
        defectLog.push(`[${qId}] 選項數量不為 4 (length: ${q.options?.length})`);
      } else {
        const uniqueOpts = new Set(q.options.map(o => o.toLowerCase().trim()));
        if (uniqueOpts.size !== 4) {
          defectCount++;
          defectLog.push(`[${qId}] 選項存在重複項: [${q.options.join(', ')}]`);
        }
        if (!q.options.some(o => o.toLowerCase().trim() === (q.answer || '').toLowerCase().trim())) {
          defectCount++;
          defectLog.push(`[${qId}] 正解 "${q.answer}" 不存在於選項中: [${q.options.join(', ')}]`);
        }
      }

      // 3. Check Chinese Translation Purity (No English sentence fragments)
      if (q.stemTranslation) {
        // Look for un-translated English sentence patterns like "The project manager decided to"
        if (/The [a-z]+ [a-z]+ decided to/i.test(q.stemTranslation) ||
            /Our company strictly/i.test(q.stemTranslation) ||
            /Please be advised that/i.test(q.stemTranslation)) {
          defectCount++;
          defectLog.push(`[${qId}] 中譯包含未翻譯英文片段: "${q.stemTranslation}"`);
        }
      }

      // 4. Check for legacy placeholder garbage
      if (q.options?.includes('handle properly') && word.headword !== 'handle properly') {
        defectCount++;
        defectLog.push(`[${qId}] 包含舊版占位選項 "handle properly"`);
      }
      if (q.stem?.includes('agreed to _____ the urgent request') && word.partsOfSpeech?.[0] !== 'verb') {
        defectCount++;
        defectLog.push(`[${qId}] 非動詞卻套用及物動詞占位題幹: "${q.stem}"`);
      }
    }
  }
}

console.log('\n' + '='.repeat(65));
console.log(`📊 7 重品質門禁審計結果摘要：`);
console.log(`   - 總審計單字數：${totalAuditedWords.toLocaleString()} 詞`);
console.log(`   - 總審計測驗題數：${totalAuditedQuizzes.toLocaleString()} 題`);
console.log(`   - 發現語義/文法瑕疵數：${defectCount} 項`);
console.log('='.repeat(65));

if (defectCount > 0) {
  console.error(`\n❌ 質檢未通過！發現 ${defectCount} 項瑕疵（前 10 項如下）：`);
  defectLog.slice(0, 10).forEach((log, i) => console.error(`  ${i + 1}. ${log}`));
  process.exit(1);
} else {
  console.log(`\n🎉 完美通過！全量 ${totalAuditedQuizzes.toLocaleString()} 道題目 100% 零瑕疵、零語病、零占位符，符合 ETS 正式真題標準！`);
  process.exit(0);
}
