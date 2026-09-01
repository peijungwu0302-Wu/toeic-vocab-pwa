import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'public', 'data', 'v1');

let apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
if (!apiKey) {
  try {
    const envContent = fs.readFileSync(path.join(ROOT_DIR, '.env.local'), 'utf8');
    const match = envContent.match(/GEMINI_API_KEY=([^\r\n]+)/);
    if (match) apiKey = match[1].trim();
  } catch {}
}

const BATCH_SIZE = 25;
const CANDIDATE_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];
const DELAY_BETWEEN_BATCHES_MS = 3000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callGeminiBatchWithFallback(batchWords) {
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

  let lastError = null;

  for (const model of CANDIDATE_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
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
        throw new Error(`[${model}] API Error (${res.status}): ${errText}`);
      }

      const data = await res.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      return JSON.parse(rawText);
    } catch (err) {
      lastError = err;
      console.warn(`  ⚠️ 模型 ${model} 呼叫失敗: ${err.message.slice(0, 120)}...，嘗試切換備用模型...`);
    }
  }

  throw lastError;
}

async function processFile(filename) {
  const filePath = path.join(DATA_DIR, filename);
  const backupPath = path.join(DATA_DIR, filename.replace('.json', '.backup.json'));
  const cachePath = path.join(__dirname, `.step1_${filename.replace('.json', '')}_cache.json`);

  if (!fs.existsSync(filePath)) {
    console.log(`⚠️ 檔案不存在: ${filePath}，跳過。`);
    return;
  }

  console.log(`\n============================================================`);
  console.log(`🚀 開始處理檔案: ${filename}`);
  console.log(`============================================================`);

  const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const totalWords = fileData.words.length;
  console.log(`📦 讀取 ${filename}：共 ${totalWords} 個單字。`);

  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, JSON.stringify(fileData, null, 2), 'utf8');
    console.log(`💾 已建立安全備份：${backupPath}`);
  }

  let progressCache = {};
  if (fs.existsSync(cachePath)) {
    try {
      progressCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      console.log(`🔄 載入現有進度快取：已完成 ${Object.keys(progressCache).length} / ${totalWords} 字。`);
    } catch {}
  }

  const remainingIndices = [];
  fileData.words.forEach((w, idx) => {
    if (!progressCache[w.id]) {
      remainingIndices.push(idx);
    }
  });

  console.log(`🎯 本檔案需處理：${remainingIndices.length} 個單字（批次大小：${BATCH_SIZE}，共 ${Math.ceil(remainingIndices.length / BATCH_SIZE)} 個批次）`);

  const startTime = Date.now();

  for (let i = 0; i < remainingIndices.length; i += BATCH_SIZE) {
    const chunkIndices = remainingIndices.slice(i, i + BATCH_SIZE);
    const chunkWords = chunkIndices.map(idx => fileData.words[idx]);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(remainingIndices.length / BATCH_SIZE);

    console.log(`▶ [${filename} 批次 ${batchNum}/${totalBatches}] 正在處理第 ${i + 1} ~ ${Math.min(i + BATCH_SIZE, remainingIndices.length)} 字... (${chunkWords.map(w => w.headword).slice(0, 3).join(', ')}...)`);

    let retries = 5;
    let batchResult = null;

    while (retries > 0) {
      try {
        batchResult = await callGeminiBatchWithFallback(chunkWords);
        break;
      } catch (err) {
        retries--;
        const waitSec = retries > 2 ? 15 : 30;
        console.warn(`  ⚠️ 批次遭遇限速/錯誤，剩餘重試次數 ${retries}。等待 ${waitSec} 秒冷卻後重試...`);
        if (retries > 0) {
          await sleep(waitSec * 1000);
        } else {
          console.error(`  ❌ 批次多次重試失敗，暫停執行。`);
          throw err;
        }
      }
    }

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

    const totalDone = Object.keys(progressCache).length;
    const pct = ((totalDone / totalWords) * 100).toFixed(1);
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ✅ 批次完成！${filename} 進度: ${totalDone}/${totalWords} (${pct}%) · 耗時 ${elapsedSec}s`);

    fs.writeFileSync(cachePath, JSON.stringify(progressCache, null, 2), 'utf8');

    if (i + BATCH_SIZE < remainingIndices.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  // Merge into file
  console.log(`📝 正在將結果寫入 ${filename}...`);
  fileData.words.forEach(w => {
    const cache = progressCache[w.id];
    if (cache) {
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
      w.visualAnchor = {
        imagePrompt: cache.imagePrompt,
        scene: `${cache.scenario}：${cache.zh}`
      };
    }
  });

  fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2), 'utf8');
  console.log(`🎉 ${filename} 升級完成並安全儲存！\n`);
}

async function main() {
  console.log('🌟 啟動全字庫 11,154 單字「具象第一例句 ＋ 1:1 向量生圖 Prompt」全面升級流水線 (含自動冷卻與備用模型)\n');

  const files = [
    'advanced-2500.json',
    'expert-high-part1.json',
    'expert-high-part2.json',
    'expert-high-part3.json'
  ];

  for (const f of files) {
    await processFile(f);
  }

  console.log('\n============================================================');
  console.log('🏆 恭喜！全字庫 11,154 單字（Core 1200 + Adv 2500 + Expert 7454）第一例句與生圖 Prompt 全數升級完成！');
  console.log('============================================================\n');
}

main().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
