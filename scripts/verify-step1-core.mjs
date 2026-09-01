import fs from 'node:fs';
const data = JSON.parse(fs.readFileSync('public/data/v1/core-1200.json', 'utf8'));
console.log('Words in core-1200:', data.words.length);
let withImagePrompt = 0;
let withValidFirstExample = 0;

data.words.forEach(w => {
  if (w.visualAnchor && w.visualAnchor.imagePrompt && w.visualAnchor.imagePrompt.length > 10) {
    withImagePrompt++;
  }
  if (w.examples && w.examples[0] && w.examples[0].en && w.examples[0].zh) {
    withValidFirstExample++;
  }
});

console.log('Words with valid firstExample:', withValidFirstExample, '/', data.words.length);
console.log('Words with valid visualAnchor imagePrompt:', withImagePrompt, '/', data.words.length);
