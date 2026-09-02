import fs from 'node:fs';

const c1200 = JSON.parse(fs.readFileSync('public/data/v1/core-1200.json', 'utf8'));
const bad = c1200.words.filter(w => /All employees are strongly advised/i.test(w.examples?.[0]?.en || ''));
console.log('Single outlier:', bad);
if (bad.length > 0) {
  bad[0].examples = [{
    id: `ex_1_${bad[0].headword}`,
    en: `Please provide a valid ${bad[0].headword} when meeting with our international clients at the conference.`,
    zh: `在會議上與我們的國際客戶會面時，請提供有效且正式的【${bad[0].definitionZh}】。`,
    scenario: '日常商務'
  }];
  fs.writeFileSync('public/data/v1/core-1200.json', JSON.stringify(c1200, null, 2), 'utf8');
  console.log('Outlier fixed!');
}
