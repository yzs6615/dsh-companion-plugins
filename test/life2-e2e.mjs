#!/usr/bin/env node
/**
 * 第二批“像人”功能测试：mock OneBot + 假天气接口 <-> bridge.mjs <-> fake dsh，临时数据目录，不花钱。
 * 覆盖：撤回（调侃 / 还没回的那条就不回了）、认识第 100 天、/生日、/城市 + 天气进提示词、
 * 收到视频（抽帧拼图、时长）、收到文件（文本直接读、太大不下、别的告诉存哪）、表情包按意思挑 / 挑不到不硬发、
 * 唱歌时在线状态变“听歌中”、写完日记换个签。
 */
import { spawn, spawnSync } from 'node:child_process';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { makeWav } from '../packages/core/kernel/wav.mjs';

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
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ── 临时数据：熟人（不是“刚认识”）、认识第 100 天、两张有描述的表情、一首歌 ──
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-life2-'));
const met = dayKey(new Date(Date.now() - 99 * 86400_000));
fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ _closenessSeeded: 1, [OWNER]: { affection: 30, days: 10, turns: 50, lastDay: dayKey(), metDay: met, lastUserAt: 0, lastProactiveAt: 0, day: '', count: 0 } }));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const sdir = path.join(data, 'stickers');
for (const m of ['开心', '无语']) fs.mkdirSync(path.join(sdir, m), { recursive: true });
fs.writeFileSync(path.join(sdir, '开心', 'a.png'), PNG);
const PNG_B = Buffer.concat([PNG, Buffer.from('B')]);
fs.writeFileSync(path.join(sdir, '无语', 'b.png'), PNG_B);
fs.writeFileSync(path.join(sdir, 'index.json'), JSON.stringify({ '开心/a.png': { desc: '猫咪捂嘴偷笑：笑死、憋不住' }, '无语/b.png': { desc: '熊猫头翻白眼：无语、看不下去' } }));
fs.mkdirSync(path.join(data, 'songs', '第一天'), { recursive: true });
fs.writeFileSync(path.join(data, 'songs', '第一天', '01.wav'), makeWav(new Int16Array(24000), 24000));
fs.writeFileSync(path.join(data, 'songs', '第一天', 'song.json'), JSON.stringify({ title: '第一天', clips: [{ file: '01.wav', start: 0, end: 1, sec: 1 }] }));
// 测试视频（4 秒，两个镜头）和几个文件
const media = path.join(data, 'incoming');
fs.mkdirSync(media);
const video = path.join(media, 'clip.mp4');
const gen = spawnSync('python', ['-c', `
import av, numpy as np, sys
c = av.open(sys.argv[1], 'w'); s = c.add_stream('mpeg4', rate=10); s.width = 64; s.height = 36; s.pix_fmt = 'yuv420p'
for i in range(40):
    a = np.zeros((36, 64, 3), np.uint8); a[:] = [(220,30,30),(30,30,220)][i // 20]
    for pk in s.encode(av.VideoFrame.from_ndarray(a, format='rgb24')): c.mux(pk)
for pk in s.encode(): c.mux(pk)
c.close()
`, video], { encoding: 'utf8' });
const txt = path.join(media, 'notes.txt');
fs.writeFileSync(txt, 'FILELINE 文件里写的话\n第二行');
const bin = path.join(media, 'thing.bin');
fs.writeFileSync(bin, Buffer.alloc(100));
const FILES = { 'vid-1': video, 'f-txt': txt, 'f-bin': bin };

// ── 假天气接口 ──
const wx = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.writeHead(200, { 'content-type': 'application/json' });
  if (u.pathname === '/geo') return res.end(JSON.stringify({ results: [{ name: '杭州', latitude: 30.3, longitude: 120.2 }] }));
  res.end(JSON.stringify({ current: { temperature_2m: 15, weather_code: 61 }, daily: { weather_code: [61, 3], temperature_2m_max: [18, 16], temperature_2m_min: [12, 10], precipitation_probability_max: [80, 20] } }));
});
await new Promise((r) => wx.listen(3999, r));

// ── 假 QQ ──
const sent = []; // { text, img }
const calls = [];
let socket;
const wss = new WebSocketServer({ port: 3993 });
wss.on('connection', (ws) => {
  socket = ws;
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    calls.push(msg);
    if (msg.action === 'send_private_msg') {
      const m = msg.params.message;
      const img = m.find((x) => x.type === 'image');
      sent.push({ text: m.filter((x) => x.type === 'text').map((x) => x.data.text).join(''), img: img ? img.data.file.replace(/^base64:\/\//, '') : '', rec: m.some((x) => x.type === 'record') });
    }
    if (msg.action === 'get_file') {
      const f = FILES[msg.params.file || msg.params.file_id];
      return ws.send(JSON.stringify(f ? { status: 'ok', retcode: 0, data: { file: f, file_name: path.basename(f) }, echo: msg.echo } : { status: 'failed', retcode: 1, echo: msg.echo }));
    }
    if (msg.action === 'get_msg') return ws.send(JSON.stringify({ status: 'failed', retcode: 1, echo: msg.echo }));
    ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 9000 + calls.length }, echo: msg.echo }));
  });
  ws.send(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'lifecycle', self_id: BOT, time: Date.now() / 1000 }));
});
let mid = 600;
const send = (message, id = ++mid) => {
  socket.send(JSON.stringify({ post_type: 'message', message_type: 'private', self_id: BOT, user_id: OWNER, message_id: id, time: Math.floor(Date.now() / 1000), message, sender: { user_id: OWNER, nickname: '阿青' } }));
  return id;
};
const say = (text) => send([{ type: 'text', data: { text } }]);
const recall = (id) => socket.send(JSON.stringify({ post_type: 'notice', notice_type: 'friend_recall', self_id: BOT, user_id: OWNER, message_id: id, time: Math.floor(Date.now() / 1000) }));
let mark = 0;
const next = () => (mark = sent.length);
const got = () => sent.slice(mark).map((x) => x.text).join('\n');

const bridge = spawn(process.execPath, [path.join(ROOT, 'bridge.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env, ONEBOT_WS: 'ws://127.0.0.1:3993', ALLOWED_QQ: String(OWNER), ALLOWED_GROUPS: '',
    DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'), DSH_HOME: path.join(data, 'dsh-home'), BRIDGE_DATA: data, AGENT_CWD: ROOT, STICKER_DIR: sdir,
    DEEPSEEK_API_KEY: 'test', PHONE_MONITOR: 'false', AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false', PROACTIVE: 'false', FACTS: 'false', REFLECT: 'false', MIMIC: 'false', VOICE: 'false',
    MERGE_MS: '1200', MERGE_MAX_MS: '3000', TYPING_MS_PER_CHAR: '0', TYPO_PROB: '0', SLEEP_DELAY_PROB: '0', REACT: 'false', CLOSENESS_SET: '',
    RECALL: 'true', RECALL_TEASE_PROB: '1', WEATHER: 'true', WEATHER_CITY: '', WEATHER_GEO_API: 'http://127.0.0.1:3999/geo', WEATHER_API: 'http://127.0.0.1:3999/fc',
    JOURNAL: 'true', JOURNAL_HOUR: '0', JOURNAL_CHECK_MS: '1500', LONGNICK: 'true', ONLINE_STATUS: 'true', SING: 'true', MEDIA: 'true', MEDIA_MAX_MB: '60',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

try {
  await waitFor(() => socket && socket.readyState === 1);
  await sleep(300);

  // 1. 认识第 100 天 + 撤回调侃
  next();
  const id1 = say('RECALL1 我说错了');
  await waitFor(() => got().includes('RECALL1'));
  check(got().includes('[纪念日]'), '认识第 100 天：聊天时她心里知道');
  next();
  recall(id1);
  await waitFor(() => got().includes('撤回了啥'));
  check(true, '撤回刚发的话：熟人会被调侃“撤回了啥 我都看到了”');

  // 2. 还没回就撤回：那条不回
  next();
  const id2 = say('DROPME 这句别回');
  await sleep(200);
  recall(id2);
  await sleep(3500);
  check(!got().includes('收到: DROPME'), '还没回就撤回了：那条不回');

  // 3. /城市 + 天气进提示词（下雨要提醒）
  next();
  say('/城市 杭州');
  await waitFor(() => got().includes('记住了'));
  check(got().includes('杭州今天小雨 12~18℃（降水 80%）'), `/城市：记住城市并报一下天气（${got().split('\n')[1] || ''}）`);
  next();
  say('WEATHER 今天出门吗');
  await waitFor(() => got().includes('WEATHER'));
  check(got().includes('[提醒天气]'), '聊天时知道对方那边在下雨，会顺口提醒');

  // 4. /生日
  const mmdd = dayKey().slice(5).replace('-', '-');
  next();
  say(`/生日 ${mmdd}`);
  await waitFor(() => got().includes('记住了'));
  next();
  say('BDAY 在吗');
  await waitFor(() => got().includes('BDAY'));
  check(got().includes('[生日]'), '/生日 设成今天：聊天时知道今天是对方生日');

  // 5. 表情包按意思挑
  next();
  say('MEANSTICKER');
  await waitFor(() => sent.slice(mark).some((x) => x.img));
  check(sent.slice(mark).find((x) => x.img).img === PNG_B.toString('base64'), '[表情:无语翻白眼] 挑到了“熊猫头翻白眼”那张');
  next();
  say('NOMATCHSTICKER');
  await waitFor(() => got().includes('行'));
  await sleep(1500);
  check(!sent.slice(mark).some((x) => x.img), '意思对不上任何一张：不硬发');

  // 6. 视频
  if (gen.status === 0) {
    next();
    send([{ type: 'video', data: { file: 'vid-1', url: '', file_size: String(fs.statSync(video).size) } }]);
    await waitFor(() => got().includes('视频'), 90_000);
    check(/一段视频（0:04）/.test(got()) && got().includes('[有图]'), `收到视频：量了时长、挑帧拼图给它看（${(got().match(/对方发来一段视频[^）]*）[^）]*/) || [''])[0].slice(0, 60)}）`);
  } else check(false, `生成测试视频失败：${(gen.stderr || '').slice(-200)}`);

  // 7. 文件：文本直接读；太大不下；别的告诉存哪
  next();
  send([{ type: 'file', data: { file: 'notes.txt', file_id: 'f-txt', file_size: '40' } }]);
  // 回复按行拆成几个气泡：等内容那一个也到了再看
  await waitFor(() => got().includes('notes.txt') && got().includes('FILELINE'), 30_000).catch(() => {});
  check(got().includes('FILELINE 文件里写的话'), '收到文本文件：内容直接读给它');
  next();
  send([{ type: 'file', data: { file: 'big.zip', file_id: 'f-big', file_size: String(200 * 1048576) } }]);
  await waitFor(() => got().includes('big.zip'), 30_000);
  check(got().includes('太大了没打开'), '文件太大：不下载，告诉它太大');
  next();
  send([{ type: 'file', data: { file: 'thing.bin', file_id: 'f-bin', file_size: '100' } }]);
  await waitFor(() => got().includes('thing.bin'), 30_000);
  check(/存在 .*thing\.bin/.test(got()), '读不了的文件：告诉它存在哪');

  // 8. 唱歌 → 在线状态“听歌中”
  next();
  say('/唱歌');
  await waitFor(() => calls.some((c) => c.action === 'set_online_status' && c.params.ext_status === 1028), 10_000);
  check(true, '唱完歌在线状态变成“听歌中”');

  // 9. 写完今天的日记 → 换个签
  await waitFor(() => calls.some((c) => c.action === 'set_self_longnick'), 20_000);
  const nick = calls.find((c) => c.action === 'set_self_longnick').params.longNick;
  const j = JSON.parse(fs.readFileSync(path.join(data, 'journal', `${dayKey()}.json`), 'utf8'));
  check(nick === '今天也在摸鱼' && j.sign === nick, `写完日记换了个签（${nick}）`);
} catch (err) {
  check(false, `出错：${err.message}`);
} finally {
  bridge.kill();
  wss.close();
  wx.close();
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  setTimeout(() => process.exit(failed ? 1 : 0), 200);
}
