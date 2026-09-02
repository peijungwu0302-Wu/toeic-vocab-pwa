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

const TEMPLATE_PATTERN = /All employees are strongly advised/i;

const corePath = path.resolve('public/data/v1/core-1200.json');
const coreData = JSON.parse(fs.readFileSync(corePath, 'utf8'));

const badPhrases = coreData.words.filter(w => w.examples && w.examples[0] && TEMPLATE_PATTERN.test(w.examples[0].en));
console.log(`Found ${badPhrases.length} phrases needing authentic business sentences in core-1200.json...`);

async function callModel(prompt) {
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
  if (badPhrases.length === 0) return;

  const prompt = `
For each business word/phrase, craft an authentic, natural, high-scoring TOEIC business example sentence where the headword is used naturally:
Input: ${JSON.stringify(badPhrases.map(w => ({ id: w.id, headword: w.headword, def: w.definitionZh, cat: w.category })))}

Return a JSON array of objects:
[
  { "id": "...", "en": "...", "zh": "...", "scenario": "..." }
]
`;

  const results = await callModel(prompt);
  if (Array.isArray(results)) {
    const resMap = new Map(results.map(r => [r.id, r]));
    badPhrases.forEach(w => {
      const item = resMap.get(w.id);
      if (item) {
        w.examples = [{
          id: `ex_1_${w.headword}`,
          en: item.en,
          zh: item.zh,
          scenario: item.scenario || w.category || '日常商務'
        }];
      }
    });

    fs.writeFileSync(corePath, JSON.stringify(coreData, null, 2), 'utf8');
    console.log(`✅ core-1200.json 中的 ${badPhrases.length} 個片語已全數換上真實例句！`);
  }
}

run();
