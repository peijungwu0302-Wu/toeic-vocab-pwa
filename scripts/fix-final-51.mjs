import fs from 'node:fs';

const c1200 = JSON.parse(fs.readFileSync('public/data/v1/core-1200.json', 'utf8'));
const TEMPLATE_PATTERN = /During the annual strategic summit|The newly revised operational guideline|All employees are strongly advised/i;

const remaining = c1200.words.filter(w => w.examples && w.examples[0] && TEMPLATE_PATTERN.test(w.examples[0].en));
console.log(`Remaining count: ${remaining.length}`);

let apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
if (!apiKey) {
  try {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    const match = envContent.match(/GEMINI_API_KEY=([^\r\n]+)/);
    if (match) apiKey = match[1].trim();
  } catch {}
}

async function fix() {
  const prompt = `
Generate natural, realistic TOEIC business example sentences for these words:
${JSON.stringify(remaining.map(w => ({ id: w.id, headword: w.headword, def: w.definitionZh, cat: w.category })))}

Return a JSON array of objects with exact keys:
[
  { "id": "exact_id_from_input", "en": "English sentence", "zh": "繁體中文翻譯", "scenario": "情境" }
]
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
    })
  });

  if (res.ok) {
    const data = await res.json();
    const list = JSON.parse(data.candidates[0].content.parts[0].text);
    console.log(`Received ${list.length} results.`);
    const map = new Map(list.map(x => [x.id, x]));

    remaining.forEach(w => {
      const item = map.get(w.id);
      if (item && item.en && item.zh) {
        w.examples = [{
          id: `ex_1_${w.headword}`,
          en: item.en.trim(),
          zh: item.zh.replace(/【([^】]+)】/g, '$1').trim(),
          scenario: item.scenario || w.category || '日常商務'
        }];
      }
    });

    fs.writeFileSync('public/data/v1/core-1200.json', JSON.stringify(c1200, null, 2), 'utf8');
    console.log('✅ core-1200.json updated successfully!');
  }
}

fix();
