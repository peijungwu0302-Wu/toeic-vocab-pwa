import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

let apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
if (!apiKey) {
  try {
    const envContent = fs.readFileSync(path.join(ROOT_DIR, '.env.local'), 'utf8');
    const match = envContent.match(/GEMINI_API_KEY=([^\r\n]+)/);
    if (match) apiKey = match[1].trim();
  } catch {}
}

const sampleWords = [
  { headword: 'a copy of', definitionZh: '一份副本；一份複本', category: '辦公日常', partsOfSpeech: ['noun phrase'] },
  { headword: 'a couple of', definitionZh: '一對，幾個（指兩個）', category: '溝通互動', partsOfSpeech: ['adjective'] },
  { headword: 'a glass of', definitionZh: '一杯（裝液體）', category: '住宿與餐飲', partsOfSpeech: ['noun phrase'] },
  { headword: 'a number of', definitionZh: '許多；大量', category: '辦公日常', partsOfSpeech: ['adjective'] },
  { headword: 'a piece of equipment', definitionZh: '設備；機器', category: '科技與技術支援', partsOfSpeech: ['noun phrase'] }
];

async function testBatch(modelName) {
  const prompt = `
You are a World-Class TOEIC Master Teacher and Corporate Visual Director.
For each given word/phrase, craft a vivid, crystal-clear, highly cinematic TOEIC business example sentence and a matching flat vector corporate editorial illustration prompt.

Requirements for each item:
1. "en": Natural, grammatically flawless, authentic high-scoring TOEIC business sentence where the word/phrase is naturally and accurately used in a concrete workplace scenario with strong visual imagery.
2. "zh": Precise, professional Traditional Chinese (繁體中文) translation.
3. "scenario": Specific business scenario tag in Traditional Chinese (e.g. "辦公行政", "客戶洽談", "餐飲接待", "設備檢修", "董事會議").
4. "imagePrompt": Flat vector corporate editorial illustration prompt describing the exact scene of "en". Include clean outlines, modern navy blue / teal / amber corporate color palette, crisp details, high-end commercial art style, 8k.

Input Words:
${JSON.stringify(sampleWords, null, 2)}

Return a JSON array of objects with keys: "headword", "en", "zh", "scenario", "imagePrompt".
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.3
      }
    })
  });

  const duration = Date.now() - t0;
  console.log(`[${modelName}] Status: ${res.status}, Time: ${duration}ms`);
  if (!res.ok) {
    console.log(await res.text());
  } else {
    const data = await res.json();
    const result = JSON.parse(data.candidates[0].content.parts[0].text);
    console.log(`✅ Success! Generated ${result.length} items.`);
    console.log(JSON.stringify(result[0], null, 2));
  }
}

async function run() {
  await testBatch('gemini-2.5-flash-lite');
  await testBatch('gemini-3.1-flash-lite');
}

run();
