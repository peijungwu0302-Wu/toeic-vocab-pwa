import fs from 'node:fs';

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
  /The management team implemented the standard/i
];

for (const f of masterFiles) {
  const data = JSON.parse(fs.readFileSync(`public/data/v1/${f}`, 'utf8'));
  let t0 = 0, t1 = 0, t2 = 0, all3 = 0;
  data.words.forEach(w => {
    const e0 = w.examples?.[0]?.en || '';
    const e1 = w.examples?.[1]?.en || '';
    const e2 = w.examples?.[2]?.en || '';

    const is0 = TEMPLATE_PATTERNS.some(p => p.test(e0));
    const is1 = TEMPLATE_PATTERNS.some(p => p.test(e1));
    const is2 = TEMPLATE_PATTERNS.some(p => p.test(e2));

    if (is0) t0++;
    if (is1) t1++;
    if (is2) t2++;
    if (is0 && is1 && is2) all3++;
  });

  console.log(`📁 [${f}] (${data.words.length} 字):`);
  console.log(`   - ex[0] 模板: ${t0} 字 (${((t0/data.words.length)*100).toFixed(1)}%)`);
  console.log(`   - ex[1] 模板: ${t1} 字 (${((t1/data.words.length)*100).toFixed(1)}%)`);
  console.log(`   - ex[2] 模板: ${t2} 字 (${((t2/data.words.length)*100).toFixed(1)}%)`);
  console.log(`   - ❌ 三個例句全部都是模板的單字數: ${all3} 字 (${((all3/data.words.length)*100).toFixed(1)}%)\n`);
}
