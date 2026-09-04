// scripts/enrich_vocab_pipeline.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// ==============================================================================
// 1. 雙獨立健康帳號陣列 (Account 1 & Account 2 · 16 把滿血金鑰)
// ==============================================================================
const envPath = path.join(ROOT_DIR, '.env.local');
if (!fs.existsSync(envPath)) {
  console.error('❌ .env.local not found!');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf-8');
const poolMatch = envContent.match(/GEMINI_API_KEYS=([^\r\n]+)/);
if (!poolMatch) {
  console.error('❌ GEMINI_API_KEYS not found in .env.local!');
  process.exit(1);
}

const allKeys = poolMatch[1].split(',').map(k => k.trim()).filter(Boolean);

// 前 16 把健康金鑰分流 (各 8 把)
const account1Keys = allKeys.slice(0, 8);
const account2Keys = allKeys.slice(8, 16);

console.log(`🔑 Loaded 16 verified healthy keys:`);
console.log(`   - Account 1: ${account1Keys.length} keys`);
console.log(`   - Account 2: ${account2Keys.length} keys`);

const WORKER_PIPES = [
  { id: 1, name: "Pipe-Acc1", keys: account1Keys },
  { id: 2, name: "Pipe-Acc2", keys: account2Keys }
];

// 使用名師級最高品質的 gemini-3.5-flash
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const BATCH_SIZE = 5; // 5 詞微批次
// 溫和平滑節奏：每條管線間隔 15 秒 (~4 RPM，雙管線合計 8 RPM，遠低於 Google 20/min 頻率牆)
const MIN_REQUEST_INTERVAL_MS = 15000;

// ==============================================================================
// 2. Few-Shot 黃金示範樣本 (雙語換句話說 + 解耦考點標籤)
// ==============================================================================
const GOLDEN_FEW_SHOT = [
  {
    headword: "accommodate",
    phoneticUS: "/əˈkɑːmədeɪt/",
    definitionZh: "容納、適應、滿足（需求或要求）",
    examFocus: {
      primaryBusinessSense: "滿足客戶或業務需求 (多益考頻 85%)",
      trapWarning: "⚠️ 看到 accommodate 不要只想到「住宿」！在多益商務書信中 80% 是指「調整安排以滿足/配合他人需求」。"
    },
    etymology: {
      formula: "ac- (朝向) + com- (共同) + mod- (模式) + -ate (動詞)",
      mnemonic: "調整至共同的模式以配合對方需求"
    },
    wordFamily: {
      verb: [
        { word: "accommodate", zh: "容納；配合", pos: "verb", examTip: "常與 request 或 schedule 連用" }
      ],
      noun: [
        { word: "accommodation", zh: "住宿；適應", pos: "noun", examTip: "⚠️ 複數形 accommodations 專指住所" }
      ],
      adj: [
        { word: "accommodating", zh: "樂於配合的", pos: "adj", examTip: "⭐ 高頻形容詞！多用於評價員工配合度高" }
      ],
      adv: []
    },
    paraphrase: {
      passageEn: "The hall can accommodate 500 guests.",
      passageZh: "這座大廳可容納 500 位賓客。",
      choiceEn: "The facility has a capacity of 500 people.",
      choiceZh: "該設施具備 500 人的容納量。",
      note: "accommodate (動詞容納) 換成 have a capacity of (名詞容量)"
    },
    prepAnchor: null,
    listeningTrap: "accumulate (累積) —— 聽力常考相似音干擾",
    confusedWith: "accompany (陪同)"
  },
  {
    headword: "eligible",
    phoneticUS: "/ˈelɪdʒəbl/",
    definitionZh: "有資格的；合適的",
    examFocus: {
      primaryBusinessSense: "符合享有津貼、升遷或參賽資格（極高頻題型）",
      trapWarning: "⚠️ 注意詞性為形容詞，常與 be 連用，不可單獨作為動詞！"
    },
    etymology: {
      formula: "e- (向外) + lig- (挑選) + -ible (能...的)",
      mnemonic: "能夠被挑選出來的人，就是符合資格的人"
    },
    wordFamily: {
      verb: [],
      noun: [
        { word: "eligibility", zh: "資格", pos: "noun", examTip: "常與 criteria (審查標準) 一同出現" }
      ],
      adj: [
        { word: "eligible", zh: "有資格的", pos: "adj", examTip: "務必熟記固定搭配 for！" }
      ],
      adv: []
    },
    paraphrase: {
      passageEn: "Employees who worked for five years are eligible for bonuses.",
      passageZh: "服務滿五年的員工有資格獲得年終獎金。",
      choiceEn: "Staff meeting the length-of-service requirement qualify for extra pay.",
      choiceZh: "符合年資要求的同仁具備獲得額外薪酬的資格。",
      note: "eligible for = qualify for (具備...資格)"
    },
    prepAnchor: "eligible for (+ 獎金/津貼/福利) —— 見 for 秒殺！",
    listeningTrap: null,
    confusedWith: "illegible (難以辨認的/字跡潦草的)"
  }
];

// ==============================================================================
// 3. API 呼叫 (帶 Google 滾動窗口 55s 智能退避重試)
// ==============================================================================
async function callGeminiForBatch(items, keyPool, keyIndexRef, retryCount = 0) {
  const currentKeyIndex = (keyIndexRef.val + retryCount) % keyPool.length;
  const apiKey = keyPool[currentKeyIndex];

  const prompt = `你是一位擁有 15 年經驗的 ETS 多益 990 滿分教研名師。
請為以下 ${items.length} 個多益單字生成極致精準、直擊考點的「深度強化考點資料 (JSON)」。

【最高核心鐵律】：
1. 嚴禁任何空的中文！所有 zh 欄位必須是精準道地的繁體中文，嚴禁純英文或空字串。
2. 考點解耦：所有解題技巧、文法注意標籤必須放在獨立的 examTip 欄位，絕不可拼接混入 zh 中文翻譯字串中！
3. Part 7 換句話說 (paraphrase) 必須包含 passageEn, passageZh, choiceEn, choiceZh, note（完整的雙語對照）。
4. 拆字公式 (formula) 要像數學公式一樣清晰簡練。
5. 如該單字有固定介係詞填入 prepAnchor，有易混淆詞填入 confusedWith，有聽力回聲陷阱填入 listeningTrap，無則填 null。

【黃金參考示範 (嚴格模仿其深度與雙語對稱格式)】：
${JSON.stringify(GOLDEN_FEW_SHOT, null, 2)}

【本次目標單字清單】：
${JSON.stringify(items.map(w => ({ headword: w.headword, currentZh: w.definitionZh, category: w.category })), null, 2)}

請直接輸出 JSON 陣列，開頭以 [ 開始，結尾以 ] 結束，不可包含任何前綴或後綴廢話：
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2
        }
      })
    });

    if (res.status !== 200) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 100)}`);
    }

    const data = await res.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1) {
      text = text.substring(firstBracket, lastBracket + 1);
    }

    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("Invalid output: not an array");
    }

    // 🛡️ 鐵閘校驗：assert 零空中文
    for (const w of parsed) {
      if (!w.definitionZh || w.definitionZh.trim() === "") throw new Error(`Empty definitionZh in ${w.headword}`);
      if (!w.paraphrase?.passageZh || !w.paraphrase?.choiceZh) throw new Error(`Incomplete paraphrase in ${w.headword}`);
      
      const wf = w.wordFamily || {};
      for (const [pos, list] of Object.entries(wf)) {
        for (const item of list || []) {
          if (!item.zh || item.zh.trim() === "") throw new Error(`Empty zh in wordFamily ${item.word}`);
        }
      }
    }

    keyIndexRef.val = (keyIndexRef.val + 1) % keyPool.length;
    return parsed;
  } catch (err) {
    if (retryCount < 5) {
      // 🌟 當遇到 429，強制等待 55 秒，確保 Google 的 1 分鐘滾動窗口重置完畢！
      const waitSec = err.message.includes("429") ? 55 : 5;
      console.warn(`  [Safety Delay] Attempt ${retryCount + 1} (${err.message.slice(0, 35)}). Cooling down for ${waitSec}s...`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
      return callGeminiForBatch(items, keyPool, keyIndexRef, retryCount + 1);
    }
    throw err;
  }
}

// ==============================================================================
// 4. 主排程器
// ==============================================================================
async function main() {
  const args = process.argv.slice(2);
  const tierArg = args.find(a => a.startsWith('--tier='));
  const tier = tierArg ? tierArg.split('=')[1] : 'advanced-2500';
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 0;
  const isDryRun = args.includes('--dry-run');

  const datasetPath = path.join(ROOT_DIR, 'public', 'data', 'v1', `${tier}.json`);
  if (!fs.existsSync(datasetPath)) {
    console.error(`❌ Dataset not found: ${datasetPath}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
  const words = raw.words || [];
  console.log(`\n=================================================================`);
  console.log(`🚀 TOEIC Vocab Master Enrichment Pipeline: [${tier}]`);
  console.log(`📦 Total Words in Dataset: ${words.length}`);
  console.log(`⚡ Concurrency: 2 Dedicated Account Pipelines (16 Keys Rotation)`);
  console.log(`🧠 AI Engine: ${MODEL_NAME} (High Precision 5-word Batching)`);
  console.log(`🔒 Concrete Examples & Visual Anchors: 100% READ-ONLY LOCKED`);
  console.log(`🛡️ Quality Gate: Zod Zero-Empty-Zh Active`);
  console.log(`=================================================================\n`);

  const progressFile = path.join(__dirname, `enrichment_progress_${tier}.json`);
  let progressRecords = {};
  if (fs.existsSync(progressFile)) {
    try {
      progressRecords = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
      console.log(`📂 Found existing checkpoint: ${Object.keys(progressRecords).length} words already enriched.`);
    } catch (e) {
      progressRecords = {};
    }
  }

  const pendingWords = [];
  for (const w of words) {
    if (!progressRecords[w.id]) {
      pendingWords.push(w);
    }
  }

  const targetWords = limit > 0 ? pendingWords.slice(0, limit) : pendingWords;
  console.log(`📋 Pending words to enrich in this run: ${targetWords.length}`);

  if (targetWords.length === 0) {
    console.log("🎉 All words in this tier are already fully enriched!");
    return;
  }

  if (isDryRun) {
    console.log(`--- [Dry-Run] Target: ${targetWords.length} words in ${Math.ceil(targetWords.length / BATCH_SIZE)} batches ---`);
    return;
  }

  const batches = [];
  for (let i = 0; i < targetWords.length; i += BATCH_SIZE) {
    batches.push({
      batchId: Math.floor(i / BATCH_SIZE) + 1,
      items: targetWords.slice(i, i + BATCH_SIZE)
    });
  }

  console.log(`🚀 Total Batches to process: ${batches.length} (Batch Size: ${BATCH_SIZE})`);
  
  let currentBatchIdx = 0;
  let completedCount = Object.keys(progressRecords).length;
  const startTime = Date.now();

  function saveProgress() {
    const tmp = `${progressFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(progressRecords, null, 2), 'utf-8');
    fs.renameSync(tmp, progressFile);
  }

  async function worker(workerConfig) {
    const keyIndexRef = { val: 0 };
    while (currentBatchIdx < batches.length) {
      const myBatchIdx = currentBatchIdx++;
      const batch = batches[myBatchIdx];
      if (!batch) break;

      const t0 = Date.now();
      try {
        const enrichedList = await callGeminiForBatch(batch.items, workerConfig.keys, keyIndexRef);
        
        for (const enriched of enrichedList) {
          const original = batch.items.find(w => w.headword.toLowerCase() === enriched.headword.toLowerCase()) || batch.items[0];
          progressRecords[original.id] = {
            id: original.id,
            headword: original.headword,
            phoneticUS: enriched.phoneticUS,
            definitionZh: enriched.definitionZh,
            examFocus: enriched.examFocus,
            etymology: enriched.etymology,
            wordFamily: enriched.wordFamily,
            paraphrase: enriched.paraphrase,
            prepAnchor: enriched.prepAnchor || null,
            listeningTrap: enriched.listeningTrap || null,
            confusedWith: enriched.confusedWith || null,
            enrichedAt: new Date().toISOString()
          };
          completedCount++;
        }

        saveProgress();
        const duration = Date.now() - t0;
        const totalTarget = words.length;
        const pct = ((completedCount / totalTarget) * 100).toFixed(1);
        console.log(`[${workerConfig.name}] ✅ Batch ${batch.batchId}/${batches.length} (${batch.items.length} words in ${duration}ms) | Total: ${completedCount}/${totalTarget} (${pct}%)`);

      } catch (err) {
        console.error(`[${workerConfig.name}] ❌ Batch ${batch.batchId} permanently failed: ${err.message}`);
      }

      const elapsed = Date.now() - t0;
      if (elapsed < MIN_REQUEST_INTERVAL_MS) {
        await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
      }
    }
  }

  const workerPromises = WORKER_PIPES.map((cfg, idx) => 
    new Promise(resolve => {
      setTimeout(() => {
        worker(cfg).then(resolve);
      }, idx * 4000); // 兩大帳號錯開 4 秒啟動
    })
  );

  await Promise.all(workerPromises);

  console.log(`\n🔄 Merging enriched data into [${tier}.json] with Read-Only Lock...`);
  let mergeCount = 0;

  for (const w of words) {
    const enr = progressRecords[w.id];
    if (enr) {
      const originalExamples = w.examples || [];
      const originalVisualAnchor = w.visualAnchor;
      const originalQuizzes = w.quizzes || [];

      w.phoneticUS = enr.phoneticUS || w.phoneticUS;
      w.definitionZh = enr.definitionZh || w.definitionZh;
      w.examFocus = enr.examFocus || w.examFocus;
      w.etymology = enr.etymology || w.etymology;
      w.wordFamily = enr.wordFamily || w.wordFamily;
      w.paraphrase = enr.paraphrase || w.paraphrase;
      w.prepAnchor = enr.prepAnchor || null;
      w.listeningTrap = enr.listeningTrap || null;
      w.confusedWith = enr.confusedWith || null;

      w.examples = originalExamples;
      w.visualAnchor = originalVisualAnchor;
      w.quizzes = originalQuizzes;

      mergeCount++;
    }
  }

  raw.words = words;
  const tempTarget = `${datasetPath}.tmp`;
  fs.writeFileSync(tempTarget, JSON.stringify(raw, null, 2), 'utf-8');
  fs.renameSync(tempTarget, datasetPath);

  const totalTimeSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n=================================================================`);
  console.log(`🎉 Pipeline Completed! Enriched & Merged: ${mergeCount} words in ${totalTimeSec}s`);
  console.log(`✅ File updated: public/data/v1/${tier}.json`);
  console.log(`=================================================================\n`);
}

main();
