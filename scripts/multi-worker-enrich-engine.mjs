// scripts/multi-worker-enrich-engine.mjs
import fs from 'fs';
import path from 'path';

const ROOT_DIR = process.cwd();
const CACHE_FILE = path.join(ROOT_DIR, 'scripts', '.cache_visual_anchors_non_core.json');
const TEMP_CACHE_FILE = path.join(ROOT_DIR, 'scripts', '.cache_visual_anchors_non_core.json.tmp');

// ============================================================================
// 1. CONFIGURATION & CLI ARGS
// ============================================================================
const args = process.argv.slice(2);
const concurrencyArg = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '3', 10);
const batchSizeArg = parseInt(args.find(a => a.startsWith('--batch='))?.split('=')[1] || '6', 10);
const maxRpmPerKey = parseInt(args.find(a => a.startsWith('--rpm='))?.split('=')[1] || '12', 10); // Safe < 15 RPM
const tierArg = args.find(a => a.startsWith('--tier='))?.split('=')[1];

const ALL_NON_CORE_TIERS = [
  'advanced-2500',
  'expert-high-part1',
  'expert-high-part2',
  'expert-high-part3'
];
const targetTiers = tierArg ? [tierArg] : ALL_NON_CORE_TIERS;

// Load API Keys from .env.local
const envPath = path.join(ROOT_DIR, '.env.local');
if (!fs.existsSync(envPath)) {
  console.error('❌ .env.local not found');
  process.exit(1);
}
const envContent = fs.readFileSync(envPath, 'utf8');
let keyPool = [];
const poolMatch = envContent.match(/GEMINI_API_KEYS=([^\r\n]+)/);
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

console.log(`=================================================================`);
console.log(`🚀 Multi-Worker Resilient Pipeline Initializing`);
console.log(`🔑 Key Pool: ${keyPool.length} distinct API keys loaded`);
console.log(`⚡ Concurrency: ${concurrencyArg} parallel workers | Batch size: ${batchSizeArg} words/call`);
console.log(`🛡️ Rate Limiter: Max ${maxRpmPerKey} RPM per key (Anti-Abuse Jitter Active)`);
console.log(`=================================================================\n`);

// ============================================================================
// 2. KEY MANAGER & CIRCUIT BREAKER (Per-Key Sliding Window + Anti-Abuse)
// ============================================================================
class KeyManager {
  constructor(keys, maxRpm = 12) {
    this.keys = keys;
    this.maxRpm = maxRpm;
    this.cooldowns = new Map();      // key -> cooldownExpiry
    this.requestLogs = new Map();    // key -> array of request timestamps in last 60s
    this.keyIndex = 0;

    for (const k of keys) {
      this.requestLogs.set(k, []);
    }
  }

  // Get a key that is neither on 429 cooldown nor exceeding sliding window RPM
  async acquireKey() {
    while (true) {
      const now = Date.now();

      // Clean up sliding window logs (> 60s old)
      for (const [k, timestamps] of this.requestLogs.entries()) {
        this.requestLogs.set(k, timestamps.filter(t => now - t < 60000));
      }

      // Look for a key ready to fire
      for (let i = 0; i < this.keys.length; i++) {
        const candidate = this.keys[(this.keyIndex + i) % this.keys.length];
        const cd = this.cooldowns.get(candidate) || 0;
        const currentReqs = (this.requestLogs.get(candidate) || []).length;

        if (now >= cd && currentReqs < this.maxRpm) {
          this.keyIndex = (this.keyIndex + i + 1) % this.keys.length;
          this.requestLogs.get(candidate).push(now);
          return candidate;
        }
      }

      // If all keys are busy/cooling, wait 800ms with random jitter and retry
      const jitter = Math.floor(Math.random() * 400) + 600;
      await new Promise(r => setTimeout(r, jitter));
    }
  }

  reportError(key, status) {
    if (status === 429) {
      console.warn(`  🚨 [Circuit Breaker] Key ${key.slice(0, 10)}... hit 429! Cooldown 30s.`);
      this.cooldowns.set(key, Date.now() + 30000);
    } else if (status >= 500) {
      console.warn(`  ⚠️ [Circuit Breaker] Key ${key.slice(0, 10)}... hit ${status}! Cooldown 15s.`);
      this.cooldowns.set(key, Date.now() + 15000);
    }
  }
}

const keyManager = new KeyManager(keyPool, maxRpmPerKey);

// ============================================================================
// 3. ATOMIC STORAGE (Zero-Loss & Corrupt-Proof File Swapping)
// ============================================================================
class AtomicStorage {
  constructor(filePath, tempPath) {
    this.filePath = filePath;
    this.tempPath = tempPath;
    this.cache = new Map();
    this.dirty = false;
    this.load();

    // Auto flush every 4 seconds
    setInterval(() => this.flush(), 4000);
  }

  load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        for (const [k, v] of Object.entries(raw)) {
          this.cache.set(k, v);
        }
        console.log(`💾 Atomic Storage Loaded: ${this.cache.size} words already cached.`);
      } catch (e) {
        console.warn(`⚠️ Cache load error, verifying integrity: ${e.message}`);
      }
    }
  }

  put(item) {
    this.cache.set(item.id, item);
    this.dirty = true;
  }

  has(id) {
    return this.cache.has(id);
  }

  size() {
    return this.cache.size;
  }

  flush() {
    if (!this.dirty) return;
    try {
      const obj = {};
      for (const [k, v] of this.cache.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(this.tempPath, JSON.stringify(obj, null, 2), 'utf8');
      fs.renameSync(this.tempPath, this.filePath);
      this.dirty = false;
    } catch (e) {
      console.error(`❌ Flush failed: ${e.message}`);
    }
  }
}

const storage = new AtomicStorage(CACHE_FILE, TEMP_CACHE_FILE);

// ============================================================================
// 4. QUALITY GATE (Strict Validation to eliminate truncated/malformed entries)
// ============================================================================
function validateEntry(item) {
  if (!item || !item.id || !item.headword) return false;
  const words = (item.shortEn || '').trim().split(/\s+/);
  if (words.length < 8 || words.length > 22) return false;
  if (!item.shortZh || item.shortZh.length < 3) return false;
  const prompt = (item.imagePrompt || '').toLowerCase();
  const hasSign = prompt.includes('sign') || prompt.includes('board') || prompt.includes('display') || prompt.includes('led');
  if (!hasSign) return false;
  return true;
}

// ============================================================================
// 5. LLM CALLER WITH ANTI-ABUSE TRAFFIC SMOOTHING
// ============================================================================
async function callGeminiBatch(batchWords, attempt = 1) {
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

  // Anti-Abuse Jitter (300ms ~ 800ms)
  const jitter = Math.floor(Math.random() * 500) + 300;
  await new Promise(r => setTimeout(r, jitter));

  const key = await keyManager.acquireKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${key}`;

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

    if (!res.ok) {
      keyManager.reportError(key, res.status);
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('Empty model payload');

    const parsed = JSON.parse(rawText);
    if (!Array.isArray(parsed)) throw new Error('Parsed output is not an array');

    return parsed;
  } catch (err) {
    if (attempt <= 3) {
      const wait = attempt * 1500;
      await new Promise(r => setTimeout(r, wait));
      return callGeminiBatch(batchWords, attempt + 1);
    }
    return [];
  }
}

// ============================================================================
// 6. WORKER POOL & PRODUCER-CONSUMER DISPATCHER
// ============================================================================
async function main() {
  // Collect all target words from datasets
  const allTargetWords = [];
  const seen = new Set();

  for (const tier of targetTiers) {
    const p = path.join(ROOT_DIR, 'public', 'data', 'v1', `${tier}.json`);
    if (!fs.existsSync(p)) continue;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const w of data.words || []) {
      const norm = (w.headword || '').toLowerCase().trim();
      if (!seen.has(norm)) {
        seen.add(norm);
        allTargetWords.push(w);
      }
    }
  }

  // Calculate pending tasks via Set Difference Reconciliation (0% Drop Guarantee)
  const queue = allTargetWords.filter(w => !storage.has(w.id));
  console.log(`📋 Total Target Dataset Words: ${allTargetWords.length}`);
  console.log(`💾 Existing in Cache: ${storage.size()}`);
  console.log(`🎯 Pending to Process: ${queue.length}\n`);

  if (queue.length === 0) {
    console.log(`🎉 All ${allTargetWords.length} words are already 100% completed!`);
    storage.flush();
    return;
  }

  let processedCount = 0;
  const totalToProcess = queue.length;
  const startTime = Date.now();

  // Worker task runner
  async function worker(workerId) {
    while (queue.length > 0) {
      // Safely dequeue a batch
      const chunk = queue.splice(0, batchSizeArg);
      if (chunk.length === 0) break;

      const chunkMap = new Map(chunk.map(c => [c.id, c]));
      const results = await callGeminiBatch(chunk);

      // Validate and store results
      const resolvedIds = new Set();
      for (const r of results) {
        if (chunkMap.has(r.id) && validateEntry(r)) {
          storage.put({
            id: r.id,
            headword: r.headword,
            shortEn: r.shortEn,
            shortZh: r.shortZh,
            imagePrompt: r.imagePrompt,
            updatedAt: new Date().toISOString()
          });
          resolvedIds.add(r.id);
          processedCount++;
        }
      }

      // If any word in chunk was dropped by LLM, re-enqueue it immediately (ZERO-LOSS GUARANTEE)
      for (const c of chunk) {
        if (!resolvedIds.has(c.id)) {
          console.warn(`  🔄 [Auto-Requeue] Word '${c.headword}' dropped by LLM, pushing back to queue.`);
          queue.push(c);
        }
      }

      // Progress reporting
      const elapsedSec = (Date.now() - startTime) / 1000;
      const rate = processedCount / Math.max(1, elapsedSec);
      const remaining = queue.length;
      const etaMin = (remaining / Math.max(0.1, rate) / 60).toFixed(1);
      const pct = (((allTargetWords.length - remaining) / allTargetWords.length) * 100).toFixed(1);

      console.log(`[W${workerId}] +${resolvedIds.size} saved | Total Progress: ${storage.size()}/${allTargetWords.length} (${pct}%) | Speed: ${rate.toFixed(1)} w/s | ETA: ${etaMin}m`);
    }
  }

  // Launch N Workers in parallel
  console.log(`🚀 Spawning ${concurrencyArg} Concurrent Workers...`);
  const workerPromises = [];
  for (let i = 1; i <= concurrencyArg; i++) {
    // Stagger worker boot with 600ms offset
    await new Promise(r => setTimeout(r, 600));
    workerPromises.push(worker(i));
  }

  await Promise.all(workerPromises);

  // Final Reconciliation Sweep (Pass 2: Hard-Check Diff)
  console.log(`\n🔍 Running Final Reconciliation Sweep...`);
  const remainingMissing = allTargetWords.filter(w => !storage.has(w.id));
  if (remainingMissing.length === 0) {
    console.log(`✅ 100.00% Zero-Loss Verification Passed! All ${allTargetWords.length} words in cache.`);
  } else {
    console.log(`⚠️ ${remainingMissing.length} stragglers detected. Sweeping now...`);
    // Sweep remaining 1 by 1
    for (const w of remainingMissing) {
      const res = await callGeminiBatch([w]);
      if (res[0] && validateEntry(res[0])) {
        storage.put(res[0]);
      }
    }
  }

  storage.flush();
  console.log(`\n=================================================================`);
  console.log(`🎉 Pipeline Completely Finished! Total Saved in Cache: ${storage.size()}`);
  console.log(`=================================================================\n`);
}

main().catch(console.error);
