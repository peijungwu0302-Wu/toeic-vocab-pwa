import fs from 'node:fs';

const files = [
  'core-1200.json',
  'advanced-2500.json',
  'expert-high-part1.json',
  'expert-high-part2.json',
  'expert-high-part3.json'
];

console.log('📊 全字庫 11,154 筆「Prompt」與「第一例句」在庫盤點：\n');

for (const f of files) {
  const data = JSON.parse(fs.readFileSync(`public/data/v1/${f}`, 'utf8'));
  let validPrompts = 0;
  let validExamples = 0;
  
  data.words.forEach(w => {
    if (w.visualAnchor && w.visualAnchor.imagePrompt && w.visualAnchor.imagePrompt.length > 10) {
      validPrompts++;
    }
    if (w.examples && w.examples[0] && w.examples[0].en && w.examples[0].en.length > 10) {
      validExamples++;
    }
  });

  console.log(`• [${f}] (${data.words.length} 字):`);
  console.log(`   - 專屬 1:1 生圖 Prompt 在庫量: ${validPrompts} / ${data.words.length} (${((validPrompts/data.words.length)*100).toFixed(1)}%)`);
  console.log(`   - 第一商務例句 (ex[0]) 在庫量: ${validExamples} / ${data.words.length} (${((validExamples/data.words.length)*100).toFixed(1)}%)\n`);
}
