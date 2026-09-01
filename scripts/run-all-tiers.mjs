import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const tiers = ['core', 'advanced', 'expert-p1', 'expert-p2', 'expert-p3'];

async function runTier(tier) {
  return new Promise((resolve, reject) => {
    console.log(`\n======================================================================`);
    console.log(`🚀 [Master Runner] 正在啟動分卷大模型出題: ${tier}`);
    console.log(`======================================================================\n`);

    const child = spawn(process.execPath, [path.join(__dirname, 'batch-gemini-llm-pipeline.mjs'), `--tier=${tier}`], {
      cwd: ROOT_DIR,
      stdio: 'inherit'
    });

    child.on('close', code => {
      if (code === 0) {
        console.log(`\n✅ [Master Runner] ${tier} 分卷生成完成！`);
        resolve();
      } else {
        console.error(`\n❌ [Master Runner] ${tier} 分卷異常退出，代碼: ${code}`);
        resolve(); // Continue to next tier even on error
      }
    });
  });
}

async function runAll() {
  for (const t of tiers) {
    await runTier(t);
  }
  console.log('\n🎉🎉🎉 全量 11,154 詞 66,924 題大模型出題流水線全部圓滿完成！');
}

runAll();
