#!/usr/bin/env node
/**
 * 深夜电台端到端：假 OneBot / 假语音合成 / 假网易云 / 假模型，驱动真的 bridge.mjs，不发真 QQ、不花钱。
 * 覆盖：叫名字开台 → 先回一句 → 节目卡 → 语音 → 歌的链接；稿子带人设、她真干过的事、记得的事；
 * 再放一遍不再合成；聊天里她自己答应录（[电台:…] 不漏出来）；录完聊天里知道；群节目不带私事；投稿；白名单。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { makeWav } from '../packages/core/kernel/wav.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OWNER = 10001;
const GROUP = 777;
const BOT = 99999;
let failed = false;
const check = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed = true;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'radio-e2e-'));
const dump = path.join(data, 'prompts.jsonl');
const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({
  _closenessSeeded: 1,
  _self: { log: [{ day: today, time: '14:20', at: Date.now() - 3600_000, text: 'SELFLOG 刷B站看了个修猫爬架的视频，UP主嘴特贫' }] },
}));
fs.mkdirSync(path.join(data, 'memory'), { recursive: true });
fs.writeFileSync(path.join(data, 'memory', `u${OWNER}.facts.json`), JSON.stringify({ facts: [{ t: 'FACT_LIKES_CATS 家里养了只猫', at: Date.now() }], followups: [], style: [] }));

const bot = new WebSocketServer({ host: '127.0.0.1', port: 0 });
const tts = new WebSocketServer({ host: '127.0.0.1', port: 0 });
const music = createServer((req, res) => {
  const q = decodeURIComponent(new URL(req.url, 'http://x').searchParams.get('s') || '');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ result: { songs: q.includes('雨天') ? [{ id: 123, name: '雨天', artists: [{ name: '孙燕姿' }] }] : [] } }));
});
music.listen(0, '127.0.0.1');
await Promise.all([once(bot, 'listening'), once(tts, 'listening'), once(music, 'listening')]);

let spoken = 0;
tts.on('connection', (ws) => ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  const task_id = msg.header.task_id;
  if (msg.header.action === 'run-task') ws.send(JSON.stringify({ header: { task_id, event: 'task-started' } }));
  if (msg.header.action === 'continue-task') spoken++;
  if (msg.header.action === 'finish-task') {
    ws.send(makeWav(Int16Array.from({ length: 24000 * 3 }, (_, i) => Math.round(6000 * Math.sin(i / 6))), 24000));
    ws.send(JSON.stringify({ header: { task_id, event: 'task-finished' } }));
  }
}));
let socket;
let mid = 0;
const sent = []; // { to: 'p'|'g', segs }
bot.on('connection', (ws) => {
  socket = ws;
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.action === 'send_private_msg') sent.push({ to: 'p', user: msg.params.user_id, segs: msg.params.message });
    if (msg.action === 'send_group_msg') sent.push({ to: 'g', segs: msg.params.message });
    ws.send(JSON.stringify({ status: 'ok', retcode: 0, echo: msg.echo, data: { message_id: ++mid } }));
  });
  ws.send(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'lifecycle', self_id: BOT, time: Date.now() / 1000 }));
});

const child = spawn(process.execPath, [path.join(ROOT, 'bridge.mjs')], {
  cwd: ROOT,
  windowsHide: true,
  stdio: ['ignore', 'ignore', 'pipe'],
  env: {
    ...process.env,
    ONEBOT_WS: `ws://127.0.0.1:${bot.address().port}`, ONEBOT_TOKEN: '',
    ALLOWED_QQ: String(OWNER), ALLOWED_GROUPS: String(GROUP), BOT_NAME: '小伴', WAKE_WORDS: '小伴',
    DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'), DSH_HOME: path.join(data, 'dsh'), BRIDGE_DATA: data, AGENT_CWD: ROOT,
    STICKER_DIR: path.join(data, 'stickers'), DEEPSEEK_API_KEY: 'test', FAKE_PROMPT_DUMP: dump,
    PHONE_MONITOR: 'false', AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false', PROACTIVE: 'false', GREETINGS: 'false', FACTS: 'true', FACTS_EVERY: '99', REFLECT: 'false',
    JOURNAL: 'true', JOURNAL_CHECK_MS: '99999999', WEATHER: 'false', ONLINE_STATUS: 'false', LONGNICK: 'false', ANNIVERSARY: 'false',
    POKE_SELF: 'false', CHASE: 'false', CURIOUS: 'false', RHYTHM: 'false', REACT: 'false', ACK_PRIVATE: 'false',
    TYPING_MS_PER_CHAR: '0', TYPO_PROB: '0', SLEEP_DELAY_PROB: '0', CHIME_PROB: '0', MERGE_MS: '200', RADIO_COLLECT_MS: '400',
    VOICE: 'true', VOICE_ID: 'test', DASHSCOPE_API_KEY: 'test', DASHSCOPE_WS: `ws://127.0.0.1:${tts.address().port}`,
    LIFE_MUSIC_API: `http://127.0.0.1:${music.address().port}`, RADIO: 'true',
  },
});
let errors = '';
child.stderr.on('data', (b) => {
  errors += b;
});
const waitFor = async (fn, ms = 20_000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`等太久了 ${errors.slice(-400)}`);
    await sleep(50);
  }
};
let id = 1000;
const now = () => Math.floor(Date.now() / 1000);
const priv = (text, user = OWNER) => socket.send(JSON.stringify({ post_type: 'message', message_type: 'private', self_id: BOT, user_id: user, message_id: ++id, time: now(), sender: { user_id: user, nickname: '阿青' }, message: [{ type: 'text', data: { text } }] }));
const group = (text, user = 30003) => socket.send(JSON.stringify({ post_type: 'message', message_type: 'group', self_id: BOT, group_id: GROUP, user_id: user, message_id: ++id, time: now(), sender: { user_id: user, nickname: '群友' }, message: [{ type: 'at', data: { qq: String(BOT) } }, { type: 'text', data: { text } }] }));
const kind = (m) => (m.segs.some((s) => s.type === 'record') ? 'voice' : m.segs.some((s) => s.type === 'image') ? 'image' : 'text');
const textOf = (m) => m.segs.filter((s) => s.type === 'text').map((s) => s.data.text).join('');
const prompts = () => (fs.existsSync(dump) ? fs.readFileSync(dump, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const linkSent = (from) => sent.slice(from).some((m) => textOf(m).includes('music.163.com/song?id=123'));

try {
  await waitFor(() => socket);
  await sleep(300);

  // 1. 叫名字开台：先回一句 → 节目卡 → 语音 → 歌的链接
  priv('小伴，开台，今晚想听点适合下雨的。');
  await waitFor(() => linkSent(0));
  await sleep(300); // 发完链接还要收个尾（记日记），别抢在这之前点下一期
  const order = sent.map(kind);
  check(order[0] === 'text' && /录|等|马上|想想/.test(textOf(sent[0])) && !textOf(sent[0]).includes('http'), `先回一句（${textOf(sent[0])}）`);
  check(order[1] === 'image', '然后是节目卡（图）');
  const voices1 = order.filter((k) => k === 'voice').length;
  check(voices1 >= 1 && order.lastIndexOf('voice') < sent.findIndex((m) => textOf(m).includes('music.163.com')), `语音 ${voices1} 条，在歌的链接前面`);
  check(sent.every((m) => !textOf(m).includes('/电台') && !textOf(m).includes('[电台')), '没往外发命令提示或标记');
  const p1 = prompts()[0] || '';
  check(p1.includes('「小伴的深夜电台」第 1 期') && p1.includes('只录给阿青一个人听'), '稿子：第 1 期、只录给对方');
  check(p1.includes('点播：今晚想听点适合下雨的'), '稿子：带上点播的主题');
  check(p1.includes('SELFLOG') && p1.includes('FACT_LIKES_CATS'), '稿子：带上她今天真干过的事、记得的对方的事');
  check(p1.includes('不是客服'), '稿子：带上了人设');

  // 2. 再放一遍：不再合成
  const tts1 = spoken;
  const n2 = sent.length;
  priv('再放一遍');
  await waitFor(() => linkSent(n2));
  await sleep(300); // 发完链接还要收个尾（记日记），别抢在这之前点下一期
  check(spoken === tts1, '再放一遍没再合成');
  check(sent.slice(n2).filter((m) => kind(m) === 'voice').length === voices1, '再放一遍语音条数一样');
  check(prompts().length === 1, '再放一遍没再写稿');

  // 3. 平常聊天：知道自己录了第 1 期
  const n3 = sent.length;
  priv('你好呀');
  await waitFor(() => sent.slice(n3).some((m) => textOf(m).includes('[fake]')));
  check(sent.slice(n3).some((m) => textOf(m).includes('[知道上期]')), '聊天时知道录过哪期');
  const mem = fs.readFileSync(path.join(data, 'memory', `u${OWNER}.md`), 'utf8');
  check(mem.includes('录了第1期电台'), '录完记进了这个聊天');
  const st = JSON.parse(fs.readFileSync(path.join(data, 'state.json'), 'utf8'));
  check(st._self.log.some((e) => e.text === '给人录了一期电台'), '自己的日志只记“录了一期”，不写录给谁');

  // 4. 聊天里她自己答应录：[电台:一分钟|下雨天]
  const n4 = sent.length;
  priv('RADIOTAG 给我来点短的');
  await waitFor(() => linkSent(n4));
  await sleep(300); // 发完链接还要收个尾（记日记），别抢在这之前点下一期
  check(sent.slice(n4).some((m) => textOf(m).startsWith('行 等我录一下')), '先回了那句话');
  check(sent.slice(n4).every((m) => !textOf(m).includes('[电台')), '[电台:…] 没漏出来');
  check((prompts()[1] || '').includes('这是一分钟版') && (prompts()[1] || '').includes('第 2 期'), '按她答应的录了一分钟版第 2 期');

  // 5. 投稿：一句话里带着稿子
  const n5 = sent.length;
  priv('我投个稿：SUBMITTED 楼下的猫生了五只小猫');
  await waitFor(() => linkSent(n5));
  await sleep(300); // 发完链接还要收个尾（记日记），别抢在这之前点下一期
  check((prompts()[2] || '').includes('听众投稿（阿青投的）：\nSUBMITTED 楼下的猫生了五只小猫'), '投稿原样交给她念');

  // 6. 群里点：单独编号、不带私事
  const n6 = sent.length;
  group('开台 随便聊聊');
  await waitFor(() => sent.slice(n6).some((m) => m.to === 'g' && textOf(m).includes('music.163.com')));
  const gp = prompts().at(-1) || '';
  check(gp.includes('在群里放') && gp.includes('第 1 期'), '群节目单独编号');
  check(!gp.includes('FACT_LIKES_CATS') && !gp.includes('只录给'), '群节目不带对方的私事');

  // 7. 白名单外的人点：不理
  const n7 = sent.length;
  priv('开台', 20002);
  await sleep(800);
  check(sent.length === n7, '白名单外的人点电台不理');

  // 8. /help 里不写死名字
  const n8 = sent.length;
  priv('/help');
  await waitFor(() => sent.length > n8);
  check(!textOf(sent.at(-1)).includes('小伴电台') && textOf(sent.at(-1)).includes('开台'), '/help 提到电台，没写死名字');
} catch (err) {
  check(false, `跑完（${err.message}）`);
  console.log('最后几条：', sent.slice(-6).map((m) => `${m.to}:${kind(m)}:${textOf(m).slice(0, 40)}`));
} finally {
  child.kill();
  await once(child, 'exit').catch(() => {});
  for (const srv of [bot, tts]) {
    for (const ws of srv.clients) ws.terminate();
    srv.close();
  }
  music.closeAllConnections?.();
  music.close();
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
setTimeout(() => process.exit(failed ? 1 : 0), 100);
