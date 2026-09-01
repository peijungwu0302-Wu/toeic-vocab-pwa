const apiKey = 'AQ.Ab8RN6JX1T5iP38myZXbS2EdcHqYBTiUMtmZa5Xhju5UmX6P9w';

async function test(model) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: 'Explain accommodate in TOEIC in 30 words.' }] }] })
  });
  console.log(model, 'Status:', res.status);
  const text = await res.text();
  console.log(model, 'Output:', text.slice(0, 250));
}

async function run() {
  await test('gemini-2.5-flash');
  await test('gemini-3.6-flash');
  await test('gemini-2.5-pro');
}
run();
