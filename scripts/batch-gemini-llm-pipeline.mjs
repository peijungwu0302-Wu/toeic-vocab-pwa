import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'public', 'data', 'v1');
const QUIZ_DIR = path.join(DATA_DIR, 'quiz');
const COURSES_DIR = path.join(DATA_DIR, 'courses');
const CACHE_DIR = path.join(ROOT_DIR, '.llm-cache');

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// Read API Key
let apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  const envPath = path.join(ROOT_DIR, '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/GEMINI_API_KEY=(.+)/);
    if (match) apiKey = match[1].trim();
  }
}

if (!apiKey) {
  console.error('❌ Missing GEMINI_API_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const tierArg = args.find(a => a.startsWith('--tier='))?.split('=')[1] || 'core';
const limitArg = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '99999', 10);

const tierConfig = {
  core: { file: 'core-1200.json', quizFile: 'core-mcq.json', label: '核心高頻 1,200 詞' },
  advanced: { file: 'advanced-2500.json', quizFile: 'advanced-mcq.json', label: '商務進階 2,500 詞' },
  'expert-p1': { file: 'expert-high-part1.json', quizFile: 'expert-mcq-part1.json', label: '滿分巔峰 Part 1' },
  'expert-p2': { file: 'expert-high-part2.json', quizFile: 'expert-mcq-part2.json', label: '滿分巔峰 Part 2' },
  'expert-p3': { file: 'expert-high-part3.json', quizFile: 'expert-mcq-part3.json', label: '滿分巔峰 Part 3' },
};

const config = tierConfig[tierArg] || tierConfig.core;
const targetFilePath = path.join(DATA_DIR, config.file);
const targetQuizPath = path.join(QUIZ_DIR, config.quizFile);
const cacheFilePath = path.join(CACHE_DIR, `${tierArg}_progress.json`);

console.log('='.repeat(70));
console.log(`🚀 Gemini 大模型出題流水線啟動 [${config.label}]`);
console.log('='.repeat(70));

const rawData = JSON.parse(fs.readFileSync(targetFilePath, 'utf8'));
const fullWordsList = rawData.words || [];
const wordsList = fullWordsList.slice(0, limitArg);

let cacheMap = new Map();
if (fs.existsSync(cacheFilePath)) {
  try {
    const cachedArray = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
    cachedArray.forEach(w => cacheMap.set(w.headword.toLowerCase().trim(), w));
    console.log(`💾 載入現有進度快取：${cacheMap.size} 詞`);
  } catch {}
}

function extractValidJson(text) {
  const trimmed = text.trim();
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = trimmed.slice(firstBracket, lastBracket + 1);
    return JSON.parse(candidate);
  }
  return JSON.parse(trimmed);
}

async function callGeminiBatch(words, retries = 3) {
  const prompt = `
You are an elite ETS TOEIC Master Item Writer.
For the following English vocabulary items, generate 100% authentic, bespoke, flawless TOEIC learning data in Traditional Chinese.

Vocabulary list:
${JSON.stringify(words.map(w => ({
  headword: w.headword,
  definitionZh: w.definitionZh,
  partsOfSpeech: w.partsOfSpeech || ['word'],
  category: w.category || '綜合商務'
})), null, 2)}

Return strictly a JSON array adhering to this schema:
[
  {
    "headword": "...",
    "definitionZh": "...",
    "partsOfSpeech": ["..."],
    "visualAnchor": {
      "imagePrompt": "Photorealistic workplace business scene prompt in English",
      "scene": "情境繁中描述"
    },
    "examples": [
      { "id": "ex_1", "scenario": "日常商務", "en": "...", "zh": "..." },
      { "id": "ex_2", "scenario": "營運管理", "en": "...", "zh": "..." },
      { "id": "ex_3", "scenario": "市場拓展", "en": "...", "zh": "..." }
    ],
    "quizzes": [
      {
        "type": "multiple_choice",
        "subType": "vocab_choice",
        "stem": "...",
        "stemTranslation": "...",
        "options": ["...", "...", "...", "..."],
        "answer": "...",
        "strategy": "...",
        "examTrapTip": "...",
        "collocations": ["...", "..."],
        "optionAnalyses": [
          { "option": "...", "isCorrect": true, "pos": "...", "meaning": "...", "reason": "..." },
          { "option": "...", "isCorrect": false, "pos": "...", "meaning": "...", "reason": "..." },
          { "option": "...", "isCorrect": false, "pos": "...", "meaning": "...", "reason": "..." },
          { "option": "...", "isCorrect": false, "pos": "...", "meaning": "...", "reason": "..." }
        ]
      },
      {
        "type": "multiple_choice",
        "subType": "grammar_form",
        "stem": "...",
        "stemTranslation": "...",
        "options": ["...", "...", "...", "..."],
        "answer": "...",
        "strategy": "...",
        "examTrapTip": "...",
        "collocations": ["...", "..."],
        "optionAnalyses": [
          { "option": "...", "isCorrect": true, "pos": "...", "meaning": "...", "reason": "..." },
          { "option": "...", "isCorrect": false, "pos": "...", "meaning": "...", "reason": "..." },
          { "option": "...", "isCorrect": false, "pos": "...", "meaning": "...", "reason": "..." },
          { "option": "...", "isCorrect": false, "pos": "...", "meaning": "...", "reason": "..." }
        ]
      },
      {
        "type": "multiple_choice",
        "subType": "synonym_context",
        "stem": "...",
        "stemTranslation": "...",
        "options": ["...", "...", "...", "..."],
        "answer": "...",
        "strategy": "...",
        "examTrapTip": "...",
        "collocations": ["...", "..."],
        "optionAnalyses": [
          { "option": "...", "isCorrect": true, "pos": "...", "meaning": "...", "reason": "..." },
          { "option": "...", "isCorrect": false, "pos": "...", "meaning": "...", "reason": "..." },
          { "option": "...", "isCorrect": false, "pos": "...", "meaning": "...", "reason": "..." },
          { "option": "...", "isCorrect": false, "pos": "...", "meaning": "...", "reason": "..." }
        ]
      },
      {
        "type": "cloze_fill",
        "subType": "collocation_cloze",
        "stem": "📧 [INTERNAL MEMORANDUM]...",
        "stemTranslation": "...",
        "options": ["...", "...", "...", "..."],
        "answer": "...",
        "clozeHint": "核心釋義：...",
        "strategy": "...",
        "examTrapTip": "...",
        "collocations": ["...", "..."],
        "optionAnalyses": [
          { "option": "...", "isCorrect": true, "pos": "...", "meaning": "...", "reason": "..." },
          { "option": "...", "isCorrect": false, "pos": "...", "meaning": "...", "reason": "..." },
          { "option": "...", "isCorrect": false, "pos": "...", "meaning": "...", "reason": "..." },
          { "option": "...", "isCorrect": false, "pos": "...", "meaning": "...", "reason": "..." }
        ]
      },
      {
        "type": "cloze_fill",
        "subType": "active_recall",
        "stem": "📩 [CLIENT CORRESPONDENCE]...",
        "stemTranslation": "...",
        "options": ["...", "...", "...", "..."],
        "answer": "...",
        "clozeHint": "首字母：...",
        "strategy": "...",
        "examTrapTip": "...",
        "collocations": ["...", "..."],
        "optionAnalyses": [
          { "option": "...", "isCorrect": true, "pos": "...", "meaning": "...", "reason": "..." },
          { "option": "...", "isCorrect": false, "pos": "...", "meaning": "...", "reason": "..." },
          { "option": "...", "isCorrect": false, "pos": "...", "meaning": "...", "reason": "..." },
          { "option": "...", "isCorrect": false, "pos": "...", "meaning": "...", "reason": "..." }
        ]
      },
      {
        "type": "cloze_fill",
        "subType": "sentence_complete",
        "stem": "📢 [EXECUTIVE POLICY ANNOUNCEMENT]...",
        "stemTranslation": "...",
        "options": ["...", "...", "...", "..."],
        "answer": "...",
        "clozeHint": "核心釋義：...",
        "strategy": "...",
        "examTrapTip": "...",
        "collocations": ["...", "..."],
        "optionAnalyses": [
          { "option": "...", "isCorrect": true, "pos": "...", "meaning": "...", "reason": "..." },
          { "option": "...", "isCorrect": false, "pos": "...", "meaning": "...", "reason": "..." },
          { "option": "...", "isCorrect": false, "pos": "...", "meaning": "...", "reason": "..." },
          { "option": "...", "isCorrect": false, "pos": "...", "meaning": "...", "reason": "..." }
        ]
      }
    ]
  }
]
`;

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=' + apiKey;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 8192
          }
        })
      });

      if (!res.ok) {
        const text = await res.text();
        if (res.status === 429) {
          console.warn(`⏳ Rate limited (429). Waiting 10s before retry ${attempt}/${retries}...`);
          await new Promise(r => setTimeout(r, 10000));
          continue;
        }
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return extractValidJson(rawText);
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`⚠️ Batch attempt ${attempt} failed: ${err.message}. Retrying in 4s...`);
      await new Promise(r => setTimeout(r, 4000));
    }
  }
}

async function runPipeline() {
  const BATCH_SIZE = 2; // Process 2 words per API call to guarantee complete 8K token budget
  const uncompleted = wordsList.filter(w => !cacheMap.has(w.headword.toLowerCase().trim()));

  console.log(`📋 總待處理單字數：${uncompleted.length} 詞（已完成：${cacheMap.size} 詞）`);

  for (let i = 0; i < uncompleted.length; i += BATCH_SIZE) {
    const batch = uncompleted.slice(i, i + BATCH_SIZE);
    const progressPct = Math.round(((cacheMap.size + batch.length) / wordsList.length) * 100);

    console.log(`\n⏳ [${cacheMap.size + 1}~${Math.min(cacheMap.size + batch.length, wordsList.length)}/${wordsList.length}] (${progressPct}%) 正在生成: ${batch.map(b => b.headword).join(', ')}...`);

    try {
      const results = await callGeminiBatch(batch);
      for (const res of results) {
        const key = res.headword.toLowerCase().trim();
        const origWord = wordsList.find(w => w.headword.toLowerCase().trim() === key) || {};
        const merged = {
          ...origWord,
          ...res,
          id: origWord.id || `tw_${key.replace(/[^a-z0-9]/g, '_')}_${crypto.createHash('md5').update(key).digest('hex').slice(0, 8)}`
        };
        cacheMap.set(key, merged);
      }

      // Save incremental checkpoint
      const currentProgress = Array.from(cacheMap.values());
      fs.writeFileSync(cacheFilePath, JSON.stringify(currentProgress), 'utf8');
      console.log(`✅ 已寫入進度快照（累計：${cacheMap.size} 詞）`);

      // Rate limit delay (4.5 seconds = ~13 RPM safe zone)
      await new Promise(r => setTimeout(r, 4500));
    } catch (batchErr) {
      console.error(`❌ 批次生成失敗 (${batch.map(b => b.headword).join(', ')}):`, batchErr.message);
      await new Promise(r => setTimeout(r, 6000));
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`🎉 [${config.label}] 大模型全量出題生成完畢！正在同步至正式檔案庫...`);
  console.log('='.repeat(70));

  // Sync back to master file
  const finalWords = fullWordsList.map(w => cacheMap.get(w.headword.toLowerCase().trim()) || w);
  fs.writeFileSync(targetFilePath, JSON.stringify({
    ...rawData,
    version: 5,
    datasetVersion: 'v5.0.0-llm-bespoke-visual',
    count: finalWords.length,
    words: finalWords
  }), 'utf8');

  fs.writeFileSync(targetQuizPath, JSON.stringify(finalWords), 'utf8');
  console.log(`✅ 已更新 ${config.file} 與 ${config.quizFile}`);

  // Build Master Map for course sync
  const wordLookup = new Map(finalWords.map(w => [w.headword.toLowerCase().trim(), w]));

  // Sync to all affected course files
  const courseFiles = fs.readdirSync(COURSES_DIR).filter(f => f.startsWith('course-') && f.endsWith('.json'));
  for (const cf of courseFiles) {
    const cp = path.join(COURSES_DIR, cf);
    const cData = JSON.parse(fs.readFileSync(cp, 'utf8'));
    let modified = false;
    const updatedWords = (cData.words || []).map(w => {
      const match = wordLookup.get(w.headword.toLowerCase().trim());
      if (match) {
        modified = true;
        return match;
      }
      return w;
    });
    if (modified) {
      fs.writeFileSync(cp, JSON.stringify({
        ...cData,
        version: 5,
        datasetVersion: 'v5.0.0-llm-bespoke-visual',
        buildTimestamp: new Date().toISOString(),
        words: updatedWords
      }), 'utf8');
    }
  }
  console.log('📚 已同步更新至對應課程檔案！');
}

runPipeline().catch(console.error);
