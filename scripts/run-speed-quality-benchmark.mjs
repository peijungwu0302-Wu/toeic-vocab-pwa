import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const BENCHMARK_DIR = path.join(ROOT_DIR, 'public', 'assets', 'images', 'benchmark');

if (!fs.existsSync(BENCHMARK_DIR)) {
  fs.mkdirSync(BENCHMARK_DIR, { recursive: true });
}

let apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
if (!apiKey) {
  try {
    const envContent = fs.readFileSync(path.join(ROOT_DIR, '.env.local'), 'utf8');
    const match = envContent.match(/GEMINI_API_KEY=([^\r\n]+)/);
    if (match) apiKey = match[1].trim();
  } catch {}
}

const TEST_WORDS = [
  {
    word: 'consensus',
    pos: 'noun',
    definition: '共識、一致意見',
    category: '會議與簡報',
    type: '抽象商務詞'
  },
  {
    word: 'discrepancy',
    pos: 'noun',
    definition: '差異、帳目不符',
    category: '金融與會計',
    type: '抽象商務詞'
  },
  {
    word: 'ahead of schedule',
    pos: 'phrase',
    definition: '進度超前、提前完成',
    category: '營運管理',
    type: '商務高頻片語'
  },
  {
    word: 'accountant',
    pos: 'noun',
    definition: '會計師、審計人員',
    category: '金融與會計',
    type: '實體商務名詞'
  }
];

async function generatePromptWithGemini(item) {
  const systemPrompt = `
You are an elite Business English Education Designer and Visual Art Director for TOEIC.
For the target word "${item.word}" (POS: ${item.pos}, Definition: "${item.definition}", Business Domain: "${item.category}"):

Create two outputs in valid JSON:
1. "firstExample": An authentic, crystal-clear, high-scoring TOEIC business sentence where this word is naturally used, with traditional Chinese translation ("zh") and scenario label ("scenario").
2. "imagePrompt": A photorealistic commercial photography scene description in English that EXACTLY depicts the situation in "firstExample". Focus on sharp details, natural daylight, modern office/business context, clean composition, professional 8k photography. (Do not include text banners or gibberish words).

JSON format:
{
  "firstExample": {
    "en": "...",
    "zh": "...",
    "scenario": "..."
  },
  "imagePrompt": "..."
}
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: systemPrompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.4
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return JSON.parse(text);
}

function downloadImage(prompt, filename) {
  return new Promise((resolve, reject) => {
    const encodedPrompt = encodeURIComponent(prompt);
    const seed = Math.floor(Math.random() * 1000000);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=500&nologo=true&seed=${seed}&model=flux`;
    const filePath = path.join(BENCHMARK_DIR, filename);

    function fetchUrl(targetUrl) {
      https.get(targetUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchUrl(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Image download failed with status ${res.statusCode}`));
          return;
        }

        const fileStream = fs.createWriteStream(filePath);
        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          const stats = fs.statSync(filePath);
          resolve({ filePath, sizeBytes: stats.size });
        });
      }).on('error', reject);
    }

    fetchUrl(url);
  });
}

async function runBenchmark() {
  console.log('🏁 啟動多益單字專屬配圖 ＋ 第一例句生成「速度與品質」實測基準...\n');
  console.log(`總測試樣本：${TEST_WORDS.length} 個代表性單字（涵蓋抽象詞、實體詞、高頻片語）\n`);

  const results = [];

  for (let i = 0; i < TEST_WORDS.length; i++) {
    const item = TEST_WORDS[i];
    console.log(`------------------------------------------------------------`);
    console.log(`▶ [${i + 1}/${TEST_WORDS.length}] 正在測試: "${item.word}" (${item.type}) - ${item.definition}`);

    // Step 1: Gemini Prompt & Example Generation
    const t0 = Date.now();
    let promptResult;
    try {
      promptResult = await generatePromptWithGemini(item);
    } catch (e) {
      console.error(`❌ Gemini 生成失敗:`, e.message);
      continue;
    }
    const geminiDurationMs = Date.now() - t0;
    console.log(`   ⚡ Step 1 (Gemini 3.6 Flash 第一例句 + 提示詞生成): ${geminiDurationMs} ms`);
    console.log(`      📝 第一例句: "${promptResult.firstExample.en}"`);
    console.log(`      🇹🇼 中文翻譯: "${promptResult.firstExample.zh}"`);
    console.log(`      🎨 生圖 Prompt: "${promptResult.imagePrompt.slice(0, 85)}..."`);

    // Step 2: Image Generation & Download
    const t1 = Date.now();
    const cleanName = item.word.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const filename = `benchmark_${cleanName}.jpg`;
    let imgResult;
    try {
      imgResult = await downloadImage(promptResult.imagePrompt, filename);
    } catch (e) {
      console.error(`❌ 圖片生成失敗:`, e.message);
      continue;
    }
    const imageDurationMs = Date.now() - t1;
    const totalDurationMs = Date.now() - t0;

    console.log(`   🖼️ Step 2 (繪圖生成與下載): ${imageDurationMs} ms (${(imgResult.sizeBytes / 1024).toFixed(1)} KB)`);
    console.log(`   ⏱️ 單字全流程總耗時 (End-to-End): ${totalDurationMs} ms (${(totalDurationMs / 1000).toFixed(2)} 秒)`);

    results.push({
      word: item.word,
      type: item.type,
      category: item.category,
      geminiMs: geminiDurationMs,
      imageMs: imageDurationMs,
      totalMs: totalDurationMs,
      sizeKb: (imgResult.sizeBytes / 1024).toFixed(1),
      filename,
      firstExample: promptResult.firstExample,
      prompt: promptResult.imagePrompt
    });
  }

  const avgGeminiMs = Math.round(results.reduce((a, b) => a + b.geminiMs, 0) / results.length);
  const avgImageMs = Math.round(results.reduce((a, b) => a + b.imageMs, 0) / results.length);
  const avgTotalMs = Math.round(results.reduce((a, b) => a + b.totalMs, 0) / results.length);
  const avgSizeKb = Math.round(results.reduce((a, b) => a + parseFloat(b.sizeKb), 0) / results.length);

  console.log('\n============================================================');
  console.log('📊 實測綜合數據基準統計 (Benchmark Summary)');
  console.log('============================================================');
  console.log(`• 平均 Gemini 文本/例句/提示詞耗時 : ${avgGeminiMs} ms (${(avgGeminiMs / 1000).toFixed(2)} 秒)`);
  console.log(`• 平均 AI 繪圖生成與下載耗時       : ${avgImageMs} ms (${(avgImageMs / 1000).toFixed(2)} 秒)`);
  console.log(`• 平均單詞全流程耗時 (End-to-End)  : ${avgTotalMs} ms (${(avgTotalMs / 1000).toFixed(2)} 秒)`);
  console.log(`• 平均單張圖片檔案大小             : ${avgSizeKb} KB (極佳的 PWA 行動端加載體積)`);
  console.log('------------------------------------------------------------');
  console.log(`🚀 批次處理時間推估：`);
  console.log(`  - 100 個單字  : 約 ${Math.round((avgTotalMs * 100) / 60000)} 分鐘`);
  console.log(`  - 500 個單字  : 約 ${Math.round((avgTotalMs * 500) / 60000)} 分鐘`);
  console.log(`  - 1,200 個單字: 約 ${Math.round((avgTotalMs * 1200) / 60000)} 分鐘 (約 ${(avgTotalMs * 1200 / 3600000).toFixed(1)} 小時，可背景無人值守完成)`);
  console.log('============================================================\n');

  fs.writeFileSync(
    path.join(ROOT_DIR, 'scripts', 'benchmark_report.json'),
    JSON.stringify({ summary: { avgGeminiMs, avgImageMs, avgTotalMs, avgSizeKb }, results }, null, 2),
    'utf8'
  );
  console.log('✅ 基準測試報告已存至 scripts/benchmark_report.json');
}

runBenchmark().catch(console.error);
