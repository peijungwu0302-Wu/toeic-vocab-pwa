import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const WORDS_DIR = path.resolve('public/assets/images/words');

async function downloadPollinationsImage(prompt, filename) {
  const encodedPrompt = encodeURIComponent(prompt);
  // Using FLUX with seed for ultra consistency
  const seed = Math.floor(Math.random() * 1000000);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${seed}&model=flux`;
  const filePath = path.join(WORDS_DIR, filename);

  console.log(`📡 Fetching from Pollinations.ai: ${filename}...`);

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, (redirectRes) => {
          const fileStream = fs.createWriteStream(filePath);
          redirectRes.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            console.log(`✅ Saved successfully: ${filePath} (${fs.statSync(filePath).size} bytes)`);
            resolve(filePath);
          });
        }).on('error', reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Failed with status code: ${res.statusCode}`));
        return;
      }

      const fileStream = fs.createWriteStream(filePath);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`✅ Saved successfully: ${filePath} (${fs.statSync(filePath).size} bytes)`);
        resolve(filePath);
      });
    }).on('error', reject);
  });
}

async function main() {
  const prompt = 'photo of an Asian businesswoman in a navy blue suit shaking hands with a client across a glass conference table in a modern high-rise boardroom, bright natural daylight, depth of field, 8k resolution, professional commercial photography';
  const filename = `pollinations_agreement_test.jpg`;
  
  await downloadPollinationsImage(prompt, filename);
}

main().catch(console.error);
