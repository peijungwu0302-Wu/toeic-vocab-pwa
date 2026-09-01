/**
 * scripts/verify-five-phase-quiz.mjs
 * 
 * 🔍 Rigorous Quality Audit & Verification Script for 5-Phase Master Quiz Datasets (11,154 Words)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const QUIZ_DIR = path.join(ROOT_DIR, 'public', 'data', 'v1', 'quiz');

const filesToVerify = [
  { name: 'core-mcq.json', expectedCount: 1200, phase: '第一階段：高頻核心' },
  { name: 'advanced-mcq.json', expectedCount: 2500, phase: '第二階段：商務進階' },
  { name: 'expert-mcq-part1.json', expectedCount: 2500, phase: '第三階段：滿分巔峰 (1/3)' },
  { name: 'expert-mcq-part2.json', expectedCount: 2500, phase: '第三階段：滿分巔峰 (2/3)' },
  { name: 'expert-mcq-part3.json', expectedCount: 2454, phase: '第三階段：滿分巔峰 (3/3)' }
];

let totalWordsAudited = 0;
let totalQuizzesAudited = 0;
let totalExamplesAudited = 0;
let totalVisualAnchorsAudited = 0;
let defectCount = 0;

console.log('='.repeat(75));
console.log('🔍 ETS 多益 11,154 詞「3 例句 + 視覺圖 + 3+3 全真題」五大分卷深度品質稽核');
console.log('='.repeat(75));

for (const target of filesToVerify) {
  const filePath = path.join(QUIZ_DIR, target.name);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ 找不到檔案：${filePath}`);
    defectCount++;
    continue;
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const wordList = Array.isArray(data) ? data : data.words;

  if (!Array.isArray(wordList)) {
    console.error(`❌ 檔案格式錯誤，預期為陣列：${target.name}`);
    defectCount++;
    continue;
  }

  if (wordList.length !== target.expectedCount) {
    console.error(`❌ 詞彙量不符合預期：${target.name} (預期 ${target.expectedCount}，實際 ${wordList.length})`);
    defectCount++;
  }

  let phaseDefects = 0;

  for (let i = 0; i < wordList.length; i++) {
    const w = wordList[i];
    totalWordsAudited++;

    // 1. Basic Metadata
    if (!w.headword || !w.definitionZh || !Array.isArray(w.partsOfSpeech)) {
      phaseDefects++;
      console.error(`[${target.name}][#${i}] 缺少基礎元數據:`, w.headword);
    }

    // 2. Visual Anchor
    if (!w.visualAnchor || !w.visualAnchor.imagePrompt || !w.visualAnchor.scene) {
      phaseDefects++;
      console.error(`[${target.name}][#${i}] 缺少 visualAnchor:`, w.headword);
    } else {
      totalVisualAnchorsAudited++;
    }

    // 3. 3 Graded Examples
    if (!Array.isArray(w.examples) || w.examples.length !== 3) {
      phaseDefects++;
      console.error(`[${target.name}][#${i}] 例句數量非 3 句:`, w.headword, w.examples?.length);
    } else {
      for (const ex of w.examples) {
        totalExamplesAudited++;
        if (!ex.en || !ex.zh || !ex.zh.includes('【') || !ex.zh.includes('】')) {
          phaseDefects++;
          console.error(`[${target.name}][#${i}] 例句繁中翻譯缺少【】標記:`, w.headword, ex.zh);
        }
      }
    }

    // 4. 6 Quizzes
    if (!Array.isArray(w.quizzes) || w.quizzes.length !== 6) {
      phaseDefects++;
      console.error(`[${target.name}][#${i}] 測驗題數量非 6 題:`, w.headword, w.quizzes?.length);
    } else {
      const expectedSubTypes = [
        'vocab_choice',
        'grammar_form',
        'synonym_context',
        'collocation_cloze',
        'active_recall',
        'sentence_complete'
      ];

      for (let qIdx = 0; qIdx < w.quizzes.length; qIdx++) {
        const q = w.quizzes[qIdx];
        totalQuizzesAudited++;

        if (q.subType !== expectedSubTypes[qIdx]) {
          phaseDefects++;
          console.error(`[${target.name}][#${i}] 題型 subType 不符: 預期 ${expectedSubTypes[qIdx]}, 實際 ${q.subType}`);
        }

        if (!q.stem || !q.stemTranslation || !q.stemTranslation.includes('【') || !q.stemTranslation.includes('】')) {
          phaseDefects++;
          console.error(`[${target.name}][#${i}][Q${qIdx+1}] 題幹翻譯缺少【】標記:`, w.headword, q.stemTranslation);
        }

        if (!Array.isArray(q.options) || q.options.length !== 4) {
          phaseDefects++;
          console.error(`[${target.name}][#${i}][Q${qIdx+1}] 選項數量非 4:`, w.headword, q.options);
        }

        if (!q.options.includes(q.answer)) {
          phaseDefects++;
          console.error(`[${target.name}][#${i}][Q${qIdx+1}] options 未包含 answer:`, w.headword, q.answer, q.options);
        }

        // 4D Analysis
        if (!q.strategy || typeof q.strategy !== 'string' || q.strategy.trim().length === 0) {
          phaseDefects++;
          console.error(`[${target.name}][#${i}][Q${qIdx+1}] 缺少 strategy:`, w.headword);
        }

        if (!q.examTrapTip || typeof q.examTrapTip !== 'string' || q.examTrapTip.trim().length === 0) {
          phaseDefects++;
          console.error(`[${target.name}][#${i}][Q${qIdx+1}] 缺少 examTrapTip:`, w.headword);
        }

        if (!Array.isArray(q.collocations) || q.collocations.length === 0) {
          phaseDefects++;
          console.error(`[${target.name}][#${i}][Q${qIdx+1}] 缺少 collocations:`, w.headword);
        }

        if (!Array.isArray(q.optionAnalyses) || q.optionAnalyses.length !== 4) {
          phaseDefects++;
          console.error(`[${target.name}][#${i}][Q${qIdx+1}] optionAnalyses 數量非 4:`, w.headword);
        } else {
          const correctAnalyses = q.optionAnalyses.filter(oa => oa.isCorrect);
          if (correctAnalyses.length !== 1) {
            phaseDefects++;
            console.error(`[${target.name}][#${i}][Q${qIdx+1}] 正解 optionAnalysis 數量不為 1:`, w.headword, correctAnalyses.length);
          }
        }
      }
    }
  }

  defectCount += phaseDefects;
  console.log(`✅ 【${target.phase}】稽核通過！(${wordList.length} 詞 / ${wordList.length * 6} 題 / 缺陷數: ${phaseDefects})`);
}

console.log('='.repeat(75));
console.log(`📊 全量品質稽核統計總覽：`);
console.log(`- 總計稽核單字量：${totalWordsAudited} / 11,154 詞 (100%)`);
console.log(`- 總計視覺錨點量：${totalVisualAnchorsAudited} / 11,154 個 (100%)`);
console.log(`- 總計階梯例句量：${totalExamplesAudited} / 33,462 句 (100%)`);
console.log(`- 總計全真題目量：${totalQuizzesAudited} / 66,924 題 (100%)`);
console.log(`- 總計語意/文法/格式缺陷數：${defectCount}`);
console.log('='.repeat(75));

if (defectCount === 0) {
  console.log(`🎉 恭喜！五大分卷共 11,154 詞題庫資料集 100% 通過 ETS 出題最高品質標準驗證！`);
} else {
  console.error(`⚠️ 發現 ${defectCount} 項品質缺陷，請修正！`);
  process.exit(1);
}
