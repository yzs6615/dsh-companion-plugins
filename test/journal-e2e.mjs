#!/usr/bin/env node
/**
 * 日记测试：mock OneBot <-> bridge.mjs <-> fake dsh，临时数据目录，不花钱。
 * 覆盖：白天记流水 → 到点写日记（day + 每个人一行）→ 聊天时带上最近的日记，
 * 只带跟这个人的那行（不串到别人那）、编号对不上 / 带“AI”的行丢掉、更早的日记只带跟这个人有关的、
 * /日记、昨天没写的第二天补写、以前的流水一直留着。
 */
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const A = 10001;
const B = 20002;
const BOT = 99999;
let failed = false;
const check = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed = true;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = (fn, timeout = 15_000) =>
  new Promise((resolve, reject) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (fn()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - t0 > timeout) {
        clearInterval(timer);
        reject(new Error('timeout'));
      }
    }, 50);
  });
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ago = (n) => dayKey(new Date(Date.now() - n * 86400_000));

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-journal-'));
fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ _closenessSeeded: 1 }));
const jdir = path.join(data, 'journal');
fs.mkdirSync(path.join(jdir, 'raw'), { recursive: true });
// 很早以前的日记：一篇跟 A 有关，一篇只跟 B 有关
fs.writeFileSync(path.join(jdir, `${ago(20)}.json`), JSON.stringify({ day: 'OLD_DAY', with: { [`u${A}`]: 'OLD_WITH_A 约好了下次一起看电影' } }));
fs.writeFileSync(path.join(jdir, `${ago(19)}.json`), JSON.stringify({ day: 'OLD_DAY2', with: { [`u${B}`]: 'OLD_WITH_B' } }));
// 昨天有流水但没写日记：要补写；4 天前的流水要留着
fs.writeFileSync(path.join(jdir, 'raw', `${ago(1)}.jsonl`), JSON.stringify({ k: `u${A}`, who: 'A', t: 1, u: '昨天的话', a: '嗯' }) + '\n');
fs.writeFileSync(path.join(jdir, 'raw', `${ago(4)}.jsonl`), '{}\n');

const sent = { [A]: [], [B]: [] };
let socket;
let id = 100;
const wss = new WebSocketServer({ port: 3996 });
wss.on('connection', (ws) => {
  socket = ws;
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.action === 'send_private_msg') sent[msg.params.user_id]?.push(msg.params.message.filter((x) => x.type === 'text').map((x) => x.data.text).join(''));
    ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 1 }, echo: msg.echo }));
  });
  ws.send(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'lifecycle', self_id: BOT, time: Date.now() / 1000 }));
});
const say = (uid, text) =>
  socket.send(JSON.stringify({ post_type: 'message', message_type: 'private', self_id: BOT, user_id: uid, message_id: ++id, time: Math.floor(Date.now() / 1000), message: [{ type: 'text', data: { text } }], sender: { user_id: uid, nickname: uid === A ? '阿A' : '阿B' } }));
const lastOf = (uid) => sent[uid].at(-1) || '';

const bridge = spawn(process.execPath, [path.join(ROOT, 'bridge.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env, ONEBOT_WS: 'ws://127.0.0.1:3996', ALLOWED_QQ: `${A},${B}`, ALLOWED_GROUPS: '',
    DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'), DSH_HOME: path.join(data, 'dsh-home'), BRIDGE_DATA: data, AGENT_CWD: ROOT,
    DEEPSEEK_API_KEY: 'test', PHONE_MONITOR: 'false', AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false', PROACTIVE: 'false', FACTS: 'false', REFLECT: 'false',
    MERGE_MS: '200', TYPING_MS_PER_CHAR: '0', TYPO_PROB: '0', SLEEP_DELAY_PROB: '0', REACT: 'false', CLOSENESS_SET: '',
    JOURNAL: 'true', JOURNAL_HOUR: '99', JOURNAL_CHECK_MS: '1500', JOURNAL_DAYS: '7',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

try {
  await waitFor(() => socket && socket.readyState === 1);
  await sleep(300);

  // 1. 昨天的日记补写了；4 天前的流水删了
  await waitFor(() => fs.existsSync(path.join(jdir, `${ago(1)}.json`)), 10_000);
  const y = JSON.parse(fs.readFileSync(path.join(jdir, `${ago(1)}.json`), 'utf8'));
  check(y.day.includes('DIARY_DAY') && y.with[`u${A}`] === `DIARY_WITH_u${A}`, '昨天有流水没写日记：第二天补写了');
  check(!('u999' in y.with) && !('bad' in y.with), '编号对不上的、带“AI”字样的行丢掉了');
  check(fs.existsSync(path.join(jdir, 'raw', `${ago(4)}.jsonl`)), '以前的流水一直留着（日记网页能翻）');

  // 2. 今天 A、B 各聊一句 → 记流水
  say(A, 'A 的第一句');
  await waitFor(() => lastOf(A).includes('A 的第一句'));
  say(B, 'B 的第一句');
  await waitFor(() => lastOf(B).includes('B 的第一句'));
  const rawToday = fs.readFileSync(path.join(jdir, 'raw', `${dayKey()}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  check(rawToday.length === 2 && rawToday[0].k === `u${A}` && rawToday[1].k === `u${B}`, '白天每轮聊天记了一行流水（按人分开）');

  // 3. A 聊天时：带昨天的日记和跟 A 的那行；更早的只带跟 A 有关的
  check(lastOf(A).includes('[有日记]') && lastOf(A).includes(`[日记:u${A}]`), '跟 A 聊时带上了日记和“跟你”那行');
  check(!lastOf(A).includes(`[日记:u${B}]`), '跟 A 聊时没有 B 的那行');
  check(lastOf(A).includes('[旧日记A]') && !lastOf(A).includes('[旧日记B]'), '更早的日记只带跟 A 有关的那篇');

  // 4. 手动把今天的日记写了（JOURNAL_HOUR=99 不会自动写今天）：B 那边只看到 B 的
  fs.writeFileSync(path.join(jdir, `${dayKey()}.json`), JSON.stringify({ day: 'DIARY_DAY 今天', with: { [`u${A}`]: `DIARY_WITH_u${A}`, [`u${B}`]: `DIARY_WITH_u${B}` } }));
  say(B, 'B 的第二句');
  await waitFor(() => lastOf(B).includes('B 的第二句'));
  check(lastOf(B).includes(`[日记:u${B}]`) && !lastOf(B).includes(`[日记:u${A}]`), '跟 B 聊时只带 B 的那行，A 的不串过来');

  // 5. /日记
  say(A, '/日记');
  await waitFor(() => lastOf(A).includes('DIARY_DAY'));
  check(lastOf(A).includes('跟你：DIARY_WITH_u10001') && !lastOf(A).includes('u20002'), '/日记 看最新一篇（只带跟自己的那行）');
} catch (err) {
  check(false, `出错：${err.message}`);
} finally {
  bridge.kill();
  wss.close();
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  setTimeout(() => process.exit(failed ? 1 : 0), 200);
}
