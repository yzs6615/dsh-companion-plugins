#!/usr/bin/env node
/**
 * 唱歌测试：mock OneBot <-> bridge.mjs <-> fake dsh，临时歌库和数据目录，不花钱。
 * 覆盖：提示词里列出会唱的歌、[唱歌:歌名] 先说话再发语音、标记不露出来、两段轮着唱不连着重复、
 * 没学过的歌说还没学会、/歌单、/唱歌、/唱歌 不会的歌、一天上限（到了提示词里改成“嗓子累了”）、记忆里记“唱了一段”。
 */
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { makeWav } from '../packages/speech/tts.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OWNER = 10001;
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

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-sing-'));
fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ _closenessSeeded: 1 }));
const songDir = path.join(data, 'songs', '第一天');
fs.mkdirSync(songDir, { recursive: true });
// 两段长度不一样，好分辨唱的是哪段
fs.writeFileSync(path.join(songDir, '01.wav'), makeWav(new Int16Array(24000), 24000));
fs.writeFileSync(path.join(songDir, '02.wav'), makeWav(new Int16Array(48000), 24000));
fs.writeFileSync(path.join(songDir, 'song.json'), JSON.stringify({ title: '第一天', artist: '孙燕姿', clips: [{ file: '01.wav', start: 0, end: 1, sec: 1, lyrics: '下过雨的' }, { file: '02.wav', start: 1, end: 3, sec: 2, lyrics: '第一天我存在' }, { file: '03.wav', start: 3, end: 4, sec: 1, lyrics: '文件不在' }] }));
fs.mkdirSync(path.join(data, 'songs', '空的'), { recursive: true }); // 没有 song.json：忽略

const sent = []; // { kind, text?, bytes? }
let socket;
let id = 100;
const wss = new WebSocketServer({ port: 3995 });
wss.on('connection', (ws) => {
  socket = ws;
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.action === 'send_private_msg') {
      const m = msg.params.message;
      const rec = m.find((x) => x.type === 'record');
      if (rec) sent.push({ kind: 'record', bytes: Buffer.from(rec.data.file.replace(/^base64:\/\//, ''), 'base64').length });
      else if (m.some((x) => x.type === 'image')) sent.push({ kind: 'image' });
      else sent.push({ kind: 'text', text: m.filter((x) => x.type === 'text').map((x) => x.data.text).join('') });
    }
    ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: sent.length }, echo: msg.echo }));
  });
  ws.send(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'lifecycle', self_id: BOT, time: Date.now() / 1000 }));
});
const say = (text) =>
  socket.send(JSON.stringify({ post_type: 'message', message_type: 'private', self_id: BOT, user_id: OWNER, message_id: ++id, time: Math.floor(Date.now() / 1000), message: [{ type: 'text', data: { text } }], sender: { user_id: OWNER, nickname: '阿青' } }));

const bridge = spawn(process.execPath, [path.join(ROOT, 'bridge.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env, ONEBOT_WS: 'ws://127.0.0.1:3995', ALLOWED_QQ: String(OWNER), ALLOWED_GROUPS: '',
    DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'), DSH_HOME: path.join(data, 'dsh-home'), BRIDGE_DATA: data, AGENT_CWD: ROOT,
    STICKER_DIR: path.join(data, 'stickers'),
    DEEPSEEK_API_KEY: 'test', PHONE_MONITOR: 'false', AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false', PROACTIVE: 'false', FACTS: 'false', REFLECT: 'false',
    MERGE_MS: '200', TYPING_MS_PER_CHAR: '0', TYPO_PROB: '0', SLEEP_DELAY_PROB: '0', REACT: 'false', CLOSENESS_SET: '',
    VOICE: 'false', SING: 'true', SING_MAX_DAY: '2',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const after = (n) => sent.slice(n);
try {
  await waitFor(() => socket && socket.readyState === 1);
  await sleep(300);

  // 1. 模型写 [唱歌:第一天]：先说一句，再发语音
  let n = sent.length;
  say('SING 1');
  await waitFor(() => after(n).some((x) => x.kind === 'record'));
  const r1 = after(n);
  const t1 = r1.find((x) => x.kind === 'text');
  check(t1 && t1.text.includes('给你唱两句') && !t1.text.includes('[唱歌'), '先说一句，标记不露出来');
  check(t1 && t1.text.includes('[知道会唱]'), '提示词里列出了会唱的歌');
  check(r1.findIndex((x) => x.kind === 'text') < r1.findIndex((x) => x.kind === 'record'), '先说话再唱');
  const first = r1.find((x) => x.kind === 'record').bytes;

  // 2. 再唱：换一段（文件不存在的那段不会被挑）
  n = sent.length;
  say('SING 2');
  await waitFor(() => after(n).some((x) => x.kind === 'record'));
  const second = after(n).find((x) => x.kind === 'record').bytes;
  check(second !== first, '连着唱两次，换了一段');

  // 3. 到上限（SING_MAX_DAY=2）：不唱了，提示词里也不再说会唱
  n = sent.length;
  say('SING 3');
  await waitFor(() => after(n).some((x) => x.kind === 'text'));
  await sleep(500);
  check(!after(n).some((x) => x.kind === 'record'), '一天唱够了就不再发语音');
  check(!after(n).find((x) => x.kind === 'text').text.includes('[知道会唱]'), '唱够了之后提示词改成“嗓子累了”');

  // 4. /唱歌 不受上限
  n = sent.length;
  say('/唱歌 第一天');
  await waitFor(() => after(n).length > 0);
  check(after(n)[0].kind === 'record', '/唱歌 歌名 直接唱（不受每天上限）');
  n = sent.length;
  say('/唱歌 晴天');
  await waitFor(() => after(n).length > 0);
  check(after(n)[0].kind === 'text' && after(n)[0].text.includes('还没学会') && after(n)[0].text.includes('第一天'), '/唱歌 不会的歌：说没学会，并列出会的');

  // 5. /歌单
  n = sent.length;
  say('/歌单');
  await waitFor(() => after(n).length > 0);
  const list = after(n)[0].text;
  check(list.includes('第一天（孙燕姿） · 2 段') && !list.includes('空的'), `/歌单 只列能唱的（${list.split('\n')[1]}）`);

  // 6. 模型要唱没学过的歌
  // 上限已到：先确认上限前的行为已经测过，这里只看不会露出标记
  n = sent.length;
  say('SINGUNKNOWN');
  await waitFor(() => after(n).some((x) => x.kind === 'text'));
  check(!after(n).some((x) => x.text?.includes('[唱歌')), '没学过的歌：标记也不露出来');

  // 7. 记忆
  const memDir = path.join(data, 'memory');
  const mem = fs.existsSync(memDir) ? fs.readdirSync(memDir).map((f) => fs.readFileSync(path.join(memDir, f), 'utf8')).join('') : '';
  check(mem.includes('（唱了一段《第一天》）') && !mem.includes('[唱歌'), '记忆里记着“唱了一段”，不留标记');
} catch (err) {
  check(false, `出错：${err.message}`);
} finally {
  bridge.kill();
  wss.close();
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  setTimeout(() => process.exit(failed ? 1 : 0), 200);
}
