const apiKey = 'process.env.GEMINI_API_KEY';

async function testPedagogy() {
  const prompt = `
You are an elite ETS TOEIC Item Writer and 990 Master Teacher.
Generate a high-discrimination TOEIC Part 5 multiple choice question for the headword: "accommodate" (v. 配合需求；容納).

Target: Test high-level business collocation & distractor traps (650-850 score discriminator).

Return strictly valid JSON:
{
  "stem": "...",
  "stemTranslation": "...",
  "options": ["...", "...", "...", "..."],
  "answer": "...",
  "discriminationAnalysis": "Why this item separates 600-score from 850+ score test takers",
  "strategy": "5-second speed rule in Traditional Chinese",
  "examTrapTip": "Common intuitive trap in Traditional Chinese",
  "collocations": ["...", "..."],
  "optionAnalyses": [
    {"option": "...", "isCorrect": true, "pos": "v.", "meaning": "...", "reason": "..."},
    {"option": "...", "isCorrect": false, "pos": "v.", "meaning": "...", "reason": "..."},
    {"option": "...", "isCorrect": false, "pos": "v.", "meaning": "...", "reason": "..."},
    {"option": "...", "isCorrect": false, "pos": "v.", "meaning": "...", "reason": "..."}
  ]
}
`;

  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=' + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const data = await res.json();
  console.log(data?.candidates?.[0]?.content?.parts?.[0]?.text);
}
testPedagogy();
