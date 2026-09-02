const apiKey = 'process.env.GEMINI_API_KEY';

async function testPedagogy() {
  const prompt = `
You are an elite ETS TOEIC Item Writer and 990 Master Teacher.
Generate a high-discrimination TOEIC Part 5 multiple choice question for the headword: "accommodate" (v. 配合需求；容納).

Target: High-level business collocation & distractor traps (650-850 score discriminator).

Return strictly valid JSON in Traditional Chinese:
{
  "stem": "The hotel conference center made exceptional arrangements to _______ the dietary restrictions and seating preferences of all international delegates.",
  "stemTranslation": "飯店會議中心做了特殊安排，以【配合滿足】所有國際代表的飲食限制與座位偏好。",
  "options": ["accommodate", "terminate", "postpone", "negotiate"],
  "answer": "accommodate",
  "discriminationPower": "Why this item separates 600 from 850 score students",
  "strategy": "5-second speed rule in Traditional Chinese",
  "examTrapTip": "Exam trap tip in Traditional Chinese",
  "collocations": ["accommodate dietary restrictions (配合飲食要求)", "accommodate special requests (配合特殊要求)"],
  "optionAnalyses": [
    {"option": "accommodate", "isCorrect": true, "pos": "v.", "meaning": "配合需求；容納", "reason": "【正解】契合動賓搭配 accommodate preferences/restrictions。"},
    {"option": "terminate", "isCorrect": false, "pos": "v.", "meaning": "終止", "reason": "【干擾】語意相反。"},
    {"option": "postpone", "isCorrect": false, "pos": "v.", "meaning": "延期", "reason": "【干擾】受詞為偏好非時程。"},
    {"option": "negotiate", "isCorrect": false, "pos": "v.", "meaning": "談判", "reason": "【干擾】搭配不當。"}
  ]
}
`;

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=' + apiKey;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const data = await res.json();
  console.log(data?.candidates?.[0]?.content?.parts?.[0]?.text);
}
testPedagogy();
