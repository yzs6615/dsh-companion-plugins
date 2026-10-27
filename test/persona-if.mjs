#!/usr/bin/env node
/**
 * 人设里的条件段 <!-- if:名字 --> … <!-- end -->：
 *   1. human.mjs 的 expandPersona 单测（嵌套、没配对的标记、CRLF）；
 *   2. 起内核（假 QQ + 假 dsh），看进模型的提示词：
 *      a. 全部插件 + 自己写的 persona.md：开着的功能留下、关着的和不认识的名字整段删掉，标记一个都不剩；
 *      b. 只有本体（COMPANION_ONLY=none）+ 默认人设：表情包、语音、唱歌那几段都没有（插件没装，cfg 上是 undefined，当关）。
 */
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { expandPersona } from '../packages/core/kernel/human.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3979;
const OWNER = 10001;

let failed = false;
const check = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed = true;
};

// ── 1. 单测 ──
{
  const on = (n) => ['a', 'b'].includes(n);
  check(expandPersona('一\n<!-- if:a -->\n留下\n<!-- end -->\n二', on) === '一\n留下\n二', '开着的段留下，标记去掉');
  check(expandPersona('一\n\n<!-- if:x -->\n删掉\n<!-- end -->\n\n二', on) === '一\n\n二', '关着的段整段删掉，空行并成一个');
  check(
    expandPersona('<!-- if:a -->\nA\n<!-- if:x -->\nX\n<!-- end -->\nA2\n<!-- end -->\n<!-- if:x -->\nY\n<!-- if:b -->\nB\n<!-- end -->\n<!-- end -->\n尾', on) === 'A\nA2\n尾',
    '嵌套：外层开里层关、外层关里层开',
  );
  check(expandPersona('一\r\n<!-- if:x -->\r\n删\r\n<!-- end -->\r\n二', on) === '一\r\n二', 'CRLF 也认');
  check(expandPersona('一\n<!--if:a-->\n留\n<!--  end  -->\n二', on) === '一\n留\n二', '标记里空格多少都认');
  check(expandPersona('一\n<!-- if:a -->\n没配对\n<!-- end -->\n<!-- end -->\n二', on) === '一\n没配对\n二', '多出来的 end 标记删掉');
  check(expandPersona('一\n<!-- 普通注释 -->\n\n\n\n二', on) === '一\n<!-- 普通注释 -->\n\n\n\n二', '没有条件标记的人设原样不动');
  const def = fs.readFileSync(path.join(ROOT, 'packages', 'core', 'kernel', 'persona.default.md'), 'utf8');
  const all = expandPersona(def, () => true);
  check(/## 表情包/.test(all) && /## 语音/.test(all) && /## 唱歌/.test(all) && !/<!--\s*(if:|end)/.test(all), '默认人设全开：三段都在、没有标记');
}

// ── 2. 起内核看提示词 ──
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-if-'));
const MY_PERSONA = path.join(DATA, 'persona.md');
fs.writeFileSync(
  MY_PERSONA,
  [
    '你是{{NAME}}，测试用的人设。',
    '<!-- if:sing -->',
    'SING_ON 会唱歌',
    '<!-- if:voice -->',
    'VOICE_IN_SING 又会说话',
    '<!-- end -->',
    '<!-- end -->',
    '',
    '<!-- if:voice -->',
    'VOICE_ON 会发语音',
    '<!-- end -->',
    '',
    '<!-- if:stickers -->',
    'STICKERS_ON 会发表情包',
    '<!-- end -->',
    '',
    '<!-- if:nosuchthing -->',
    'UNKNOWN_ON 不认识的名字',
    '<!-- end -->',
    'TAIL 结尾',
  ].join('\r\n'),
);

function waitFor(fn, timeout = 30_000) {
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
    }, 100);
  });
}

/** 起一次内核，发一句话，拿回进模型的第一条提示词。 */
async function promptOf(name, extraEnv) {
  const log = path.join(DATA, `${name}-prompts.jsonl`);
  const data = path.join(DATA, name);
  fs.mkdirSync(data, { recursive: true });
  const replies = [];
  const wss = new WebSocketServer({ port: PORT });
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.action === 'send_private_msg' || msg.action === 'send_group_msg') {
        replies.push(msg);
        ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: replies.length }, echo: msg.echo }));
      }
    });
    ws.send(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'lifecycle', self_id: 99999, time: Date.now() / 1000 }));
    setTimeout(() => {
      ws.send(JSON.stringify({
        post_type: 'message', message_type: 'private', sub_type: 'friend', self_id: 99999, user_id: OWNER, message_id: 1,
        time: Math.floor(Date.now() / 1000), message: [{ type: 'text', data: { text: '你好' } }], sender: { user_id: OWNER, nickname: 'owner' },
      }));
    }, 600);
  });
  const bridge = spawn(process.execPath, [path.join(ROOT, 'bridge.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      ONEBOT_WS: `ws://127.0.0.1:${PORT}`,
      ALLOWED_QQ: String(OWNER),
      ALLOWED_GROUPS: '',
      DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'),
      DSH_HOME: path.join(data, 'test-home'),
      BRIDGE_DATA: data,
      FAKE_PROMPT_LOG: log,
      BOT_NAME: '测试名',
      MERGE_MS: '300', TYPING_MS_PER_CHAR: '0', TYPO_PROB: '0', CHIME_PROB: '0', FACTS: 'false', SLEEP_DELAY_PROB: '0',
      AGENT_CWD: ROOT, ACK_PRIVATE: 'false', PROACTIVE: 'false',
      AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false',
      DEEPSEEK_API_KEY: 'test',
      ...extraEnv,
    },
    stdio: 'inherit',
  });
  try {
    await waitFor(() => fs.existsSync(log) && fs.readFileSync(log, 'utf8').trim(), 40_000);
    return JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n')[0]);
  } finally {
    bridge.kill();
    await new Promise((r) => bridge.once('exit', r));
    await new Promise((r) => wss.close(r));
  }
}

try {
  // a. 全部插件：唱歌开着（SING 默认开）、语音关着（没有 VOICE_ID）、收表情包关着（STEAL_STICKERS=false）
  const p = await promptOf('all', { PERSONA_FILE: MY_PERSONA, SING: 'true', VOICE: 'true', VOICE_ID: '', STEAL_STICKERS: 'false' });
  check(p.includes('你是测试名'), '自己写的人设进了提示词（名字换好了）');
  check(p.includes('SING_ON'), '自己写的人设：唱歌开着，那段留下');
  check(!p.includes('VOICE_IN_SING') && !p.includes('VOICE_ON'), '自己写的人设：语音关着，两段（含嵌在唱歌里的）都删掉');
  check(!p.includes('STICKERS_ON'), '自己写的人设：if:stickers 跟着 STEAL_STICKERS，关着就删掉');
  check(!p.includes('UNKNOWN_ON'), '自己写的人设：不认识的名字当关');
  check(p.includes('TAIL'), '条件段后面的字照旧在');
  check(!/<!--\s*(if:|end)/.test(p), '提示词里一个条件标记都不剩（全部插件）');

  // b. 只有本体：默认人设里表情包、语音、唱歌都当关
  const q = await promptOf('core', { COMPANION_ONLY: 'none', PERSONA_FILE: path.join(DATA, 'no-such-persona.md') });
  check(q.includes('测试名') && !q.includes('{{NAME}}'), '只有本体：用的默认人设，名字换好了');
  check(!/## 表情包/.test(q) && !/## 语音/.test(q) && !/## 唱歌/.test(q), '只有本体：默认人设里表情包、语音、唱歌三段都删掉');
  check(q.includes('[QQ表情:斜眼笑]'), '只有本体：条件段外面紧挨着的那句（对方发的 QQ 表情）还在');
  check(!/<!--\s*(if:|end)/.test(q), '提示词里一个条件标记都不剩（只有本体）');
} catch (err) {
  console.error('persona-if error:', err.message);
  failed = true;
} finally {
  fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
}
