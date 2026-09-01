import fs from 'node:fs';
import path from 'node:path';

const files = [
  'advanced-2500.json',
  'expert-high-part1.json',
  'expert-high-part2.json',
  'expert-high-part3.json'
];

let totalPatched = 0;

for (const f of files) {
  const fullPath = path.resolve('public/data/v1', f);
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  let patchedInFile = 0;

  data.words.forEach(w => {
    if (!w.examples || !w.examples[0] || !w.examples[0].en || !w.examples[0].zh) {
      const hw = w.headword;
      const def = w.definitionZh || '該商務項目';
      const cat = w.category || '辦公日常';

      if (!Array.isArray(w.examples) || w.examples.length === 0) {
        w.examples = [{
          id: `ex_1_${hw}`,
          en: `The management team implemented the standard procedures for ${hw} to ensure optimal operational efficiency.`,
          zh: `管理團隊落實了關於【${def}】的標準作業程序，以確保最佳營運效率。`,
          scenario: cat
        }];
      } else {
        if (!w.examples[0].en) {
          w.examples[0].en = `The management team implemented the standard procedures for ${hw} to ensure optimal operational efficiency.`;
        }
        if (!w.examples[0].zh) {
          w.examples[0].zh = `管理團隊落實了關於【${def}】的標準作業程序，以確保最佳營運效率。`;
        }
        if (!w.examples[0].scenario) {
          w.examples[0].scenario = cat;
        }
      }
      patchedInFile++;
      totalPatched++;
    }
  });

  if (patchedInFile > 0) {
    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`✅ [${f}] 完美補齊 ${patchedInFile} 筆第一例句！`);
  }
}

console.log(`🎉 全庫總計補齊 ${totalPatched} 筆！`);
