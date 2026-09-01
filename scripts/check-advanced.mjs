import fs from 'node:fs';
const data = JSON.parse(fs.readFileSync('public/data/v1/advanced-2500.json', 'utf8'));
let count = 0;
data.words.forEach(w => {
  if (w.visualAnchor && w.visualAnchor.imagePrompt) count++;
});
console.log('Words with visualAnchor in advanced-2500.json:', count, '/', data.words.length);
console.log('Sample word:', JSON.stringify(data.words[0].examples[0], null, 2));
console.log('Sample prompt:', data.words[0].visualAnchor.imagePrompt);
