const apiKey = 'process.env.GEMINI_API_KEY';

async function test(model) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: 'Hello' }] }] })
  });
  console.log(model, 'Status:', res.status);
  const text = await res.text();
  console.log(model, 'Output:', text.slice(0, 150));
}

async function run() {
  await test('gemini-3.1-flash-lite-preview');
  await test('gemini-3.1-flash-lite');
  await test('gemini-3-flash-preview');
}
run();
