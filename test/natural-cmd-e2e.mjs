#!/usr/bin/env node
/**
 * 大白话办事测试：mock OneBot + 假天气接口 <-> bridge.mjs <-> fake dsh，临时数据目录，不花钱、不联网、不真去生图。
 * 以前要发斜杠命令的事，现在跟她说就行：模型在回复里写标记，bridge 抠掉标记、回完话照斜杠命令那套去办，不另外发机器腔的确认。
 * 覆盖：提醒（分钟数 / 钟点 / 看不懂的不设 / 到点私聊“该…了” / 提示词里知道有哪些提醒）、城市、生日、看日记、写信、寄明信片、
 * 发说说（只听主人的）、合并转发后说“学第二个”、别学了、群里不写信、提示词按功能和人教标记、斜杠命令照样能用、/help；
 * 开着 ChronoLife：记住 / 更正 / 忘掉、主动分享开关（非主人说了不算）、/生活 照样能用；
 * 电脑喇叭：[喇叭:…] 主人让说才说（SPEAKER_LOG 记下要说的话、不真放），别人不说、没开喇叭不教也不说、夜里不出声、标记不发到 QQ。
 */
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OWNER = 10001;
const OTHER = 10002;
const GROUP = 777;
const BOT = 99999;

let failed = false;
const check = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed = true;
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
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// ── 假天气接口（城市查得到“杭州”，别的查不到）──
const wx = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.writeHead(200, { 'content-type': 'application/json' });
  if (u.pathname === '/geo') return res.end(JSON.stringify({ results: u.searchParams.get('name') === '杭州' ? [{ name: '杭州', latitude: 30.3, longitude: 120.2 }] : [] }));
  res.end(JSON.stringify({ current: { temperature_2m: 15, weather_code: 61 }, daily: { weather_code: [61, 3], temperature_2m_max: [18, 16], temperature_2m_min: [12, 10], precipitation_probability_max: [80, 20] } }));
});
await new Promise((r) => wx.listen(0, '127.0.0.1', r));
const WX = `http://127.0.0.1:${wx.address().port}`;

/** 起一个 mock OneBot + 一个 bridge，返回收发工具。 */
async function start(port, extraEnv, seed) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-natural-'));
  seed?.(data);
  const calls = [];
  let mid = 0;
  let socket;
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
      ALLOWED_QQ: `${OWNER},${OTHER}`,
      ALLOWED_GROUPS: String(GROUP),
      PROACTIVE_QQ: String(OWNER),
      DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'),
      DSH_HOME: path.join(data, 'dsh-home'),
      BRIDGE_DATA: data,
      STICKER_DIR: path.join(data, 'stickers'),
      AGENT_CWD: ROOT,
      DEEPSEEK_API_KEY: 'test',
      DASHSCOPE_API_KEY: '', // 没有百炼 key：信纸、明信片正面退回自己画的，不会真去生图
      PHONE_MONITOR: 'false', ACK_PRIVATE: 'false',
      AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false',
      PROACTIVE: 'false', GREETINGS: 'false', FACTS: 'false', REFLECT: 'false', VOICE: 'false', RADIO: 'false', MIMIC: 'false', WEATHER: 'false', JOURNAL: 'false',
      CURIOUS: 'false', RHYTHM: 'false', POKE_SELF: 'false', CHASE: 'false', CHIME_PROB: '0', REACT: 'false', CLOSENESS_SET: '',
      MERGE_MS: '200', TYPING_MS_PER_CHAR: '0', TYPO_PROB: '0', SLEEP_DELAY_PROB: '0', SLEEP_START: '0', SLEEP_END: '0', QUIET_HOURS: '0-0',
      REMINDER_CHECK_MS: '300',
      ...extraEnv,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitFor(() => socket && socket.readyState === 1);
  await sleep(300);
  const send = (ev) => socket.send(JSON.stringify(ev));
  const now = () => Math.floor(Date.now() / 1000);
  let id = 1000;
  return {
    data,
    calls,
    priv: (text, user = OWNER) =>
      send({
        post_type: 'message', message_type: 'private', self_id: BOT, user_id: user, message_id: ++id, time: now(),
        message: [{ type: 'text', data: { text } }], sender: { user_id: user, nickname: `u${user}` },
      }),
    privRaw: (message, user = OWNER) =>
      send({ post_type: 'message', message_type: 'private', self_id: BOT, user_id: user, message_id: ++id, time: now(), message, sender: { user_id: user, nickname: `u${user}` } }),
    group: (text, user = OWNER) =>
      send({
        post_type: 'message', message_type: 'group', self_id: BOT, group_id: GROUP, user_id: user, message_id: ++id, time: now(),
        message: [{ type: 'at', data: { qq: String(BOT) } }, { type: 'text', data: { text } }], sender: { user_id: user, nickname: `u${user}` },
      }),
    sent: () =>
      calls
        .filter((c) => c.action === 'send_private_msg' || c.action === 'send_group_msg')
        .map((c) => ({
          action: c.action,
          to: c.params.user_id,
          text: c.params.message.filter((s) => s.type === 'text').map((s) => s.data.text).join(''),
          jpeg: c.params.message.some((s) => s.type === 'image' && String(s.data?.file || '').startsWith('base64:///9j/')),
        })),
    state: () => JSON.parse(fs.readFileSync(path.join(data, 'state.json'), 'utf8')),
    reminders: () => (fs.existsSync(path.join(data, 'reminders.json')) ? JSON.parse(fs.readFileSync(path.join(data, 'reminders.json'), 'utf8')) : []),
    stop() {
      bridge.kill();
      wss.close();
      try {
        fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch {
        /* Windows 上子进程还没完全退出时删不掉临时目录，留着也没关系 */
      }
    },
  };
}
const ROBOT = /记住了 你在|分钟后叫你|小时后叫你|已记录|等我写写|行 给你写一封|写信得酝酿|等我找张明信片|行 给你寄一张|我想想从哪寄|我琢磨琢磨|我研究下|我学学|不学了 记下来的也删了|主动分享已|已更新/;
const LEAK = /\[(提醒|城市|生日|看日记|写信|寄明信片|发说说|学说话|别学了|记住|忘掉|更正|生活|喇叭)[:：\]]/;
const spoke = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

// ── 场景 A：不开 ChronoLife ──────────────────────────────────────────────────
const today = dayKey();
const tmpSpk = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-natural-spk-'));
const spkA = path.join(tmpSpk, 'a.txt');
const A = await start(3972, {
  SPEAKER: 'false', SPEAKER_LOG: spkA,
  WEATHER: 'true', WEATHER_CITY: '', WEATHER_GEO_API: `${WX}/geo`, WEATHER_API: `${WX}/fc`,
  JOURNAL: 'true', JOURNAL_CHECK_MS: '3600000', JOURNAL_HOUR: '24',
  LETTER: 'true', POSTCARD: 'true', QZONE: 'true', QZONE_PROB: '0', QZONE_CHECK_MS: '3600000', POSTCARD_CHECK_MS: '3600000',
  MIMIC: 'true', MIMIC_RAMP_DAYS: '0',
}, (data) => {
  fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ _closenessSeeded: 1, _self: { log: [{ day: today, time: '10:00', at: Date.now() - 3600_000, text: '刷到一个修猫爬架的视频' }] } }));
  fs.mkdirSync(path.join(data, 'journal'), { recursive: true });
  fs.writeFileSync(path.join(data, 'journal', `${today}.json`), JSON.stringify({ day: 'DIARYSEED 今天还行', with: { [`u${OWNER}`]: '跟你聊了NATWITH' }, at: Date.now() }));
  fs.mkdirSync(path.join(data, 'stickers'), { recursive: true });
});
const sinceA = (n) => A.sent().slice(n);
const turn = async (text, mark, user = OWNER) => {
  const n = A.sent().length;
  A.priv(text, user);
  await waitFor(() => sinceA(n).some((m) => m.text.includes(mark)));
  await sleep(600);
  return sinceA(n);
};
try {
  // 1. 提醒：“过一会儿提醒我喝水” → [提醒:0.05|该喝水了]（3 秒），到点私聊“该喝水了”
  let got = await turn('NAT_REMIND 过一会儿提醒我喝水', '到点叫你');
  check(A.reminders().some((r) => r.text === '喝水' && r.qq === String(OWNER)), '提醒：[提醒:…] 设上了（“该喝水了”收成“喝水”）');
  check(!got.some((m) => LEAK.test(m.text)) && got.filter((m) => m.text).length === 1 && !got.some((m) => ROBOT.test(m.text)), '提醒：标记没发出去，也没另外发“X 分钟后叫你”');
  await waitFor(() => A.sent().some((m) => m.text === '该喝水了'), 10_000);
  check(true, '提醒：到点私聊发了“该喝水了”');

  // 2. 两个小时后开会：提示词里知道有哪些提醒；钟点“明天 8:00”也认
  await turn('NAT_REMIND_LATER 两个小时后提醒我开会', '到时候叫你');
  const later = A.reminders().find((r) => r.text === '开会');
  check(later && Math.abs(later.at - Date.now() - 120 * 60_000) < 60_000, '提醒：“两个小时后”换算成 120 分钟');
  await turn('NAT_REMIND_CLOCK 明早8点叫我起床', '明早叫你');
  const clock = A.reminders().find((r) => r.text === '起床');
  const t8 = new Date();
  t8.setDate(t8.getDate() + 1);
  t8.setHours(8, 0, 0, 0);
  check(clock && clock.at === t8.getTime(), '提醒：钟点“明天 8:00”记成明早 8 点整');
  got = await turn('NAT_HINT 我有哪些提醒', 'NATHINT');
  check(got.some((m) => m.text.includes('[知道提醒]')), '提醒：有待办的提醒时提示词里带着，问“我有哪些提醒”能答');
  const before = A.reminders().length;
  got = await turn('NAT_REMIND_BAD 提醒我吃饭', '行');
  check(A.reminders().length === before && !got.some((m) => LEAK.test(m.text)), '提醒：时间看不懂 / 已经过了就不设，标记也不漏');

  // 3. 城市、生日
  got = await turn('NAT_CITY 我在杭州', '记下了');
  check(A.state()[OWNER]?.city === '杭州', '城市：说“我在杭州”就记下了');
  check(!got.some((m) => LEAK.test(m.text) || ROBOT.test(m.text)) && got.filter((m) => m.text).length === 1, '城市：标记没漏，没另外报“记住了 你在杭州”');
  got = await turn('NAT_HINT 今天出门吗', 'NATHINT');
  check(got.some((m) => m.text.includes('[提醒天气]') || m.text.includes('[有天气]')), '城市：之后聊天时知道那边天气');
  got = await turn('NAT_BDAY 我生日5月20号', '记住了');
  check(A.state()[OWNER]?.birthday === '05-20' && !got.some((m) => LEAK.test(m.text)), '生日：[生日:5-20] 记成 05-20');
  await turn('NAT_BDAY_BAD 我生日13月40号', '好');
  check(A.state()[OWNER]?.birthday === '05-20', '生日：13-40 这种不对的不记');

  // 4. 看日记：发最新一篇（只带跟自己的那行）
  got = await turn('NAT_DIARY 给我看看你的日记', 'DIARYSEED');
  check(got.findIndex((m) => m.text.includes('给你看')) < got.findIndex((m) => m.text.includes('DIARYSEED')) && got.some((m) => m.text.includes('NATWITH')), '看日记：先回一句，再把最新一篇发过去');

  // 5. 提示词：主人私聊全教；别人私聊不教发说说；群里不教写信、寄明信片
  got = await turn('NAT_HINT 你能干啥', 'NATHINT');
  const h1 = got.find((m) => m.text.includes('NATHINT')).text;
  check(['[会提醒]', '[会记城市]', '[会看日记]', '[会写信]', '[会寄明信片]', '[会发说说]'].every((t) => h1.includes(t)), '提示词：主人私聊时教了提醒、城市、看日记、写信、明信片、说说');
  got = await turn('NAT_HINT 你能干啥', 'NATHINT', OTHER);
  const h2 = got.find((m) => m.text.includes('NATHINT')).text;
  check(h2.includes('[会写信]') && !h2.includes('[会发说说]'), '提示词：不是主人就不教发说说');
  let n = A.sent().length;
  A.group('NAT_HINT 你能干啥');
  await waitFor(() => sinceA(n).some((m) => m.text.includes('NATHINT')));
  const h3 = sinceA(n).find((m) => m.text.includes('NATHINT')).text;
  check(h3.includes('[会提醒]') && !h3.includes('[会写信]') && !h3.includes('[会寄明信片]'), '提示词：群里不教写信、寄明信片');

  // 喇叭关着：不教，写了也不说
  check(!h1.includes('[会喇叭]'), '喇叭：没开 SPEAKER 就不教 [喇叭:…]');
  got = await turn('NAT_SPEAK 用喇叭跟我说句晚安', 'NATSPEAK');
  check(spoke(spkA) === '' && !got.some((m) => LEAK.test(m.text)), '喇叭：没开 SPEAKER 写了也不说，标记不漏');

  // 6. 写信：她回一句，信写好了发过来；没有“等我写写”那种固定的话
  n = A.sent().length;
  A.priv('NAT_LETTER 给我写封信呗');
  await waitFor(() => sinceA(n).some((m) => m.jpeg), 30_000);
  got = sinceA(n);
  check(got.findIndex((m) => m.text.includes('NATLETTER')) < got.findIndex((m) => m.jpeg) && !got.some((m) => LEAK.test(m.text) || ROBOT.test(m.text)), '写信：[写信] → 先回她自己那句，再发信，没有多余的确认');

  // 群里说写信：不写
  n = A.sent().length;
  A.group('NAT_LETTER 给我写封信');
  await waitFor(() => sinceA(n).some((m) => m.text.includes('NATLETTER')));
  await sleep(2500);
  check(!sinceA(n).some((m) => m.jpeg) && !sinceA(n).some((m) => LEAK.test(m.text)), '写信：群里写了 [写信] 也不写（跟 /信 一样只在私聊）');

  // 7. 寄明信片
  n = A.sent().length;
  A.priv('NAT_CARD 给我寄张明信片');
  await waitFor(() => sinceA(n).some((m) => m.jpeg), 30_000);
  got = sinceA(n);
  check(got.findIndex((m) => m.text.includes('NATCARD')) < got.findIndex((m) => m.jpeg) && !got.some((m) => LEAK.test(m.text) || ROBOT.test(m.text)), '明信片：[寄明信片] → 先回一句，再寄一张');

  // 8. 发说说：只听主人的
  const qz = () => A.calls.filter((c) => c.action === 'send_qzone_msg').length;
  n = A.sent().length;
  A.priv('NAT_QZONE 发条说说', OTHER);
  await waitFor(() => sinceA(n).some((m) => m.text.includes('NATQZONE')));
  await sleep(1500);
  check(qz() === 0, '说说：不是主人写了 [发说说] 也不发');
  n = A.sent().length;
  A.priv('NAT_QZONE 发条说说');
  await waitFor(() => qz() === 1, 10_000);
  await waitFor(() => sinceA(n).some((m) => m.text.startsWith('发了：')), 5000);
  check(A.calls.find((c) => c.action === 'send_qzone_msg').params.content.includes('QZONELINE'), '说说：主人说了就发一条，发完告诉主人发了啥');

  // 9. 学说话：合并转发后说“学后面那个”→ [学说话:2]；再说“别学了”→ [别学了]
  const node = (uid, nickname, text) => ({ sender: { user_id: uid, nickname }, message: [{ type: 'text', data: { text } }], time: 1 });
  n = A.sent().length;
  A.privRaw([{ type: 'forward', data: { id: 'nat-fwd', content: [node(30003, '小红', 'XH 好的捏'), node(30003, '小红', 'XH 嗯嗯'), node(30004, '小明', 'XM 绝了')] } }]);
  await waitFor(() => sinceA(n).some((m) => m.text.includes('学谁')));
  got = await turn('NAT_HINT 先看看', 'NATHINT');
  check(got.some((m) => m.text.includes('[会选人]')), '学说话：等着选人时提示词里列了人、教了 [学说话:序号]');
  n = A.sent().length;
  A.priv('NAT_PICK 学后面那个人吧');
  const mimicFile = path.join(A.data, 'mimic.json');
  await waitFor(() => fs.existsSync(mimicFile) && JSON.parse(fs.readFileSync(mimicFile, 'utf8')).active, 10_000);
  check(JSON.parse(fs.readFileSync(mimicFile, 'utf8')).active.name === '小明', '学说话：[学说话:2] 选的是第二个人（小明）');
  await waitFor(() => sinceA(n).some((m) => m.text.includes('学到了')), 5000);
  got = sinceA(n);
  check(!got.some((m) => LEAK.test(m.text) || ROBOT.test(m.text)), '学说话：标记没漏，没再说“我琢磨琢磨”');
  got = await turn('NAT_STOP 别学了', 'NATSTOP');
  await sleep(300);
  check(JSON.parse(fs.readFileSync(mimicFile, 'utf8')).active === null && !got.some((m) => LEAK.test(m.text) || ROBOT.test(m.text)), '别学了：[别学了] 停掉了，没另外发“行 不学了 记下来的也删了”');

  // 10. 斜杠命令照样能用
  got = await turn('/提醒 5 m 吃药', '分钟后叫你');
  check(got.some((m) => m.text === '行，5分钟后叫你') && A.reminders().some((r) => r.text === '吃药'), '斜杠命令照样能用：/提醒 5 m 吃药');
  got = await turn('/城市 杭州', '记住了');
  check(got.some((m) => m.text.startsWith('记住了 你在杭州')), '斜杠命令照样能用：/城市 杭州');
  got = await turn('/日记', 'DIARYSEED');
  check(true, '斜杠命令照样能用：/日记');
  got = await turn('/help', '直接跟我说');
  const help = got.find((m) => m.text.includes('直接跟我说')).text;
  check(help.includes('/status') && help.includes('/new') && help.includes('提醒我喝水') && help.includes('写封信'), `/help：告诉对方直接说就行，只把排错的列成命令`);
} catch (err) {
  check(false, `场景 A 完成（${err.message}）`);
} finally {
  A.stop();
}

// ── 场景 B：开着 ChronoLife：记住 / 更正 / 忘掉、主动分享开关 ─────────────────────
const lifeDb = (data) => path.join(data, 'chronolife', 'life.sqlite');
const B = await start(3973, { CHRONOLIFE: 'true', CHRONOLIFE_PROACTIVE: 'false', CHRONOLIFE_CHECK_MS: '3600000', PC_OWNER: String(OWNER) });
const sinceB = (n) => B.sent().slice(n);
const turnB = async (text, mark, user = OWNER) => {
  const n = B.sent().length;
  B.priv(text, user);
  await waitFor(() => sinceB(n).some((m) => m.text.includes(mark)));
  await sleep(600);
  return sinceB(n);
};
const q = (sql) => {
  const db = new DatabaseSync(lifeDb(B.data), { readOnly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
};
const proactive = () => JSON.parse(q("SELECT value FROM runtime_settings WHERE key='proactive'")[0].value);
try {
  let got = await turnB('NAT_HINT 你能干啥', 'NATHINT');
  check(got.some((m) => m.text.includes('[会记住]') && m.text.includes('[会改开关]')), 'ChronoLife：主人私聊时教了 [记住:…] 和开关');
  got = await turnB('NAT_HINT 你能干啥', 'NATHINT', OTHER);
  check(got.some((m) => m.text.includes('[会记住]') && !m.text.includes('[会改开关]')), 'ChronoLife：别人只教记住，不教开关');

  got = await turnB('NAT_REMEMBER 帮我记着下周三考试', 'NATREMEMBER');
  const note = () => q("SELECT id, content FROM episodic_memories WHERE id LIKE 'note:%' AND deleted=0");
  check(note().some((m) => m.content === '下周三考试NATNOTE'), '记住：[记住:…] 记成了这个聊天的一条');
  check(!got.some((m) => LEAK.test(m.text) || ROBOT.test(m.text)), '记住：没另外发“已记录：note:…”');
  await turnB('NAT_FIX 记错了 是周四', 'NATFIX');
  check(note().some((m) => m.content === '下周四考试NATFIXED') && !note().some((m) => m.content.includes('下周三')), '更正：按内容找到那条，改成了周四');
  await turnB('NAT_FORGET 那个考试的别记了', 'NATFORGET');
  check(!note().some((m) => m.content.includes('NATFIXED')), '忘掉：按内容找到那条，删了');

  check(proactive() === false, 'ChronoLife：主动分享一开始是关的');
  await turnB('NAT_LIFE_ON 有事可以主动找我', 'NATLIFEON');
  check(proactive() === true, '开关：[生活:主动开] 打开了主动分享');
  await turnB('NAT_LIFE_OFF 别主动找我了', 'NATLIFEOFF', OTHER);
  check(proactive() === true, '开关：不是主人说了不算（跟 /生活 一样）');
  got = await turnB('NAT_LIFE_OFF 这几天别主动找我了', 'NATLIFEOFF');
  check(proactive() === false && !got.some((m) => ROBOT.test(m.text)), '开关：主人说了就关，没另外发“主动分享已关闭”');
  got = await turnB('/生活 主动 开', '已允许');
  check(proactive() === true && got.some((m) => m.text.includes('已允许')), '斜杠命令照样能用：/生活 主动 开');
} catch (err) {
  check(false, `场景 B 完成（${err.message}）`);
} finally {
  B.stop();
  wx.close();
}

// ── 场景 C：开着喇叭和语音（SPEAKER_LOG 记下要说的话，不真去合成、不真放）─────────────────
// 语音“配好”只要有 VOICE_ID 和 key；SPEAKER_LOG 开着时 speakOnPc 不会真去连百炼。
const voiceEnv = { SPEAKER: 'true', VOICE: 'true', VOICE_ID: 'test-voice', DASHSCOPE_API_KEY: 'test', PC_OWNER: String(OWNER) };
const spkC = path.join(tmpSpk, 'c.txt');
const C = await start(3974, { ...voiceEnv, SPEAKER_LOG: spkC });
const sinceC = (n) => C.sent().slice(n);
const turnC = async (text, mark, user = OWNER) => {
  const n = C.sent().length;
  C.priv(text, user);
  await waitFor(() => sinceC(n).some((m) => m.text.includes(mark)));
  await sleep(600);
  return sinceC(n);
};
try {
  let got = await turnC('NAT_HINT 你能干啥', 'NATHINT');
  check(got.some((m) => m.text.includes('[会喇叭]')), '喇叭：开着时教了主人写 [喇叭:…]');
  got = await turnC('NAT_HINT 你能干啥', 'NATHINT', OTHER);
  check(!got.some((m) => m.text.includes('[会喇叭]')), '喇叭：不是电脑的主人就不教');
  got = await turnC('NAT_SPEAK 用喇叭跟我说句晚安', 'NATSPEAK');
  await waitFor(() => spoke(spkC).includes('晚安 早点睡'), 5000);
  check(!got.some((m) => LEAK.test(m.text) || m.text.includes('早点睡')), '喇叭：主人让说就用她的声音从喇叭说了，标记和要说的话都没发到 QQ');
  got = await turnC('NAT_SPEAK 你也用喇叭说一句', 'NATSPEAK', OTHER);
  check(spoke(spkC).split('\n').filter(Boolean).length === 1, '喇叭：不是主人写了 [喇叭:…] 也不说');
} catch (err) {
  check(false, `场景 C 完成（${err.message}）`);
} finally {
  C.stop();
}

// ── 场景 D：夜里（QUIET_HOURS 整天都算）：提示词说不出声，写了也不说 ─────────────────
const spkD = path.join(tmpSpk, 'd.txt');
const D = await start(3975, { ...voiceEnv, SPEAKER_LOG: spkD, QUIET_HOURS: '0-24' });
try {
  let n = D.sent().length;
  D.priv('NAT_HINT 用喇叭说句话');
  await waitFor(() => D.sent().slice(n).some((m) => m.text.includes('NATHINT')));
  const h = D.sent().slice(n).find((m) => m.text.includes('NATHINT')).text;
  check(h.includes('[喇叭夜里]') && !h.includes('[会喇叭]'), '喇叭：夜里提示词说喇叭不出声，不教标记');
  n = D.sent().length;
  D.priv('NAT_SPEAK 用喇叭跟我说句晚安');
  await waitFor(() => D.sent().slice(n).some((m) => m.text.includes('NATSPEAK')));
  await sleep(800);
  check(spoke(spkD) === '', '喇叭：夜里写了也不出声');
} catch (err) {
  check(false, `场景 D 完成（${err.message}）`);
} finally {
  D.stop();
  fs.rmSync(tmpSpk, { recursive: true, force: true });
}

setTimeout(() => process.exit(failed ? 1 : 0), 200);
