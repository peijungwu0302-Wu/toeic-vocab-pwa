// scripts/enrich-visual-anchors-gemini.mjs
import fs from 'fs';
import path from 'path';

const ROOT_DIR = process.cwd();
const CACHE_FILE = path.join(ROOT_DIR, 'scripts', '.cache_visual_anchors_non_core.json');

// 1. Load API keys
const envPath = path.join(ROOT_DIR, '.env.local');
if (!fs.existsSync(envPath)) {
  console.error('❌ .env.local not found');
  process.exit(1);
}
const envContent = fs.readFileSync(envPath, 'utf8');
const poolMatch = envContent.match(/GEMINI_API_KEYS=([^\r\n]+)/);
let keyPool = [];
if (poolMatch) {
  keyPool = poolMatch[1].split(',').map(k => k.trim()).filter(Boolean);
} else {
  const single = envContent.match(/GEMINI_API_KEY=([^\r\n]+)/);
  if (single) keyPool = [single[1].trim()];
}

if (keyPool.length === 0) {
  console.error('❌ No API keys found in .env.local');
  process.exit(1);
}

console.log(`🔑 Dynamic Key Pool: ${keyPool.length} Gemini API keys loaded.`);

// 2. Parse CLI arguments
const args = process.argv.slice(2);
const limitArg = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '999999', 10);
const tierArg = args.find(a => a.startsWith('--tier='))?.split('=')[1];

const ALL_NON_CORE_TIERS = [
  'advanced-2500',
  'expert-high-part1',
  'expert-high-part2',
  'expert-high-part3'
];

const targetTiers = tierArg ? [tierArg] : ALL_NON_CORE_TIERS;

// 3. Load atomic cache
let cache = {};
if (fs.existsSync(CACHE_FILE)) {
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    console.log(`💾 Loaded existing cache: ${Object.keys(cache).length} words already completed.`);
  } catch (e) {
    console.warn('⚠️ Cache file corrupted or empty, starting fresh.');
  }
}

let saveDebounce = 0;
function saveCache(force = false) {
  saveDebounce++;
  if (force || saveDebounce >= 3) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
    saveDebounce = 0;
  }
}

// 4. Key Pool Manager with Cooldown
const cooldowns = new Map();
let keyCounter = 0;

function getAvailableKey() {
  const now = Date.now();
  for (let i = 0; i < keyPool.length; i++) {
    const candidate = keyPool[(keyCounter + i) % keyPool.length];
    const cd = cooldowns.get(candidate) || 0;
    if (now >= cd) {
      keyCounter = (keyCounter + i + 1) % keyPool.length;
      return candidate;
    }
  }
  let minKey = keyPool[0];
  let minTime = cooldowns.get(minKey) || 0;
  for (const k of keyPool) {
    const t = cooldowns.get(k) || 0;
    if (t < minTime) {
      minTime = t;
      minKey = k;
    }
  }
  const waitMs = Math.max(500, minTime - now);
  return { waitMs, key: minKey };
}

function markKeyCooldown(key, seconds = 25) {
  cooldowns.set(key, Date.now() + seconds * 1000);
}

// 5. LLM Batch Caller (7 words per batch)
async function processBatchWithRetries(batchWords, maxRetries = 5) {
  const prompt = `
You are an imaginative visual story director for a next-generation English vocabulary app.
CRITICAL MANDATE: DO NOT force every word into boring corporate offices, suits, and board meetings!
Actively diversify the scenarios across colorful modern daily life:
- Cozy coffee shops, indie bookstores, botanical bakeries, weekend farmers markets
- Train stations, airport boarding, modern travel, seaside harbors, outdoor hiking, city parks
- Pottery art studios, creative workshops, cooking in open sunlit kitchens, fitness gyms, science museums
- Campus lawns, community gardens, home DIY, smart apartments, bustling shopping streets
- Keep business only when the word genuinely demands it; otherwise, prioritize warm, vivid, highly memorable human lifestyle moments!

For EACH input word, generate:
1. shortEn: A vivid, relatable lifestyle or real-world sentence (STRICTLY 10 to 15 English words). Must clearly incorporate the target headword in natural context.
2. shortZh: Fluent, warm Traditional Chinese translation.
3. imagePrompt: A high-end stylized digital concept art illustration prompt matching this EXACT architectural aesthetic:
   "Stylized high-detail digital concept art illustration of '[headword]'. [Vivid scene description set in a cafe, market, transit, outdoor, studio, or modern living space]. In the prominent view or overhead, an illuminated glowing sign, neon board, digital terminal, or storefront plaque clearly displays '[A short uppercase phrase containing HEADWORD]'. [Characters in modern stylish attire engaging in joyful, relatable actions]. [Sunlit glass windows, warm ambient lighting, beautiful color harmony]. Crisp linework, vibrant daylight lighting, clean cel-shading with smooth reflections, rich architectural perspective, exact stylized concept art aesthetic, 1:1 square composition."

Input Words:
${JSON.stringify(batchWords.map(w => ({ id: w.id, headword: w.headword, definitionZh: w.definitionZh })), null, 2)}

Return strictly a JSON array of objects with schema:
[
  {
    "id": "word_id",
    "headword": "word",
    "shortEn": "...",
    "shortZh": "...",
    "imagePrompt": "..."
  }
]
`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const keyInfo = getAvailableKey();
    let currentKey = keyInfo;
    if (keyInfo && typeof keyInfo === 'object' && keyInfo.waitMs) {
      await new Promise(r => setTimeout(r, keyInfo.waitMs));
      currentKey = keyInfo.key;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${currentKey}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.8
          }
        })
      });

      if (res.status === 429) {
        markKeyCooldown(currentKey, 30);
        continue;
      }
      if (res.status >= 500) {
        markKeyCooldown(currentKey, 15);
        continue;
      }
      if (!res.ok) {
        continue;
      }

      const data = await res.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error('Empty response');

      const parsed = JSON.parse(rawText);
      if (!Array.isArray(parsed)) throw new Error('Not array');

      return parsed;
    } catch (err) {
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }

  return [];
}

// 6. Main Orchestrator
async function main() {
  console.log(`\n======================================================`);
  console.log(`🚀 Starting Full Non-Core Batch Generation (Target Tiers: ${targetTiers.join(', ')})`);
  console.log(`======================================================\n`);

  // Gather all pending words from target tiers
  const allPendingWords = [];
  const seenHeadwords = new Set();

  for (const tier of targetTiers) {
    const filePath = path.join(ROOT_DIR, 'public', 'data', 'v1', `${tier}.json`);
    if (!fs.existsSync(filePath)) continue;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const words = data.words || [];

    for (const w of words) {
      const norm = (w.headword || '').toLowerCase().trim();
      if (!cache[w.id] && !seenHeadwords.has(norm)) {
        seenHeadwords.add(norm);
        allPendingWords.push(w);
      }
    }
  }

  const tasksToRun = allPendingWords.slice(0, limitArg);
  console.log(`📋 Total pending words to process: ${tasksToRun.length} (out of ${allPendingWords.length} uncached)`);
  console.log(`💾 Already completed in cache: ${Object.keys(cache).length}\n`);

  if (tasksToRun.length === 0) {
    console.log('🎉 All words in target tiers are already completed!');
    return;
  }

  const BATCH_SIZE = 7;
  const startTime = Date.now();
  let completedCount = 0;

  for (let i = 0; i < tasksToRun.length; i += BATCH_SIZE) {
    const chunk = tasksToRun.slice(i, i + BATCH_SIZE);
    const results = await processBatchWithRetries(chunk);

    for (const r of results) {
      if (r && r.id && r.shortEn && r.imagePrompt) {
        cache[r.id] = {
          id: r.id,
          headword: r.headword,
          shortEn: r.shortEn,
          shortZh: r.shortZh,
          imagePrompt: r.imagePrompt,
          updatedAt: new Date().toISOString()
        };
        completedCount++;
      }
    }

    saveCache(false);

    if ((i / BATCH_SIZE) % 5 === 0 || i + BATCH_SIZE >= tasksToRun.length) {
      const elapsedSec = (Date.now() - startTime) / 1000;
      const rate = completedCount / Math.max(1, elapsedSec);
      const remaining = tasksToRun.length - completedCount;
      const etaMin = (remaining / Math.max(0.1, rate) / 60).toFixed(1);
      const totalCached = Object.keys(cache).length;
      console.log(`[Progress: ${completedCount}/${tasksToRun.length}] (${((completedCount / tasksToRun.length) * 100).toFixed(1)}%) | Rate: ${rate.toFixed(1)} words/s | ETA: ${etaMin} min | Total Cached: ${totalCached}`);
    }
  }

  saveCache(true);
  console.log(`\n======================================================`);
  console.log(`🎉 Batch run finished! Total in cache: ${Object.keys(cache).length}`);
  console.log(`======================================================\n`);
}

main().catch(console.error);
