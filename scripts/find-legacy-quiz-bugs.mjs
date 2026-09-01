import fs from 'node:fs';
import path from 'node:path';

function searchDir(dir, pattern, label) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (f !== 'node_modules' && f !== '.git' && f !== 'dist') {
        searchDir(full, pattern, label);
      }
    } else if (f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.mjs') || f.endsWith('.json')) {
      const content = fs.readFileSync(full, 'utf8');
      if (content.includes(pattern)) {
        console.log(`[${label}] Found in: ${full}`);
      }
    }
  }
}

searchDir('.', 'closest in meaning', 'closest in meaning');
searchDir('.', 'agreed to _____', 'agreed to _____');
searchDir('.', 'handle properly', 'handle properly');
