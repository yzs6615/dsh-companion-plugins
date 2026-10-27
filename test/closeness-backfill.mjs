#!/usr/bin/env node
/**
 * 熟悉度测试：造一份假的 bridge.log + state.json，启动 bridge，
 * 1) 按历史记录补齐“天数 / 轮数”，且只补一次、只补白名单里的人；
 * 2) CLOSENESS_SET 能把某个人的综合分调到指定值，同一个目标只调一次，换目标会再调。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-closeness-'));
let failed = false;
const check = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed = true;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 三个不同的本地日子（中午时分，避开跨日边界）
const at = (daysAgo, hour = 12) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const line = (t, arrow, who, text) => `[${t}] ${arrow} ${who}: ${text}`;
const lines = [
  `[${at(3)}] 连接 OneBot: ws://x`, // 不是聊天行
  line(at(2), '→', 'Alice(111)', '第一天的话 (456): 里面带着括号和数字'),
  line(at(2), '←', 'Alice(111)', '回一句'),
  line(at(2, 13), '→', 'Alice(111)', '又一句'),
  line(at(2, 13), '←', 'Alice(111)', '回'),
  line(at(1), '→', 'Alice(111)', '第二天'),
  line(at(1), '←', 'Alice(111)', '回'),
  line(at(0), '→', 'Alice(111)', '今天'), // 收到了但没回：不算一轮
  line(at(1), '→', 'Bob (the 2nd)(222)', '昵称里带括号'),
  line(at(1), '←', 'Bob (the 2nd)(222)', '回'),
  line(at(1), '→', 'Eve(999)', '不在白名单里'),
  line(at(1), '←', 'Eve(999)', '回'),
];
fs.writeFileSync(path.join(data, 'bridge.log'), lines.join('\n') + '\n');
// Alice 之前已有一点实时计数：升级后聊过 1 天 2 轮，亲密度 1，lastDay 是今天
fs.writeFileSync(
  path.join(data, 'state.json'),
  JSON.stringify({ 111: { affection: 1, lastUserAt: 0, lastProactiveAt: 0, day: '', count: 0, days: 1, turns: 2, lastDay: localDay(new Date()) } }),
);

async function runBridge(extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'bridge.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      BRIDGE_DATA: data,
      ONEBOT_WS: 'ws://127.0.0.1:3995', // 没人监听：只测启动时的补齐
      ALLOWED_QQ: '111,222',
      ALLOWED_GROUPS: '',
      DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'),
      DSH_HOME: path.join(data, 'dsh-home'),
      AGENT_CWD: ROOT,
      DEEPSEEK_API_KEY: 'test',
      PHONE_MONITOR: 'false',
      PROACTIVE: 'false',
      AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false',
      ...extraEnv,
    },
    stdio: 'ignore',
  });
  await sleep(2500);
  child.kill();
  await sleep(300);
  return JSON.parse(fs.readFileSync(path.join(data, 'state.json'), 'utf8'));
}

try {
  const score = (st) => st.affection + st.days * 2 + st.turns * 0.1 + (st.bonus || 0);
  const s1 = await runBridge({ CLOSENESS_SET: '111:60,999:60,bad' });
  const a = s1[111];
  check(a.days === 3 && a.turns === 3, `Alice 补成 3 天 3 轮（得到 ${a.days} 天 ${a.turns} 轮；收到没回的不算）`);
  check(a.affection === 3, `每多一天亲密度 +1：1 -> 3（得到 ${a.affection}）`);
  check(a.lastDay === localDay(new Date()), 'lastDay 是最近聊过的那天（今天不会被重复算一天）');
  const b = s1[222];
  check(b && b.days === 1 && b.turns === 1, `昵称带括号的 Bob 也能补（得到 ${b?.days} 天 ${b?.turns} 轮）`);
  check(!s1[999], '不在白名单的人不补');
  check(typeof s1._closenessSeeded === 'number', '留了“已补齐”标记');
  check(fs.readFileSync(path.join(data, 'bridge.log'), 'utf8').includes('熟悉度已按历史记录补齐'), '日志里有一行说明');

  check(Math.abs(score(a) - 60) < 0.05, `CLOSENESS_SET 把 Alice 的综合分调到 60（得到 ${score(a).toFixed(2)}，自然分 9.3 + 调整 ${a.bonus}）`);
  check(!b.bonus, '没点名的 Bob 分数不变');
  check(!s1[999], '点名了但不在白名单的人不会被创建/调整');
  const log1 = fs.readFileSync(path.join(data, 'bridge.log'), 'utf8');
  check(/CLOSENESS_SET.*"bad".*格式不对/.test(log1) && /999 不在 ALLOWED_QQ/.test(log1), '写错格式 / 不在白名单都有日志提示');

  // 再来一批聊天记录，第二次启动不应再动（补齐和调分都只做一次）
  fs.appendFileSync(path.join(data, 'bridge.log'), [line(at(0), '→', 'Alice(111)', 'x'), line(at(0), '←', 'Alice(111)', 'y')].join('\n') + '\n');
  const s2 = await runBridge({ CLOSENESS_SET: '111:60' });
  check(s2[111].days === 3 && s2[111].turns === 3 && s2[111].affection === 3, '第二次启动不再补（只补一次）');
  check(s2[111].bonus === a.bonus, '同一个目标不会重复调整');

  // 换一个目标：按当时的自然分重新调
  const s3 = await runBridge({ CLOSENESS_SET: '111:80' });
  check(Math.abs(score(s3[111]) - 80) < 0.05, `改成 80 会重新调（得到 ${score(s3[111]).toFixed(2)}）`);
} catch (err) {
  console.error('测试出错:', err.message);
  failed = true;
} finally {
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  process.exit(failed ? 1 : 0);
}
