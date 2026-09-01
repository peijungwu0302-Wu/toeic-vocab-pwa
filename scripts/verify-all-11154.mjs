import fs from 'node:fs';
import path from 'node:path';

const files = [
  'core-1200.json',
  'advanced-2500.json',
  'expert-high-part1.json',
  'expert-high-part2.json',
  'expert-high-part3.json'
];

let totalWords = 0;
let totalWithVisualAnchor = 0;
let totalWithValidFirstEx = 0;

console.log('📊 全字庫 11,154 筆資料庫驗證報告：\n');

for (const f of files) {
  const fullPath = path.resolve('public/data/v1', f);
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  let vAnchor = 0;
  let firstEx = 0;
  data.words.forEach(w => {
    if (w.visualAnchor && w.visualAnchor.imagePrompt && w.visualAnchor.imagePrompt.length > 10) vAnchor++;
    if (w.examples && w.examples[0] && w.examples[0].en && w.examples[0].zh) firstEx++;
  });

  totalWords += data.words.length;
  totalWithVisualAnchor += vAnchor;
  totalWithValidFirstEx += firstEx;

  console.log(`• [${f}]`);
  console.log(`   - 總單字量: ${data.words.length}`);
  console.log(`   - 具象第一例句: ${firstEx} / ${data.words.length} (${((firstEx/data.words.length)*100).toFixed(1)}%)`);
  console.log(`   - 向量生圖 Prompt: ${vAnchor} / ${data.words.length} (${((vAnchor/data.words.length)*100).toFixed(1)}%)\n`);
}

console.log('============================================================');
console.log(`🏆 全庫總計單字量: ${totalWords}`);
console.log(`🌟 具象第一例句覆蓋率: ${totalWithValidFirstEx} / ${totalWords} (${((totalWithValidFirstEx/totalWords)*100).toFixed(2)}%)`);
console.log(`🎨 向量生圖 Prompt 覆蓋率: ${totalWithVisualAnchor} / ${totalWords} (${((totalWithVisualAnchor/totalWords)*100).toFixed(2)}%)`);
console.log('============================================================\n');
