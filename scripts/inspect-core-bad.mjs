import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('public/data/v1/core-1200.json', 'utf8'));
const samples = ['activity', 'advertising', 'announced', 'apology', 'approved'];

samples.forEach(s => {
  const w = data.words.find(x => x.headword === s);
  console.log(`\nWord: ${s}`);
  console.log(JSON.stringify(w?.examples, null, 2));
});
