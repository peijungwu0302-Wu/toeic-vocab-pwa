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
if (!fs.existsSync(catalogPath)) {
  console.error(`[SearchIndexBuilder] Invariant Violation: Catalog file not found: ${catalogPath}`);
  process.exit(1);
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
if (!Array.isArray(catalog.courses) || catalog.courses.length === 0) {
  console.error('[SearchIndexBuilder] Invariant Violation: Catalog courses list is empty or invalid.');
  process.exit(1);
}

const seen = new Map();
let totalOccurrences = 0;

for (const c of catalog.courses) {
  const filePath = path.join(coursesDir, c.fileName);
  if (!fs.existsSync(filePath)) {
    console.error(`[SearchIndexBuilder] Invariant Violation: Course file ${c.fileName} not found for course ${c.id}`);
    process.exit(1);
  }

  const courseData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (courseData.id !== c.id) {
    console.error(`[SearchIndexBuilder] Invariant Violation: Course internal id '${courseData.id}' does not match catalog id '${c.id}' in ${c.fileName}`);
    process.exit(1);
  }

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
    } else {
      const existing = seen.get(key);
      if (existing.id !== w.id) {
        console.error(
          `[SearchIndexBuilder] Invariant Violation: Conflict detected for '${key}'. Existing wordId '${existing.id}' in ${existing.sourceFileName} !== new wordId '${w.id}' in ${c.fileName}`
        );
        process.exit(1);
      }
    }
  }
}

const searchIndex = Array.from(seen.values());
const jsonOutput = JSON.stringify(searchIndex);

// Atomic write with temp file
const tempOutput = `${outputPath}.tmp`;
fs.writeFileSync(tempOutput, jsonOutput, 'utf8');
fs.renameSync(tempOutput, outputPath);

console.log(`[SearchIndexBuilder] Successfully generated search-index.json:`);
console.log(` - Total courses validated: ${catalog.courses.length}`);
console.log(` - Total words scanned: ${totalOccurrences}`);
console.log(` - Unique index entries: ${searchIndex.length}`);
console.log(` - Output size: ${(Buffer.byteLength(jsonOutput) / 1024 / 1024).toFixed(2)} MB (${Buffer.byteLength(jsonOutput)} bytes)`);
