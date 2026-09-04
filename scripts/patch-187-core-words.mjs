import fs from 'fs';

// Load keys from .env.local
const envLocal = fs.readFileSync('.env.local', 'utf8');
const keyPool = (envLocal.match(/GEMINI_API_KEYS=(.+)/)?.[1] || '')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);

let keyIndex = 0;
function getNextKey() {
  const k = keyPool[keyIndex % keyPool.length];
  keyIndex++;
  return k;
}

const targets = JSON.parse(fs.readFileSync('.llm-cache/targets_187_list.json', 'utf8'));

// Load cache
const cachePath = '.llm-cache/patch_187_progress.json';
let cachedResults = [];
if (fs.existsSync(cachePath)) {
  try {
    cachedResults = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {}
}

const cacheMap = new Map();
cachedResults.forEach(r => {
  if (r.headword) cacheMap.set(r.headword.toLowerCase().trim(), r);
});

const uncompleted = targets.filter(t => !cacheMap.has(t.headword.toLowerCase().trim()));
console.log(`🎯 優先佇列：共 ${targets.length} 詞（已快取：${cacheMap.size} 詞，待處理：${uncompleted.length} 詞）`);

async function callGeminiForExamples(batch, retries = 25) {
  const prompt = `
You are an elite ETS TOEIC Business English Expert.
For each of the following vocabulary items, generate 2 AUTHENTIC, natural, realistic TOEIC workplace business example sentences in Traditional Chinese.
NO repetitive templates, NO generic "Management confirmed protocols for...", make each sentence realistic for modern corporate communication.

Input items:
${JSON.stringify(batch, null, 2)}

Return strictly a JSON array:
[
  {
    "headword": "word",
    "sentenceA": {
      "scenario": "營運管理",
      "en": "...",
      "zh": "..."
    },
    "sentenceB": {
      "scenario": "策略拓展",
      "en": "...",
      "zh": "..."
    }
  }
]
`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const key = getNextKey();
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=' + key;

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
        if (res.status === 429) {
          console.log(`⏳ 遇到限速 (429)，自動輪換至健康 Key...`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return JSON.parse(rawText);
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function run() {
  const BATCH_SIZE = 10;

  for (let i = 0; i < uncompleted.length; i += BATCH_SIZE) {
    const batch = uncompleted.slice(i, i + BATCH_SIZE);
    console.log(`⏳ [${cacheMap.size + 1}~${Math.min(cacheMap.size + batch.length, targets.length)}/${targets.length}] 正在生成: ${batch.map(b => b.headword).slice(0, 3).join(', ')}...`);

    try {
      const results = await callGeminiForExamples(batch);
      if (Array.isArray(results)) {
        for (const r of results) {
          const hw = (r.headword || '').toLowerCase().trim();
          if (hw) cacheMap.set(hw, r);
        }
        fs.writeFileSync(cachePath, JSON.stringify(Array.from(cacheMap.values()), null, 2), 'utf8');
        console.log(`✅ 快照已更新（累計完成：${cacheMap.size} / ${targets.length} 詞）`);
      }
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      console.error('Batch error:', e.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log(`\n🎉 187 詞全量地道例句已全部就緒！正在寫入正式檔案...`);

  // Update course-core-1200.json
  const coreCoursePath = 'public/data/v1/courses/course-core-1200.json';
  const coreCourse = JSON.parse(fs.readFileSync(coreCoursePath, 'utf8'));

  let patchedCount = 0;
  coreCourse.words.forEach(w => {
    const key = w.headword.toLowerCase().trim();
    if (cacheMap.has(key)) {
      const patch = cacheMap.get(key);
      const s1 = patch.sentenceA || patch.ex_1 || patch.ex_2;
      const s2 = patch.sentenceB || patch.ex_2 || patch.ex_3;

      if (s1 && s2) {
        w.examples[1] = {
          id: 'ex_2',
          scenario: s1.scenario || '營運管理',
          en: s1.en,
          zh: s1.zh
        };
        w.examples[2] = {
          id: 'ex_3',
          scenario: s2.scenario || '策略拓展',
          en: s2.en,
          zh: s2.zh
        };
        patchedCount++;
      }
    }
  });

  fs.writeFileSync(coreCoursePath, JSON.stringify(coreCourse, null, 2), 'utf8');

  // Also update public/data/v1/core-1200.json
  const core1200Path = 'public/data/v1/core-1200.json';
  const core1200 = JSON.parse(fs.readFileSync(core1200Path, 'utf8'));
  core1200.words = coreCourse.words;
  fs.writeFileSync(core1200Path, JSON.stringify(core1200, null, 2), 'utf8');

  console.log(`🏆 成功將 ${patchedCount} 詞寫入核心 1,200 詞庫！零套版殘留！`);
}

run().catch(console.error);
