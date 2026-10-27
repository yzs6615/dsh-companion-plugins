#!/usr/bin/env node
/**
 * 拟人行为的端到端测试：mock OneBot <-> bridge.mjs <-> fake dsh，不用 QQ，不花钱。
 * 覆盖：连发合并、表情标签、表情回应、事实记忆+回访、戳一戳、群里引用/接话、手滑补正、回着上一条时又来消息、心情头像、电脑室友、做梦、现场照、写信。
 */
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { ChronoLife } from '../packages/life/chronolife/engine.mjs';

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

/** 起一个 mock OneBot + 一个 bridge，返回收发工具。 */
async function start(port, extraEnv, seed) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-human-'));
  seed?.(data); // 起之前先往数据目录里放东西（比如 state.json）
  const stickers = path.join(data, 'stickers');
  fs.mkdirSync(path.join(stickers, '开心'), { recursive: true });
  // 1x1 PNG
  fs.writeFileSync(
    path.join(stickers, '开心', 'x.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  );
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
      ALLOWED_QQ: String(OWNER),
      ALLOWED_GROUPS: String(GROUP),
      DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'),
      DSH_HOME: path.join(data, 'dsh-home'),
      BRIDGE_DATA: data,
      STICKER_DIR: stickers,
      AGENT_CWD: ROOT,
      DEEPSEEK_API_KEY: 'test',
      PHONE_MONITOR: 'false',
      ACK_PRIVATE: 'false',
      AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false',
      PROACTIVE: 'false',
      GREETINGS: 'false',
      MERGE_MS: '300',
      TYPING_MS_PER_CHAR: '0',
      TYPO_PROB: '0',
      CURIOUS: 'false', RHYTHM: 'false', POKE_SELF: 'false', CHASE: 'false', // 这几个是随机的，跟这里测的无关
      CHIME_PROB: '0',
      SLEEP_DELAY_PROB: '0',
      FACTS: 'false',
      REACT_PROB: '1',
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
    group: (text, user, { at = false } = {}) =>
      send({
        post_type: 'message', message_type: 'group', self_id: BOT, group_id: GROUP, user_id: user, message_id: ++id, time: now(),
        message: [...(at ? [{ type: 'at', data: { qq: String(BOT) } }] : []), { type: 'text', data: { text } }],
        sender: { user_id: user, nickname: `u${user}` },
      }),
    poke: (user = OWNER) =>
      send({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', self_id: BOT, user_id: user, target_id: BOT, time: now() }),
    /** 发出去的消息：文字、有没有图、有没有引用。 */
    sent: () =>
      calls
        .filter((c) => c.action === 'send_private_msg' || c.action === 'send_group_msg')
        .map((c) => ({
          action: c.action,
          text: c.params.message.filter((s) => s.type === 'text').map((s) => s.data.text).join(''),
          image: c.params.message.some((s) => s.type === 'image'),
          jpeg: c.params.message.some((s) => s.type === 'image' && String(s.data?.file || '').startsWith('base64:///9j/')), // 拼出来的照片、信是 jpg；表情包是 png/webp
          quote: c.params.message.some((s) => s.type === 'reply'),
        })),
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

// ── 场景 A：合并、表情、回应、记忆、回访、戳、群 ──────────────────────────
const A = await start(3998, {
  FACTS: 'true',
  FACTS_EVERY: '2',
  PROACTIVE: 'true',
  PROACTIVE_QQ: String(OWNER),
  FOLLOWUP_HOURS: '0-24',
  FOLLOWUP_CHECK_MS: '400',
  FOLLOWUP_IDLE_SEC: '0',
});
try {
  // 1. 连发三条 -> 只回一次
  A.priv('aaa');
  await sleep(100);
  A.priv('bbb');
  await sleep(100);
  A.priv('ccc');
  await waitFor(() => A.sent().some((m) => m.text.includes('ccc')));
  await sleep(500);
  const burst = A.sent().filter((m) => !m.image);
  check(burst.map((m) => m.text).join('\n').includes('aaa') && burst.map((m) => m.text).join('\n').includes('bbb'), '连发三条合成一轮（三句话都在回复里）');
  check(burst.filter((m) => m.text.includes('会话')).length === 1, '连发三条只跑了一次模型');
  check(A.calls.some((c) => c.action === 'mark_private_msg_as_read'), '标了已读');

  // 2. 表情标签：两个相同标签不泄漏，只发一张图，且在文字之后
  const before = A.sent().length;
  A.priv('STICKERS');
  await waitFor(() => A.sent().length >= before + 2);
  await sleep(300);
  const after = A.sent().slice(before);
  check(after.every((m) => !m.text.includes('[表情')), '表情标签没有漏成文字');
  check(after.filter((m) => m.image).length === 1, '只发了一张表情图');
  check(after.findIndex((m) => m.image) > after.findIndex((m) => m.text.includes('行')), '表情在文字之后');

  // 3. 嗯嗯 -> 点表情回应，不再发文字
  const nSent = A.sent().length;
  A.priv('嗯嗯');
  await waitFor(() => A.calls.some((c) => c.action === 'set_msg_emoji_like'));
  await sleep(600);
  // 第 5 步的回访（“考得咋样啊”）是独立的主动消息，有时正好在这个窗口里到点，不算“回了一句”
  check(A.sent().slice(nSent).filter((m) => m.text !== '考得咋样啊').length === 0, '“嗯嗯”只点了表情回应，没再回一句');

  // 4. 事实记忆：两轮之后提炼出事实，并写进回访
  const factsFile = path.join(A.data, 'memory', `u${OWNER}.facts.json`);
  await waitFor(() => fs.existsSync(factsFile), 10_000);
  const facts = JSON.parse(fs.readFileSync(factsFile, 'utf8'));
  check(facts.facts.some((f) => f.t === '喜欢吃辣'), '提炼出了事实');
  check(facts.followups.length >= 1, '记下了回访事项');

  // 5. 回访：到点主动问
  await waitFor(() => A.sent().some((m) => m.text === '考得咋样啊'), 10_000);
  check(true, '到点主动回访');
  const done = JSON.parse(fs.readFileSync(factsFile, 'utf8'));
  check(done.followups.every((f) => f.done), '回访只问一次');

  // 6. 之后的对话带上了记住的事
  A.priv('随便聊聊');
  await waitFor(() => A.sent().some((m) => m.text.includes('随便聊聊')));
  check(A.sent().some((m) => m.text.includes('随便聊聊') && m.text.includes('[有记忆]')), '提示词里带上了长期事实');

  // 7. 戳一戳
  const nBeforePoke = A.sent().length;
  A.poke();
  await waitFor(() => A.sent().length > nBeforePoke);
  check(A.sent().at(-1).text.length > 0, '被戳了会回一句');

  // 8. 群：忙的时候引用原消息；说完话接着说不用再 @；别人不行
  A.group('机器人在吗', 30003, { at: true });
  A.group('今天吃啥', 40004);
  A.group('随便', 40004);
  await waitFor(() => A.sent().some((m) => m.action === 'send_group_msg'));
  await sleep(400);
  check(A.sent().find((m) => m.action === 'send_group_msg')?.quote === true, '群里聊开了，回复引用了原消息');
  const g0 = A.sent().filter((m) => m.action === 'send_group_msg').length;
  A.group('接着说一句', 30003);
  await waitFor(() => A.sent().filter((m) => m.action === 'send_group_msg').length > g0);
  check(A.sent().at(-1).text.includes('接着说一句'), '被 @ 过的人接着说，不用再 @');
  const g1 = A.sent().filter((m) => m.action === 'send_group_msg').length;
  A.group('我也想说', 50005);
  await sleep(1200);
  check(A.sent().filter((m) => m.action === 'send_group_msg').length === g1, '没被叫过的人说话，不会乱接');
} catch (err) {
  console.error('场景 A 出错:', err.message);
  check(false, `场景 A 完成（${err.message}）`);
} finally {
  A.stop();
}

// ── 场景 B：手滑 ────────────────────────────────────────────────────────
const B = await start(3997, { TYPO_PROB: '1' });
try {
  B.priv('TYPO');
  await waitFor(() => B.sent().length >= 2, 8000);
  await sleep(800);
  const msgs = B.sent().map((m) => m.text);
  const recalled = B.calls.some((c) => c.action === 'delete_msg');
  check(msgs[0] !== '我现在就去看看吧' && [...msgs[0]].length === [...'我现在就去看看吧'].length, '先发出了带错字的版本');
  check(recalled ? msgs.at(-1) === '我现在就去看看吧' : /^\*.$/.test(msgs.at(-1)), `之后${recalled ? '撤回重发了' : '补了一句 *正字'}`);
} catch (err) {
  check(false, `场景 B 完成（${err.message}）`);
} finally {
  B.stop();
}

// ── 场景 C：她还在回上一条，对方又发了消息 ────────────────────────────────
// 没忙多久：不喊“等下”，中间来的几条攒着，回完一起回一次；忙了很久（这里压到 2.5 秒）才吭一声，一轮只吭一次。
const C = await start(3996, { BUSY_NOTE_MS: '2500' });
const isBusyLine = (m) => /上一个还没弄完|手上还有一个|一个一个来/.test(m.text);
try {
  C.priv('SLOW600 先说件事');
  await sleep(450);
  C.priv('插一句a');
  await sleep(250);
  C.priv('插一句b');
  await waitFor(() => C.sent().some((m) => m.text.includes('插一句b')));
  await sleep(500);
  const quick = C.sent();
  check(!quick.some(isBusyLine), '上一轮没忙多久：不回“手上还有一个 等我下”');
  check(
    quick.filter((m) => m.text.includes('会话') && !m.text.includes('先说件事')).length === 1 && quick.map((m) => m.text).join('\n').includes('插一句a'),
    '中间来的两条攒成一轮，回完上一条再一起回',
  );

  const n0 = C.sent().length;
  C.priv('SLOW5000 这个要弄很久');
  await sleep(600);
  C.priv('插一句c');
  await sleep(700);
  C.priv('插一句d');
  await waitFor(() => C.sent().some((m) => m.text.includes('插一句d')), 12_000);
  await sleep(500);
  const slow = C.sent().slice(n0);
  check(slow.filter(isBusyLine).length === 1, '忙了很久才吭一声“等下”，而且只吭一次');
  check(slow.filter((m) => m.text.includes('会话') && m.text.includes('插一句')).length === 1, '忙完把攒着的两条一起回');
} catch (err) {
  check(false, `场景 C 完成（${err.message}）`);
} finally {
  C.stop();
}

// ── 场景 D：心情头像 ──────────────────────────────────────────────────────
// 被惹生气了就换“生气”那张；一天换的次数到上限了，再变开心也不换。
const avatarDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-avatar-'));
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
for (const [name, tag] of [['平常', 'N'], ['生气', 'A'], ['开心', 'H']]) fs.writeFileSync(path.join(avatarDir, `${name}.png`), Buffer.concat([PNG1, Buffer.from(tag)]));
// 睡觉时段关掉（不然半夜跑测试会换成“睡觉”那张）；语音关掉，免得真去合成
const D = await start(3995, { MOOD_AVATAR: 'true', MOOD_AVATAR_DIR: avatarDir, MOOD_AVATAR_GAP_MIN: '0', MOOD_AVATAR_MAX_DAY: '1', SLEEP_START: '0', SLEEP_END: '0', VOICE: 'false' });
const avatarCalls = () => D.calls.filter((c) => c.action === 'set_qq_avatar');
try {
  D.priv('ANGERME');
  await waitFor(() => avatarCalls().length >= 1, 8000);
  check(avatarCalls()[0].params.file === 'base64://' + fs.readFileSync(path.join(avatarDir, '生气.png')).toString('base64'), '被惹生气了：头像换成“生气”那张');
  D.priv('PRAISE');
  await waitFor(() => D.sent().some((m) => m.text.includes('那当然')));
  await sleep(800);
  check(avatarCalls().length === 1, '一天换的次数到上限了：再变开心也不换');
} catch (err) {
  check(false, `场景 D 完成（${err.message}）`);
} finally {
  D.stop();
  fs.rmSync(avatarDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

// ── 场景 E：电脑室友、做梦、现场照、写信 ────────────────────────────────────
// 电脑快照用文件冒充（网易云在放“晴天”）；房间和动作图用 1×1 的小图；没有百炼 key，信纸退回素纸，不会真去生图。
const tmpE = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-life5-'));
const snapFile = path.join(tmpE, 'pc.json');
fs.writeFileSync(snapFile, JSON.stringify({ idleMs: 1000, boot: new Date(Date.now() - 3600_000).toISOString(), w: [{ p: 'cloudmusic', t: '晴天 - 周杰伦', path: '', s: '' }] }));
const sceneDir = path.join(tmpE, 'scene');
for (const [dir, name] of [['bg', 'day.png'], ['bg', 'night.png'], ['pose', 'look.png']]) {
  fs.mkdirSync(path.join(sceneDir, dir), { recursive: true });
  fs.writeFileSync(path.join(sceneDir, dir, name), PNG1);
}
const E = await start(3994, {
  PC_BUDDY: 'true', PC_SNAPSHOT_FILE: snapFile, PC_CHECK_MS: '400', PC_SONG_PROB: '1', PROACTIVE_QQ: String(OWNER),
  DREAM: 'true', DREAM_PROB: '1', DREAM_CHECK_MS: '400', DREAM_UNTIL: '24', SLEEP_START: '0', SLEEP_END: '0',
  PHOTO: 'true', SCENE_DIR: sceneDir, LETTER: 'true', DASHSCOPE_API_KEY: '', VOICE: 'false', WEATHER: 'false',
});
try {
  await waitFor(() => E.sent().some((m) => m.text.includes('PCLINE')), 8000);
  check(true, '电脑上开始放歌：主动跟电脑的主人说了一句');
  E.priv('hi');
  await waitFor(() => E.sent().some((m) => m.text.includes('收到: hi')));
  check(E.sent().find((m) => m.text.includes('收到: hi')).text.includes('[电脑上]'), '聊天时知道电脑上在放什么');
  await sleep(1500); // 聊过天了，下一轮检查会梦见
  E.priv('DREAMCHECK');
  await waitFor(() => E.sent().some((m) => m.text.includes('DREAMCHECK')));
  check(E.sent().find((m) => m.text.includes('DREAMCHECK')).text.includes('[有梦]'), '做了梦：今天聊天时知道自己梦见了啥');
  E.priv('DREAMAGAIN');
  await waitFor(() => E.sent().some((m) => m.text.includes('DREAMAGAIN')));
  check(!E.sent().find((m) => m.text.includes('DREAMAGAIN')).text.includes('[有梦]'), '梦只提一次');
  const n0 = E.sent().length;
  E.priv('PHOTOME 在干嘛');
  await waitFor(() => E.sent().slice(n0).some((m) => m.jpeg), 15000);
  const shot = E.sent().slice(n0);
  check(shot.some((m) => m.text.includes('在刷手机') && m.text.includes('[提示照片]') && !m.text.includes('[照片]')), '问在干嘛：提示词里提醒了能发照片，回复里的 [照片] 没漏出来');
  check(shot.findIndex((m) => m.jpeg) > shot.findIndex((m) => m.text.includes('在刷手机')), '回完那句再发一张现场照');
  const n1 = E.sent().length;
  E.priv('/信');
  await waitFor(() => E.sent().slice(n1).some((m) => m.jpeg), 20000);
  const letter = E.sent().slice(n1);
  check(letter.findIndex((m) => m.text.includes('给你写了封信')) < letter.findIndex((m) => m.jpeg), '/信：写好一封信，先说一句再发信');
} catch (err) {
  check(false, `场景 E 完成（${err.message}）`);
} finally {
  E.stop();
  fs.rmSync(tmpE, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

// ── 场景 F：自定义在线状态 ──────────────────────────────────────────────────
// 被惹生气了：名字旁边的状态写她自己的一句“别惹我”，不是预设的“一言难尽”
const F = await start(3991, { DIY_STATUS: 'true', ONLINE_STATUS: 'true', SLEEP_START: '0', SLEEP_END: '0', VOICE: 'false' });
const diyCalls = () => F.calls.filter((c) => c.action === 'set_diy_online_status');
try {
  F.priv('ANGERME');
  await waitFor(() => diyCalls().length >= 1, 8000);
  check(diyCalls().at(-1).params.wording === '别惹我', '生气了：自定义在线状态写“别惹我”');
} catch (err) {
  check(false, `场景 F 完成（${err.message}）`);
} finally {
  F.stop();
}

// ── 场景 G：离开电脑留便条，回来弹通知、喇叭打招呼，便条也进桌面抽屉 ───────────────
// 电脑快照用文件冒充（先是 4 小时没动键盘鼠标，再改成刚动过）；桌面、喇叭、通知都换成临时目录和日志文件
const tmpG = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-pc2-'));
const snapG = path.join(tmpG, 'pc.json');
const idleFor = (sec) => fs.writeFileSync(snapG, JSON.stringify({ idleMs: sec * 1000, boot: new Date(Date.now() - 86400_000).toISOString(), w: [] }));
idleFor(4 * 3600);
const deskG = path.join(tmpG, 'desk');
fs.mkdirSync(deskG);
const G = await start(3990, {
  PC_BUDDY: 'true', PC_SNAPSHOT_FILE: snapG, PC_CHECK_MS: '400', PROACTIVE_QQ: String(OWNER), BOT_NAME: '小伴',
  NOTES: 'true', NOTE_AFTER_MIN: '1', SPEAKER: 'true', AWAY_MIN: '1', DRAWER: 'true', QUIET_HOURS: '0-0', SLEEP_START: '0', SLEEP_END: '0',
  DESKTOP_DIR: deskG, SPEAKER_LOG: path.join(tmpG, 'speaker.log'), NOTIFY_LOG: path.join(tmpG, 'notify.log'), VOICE: 'false',
});
try {
  const note = path.join(deskG, '小伴的便条.txt');
  await waitFor(() => fs.existsSync(note), 8000);
  check(fs.readFileSync(note, 'utf8').includes('冰箱里还有半个西瓜'), '离开电脑好几个小时：桌面上留了张便条');
  idleFor(1); // 回来了
  await waitFor(() => fs.existsSync(path.join(tmpG, 'speaker.log')), 8000);
  check(fs.readFileSync(path.join(tmpG, 'notify.log'), 'utf8').includes('小伴给你留了张便条'), '回来时右下角弹了“留了张便条”的通知');
  check(fs.readFileSync(path.join(tmpG, 'speaker.log'), 'utf8').includes('回来啦'), '回来时从电脑喇叭打了个招呼');
  check(fs.readFileSync(path.join(deskG, '小伴的抽屉', '便条.txt'), 'utf8').includes('冰箱里还有半个西瓜'), '便条也放进了桌面上她的抽屉');
} catch (err) {
  check(false, `场景 G 完成（${err.message}）`);
} finally {
  G.stop();
  fs.rmSync(tmpG, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

// ── 场景 H：放歌：在电脑前就用 QQ 音乐放，不在就发链接 ──────────────────────────
// 搜歌结果用文件冒充（不联网），QQ 音乐换成日志文件（不真的放）
const tmpH = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-music-'));
const snapH = path.join(tmpH, 'pc.json');
const idleH = (sec) => fs.writeFileSync(snapH, JSON.stringify({ idleMs: sec * 1000, boot: new Date(Date.now() - 3600_000).toISOString(), w: [] }));
idleH(5);
fs.writeFileSync(path.join(tmpH, 'search.json'), JSON.stringify([
  { id: 244115385, mid: '004Fs2FP1EvZYc', name: '晴天 (Live)', singer: '周杰伦' },
  { id: 97773, mid: '0039MnYb0qxYhV', name: '晴天', singer: '周杰伦' },
]));
const playLog = path.join(tmpH, 'play.log');
const H = await start(3989, {
  PLAY_MUSIC: 'true', PC_SNAPSHOT_FILE: snapH, PROACTIVE_QQ: String(OWNER), QQMUSIC_SEARCH_FILE: path.join(tmpH, 'search.json'), PLAY_MUSIC_LOG: playLog, VOICE: 'false',
});
try {
  H.priv('PLAYSONG 放首歌');
  await waitFor(() => fs.existsSync(playLog), 8000);
  check(fs.readFileSync(playLog, 'utf8').trim() === 'client /playbysongid cmd_count==1&&id_0==97773&&songtype_0==0', '在电脑前：用 QQ 音乐放了《晴天》（挑的是原版，不是 Live）');
  const said = H.sent().find((m) => m.text.includes('给你放'));
  check(said && said.text.includes('[能放歌]') && !said.text.includes('[放歌'), '提示词里说了能放歌，回复里的 [放歌:…] 没漏出来');
  idleH(3600); // 走开了
  H.priv('PLAYSONG 再放一首歌');
  await waitFor(() => H.sent().some((m) => m.text.includes('y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV')), 8000);
  check(fs.readFileSync(playLog, 'utf8').trim().split('\n').length === 1, '不在电脑前：没在电脑上放，发了 QQ 音乐的链接');
} catch (err) {
  check(false, `场景 H 完成（${err.message}）`);
} finally {
  H.stop();
  fs.rmSync(tmpH, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

// ── 场景 I：旅行明信片：周末寄的那张攒着（开着 ChronoLife 时这样），对方来聊天时提一句再给；/明信片 马上寄一张 ──────
// 没有百炼 key：正面退回自己画的那张，不会真去生图
const tmpI = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-trip-'));
const deskI = path.join(tmpI, 'desk');
fs.mkdirSync(deskI);
const savedCard = path.join(tmpI, 'saved.jpg');
fs.writeFileSync(savedCard, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0]));
const d0 = new Date();
const todayI = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
const I = await start(3988, {
  POSTCARD: 'true', PROACTIVE_QQ: String(OWNER), DASHSCOPE_API_KEY: '', DRAWER: 'true', DESKTOP_DIR: deskI, BOT_NAME: '小伴', VOICE: 'false',
}, (data) => fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({
  _trips: { cur: { city: '厦门', spot: '鼓浪屿', scene: '海边', planned: todayI, until: todayI, sent: true, sentAt: Date.now(), pending: { card: savedCard, body: '攒着的那张' } }, history: [] },
})));
try {
  I.priv('hi');
  await waitFor(() => I.sent().some((m) => m.jpeg), 8000);
  const got = I.sent();
  check(got.findIndex((m) => m.text.includes('[有明信片]')) >= 0 && got.findIndex((m) => m.text.includes('[有明信片]')) < got.findIndex((m) => m.jpeg), '攒着的明信片：聊天时提一句，回完再把明信片给过去');
  const n0 = I.sent().length;
  I.priv('/明信片');
  await waitFor(() => I.sent().slice(n0).some((m) => m.jpeg), 30000);
  const card = I.sent().slice(n0);
  check(card.findIndex((m) => m.text.includes('给你寄了张明信片')) < card.findIndex((m) => m.jpeg), '/明信片：先说一句再寄一张');
  const drawer = path.join(deskI, '小伴的抽屉', '明信片');
  check(fs.existsSync(drawer) && fs.readdirSync(drawer).some((f) => f.endsWith('.jpg')), '明信片也放进了桌面上她的抽屉');
} catch (err) {
  check(false, `场景 I 完成（${err.message}）`);
} finally {
  I.stop();
  fs.rmSync(tmpI, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

// ── 场景 J：送她东西：收下、摆进房间、拍一张“摆好了”，以后聊天知道房间里有 ─────────────────────
// “画出来的东西”用一张白底红方块的 BMP 冒充（GIFT_RAW_FILE），不真去生图
const tmpJ = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-gift-'));
const sceneJ = path.join(tmpJ, 'scene');
for (const [dir, name] of [['bg', 'day.png'], ['bg', 'night.png'], ['pose', 'look.png']]) {
  fs.mkdirSync(path.join(sceneJ, dir), { recursive: true });
  fs.writeFileSync(path.join(sceneJ, dir, name), PNG1);
}
function bmp(w, h, px) {
  const row = Math.ceil((w * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + row * h);
  buf.write('BM', 0);
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, h - 1 - y);
      buf.set([b, g, r], 54 + y * row + x * 3);
    }
  }
  return buf;
}
const rawJ = path.join(tmpJ, 'raw.bmp');
fs.writeFileSync(rawJ, bmp(64, 64, (x, y) => (x >= 16 && x < 48 && y >= 16 && y < 48 ? [220, 40, 40] : [255, 255, 255])));
const J = await start(3987, { PHOTO: 'true', SCENE_DIR: sceneJ, GIFT_RAW_FILE: rawJ, VOICE: 'false', WEATHER: 'false', SLEEP_START: '0', SLEEP_END: '0' });
try {
  J.priv('GIFTME 送你的');
  await waitFor(() => J.sent().some((m) => m.jpeg), 15000);
  const got = J.sent();
  const thanks = got.find((m) => m.text.includes('谢谢 我摆起来'));
  check(thanks && thanks.text.includes('[提示礼物]') && !thanks.text.includes('[收礼物'), '要送她东西：提示词里说了能收，回复里的 [收礼物:…] 没漏出来');
  check(got.findIndex((m) => /摆好了|摆哪了|放这儿了/.test(m.text)) < got.findIndex((m) => m.jpeg), '收下后说一句、拍一张摆好的照片');
  const gifts = JSON.parse(fs.readFileSync(path.join(sceneJ, 'gifts', 'gifts.json'), 'utf8'));
  check(gifts.length === 1 && gifts[0].name === '绿萝' && fs.existsSync(gifts[0].file), '礼物抠好了，记在房间里（gifts.json）');
  J.priv('hi');
  await waitFor(() => J.sent().some((m) => m.text.includes('收到: hi')));
  check(J.sent().find((m) => m.text.includes('收到: hi')).text.includes('[有礼物]'), '以后聊天知道房间里摆着对方送的绿萝');
} catch (err) {
  check(false, `场景 J 完成（${err.message}）`);
} finally {
  J.stop();
  fs.rmSync(tmpJ, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

// ── 场景 K：QQ 空间说说：用她自己干过的事发一条（好友可见）；/说说 马上发；写到聊过的人的名字就不发 ─────────
const qzoneEnv = { QZONE: 'true', QZONE_PROB: '1', QZONE_HOURS: '0-24', QZONE_CHECK_MS: '400', QUIET_HOURS: '0-0', SLEEP_START: '0', SLEEP_END: '0', PROACTIVE_QQ: String(OWNER), VOICE: 'false' };
const selfLog = (text) => (data) => {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ _self: { log: [{ day, time: '10:00', at: Date.now() - 3600_000, text }] } }));
  fs.mkdirSync(path.join(data, 'journal', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(data, 'journal', 'raw', `${day}.jsonl`), JSON.stringify({ k: `u${OWNER}`, who: `阿青(${OWNER})`, t: Date.now(), u: 'hi', a: 'hi' }) + '\n');
};
const K = await start(3986, qzoneEnv, selfLog('刷到一个修猫爬架的视频'));
const qz = (X) => X.calls.filter((c) => c.action === 'send_qzone_msg');
try {
  await waitFor(() => qz(K).length >= 1, 8000);
  check(qz(K)[0].params.content.includes('修猫爬架') && qz(K)[0].params.ugc_right === 4, '用她自己刷到的东西发了条说说（好友可见）');
  await sleep(1200);
  check(qz(K).length === 1, '一天最多一条');
  K.priv('/说说');
  await waitFor(() => K.sent().some((m) => m.text.startsWith('发了：')), 8000);
  check(qz(K).length === 2, '/说说：主人让她马上发一条，发完告诉主人发了啥');
} catch (err) {
  check(false, `场景 K 完成（${err.message}）`);
} finally {
  K.stop();
}
const K2 = await start(3985, qzoneEnv, selfLog('NAMELEAK 出去吃火锅'));
try {
  K2.priv('/说说');
  await waitFor(() => K2.sent().some((m) => m.text.startsWith('没发')), 8000);
  await sleep(800);
  check(qz(K2).length === 0, '说说里写到了聊过的人的名字：不发');
} catch (err) {
  check(false, `场景 K2 完成（${err.message}）`);
} finally {
  K2.stop();
}

// ── 场景 L：ChronoLife 开着：活动细节由模型写、主动分享由模型写（不带“虚拟”），提示词里是她原来的状态 + 小屋近况、没有机器字段；
// 自己找事做照常跑、记进 ChronoLife 的共享时间线（observed）。免打扰先关掉、主动分享先打开，好在测试里马上看到。
const lifeDb = (data) => path.join(data, 'chronolife', 'life.sqlite');
const L = await start(3984, {
  CHRONOLIFE: 'true', CHRONOLIFE_PROACTIVE: 'true', CHRONOLIFE_CHECK_MS: '500', PROACTIVE_QQ: String(OWNER), VOICE: 'false', SLEEP_START: '0', SLEEP_END: '0',
  AUTONOMY: 'true', AUTONOMY_HOURS: '0-24', AUTONOMY_ROLL_WINDOW_MIN: '0', AUTONOMY_ROLL_PROB: '1', AUTONOMY_MINUTES: '0', AUTONOMY_IDLE_MIN: '0', AUTONOMY_MAX: '1', AUTONOMY_CHECK_MS: '400',
}, (data) => {
  const life = new ChronoLife({ dbPath: lifeDb(data), settings: { quietStart: 0, quietEnd: 0, proactive: true } });
  life.commit_virtual_event({ id: `activity:${Date.now() - 60_000}`, at: Date.now() - 60_000, kind: 'sketch', content: '留下一个文字草稿：窗边的小灯把雨滴照成了细碎的星星。' });
  life.close();
});
try {
  await waitFor(() => L.sent().some((m) => m.text.includes('LIFESHARE')), 10000);
  const share = L.sent().find((m) => m.text.includes('LIFESHARE')).text;
  check(share.includes('刚写了句雨的') && !share.includes('虚拟'), 'ChronoLife：先让模型写了这次草稿的细节，再用她的口气主动分享（不说“虚拟小屋”）');
  await waitFor(() => {
    const db = new DatabaseSync(lifeDb(L.data), { readOnly: true });
    try { return db.prepare("SELECT COUNT(*) AS n FROM timeline_events WHERE kind='explore' AND source='observed'").get().n > 0; } finally { db.close(); }
  }, 10000);
  check(true, 'ChronoLife 开着也照常自己找事做，记成它时间线上真发生的事');
  L.priv('hi');
  await waitFor(() => L.sent().some((m) => m.text.includes('收到: hi')));
  const p = L.sent().find((m) => m.text.includes('收到: hi')).text;
  check(p.includes('[小屋]') && p.includes('[有细节]') && !p.includes('[机器字段]'), '提示词里有小屋近况和这次的细节，没有编号、来源、可信度这些');
} catch (err) {
  check(false, `场景 L 完成（${err.message}）`);
} finally {
  L.stop();
}

setTimeout(() => process.exit(failed ? 1 : 0), 200);
