import fs from 'node:fs';

const files = ['core-1200.json', 'advanced-2500.json', 'expert-high.json'];
for (const f of files) {
  const p = `public/data/v1/${f}`;
  if (fs.existsSync(p)) {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const found = data.words.find(w => w.headword.toLowerCase() === 'decade');
    if (found) {
      console.log(`=== Found decade in ${f} ===`);
      console.log('partsOfSpeech:', found.partsOfSpeech);
      console.log('definitionZh:', found.definitionZh);
      console.log('quizzes:', JSON.stringify(found.quizzes, null, 2));
    }
  }
}
