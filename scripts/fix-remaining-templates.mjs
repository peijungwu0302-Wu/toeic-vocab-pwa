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

const files = [
  'advanced-2500.json',
  'expert-high-part1.json',
  'expert-high-part2.json',
  'expert-high-part3.json'
];

const TEMPLATE_PATTERN = /The management team implemented the standard procedures for/i;

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
  for (const f of files) {
    const p = path.resolve('public/data/v1', f);
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const badWords = data.words.filter(w => w.examples && w.examples[0] && TEMPLATE_PATTERN.test(w.examples[0].en));

    if (badWords.length > 0) {
      console.log(`Fixing ${badWords.length} template words in ${f}...`);
      const prompt = `
For each given word/phrase, craft a natural, highly vivid, authentic TOEIC business sentence where the word is naturally used:
Input: ${JSON.stringify(badWords.map(w => ({ id: w.id, headword: w.headword, def: w.definitionZh, cat: w.category })))}

Return JSON array:
[
  { "id": "...", "en": "...", "zh": "...", "scenario": "..." }
]
`;
      const fixed = await callModel(prompt);
      if (Array.isArray(fixed)) {
        const fixMap = new Map(fixed.map(x => [x.id, x]));
        badWords.forEach(w => {
          const item = fixMap.get(w.id);
          if (item) {
            w.examples[0] = {
              id: `ex_1_${w.headword}`,
              en: item.en,
              zh: item.zh,
              scenario: item.scenario || w.category || '辦公日常'
            };
          }
        });
        fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
        console.log(`✅ ${f} 成功清除修復！`);
      }
    }
  }
}

run();
