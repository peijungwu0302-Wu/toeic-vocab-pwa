import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const INCOMING_DIR = path.join(ROOT_DIR, 'incoming_images');
const WORDS_DIR = path.join(ROOT_DIR, 'public', 'assets', 'images', 'words');
const ORIGINALS_DIR = path.join(ROOT_DIR, 'public', 'assets', 'images', 'originals');
const AUDIT_FILE = path.join(ROOT_DIR, 'scripts', 'image_generation_audit.json');
const LOCAL_WORDS_FILE = path.join(ROOT_DIR, 'src', 'data', 'localImageWords.json');

fs.mkdirSync(INCOMING_DIR, { recursive: true });
fs.mkdirSync(WORDS_DIR, { recursive: true });
fs.mkdirSync(ORIGINALS_DIR, { recursive: true });

function slugify(text) {
  return text.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

console.log('================================================================');
console.log('📥 多益單字外部生圖極速批次匯入工具 (Batch Image Importer)');
console.log(`掃描目錄: ${INCOMING_DIR}`);
console.log('================================================================\n');

const files = fs.readdirSync(INCOMING_DIR).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));

if (files.length === 0) {
  console.log(`ℹ️  目前 ${INCOMING_DIR} 中沒有待匯入的圖檔。`);
  console.log('👉 請將外出筆電從 Gemini 網頁版下載的圖片（檔名為單字名，如 abandon.jpg）放入 incoming_images 資料夾後，再次執行本腳本！\n');
  process.exit(0);
}

console.log(`🔍 找到 ${files.length} 張待匯入圖檔，開始處理...\n`);

let audit = { metadata: { totalGenerated: 0 }, records: {} };
if (fs.existsSync(AUDIT_FILE)) {
  try { audit = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8')); } catch (e) {}
}

let localWords = [];
if (fs.existsSync(LOCAL_WORDS_FILE)) {
  try { localWords = JSON.parse(fs.readFileSync(LOCAL_WORDS_FILE, 'utf8')); } catch (e) {}
}
const localSet = new Set(localWords);

let successCount = 0;

for (const file of files) {
  const ext = path.extname(file).toLowerCase();
  const rawBaseName = path.basename(file, ext);
  const slug = slugify(rawBaseName);
  const srcPath = path.join(INCOMING_DIR, file);

  try {
    const webpFilename = `${slug}.webp`;
    const origFilename = `${slug}.jpg`;
    const targetWebp = path.join(WORDS_DIR, webpFilename);
    const targetOrig = path.join(ORIGINALS_DIR, origFilename);

    // Call Python helper to convert to 85% WebP and 95% JPG
    const pythonScript = `
from PIL import Image
import sys
src, orig, webp = sys.argv[1], sys.argv[2], sys.argv[3]
img = Image.open(src).convert('RGB')
img.save(orig, 'JPEG', quality=95)
img.save(webp, 'WEBP', quality=85, method=6)
`;
    execSync(`python -c "${pythonScript.replace(/\n/g, ' ')}" "${srcPath}" "${targetOrig}" "${targetWebp}"`, { stdio: 'pipe' });

    const webpSize = fs.statSync(targetWebp).size;
    const origSize = fs.statSync(targetOrig).size;

    audit.records[slug] = {
      headword: slug,
      slug,
      tier: 'advanced-2500',
      webpFilename,
      originalFilename: origFilename,
      webpSizeBytes: webpSize,
      originalSizeBytes: origSize,
      source: 'laptop_gemini_web',
      generatedAt: new Date().toISOString()
    };

    if (!localSet.has(slug)) {
      localWords.push(slug);
      localSet.add(slug);
    }

    const doneDir = path.join(INCOMING_DIR, 'done');
    fs.mkdirSync(doneDir, { recursive: true });
    fs.renameSync(srcPath, path.join(doneDir, file));

    console.log(`  ✅ 成功入庫: ${slug} -> WebP (${Math.round(webpSize / 1024)} KB) + JPG (${Math.round(origSize / 1024)} KB)`);
    successCount++;
  } catch (err) {
    console.error(`  ❌ 匯入失敗 ${file}:`, err.message);
  }
}

audit.metadata.totalGenerated = Object.keys(audit.records).length;
audit.metadata.lastUpdated = new Date().toISOString();
fs.writeFileSync(AUDIT_FILE, JSON.stringify(audit, null, 2), 'utf8');
fs.writeFileSync(LOCAL_WORDS_FILE, JSON.stringify(localWords, null, 2), 'utf8');

console.log('\n================================================================');
console.log(`🎉 匯入完成！共成功入庫 ${successCount} 張圖片，已自動轉為高效 WebP 並同步至字庫！`);
console.log('================================================================');
