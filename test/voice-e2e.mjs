#!/usr/bin/env node
/**
 * 语音测试：mock OneBot + 假 CosyVoice 合成服务 <-> bridge.mjs <-> fake dsh，临时数据目录，不花钱。
 * 覆盖：[语音] 发成 QQ 语音、句尾小声杂音被剪掉、标记和括号动作不念、太长改打字、
 * 合成失败改打字、一天条数上限、/说话、记忆里不留 [语音] 标记、生对方气时带生气的语气（音量压到上限）、
 * [语音:害怕] 自己点语气、点了没做的（开心）就用平常的；
 * 外加 cleanEdges / capLevel 单测。
 */
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { cleanEdges, capLevel, makeWav, parseWav } from '../packages/core/kernel/tts.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OWNER = 10001;
const BOT = 99999;
const RATE = 24000;
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

/** 0.3s 静音 + 1.2s 正常说话音量的“话” + 0.4s 静音 + 1.5s 小声杂音 + 0.3s 静音 */
function fakeSpeech() {
  const parts = [[0.3, 0], [1.2, 9000], [0.4, 0], [1.5, 300], [0.3, 0]];
  const out = [];
  for (const [sec, amp] of parts) for (let i = 0; i < sec * RATE; i++) out.push(Math.round(amp * Math.sin(i / 7) + (amp ? (Math.random() - 0.5) * amp * 0.2 : 0)));
  return Int16Array.from(out);
}

// ── cleanEdges 单测 ──
{
  const s = fakeSpeech();
  const c = cleanEdges(s, RATE);
  const sec = c.length / RATE;
  check(sec > 1.2 && sec < 1.7, `去掉了开头静音和句尾小声杂音（${(s.length / RATE).toFixed(1)}s → ${sec.toFixed(2)}s）`);
  const loudTail = Int16Array.from([...fakeSpeech().slice(0, 1.9 * RATE), ...Array.from({ length: 1.2 * RATE }, (_, i) => Math.round(9000 * Math.sin(i / 5)))]);
  check(cleanEdges(loudTail, RATE).length / RATE > 2.8, '跟正文一样响的后半句不会被当杂音剪掉');
  check(Math.abs(cleanEdges(s, RATE, { cutMs: 500 }).length / RATE - (sec - 0.5)) < 0.03, 'VOICE_CUT_MS 再硬剪掉一段');
  const multi = Buffer.concat([makeWav(s.slice(0, 1000), RATE), makeWav(s.slice(1000, 3000), RATE)]);
  check(parseWav(multi).samples.length === 3000, '多段拼起来的 wav 也能解析');
  const dbOf = (a) => 10 * Math.log10(a.reduce((x, v) => x + v * v, 0) / a.length / 1073741824);
  const loud = Int16Array.from({ length: RATE }, (_, i) => Math.round(20000 * Math.sin(i / 7)));
  check(Math.abs(dbOf(capLevel(loud, RATE, -20)) + 20) < 0.5, `太响的整段压到上限（${dbOf(loud).toFixed(1)} → ${dbOf(capLevel(loud, RATE, -20)).toFixed(1)} dB）`);
  const soft = Int16Array.from({ length: RATE }, (_, i) => Math.round(2000 * Math.sin(i / 7)));
  check(capLevel(soft, RATE, -20) === soft, '本来就不响的不动');
}

// ── 假合成服务 ──
const ttsTexts = [];
const ttsInstr = []; // 每次合成带的语气指令（没带就是空字符串）
let ttsFail = false;
const tts = new WebSocketServer({ port: 3993 });
tts.on('connection', (ws, req) => {
  const auth = req.headers.authorization || '';
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    const id = msg.header.task_id;
    if (msg.header.action === 'run-task') {
      if (!auth.includes('tts-test-key') || msg.payload.parameters.voice !== 'voice-test-id') {
        ws.send(JSON.stringify({ header: { event: 'task-failed', task_id: id, error_code: 'Bad', error_message: 'bad key/voice' } }));
        return;
      }
      ttsInstr.push(msg.payload.parameters.instruction || '');
      ws.send(JSON.stringify({ header: { event: 'task-started', task_id: id } }));
    } else if (msg.header.action === 'continue-task') {
      ttsTexts.push(msg.payload.input.text);
    } else if (msg.header.action === 'finish-task') {
      if (ttsFail) return void ws.send(JSON.stringify({ header: { event: 'task-failed', task_id: id, error_code: 'X', error_message: 'boom' } }));
      const wav = makeWav(fakeSpeech(), RATE);
      ws.send(wav.subarray(0, 5000));
      ws.send(wav.subarray(5000));
      ws.send(JSON.stringify({ header: { event: 'task-finished', task_id: id } }));
    }
  });
});

// ── mock OneBot ──
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-voice-'));
fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ _closenessSeeded: 1 }));
const sent = []; // { kind: 'text'|'record'|'image', text?, sec? }
let socket;
let id = 100;
const wss = new WebSocketServer({ port: 3992 });
wss.on('connection', (ws) => {
  socket = ws;
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.action === 'send_private_msg') {
      const m = msg.params.message;
      const rec = m.find((x) => x.type === 'record');
      if (rec) {
        const { samples } = parseWav(Buffer.from(rec.data.file.replace(/^base64:\/\//, ''), 'base64'));
        let peak = 0;
        for (const v of samples) peak = Math.max(peak, Math.abs(v));
        sent.push({ kind: 'record', sec: samples.length / RATE, peak });
      } else if (m.some((x) => x.type === 'image')) sent.push({ kind: 'image' });
      else sent.push({ kind: 'text', text: m.filter((x) => x.type === 'text').map((x) => x.data.text).join('') });
    }
    ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: sent.length }, echo: msg.echo }));
  });
  ws.send(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'lifecycle', self_id: BOT, time: Date.now() / 1000 }));
});
const say = (text) =>
  socket.send(JSON.stringify({ post_type: 'message', message_type: 'private', self_id: BOT, user_id: OWNER, message_id: ++id, time: Math.floor(Date.now() / 1000), message: [{ type: 'text', data: { text } }], sender: { user_id: OWNER, nickname: '阿青' } }));

fs.mkdirSync(path.join(data, 'stickers', '开心'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'test', 'fake-dsh.mjs'), path.join(data, 'stickers', '开心', 'a.png'));

const bridge = spawn(process.execPath, [path.join(ROOT, 'bridge.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env, ONEBOT_WS: 'ws://127.0.0.1:3992', ALLOWED_QQ: String(OWNER), ALLOWED_GROUPS: '',
    DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'), DSH_HOME: path.join(data, 'dsh-home'), BRIDGE_DATA: data, AGENT_CWD: ROOT,
    STICKER_DIR: path.join(data, 'stickers'),
    DEEPSEEK_API_KEY: 'test', PHONE_MONITOR: 'false', AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false', PROACTIVE: 'false', FACTS: 'false', REFLECT: 'false',
    MERGE_MS: '200', TYPING_MS_PER_CHAR: '0', TYPO_PROB: '0', SLEEP_DELAY_PROB: '0', REACT: 'false', CLOSENESS_SET: '',
    DASHSCOPE_API_KEY: 'tts-test-key', VOICE_ID: 'voice-test-id', DASHSCOPE_WS: 'ws://127.0.0.1:3993', VOICE: 'true',
    VOICE_MAX_CHARS: '40', VOICE_MAX_DAY: '5', VOICE_CUT_MS: '0',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const after = (n) => sent.slice(n);
try {
  await waitFor(() => socket && socket.readyState === 1);
  await sleep(300);

  // 1. [语音] → 发语音，不打字；表情照发；标记、括号动作不念
  let n = sent.length;
  say('VOICE 1');
  await waitFor(() => after(n).some((x) => x.kind === 'image'));
  const r1 = after(n);
  const rec = r1.find((x) => x.kind === 'record');
  check(!!rec, '模型写了 [语音]，发出去的是 QQ 语音');
  check(!r1.some((x) => x.kind === 'text'), '发了语音就不再打一遍字');
  check(rec && rec.sec < 1.8, `句尾杂音剪掉了（3.7s → ${rec?.sec.toFixed(2)}s）`);
  check(ttsInstr.at(-1) === '', '平常的语音不带语气指令');
  check(ttsTexts.at(-1) === '哈哈哈你好呀', `念的内容去掉了标记和括号动作（“${ttsTexts.at(-1)}”）`);
  check(r1.at(-1).kind === 'image', '表情包在语音之后照发');
  const mem = fs.readdirSync(data).filter((f) => /memory|recent/i.test(f)).map((f) => { try { return fs.readFileSync(path.join(data, f), 'utf8'); } catch { return ''; } }).join('');
  check(!mem.includes('[语音]'), '记忆里不留 [语音] 标记');

  // 2. 太长 → 打字
  n = sent.length;
  say('LONGVOICE');
  await waitFor(() => after(n).some((x) => x.kind === 'text'));
  check(!after(n).some((x) => x.kind === 'record') && !after(n).some((x) => x.text?.includes('[语音]')), '太长的就打字，标记也不露出来');

  // 3. 合成失败 → 打字
  ttsFail = true;
  n = sent.length;
  say('VOICE 2');
  await waitFor(() => after(n).some((x) => x.kind === 'image'));
  check(after(n).some((x) => x.kind === 'text' && x.text.includes('你好呀')) && !after(n).some((x) => x.kind === 'record'), '合成失败就改成打字');
  ttsFail = false;

  // 3b. 她生对方的气了（[心情:生气|…]）：这条语音带生气的语气，音量压到上限；/说话 照常念
  n = sent.length;
  say('ANGERME');
  await waitFor(() => after(n).some((x) => x.kind === 'record'));
  const angryRec = after(n).find((x) => x.kind === 'record');
  check(ttsInstr.at(-1) === '你说话的情感是angry。', '生对方气时，语音带上生气的语气');
  check(angryRec.peak < rec.peak * 0.8, `生气的语音音量压下来了（峰值 ${rec.peak} → ${angryRec.peak}）`);
  n = sent.length;
  say('/说话 试一下');
  await waitFor(() => after(n).length > 0);
  check(after(n)[0].kind === 'record' && ttsInstr.at(-1) === '', '/说话 试音色不带心情');

  // 3c. 她自己点了语气：[语音:害怕] 就用害怕的（还在生气也一样）；点了没做的 [语音:开心]，就用平常的，不按心情猜成生气
  n = sent.length;
  say('SCAREDVOICE');
  await waitFor(() => after(n).some((x) => x.kind === 'record'));
  check(ttsInstr.at(-1) === '你说话的情感是fearful。', '[语音:害怕] 用害怕的语气');
  n = sent.length;
  say('TONEHAPPY');
  await waitFor(() => after(n).some((x) => x.kind === 'record'));
  check(ttsInstr.at(-1) === '', '[语音:开心] 没做开心：用平常的嗓子，不按心情变成生气');

  // 4. 一天上限（VOICE_MAX_DAY=5：第 1 条、生气、害怕、开心那几条已发；失败的不算）
  n = sent.length;
  say('VOICE 3');
  await waitFor(() => after(n).some((x) => x.kind === 'image'));
  check(after(n).some((x) => x.kind === 'record'), '失败的那次不算条数，还能再发');
  check(ttsInstr.at(-1) === '你说话的情感是angry。', '气还没消：下一条语音也还是生气的语气');
  n = sent.length;
  say('VOICE 4');
  await waitFor(() => after(n).some((x) => x.kind === 'image'));
  check(!after(n).some((x) => x.kind === 'record') && after(n).some((x) => x.kind === 'text'), '一天发够 VOICE_MAX_DAY 条后改成打字');

  // 5. /说话 不受上限
  n = sent.length;
  say('/说话 试试这个声音');
  await waitFor(() => after(n).length > 0);
  check(after(n)[0].kind === 'record' && ttsTexts.at(-1) === '试试这个声音', '/说话 直接念出来（不受每日上限）');
} catch (err) {
  check(false, `出错：${err.message}`);
} finally {
  bridge.kill();
  wss.close();
  tts.close();
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  setTimeout(() => process.exit(failed ? 1 : 0), 200);
}
