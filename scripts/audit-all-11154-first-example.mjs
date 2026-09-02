import fs from 'node:fs';
import path from 'node:path';

const masterFiles = [
  'core-1200.json',
  'advanced-2500.json',
  'expert-high-part1.json',
  'expert-high-part2.json',
  'expert-high-part3.json'
];

const TEMPLATE_PATTERNS = [
  /All employees are strongly advised/i,
  /Senior stakeholders finalized/i,
  /Commercial stakeholders agreed/i,
  /The company management decided to utilize/i,
  /The management team implemented the standard/i,
  /【.*】/
];

console.log('🔍 正在全量檢查 11,154 單字之「第一例句 (ex[0])」真實情況...\n');

let totalWords = 0;
let totalBadEx0 = 0;
const badWordsByFile = {};

for (const f of masterFiles) {
  const p = path.resolve('public/data/v1', f);
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const badList = [];

  data.words.forEach((w, idx) => {
    totalWords++;
    const ex0 = w.examples?.[0];
    const en = ex0?.en || '';
    const zh = ex0?.zh || '';

    const isTpl = TEMPLATE_PATTERNS.some(pat => pat.test(en)) || TEMPLATE_PATTERNS.some(pat => pat.test(zh));
    const isTooShort = !en || en.length < 15 || !zh || zh.length < 3;

    if (isTpl || isTooShort) {
      badList.push({ index: idx, id: w.id, headword: w.headword, en, zh, reason: isTpl ? '模板句型' : '例句過短或缺失' });
      totalBadEx0++;
    }
  });

  badWordsByFile[f] = badList;
  console.log(`📁 [${f}] (共 ${data.words.length} 字)`);
  console.log(`   - 異常/模板第一例句: ${badList.length} 筆 (${((badList.length/data.words.length)*100).toFixed(2)}%)`);
  if (badList.length > 0) {
    console.log(`   - 前 5 個異常範例:`, badList.slice(0, 5).map(b => `${b.headword} (${b.reason})`));
  }
  console.log('');
}

console.log('============================================================');
console.log(`🏆 全字庫 11,154 字檢查總結：`);
console.log(`- 總單字量: ${totalWords}`);
console.log(`- 良好/非模板之具象第一例句: ${totalWords - totalBadEx0} / ${totalWords} (${(((totalWords - totalBadEx0)/totalWords)*100).toFixed(2)}%)`);
console.log(`- 待修復/模板第一例句: ${totalBadEx0} / ${totalWords} (${((totalBadEx0/totalWords)*100).toFixed(2)}%)`);
console.log('============================================================\n');
