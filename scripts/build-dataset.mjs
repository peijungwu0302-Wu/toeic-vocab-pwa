#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const RAW_DATA_DIR = path.join(ROOT_DIR, 'data-raw');
const RAW_FILE = path.join(RAW_DATA_DIR, 'toeic_vocabulary.json');

const OUTPUT_BASE = path.join(ROOT_DIR, 'public', 'data', 'v1');
const COURSES_DIR = path.join(OUTPUT_BASE, 'courses');

function computeChecksum(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function normalizeText(str) {
  if (!str) return '';
  return str.normalize('NFC').trim();
}

function detectEntryType(headword, rawPartsOfSpeech = []) {
  const norm = headword.trim();
  const lower = norm.toLowerCase();

  // Pattern detection (placeholders, grammatical patterns)
  if (
    lower.includes('...') ||
    /\b(sb|sth|a be|a and b|either.*or|neither.*nor|not only.*but also|so.*that|too.*to)\b/i.test(lower) ||
    /^[A-Z]\s+(be|and|or|is|are|was|were)\s+[A-Z]/i.test(norm)
  ) {
    return 'pattern';
  }

  // Phrase detection
  if (norm.includes(' ') || norm.includes('-') || rawPartsOfSpeech.some(p => String(p).toLowerCase().includes('phrase') || String(p).toLowerCase().includes('idiom'))) {
    return 'phrase';
  }

  return 'word';
}

function generateDeterministicId(headword, entryType) {
  const normalized = headword.toLowerCase().trim().replace(/\s+/g, ' ');
  const hash = crypto.createHash('sha256').update(`${normalized}:${entryType}`).digest('hex');
  return `tw_${entryType[0]}_${hash.slice(0, 12)}`;
}

function normalizeScoreRange(rawRange) {
  if (!rawRange) return '600-780';
  const str = String(rawRange).trim();
  if (str.includes('400') || str.includes('500') || str.includes('基礎') || str.includes('初級')) return '400-600';
  if (str.includes('600') || str.includes('700') || str.includes('780') || str.includes('中級')) return '600-780';
  if (str.includes('780') || str.includes('800') || str.includes('860') || str.includes('900') || str.includes('中高級')) return '780-900';
  if (str.includes('900') || str.includes('990') || str.includes('高級') || str.includes('精通')) return '900+';
  return str;
}

function cleanWordEntry(raw, index) {
  const headword = normalizeText(raw.english_word || raw.headword || raw.word || '');
  if (!headword) {
    return { error: `Row #${index}: Missing headword` };
  }

  const definitionZh = normalizeText(raw.chinese_definition || raw.definitionZh || raw.definition || raw.meaning || '');
  if (!definitionZh) {
    return { error: `Row #${index} (${headword}): Missing Chinese definition` };
  }

  const rawPOS = Array.isArray(raw.parts_of_speech)
    ? raw.parts_of_speech.map(p => normalizeText(p)).filter(Boolean)
    : (raw.parts_of_speech ? [normalizeText(raw.parts_of_speech)] : []);

  const entryType = detectEntryType(headword, rawPOS);
  const normalizedHeadword = headword.toLowerCase().replace(/\s+/g, ' ');
  const id = generateDeterministicId(normalizedHeadword, entryType);

  let starRating = Number(raw.star_rating || raw.starRating || 3);
  if (![1, 2, 3, 4, 5].includes(starRating)) {
    starRating = Math.max(1, Math.min(5, Math.round(starRating) || 3));
  }

  const toeicScoreRange = normalizeScoreRange(raw.toeic_score_range || raw.toeicScoreRange);
  const category = normalizeText(raw.category || '商業綜合') || '商業綜合';

  // Word forms
  const wordForms = [];
  if (Array.isArray(raw.word_forms)) {
    for (const wf of raw.word_forms) {
      if (wf && wf.part_of_speech && Array.isArray(wf.forms)) {
        wordForms.push({
          partOfSpeech: normalizeText(wf.part_of_speech),
          forms: wf.forms.map(f => normalizeText(f)).filter(Boolean)
        });
      }
    }
  }

  // Examples
  const examples = [];
  if (Array.isArray(raw.examples)) {
    raw.examples.forEach((ex, exIdx) => {
      const eng = normalizeText(ex.english || ex.eng || '');
      const chi = normalizeText(ex.chinese || ex.zh || ex.chi || '');
      if (eng || chi) {
        examples.push({
          id: `${id}_ex_${exIdx + 1}`,
          english: eng,
          chinese: chi
        });
      }
    });
  }

  // Exam tips
  const examTips = Array.isArray(raw.exam_tips)
    ? raw.exam_tips.map(t => normalizeText(t)).filter(Boolean)
    : (raw.examTips ? raw.examTips.map(t => normalizeText(t)).filter(Boolean) : []);

  const phoneticUS = normalizeText(raw.phonetic_us || raw.phoneticUS || raw.ipa_us || '') || null;
  const phoneticUK = normalizeText(raw.phonetic_uk || raw.phoneticUK || raw.ipa_uk || '') || null;
  const audioUSUrl = normalizeText(raw.audio_us_url || raw.audioUSUrl || '') || null;
  const audioUKUrl = normalizeText(raw.audio_uk_url || raw.audioUKUrl || '') || null;

  return {
    entry: {
      id,
      headword,
      normalizedHeadword,
      entryType,
      definitionZh,
      starRating,
      toeicScoreRange,
      category,
      partsOfSpeech: rawPOS.length > 0 ? rawPOS : [entryType],
      wordForms,
      phoneticUS,
      phoneticUK,
      examples,
      examTips,
      audioUSUrl,
      audioUKUrl
    }
  };
}

async function buildDataset() {
  console.log('[ETL] Starting dataset build...');

  if (!fs.existsSync(RAW_FILE)) {
    console.log('[ETL] Raw data file not found, running download script first...');
    const downloadScript = path.join(__dirname, 'download-dataset.mjs');
    const { execSync } = await import('node:child_process');
    execSync(`node "${downloadScript}"`, { stdio: 'inherit' });
  }

  const rawContent = fs.readFileSync(RAW_FILE, 'utf8');
  let rawData;
  try {
    rawData = JSON.parse(rawContent);
  } catch (err) {
    console.error(`[ETL] Failed to parse raw JSON: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(rawData)) {
    console.error('[ETL] Expected raw data to be a JSON array.');
    process.exit(1);
  }

  const seenMap = new Map();
  const validEntries = [];
  const rejectedRows = [];
  let missingDefinitions = 0;
  let missingExamples = 0;

  const categoryStats = {};
  const starStats = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const scoreStats = {};
  const entryTypeStats = { word: 0, phrase: 0, pattern: 0 };

  rawData.forEach((item, index) => {
    const result = cleanWordEntry(item, index);
    if (result.error) {
      rejectedRows.push({ row: item, reason: result.error });
      return;
    }

    const entry = result.entry;
    const dedupeKey = `${entry.normalizedHeadword}:::${entry.entryType}`;
    if (seenMap.has(dedupeKey)) {
      // Merge examples if new ones exist
      const existing = seenMap.get(dedupeKey);
      if (existing.examples.length === 0 && entry.examples.length > 0) {
        existing.examples = entry.examples;
      }
      return;
    }

    seenMap.set(dedupeKey, entry);
    validEntries.push(entry);

    if (!entry.definitionZh) missingDefinitions++;
    if (entry.examples.length === 0) missingExamples++;

    categoryStats[entry.category] = (categoryStats[entry.category] || 0) + 1;
    starStats[entry.starRating] = (starStats[entry.starRating] || 0) + 1;
    scoreStats[entry.toeicScoreRange] = (scoreStats[entry.toeicScoreRange] || 0) + 1;
    entryTypeStats[entry.entryType] = (entryTypeStats[entry.entryType] || 0) + 1;
  });

  console.log(`[ETL] Processed ${rawData.length} raw rows -> ${validEntries.length} valid unique entries.`);

  // Create course chunks
  // We divide into curated courses by Score Range and Core Categories
  const coursesMap = new Map();

  function getOrCreateCourse(id, title, description, toeicScoreRange, category, level) {
    if (!coursesMap.has(id)) {
      coursesMap.set(id, {
        id,
        title,
        description,
        toeicScoreRange,
        category,
        level,
        version: 1,
        words: []
      });
    }
    return coursesMap.get(id);
  }

  // Pre-define standard TOEIC level courses
  const SCORE_TIERS = [
    {
      range: '400-600',
      id: 'course-foundation-550',
      title: '基礎奠定核心單字 (TOEIC 400-600)',
      desc: '多益入門必備單字與基礎情境片語，涵蓋辦公室基本溝通與日常商務。',
      level: '基礎'
    },
    {
      range: '600-780',
      id: 'course-intermediate-750',
      title: '商務進階必備字彙 (TOEIC 600-780)',
      desc: '中階多益綠色至藍色證書核心單字，包含採購、會議、財務與差旅實戰。',
      level: '中階'
    },
    {
      range: '780-900',
      id: 'course-advanced-860',
      title: '高分突破精選字彙 (TOEIC 780-900)',
      desc: '金色證書衝刺關鍵字，強化商務談判、合約法律、企業營運深入解析。',
      level: '中高階'
    },
    {
      range: '900+',
      id: 'course-master-990',
      title: '滿分巔峰專業字彙 (TOEIC 900+)',
      desc: '高難度商業文法句型、進階同義詞辨析與專業管理術語。',
      level: '高階'
    }
  ];

  // Distribute entries to main level courses and split if oversized (> 500 words per chunk for fast iOS loading)
  const CHUNK_SIZE = 400;

  for (const tier of SCORE_TIERS) {
    const tierEntries = validEntries.filter(e => e.toeicScoreRange === tier.range);
    if (tierEntries.length <= CHUNK_SIZE) {
      const c = getOrCreateCourse(tier.id, tier.title, tier.desc, tier.range, '綜合商務', tier.level);
      c.words = tierEntries;
    } else {
      const totalParts = Math.ceil(tierEntries.length / CHUNK_SIZE);
      for (let p = 0; p < totalParts; p++) {
        const partId = `${tier.id}-part${p + 1}`;
        const partTitle = `${tier.title} - 第 ${p + 1} 單元 (${p * CHUNK_SIZE + 1}~${Math.min((p + 1) * CHUNK_SIZE, tierEntries.length)} 字)`;
        const c = getOrCreateCourse(
          partId,
          partTitle,
          `${tier.desc}（分單元 ${p + 1}/${totalParts}）`,
          tier.range,
          '綜合商務',
          tier.level
        );
        c.words = tierEntries.slice(p * CHUNK_SIZE, (p + 1) * CHUNK_SIZE);
      }
    }
  }

  // Also create a special "高頻片語與句型精選" course
  const phraseAndPatternEntries = validEntries.filter(e => e.entryType === 'phrase' || e.entryType === 'pattern');
  if (phraseAndPatternEntries.length > 0) {
    const totalPhraseParts = Math.ceil(phraseAndPatternEntries.length / CHUNK_SIZE);
    for (let p = 0; p < totalPhraseParts; p++) {
      const partId = `course-phrases-patterns-p${p + 1}`;
      const partTitle = `多益高頻商務片語與句型 - 第 ${p + 1} 輯`;
      const c = getOrCreateCourse(
        partId,
        partTitle,
        `精選聽力 Part 3/4 與閱讀 Part 5/6 常考關鍵片語與搭配句型。`,
        '600-900',
        '片語句型',
        '實戰'
      );
      c.words = phraseAndPatternEntries.slice(p * CHUNK_SIZE, (p + 1) * CHUNK_SIZE);
    }
  }

  // Ensure output directories exist
  if (!fs.existsSync(COURSES_DIR)) {
    fs.mkdirSync(COURSES_DIR, { recursive: true });
  }

  const catalogCourses = [];
  const manifestCourses = [];

  for (const [courseId, courseData] of coursesMap.entries()) {
    if (courseData.words.length === 0) continue;

    courseData.wordCount = courseData.words.length;
    const courseFileName = `${courseId}.json`;
    const courseFilePath = path.join(COURSES_DIR, courseFileName);
    const jsonStr = JSON.stringify(courseData, null, 2);
    fs.writeFileSync(courseFilePath, jsonStr, 'utf8');

    const checksum = computeChecksum(jsonStr);
    const sizeBytes = Buffer.byteLength(jsonStr, 'utf8');

    catalogCourses.push({
      id: courseData.id,
      title: courseData.title,
      description: courseData.description,
      toeicScoreRange: courseData.toeicScoreRange,
      category: courseData.category,
      level: courseData.level,
      wordCount: courseData.wordCount,
      fileName: courseFileName,
      checksum,
      sizeBytes
    });

    manifestCourses.push({
      id: courseData.id,
      path: `/data/v1/courses/${courseFileName}`,
      checksum,
      count: courseData.wordCount
    });

    console.log(`[ETL] Generated course: ${courseFileName} (${courseData.wordCount} words, ${(sizeBytes / 1024).toFixed(1)} KB)`);
  }

  // Generate Catalog
  const catalog = {
    version: 1,
    generatedAt: new Date().toISOString(),
    totalWords: validEntries.length,
    totalCourses: catalogCourses.length,
    courses: catalogCourses
  };
  const catalogPath = path.join(OUTPUT_BASE, 'catalog.json');
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');

  // Generate Manifest
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    datasetSource: 'https://huggingface.co/datasets/kknono668/toeic-vocab-tw',
    license: 'CC BY-SA 4.0',
    totalEntries: validEntries.length,
    courses: manifestCourses
  };
  const manifestPath = path.join(OUTPUT_BASE, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  // Generate QA Report
  const qaReport = {
    generatedAt: new Date().toISOString(),
    sourceRows: rawData.length,
    validRows: validEntries.length,
    dedupedRows: rawData.length - validEntries.length - rejectedRows.length,
    rejectedRows: rejectedRows.slice(0, 20), // sample of first 20 rejected
    missingDefinitions,
    missingExamples,
    distribution: {
      byCategory: categoryStats,
      byStarRating: starStats,
      byScoreRange: scoreStats,
      byEntryType: entryTypeStats
    }
  };
  const qaReportPath = path.join(OUTPUT_BASE, 'qa-report.json');
  fs.writeFileSync(qaReportPath, JSON.stringify(qaReport, null, 2), 'utf8');

  console.log(`[ETL] Complete! Catalog: ${catalogPath}, QA Report: ${qaReportPath}`);
}

buildDataset().catch(err => {
  console.error('[ETL] Fatal error:', err);
  process.exit(1);
});
