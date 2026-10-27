#!/usr/bin/env node
/**
 * 第四批测试：mock OneBot <-> bridge.mjs <-> fake dsh，临时数据目录，不花钱。
 * 第一段（不开自己找事做）：心情有来由（被夸 → 开心，标记不发出去、在线状态跟着变、别人只知道开心不知道为啥）、
 *   记得作息（今天比平时晚睡，一天只提一次）、对你好奇（一天最多提醒一次）。
 * 第二段（开自己找事做）：看到就想到你（记得对方喜欢猫 → 分享）、被打断时说自己在干嘛、自己找事做后心情变了、主动戳一下（一天一次）。
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

// ── 数据：A 的作息（过去 5 天每天在现在往前 4、3、2 小时各说一句，“最后一条”在往前 2 小时那个点）、记得 A 喜欢猫、在读大学 ──
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-life4-'));
fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ _closenessSeeded: 1 }));
const now = Date.now();
const logLines = [];
for (let k = 1; k <= 5; k++) {
  for (const back of [4, 3, 2]) logLines.push(`[${new Date(now - k * 86400_000 - back * 3600_000).toISOString()}] → 阿A(${A}): 以前的话`);
}
fs.writeFileSync(path.join(data, 'bridge.log'), logLines.join('\n') + '\n');
fs.mkdirSync(path.join(data, 'memory'), { recursive: true });
fs.writeFileSync(path.join(data, 'memory', `u${A}.facts.json`), JSON.stringify({ facts: [{ t: '喜欢猫 LIKES_CATS' }, { t: '在读大学' }], followups: [], style: [] }));
const hourNow = new Date().getHours();
const rhythmTestable = hourNow >= 9 || hourNow < 5; // 往前推 4 小时不能跨过“早上 5 点算新一天”的线

// ── 假 QQ ──
const sent = { [A]: [], [B]: [] };
const calls = [];
let socket;
let mid = 800;
const wss = new WebSocketServer({ port: 3987 });
wss.on('connection', (ws) => {
  socket = ws;
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    calls.push(msg);
    if (msg.action === 'send_private_msg') sent[msg.params.user_id]?.push(msg.params.message.filter((x) => x.type === 'text').map((x) => x.data.text).join(''));
    ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 6000 + calls.length }, echo: msg.echo }));
  });
  ws.send(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'lifecycle', self_id: BOT, time: Date.now() / 1000 }));
});
const say = (uid, text) => socket.send(JSON.stringify({ post_type: 'message', message_type: 'private', self_id: BOT, user_id: uid, message_id: ++mid, time: Math.floor(Date.now() / 1000), message: [{ type: 'text', data: { text } }], sender: { user_id: uid, nickname: uid === A ? '阿A' : '阿B' } }));
const marks = { [A]: 0, [B]: 0 };
const next = (uid) => (marks[uid] = sent[uid].length);
const got = (uid) => sent[uid].slice(marks[uid]).join('\n');

const base = {
  ...process.env, ONEBOT_WS: 'ws://127.0.0.1:3987', ALLOWED_QQ: `${A},${B}`, ALLOWED_GROUPS: '', PROACTIVE_QQ: String(A),
  DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'), DSH_HOME: path.join(data, 'dsh-home'), BRIDGE_DATA: data, AGENT_CWD: ROOT,
  DEEPSEEK_API_KEY: 'test', PHONE_MONITOR: 'false', PROACTIVE: 'false', REFLECT: 'false', JOURNAL: 'false', MIMIC: 'false', WEATHER: 'false', CHASE: 'false',
  FACTS: 'true', FACTS_EVERY: '999', MERGE_MS: '200', TYPING_MS_PER_CHAR: '0', TYPO_PROB: '0', SLEEP_DELAY_PROB: '0', REACT: 'false', CLOSENESS_SET: '',
  SLEEP_START: '0', SLEEP_END: '0', EMOTION: 'true', RHYTHM: 'true', CURIOUS: 'true', CURIOUS_PROB: '1', ONLINE_STATUS: 'true',
  // 跟这里测的无关、本机 .env 里又开着的：两段都关掉（ChronoLife 开着会接管自己找事做和戳人）
  PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false',
};
const start = (extra) => spawn(process.execPath, [path.join(ROOT, 'bridge.mjs')], { cwd: ROOT, env: { ...base, ...extra }, stdio: ['ignore', 'ignore', 'inherit'] });

let bridge;
try {
  // ── 第一段 ──
  bridge = start({ AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false', POKE_SELF: 'false' });
  await waitFor(() => socket && socket.readyState === 1);
  await sleep(500);

  next(A);
  say(A, 'HI 在吗');
  await waitFor(() => got(A).includes('HI'));
  check(got(A).includes('[好奇]'), '对你好奇：提醒她找机会问一句还不了解的');
  if (rhythmTestable) check(got(A).includes('[作息]'), '记得作息：今天比平时晚睡，她注意到了');
  else console.log('SKIP  记得作息（现在 5~7 点，这个测法会跨天）');
  next(A);
  say(A, 'HI2 还在');
  await waitFor(() => got(A).includes('HI2'));
  check(!got(A).includes('[好奇]') && !got(A).includes('[作息]'), '好奇和作息一天只提一次');

  next(A);
  say(A, 'PRAISE 你真厉害');
  await waitFor(() => got(A).includes('那当然'));
  check(!got(A).includes('[心情'), '心情标记不会发出去');
  await waitFor(() => calls.some((c) => c.action === 'set_online_status' && c.params.ext_status === 1058), 5000).catch(() => {});
  check(calls.some((c) => c.action === 'set_online_status' && c.params.ext_status === 1058), '被夸开心了：在线状态变成“元气满满”');
  next(A);
  say(A, 'AFTER 刚才说到哪了');
  await waitFor(() => got(A).includes('AFTER'));
  check(got(A).includes('[知道为啥开心]'), '心情会延续：接下来聊天还开心，也记得是因为被夸了');
  next(B);
  say(B, 'BHI 在吗');
  await waitFor(() => got(B).includes('BHI'));
  check(got(B).includes('[只知道开心]') && !got(B).includes('[知道为啥开心]'), '跟别人聊：只看得出开心，不说是因为谁');
  const st1 = JSON.parse(fs.readFileSync(path.join(data, 'state.json'), 'utf8'));
  check(st1._emotion?.mood === '开心' && st1._emotion.until - st1._emotion.from === 3 * 3600_000, '开心会持续 3 小时');
  bridge.kill();
  await sleep(800);

  // ── 第二段：自己找事做 + 戳 ──
  socket = null;
  bridge = start({
    AUTONOMY: 'true', AUTONOMY_HOURS: '0-24', AUTONOMY_ROLL_WINDOW_MIN: '0', AUTONOMY_ROLL_PROB: '1', AUTONOMY_MINUTES: '0', AUTONOMY_IDLE_MIN: '0',
    AUTONOMY_MAX: '1', AUTONOMY_CHECK_MS: '400', FAKE_AUTONOMY_DELAY: '5000',
    POKE_SELF: 'true', POKE_SELF_PROB: '1', POKE_SELF_IDLE_MIN: '0', POKE_SELF_CHECK_MS: '400',
  });
  await waitFor(() => socket && socket.readyState === 1);
  await sleep(1500); // 自己找事做开始了（假模型会磨 5 秒）
  next(A);
  say(A, 'INTERRUPT 在干嘛');
  await waitFor(() => got(A).includes('INTERRUPT'));
  check(got(A).includes('[正在忙]'), '被打断：她知道自己正在干嘛，可以说“等下 在…呢”');
  await waitFor(() => sent[A].some((t) => t.includes('FORYOU')), 15_000).catch(() => {});
  check(sent[A].some((t) => t.includes('FORYOU 看到这个猫视频就想到你') && !t.includes('[心情')), '看到就想到你：记得对方喜欢猫，刷到就分享了');
  await sleep(500);
  const st2 = JSON.parse(fs.readFileSync(path.join(data, 'state.json'), 'utf8'));
  check(st2._emotion?.reason === '刷到可爱的猫', '自己找事做完心情也会变（刷到可爱的猫 → 开心）');
  check((st2._self?.log || []).some((e) => e.text.includes('刷到一个猫视频')), '日记照记');
  const pokes = calls.filter((c) => c.action === 'send_poke');
  check(pokes.length === 1 && pokes[0].params.user_id === String(A), '主动戳了对方一下（一天就一次）');
  check((st2._self?.log || []).some((e) => /戳/.test(e.text)), '戳完记进日记（被问“你戳我干嘛”对得上）');
} catch (err) {
  check(false, `出错：${err.message}`);
} finally {
  bridge?.kill();
  wss.close();
  if (failed) {
    // 失败时把 bridge 日志最后几行打出来，好查卡在哪
    try {
      console.log(fs.readFileSync(path.join(data, 'bridge.log'), 'utf8').split('\n').filter((l) => !l.includes('以前的话')).slice(-25).join('\n'));
    } catch {}
    console.log('A 收到：', JSON.stringify(sent[A]).slice(0, 400));
  }
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  setTimeout(() => process.exit(failed ? 1 : 0), 200);
}
