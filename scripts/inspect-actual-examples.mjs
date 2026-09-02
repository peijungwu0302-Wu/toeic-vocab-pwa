import fs from 'node:fs';

const c1200 = JSON.parse(fs.readFileSync('public/data/v1/core-1200.json', 'utf8'));
const courseC1200 = JSON.parse(fs.readFileSync('public/data/v1/courses/course-core-1200.json', 'utf8'));

console.log('--- Sample word 0 from core-1200.json ---');
console.log('headword:', c1200.words[0].headword);
console.log('examples.length:', c1200.words[0].examples.length);
console.log('examples:', JSON.stringify(c1200.words[0].examples, null, 2));

console.log('\n--- Sample word 0 from courses/course-core-1200.json ---');
console.log('headword:', courseC1200.words[0].headword);
console.log('examples.length:', courseC1200.words[0].examples.length);
console.log('examples:', JSON.stringify(courseC1200.words[0].examples, null, 2));

console.log('\n--- Sample word 10 from core-1200.json ---');
console.log('headword:', c1200.words[10].headword);
console.log('examples.length:', c1200.words[10].examples.length);
console.log('examples:', JSON.stringify(c1200.words[10].examples, null, 2));
