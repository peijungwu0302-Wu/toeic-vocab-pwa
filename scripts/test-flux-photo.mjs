import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const prompt = 'commercial photo of an Asian businesswoman in a navy blue suit scanning a mobile boarding pass at a bright modern airport departure gate, Boeing 787 airplane visible through large sunny terminal windows, cinematic daylight, professional 8k photography, sharp focus';
const encoded = encodeURIComponent(prompt);
const seed = 998822;
const url = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true&seed=${seed}&model=flux`;
const targetPath = path.resolve('public/assets/images/benchmark/test_flux_photo.jpg');

https.get(url, (res) => {
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    https.get(res.headers.location, (redirectRes) => {
      const stream = fs.createWriteStream(targetPath);
      redirectRes.pipe(stream);
      stream.on('finish', () => {
        stream.close();
        console.log('✅ Photo downloaded successfully to:', targetPath);
      });
    });
    return;
  }
  const stream = fs.createWriteStream(targetPath);
  res.pipe(stream);
  stream.on('finish', () => {
    stream.close();
    console.log('✅ Photo downloaded successfully to:', targetPath);
  });
});
