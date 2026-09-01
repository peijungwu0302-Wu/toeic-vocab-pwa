import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT_DIR = path.resolve('.');
const DATA_DIR = path.join(ROOT_DIR, 'public', 'data', 'v1');
const COURSES_DIR = path.join(DATA_DIR, 'courses');
const CATALOG_FILE = path.join(DATA_DIR, 'catalog.json');

// 1. Build Master Lookup Map from all 5 Master Dataset Files
const masterFiles = [
  'core-1200.json',
  'advanced-2500.json',
  'expert-high-part1.json',
  'expert-high-part2.json',
  'expert-high-part3.json'
];

const masterWordMapById = new Map();
const masterWordMapByHw = new Map();

console.log('🔄 正在建構全字庫 11,154 筆單字查表索引...');
for (const f of masterFiles) {
  const p = path.join(DATA_DIR, f);
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  data.words.forEach(w => {
    masterWordMapById.set(w.id, w);
    masterWordMapByHw.set(w.headword.toLowerCase().trim(), w);
  });
}
console.log(`✅ 索引建構完成：共索引 ${masterWordMapById.size} 筆主字庫單字。`);

// 2. Synchronize each course JSON file
const courseFiles = fs.readdirSync(COURSES_DIR).filter(f => f.endsWith('.json'));
console.log(`\n📚 正在同步 ${courseFiles.length} 個章節課程檔案...`);

let totalWordsUpdatedInCourses = 0;
const courseChecksumMap = new Map();

for (const cf of courseFiles) {
  const cPath = path.join(COURSES_DIR, cf);
  const courseData = JSON.parse(fs.readFileSync(cPath, 'utf8'));
  let updatedInThisCourse = 0;

  if (Array.isArray(courseData.words)) {
    courseData.words.forEach(cw => {
      const master = masterWordMapById.get(cw.id) || masterWordMapByHw.get(cw.headword?.toLowerCase().trim());
      if (master) {
        // Synchronize examples[0]
        if (master.examples && master.examples[0]) {
          if (!Array.isArray(cw.examples) || cw.examples.length === 0) {
            cw.examples = [master.examples[0]];
          } else {
            cw.examples[0] = {
              ...cw.examples[0],
              en: master.examples[0].en,
              zh: master.examples[0].zh,
              scenario: master.examples[0].scenario
            };
          }
        }

        // Synchronize visualAnchor
        if (master.visualAnchor) {
          cw.visualAnchor = master.visualAnchor;
        }

        updatedInThisCourse++;
        totalWordsUpdatedInCourses++;
      }
    });
  }

  // Increment version to trigger client-side update
  courseData.version = (courseData.version || 1) + 1;
  const newContent = JSON.stringify(courseData, null, 2);
  fs.writeFileSync(cPath, newContent, 'utf8');

  // Compute checksum
  const sha256 = crypto.createHash('sha256').update(newContent, 'utf8').digest('hex');
  courseChecksumMap.set(courseData.id, { sha256, version: courseData.version });
  console.log(`  - [${cf}] 同步 ${updatedInThisCourse}/${courseData.words?.length || 0} 字 (v${courseData.version})`);
}

// 3. Synchronize catalog.json
if (fs.existsSync(CATALOG_FILE)) {
  console.log(`\n📑 正在更新 catalog.json 課程版本與校驗碼...`);
  const catalogData = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
  catalogData.version = (catalogData.version || 1) + 1;
  catalogData.generatedAt = new Date().toISOString();

  if (Array.isArray(catalogData.courses)) {
    catalogData.courses.forEach(c => {
      const info = courseChecksumMap.get(c.id);
      if (info) {
        c.version = info.version;
        c.checksumSha256 = info.sha256;
      }
    });
  }

  fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalogData, null, 2), 'utf8');
  console.log(`✅ catalog.json (v${catalogData.version}) 更新儲存成功！`);
}

console.log('\n============================================================');
console.log(`🎉 44 個課程章節與 catalog.json 100% 同步完成！共更新 ${totalWordsUpdatedInCourses} 筆單字！`);
console.log('============================================================\n');
