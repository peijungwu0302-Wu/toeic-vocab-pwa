import fs from 'node:fs';
import path from 'node:path';

let apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
if (!apiKey) {
  try {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    const match = envContent.match(/GEMINI_API_KEY=([^\r\n]+)/);
    if (match) apiKey = match[1].trim();
  } catch {}
}

const TEMPLATE_PATTERN = /During the annual strategic summit|The newly revised operational guideline/i;

const corePath = path.resolve('public/data/v1/core-1200.json');
const coreData = JSON.parse(fs.readFileSync(corePath, 'utf8'));

const badWords = coreData.words.filter(w => w.examples && w.examples[0] && TEMPLATE_PATTERN.test(w.examples[0].en));
console.log(`Found ${badWords.length} words in core-1200.json to replace with top-tier authentic sentences...`);

async function callModel(batch) {
  const prompt = `
For each TOEIC business word, generate a natural, highly vivid, grammatically flawless, top-scoring TOEIC business example sentence:
Input: ${JSON.stringify(batch.map(w => ({ id: w.id, headword: w.headword, def: w.definitionZh, cat: w.category })))}

Requirements:
1. The English sentence must naturally use the headword in a realistic workplace context (e.g., signing contracts, flight boarding, budget auditing, HR hiring, shipping logistics).
2. "zh" must be an accurate, fluent Traditional Chinese translation (Taiwan business terminology). Do NOT use brackets like 【】.
3. Return a JSON array matching the input ids:
[
  { "id": "...", "en": "...", "zh": "...", "scenario": "..." }
]
`;

  const models = ['gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
  for (const m of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.3 }
        })
      });
      if (res.ok) {
        const data = await res.json();
        return JSON.parse(data.candidates[0].content.parts[0].text);
      }
    } catch {}
  }
  return null;
}

async function run() {
  if (badWords.length === 0) return;

  const BATCH_SIZE = 30;
  for (let i = 0; i < badWords.length; i += BATCH_SIZE) {
    const batch = badWords.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(badWords.length/BATCH_SIZE)} (${batch.length} words)...`);
    const results = await callModel(batch);
    if (Array.isArray(results)) {
      const resMap = new Map(results.map(r => [r.id, r]));
      batch.forEach(w => {
        const item = resMap.get(w.id);
        if (item) {
          w.examples = [{
            id: `ex_1_${w.headword}`,
            en: item.en.trim(),
            zh: item.zh.replace(/【([^】]+)】/g, '$1').trim(),
            scenario: item.scenario || w.category || '商務溝通'
          }];
        }
      });
    }
  }

  fs.writeFileSync(corePath, JSON.stringify(coreData, null, 2), 'utf8');
  console.log(`✅ core-1200.json 全部修復儲存完畢！`);
}

run();
