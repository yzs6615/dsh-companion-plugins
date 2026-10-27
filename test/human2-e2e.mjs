#!/usr/bin/env node
/**
 * 第二批拟人行为：学说话（口头禅）、偷表情包、被冷落有情绪。
 * mock OneBot <-> bridge.mjs <-> fake dsh，临时数据目录，不用 QQ、不花钱。
 */
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

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
const PNG = (seed) => {
  // 1x1 PNG with a different pixel per seed so hashes differ
  const base = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  return Buffer.concat([base, Buffer.from(String(seed))]);
};

async function start(port, { state, facts, env = {} } = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-human2-'));
  const stickers = path.join(data, 'stickers');
  fs.mkdirSync(path.join(stickers, '开心'), { recursive: true });
  if (state) fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify(state));
  if (facts) {
    fs.mkdirSync(path.join(data, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(data, 'memory', `u${OWNER}.facts.json`), JSON.stringify(facts));
  }
  const calls = [];
  let socket;
  let mid = 0;
  const wss = new WebSocketServer({ port });
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
      ONEBOT_WS: `ws://127.0.0.1:${port}`,
      ALLOWED_QQ: String(OWNER),
      ALLOWED_GROUPS: '',
      DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'),
      DSH_HOME: path.join(data, 'dsh-home'),
      BRIDGE_DATA: data,
      STICKER_DIR: stickers,
      AGENT_CWD: ROOT,
      DEEPSEEK_API_KEY: 'test',
      PHONE_MONITOR: 'false',
      AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false',
      PROACTIVE: 'false',
      GREETINGS: 'false',
      MERGE_MS: '300',
      TYPING_MS_PER_CHAR: '0',
      TYPO_PROB: '0',
      CURIOUS: 'false', RHYTHM: 'false', POKE_SELF: 'false', CHASE: 'false', // 这几个是随机的，跟这里测的无关
      CHIME_PROB: '0',
      SLEEP_DELAY_PROB: '0',
      REACT: 'false',
      FACTS: 'false',
      CLOSENESS_SET: '',
      ...env,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitFor(() => socket && socket.readyState === 1);
  await sleep(300);
  let id = 5000;
  const send = (message) =>
    socket.send(
      JSON.stringify({
        post_type: 'message', message_type: 'private', self_id: BOT, user_id: OWNER, message_id: ++id,
        time: Math.floor(Date.now() / 1000), message, sender: { user_id: OWNER, nickname: 'owner' },
      }),
    );
  return {
    data,
    stickers,
    say: (text) => send([{ type: 'text', data: { text } }]),
    raw: send,
    image: (file, text, sub_type) => send([{ type: 'image', data: { file, sub_type, summary: sub_type === 1 ? '[动画表情]' : '' } }, { type: 'text', data: { text } }]),
    texts: () => calls.filter((c) => c.action === 'send_private_msg').map((c) => c.params.message.filter((s) => s.type === 'text').map((s) => s.data.text).join('')),
    state: () => JSON.parse(fs.readFileSync(path.join(data, 'state.json'), 'utf8')),
    learned: () => fs.readdirSync(path.join(stickers, '开心')).filter((f) => f.startsWith('learned-')),
    stop() {
      bridge.kill();
      wss.close();
      fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
}

// ── A：学说话 + 偷表情包 ──────────────────────────────────────────────────
const A = await start(3994, { env: { FACTS: 'true', FACTS_EVERY: '2' } });
try {
  A.say('第一句');
  await waitFor(() => A.texts().some((t) => t.includes('第一句')));
  A.say('第二句');
  await waitFor(() => A.texts().some((t) => t.includes('第二句')));
  const ff = path.join(A.data, 'memory', `u${OWNER}.facts.json`);
  await waitFor(() => fs.existsSync(ff) && JSON.parse(fs.readFileSync(ff, 'utf8')).style?.length, 10_000);
  check(JSON.parse(fs.readFileSync(ff, 'utf8')).style.some((x) => x.t.includes('草')), '学说话：提炼出了对方的口头禅');
  A.say('第三句');
  await waitFor(() => A.texts().some((t) => t.includes('第三句')));
  check(A.texts().find((t) => t.includes('第三句')).includes('[有口头禅]'), '学说话：之后的提示词里带上了对方的说话习惯');

  // 表情包（QQ 标成表情的图）
  const stk = path.join(A.data, 'stk.png');
  fs.writeFileSync(stk, PNG(1));
  A.image(stk, 'STEAL 看这个', 1);
  await waitFor(() => A.texts().some((t) => t.includes('STEAL 看这个')));
  await sleep(300);
  const r1 = A.texts().find((t) => t.includes('STEAL 看这个'));
  check(r1.includes('[看到表情包]'), '偷表情：模型被告知这张是表情包');
  check(!r1.includes('[收表情'), '偷表情：[收表情:x] 标记没发出去');
  check(A.learned().length === 1, `偷表情：收进了 开心/ 目录（${A.learned().join(',')}）`);

  // 同一张再发一次：不重复收
  A.image(stk, 'STEAL 又是这个', 1);
  await waitFor(() => A.texts().some((t) => t.includes('STEAL 又是这个')));
  await sleep(300);
  check(A.learned().length === 1, '偷表情：同一张不会收两次');

  // 普通照片（不是表情）：就算模型想收，bridge 也不收
  const photo = path.join(A.data, 'photo.png');
  fs.writeFileSync(photo, PNG(2));
  A.image(photo, 'STEAL 这是照片', 0);
  await waitFor(() => A.texts().some((t) => t.includes('STEAL 这是照片')));
  await sleep(300);
  check(!A.texts().find((t) => t.includes('STEAL 这是照片')).includes('[看到表情包]'), '偷表情：普通照片不会被标成表情包');
  check(A.learned().length === 1, '偷表情：普通照片不会被收进表情库');

  // QQ 自带表情：只发一个小黄脸也要能看到
  A.raw([{ type: 'face', data: { id: '178', raw: { faceIndex: 178, faceText: '/斜眼笑' } } }]);
  await waitFor(() => A.texts().some((t) => t.includes('[QQ表情:斜眼笑]')));
  check(true, 'QQ 表情：只发一个小黄脸，也会被当成一条消息（[QQ表情:斜眼笑]）');
  A.raw([{ type: 'text', data: { text: '服了 ' } }, { type: 'face', data: { id: '264' } }]);
  await waitFor(() => A.texts().some((t) => t.includes('服了 [QQ表情:捂脸]')));
  check(true, 'QQ 表情：没带名字时按编号认（264 = 捂脸），和文字一起保留顺序');
  A.raw([{ type: 'dice', data: { result: 4 } }]);
  await waitFor(() => A.texts().some((t) => t.includes('[掷骰子:4点]')));
  check(true, 'QQ 表情：掷骰子能看到点数');
  // 商城表情：NapCat 发成带 emoji_id 的图片，算表情包
  const mface = path.join(A.data, 'mface.png');
  fs.writeFileSync(mface, PNG(3));
  A.raw([{ type: 'image', data: { file: mface, summary: '[滑稽]', emoji_id: 'abc', emoji_package_id: 1 } }, { type: 'text', data: { text: 'MFACE' } }]);
  await waitFor(() => A.texts().some((t) => t.includes('MFACE')));
  check(A.texts().find((t) => t.includes('MFACE')).includes('[看到表情包]'), 'QQ 商城表情也被认作表情包');
} catch (err) {
  check(false, `场景 A 出错：${err.message}`);
} finally {
  A.stop();
}

// ── B：被冷落 ────────────────────────────────────────────────────────────
// 已经主动找了 2 次没人回（ignored=2），还有一个到点的回访
const due = Date.now() - 5 * 60_000;
const B = await start(3993, {
  state: { [OWNER]: { affection: 1, lastUserAt: Date.now() - 86400e3, lastProactiveAt: 0, day: '', count: 0, days: 1, turns: 1, lastDay: '', ignored: 2 }, _closenessSeeded: 1 },
  facts: { facts: [], followups: [{ ask: '问问考试', due, done: false }], style: [] },
  env: { FACTS: 'true', PROACTIVE: 'true', PROACTIVE_QQ: String(OWNER), FOLLOWUP_HOURS: '0-24', FOLLOWUP_CHECK_MS: '300', FOLLOWUP_IDLE_SEC: '0' },
});
try {
  await sleep(2500);
  check(!B.texts().some((t) => t === '考得咋样啊'), '被冷落：找了 2 次没回，就不再主动回访');
  B.say('在吗');
  await waitFor(() => B.texts().some((t) => t.includes('在吗')));
  check(B.texts().find((t) => t.includes('在吗')).includes('[有小情绪]'), '被冷落：对方终于开口，这一句带点小情绪');
  await waitFor(() => B.texts().some((t) => t === '考得咋样啊'), 8000);
  check(true, '对方开口后计数清零，回访恢复');
  const st = B.state()[OWNER];
  check(st.ignored === 1 && !st.sulk, `回访发出后重新计 1 次没回，小情绪已清掉（ignored=${st.ignored}, sulk=${st.sulk}）`);
  B.say('再说一句');
  await waitFor(() => B.texts().some((t) => t.includes('再说一句')));
  check(!B.texts().find((t) => t.includes('再说一句')).includes('[有小情绪]'), '被冷落：小情绪只带一轮');
} catch (err) {
  check(false, `场景 B 出错：${err.message}`);
} finally {
  B.stop();
}
setTimeout(() => process.exit(failed ? 1 : 0), 200);
