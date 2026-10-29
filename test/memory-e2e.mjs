#!/usr/bin/env node
/**
 * 长期记忆不再先进先出：mock OneBot <-> bridge.mjs <-> fake dsh，临时数据目录，不花钱、不联网。
 * 覆盖：聊天时记得的事全带上（最早那条也在）；快满时提炼提示词让模型合并；超过上限先丢最早的小事，
 * 称呼这种要紧的就算最早也留着；没满时不提“快满了”。
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-memory-'));

async function start(port, facts) {
  const data = fs.mkdtempSync(path.join(TMP, 'data-'));
  fs.mkdirSync(path.join(data, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(data, 'memory', `u${OWNER}.facts.json`), JSON.stringify({ facts, followups: [], style: [] }));
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
      ALLOWED_QQ: String(OWNER), ALLOWED_GROUPS: '', PROACTIVE_QQ: String(OWNER), PC_OWNER: '',
      DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'), DSH_HOME: path.join(data, 'dsh-home'), DSH_PERMISSION_MODE: 'danger-full-access',
      BRIDGE_DATA: data, STICKER_DIR: path.join(data, 'stickers'), AGENT_CWD: ROOT, DEEPSEEK_API_KEY: 'test', DASHSCOPE_API_KEY: '',
      FAKE_ALL_PROMPTS: prompts,
      FACTS: 'true', FACTS_EVERY: '1', LEARN_STYLE: 'false',
      PHONE_MONITOR: 'false', ACK_PRIVATE: 'false',
      AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false',
      PROACTIVE: 'false', GREETINGS: 'false', REFLECT: 'false', VOICE: 'false', RADIO: 'false', MIMIC: 'false', WEATHER: 'false', JOURNAL: 'false',
      CURIOUS: 'false', RHYTHM: 'false', POKE_SELF: 'false', CHASE: 'false', CHIME_PROB: '0', REACT: 'false', CLOSENESS_SET: '', ONLINE_STATUS: 'false', LONGNICK: 'false', MOOD_AVATAR: 'false', ANNIVERSARY: 'false',
      MERGE_MS: '200', TYPING_MS_PER_CHAR: '0', TYPO_PROB: '0', SLEEP_DELAY_PROB: '0', SLEEP_START: '0', SLEEP_END: '0', QUIET_HOURS: '0-0',
      HEAR_VOICE: 'false', DRAW: 'false', SHARE_CARDS: 'false',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitFor(() => socket && socket.readyState === 1);
  await sleep(300);
  let id = 1000;
  const factsNow = () => JSON.parse(fs.readFileSync(path.join(data, 'memory', `u${OWNER}.facts.json`), 'utf8')).facts.map((f) => f.t);
  const allPrompts = () => (fs.existsSync(prompts) ? fs.readFileSync(prompts, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return {
    factsNow,
    allPrompts,
    async say(text) {
      const n = calls.filter((c) => c.action === 'send_private_msg').length;
      socket.send(JSON.stringify({
        post_type: 'message', message_type: 'private', self_id: BOT, user_id: OWNER, message_id: ++id, time: Math.floor(Date.now() / 1000),
        message: [{ type: 'text', data: { text } }], sender: { user_id: OWNER, nickname: 'owner' },
      }));
      await waitFor(() => calls.filter((c) => c.action === 'send_private_msg').length > n);
    },
    stop() {
      bridge.kill();
      wss.close();
    },
  };
}

// 满的：最早一条是称呼（要紧），然后 299 条小事，再提炼会加一条“喜欢吃辣” → 301 条，超了
const full = [{ t: '对方让我叫他小明', at: 1 }, ...Array.from({ length: 299 }, (_, i) => ({ t: `小事${String(i + 1).padStart(3, '0')}`, at: i + 2 }))];
const A = await start(39821, full);
try {
  await A.say('在吗');
  const chat = A.allPrompts().find((p) => p.includes('你记得关于这个人的事'));
  check(!!chat && chat.includes('对方让我叫他小明') && chat.includes('小事001') && chat.includes('小事299'), '聊天时 300 条全带上（最早那条也在，以前只带最新 20 条）');
  await waitFor(() => A.factsNow().includes('喜欢吃辣'));
  const ext = A.allPrompts().find((p) => p.includes('整理自己对一个朋友的长期记忆'));
  check(!!ext && ext.includes('快满了') && ext.includes('合成一条'), '快满时：提炼提示词让模型把同一件事合成一条');
  const now = A.factsNow();
  check(now.length === 300, `超过上限修回 300 条（现在 ${now.length}）`);
  check(now[0] === '对方让我叫他小明', '称呼这种要紧的，就算最早也没被丢');
  check(!now.includes('小事001') && now.includes('小事002'), '丢的是最早的那条小事');
} finally {
  A.stop();
}

const B = await start(39822, [{ t: '对方养了一只猫', at: 1 }, { t: '对方在杭州上班', at: 2 }]);
try {
  await B.say('在吗');
  await waitFor(() => B.factsNow().includes('喜欢吃辣'));
  const ext = B.allPrompts().find((p) => p.includes('整理自己对一个朋友的长期记忆'));
  check(!!ext && !ext.includes('快满了'), '没满时：不提“快满了”');
  check(B.factsNow().length === 3, '没满时：一条不丢');
} finally {
  B.stop();
}

console.log(`\n${failed ? 'FAILED' : 'ALL PASS'}（${passed} 项通过）`);
process.exit(failed ? 1 : 0);
