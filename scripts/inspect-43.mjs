import fs from 'node:fs';

const c1200 = JSON.parse(fs.readFileSync('public/data/v1/core-1200.json', 'utf8'));
const TEMPLATE_PATTERN = /During the annual strategic summit|The newly revised operational guideline|All employees are strongly advised/i;

const remaining = c1200.words.filter(w => w.examples && w.examples[0] && TEMPLATE_PATTERN.test(w.examples[0].en));
console.log('Words matching regex:', remaining.length);
remaining.forEach(r => {
  console.log(`${r.headword}: ${r.examples[0].en}`);
});
