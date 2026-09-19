import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const catalogPath = path.join(rootDir, 'public/data/v1/catalog.json');
const coursesDir = path.join(rootDir, 'public/data/v1/courses');
const outputPath = path.join(rootDir, 'public/data/v1/search-index.json');

console.log('[SearchIndexBuilder] Reading catalog from:', catalogPath);
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

const seen = new Map();
let totalOccurrences = 0;

for (const c of catalog.courses) {
  const filePath = path.join(coursesDir, c.fileName);
  if (!fs.existsSync(filePath)) {
    console.warn(`[SearchIndexBuilder] Warning: Course file ${c.fileName} not found, skipping.`);
    continue;
  }

  const courseData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const words = Array.isArray(courseData.words) ? courseData.words : [];

  for (const w of words) {
    totalOccurrences++;
    const key = (w.normalizedHeadword || w.headword || '').trim().toLowerCase();
    if (!key) continue;

    if (!seen.has(key)) {
      seen.set(key, {
        id: w.id,
        headword: w.headword,
        normalizedHeadword: key,
        definitionZh: w.definitionZh || '',
        category: w.category || '',
        toeicScoreRange: w.toeicScoreRange || '',
        partsOfSpeech: w.partsOfSpeech || [],
        phoneticUS: w.phoneticUS || null,
        sourceCourseId: c.id,
        sourceFileName: c.fileName
      });
    }
  }
}

const searchIndex = Array.from(seen.values());
const jsonOutput = JSON.stringify(searchIndex);

fs.writeFileSync(outputPath, jsonOutput, 'utf8');

console.log(`[SearchIndexBuilder] Successfully generated search-index.json:`);
console.log(` - Total words scanned: ${totalOccurrences}`);
console.log(` - Unique index entries: ${searchIndex.length}`);
console.log(` - Output size: ${(Buffer.byteLength(jsonOutput) / 1024 / 1024).toFixed(2)} MB (${Buffer.byteLength(jsonOutput)} bytes)`);
