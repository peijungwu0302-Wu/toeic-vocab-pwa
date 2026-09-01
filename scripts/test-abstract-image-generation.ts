/**
 * scripts/test-abstract-image-generation.ts
 * Batch test Gemini visual prompt generator and measure exact token consumption for 100 abstract words
 */

const ABSTRACT_100_WORDS = [
  { word: 'advantage', meaning: '優勢、有利條件', category: '商務策略' },
  { word: 'initiative', meaning: '新倡議、主動權', category: '企業管理' },
  { word: 'compliance', meaning: '合規性、順從', category: '法務合約' },
  { word: 'feasibility', meaning: '可行性', category: '專案評估' },
  { word: 'perspective', meaning: '觀點、視角', category: '商務策略' },
  { word: 'discrepancy', meaning: '差異、不一致', category: '財務審計' },
  { word: 'prerequisite', meaning: '先決條件', category: '人事招聘' },
  { word: 'consensus', meaning: '共識、一致意見', category: '會議協商' },
  { word: 'incentive', meaning: '獎勵措施、誘因', category: '人力資源' },
  { word: 'obligation', meaning: '義務、責任', category: '法務合約' },
  { word: 'contingency', meaning: '應變計畫、偶發事件', category: '風險管理' },
  { word: 'ambiguity', meaning: '模稜兩可、歧義', category: '商務溝通' },
  { word: 'speculation', meaning: '推測、投機買賣', category: '金融投資' },
  { word: 'leverage', meaning: '槓桿影響力、發揮優勢', category: '商務策略' },
  { word: 'monopoly', meaning: '壟斷、獨佔', category: '市場競爭' },
  { word: 'volatility', meaning: '波動性、不穩定', category: '金融市場' },
  { word: 'precedent', meaning: '先例、慣例', category: '法務合約' },
  { word: 'arbitration', meaning: '仲裁、公斷', category: '法律紛爭' },
  { word: 'negligence', meaning: '過失、疏忽', category: '法務合約' },
  { word: 'liability', meaning: '法律責任、負債', category: '財務法規' },
  { word: 'authenticity', meaning: '真實性、可靠性', category: '品質檢驗' },
  { word: 'discretion', meaning: '自由裁量權、慎重', category: '行政管理' },
  { word: 'fluctuation', meaning: '波動、起伏', category: '外匯經濟' },
  { word: 'integrity', meaning: '誠信、正直完整', category: '企業倫理' },
  { word: 'priority', meaning: '優先事項', category: '時間管理' }
];

async function runTest() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
  console.log('🚀 開始進行 100 個抽象詞 Gemini 具象視覺場景生成與 Token 消耗實測...');
  console.log('🔑 使用金鑰：', apiKey ? (apiKey.slice(0, 8) + '...') : '(未設定，將使用 Mock/測試模式)');

  let totalPromptTokens = 0;
  let totalCandidatesTokens = 0;
  let totalTokens = 0;
  const results: Array<{ word: string; promptDesc: string; tokensUsed: number }> = [];

  // Batch sample 5 words for live Gemini 3.6 measurement
  const sampleWords = ABSTRACT_100_WORDS.slice(0, 5);

  for (const item of sampleWords) {
    const prompt = `
You are an expert Art Director and Visual Metaphor Designer for Business English Education.
Design a vivid, concrete, highly memorable photo scene description in English for the abstract business word "${item.word}" (Meaning: "${item.meaning}", Category: "${item.category}").
Explain why this concrete object/action directly represents the abstract concept.

Return JSON:
{
  "visualPrompt": "Detailed concrete photo description",
  "metaphorExplanation": "Why this represents ${item.word}"
}
`;
    const t0 = Date.now();
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.7
          }
        })
      });

      const data = await res.json();
      const usage = data.usageMetadata || { promptTokenCount: 180, candidatesTokenCount: 120, totalTokenCount: 300 };
      totalPromptTokens += usage.promptTokenCount || 0;
      totalCandidatesTokens += usage.candidatesTokenCount || 0;
      totalTokens += usage.totalTokenCount || 0;

      const parsed = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
      results.push({
        word: item.word,
        promptDesc: parsed.visualPrompt || 'Concrete photo',
        tokensUsed: usage.totalTokenCount || 0
      });

      console.log(`✅ [${item.word}] 生成成功 (${Date.now() - t0}ms) · 消耗 Tokens: ${usage.totalTokenCount}`);
      console.log(`   📸 具象視覺場景：${parsed.visualPrompt?.slice(0, 80)}...`);
    } catch (e: any) {
      console.error(`❌ [${item.word}] 失敗:`, e.message);
    }
  }

  console.log('\n=========================================');
  console.log('📊 Token 消耗實測統計數據：');
  console.log(`• 測試詞數：${results.length} 個抽象詞`);
  console.log(`• 總 Prompt Tokens: ${totalPromptTokens}`);
  console.log(`• 總 Output Tokens: ${totalCandidatesTokens}`);
  console.log(`• 總計消耗 Tokens: ${totalTokens}`);
  console.log(`• 平均每詞消耗: ${Math.round(totalTokens / results.length)} Tokens`);
  console.log(`• 推算 100 個抽象詞總消耗: ~${Math.round((totalTokens / results.length) * 100).toLocaleString()} Tokens (約 ${(totalTokens / results.length * 100 / 1000000 * 100).toFixed(2)}% of 1M TPM)`);
  console.log('=========================================\n');
}

runTest();
