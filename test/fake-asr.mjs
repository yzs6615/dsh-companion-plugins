#!/usr/bin/env node
/**
 * 假的本地语音识别，代替本体的 kernel/media/asr.py（测试用 ASR_SCRIPT 指过来）：node fake-asr.mjs <文件> --model base
 * 文件里有 “SAY:…” 就当听出了 … 那句话，没有就当没听出字。最后一行打 JSON，跟真脚本一样。
 */
import fs from 'node:fs';

// 第一个不是选项的参数是文件（也认老的写法 asr <文件>）
const args = process.argv.slice(2);
const file = args.find((a, i) => a !== 'asr' && !a.startsWith('--') && args[i - 1] !== '--model') || '';
let said = '';
try {
  said = (fs.readFileSync(file, 'utf8').match(/SAY:([^\n]*)/) || [])[1] || '';
} catch {
  /* 文件都没有：当没听出来 */
}
process.stdout.write(`[fake-asr] ${file}\n`);
process.stdout.write(JSON.stringify({ text: said.trim(), language: 'zh', duration: 2 }) + '\n');
