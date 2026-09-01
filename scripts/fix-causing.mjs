import fs from 'node:fs';
const data = JSON.parse(fs.readFileSync('public/data/v1/core-1200.json', 'utf8'));
const w = data.words.find(x => x.headword === 'causing');
if (w) {
  w.examples[0] = {
    id: 'ex_1_causing',
    en: 'The unexpected server outage is causing a temporary disruption to our online payment processing system.',
    zh: '突發的伺服器中斷正導致我們的線上支付處理系統出現暫時性故障。',
    scenario: '科技與技術支援'
  };
  w.visualAnchor = {
    imagePrompt: 'Flat vector illustration, a modern IT server room with an engineer checking a tablet displaying an error warning screen, clean lines, navy blue and alert amber color palette, minimalist style, 8k.',
    scene: '科技與技術支援：突發的伺服器中斷正導致線上支付系統出現故障。'
  };
}
fs.writeFileSync('public/data/v1/core-1200.json', JSON.stringify(data, null, 2), 'utf8');

// Update queue state as well
const queue = JSON.parse(fs.readFileSync('scripts/image_queue_state.json', 'utf8'));
const p = queue.pending.find(x => x.headword === 'causing');
if (p) {
  p.visualExampleEn = 'The unexpected server outage is causing a temporary disruption to our online payment processing system.';
  p.visualExampleZh = '突發的伺服器中斷正導致我們的線上支付處理系統出現暫時性故障。';
  p.scenario = '科技與技術支援';
  p.imagePrompt = 'Flat vector illustration, a modern IT server room with an engineer checking a tablet displaying an error warning screen, clean lines, navy blue and alert amber color palette, minimalist style, 8k.';
}
fs.writeFileSync('scripts/image_queue_state.json', JSON.stringify(queue, null, 2), 'utf8');

console.log('✅ Word causing repaired successfully!');
