import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PORT = 3333;
const WORDS_DIR = path.join(ROOT_DIR, 'public', 'assets', 'images', 'words');
const ORIGINALS_DIR = path.join(ROOT_DIR, 'public', 'assets', 'images', 'originals');
const AUDIT_FILE = path.join(ROOT_DIR, 'scripts', 'image_generation_audit.json');
const LOCAL_WORDS_FILE = path.join(ROOT_DIR, 'src', 'data', 'localImageWords.json');
const HTML_STUDIO_FILE = path.join(ROOT_DIR, 'public', 'image_studio.html');

// Ensure directories exist
fs.mkdirSync(WORDS_DIR, { recursive: true });
fs.mkdirSync(ORIGINALS_DIR, { recursive: true });

function slugify(text) {
  const clean = text.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_');
  return clean || 'word';
}

function getExistingDiskSlugs() {
  if (!fs.existsSync(WORDS_DIR)) return new Set();
  const files = fs.readdirSync(WORDS_DIR);
  const slugs = new Set();
  for (const f of files) {
    if (f.endsWith('.webp') || f.endsWith('.jpg')) {
      const fullPath = path.join(WORDS_DIR, f);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > 5000) {
          const s = f.replace(/\.(webp|jpg)$/, '').toLowerCase();
          slugs.add(s);
        }
      } catch (e) {}
    }
  }
  return slugs;
}

function loadAudit() {
  if (fs.existsSync(AUDIT_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
    } catch (e) {}
  }
  return { metadata: { totalGenerated: 0 }, records: {} };
}

function saveAudit(audit) {
  const tmp = AUDIT_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(audit, null, 2), 'utf8');
  fs.renameSync(tmp, AUDIT_FILE);
}

function syncLocalWord(slug) {
  try {
    if (!fs.existsSync(LOCAL_WORDS_FILE)) return;
    const words = JSON.parse(fs.readFileSync(LOCAL_WORDS_FILE, 'utf8'));
    const set = new Set(words);
    if (!set.has(slug)) {
      words.push(slug);
      const tmp = LOCAL_WORDS_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(words, null, 2), 'utf8');
      fs.renameSync(tmp, LOCAL_WORDS_FILE);
    }
  } catch (e) {
    console.error('Failed to sync localImageWords:', e);
  }
}

// 🌐 Load Gemini API Key for on-the-fly English learning prompt translation
let GEMINI_API_KEY = '';
try {
  const envFile = path.join(ROOT_DIR, '.env.local');
  if (fs.existsSync(envFile)) {
    const envContent = fs.readFileSync(envFile, 'utf8');
    const match = envContent.match(/GEMINI_API_KEYS=([^\r\n]+)/);
    if (match) {
      GEMINI_API_KEY = match[1].split(',')[0].trim();
    } else {
      const m2 = envContent.match(/(?:VITE_)?GEMINI_API_KEY=([^\r\n]+)/);
      if (m2) GEMINI_API_KEY = m2[1].trim();
    }
  }
} catch (e) {}

const TRANS_CACHE_FILE = path.join(ROOT_DIR, 'scripts', '.prompt_translations_cache.json');
function loadTransCache() {
  if (fs.existsSync(TRANS_CACHE_FILE)) {
    try { return JSON.parse(fs.readFileSync(TRANS_CACHE_FILE, 'utf8')); } catch (e) {}
  }
  return {};
}
function saveTransCache(c) {
  try {
    const tmp = TRANS_CACHE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(c, null, 2), 'utf8');
    fs.renameSync(tmp, TRANS_CACHE_FILE);
  } catch (e) {}
}

function getRefinedLemmaSet(tier) {
  const courseFile = path.join(ROOT_DIR, 'public', 'data', 'v1', 'courses', `course-${tier}.json`);
  if (fs.existsSync(courseFile)) {
    try {
      const courseData = JSON.parse(fs.readFileSync(courseFile, 'utf8'));
      return new Set((courseData.words || []).map(w => w.headword.toLowerCase()));
    } catch (e) {}
  }
  return null;
}

const TIERS = [
  { id: 'advanced-2500', name: '第二階段：商務進階 (精煉 2,053 詞)' },
  { id: 'core-1200', name: '第一階段：核心高頻 (1,200 詞)' },
  { id: 'expert-high-part1', name: '第三階段：滿分巔峰 Part 1 (精煉 2,284 詞)' },
  { id: 'expert-high-part2', name: '第三階段：滿分巔峰 Part 2 (精煉 2,411 詞)' },
  { id: 'expert-high-part3', name: '第三階段：滿分巔峰 Part 3 (精煉 2,409 詞)' }
];

function getStats() {
  const diskSlugs = getExistingDiskSlugs();
  const audit = loadAudit();
  const records = audit.records || {};

  const tierStats = {};
  let totalAll = 0;
  let totalCompleted = 0;

  for (const t of TIERS) {
    const filePath = path.join(ROOT_DIR, 'public', 'data', 'v1', `${t.id}.json`);
    if (!fs.existsSync(filePath)) continue;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const allWords = data.words || [];

    // Filter to refined lemma list (eliminating redundant inflections like jobs, includes)
    const refinedSet = getRefinedLemmaSet(t.id);
    const words = refinedSet ? allWords.filter(w => refinedSet.has(w.headword.toLowerCase())) : allWords;

    let completed = 0;
    for (const w of words) {
      const slug = slugify(w.headword);
      if (diskSlugs.has(slug)) {
        completed++;
      }
    }
    tierStats[t.id] = {
      name: t.name,
      total: words.length,
      completed,
      pending: words.length - completed
    };
    totalAll += words.length;
    totalCompleted += completed;
  }

  return {
    totalAll,
    totalCompleted,
    totalPending: totalAll - totalCompleted,
    totalOnDisk: diskSlugs.size,
    totalAudit: Object.keys(records).length,
    tiers: tierStats
  };
}

// SSE Real-time Broadcaster
const sseClients = new Set();

function broadcastEvent(eventType, data) {
  const msg = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// 🛡️ Watch WORDS_DIR for external additions (Antigravity background or GCP pipeline writing files)
let watchDebounce = null;
try {
  fs.watch(WORDS_DIR, (eventType, filename) => {
    if (!filename || !filename.endsWith('.webp')) return;
    clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => {
      const slug = filename.replace('.webp', '');
      broadcastEvent('image_added', {
        slug,
        webpFilename: filename,
        source: 'background_watcher',
        timestamp: new Date().toISOString()
      });
    }, 100);
  });
} catch(e) {
  console.warn('Directory watch error:', e);
}

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;

  try {
    // 0. SSE Endpoint (Zero-latency push)
    if (pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      res.write(': connected\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // 1. Static HTML Studio
    if (pathname === '/' || pathname === '/index.html' || pathname === '/image_studio.html') {
      if (fs.existsSync(HTML_STUDIO_FILE)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(HTML_STUDIO_FILE).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('image_studio.html not found');
      }
      return;
    }

    // 2. Static Images
    if (pathname.startsWith('/assets/images/')) {
      const relPath = pathname.replace('/assets/images/', '');
      const filePath = path.join(ROOT_DIR, 'public', 'assets', 'images', relPath);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          '.webp': 'image/webp',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png'
        };
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Image not found');
      }
      return;
    }

    // 3. API: Status
    if (pathname === '/api/status') {
      const stats = getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
      return;
    }

    // 4. API: Pending Words
    if (pathname === '/api/pending') {
      const tier = urlObj.searchParams.get('tier') || 'advanced-2500';
      const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
      const filePath = path.join(ROOT_DIR, 'public', 'data', 'v1', `${tier}.json`);

      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Tier ${tier} not found` }));
        return;
      }

      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const allWords = data.words || [];
      const diskSlugs = getExistingDiskSlugs();

      // 🌟 Filter to Refined Lemma Set while drawing the NEWEST Concept Art Prompts from master file!
      const refinedSet = getRefinedLemmaSet(tier);
      const words = refinedSet ? allWords.filter(w => refinedSet.has(w.headword.toLowerCase())) : allWords;

      const pending = [];
      for (const w of words) {
        const slug = slugify(w.headword);
        if (!diskSlugs.has(slug)) {
          const va = w.visualAnchor || {};
          const ex1 = (w.examples && w.examples[0]) || {};
          const ex2 = (w.examples && w.examples[1]) || (w.examples && w.examples[2]) || null;
          const concreteEn = va.shortEn || ex1.en || '';
          const concreteZh = va.scene || ex1.zh || '';

          pending.push({
            id: w.id,
            headword: w.headword,
            slug,
            partsOfSpeech: w.partsOfSpeech || [],
            definitionZh: w.definitionZh || '',
            scene: concreteZh || w.definitionZh || '',
            concreteEn,
            concreteZh,
            businessEn: ex2 ? ex2.en : '',
            businessZh: ex2 ? ex2.zh : '',
            businessScenario: ex2 ? (ex2.scenario || '多益商務情境') : '',
            imagePrompt: va.imagePrompt || '', // 100% Latest Stylized Concept Art Prompt!
            tier
          });
          if (pending.length >= limit) break;
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        tier,
        totalInTier: words.length,
        pendingTotal: words.filter(w => !diskSlugs.has(slugify(w.headword))).length,
        items: pending
      }));
      return;
    }

    // 5. API: Save Image
    if (pathname === '/api/save-image' && req.method === 'POST') {
      let bodyStr = '';
      req.on('data', chunk => { bodyStr += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(bodyStr);
          const { headword, slug, webpBase64, originalBase64, prompt, tier, source } = payload;

          if (!slug || !webpBase64) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing slug or webpBase64' }));
            return;
          }

          const cleanSlug = slugify(slug);
          const webpData = webpBase64.replace(/^data:image\/\w+;base64,/, '');
          const webpBuffer = Buffer.from(webpData, 'base64');

          // Save WebP
          const webpFilename = `${cleanSlug}.webp`;
          const webpPath = path.join(WORDS_DIR, webpFilename);
          const tmpWebpPath = webpPath + '.tmp';
          fs.writeFileSync(tmpWebpPath, webpBuffer);
          fs.renameSync(tmpWebpPath, webpPath);

          // Save Original Master JPG
          const origFilename = `${cleanSlug}.jpg`;
          let origSize = 0;
          if (originalBase64) {
            try {
              const origData = originalBase64.replace(/^data:image\/\w+;base64,/, '');
              const origBuffer = Buffer.from(origData, 'base64');
              const origPath = path.join(ORIGINALS_DIR, origFilename);
              const tmpOrigPath = origPath + '.tmp';
              fs.writeFileSync(tmpOrigPath, origBuffer);
              fs.renameSync(tmpOrigPath, origPath);
              origSize = origBuffer.length;
            } catch (e) {
              console.warn('Could not save original image:', e);
            }
          }

          // Update Audit (recording both original and webp)
          const audit = loadAudit();
          audit.records[cleanSlug] = {
            headword: headword || cleanSlug,
            slug: cleanSlug,
            tier: tier || 'advanced-2500',
            webpFilename,
            originalFilename: origFilename,
            webpSizeBytes: webpBuffer.length,
            originalSizeBytes: origSize,
            imagePrompt: prompt || '',
            source: source || 'web_companion',
            generatedAt: new Date().toISOString()
          };
          audit.metadata.totalGenerated = Object.keys(audit.records).length;
          audit.metadata.lastUpdated = new Date().toISOString();
          saveAudit(audit);

          // Update Local Image Words
          syncLocalWord(cleanSlug);

          // 🔗 Auto-link inflection variants (e.g. if 'job' is saved, auto-link 'jobs.webp' so no duplicate generation is needed)
          try {
            const masterFilePath = path.join(ROOT_DIR, 'public', 'data', 'v1', `${tier || 'advanced-2500'}.json`);
            if (fs.existsSync(masterFilePath)) {
              const masterData = JSON.parse(fs.readFileSync(masterFilePath, 'utf8'));
              for (const mw of masterData.words || []) {
                const mhw = mw.headword.toLowerCase();
                if (mhw !== cleanSlug && (mhw === cleanSlug + 's' || mhw === cleanSlug + 'es')) {
                  const infSlug = slugify(mhw);
                  const infWebp = path.join(WORDS_DIR, `${infSlug}.webp`);
                  if (!fs.existsSync(infWebp)) {
                    fs.copyFileSync(webpPath, infWebp);
                    syncLocalWord(infSlug);
                    console.log(`[Studio Server] Auto-linked inflection '${infSlug}.webp' -> '${cleanSlug}.webp'`);
                  }
                }
              }
            }
          } catch (e) {
            console.warn('Inflection auto-link warning:', e);
          }

          console.log(`[Studio Server] Dual-saved '${cleanSlug}': WebP (${Math.round(webpBuffer.length / 1024)} KB) + JPG (${Math.round(origSize / 1024)} KB)`);

          broadcastEvent('image_added', {
            headword: headword || cleanSlug,
            slug: cleanSlug,
            source: source || 'web_companion',
            webpFilename,
            timestamp: new Date().toISOString()
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            slug: cleanSlug,
            webpFilename,
            origFilename,
            webpSizeBytes: webpBuffer.length,
            origSizeBytes: origSize
          }));
        } catch (e) {
          console.error('Error saving image:', e);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // 6. API: Recent Feed
    if (pathname === '/api/recent') {
      const audit = loadAudit();
      const records = Object.values(audit.records || {});
      // Sort newest first
      records.sort((a, b) => new Date(b.generatedAt || 0) - new Date(a.generatedAt || 0));
      const recent = records.slice(0, 40).map(r => ({
        headword: r.headword || r.slug,
        slug: r.slug,
        tier: r.tier || 'core-1200',
        imageUrl: `/assets/images/words/${r.webpFilename}`,
        sizeKb: Math.round((r.webpSizeBytes || 0) / 1024),
        source: r.source || 'batch_pipeline',
        prompt: r.imagePrompt || '',
        generatedAt: r.generatedAt
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ recent }));
      return;
    }

    // 7. API: Local Instant Translation & Vocabulary Breakdown (0 API Key 消耗，純本機秒開)
    if (pathname === '/api/translate-prompt' && req.method === 'POST') {
      let bodyStr = '';
      req.on('data', chunk => { bodyStr += chunk; });
      req.on('end', () => {
        try {
          const { prompt, headword, slug } = JSON.parse(bodyStr);

          // Extract sign text
          const signMatch = (prompt || '').match(/clearly displays ['"]([^'"]+)['"]/i);
          const signText = signMatch ? signMatch[1] : '';

          let signZh = '';
          if (signText) {
            if (prompt.toLowerCase().includes('neon')) signZh = `發光霓虹招牌清晰顯示「${signText}」`;
            else if (prompt.toLowerCase().includes('plaque') || prompt.toLowerCase().includes('storefront')) signZh = `精緻店面門牌清晰顯示「${signText}」`;
            else signZh = `發光文字看板清晰顯示「${signText}」`;
          }

          const localTranslation = {
            translationZh: `一幅關於「${headword}」的高細節數位概念藝術插畫（Concept Art）。\n` +
              (signZh ? `【招牌文字】在醒目處，${signZh}。\n` : '') +
              `【光影與美學】陽光穿透落地窗灑落、溫潤的環境氛圍光影（Ambient lighting）、優雅色彩調和；俐落乾淨的輪廓線條（Crisp linework）、充滿活力的日間採光、帶有平滑反光的賽璐璐上色（Cel-shading）、豐富的建築透視空間感，1:1 正方形構圖。`,
            keywords: [
              { en: "Concept art", zh: "概念插畫" },
              { en: "Crisp linework", zh: "俐落線條" },
              { en: "Cel-shading", zh: "賽璐璐著色" },
              { en: "Ambient lighting", zh: "氛圍光影" },
              { en: "Architectural perspective", zh: "建築透視" }
            ]
          };

          if (signText) {
            localTranslation.keywords.unshift({ en: signText, zh: "招牌文字錨點" });
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(localTranslation));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ translationZh: "提示詞本地解析", keywords: [] }));
        }
      });
      return;
    }

    // 404
    res.writeHead(404);
    res.end('Not Found');
  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`=============================================================`);
  console.log(`🎨 TOEIC Image Studio Companion Server is RUNNING!`);
  console.log(`🌐 Open in browser: http://localhost:${PORT}`);
  console.log(`📁 Target directory: ${WORDS_DIR}`);
  console.log(`=============================================================`);
});
