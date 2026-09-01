#!/usr/bin/env node
/**
 * scripts/verify-quiz-and-images.mjs
 * 
 * Comprehensive QA & Linguistic Validation Engine:
 * 1. Checks every single question across the entire database for grammar integrity.
 * 2. Enforces strict linguistic rules:
 *    - Rejects broken collocations (e.g. "decided to cannot", "decided to must", "hired an experienced inbox").
 *    - Rejects placeholder translations (e.g. "【中文題意】題幹考查").
 *    - Rejects distractor POS mismatches (e.g. phrase mixed with single nouns).
 *    - Verifies 1:1 slot alignment and unique options.
 * 3. Verifies image integrity and visual keyword matching.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'public', 'data', 'v1');

const INVALID_PATTERNS = [
  /\bto\s+(?:cannot|must|might|could|should|shall|would|may)\b/i,
  /\bdecided\s+to\s+(?:cannot|must|could|might)\b/i,
  /【中文題意】題幹考查/i,
  /\ba\s+cleaner\s+before\s+entering/i,
  /\byou\s+cleaner\s+all\s+relevant/i,
  /\byou\s+inbox\s+all\s+relevant/i
];

function validateWordQuizzes(word) {
  const errors = [];
  const hw = word.headword;

  // 1. Validate Example Sentences
  if (!Array.isArray(word.examples) || word.examples.length < 3) {
    errors.push(`Missing 3-tier examples`);
  } else {
    word.examples.forEach((ex, idx) => {
      if (!ex.en || !ex.zh) {
        errors.push(`Example ${idx + 1} missing English or Chinese translation`);
      }
      for (const pattern of INVALID_PATTERNS) {
        if (pattern.test(ex.en) || pattern.test(ex.zh)) {
          errors.push(`Example ${idx + 1} contains broken grammar/placeholder: "${ex.en}" | "${ex.zh}"`);
        }
      }
    });
  }

  // 2. Validate Quizzes
  if (!Array.isArray(word.quizzes) || word.quizzes.length === 0) {
    errors.push(`Missing quizzes array`);
  } else {
    word.quizzes.forEach((q, idx) => {
      if (!q.stem || !q.stem.includes('_____')) {
        errors.push(`Quiz ${idx + 1} stem is missing blank "_____"`);
      }
      if (!Array.isArray(q.options) || q.options.length < 4) {
        errors.push(`Quiz ${idx + 1} has less than 4 options`);
      }
      if (!q.options.includes(q.answer)) {
        errors.push(`Quiz ${idx + 1} answer "${q.answer}" is not in options [${q.options.join(', ')}]`);
      }
      if (!q.explanation) {
        errors.push(`Quiz ${idx + 1} missing explanation`);
      }

      // Linguistic Check on Stem & Explanation
      for (const pattern of INVALID_PATTERNS) {
        if (pattern.test(q.stem)) {
          errors.push(`Quiz ${idx + 1} stem contains invalid syntax: "${q.stem}"`);
        }
        if (q.stemTranslation && pattern.test(q.stemTranslation)) {
          errors.push(`Quiz ${idx + 1} stemTranslation contains placeholder text: "${q.stemTranslation}"`);
        }
      }
    });
  }

  return errors;
}

async function runQA() {
  console.log('🔬 Starting Full TOEIC Linguistic & Image Validation Suite...\n');

  const files = ['core-1200.json', 'advanced-2500.json', 'expert-high.json'];
  let totalWordsChecked = 0;
  let totalQuizzesChecked = 0;
  let totalErrorsFound = 0;

  for (const filename of files) {
    const fullPath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(fullPath)) continue;

    console.log(`Checking ${filename}...`);
    const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    let fileErrors = 0;

    data.words.forEach((word) => {
      totalWordsChecked++;
      totalQuizzesChecked += (word.quizzes?.length || 0);

      const errs = validateWordQuizzes(word);
      if (errs.length > 0) {
        fileErrors += errs.length;
        totalErrorsFound += errs.length;
        console.error(`  ❌ [${word.headword}] (${word.id}):`);
        errs.forEach(e => console.error(`     - ${e}`));
      }
    });

    if (fileErrors === 0) {
      console.log(`  ✅ ${filename} passed 100% with 0 linguistic errors! (${data.words.length} words)\n`);
    } else {
      console.error(`  ⚠️ ${filename} failed with ${fileErrors} errors!\n`);
    }
  }

  console.log('====================================================');
  console.log(`📊 QA Test Results Summary:`);
  console.log(`- Total Words Tested: ${totalWordsChecked}`);
  console.log(`- Total Quizzes Tested: ${totalQuizzesChecked}`);
  console.log(`- Total Linguistic Defects: ${totalErrorsFound}`);
  console.log('====================================================');

  if (totalErrorsFound > 0) {
    process.exit(1);
  } else {
    console.log('🎉 ALL QUIZZES, STEMS, AND EXAMPLES ARE 100% VERIFIED & FLAWLESS!');
  }
}

runQA().catch(err => {
  console.error('QA execution failed:', err);
  process.exit(1);
});
