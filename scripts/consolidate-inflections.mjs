#!/usr/bin/env node
/**
 * scripts/consolidate-inflections.mjs
 * 
 * Deep Linguistic Lemmatization & Consolidation Engine for TOEIC Non-Core Courses.
 * 
 * Merges mechanical inflections (-s, -ed, -ing) into root headwords while strictly
 * preserving specialized lexical items with independent TOEIC grammar points.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'public', 'data', 'v1');
const COURSES_DIR = path.join(DATA_DIR, 'courses');
const CATALOG_FILE = path.join(DATA_DIR, 'catalog.json');

// Whitelist of words that MUST be preserved as independent cards due to
// distinct part-of-speech (prep/adj/noun) or specialized TOEIC testing points.
const PRESERVE_WHITELIST = new Set([
  'including', 'advanced', 'limited', 'interested', 'interesting', 'excited', 'exciting',
  'pleased', 'pleasing', 'customs', 'facilities', 'instructions', 'savings', 'earnings',
  'belongings', 'premises', 'surroundings', 'headquarters', 'authorities', 'leading',
  'demanding', 'promising', 'missing', 'existing', 'outstanding', 'complicated', 'detailed',
  'customized', 'experienced', 'opening', 'gathering', 'training', 'marketing', 'accounting',
  'advertising', 'processing', 'shipping', 'handling', 'briefing', 'lodging', 'billing',
  'funding', 'pricing', 'staffing', 'filing', 'monitoring', 'tracking', 'scheduling',
  'warning', 'meeting', 'building', 'clothing', 'living', 'feeling', 'meaning', 'clearing',
  'ranking', 'setting', 'standing', 'drawing', 'painting', 'findings', 'proceedings',
  'writings', 'dealings', 'holdings', 'offerings', 'readings', 'savings', 'spendings',
  'supplies', 'goods', 'assets', 'resources', 'materials', 'records', 'terms', 'rates',
  'sales', 'funds', 'operations', 'services', 'products', 'standards', 'measures',
  'regulations', 'guidelines', 'procedures', 'duties', 'rights', 'orders', 'shares',
  'interests', 'returns', 'damages', 'charges', 'fees', 'costs', 'expenses', 'benefits'
]);

export function runConsolidation() {
  console.log('🚀 啟動多益非核心題庫「詞元精煉與去冗餘」作業...');

  if (!fs.existsSync(COURSES_DIR)) {
    throw new Error(`Course directory not found: ${COURSES_DIR}`);
  }

  const courseFiles = fs.readdirSync(COURSES_DIR).filter(f => f.endsWith('.json'));
  let totalConsolidatedWords = 0;
  let totalPreservedWhitelisted = 0;
  const courseReport = [];
  const courseChecksumMap = new Map();

  for (const file of courseFiles) {
    // 嚴格保留 core-1200，絕不更動
    if (file === 'course-core-1200.json') {
      const coreData = JSON.parse(fs.readFileSync(path.join(COURSES_DIR, file), 'utf8'));
      const sha256 = crypto.createHash('sha256').update(JSON.stringify(coreData), 'utf8').digest('hex');
      courseChecksumMap.set(coreData.id, {
        sha256,
        version: coreData.version || 6,
        wordCount: coreData.words?.length || 1200,
        sizeBytes: fs.statSync(path.join(COURSES_DIR, file)).size
      });
      continue;
    }

    const filePath = path.join(COURSES_DIR, file);
    const courseData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const initialCount = (courseData.words || []).length;
    const words = courseData.words || [];

    // 建立目前課程的單字索引表 (小寫 headword -> word object)
    const wordMap = new Map();
    words.forEach(w => {
      const hw = (w.headword || '').trim().toLowerCase();
      if (hw) wordMap.set(hw, w);
    });

    const wordsToRemove = new Set();
    const mergeDetails = [];

    for (const w of words) {
      const hw = (w.headword || '').trim().toLowerCase();
      if (!hw) continue;

      // 檢查白名單保護
      if (PRESERVE_WHITELIST.has(hw)) {
        totalPreservedWhitelisted++;
        continue;
      }

      let root = null;
      let inflectionCategory = null;

      // 1. 判定 -s / -es / -ies
      if (hw.length > 3 && hw.endsWith('s') && !['ss', 'us', 'is', 'as'].some(x => hw.endsWith(x))) {
        if (wordMap.has(hw.slice(0, -1))) {
          root = hw.slice(0, -1);
          inflectionCategory = '-s';
        } else if (hw.endsWith('es') && wordMap.has(hw.slice(0, -2))) {
          root = hw.slice(0, -2);
          inflectionCategory = '-es';
        } else if (hw.endsWith('ies') && wordMap.has(hw.slice(0, -3) + 'y')) {
          root = hw.slice(0, -3) + 'y';
          inflectionCategory = '-ies';
        }
      }

      // 2. 判定 -ed / -d / -ied
      if (!root && hw.length > 4 && hw.endsWith('ed')) {
        if (wordMap.has(hw.slice(0, -1))) {
          root = hw.slice(0, -1);
          inflectionCategory = '-d';
        } else if (wordMap.has(hw.slice(0, -2))) {
          root = hw.slice(0, -2);
          inflectionCategory = '-ed';
        } else if (hw.endsWith('ied') && wordMap.has(hw.slice(0, -3) + 'y')) {
          root = hw.slice(0, -3) + 'y';
          inflectionCategory = '-ied';
        }
      }

      // 3. 判定 -ing
      if (!root && hw.length > 5 && hw.endsWith('ing')) {
        if (wordMap.has(hw.slice(0, -3))) {
          root = hw.slice(0, -3);
          inflectionCategory = '-ing';
        } else if (wordMap.has(hw.slice(0, -3) + 'e')) {
          root = hw.slice(0, -3) + 'e';
          inflectionCategory = '-ing';
        }
      }

      // 執行安全吸收合併
      if (root && root !== hw && wordMap.has(root) && !wordsToRemove.has(root)) {
        const rootWord = wordMap.get(root);

        // 確保原型具備 wordForms 與 inflections 標註
        if (!rootWord.inflections) {
          rootWord.inflections = {};
        }
        if (inflectionCategory === '-s' || inflectionCategory === '-es' || inflectionCategory === '-ies') {
          rootWord.inflections.s = hw;
        } else if (inflectionCategory === '-ed' || inflectionCategory === '-d' || inflectionCategory === '-ied') {
          rootWord.inflections.ed = hw;
        } else if (inflectionCategory === '-ing') {
          rootWord.inflections.ing = hw;
        }

        // 吸收優質商務例句 (若原型例句少於 4 句，將變體之例句納入)
        if (Array.isArray(w.examples) && Array.isArray(rootWord.examples) && rootWord.examples.length < 5) {
          for (const ex of w.examples) {
            const isDuplicateEx = rootWord.examples.some(rEx => rEx.en === ex.en);
            if (!isDuplicateEx && rootWord.examples.length < 5) {
              rootWord.examples.push({
                id: `ex_merged_${rootWord.examples.length + 1}`,
                en: ex.en,
                zh: ex.zh,
                scenario: ex.scenario || '商務情境拓展'
              });
            }
          }
        }

        wordsToRemove.add(hw);
        mergeDetails.push({ inflected: hw, root, category: inflectionCategory });
      }
    }

    // 剔除重複字，保留精煉後的清單
    const refinedWords = words.filter(w => !wordsToRemove.has((w.headword || '').trim().toLowerCase()));
    courseData.words = refinedWords;
    courseData.wordCount = refinedWords.length;
    courseData.version = (courseData.version || 6) + 1;

    // 寫入更新後檔案
    const updatedContent = JSON.stringify(courseData);
    fs.writeFileSync(filePath, updatedContent, 'utf8');

    const newSizeBytes = fs.statSync(filePath).size;
    const sha256 = crypto.createHash('sha256').update(updatedContent, 'utf8').digest('hex');

    courseChecksumMap.set(courseData.id, {
      sha256,
      version: courseData.version,
      wordCount: refinedWords.length,
      sizeBytes: newSizeBytes
    });

    totalConsolidatedWords += wordsToRemove.size;
    courseReport.push({
      file,
      id: courseData.id,
      title: courseData.title,
      before: initialCount,
      after: refinedWords.length,
      mergedCount: wordsToRemove.size,
      samples: mergeDetails.slice(0, 5)
    });

    console.log(`  ✓ [${file}] 原 ${initialCount} 詞 ➔ 精煉為 ${refinedWords.length} 詞 (吸收 -${wordsToRemove.size})`);
  }

  // 更新 catalog.json
  if (fs.existsSync(CATALOG_FILE)) {
    console.log(`\n📑 正在同步 catalog.json 統計資訊與校驗碼...`);
    const catalogData = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
    catalogData.version = (catalogData.version || 6) + 1;
    catalogData.generatedAt = new Date().toISOString();

    let newTotalWords = 0;
    if (Array.isArray(catalogData.courses)) {
      catalogData.courses.forEach(c => {
        const info = courseChecksumMap.get(c.id);
        if (info) {
          c.wordCount = info.wordCount;
          c.version = info.version;
          c.checksumSha256 = info.sha256;
          c.sha256 = info.sha256;
          c.sizeBytes = info.sizeBytes;
          newTotalWords += info.wordCount;
        } else {
          newTotalWords += (c.wordCount || 0);
        }
      });
    }

    catalogData.totalWords = newTotalWords;
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalogData, null, 2), 'utf8');
    console.log(`✅ catalog.json (v${catalogData.version}) 更新儲存成功！全庫精煉後總詞數: ${newTotalWords}`);
  }

  console.log(`\n============================================================`);
  console.log(`🎉 題庫精煉作業全部完成！`);
  console.log(`- 成功吸收合併純屈折單字：${totalConsolidatedWords} 個`);
  console.log(`- 嚴格保護的多益核心特殊詞（介系詞/形容詞/名詞）：${totalPreservedWhitelisted} 筆次`);
  console.log(`============================================================\n`);

  return { totalConsolidatedWords, totalPreservedWhitelisted, courseReport };
}

runConsolidation();
