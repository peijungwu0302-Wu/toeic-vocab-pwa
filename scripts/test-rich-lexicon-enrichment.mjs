import fs from 'node:fs';

const activeKey = 'process.env.GEMINI_API_KEY';

const testWords = [
  {
    headword: "accommodate",
    definitionZh: "配合需求；容納；提供住宿",
    partsOfSpeech: ["verb"],
    category: "營運管理與設施",
    toeicScoreRange: "650-850"
  },
  {
    headword: "revenue",
    definitionZh: "（公司）營收；營業額；（政府）稅收",
    partsOfSpeech: ["noun"],
    category: "財務審計與會計",
    toeicScoreRange: "550-750"
  },
  {
    headword: "comprehensive",
    definitionZh: "全面的；詳盡的；綜合的",
    partsOfSpeech: ["adjective"],
    category: "合約法規與談判",
    toeicScoreRange: "750-990"
  }
];

function extractValidJson(text) {
  const trimmed = text.trim();
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = trimmed.slice(firstBracket, lastBracket + 1);
    return JSON.parse(candidate);
  }
  return JSON.parse(trimmed);
}

async function generateRichLexicon(words) {
  const prompt = `
You are an elite ETS TOEIC Master Lexicographer and Mnemonic Expert (equivalent to BBWord / 不背單詞 VIP level).
For the following English vocabulary items, generate the complete, high-value, pedagogical learning enrichment data in Traditional Chinese.

Input items:
${JSON.stringify(words, null, 2)}

Requirements for EACH word:
1. examFocus:
   - primaryBusinessSense: The most frequent TOEIC exam meaning with percentage (e.g. "配合客戶需求 (多益考頻 75%)")
   - trapWarning: Explicit TOEIC exam trap warning (e.g. "多益常考抽象的配合要求，切勿只記住宿！")
2. etymology:
   - prefix: Prefix and meaning (or null)
   - root: Core root and meaning
   - suffix: Suffix and meaning (or null)
   - memoryHook: Catchy, logical Chinese mnemonic hook
3. wordFamily:
   - noun: Array of noun derivatives with Traditional Chinese meaning
   - verb: Array of verb derivatives with Traditional Chinese meaning
   - adjective: Array of adjective derivatives with Traditional Chinese meaning
   - adverb: Array of adverb derivatives with Traditional Chinese meaning
   - cognates: Array of related words sharing the same root
4. synonymDiscrimination:
   - synonyms: 3-5 top TOEIC synonyms
   - antonyms: 1-2 antonyms
   - discrimination: Nuanced TOEIC exam discrimination explaining when to use this word vs synonyms in workplace context
5. collocations:
   - Array of exactly 3 high-frequency business chunks: [{ "en": "...", "zh": "..." }, ...]
6. extendedExamples:
   - ex_2: { "scenario": "營運管理", "en": "...", "zh": "..." } (mark target word translation with 【...】)
   - ex_3: { "scenario": "策略拓展", "en": "...", "zh": "..." } (mark target word translation with 【...】)

Return strictly a JSON array of objects.
`;

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=' + activeKey;
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

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return extractValidJson(rawText);
}

async function run() {
  console.log('🤖 正在調用 Gemini 生成 3 個測試單字之「不背單詞 VIP 級」詞彙學資料...');
  const results = await generateRichLexicon(testWords);
  console.log(JSON.stringify(results, null, 2));
}

run().catch(console.error);
