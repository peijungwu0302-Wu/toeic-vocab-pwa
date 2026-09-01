import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const prompt = 'flat vector corporate editorial illustration of a modern business airport departure lounge, an Asian businesswoman scanning a boarding pass on her smartphone at the gate counter, airplane visible outside large panoramic glass windows, clean modern lines, corporate navy blue and mint teal color palette, minimalist aesthetic, Behance trending, high resolution vector art, 8k';
const encoded = encodeURIComponent(prompt);
const seed = 42891;
const url = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true&seed=${seed}&model=flux`;
const targetPath = path.resolve('public/assets/images/benchmark/test_flux_illustration.jpg');

https.get(url, (res) => {
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    https.get(res.headers.location, (redirectRes) => {
      const stream = fs.createWriteStream(targetPath);
      redirectRes.pipe(stream);
      stream.on('finish', () => {
        stream.close();
        console.log('✅ Downloaded successfully to:', targetPath);
      });
    });
    return;
  }
  const stream = fs.createWriteStream(targetPath);
  res.pipe(stream);
  stream.on('finish', () => {
    stream.close();
    console.log('✅ Downloaded successfully to:', targetPath);
  });
});
