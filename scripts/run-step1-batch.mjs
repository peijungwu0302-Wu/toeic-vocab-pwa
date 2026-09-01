import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const CORE_1200_FILE = path.join(ROOT_DIR, 'public', 'data', 'v1', 'core-1200.json');
const CORE_1200_BACKUP = path.join(ROOT_DIR, 'public', 'data', 'v1', 'core-1200.backup.json');
const QUEUE_STATE_FILE = path.join(__dirname, 'image_queue_state.json');
const PROGRESS_CACHE_FILE = path.join(__dirname, '.step1_progress_cache.json');

let apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
if (!apiKey) {
  try {
    const envContent = fs.readFileSync(path.join(ROOT_DIR, '.env.local'), 'utf8');
    const match = envContent.match(/GEMINI_API_KEY=([^\r\n]+)/);
    if (match) apiKey = match[1].trim();
  } catch {}
}

const BATCH_SIZE = 25;
const MODEL_NAME = 'gemini-3.1-flash-lite';
const DELAY_BETWEEN_BATCHES_MS = 2500; // Safe rate limiting

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callGeminiBatch(batchWords) {
  const prompt = `
You are a World-Class TOEIC Master Teacher, Lexicographer, and Corporate Visual Art Director.
For each given TOEIC word/phrase, craft an ultra-vivid, natural, high-scoring TOEIC business example sentence and a matching flat vector corporate editorial illustration prompt.

CRITICAL LINGUISTIC RULES:
1. "en": Natural, grammatically flawless, authentic high-scoring TOEIC business sentence where the word/phrase is naturally and accurately used in a concrete workplace scenario with strong visual imagery. NEVER use broken collocations or template placeholders.
2. "zh": Precise, professional Traditional Chinese (繁體中文) translation.
3. "scenario": Specific business scenario tag in Traditional Chinese (e.g. "辦公行政", "客戶洽談", "餐飲住宿", "設備檢修", "董事會議", "財務審計", "物流倉儲", "人力資源", "行銷推廣").
4. "imagePrompt": Flat vector corporate editorial illustration prompt describing the exact scene of "en". Include clean outlines, modern corporate navy blue / teal / amber / slate color palette, crisp details, high-end commercial art style, 8k.

Input Word Batch:
${JSON.stringify(batchWords.map(w => ({
  id: w.id,
  headword: w.headword,
  partsOfSpeech: w.partsOfSpeech || ['noun'],
  definitionZh: w.definitionZh,
  category: w.category || '辦公日常'
})), null, 2)}

Return a strict JSON array of objects with the exact keys:
[
  {
    "id": "...",
    "headword": "...",
    "en": "...",
    "zh": "...",
    "scenario": "...",
    "imagePrompt": "..."
  }
]
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return JSON.parse(rawText);
}

async function main() {
  console.log('🚀 開始執行 Step 1：Core 1,200 全字庫「第一例句畫面感 ＋ 專屬生圖 Prompt」全面升級\n');

  // 1. Load Core Data
  const coreData = JSON.parse(fs.readFileSync(CORE_1200_FILE, 'utf8'));
  const totalWords = coreData.words.length;
  console.log(`📦 讀取 core-1200.json：共 ${totalWords} 個核心單字。`);

  // 2. Create Backup
  if (!fs.existsSync(CORE_1200_BACKUP)) {
    fs.writeFileSync(CORE_1200_BACKUP, JSON.stringify(coreData, null, 2), 'utf8');
    console.log(`💾 已建立資料庫安全備份：${CORE_1200_BACKUP}`);
  }

  // 3. Load or Init Progress Cache
  let progressCache = {};
  if (fs.existsSync(PROGRESS_CACHE_FILE)) {
    try {
      progressCache = JSON.parse(fs.readFileSync(PROGRESS_CACHE_FILE, 'utf8'));
      console.log(`🔄 載入現有進度快取：已完成 ${Object.keys(progressCache).length} / ${totalWords} 字。`);
    } catch {}
  }

  // 4. Identify remaining words
  const remainingIndices = [];
  coreData.words.forEach((w, idx) => {
    if (!progressCache[w.id]) {
      remainingIndices.push(idx);
    }
  });

  console.log(`🎯 本次需處理：${remainingIndices.length} 個單字（批次大小：${BATCH_SIZE} 字 / 組，預計 ${Math.ceil(remainingIndices.length / BATCH_SIZE)} 個批次）\n`);

  const startTime = Date.now();
  let completedInThisRun = 0;

  for (let i = 0; i < remainingIndices.length; i += BATCH_SIZE) {
    const chunkIndices = remainingIndices.slice(i, i + BATCH_SIZE);
    const chunkWords = chunkIndices.map(idx => coreData.words[idx]);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(remainingIndices.length / BATCH_SIZE);

    console.log(`▶ [批次 ${batchNum}/${totalBatches}] 正在處理第 ${i + 1} ~ ${Math.min(i + BATCH_SIZE, remainingIndices.length)} 字... (${chunkWords.map(w => w.headword).slice(0, 4).join(', ')}...)`);

    let retries = 3;
    let batchResult = null;

    while (retries > 0) {
      try {
        batchResult = await callGeminiBatch(chunkWords);
        break;
      } catch (err) {
        retries--;
        console.warn(`  ⚠️ 批次失敗，剩餘重試次數 ${retries}: ${err.message}`);
        if (retries > 0) {
          console.log(`  ⏳ 等待 5 秒後重試...`);
          await sleep(5000);
        } else {
          console.error(`  ❌ 批次多次重試失敗，暫停執行。`);
          throw err;
        }
      }
    }

    // Process and merge results
    const resultMap = new Map();
    if (Array.isArray(batchResult)) {
      batchResult.forEach(item => {
        if (item && item.id) resultMap.set(item.id, item);
        else if (item && item.headword) resultMap.set(item.headword.toLowerCase(), item);
      });
    }

    chunkWords.forEach(w => {
      const match = resultMap.get(w.id) || resultMap.get(w.headword.toLowerCase());
      if (match) {
        progressCache[w.id] = {
          en: match.en,
          zh: match.zh,
          scenario: match.scenario || w.category || '辦公日常',
          imagePrompt: match.imagePrompt
        };
      }
    });

    completedInThisRun += chunkWords.length;
    const totalDone = Object.keys(progressCache).length;
    const pct = ((totalDone / totalWords) * 100).toFixed(1);
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ✅ 批次完成！總進度: ${totalDone}/${totalWords} (${pct}%) · 耗時 ${elapsedSec}s`);

    // Save progress cache periodically
    fs.writeFileSync(PROGRESS_CACHE_FILE, JSON.stringify(progressCache, null, 2), 'utf8');

    if (i + BATCH_SIZE < remainingIndices.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  console.log('\n============================================================');
  console.log('🎉 全部 1,200 個核心單字之「具象第一例句 ＋ 專屬生圖 Prompt」生成完畢！');
  console.log('============================================================\n');

  // 5. Merge all upgraded sentences and prompts into coreData
  console.log('📝 正在將具象第一例句與視覺 Prompt 同步寫入 core-1200.json...');
  coreData.words.forEach(w => {
    const cache = progressCache[w.id];
    if (cache) {
      // Update first example sentence
      if (!Array.isArray(w.examples) || w.examples.length === 0) {
        w.examples = [{ id: `ex_1_${w.headword}`, en: cache.en, zh: cache.zh, scenario: cache.scenario }];
      } else {
        w.examples[0] = {
          ...w.examples[0],
          en: cache.en,
          zh: cache.zh,
          scenario: cache.scenario
        };
      }

      // Update visualAnchor
      w.visualAnchor = {
        imagePrompt: cache.imagePrompt,
        scene: `${cache.scenario}：${cache.zh}`
      };
    }
  });

  fs.writeFileSync(CORE_1200_FILE, JSON.stringify(coreData, null, 2), 'utf8');
  console.log(`✅ core-1200.json 儲存成功！`);

  // 6. Synchronize image_queue_state.json
  console.log('🔄 正在同步更新 scripts/image_queue_state.json...');
  let queueState = {
    totalTarget: coreData.words.length,
    completedCount: 13,
    pendingCount: 0,
    lastUpdated: new Date().toISOString(),
    completed: [],
    pending: []
  };

  if (fs.existsSync(QUEUE_STATE_FILE)) {
    try {
      queueState = JSON.parse(fs.readFileSync(QUEUE_STATE_FILE, 'utf8'));
    } catch {}
  }

  const completedWordsSet = new Set((queueState.completed || []).map(c => c.word.toLowerCase()));

  const newPending = [];
  coreData.words.forEach(w => {
    if (!completedWordsSet.has(w.headword.toLowerCase())) {
      const cache = progressCache[w.id] || {};
      newPending.push({
        id: w.id,
        headword: w.headword,
        partsOfSpeech: w.partsOfSpeech || ['noun'],
        definitionZh: w.definitionZh,
        category: w.category || 'Core',
        visualExampleEn: cache.en || (w.examples?.[0]?.en || ''),
        visualExampleZh: cache.zh || (w.examples?.[0]?.zh || ''),
        scenario: cache.scenario || w.category || '辦公日常',
        imagePrompt: cache.imagePrompt || (w.visualAnchor?.imagePrompt || '')
      });
    }
  });

  queueState.pending = newPending;
  queueState.pendingCount = newPending.length;
  queueState.lastUpdated = new Date().toISOString();

  fs.writeFileSync(QUEUE_STATE_FILE, JSON.stringify(queueState, null, 2), 'utf8');
  console.log(`✅ image_queue_state.json 同步完成！待生圖佇列: ${queueState.pendingCount} 字。`);

  console.log('\n============================================================');
  console.log('🏁 Step 1 執行大功告成！全字庫 1,200 字畫面感例句與生圖 Prompt 已 100% 裝載！');
  console.log('============================================================\n');
}

main().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
