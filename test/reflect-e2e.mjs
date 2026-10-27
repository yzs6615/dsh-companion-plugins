#!/usr/bin/env node
/**
 * 人设成长测试：给一份假的自主活动日记 + 旧的自我设定，启动 bridge，
 * 看它会不会反思出新的“最近的自己”、加深被印证的、淡忘太久没印证的，以及之后聊天会带上。
 * mock OneBot <-> bridge.mjs <-> fake dsh，临时数据目录，不花钱。
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

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-reflect-'));
const now = Date.now();
const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
fs.writeFileSync(
  path.join(data, 'state.json'),
  JSON.stringify({
    _closenessSeeded: 1,
    _self: {
      log: [
        { day: day(new Date()), time: '10:00', at: now - 3 * 3600e3, text: '刷B站看了个修猫爬架的视频，UP主嘴特贫' },
        { day: day(new Date()), time: '14:00', at: now - 2 * 3600e3, text: '又刷了会儿B站，弹幕都在刷『典』', shared: '这弹幕笑死' },
      ],
    },
  }),
);
fs.writeFileSync(
  path.join(data, 'self-profile.json'),
  JSON.stringify({
    items: [
      { kind: '习惯', t: '无聊就刷B站', at: now - 3 * 86400e3, lastSeen: now - 3 * 86400e3, seen: 1 },
      { kind: '喜好', t: '以前爱看的东西', at: now - 30 * 86400e3, lastSeen: now - 30 * 86400e3, seen: 1 }, // 太久没印证，该淡忘
      { kind: '最近在看', t: '一部老番', at: now - 6 * 86400e3, lastSeen: now - 6 * 86400e3, seen: 1 }, // “最近在看” 5 天就忘
    ],
    lastReflectAt: now - 86400e3,
    lastReflectDay: '',
  }),
);

const replies = [];
let socket;
const wss = new WebSocketServer({ port: 3992 });
wss.on('connection', (ws) => {
  socket = ws;
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.action === 'send_private_msg') replies.push(msg.params.message.filter((x) => x.type === 'text').map((x) => x.data.text).join(''));
    ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: replies.length }, echo: msg.echo }));
  });
  ws.send(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'lifecycle', self_id: BOT, time: Date.now() / 1000 }));
});
const bridge = spawn(process.execPath, [path.join(ROOT, 'bridge.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env,
    ONEBOT_WS: 'ws://127.0.0.1:3992',
    ALLOWED_QQ: String(OWNER),
    ALLOWED_GROUPS: '',
    DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'),
    DSH_HOME: path.join(data, 'dsh-home'),
    BRIDGE_DATA: data,
    AGENT_CWD: ROOT,
    DEEPSEEK_API_KEY: 'test',
    PHONE_MONITOR: 'false',
    AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false',
    PROACTIVE: 'false',
    FACTS: 'false',
    MERGE_MS: '200',
    TYPING_MS_PER_CHAR: '0',
    TYPO_PROB: '0',
    SLEEP_DELAY_PROB: '0',
    REACT: 'false',
    CLOSENESS_SET: '',
    REFLECT: 'true',
    REFLECT_HOUR: '0',
    REFLECT_CHECK_MS: '300',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const profile = () => JSON.parse(fs.readFileSync(path.join(data, 'self-profile.json'), 'utf8'));
try {
  await waitFor(() => profile().lastReflectDay === day(new Date()), 15_000);
  const items = profile().items;
  const has = (t) => items.some((i) => i.t === t);
  check(has('爱看修东西的视频') && has('最近老想说『典』'), '反思出了新的喜好和梗');
  check(!items.some((i) => i.kind === '乱写'), '不认识的类别不收');
  check(!has('我是个AI模型'), '带“AI/模型”这类出戏词的不收');
  check(items.find((i) => i.t === '无聊就刷B站')?.seen === 2, '被再次印证的认识会加深（seen 1 -> 2）');
  check(!has('以前爱看的东西'), '30 天没再印证的喜好淡忘了');
  check(!has('一部老番'), '“最近在看”超过 5 天就忘');

  // 同一天不会再反思一次（日记里也没有新经历了）
  const stamp = profile().lastReflectAt;
  await sleep(1500);
  check(profile().lastReflectAt === stamp, '同一天、没有新经历时不会重复反思');

  // 之后聊天会带上“最近的你”
  await waitFor(() => socket && socket.readyState === 1);
  socket.send(
    JSON.stringify({
      post_type: 'message', message_type: 'private', self_id: BOT, user_id: OWNER, message_id: 1, time: Math.floor(Date.now() / 1000),
      message: [{ type: 'text', data: { text: '你最近在干嘛' } }], sender: { user_id: OWNER, nickname: 'owner' },
    }),
  );
  await waitFor(() => replies.some((r) => r.includes('你最近在干嘛')));
  check(replies.find((r) => r.includes('你最近在干嘛')).includes('[有自我]'), '聊天的提示词里带上了“最近的你”');
  const logText = fs.readFileSync(path.join(data, 'bridge.log'), 'utf8');
  check(/反思完成：新认识 2 条，又印证 1 条/.test(logText), '日志里有反思结果（只有条数）');
} catch (err) {
  check(false, `出错：${err.message}`);
} finally {
  bridge.kill();
  wss.close();
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  setTimeout(() => process.exit(failed ? 1 : 0), 200);
}
