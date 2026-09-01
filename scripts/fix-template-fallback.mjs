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

async function fixBatch(words) {
  const prompt = `
For each given word/phrase, craft a natural, highly vivid, authentic TOEIC business sentence:
Input: ${JSON.stringify(words.map(w => ({ id: w.id, headword: w.headword, def: w.definitionZh, cat: w.category })))}

Return JSON array:
[
  { "id": "...", "en": "...", "zh": "...", "scenario": "..." }
]
`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return JSON.parse(data.candidates[0].content.parts[0].text);
}

async function run() {
  for (const f of files) {
    const p = path.resolve('public/data/v1', f);
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const badWords = data.words.filter(w => w.examples && w.examples[0] && TEMPLATE_PATTERN.test(w.examples[0].en));

    if (badWords.length > 0) {
      console.log(`Fixing ${badWords.length} template words in ${f}...`);
      const fixed = await fixBatch(badWords);
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
      console.log(`✅ ${f} fixed!`);
    }
  }
}

run().catch(console.error);
