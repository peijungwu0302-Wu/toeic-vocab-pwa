import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

let apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  const envPath = path.join(ROOT_DIR, '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/GEMINI_API_KEY=(.+)/);
    if (match) apiKey = match[1].trim();
  }
}

const testWords = [
  { headword: 'curtain', definitionZh: '窗簾；幕布', partsOfSpeech: ['noun'], category: '辦公日常' },
  { headword: 'eggs', definitionZh: '雞蛋', partsOfSpeech: ['noun'], category: '住宿與餐飲' }
];

function extractValidJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}

  const match = trimmed.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }

  // If trailing chars, try to slice up to last ']'
  const lastBracket = trimmed.lastIndexOf(']');
  const firstBracket = trimmed.indexOf('[');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = trimmed.slice(firstBracket, lastBracket + 1);
    return JSON.parse(candidate);
  }

  throw new Error('Failed to parse valid JSON from text: ' + trimmed.slice(0, 200));
}

async function generateBatch(words) {
  const prompt = `
You are an elite ETS TOEIC Master Item Writer.
For the following English vocabulary items, generate 100% authentic, bespoke, flawless TOEIC learning data in Traditional Chinese.

Vocabulary list:
${JSON.stringify(words, null, 2)}

Return strictly a JSON array adhering to this schema:
[
  {
    "headword": "...",
    "definitionZh": "...",
    "partsOfSpeech": ["..."],
    "visualAnchor": {
      "imagePrompt": "...",
      "scene": "..."
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
    const errText = await res.text();
    throw new Error(`API Error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return extractValidJson(rawText);
}

async function run() {
  console.log('🤖 正在調用 Gemini 3.1-Flash-Lite 生成 2 個單字...');
  const results = await generateBatch(testWords);
  console.log(`✅ 成功生成 ${results.length} 個單字！`);
  for (const r of results) {
    console.log('--------------------------------------------------');
    console.log(`📌 單字：${r.headword} (${r.definitionZh})`);
    console.log(`   例句 1：${r.examples?.[0]?.en}`);
    console.log(`   中譯 1：${r.examples?.[0]?.zh}`);
    console.log(`   Q1 題幹：${r.quizzes?.[0]?.stem}`);
    console.log(`   Q1 選項：${JSON.stringify(r.quizzes?.[0]?.options)}  正解：${r.quizzes?.[0]?.answer}`);
    console.log(`   Q1 破題：${r.quizzes?.[0]?.strategy}`);
    console.log(`   Q1 避坑：${r.quizzes?.[0]?.examTrapTip}`);
  }
}

run().catch(console.error);
