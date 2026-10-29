#!/usr/bin/env node
/**
 * 断电不丢数据、群聊记忆文件名：mock OneBot <-> bridge.mjs <-> fake dsh，临时数据目录，不花钱、不联网。
 * 覆盖：state.json 写坏了（像写到一半断电）→ 原样留一份 .broken-*、照常起来照常回，写回去的是完整的 JSON、没剩 .tmp；
 * 群聊记忆的文件名里没有冒号（Windows 会当成隐藏的数据流），记得进去、读得出来。
 */
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OWNER = 10001;
const GROUP = 777;
const BOT = 99999;

let failed = false;
let passed = 0;
const check = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed = true;
  else passed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function waitFor(fn, timeout = 15_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (fn()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error('timeout'));
      }
    }, 50);
  });
}

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-safe-'));
fs.writeFileSync(path.join(data, 'state.json'), '{"10001": {"affection": 3, "turns": 4'); // 写到一半断了电
const calls = [];
let mid = 0;
let socket;
const wss = new WebSocketServer({ port: 39831 });
wss.on('connection', (ws) => {
  socket = ws;
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    calls.push(msg);
    const sends = msg.action === 'send_private_msg' || msg.action === 'send_group_msg';
    ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: sends ? { message_id: ++mid } : {}, echo: msg.echo }));
  });
  ws.send(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'lifecycle', self_id: BOT, time: Date.now() / 1000 }));
});
const bridge = spawn(process.execPath, [path.join(ROOT, 'bridge.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env,
    ONEBOT_WS: 'ws://127.0.0.1:39831',
    ALLOWED_QQ: String(OWNER), ALLOWED_GROUPS: String(GROUP), PROACTIVE_QQ: String(OWNER), PC_OWNER: '',
    DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'), DSH_HOME: path.join(data, 'dsh-home'), DSH_PERMISSION_MODE: 'danger-full-access',
    BRIDGE_DATA: data, STICKER_DIR: path.join(data, 'stickers'), AGENT_CWD: ROOT, DEEPSEEK_API_KEY: 'test', DASHSCOPE_API_KEY: '',
    PHONE_MONITOR: 'false', ACK_PRIVATE: 'false', FACTS: 'false',
    AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false',
    PROACTIVE: 'false', GREETINGS: 'false', REFLECT: 'false', VOICE: 'false', RADIO: 'false', MIMIC: 'false', WEATHER: 'false', JOURNAL: 'false',
    CURIOUS: 'false', RHYTHM: 'false', POKE_SELF: 'false', CHASE: 'false', CHIME_PROB: '0', REACT: 'false', CLOSENESS_SET: '', ONLINE_STATUS: 'false', LONGNICK: 'false', MOOD_AVATAR: 'false', ANNIVERSARY: 'false',
    MERGE_MS: '200', TYPING_MS_PER_CHAR: '0', TYPO_PROB: '0', SLEEP_DELAY_PROB: '0', SLEEP_START: '0', SLEEP_END: '0', QUIET_HOURS: '0-0',
    HEAR_VOICE: 'false', DRAW: 'false', SHARE_CARDS: 'false',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const sentCount = () => calls.filter((c) => c.action === 'send_private_msg' || c.action === 'send_group_msg').length;
let id = 1000;
const now = () => Math.floor(Date.now() / 1000);
try {
  await waitFor(() => socket && socket.readyState === 1);
  await sleep(300);
  const kept = fs.readdirSync(data).filter((f) => f.startsWith('state.json.broken-'));
  check(kept.length === 1 && fs.readFileSync(path.join(data, kept[0]), 'utf8').includes('"affection": 3'), '坏了的 state.json 原样留了一份');
  const log = fs.readFileSync(path.join(data, 'bridge.log'), 'utf8');
  check(/state\.json 坏了/.test(log), '日志里记了一笔');

  let n = sentCount();
  socket.send(JSON.stringify({ post_type: 'message', message_type: 'private', self_id: BOT, user_id: OWNER, message_id: ++id, time: now(), message: [{ type: 'text', data: { text: '在吗' } }], sender: { user_id: OWNER, nickname: 'owner' } }));
  await waitFor(() => sentCount() > n);
  await sleep(500);
  check(true, '照常起来、照常回');
  let ok = false;
  try {
    ok = typeof JSON.parse(fs.readFileSync(path.join(data, 'state.json'), 'utf8')) === 'object';
  } catch {}
  check(ok, '写回去的 state.json 是完整的 JSON');
  check(!fs.readdirSync(data).some((f) => f.endsWith('.tmp')), '没剩下 .tmp 临时文件');

  n = sentCount();
  socket.send(JSON.stringify({
    post_type: 'message', message_type: 'group', self_id: BOT, group_id: GROUP, user_id: OWNER, message_id: ++id, time: now(),
    message: [{ type: 'at', data: { qq: String(BOT) } }, { type: 'text', data: { text: '群里记一下 GROUPMEM' } }], sender: { user_id: OWNER, nickname: 'owner' },
  }));
  await waitFor(() => sentCount() > n);
  await sleep(500);
  const mem = fs.readdirSync(path.join(data, 'memory'));
  const gfile = mem.find((f) => f.startsWith(`g${GROUP}`));
  check(gfile === `g${GROUP}_u${OWNER}.md`, `群聊记忆文件名没有冒号（${gfile}）`);
  check(!!gfile && fs.readFileSync(path.join(data, 'memory', gfile), 'utf8').includes('GROUPMEM'), '群聊记忆真记进去了');
} finally {
  bridge.kill();
  wss.close();
}
console.log(`\n${failed ? 'FAILED' : 'ALL PASS'}（${passed} 项通过）`);
process.exit(failed ? 1 : 0);
