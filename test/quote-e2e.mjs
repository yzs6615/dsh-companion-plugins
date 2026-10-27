#!/usr/bin/env node
/**
 * 引用测试：mock OneBot <-> bridge.mjs <-> fake dsh，临时数据目录，不花钱。
 * 覆盖：引用它自己说的话、引用别人带图的消息（图也下载给它看）、get_msg 取不到时从最近的消息里找、
 * 原文找不到时也说清楚、只引用不说话、群里没 @ 但引用了它的话也会回、引用别人的话在群里不会被叫出来。
 */
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OWNER = 10001;
const BOT = 99999;
const GROUP = 777;
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

// 一张小 PNG（被引用的消息里的图）
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const img = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'image/png' });
  res.end(PNG);
});
await new Promise((r) => img.listen(3998, r));

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-quote-'));
fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ _closenessSeeded: 1 }));
const MSGS = {
  501: { message_id: 501, sender: { user_id: BOT, nickname: '机器人' }, message: [{ type: 'text', data: { text: 'BOTLINE 我昨天说的话' } }] },
  502: { message_id: 502, sender: { user_id: 30003, nickname: '小明' }, message: [{ type: 'text', data: { text: 'XMLINE 看这个' } }, { type: 'image', data: { url: 'http://127.0.0.1:3998/a.png' } }] },
  505: { message_id: 505, sender: { user_id: 30003, nickname: '小明' }, message: [{ type: 'text', data: { text: 'XM 群里说的' } }] },
};

const priv = [];
const grp = [];
const calls = [];
let socket;
let id = 1000;
const wss = new WebSocketServer({ port: 3997 });
wss.on('connection', (ws) => {
  socket = ws;
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    calls.push(msg);
    const text = (msg.params?.message || []).filter?.((x) => x.type === 'text').map((x) => x.data.text).join('') || '';
    if (msg.action === 'send_private_msg') priv.push(text);
    if (msg.action === 'send_group_msg') grp.push(text);
    if (msg.action === 'get_msg') {
      const m = MSGS[msg.params.message_id];
      return ws.send(JSON.stringify(m ? { status: 'ok', retcode: 0, data: m, echo: msg.echo } : { status: 'failed', retcode: 1200, wording: '消息不存在', echo: msg.echo }));
    }
    ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 9000 + calls.length }, echo: msg.echo }));
  });
  ws.send(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'lifecycle', self_id: BOT, time: Date.now() / 1000 }));
});
const sendPriv = (message, mid = ++id) =>
  socket.send(JSON.stringify({ post_type: 'message', message_type: 'private', self_id: BOT, user_id: OWNER, message_id: mid, time: Math.floor(Date.now() / 1000), message, sender: { user_id: OWNER, nickname: '阿青' } }));
const sendGroup = (message) =>
  socket.send(JSON.stringify({ post_type: 'message', message_type: 'group', self_id: BOT, group_id: GROUP, user_id: OWNER, message_id: ++id, time: Math.floor(Date.now() / 1000), message, sender: { user_id: OWNER, nickname: '阿青' } }));
const quote = (qid, text) => [{ type: 'reply', data: { id: String(qid) } }, ...(text ? [{ type: 'text', data: { text } }] : [])];
// 回复会按行拆成几个气泡：把最近一次回复的气泡拼起来看
let mark = 0;
const lastPriv = () => priv.slice(mark).join('\n');
const next = () => { mark = priv.length; };

const bridge = spawn(process.execPath, [path.join(ROOT, 'bridge.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env, ONEBOT_WS: 'ws://127.0.0.1:3997', ALLOWED_QQ: String(OWNER), ALLOWED_GROUPS: String(GROUP),
    DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'), DSH_HOME: path.join(data, 'dsh-home'), BRIDGE_DATA: data, AGENT_CWD: ROOT,
    DEEPSEEK_API_KEY: 'test', PHONE_MONITOR: 'false', AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false', PROACTIVE: 'false', FACTS: 'false', REFLECT: 'false', JOURNAL: 'false',
    MERGE_MS: '200', TYPING_MS_PER_CHAR: '0', TYPO_PROB: '0', SLEEP_DELAY_PROB: '0', REACT: 'false', CLOSENESS_SET: '',
    GROUP_FOLLOW_SEC: '0', CHIME_PROB: '0', WAKE_WORDS: '小测',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

try {
  await waitFor(() => socket && socket.readyState === 1);
  await sleep(300);

  // 1. 引用它自己说的话
  next();
  sendPriv(quote(501, '这是啥意思'));
  await waitFor(() => lastPriv().includes('这是啥意思'));
  check(lastPriv().includes('引用了你自己之前说的：「BOTLINE 我昨天说的话」'), '引用它自己的话：模型看得到原文，知道是自己说的');

  // 2. 引用别人带图的消息：图也下载给它看
  next();
  sendPriv(quote(502, '你看他发的'));
  await waitFor(() => lastPriv().includes('你看他发的'));
  check(lastPriv().includes('小明说的：「XMLINE 看这个」') && lastPriv().includes('还带图'), '引用别人的消息：带上是谁说的、说了啥');
  check(lastPriv().includes('[有图]') && fs.readdirSync(path.join(data, 'images')).some((f) => f.startsWith('quote-502')), '被引用消息里的图也下载给它看了');

  // 3. get_msg 取不到（比如重启前的）→ 从最近收到的消息里找
  next();
  sendPriv([{ type: 'text', data: { text: 'CACHED 我刚才说的' } }], 503);
  await waitFor(() => lastPriv().includes('CACHED'));
  next();
  sendPriv(quote(503, '刚才那句'));
  await waitFor(() => lastPriv().includes('刚才那句'));
  check(lastPriv().includes('自己之前说的：「CACHED 我刚才说的」'), 'get_msg 取不到时从最近的消息里找到原文');

  // 4. 找不到原文：也说清楚
  next();
  sendPriv(quote(504, '这条'));
  await waitFor(() => lastPriv().includes('这条'));
  check(lastPriv().includes('原文已经找不到了'), '原文找不到时告诉它“找不到了”，不是空占位');

  // 5. 只引用不说话
  next();
  sendPriv(quote(501, ''));
  await waitFor(() => lastPriv().includes('只引用了'));
  check(lastPriv().includes('BOTLINE'), '只引用、不打字也能回');

  // 6. 群里没 @，但引用了它的话 → 会回；引用别人的话 → 不回
  sendGroup(quote(501, '群里接着问'));
  await waitFor(() => grp.some((t) => t.includes('群里接着问')));
  check(grp.join('\n').includes('群里接着问') && grp.join('\n').includes('BOTLINE'), '群里引用它说过的话（没 @）也会回');
  const n = grp.length;
  sendGroup(quote(505, '跟小明说的'));
  await sleep(1500);
  check(!grp.slice(n).some((t) => t.includes('跟小明说的')), '群里引用别人的话、没叫它：不插话');
} catch (err) {
  check(false, `出错：${err.message}`);
} finally {
  bridge.kill();
  wss.close();
  img.close();
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  setTimeout(() => process.exit(failed ? 1 : 0), 200);
}
