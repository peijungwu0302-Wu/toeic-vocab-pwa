import fs from 'node:fs';

const queueState = JSON.parse(fs.readFileSync('scripts/image_queue_state.json', 'utf8'));
const queueKeys = Object.keys(queueState);
console.log(`image_queue_state.json contains: ${queueKeys.length} items.`);

const sampleKey = queueKeys[0];
console.log('Sample item:', queueState[sampleKey]);

let validPromptCount = 0;
let validExampleCount = 0;
for (const k of queueKeys) {
  const item = queueState[k];
  if (item.imagePrompt && item.imagePrompt.length > 10) validPromptCount++;
  if (item.visualExampleEn && item.visualExampleEn.length > 10) validExampleCount++;
}

console.log(`Valid Prompts in image_queue_state: ${validPromptCount}`);
console.log(`Valid Examples in image_queue_state: ${validExampleCount}`);
