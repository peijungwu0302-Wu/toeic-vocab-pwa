import fs from 'node:fs';
import path from 'node:path';

const COURSES_DIR = 'public/data/v1/courses';
const files = fs.readdirSync(COURSES_DIR).filter(f => f.endsWith('.json'));

const TEMPLATE_PATTERNS = [
  /All employees are strongly advised/i,
  /Senior stakeholders finalized/i,
  /Commercial stakeholders agreed/i,
  /The company management decided to utilize/i,
  /The management team implemented the standard/i
];

console.log(`🔍 正在掃描 ${files.length} 個課程 JSON 檔案...\n`);

let totalWordsScanned = 0;
let totalEx0Templates = 0;
let totalEx1Templates = 0;
let totalEx2Templates = 0;

for (const f of files) {
  const p = path.join(COURSES_DIR, f);
  const course = JSON.parse(fs.readFileSync(p, 'utf8'));
  let tpl0 = 0, tpl1 = 0, tpl2 = 0;
  
  if (Array.isArray(course.words)) {
    course.words.forEach(w => {
      totalWordsScanned++;
      const ex0 = w.examples?.[0]?.en || '';
      const ex1 = w.examples?.[1]?.en || '';
      const ex2 = w.examples?.[2]?.en || '';

      if (TEMPLATE_PATTERNS.some(pat => pat.test(ex0))) { tpl0++; totalEx0Templates++; }
      if (TEMPLATE_PATTERNS.some(pat => pat.test(ex1))) { tpl1++; totalEx1Templates++; }
      if (TEMPLATE_PATTERNS.some(pat => pat.test(ex2))) { tpl2++; totalEx2Templates++; }
    });
  }

  if (tpl0 > 0 || tpl1 > 0 || tpl2 > 0) {
    console.log(`⚠️ [${f}] (${course.words?.length} 字): ex0模板=${tpl0}, ex1模板=${tpl1}, ex2模板=${tpl2}`);
  }
}

console.log('\n============================================================');
console.log(`📊 掃描總結：共掃描 ${files.length} 個課程，總單字次數 ${totalWordsScanned}`);
console.log(`- 第一例句 (ex[0]) 模板數: ${totalEx0Templates} / ${totalWordsScanned} (${((totalEx0Templates/totalWordsScanned)*100).toFixed(2)}%)`);
console.log(`- 第二例句 (ex[1]) 模板數: ${totalEx1Templates} / ${totalWordsScanned} (${((totalEx1Templates/totalWordsScanned)*100).toFixed(2)}%)`);
console.log(`- 第三例句 (ex[2]) 模板數: ${totalEx2Templates} / ${totalWordsScanned} (${((totalEx2Templates/totalWordsScanned)*100).toFixed(2)}%)`);
console.log('============================================================\n');
