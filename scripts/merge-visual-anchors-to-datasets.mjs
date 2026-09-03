// scripts/merge-visual-anchors-to-datasets.mjs
import fs from 'fs';
import path from 'path';

const ROOT_DIR = process.cwd();
const CACHE_FILE = path.join(ROOT_DIR, 'scripts', '.cache_visual_anchors_non_core.json');
const DATA_DIR = path.join(ROOT_DIR, 'public', 'data', 'v1');

if (!fs.existsSync(CACHE_FILE)) {
  console.error(`❌ Cache file not found: ${CACHE_FILE}`);
  process.exit(1);
}

const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
const cacheEntries = Object.values(cache);
console.log(`📦 Loaded ${cacheEntries.length} enriched visual anchors from cache.`);

const cacheById = new Map();
const cacheByHeadword = new Map();

for (const item of cacheEntries) {
  if (item.id) cacheById.set(item.id, item);
  if (item.headword) cacheByHeadword.set(item.headword.toLowerCase().trim(), item);
}

const NON_CORE_FILES = [
  'advanced-2500.json',
  'expert-high-part1.json',
  'expert-high-part2.json',
  'expert-high-part3.json'
];

let totalUpdated = 0;
let totalWords = 0;

for (const fileName of NON_CORE_FILES) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️ File not found: ${fileName}`);
    continue;
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const words = raw.words || [];
  let fileUpdated = 0;

  for (const word of words) {
    totalWords++;
    const norm = (word.headword || '').toLowerCase().trim();
    const enriched = cacheById.get(word.id) || cacheByHeadword.get(norm);

    if (enriched && enriched.shortEn && enriched.imagePrompt) {
      // 1. Update visualAnchor
      word.visualAnchor = {
        imagePrompt: enriched.imagePrompt,
        scene: enriched.shortZh || word.visualAnchor?.scene || word.definitionZh,
        shortEn: enriched.shortEn
      };

      // 2. Update or insert primary example (ex_1) with 10-15 word lifestyle sentence
      if (!Array.isArray(word.examples)) {
        word.examples = [];
      }

      if (word.examples.length > 0) {
        word.examples[0] = {
          ...word.examples[0],
          id: word.examples[0].id || 'ex_1',
          en: enriched.shortEn,
          zh: enriched.shortZh || word.examples[0].zh,
          scenario: '生活具象'
        };
      } else {
        word.examples.push({
          id: 'ex_1',
          en: enriched.shortEn,
          zh: enriched.shortZh || word.definitionZh,
          scenario: '生活具象'
        });
      }

      fileUpdated++;
      totalUpdated++;
    }
  }

  // Save updated file
  fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf8');
  console.log(`✅ [${fileName}]: Successfully updated ${fileUpdated}/${words.length} words.`);
}

console.log(`\n=================================================================`);
console.log(`🎉 Merge Completed! Total words updated: ${totalUpdated} / ${totalWords}`);
console.log(`🛡️ core-1200.json was STRICTLY untouched and 100% protected.`);
console.log(`=================================================================\n`);
