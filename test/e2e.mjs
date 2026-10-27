#!/usr/bin/env node
/**
 * End-to-end test without a QQ account:
 *   mock OneBot 11 WS server  <->  bridge.mjs  <->  fake dsh CLI
 * Verifies whitelist, reply routing, and session continuation.
 */
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3999;
const OWNER = 10001;
const OTHER = 20002;

const replies = [];
const apiCalls = [];
let bridge;
// 用临时数据目录，别碰真实的 sessions / memory / state。
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-e2e-'));

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

function client(ws, ev) {
  ws.send(JSON.stringify(ev));
}
function message(id, user, text, extra = {}) {
  return {
    post_type: 'message',
    message_type: 'private',
    sub_type: 'friend',
    self_id: 99999,
    user_id: user,
    message_id: id,
    time: Math.floor(Date.now() / 1000),
    message: [{ type: 'text', data: { text } }],
    sender: { user_id: user, nickname: `user${user}` },
    ...extra,
  };
}

const wss = new WebSocketServer({ port: PORT });
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.action === 'send_private_msg' || msg.action === 'send_group_msg') {
      apiCalls.push(msg);
      const text = (msg.params.message || []).map((s) => s.data?.text || '').join('');
      replies.push({ to: msg.params.user_id || msg.params.group_id, text });
      ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: replies.length }, echo: msg.echo }));
    }
  });
  client(ws, { post_type: 'meta_event', meta_event_type: 'lifecycle', self_id: 99999, time: Date.now() / 1000 });
  setTimeout(() => {
    client(ws, message(1, OWNER, '你好'));
    client(ws, message(2, OTHER, '我是陌生人'));
  }, 600);
  setTimeout(() => client(ws, message(3, OWNER, '第二句')), 6000);
});

bridge = spawn(process.execPath, [path.join(ROOT, 'bridge.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env,
    ONEBOT_WS: `ws://127.0.0.1:${PORT}`,
    ALLOWED_QQ: String(OWNER),
    ALLOWED_GROUPS: '',
    DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'),
    DSH_HOME: path.join(DATA, 'test-home'),
    BRIDGE_DATA: DATA,
    MERGE_MS: '300',
    TYPING_MS_PER_CHAR: '0',
    TYPO_PROB: '0',
    CHIME_PROB: '0',
    FACTS: 'false',
    SLEEP_DELAY_PROB: '0',
    AGENT_CWD: ROOT,
    ACK_PRIVATE: 'false',
    PROACTIVE: 'false',
    AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false',
    DEEPSEEK_API_KEY: 'test',
  },
  stdio: 'inherit',
});

let failed = false;
const check = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed = true;
};

try {
  await waitFor(() => replies.length >= 2, 40_000);
  const r1 = replies.find((r) => r.text.includes('你好'));
  const r2 = replies.find((r) => r.text.includes('第二句'));
  const stranger = replies.find((r) => r.text.includes('陌生人'));

  check(!!r1, 'owner message answered');
  check(!stranger, 'stranger ignored');
  check(apiCalls.every((c) => c.action !== 'send_private_msg' || String(c.params.user_id) === String(OWNER)), 'no reply to stranger');
  check(!!r2, 'follow-up answered');
  const sid1 = r1?.text.match(/会话 (session-[^)]+)/)?.[1];
  const sid2 = r2?.text.match(/会话 (session-[^)]+)/)?.[1];
  check(!!sid1 && sid1 === sid2, `session continued (${sid1} == ${sid2})`);
} catch (err) {
  console.error('E2E error:', err.message);
  failed = true;
} finally {
  bridge?.kill();
  wss.close();
  fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
}
