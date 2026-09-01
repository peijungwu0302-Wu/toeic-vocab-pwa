import fs from 'node:fs';
import path from 'node:path';

const files = [
  'core-1200.json',
  'advanced-2500.json',
  'expert-high-part1.json',
  'expert-high-part2.json',
  'expert-high-part3.json'
];

const TEMPLATE_PATTERNS = [
  /The management team implemented the standard procedures for/i,
  /All employees are strongly advised to submit their expense receipts/i,
  /Senior stakeholders finalized the commercial memorandum/i,
  /Commercial stakeholders agreed that maintaining/i,
  /By .* automated cloud infrastructure/i,
  /【.*】/
];

console.log('🔍 調查全字庫例句中的模板句分佈情況：\n');

for (const f of files) {
  const p = path.resolve('public/data/v1', f);
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  let tplEx0 = 0;
  let tplEx1 = 0;
  let tplEx2 = 0;
  let totalWords = data.words.length;
  const sampleTpls = [];

  data.words.forEach((w, idx) => {
    const ex0 = w.examples?.[0]?.en || '';
    const ex1 = w.examples?.[1]?.en || '';
    const ex2 = w.examples?.[2]?.en || '';

    const isEx0Tpl = TEMPLATE_PATTERNS.some(pat => pat.test(ex0));
    const isEx1Tpl = TEMPLATE_PATTERNS.some(pat => pat.test(ex1));
    const isEx2Tpl = TEMPLATE_PATTERNS.some(pat => pat.test(ex2));

    if (isEx0Tpl) {
      tplEx0++;
      if (sampleTpls.length < 5) {
        sampleTpls.push({ word: w.headword, ex0: w.examples[0] });
      }
    }
    if (isEx1Tpl) tplEx1++;
    if (isEx2Tpl) tplEx2++;
  });

  console.log(`📁 檔案: ${f} (${totalWords} 字)`);
  console.log(`   - 第一例句 (ex[0]) 模板數: ${tplEx0} / ${totalWords} (${((tplEx0/totalWords)*100).toFixed(1)}%)`);
  console.log(`   - 第二例句 (ex[1]) 模板數: ${tplEx1} / ${totalWords} (${((tplEx1/totalWords)*100).toFixed(1)}%)`);
  console.log(`   - 第三例句 (ex[2]) 模板數: ${tplEx2} / ${totalWords} (${((tplEx2/totalWords)*100).toFixed(1)}%)`);
  if (sampleTpls.length > 0) {
    console.log(`   - ex[0] 模板範例:`, JSON.stringify(sampleTpls[0]));
  }
  console.log('');
}
