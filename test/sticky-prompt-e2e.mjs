#!/usr/bin/env node
/**
 * 同一段会话里不重复塞没变的提示词块：mock OneBot <-> bridge.mjs <-> fake dsh（FAKE_ALL_PROMPTS 存每次的提示词、FAKE_USAGE 报用量），
 * 临时数据目录，不花钱、不联网。
 * 覆盖：新会话整个发（人设、记得的事、记着的几句、日记、翻旧聊天、能办的事）；同一段会话第二轮只发变了的（【此刻】、对方的话、规矩每轮都有）；
 * 人设改了只补人设；记得的事变了只补那块；过了 FULL_PROMPT_EVERY 轮整个重发；会话被压缩过（上下文少了一大截）下一轮整个重发；
 * 会话没了重开时整个发；翻旧聊天只给主人私聊；STICKY_PROMPT=false 每轮都全发。
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-sticky-'));

async function start(port, extraEnv = {}) {
  const data = fs.mkdtempSync(path.join(TMP, 'data-'));
  fs.mkdirSync(path.join(data, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(data, 'memory', `u${OWNER}.facts.json`), JSON.stringify({ facts: [{ t: '对方养了一只猫叫团子', at: 1 }], followups: [], style: [] }));
  fs.writeFileSync(path.join(data, 'memory', `u${OWNER}.md`), '- 对方：RECENTLINE 昨天说的话\n- 你：嗯\n');
  fs.mkdirSync(path.join(data, 'journal', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(data, 'journal', '2026-10-01.json'), JSON.stringify({ day: 'DIARYLINE 刷了一天B站', with: {}, at: 1 }));
  const personaFile = path.join(data, 'persona.md');
  fs.writeFileSync(personaFile, '# 测试\n\nPERSONA_V1 你是测试用的人设。\n');
  const prompts = path.join(data, 'prompts.jsonl');
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
      ALLOWED_QQ: `${OWNER},${OTHER}`, ALLOWED_GROUPS: '', PROACTIVE_QQ: String(OWNER), PC_OWNER: String(OWNER),
      DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'), DSH_HOME: path.join(data, 'dsh-home'), DSH_PERMISSION_MODE: 'danger-full-access',
      BRIDGE_DATA: data, STICKER_DIR: path.join(data, 'stickers'), AGENT_CWD: ROOT, DEEPSEEK_API_KEY: 'test', DASHSCOPE_API_KEY: '',
      PERSONA_FILE: personaFile, FAKE_ALL_PROMPTS: prompts, FAKE_USAGE: path.join(data, 'usage'),
      FULL_PROMPT_EVERY: '4', FACTS: 'true', FACTS_EVERY: '999', LEARN_STYLE: 'false', JOURNAL: 'true', JOURNAL_CHECK_MS: '99999999',
      PHONE_MONITOR: 'false', ACK_PRIVATE: 'false',
      AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false',
      PROACTIVE: 'false', GREETINGS: 'false', REFLECT: 'false', VOICE: 'false', RADIO: 'false', MIMIC: 'false', WEATHER: 'false',
      CURIOUS: 'false', RHYTHM: 'false', POKE_SELF: 'false', CHASE: 'false', CHIME_PROB: '0', REACT: 'false', CLOSENESS_SET: '', ONLINE_STATUS: 'false', LONGNICK: 'false', MOOD_AVATAR: 'false', ANNIVERSARY: 'false',
      MERGE_MS: '200', TYPING_MS_PER_CHAR: '0', TYPO_PROB: '0', SLEEP_DELAY_PROB: '0', SLEEP_START: '0', SLEEP_END: '0', QUIET_HOURS: '0-0',
      HEAR_VOICE: 'false', DRAW: 'false', SHARE_CARDS: 'false',
      ...extraEnv,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitFor(() => socket && socket.readyState === 1);
  await sleep(300);
  let id = 1000;
  const allPrompts = () => (fs.existsSync(prompts) ? fs.readFileSync(prompts, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return {
    data,
    personaFile,
    log: () => fs.readFileSync(path.join(data, 'bridge.log'), 'utf8'),
    /** 发一句，等回复，返回这一轮塞给模型的提示词（有补话 / 重开的话是最后一个带这句话的）。 */
    async say(text, user = OWNER) {
      const n = calls.filter((c) => c.action === 'send_private_msg').length;
      socket.send(JSON.stringify({
        post_type: 'message', message_type: 'private', self_id: BOT, user_id: user, message_id: ++id, time: Math.floor(Date.now() / 1000),
        message: [{ type: 'text', data: { text } }], sender: { user_id: user, nickname: `u${user}` },
      }));
      await waitFor(() => calls.filter((c) => c.action === 'send_private_msg').length > n);
      await sleep(200);
      return allPrompts().filter((p) => p.includes(`对方刚说：\n${text}`)).pop() || '';
    },
    stop() {
      bridge.kill();
      wss.close();
    },
  };
}

const NATURAL = '下面这些事对方用大白话说就能办';
const GUARD = '想出声只能用你自己的声音';
const OLDCHATS = '想不起来以前跟对方聊过的事';
const A = await start(39841);
try {
  const p1 = await A.say('第一句');
  check(p1.includes('PERSONA_V1') && p1.includes('团子') && p1.includes('RECENTLINE') && p1.includes('DIARYLINE'), '新会话：人设、记得的事、记着的几句、日记都发');
  check(p1.includes(NATURAL) && p1.includes(OLDCHATS) && p1.includes(GUARD) && p1.includes('【此刻】'), '新会话：能办的事、翻旧聊天、规矩、此刻都有');

  const p2 = await A.say('第二句');
  check(!p2.includes('PERSONA_V1') && !p2.includes('团子') && !p2.includes('RECENTLINE') && !p2.includes('DIARYLINE'), '同一段会话第二轮：人设、记得的事、记着的几句、日记都不重复塞');
  check(!p2.includes(NATURAL) && !p2.includes(OLDCHATS), '第二轮：能办的事、翻旧聊天也不重复');
  check(p2.includes('【此刻】') && p2.includes(GUARD) && p2.includes('最后都用 1-2 句话回对方'), '第二轮：此刻、规矩、“最后回一句”每轮都有');
  check(p2.includes('只能设一次性的'), '第二轮：“[提醒] 只能设一次、别自己建定时任务”这条规矩也每轮都有');
  check(p2.length < p1.length * 0.5, `第二轮短多了（${p1.length} → ${p2.length} 字）`);

  fs.writeFileSync(A.personaFile, '# 测试\n\nPERSONA_V2 人设改过了。\n');
  await sleep(50);
  const p3 = await A.say('第三句');
  check(p3.includes('PERSONA_V2') && !p3.includes('团子') && !p3.includes('DIARYLINE'), '人设改了：只补人设，别的照旧不塞');

  fs.writeFileSync(path.join(A.data, 'memory', `u${OWNER}.facts.json`), JSON.stringify({ facts: [{ t: '对方养了一只猫叫团子', at: 1 }, { t: '对方下周要考六级', at: 2 }], followups: [], style: [] }));
  const p4 = await A.say('第四句');
  check(p4.includes('下周要考六级') && p4.includes('团子') && !p4.includes('PERSONA_V2'), '记得的事变了：整块补上，人设不再塞');

  const p5 = await A.say('第五句');
  check(p5.includes('PERSONA_V2') && p5.includes('RECENTLINE') && p5.includes('DIARYLINE'), '过了 FULL_PROMPT_EVERY 轮：整个重发一遍');

  const p6 = await A.say('第六句');
  check(!p6.includes('PERSONA_V2'), '重发完又只塞变了的');

  await A.say('这句 COMPACTED');
  check(/被压缩过/.test(A.log()), '上下文少了一大截：日志记了会话被压缩');
  const p8 = await A.say('压缩之后');
  // 记着的几句只留最近 12 行，RECENTLINE 早滚出去了：看那一段在不在
  check(p8.includes('PERSONA_V2') && p8.includes('团子') && p8.includes('你之前和这个人聊过'), '会话被压缩过：下一轮整个重发');

  const p9 = await A.say('SESSIONGONE 会话没了');
  check(p9.includes('PERSONA_V2') && p9.includes('团子'), '会话没了重开：新会话里整个发');

  const q1 = await A.say('别人第一句', OTHER);
  check(q1.includes('PERSONA_V2') && !q1.includes(OLDCHATS), '别人私聊：新会话也整个发，但不给翻旧聊天（流水里有主人的私聊）');
  const q2 = await A.say('别人第二句', OTHER);
  check(!q2.includes('PERSONA_V2') && q2.includes(GUARD), '别人私聊第二轮：也只塞变了的，规矩照样每轮有');
} finally {
  A.stop();
}

// 时有时无的块（这里拿“对方要送你东西”的提示）：出现过、中间没了、再出现时字一模一样，也得照样塞
const C = await start(39843, { PHOTO: 'true', FULL_PROMPT_EVERY: '50' });
try {
  const GIFT = '对方要送你东西';
  await C.say('第一句');
  const c2 = await C.say('送你个小熊');
  const c3 = await C.say('随便聊聊');
  const c4 = await C.say('送你个小熊');
  check(c2.includes(GIFT) && !c3.includes(GIFT) && c4.includes(GIFT), '时有时无的提示：中间没了、再出现时（字一样）照样塞');
} finally {
  C.stop();
}

const B = await start(39842, { STICKY_PROMPT: 'false' });
try {
  await B.say('第一句');
  const p2 = await B.say('第二句');
  check(p2.includes('PERSONA_V1') && p2.includes('团子') && p2.includes('RECENTLINE'), 'STICKY_PROMPT=false：每轮都全发（跟以前一样）');
} finally {
  B.stop();
}

console.log(`\n${failed ? 'FAILED' : 'ALL PASS'}（${passed} 项通过）`);
process.exit(failed ? 1 : 0);
