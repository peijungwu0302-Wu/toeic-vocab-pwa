import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'public', 'data', 'v1');
const COURSES_DIR = path.join(DATA_DIR, 'courses');
const CACHE_DIR = path.join(ROOT_DIR, '.llm-cache');

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// Read API Keys Pool from .env.local
let keyPool = [];
const envPath = path.join(ROOT_DIR, '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const poolMatch = envContent.match(/GEMINI_API_KEYS=(.+)/);
  if (poolMatch) {
    keyPool = poolMatch[1].split(',').map(k => k.trim()).filter(Boolean);
  } else {
    const singleMatch = envContent.match(/GEMINI_API_KEY=(.+)/);
    if (singleMatch) keyPool = [singleMatch[1].trim()];
  }
}

if (keyPool.length === 0) {
  console.error('❌ 未找到可用 GEMINI_API_KEYS');
  process.exit(1);
}

console.log(`🔑 成功載入雙金鑰負載均衡池：共 ${keyPool.length} 組 API Key 啟用中！`);

const args = process.argv.slice(2);
const tierArg = args.find(a => a.startsWith('--tier='))?.split('=')[1] || 'core';
const limitArg = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '99999', 10);

const tierConfig = {
  core: { file: 'core-1200.json', label: '第一階段 · 核心高頻 1,200 詞' },
  advanced: { file: 'advanced-2500.json', label: '第二階段 · 商務進階 2,500 詞' },
  'expert-p1': { file: 'expert-high-part1.json', label: '第三階段 · 滿分巔峰 Part 1' },
  'expert-p2': { file: 'expert-high-part2.json', label: '第三階段 · 滿分巔峰 Part 2' },
  'expert-p3': { file: 'expert-high-part3.json', label: '第三階段 · 滿分巔峰 Part 3' },
};

const config = tierConfig[tierArg] || tierConfig.core;
const targetFilePath = path.join(DATA_DIR, config.file);
const cacheFilePath = path.join(CACHE_DIR, `enriched_${tierArg}_progress.json`);

console.log('='.repeat(70));
console.log(`🚀 「不背單詞 VIP 級」終極萬詞單字庫精修引擎 [${config.label}]`);
console.log('='.repeat(70));

const rawData = JSON.parse(fs.readFileSync(targetFilePath, 'utf8'));
const fullWordsList = rawData.words || [];
const wordsList = fullWordsList.slice(0, limitArg);

let cacheMap = new Map();
if (fs.existsSync(cacheFilePath)) {
  try {
    const cachedArray = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
    cachedArray.forEach(w => cacheMap.set(w.headword.toLowerCase().trim(), w));
    console.log(`💾 載入現有精修進度快取：${cacheMap.size} 詞`);
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

let keyIndex = 0;
function getNextKey() {
  const k = keyPool[keyIndex % keyPool.length];
  keyIndex++;
  return k;
}

async function callGeminiEnrichBatch(words, retries = 3) {
  const prompt = `
You are an elite ETS TOEIC Master Lexicographer and Mnemonic Expert (equivalent to BBWord / 不背單詞 VIP level).
For the following English vocabulary items, generate the complete, high-value, pedagogical learning enrichment data in Traditional Chinese.

Input items:
${JSON.stringify(words.map(w => ({
  headword: w.headword,
  definitionZh: w.definitionZh,
  partsOfSpeech: w.partsOfSpeech || ['word'],
  category: w.category || '綜合商務',
  toeicScoreRange: w.toeicScoreRange || '400-990'
})), null, 2)}

Requirements for EACH word:
1. examFocus:
   - primaryBusinessSense: Most frequent TOEIC meaning with approximate exam frequency % (e.g. "配合客戶需求 (多益考頻 75%)")
   - trapWarning: Explicit TOEIC exam trap warning (e.g. "多益常考抽象配合要求，切勿只記住宿！")
2. etymology:
   - prefix: Prefix and meaning (or null)
   - root: Core root and meaning
   - suffix: Suffix and meaning (or null)
   - memoryHook: Catchy, logical Chinese mnemonic hook
3. wordFamily:
   - noun: Array of noun derivatives with Traditional Chinese meaning
   - verb: Array of verb derivatives with Traditional Chinese meaning
   - adjective: Array of adjective derivatives with Traditional Chinese meaning
   - adverb: Array of adverb derivatives with Traditional Chinese meaning
   - cognates: Array of related words sharing the same root
4. synonymDiscrimination:
   - synonyms: 3-5 top TOEIC synonyms
   - antonyms: 1-2 antonyms
   - discrimination: Nuanced TOEIC exam discrimination explaining workplace usage differences vs synonyms
5. collocations:
   - Array of exactly 3 high-frequency business chunks: [{ "en": "...", "zh": "..." }, ...]
6. extendedExamples:
   - ex_2: { "scenario": "營運管理", "en": "...", "zh": "..." } (mark target word translation with 【...】)
   - ex_3: { "scenario": "策略拓展", "en": "...", "zh": "..." } (mark target word translation with 【...】)

Return strictly a JSON array of word objects.
`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const currentKey = getNextKey();
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=' + currentKey;

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
          console.warn(`⏳ [Key ${keyIndex % keyPool.length + 1}] 觸發限速 (429)，自動輪換下一組金鑰並等待 6s...`);
          await new Promise(r => setTimeout(r, 6000));
          continue;
        }
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return extractValidJson(rawText);
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`⚠️ 批次嘗試 ${attempt} 失敗: ${err.message}. 輪換金鑰重試中...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function runEnrichment() {
  const BATCH_SIZE = 10; // High throughput: 10 words per call
  const uncompleted = wordsList.filter(w => !cacheMap.has(w.headword.toLowerCase().trim()));

  console.log(`📋 總待精修單字數：${uncompleted.length} 詞（已完成：${cacheMap.size} 詞）`);

  for (let i = 0; i < uncompleted.length; i += BATCH_SIZE) {
    const batch = uncompleted.slice(i, i + BATCH_SIZE);
    const progressPct = Math.round(((cacheMap.size + batch.length) / wordsList.length) * 100);

    console.log(`\n⏳ [${cacheMap.size + 1}~${Math.min(cacheMap.size + batch.length, wordsList.length)}/${wordsList.length}] (${progressPct}%) 正在精修: ${batch.map(b => b.headword).slice(0, 4).join(', ')}... (+${batch.length} 詞)`);

    try {
      const results = await callGeminiEnrichBatch(batch);
      for (const res of results) {
        const key = (res.headword || '').toLowerCase().trim();
        const origWord = wordsList.find(w => w.headword.toLowerCase().trim() === key) || {};
        
        // 🌟 100% 鎖定保護具象第一例句與視覺生圖提示詞
        const heroExample = origWord.examples?.[0] || {
          id: 'ex_1',
          scenario: '日常商務 (具象核心)',
          en: `Please review the standard procedures regarding ${origWord.headword || key}.`,
          zh: `請審查關於【${origWord.definitionZh || key}】之標準程序。`
        };

        const ex2 = res.extendedExamples?.ex_2 || {
          scenario: '營運管理',
          en: `Management confirmed updated protocols for ${origWord.headword || key}.`,
          zh: `管理層確認了關於【${origWord.definitionZh || key}】之最新規範。`
        };

        const ex3 = res.extendedExamples?.ex_3 || {
          scenario: '策略拓展',
          en: `The committee approved strategic guidelines concerning ${origWord.headword || key}.`,
          zh: `委員會核准了關於【${origWord.definitionZh || key}】之策略方針。`
        };

        const merged = {
          ...origWord,
          examFocus: res.examFocus,
          etymology: res.etymology,
          wordFamily: res.wordFamily,
          synonymDiscrimination: res.synonymDiscrimination,
          collocations: res.collocations,
          examples: [
            { ...heroExample, id: 'ex_1' },
            { ...ex2, id: 'ex_2' },
            { ...ex3, id: 'ex_3' }
          ],
          visualAnchor: origWord.visualAnchor || {
            imagePrompt: `Professional modern business workplace setting representing ${origWord.headword || key}, photorealistic, 8k`,
            scene: `企業同仁於商務情境中處理 ${origWord.headword || key} 之應用場景`
          }
        };

        cacheMap.set(key, merged);
      }

      // Save incremental checkpoint
      const currentProgress = Array.from(cacheMap.values());
      fs.writeFileSync(cacheFilePath, JSON.stringify(currentProgress), 'utf8');
      console.log(`✅ 已寫入進度快照（累計已完成：${cacheMap.size} 詞）`);

      // 雙金鑰交替間隔 (2.5 秒 = 24 RPM 總吞吐量)
      await new Promise(r => setTimeout(r, 2500));
    } catch (batchErr) {
      console.error(`❌ 批次精修失敗 (${batch.map(b => b.headword).join(', ')}):`, batchErr.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`🎉 [${config.label}] 單字庫精修全量大功告成！正在同步至正式檔案庫...`);
  console.log('='.repeat(70));

  // Sync back to master file
  const finalWords = fullWordsList.map(w => cacheMap.get(w.headword.toLowerCase().trim()) || w);
  fs.writeFileSync(targetFilePath, JSON.stringify({
    ...rawData,
    version: 6,
    datasetVersion: 'v6.0.0-bbword-vip-lexicon',
    count: finalWords.length,
    words: finalWords
  }), 'utf8');

  // Sync to courses
  const wordLookup = new Map(finalWords.map(w => [w.headword.toLowerCase().trim(), w]));
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
        version: 6,
        datasetVersion: 'v6.0.0-bbword-vip-lexicon',
        buildTimestamp: new Date().toISOString(),
        words: updatedWords
      }), 'utf8');
    }
  }
  console.log('📚 已同步更新至對應課程檔案！');
}

runEnrichment().catch(console.error);
