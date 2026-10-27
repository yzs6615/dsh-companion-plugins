#!/usr/bin/env node
/**
 * 表情包太少时提醒：连着 8 句闲聊回复一张表情包都没发，下一轮提示词末尾提醒一句；发了一张之后就不再提醒。
 * mock OneBot <-> bridge.mjs <-> fake dsh，临时数据目录，不花钱。
 */
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3978;
const OWNER = 10001;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-sticker-'));
// 一张表情包，[表情:开心] 能发出去
fs.mkdirSync(path.join(DATA, 'stickers', '开心'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'stickers', '开心', 'a.png'), Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex'));

const sent = [];
let socket;
let id = 1;
const wss = new WebSocketServer({ port: PORT });
wss.on('connection', (ws) => {
  socket = ws;
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (/send_(private|group)_msg/.test(m.action)) sent.push(m.params.message);
    ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 1000 + sent.length }, echo: m.echo }));
  });
  ws.send(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'lifecycle', self_id: 99999, time: Date.now() / 1000 }));
});
const say = (text) =>
  socket.send(JSON.stringify({ post_type: 'message', message_type: 'private', sub_type: 'friend', self_id: 99999, user_id: OWNER, message_id: ++id, time: Math.floor(Date.now() / 1000), message: [{ type: 'text', data: { text } }], sender: { user_id: OWNER, nickname: 'owner' } }));
const texts = () => sent.map((m) => m.filter((s) => s.type === 'text').map((s) => s.data.text).join(''));
const images = () => sent.filter((m) => m.some((s) => s.type === 'image')).length;
const waitFor = (fn, ms = 20_000) =>
  new Promise((resolve, reject) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (fn()) (clearInterval(timer), resolve());
      else if (Date.now() - t0 > ms) (clearInterval(timer), reject(new Error('timeout')));
    }, 50);
  });

const off = 'PROACTIVE AUTONOMY PC_BUDDY DREAM PHOTO LETTER CHRONOLIFE SPEAKER NOTES DRAWER PLAY_MUSIC POSTCARD QZONE DIY_STATUS SLEEP_DRIFT FACTS REFLECT JOURNAL WEATHER ONLINE_STATUS MOOD_AVATAR LONGNICK VOICE RADIO RHYTHM MIMIC REACT CHASE POKE_SELF CURIOUS EMOTION'.split(' ');
const bridge = spawn(process.execPath, [path.join(ROOT, 'bridge.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env,
    ...Object.fromEntries(off.map((k) => [k, 'false'])),
    ONEBOT_WS: `ws://127.0.0.1:${PORT}`,
    ALLOWED_QQ: String(OWNER),
    ALLOWED_GROUPS: '',
    DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'),
    DSH_HOME: path.join(DATA, 'dsh-home'),
    BRIDGE_DATA: DATA,
    STICKER_DIR: path.join(DATA, 'stickers'),
    AGENT_CWD: ROOT,
    DEEPSEEK_API_KEY: 'test',
    PHONE_MONITOR: 'false',
    MERGE_MS: '0',
    TYPING_MS_PER_CHAR: '0',
    TYPO_PROB: '0',
    SLEEP_DELAY_PROB: '0',
    CLOSENESS_SET: '',
  },
  stdio: 'ignore',
});

let failed = false;
const check = (ok, name) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed = true;
};
try {
  await waitFor(() => socket);
  await new Promise((r) => setTimeout(r, 500));
  // 8 句普通闲聊（假模型只回“收到”，不带表情）
  for (let i = 1; i <= 8; i++) {
    say(`闲聊${i}`);
    await waitFor(() => texts().some((t) => t.includes(`闲聊${i}`)));
  }
  check(!texts().some((t) => t.includes('[该发表情]')), '前 8 句都没提醒');
  say('第九句');
  await waitFor(() => texts().some((t) => t.includes('第九句')));
  check(texts().find((t) => t.includes('第九句')).includes('[该发表情]'), '连着 8 句没发表情包：第 9 句的提示词里提醒了');
  // 发一张（假模型看到 STICKERS 会写 [表情:开心]）
  const before = images();
  say('STICKERS 来一张');
  await waitFor(() => images() > before);
  say('发完之后');
  await waitFor(() => texts().some((t) => t.includes('发完之后')));
  check(!texts().find((t) => t.includes('发完之后')).includes('[该发表情]'), '发过一张之后就不再提醒');
} catch (err) {
  check(false, `出错：${err.message}`);
} finally {
  bridge.kill();
  wss.close();
  try {
    fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    /* Windows 上子进程没完全退出时删不掉，留着也没关系 */
  }
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
}
