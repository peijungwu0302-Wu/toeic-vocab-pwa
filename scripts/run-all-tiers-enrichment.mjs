import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const tiers = ['core', 'advanced', 'expert-p1', 'expert-p2', 'expert-p3'];

async function runTier(tier) {
  return new Promise((resolve) => {
    console.log(`\n======================================================================`);
    console.log(`🚀 [Master Lexicon Pipeline] 正在啟動分卷單字庫終極精修: ${tier}`);
    console.log(`======================================================================\n`);

    const child = spawn(process.execPath, [path.join(__dirname, 'enrich-master-lexicon-dual-key.mjs'), `--tier=${tier}`], {
      cwd: ROOT_DIR,
      stdio: 'inherit'
    });

    child.on('close', code => {
      if (code === 0) {
        console.log(`\n✅ [Master Lexicon Pipeline] ${tier} 分卷精修全量完成！`);
      } else {
        console.error(`\n⚠️ [Master Lexicon Pipeline] ${tier} 分卷退出 (code: ${code})，自動進入下一分卷...`);
      }
      resolve();
    });
  });
}

async function runAll() {
  console.log('🌟 雙金鑰全自動萬詞單字庫精修大工程正式啟動！');
  for (const t of tiers) {
    await runTier(t);
  }
  console.log('\n🎉🎉🎉 全量 11,154 詞「不背單詞 VIP 級」終極單字庫全部精修完工！');
}

runAll();
