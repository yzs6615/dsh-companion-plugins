#!/usr/bin/env node
/**
 * 排查后那一批改动的测试：mock OneBot <-> bridge.mjs <-> fake dsh，临时数据目录（BRIDGE_DATA），不花钱、不联网、不真按键、不真去画。
 * 覆盖：
 *  P 超时不清会话、不整轮重跑、整棵进程树被杀；会话真没了才重开；权限分级（主人私聊照旧、别人私聊 / 群里 read-only、
 *    事实提炼和回访 read-only）；每轮都带的规矩（不准系统语音、QQ 资料系统管、[提醒] 只能一次、非主人只陪聊）。
 *  V 听 QQ 语音：get_record 转 wav → 识别（ASR_SCRIPT 指向假的）→ “（发来语音：…）”进这轮；没听出 / 没取到回“没听清 打字吧”；群里被叫到才听。
 *  W 本地没有 Whisper 模型：不听、不联网，直接让对方打字。
 *  M 新标记：[音乐:…]（MUSIC_CTRL_LOG 代替真按键，只听主人）、[发图:…]（只发 data 下她自己的图，../ 越界被拒，只给主人私聊）、
 *    [画:…]（DRAW_FAKE_FILE 代替真画，一天上限，别人不画）、办不成补一句：照片没拼成、放歌搜不了 / 放够了、喇叭合成失败。
 *  N 办不成补一句：[提醒] 看不懂、[生日] 看不懂、[学说话] 没转发、[看日记] 还没写、[写信] 群里 / 正在写、[忘掉] 没找到、
 *    [喇叭] 没开（提示词也说了为啥）、[画] 没 key。
 *  S 喇叭：一天的次数用完了、不是主人、夜里，都补一句。
 */
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OWNER = 10001;
const OTHER = 10002;
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
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-audit-'));
const FAKE_ASR = path.join(ROOT, 'test', 'fake-asr.mjs');
const LEAK = /\[(提醒|城市|生日|看日记|写信|寄明信片|发说说|学说话|别学了|记住|忘掉|更正|生活|喇叭|音乐|发图|画|照片|放歌)[:：\]]/;
const FAIL_TIMEOUT = ['想太久了，脑子转不动，你再说一遍', '这个我一时半会弄不完，卡住了', '超时了，换个简单点的说法再来一遍'];
const DEAF = ['没听清 打字吧', '这条语音我没听清 你打字说？', '语音没听出来 打字吧'];

/** 起一个 mock OneBot + 一个 bridge。onApi(msg) 返回 { data } 或 { fail: true } 就按它回，不返回就回 ok。 */
async function start(port, extraEnv, { seed, onApi } = {}) {
  const data = fs.mkdtempSync(path.join(TMP, 'data-'));
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
      const r = onApi?.(msg);
      if (r?.fail) return ws.send(JSON.stringify({ status: 'failed', retcode: 1200, wording: '取不到', echo: msg.echo }));
      const sends = msg.action === 'send_private_msg' || msg.action === 'send_group_msg';
      ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: r?.data ?? (sends ? { message_id: ++mid } : {}), echo: msg.echo }));
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
      PC_OWNER: '',
      DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'),
      DSH_HOME: path.join(data, 'dsh-home'),
      DSH_PERMISSION_MODE: 'danger-full-access',
      STICKY_PROMPT: 'false', // 这里一轮轮看提示词里教了什么，所以每轮全塞（同一段会话里不重复塞另有 sticky-prompt-e2e 测）
      BRIDGE_DATA: data,
      STICKER_DIR: path.join(data, 'stickers'),
      AGENT_CWD: ROOT,
      DEEPSEEK_API_KEY: 'test',
      DASHSCOPE_API_KEY: '',
      PHONE_MONITOR: 'false', ACK_PRIVATE: 'false',
      AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false',
      PROACTIVE: 'false', GREETINGS: 'false', FACTS: 'false', REFLECT: 'false', VOICE: 'false', RADIO: 'false', MIMIC: 'false', WEATHER: 'false', JOURNAL: 'false',
      CURIOUS: 'false', RHYTHM: 'false', POKE_SELF: 'false', CHASE: 'false', CHIME_PROB: '0', REACT: 'false', CLOSENESS_SET: '', ONLINE_STATUS: 'false', LONGNICK: 'false', MOOD_AVATAR: 'false', ANNIVERSARY: 'false',
      MERGE_MS: '200', TYPING_MS_PER_CHAR: '0', TYPO_PROB: '0', SLEEP_DELAY_PROB: '0', SLEEP_START: '0', SLEEP_END: '0', QUIET_HOURS: '0-0',
      ASR_SCRIPT: FAKE_ASR, HEAR_VOICE: 'true', DRAW: 'true',
      ...extraEnv,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitFor(() => socket && socket.readyState === 1);
  await sleep(300);
  const send = (ev) => socket.send(JSON.stringify(ev));
  const now = () => Math.floor(Date.now() / 1000);
  let id = 1000;
  const sent = () =>
    calls
      .filter((c) => c.action === 'send_private_msg' || c.action === 'send_group_msg')
      .map((c) => ({
        action: c.action,
        to: c.params.user_id ?? c.params.group_id,
        text: c.params.message.filter((s) => s.type === 'text').map((s) => s.data.text).join(''),
        png: c.params.message.some((s) => s.type === 'image' && String(s.data?.file || '').startsWith('base64://iVBOR')),
      }));
  const B = {
    data,
    calls,
    sent,
    priv: (message, user = OWNER) =>
      send({
        post_type: 'message', message_type: 'private', self_id: BOT, user_id: user, message_id: ++id, time: now(),
        message: typeof message === 'string' ? [{ type: 'text', data: { text: message } }] : message, sender: { user_id: user, nickname: `u${user}` },
      }),
    group: (message, user = OWNER, at = true) =>
      send({
        post_type: 'message', message_type: 'group', self_id: BOT, group_id: GROUP, user_id: user, message_id: ++id, time: now(),
        message: [...(at ? [{ type: 'at', data: { qq: String(BOT) } }] : []), ...(typeof message === 'string' ? [{ type: 'text', data: { text: message } }] : message)],
        sender: { user_id: user, nickname: `u${user}` },
      }),
    log: () => (fs.existsSync(path.join(data, 'bridge.log')) ? fs.readFileSync(path.join(data, 'bridge.log'), 'utf8') : ''),
    sessions: () => (fs.existsSync(path.join(data, 'sessions.json')) ? JSON.parse(fs.readFileSync(path.join(data, 'sessions.json'), 'utf8')) : {}),
    /** 发一句，等回复里出现 mark（再多等一会儿把补的那句也收进来），返回这之后发出去的。 */
    async turn(how, mark, extraWait = 800) {
      const n = sent().length;
      how();
      await waitFor(() => sent().slice(n).some((m) => (typeof mark === 'function' ? mark(m) : m.text.includes(mark))));
      await sleep(extraWait);
      return sent().slice(n);
    },
    stop() {
      bridge.kill();
      wss.close();
    },
  };
  return B;
}
const lines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);

// ── 场景 P：超时 / 会话 / 权限 ─────────────────────────────────────────────────
const callLog = path.join(TMP, 'calls.jsonl');
const gpid = path.join(TMP, 'grandchild.pid');
const calls = () => lines(callLog).map((l) => JSON.parse(l));
const P = await start(3961, {
  FAKE_CALL_LOG: callLog, FAKE_GRANDCHILD_PID: gpid, SESSION_TIMEOUT_MS: '3000',
  PROACTIVE: 'true', FACTS: 'true', FACTS_EVERY: '1', FOLLOWUP_CHECK_MS: '500', FOLLOWUP_HOURS: '0-24', FOLLOWUP_IDLE_SEC: '0',
});
try {
  let got = await P.turn(() => P.priv('PERMCHECK 主人私聊'), 'PERM=');
  check(got.some((m) => m.text.includes('PERM=danger-full-access')), '权限：主人私聊照旧用 DSH_PERMISSION_MODE');
  got = await P.turn(() => P.priv('PERMCHECK 别人私聊', OTHER), 'PERM=');
  check(got.some((m) => m.text.includes('PERM=read-only')), '权限：别人私聊降成 read-only');
  got = await P.turn(() => P.group('PERMCHECK 群里主人'), 'PERM=');
  check(got.some((m) => m.text.includes('PERM=read-only')), '权限：群里（主人也一样）降成 read-only');

  got = await P.turn(() => P.priv('NAT_HINT 你能干啥'), 'NATHINT');
  let h = got.find((m) => m.text.includes('NATHINT')).text;
  check(h.includes('[不准系统语音]') && h.includes('[资料系统管]') && h.includes('[提醒一次]') && !h.includes('[只听主人]'), '提示词：每轮都说不准用系统语音、QQ 资料系统管、[提醒] 只能设一次；主人私聊不说“只听主人的”');
  got = await P.turn(() => P.priv('NAT_HINT 你能干啥', OTHER), 'NATHINT');
  h = got.find((m) => m.text.includes('NATHINT')).text;
  check(h.includes('[只听主人]') && h.includes('[不准系统语音]'), '提示词：别人私聊时说手机、屏幕、文件、放歌只听主人的');
  got = await P.turn(() => P.group('NAT_HINT 你能干啥', OTHER), 'NATHINT');
  check(got.some((m) => m.text.includes('[只听主人]')), '提示词：群里也说只听主人私聊的');

  // 事实提炼、回访：不要工具，都是 read-only
  await waitFor(() => calls().some((c) => c.kind === 'followup') && /回访 10001/.test(P.log()), 15_000);
  const facts = calls().filter((c) => c.kind === 'facts');
  const fu = calls().filter((c) => c.kind === 'followup');
  check(facts.length > 0 && facts.every((c) => c.perm === 'read-only'), '权限：事实提炼用 read-only');
  check(fu.length > 0 && fu.every((c) => c.perm === 'read-only'), '权限：主动回访（genProactive）用 read-only');

  // 超时：会话留着，不整轮重跑，回一句人设口吻的话；孙子进程也被杀掉
  const sid0 = P.sessions()[`u${OWNER}`]?.sessionId;
  got = await P.turn(() => P.priv('GRANDCHILD SLOW8000 帮我看个长视频'), (m) => FAIL_TIMEOUT.includes(m.text), 1500);
  check(got.some((m) => FAIL_TIMEOUT.includes(m.text)) && !got.some((m) => m.text.includes('[fake]')), '超时：回了一句人设口吻的“卡住了 再说一遍”，没有整轮重跑出别的回复');
  check(calls().filter((c) => c.kind === 'GRANDCHILD').length === 1, '超时：这一轮只跑了一次 dsh（不叠加重跑）');
  check(!!sid0 && P.sessions()[`u${OWNER}`]?.sessionId === sid0 && !/不可用，重开/.test(P.log()), '超时：会话没清，下一轮接着用');
  const pid = Number(fs.readFileSync(gpid, 'utf8'));
  let alive = true;
  for (let i = 0; i < 40 && alive; i++) {
    try {
      process.kill(pid, 0);
      await sleep(100);
    } catch {
      alive = false;
    }
  }
  check(!alive, '超时：dsh 开出来的子进程也一起杀掉了（整棵进程树）');
  got = await P.turn(() => P.priv('还在吗'), '收到: 还在吗');
  check(got.some((m) => m.text.includes(`会话 ${sid0}`)), '超时后下一句还是续的原来那个会话');

  // 会话真没了（dsh 报 session "…" not found）才丢掉重开
  got = await P.turn(() => P.priv('SESSIONGONE 在吗'), '收到: SESSIONGONE');
  const sid1 = P.sessions()[`u${OWNER}`]?.sessionId;
  check(sid1 && sid1 !== sid0 && /不可用，重开/.test(P.log()) && calls().filter((c) => c.kind === 'SESSIONGONE').length === 2, '会话找不到：丢掉旧会话重开一个，照常回了');
} catch (err) {
  check(false, `场景 P 完成（${err.message}）`);
} finally {
  P.stop();
}

// ── 场景 V：听 QQ 语音 ───────────────────────────────────────────────────────
const vdir = fs.mkdtempSync(path.join(TMP, 'voice-'));
const okWav = path.join(vdir, 'ok.amr.wav');
fs.writeFileSync(okWav, 'RIFFxxxxWAVE SAY:TINGDAO 明天一起吃饭\n');
const silentWav = path.join(vdir, 'silent.amr.wav');
fs.writeFileSync(silentWav, 'RIFFxxxxWAVE 只有底噪');
const V = await start(3962, {}, {
  onApi: (msg) => {
    if (msg.action === 'get_record') {
      if (msg.params.out_format !== 'wav') return { fail: true };
      if (msg.params.file === 'ok.amr') return { data: { file: okWav } };
      if (msg.params.file === 'silent.amr') return { data: { file: silentWav } };
      return { fail: true };
    }
    if (msg.action === 'get_file') return { fail: true };
  },
});
const rec = (file) => [{ type: 'record', data: { file, path: '', url: '', file_size: '1234' } }];
try {
  let got = await V.turn(() => V.priv(rec('ok.amr')), 'TINGDAO');
  check(got.some((m) => m.text.includes('发来语音：TINGDAO 明天一起吃饭')), '语音：取到 wav、本地识别，转成“（发来语音：…）”交给模型');
  check(V.calls.some((c) => c.action === 'get_record' && c.params.out_format === 'wav'), '语音：用 get_record 让 NapCat 转成 wav');
  got = await V.turn(() => V.priv(rec('silent.amr')), (m) => DEAF.includes(m.text));
  check(!got.some((m) => m.text.includes('[fake]')), '语音：没听出字，回一句“没听清 打字吧”，不去问模型');
  got = await V.turn(() => V.priv(rec('gone.amr')), (m) => DEAF.includes(m.text));
  check(V.calls.some((c) => c.action === 'get_file' && c.params.file === 'gone.amr'), '语音：get_record 取不到再试 get_file，都不行就让对方打字');
  await V.turn(() => V.group('在吗'), '收到: 在吗');
  got = await V.turn(() => V.group(rec('ok.amr'), OWNER, false), 'TINGDAO');
  check(got.some((m) => m.action === 'send_group_msg' && m.text.includes('发来语音：TINGDAO')), '语音：群里被叫到后接着发语音，也听');
  const n = V.sent().length;
  const nGet = V.calls.filter((c) => c.action === 'get_record').length;
  V.group(rec('ok.amr'), OTHER, false);
  await sleep(1500);
  check(V.sent().length === n && V.calls.filter((c) => c.action === 'get_record').length === nGet, '语音：群里没叫她的语音不听不回');
} catch (err) {
  check(false, `场景 V 完成（${err.message}）`);
} finally {
  V.stop();
}

// ── 场景 W：本地没有 Whisper 模型 ────────────────────────────────────────────
const W = await start(3963, { ASR_SCRIPT: '', WHISPER_MODEL_DIR: path.join(TMP, 'no-model') }, { onApi: (msg) => (msg.action === 'get_record' ? { data: { file: okWav } } : undefined) });
try {
  const got = await W.turn(() => W.priv(rec('ok.amr')), (m) => DEAF.includes(m.text));
  check(!W.calls.some((c) => c.action === 'get_record') && !got.some((m) => m.text.includes('[fake]')), '语音：没有本地模型就不听（不去网上下），直接让对方打字');
} catch (err) {
  check(false, `场景 W 完成（${err.message}）`);
} finally {
  W.stop();
}

// ── 场景 M：新标记（音乐控制、发图、画画）和几个办不成补一句 ─────────────────────────
const tmpM = fs.mkdtempSync(path.join(TMP, 'm-'));
const ctrlLog = path.join(tmpM, 'ctrl.log');
const snap = path.join(tmpM, 'pc.json');
fs.writeFileSync(snap, JSON.stringify({ idleMs: 3600_000, boot: new Date(Date.now() - 3600_000).toISOString(), w: [] }));
const search = path.join(tmpM, 'search.json');
const scene = path.join(tmpM, 'scene');
fs.mkdirSync(path.join(scene, 'bg'), { recursive: true }); // 有背景目录、没有动作图：照片拼不成
const fakeDraw = path.join(tmpM, 'draw.png');
fs.writeFileSync(fakeDraw, PNG1);
const M = await start(3964, {
  PLAY_MUSIC: 'true', MUSIC_CTRL_LOG: ctrlLog, PC_SNAPSHOT_FILE: snap, QQMUSIC_SEARCH_FILE: search, PLAY_MUSIC_MAX_DAY: '1',
  PHOTO: 'true', SCENE_DIR: scene,
  DASHSCOPE_API_KEY: 'test', DRAW_FAKE_FILE: fakeDraw, DRAW_MAX_DAY: '2',
  SPEAKER: 'true', VOICE: 'true', VOICE_ID: 'test-voice', DASHSCOPE_WS: 'ws://127.0.0.1:9', // 合成连不上：喇叭说不成
}, {
  seed: (data) => {
    fs.mkdirSync(path.join(data, 'shots'), { recursive: true });
    fs.writeFileSync(path.join(data, 'shots', 'shot-1.png'), PNG1);
    fs.writeFileSync(path.join(data, 'secret.png'), PNG1); // data 下但不在能发的文件夹里
  },
});
try {
  let got = await M.turn(() => M.priv('NAT_HINT 小声点 能截图给我看吗 帮我画张画'), 'NATHINT');
  let h = got.find((m) => m.text.includes('NATHINT')).text;
  check(h.includes('[会控音乐]') && h.includes('[会发图]') && h.includes('[会画]'), '提示词：主人私聊教了 [音乐:…]、[发图:…]、[画:…]（“小声点”也能对上音乐提示）');
  got = await M.turn(() => M.priv('NAT_HINT 放首歌 帮我画只猫', OTHER), 'NATHINT');
  h = got.find((m) => m.text.includes('NATHINT')).text;
  check(h.includes('[只放主人]') && h.includes('[不给画]') && !h.includes('[会控音乐]') && !h.includes('[会发图]') && !h.includes('[会画]'), '提示词：别人让放歌、画画时说只能放主人电脑上的 / 只给主人画，不教标记');

  // 音乐控制
  got = await M.turn(() => M.priv('NAT_MUSIC_PAUSE 别放了'), 'NATMUSIC');
  check(lines(ctrlLog).join() === '暂停' && !got.some((m) => LEAK.test(m.text)), '音乐：主人说“别放了”→ [音乐:暂停] 按了暂停，标记没漏');
  got = await M.turn(() => M.priv('NAT_MUSIC_NEXT 切歌', OTHER), (m) => m.text.includes('只能弄主人电脑上的'));
  check(lines(ctrlLog).length === 1, '音乐：不是主人写了 [音乐:…] 也不按，补一句只能弄主人电脑上的');
  got = await M.turn(() => M.group('NAT_MUSIC_NEXT 切歌'), (m) => m.text.includes('只能弄主人电脑上的'));
  check(lines(ctrlLog).length === 1 && !got.some((m) => LEAK.test(m.text)), '音乐：群里也不按');
  got = await M.turn(() => M.priv('NAT_MUSIC_NEXT 切一首'), 'NATMUSIC');
  check(lines(ctrlLog).join() === '暂停,下一首', '音乐：主人说切歌 → 下一首');

  // 发图
  const shot = path.join(M.data, 'shots', 'shot-1.png');
  got = await M.turn(() => M.priv(`NAT_SENDPIC ${shot}`), (m) => m.png);
  check(got.findIndex((m) => m.text.includes('NATSENDPIC')) < got.findIndex((m) => m.png) && !got.some((m) => LEAK.test(m.text)), '发图：主人私聊 [发图:data\\shots 里的图] → 先回那句再发图，标记没漏');
  got = await M.turn(() => M.priv(`NAT_SENDPIC ${path.join(M.data, 'shots')}\\..\\secret.png`), (m) => m.text.includes('发不了'));
  check(!got.some((m) => m.png), '发图：路径里 ..\\ 越界到别处的被拒，补一句发不了');
  got = await M.turn(() => M.priv(`NAT_SENDPIC ${path.join(M.data, 'secret.png')}`), (m) => m.text.includes('发不了'));
  check(!got.some((m) => m.png), '发图：不在 shots/live/scene 这些文件夹里的图不发');
  got = await M.turn(() => M.priv(`NAT_SENDPIC ${path.join(M.data, 'shots', 'nope.png')}`), (m) => m.text.includes('找不着'));
  check(!got.some((m) => m.png), '发图：没有的文件不发，说找不着');
  got = await M.turn(() => M.priv(`NAT_SENDPIC ${shot}`, OTHER), (m) => m.text.includes('只能私聊发给主人'));
  check(!got.some((m) => m.png), '发图：别人私聊写了也不发');

  // 画画：一天上限 2 张，第三张说画不动；别人不画
  for (let i = 1; i <= 2; i++) {
    got = await M.turn(() => M.priv(`NAT_DRAW 画只猫${i}`), (m) => m.png);
    check(got.some((m) => m.png) && !got.some((m) => LEAK.test(m.text)), `画画：主人让画 → 画好发过去（第 ${i} 张）`);
  }
  got = await M.turn(() => M.priv('NAT_DRAW 再画一张'), (m) => m.text.includes('手酸'));
  check(!got.some((m) => m.png), '画画：今天画到上限（DRAW_MAX_DAY）就不画了，补一句');
  got = await M.turn(() => M.priv('NAT_HINT 再画一张'), 'NATHINT');
  check(got.some((m) => m.text.includes('[画够了]') && !m.text.includes('[会画]')), '画画：到上限后提示词里说今天画不动了');
  got = await M.turn(() => M.priv('NAT_DRAW 也给我画一张', OTHER), (m) => m.text.includes('只给主人画'));
  check(!got.some((m) => m.png), '画画：不是主人不画');

  // 照片没拼成：她已经说了“在刷手机”，补一句
  got = await M.turn(() => M.priv('PHOTOME 在干嘛'), (m) => /照片没弄好|没拍好/.test(m.text));
  check(got.findIndex((m) => m.text.includes('在刷手机')) >= 0 && !got.some((m) => m.png), '照片：拼图失败补一句“诶 照片没弄好”');

  // 放歌：搜不了 → 补一句；搜到了发链接；今天放够了 → 补一句
  got = await M.turn(() => M.priv('PLAYSONG 放首歌'), (m) => /搜不了|搜不出来/.test(m.text));
  check(!got.some((m) => LEAK.test(m.text)), '放歌：搜歌出错补一句');
  fs.writeFileSync(search, JSON.stringify([{ id: 97773, mid: '0039MnYb0qxYhV', name: '晴天', singer: '周杰伦' }]));
  await M.turn(() => M.priv('PLAYSONG 再放'), (m) => m.text.includes('y.qq.com'));
  got = await M.turn(() => M.priv('PLAYSONG 再来一首'), (m) => /今天放/.test(m.text));
  check(!got.some((m) => m.text.includes('y.qq.com')), '放歌：今天放够了补一句，不再放');

  // 喇叭：合成失败补一句
  got = await M.turn(() => M.priv('NAT_SPEAK 用喇叭跟我说句晚安'), (m) => m.text.includes('喇叭那边'));
  check(!got.some((m) => LEAK.test(m.text)), '喇叭：合成失败（不拿系统语音顶）补一句没喊成');
} catch (err) {
  check(false, `场景 M 完成（${err.message}）`);
} finally {
  M.stop();
}

// ── 场景 N：办不成补一句（没有百炼 key、没开喇叭）─────────────────────────────────
const N = await start(3965, { FAKE_LETTER_DELAY: '3000', LETTER: 'true', MIMIC: 'true', JOURNAL: 'true', JOURNAL_CHECK_MS: '3600000', JOURNAL_HOUR: '24' });
try {
  let got = await N.turn(() => N.priv('NAT_REMIND_BAD 提醒我吃饭'), (m) => /没看明白|没整明白/.test(m.text));
  check(!got.some((m) => LEAK.test(m.text)), '提醒：时间看不懂补一句');
  got = await N.turn(() => N.priv('NAT_BDAY_BAD 我生日13月40号'), (m) => m.text.includes('没看懂'));
  check(true, '生日：看不懂补一句');
  got = await N.turn(() => N.priv('NAT_PICK 学第二个'), (m) => m.text.includes('聊天记录转给我'));
  check(true, '学说话：没有等着选人的转发，补一句');
  got = await N.turn(() => N.priv('NAT_DIARY 给我看看日记'), (m) => m.text.includes('还没写过日记'));
  check(true, '看日记：还没写过，补一句');
  got = await N.turn(() => N.group('NAT_LETTER 给我写封信'), (m) => m.text.includes('信私聊写'));
  check(true, '写信：群里写了 [写信]，补一句信私聊写');
  got = await N.turn(() => N.priv('NAT_FORGET 那条别记了'), (m) => m.text.includes('没找到'));
  check(true, '忘掉：没找到那条，补一句');
  got = await N.turn(() => N.priv('NAT_HINT 用喇叭跟我说句晚安'), 'NATHINT');
  check(got.some((m) => m.text.includes('[喇叭原因]') && !m.text.includes('[会喇叭]')), '喇叭：没开时提示词告诉她为啥说不了');
  got = await N.turn(() => N.priv('NAT_SPEAK 用喇叭跟我说句晚安'), (m) => m.text.includes('喇叭现在用不了'));
  check(!got.some((m) => LEAK.test(m.text)), '喇叭：没开写了标记也补一句');
  got = await N.turn(() => N.priv('NAT_HINT 给我画只猫'), 'NATHINT');
  check(got.some((m) => m.text.includes('[画不了]') && !m.text.includes('[会画]')), '画画：没有 DASHSCOPE key，提示词说画不了');
  got = await N.turn(() => N.priv('NAT_DRAW 画只猫'), (m) => m.text.includes('画不了'));
  check(!got.some((m) => m.png), '画画：没有 key 写了标记也补一句画不了');
  // 正在写信时又说写信：补一句“在写了 别催”
  const n = N.sent().length;
  N.priv('NAT_LETTER 给我写封信呗');
  await waitFor(() => N.sent().slice(n).some((m) => m.text.includes('NATLETTER')));
  N.priv('NAT_LETTER 再写一封');
  await waitFor(() => N.sent().slice(n).some((m) => m.text.includes('在写了')), 15_000);
  check(true, '写信：正在写的时候又写 [写信]，补一句在写了');
  await waitFor(() => N.calls.some((c) => c.params?.message?.some?.((s) => s.type === 'image')), 30_000).catch(() => {});
} catch (err) {
  check(false, `场景 N 完成（${err.message}）`);
} finally {
  N.stop();
}

// ── 场景 S：喇叭的次数、别人、夜里 ─────────────────────────────────────────────
const spk = path.join(TMP, 'spk.txt');
const voiceEnv = { SPEAKER: 'true', VOICE: 'true', VOICE_ID: 'test-voice', DASHSCOPE_API_KEY: 'test', DASHSCOPE_WS: 'ws://127.0.0.1:9', SPEAKER_LOG: spk, SPEAKER_ASK_MAX_DAY: '1' };
const S = await start(3966, voiceEnv);
try {
  await S.turn(() => S.priv('NAT_SPEAK 用喇叭跟我说句晚安'), 'NATSPEAK');
  await waitFor(() => lines(spk).length === 1, 5000);
  let got = await S.turn(() => S.priv('NAT_HINT 再用喇叭喊一句'), 'NATHINT');
  check(!got.some((m) => m.text.includes('[会喇叭]')), '喇叭：今天的次数用完了，提示词不再教标记');
  got = await S.turn(() => S.priv('NAT_SPEAK 再喊一句'), (m) => m.text.includes('喊太多了'));
  check(lines(spk).length === 1, '喇叭：次数用完写了也不喊，补一句');
  got = await S.turn(() => S.priv('NAT_SPEAK 你也喊一句', OTHER), (m) => m.text.includes('只听主人'));
  check(lines(spk).length === 1, '喇叭：不是主人不喊，补一句');
} catch (err) {
  check(false, `场景 S 完成（${err.message}）`);
} finally {
  S.stop();
}
const S2 = await start(3967, { ...voiceEnv, SPEAKER_LOG: path.join(TMP, 'spk2.txt'), QUIET_HOURS: '0-24' });
try {
  await S2.turn(() => S2.priv('NAT_SPEAK 用喇叭跟我说句晚安'), (m) => m.text.includes('不出声'));
  check(lines(path.join(TMP, 'spk2.txt')).length === 0, '喇叭：夜里不喊，补一句明天再喊');
} catch (err) {
  check(false, `场景 S2 完成（${err.message}）`);
} finally {
  S2.stop();
}

console.log(`\n${passed} PASS${failed ? '，有失败' : ''}`);
if (failed) console.log(`临时目录留着排错：${TMP}`);
setTimeout(() => {
  try {
    if (!failed) fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    /* Windows 上子进程还没完全退出时删不掉临时目录，留着也没关系 */
  }
  process.exit(failed ? 1 : 0);
}, 500);
