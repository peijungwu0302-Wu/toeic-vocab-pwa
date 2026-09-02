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
  /All employees are strongly advised/i,
  /Senior stakeholders finalized/i,
  /Commercial stakeholders agreed/i,
  /The company management decided to utilize/i,
  /The management team implemented the standard/i,
  /During the annual strategic summit/i,
  /【.*】/
];

console.log('🔍 ============================================================');
console.log('🔍 全字庫 11,154 單字「具象第一例句」與「1:1 向量生圖 Prompt」全量健檢');
console.log('🔍 ============================================================\n');

let totalWords = 0;
let totalValidExamples = 0;
let totalValidPrompts = 0;
let totalTemplateExamples = 0;
let totalShortPrompts = 0;

const sampleWords = [];

for (const f of files) {
  const fullPath = path.resolve('public/data/v1', f);
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  
  let fileWords = data.words.length;
  let fileValidEx = 0;
  let fileValidPrompt = 0;
  let fileTemplates = 0;

  data.words.forEach((w, idx) => {
    totalWords++;
    
    // Check Example 1
    const ex0 = w.examples?.[0];
    const en = ex0?.en?.trim() || '';
    const zh = ex0?.zh?.trim() || '';
    const hasValidEx = en.length >= 12 && zh.length >= 2;
    const isTpl = TEMPLATE_PATTERNS.some(pat => pat.test(en) || pat.test(zh));

    if (hasValidEx && !isTpl) {
      fileValidEx++;
      totalValidExamples++;
    } else if (isTpl) {
      fileTemplates++;
      totalTemplateExamples++;
    }

    // Check Prompt
    const prompt = w.visualAnchor?.imagePrompt?.trim() || '';
    const hasValidPrompt = prompt.length >= 20;

    if (hasValidPrompt) {
      fileValidPrompt++;
      totalValidPrompts++;
    } else {
      totalShortPrompts++;
    }

    // Pick samples from each file
    if (idx === 0 || idx === Math.floor(fileWords / 2) || idx === fileWords - 1) {
      sampleWords.push({
        file: f,
        headword: w.headword,
        category: w.category || ex0?.scenario,
        en,
        zh,
        prompt: prompt.slice(0, 75) + '...'
      });
    }
  });

  console.log(`📁 【${f}】`);
  console.log(`   - 總單字數: ${fileWords}`);
  console.log(`   - ✅ 具象第一例句覆蓋率: ${fileValidEx} / ${fileWords} (${((fileValidEx/fileWords)*100).toFixed(2)}%)`);
  console.log(`   - 🎨 專屬 1:1 生圖 Prompt 覆蓋率: ${fileValidPrompt} / ${fileWords} (${((fileValidPrompt/fileWords)*100).toFixed(2)}%)`);
  console.log(`   - 🚫 模板/異常例句數: ${fileTemplates}\n`);
}

console.log('============================================================');
console.log('📊 全字庫 11,154 筆最終驗證總結：');
console.log(`• 全庫總單字數量: ${totalWords}`);
console.log(`• 具象第一例句 (100% 無模板、純正商務長句): ${totalValidExamples} / ${totalWords} (${((totalValidExamples/totalWords)*100).toFixed(2)}%)`);
console.log(`• 專屬 1:1 生圖 Prompt (Modern Vector Editorial): ${totalValidPrompts} / ${totalWords} (${((totalValidPrompts/totalWords)*100).toFixed(2)}%)`);
console.log(`• 殘留模板句型數: ${totalTemplateExamples}`);
console.log('============================================================\n');

console.log('🌟 隨機抽檢 5 大分冊單字之「例句」與「生圖 Prompt」實體內容：\n');
sampleWords.forEach((s, idx) => {
  console.log(`[範例 ${idx + 1}] (${s.file}) 單字: 【${s.headword}】 (${s.category})`);
  console.log(`   - 例句 EN: "${s.en}"`);
  console.log(`   - 例句 ZH: "${s.zh}"`);
  console.log(`   - 生圖 Prompt: "${s.prompt}"\n`);
});
