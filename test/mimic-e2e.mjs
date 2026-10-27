#!/usr/bin/env node
/**
 * 学说话（合并转发）测试：mock OneBot <-> bridge.mjs <-> fake dsh，临时数据目录，不花钱。
 * 覆盖：列出转发里的人、按序号选人、只拿那个人的话、嵌套转发、get_forward_msg 兜底、
 * 带着的内容不全时去取完整的（不卡在 59 条）、图片/表情不算条数、连着转几段合在一起、
 * “第一个”“学”这种说法也认、选人时问这段聊天能看到内容、“算了”、学到后带进提示词、/学说话、/别学了 删素材。
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

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-mimic-'));
fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ _closenessSeeded: 1 }));
const node = (uid, nickname, text) => ({ sender: { user_id: uid, nickname }, message: [{ type: 'text', data: { text } }], time: 1 });
const img = (uid, nickname) => ({ sender: { user_id: uid, nickname }, message: [{ type: 'image', data: { file: 'x.png' } }], time: 1 });
const content = [
  node(OWNER, '阿青', 'ASHENG_LINE 一'),
  node(30003, '小明', 'XM 今天绝了'),
  node(30003, '小明', 'XM 吃了没捏'),
  node(OWNER, '阿青', 'ASHENG_LINE 二'),
  node(30003, '小明', 'XM 6'),
  // 嵌套的合并转发
  { sender: { user_id: 30003, nickname: '小明' }, message: [{ type: 'forward', data: { id: 'inner', content: [node(30003, '小明', 'XM 套娃里的一句'), node(40004, '路人', '路人说的')] } }] },
];
// get_forward_msg 按 id 返回
const big = [...Array.from({ length: 120 }, (_, i) => node(60006, '小红', `XH 第${i + 1}句`)), img(60006, '小红'), img(60006, '小红')];
const forwards = {
  'only-id': [node(50005, '老王', '老王的话一'), node(50005, '老王', '老王的话二')],
  big,
  part2: [node(60006, '小红', 'XH 第二段的话'), node(60006, '小红', 'XH 第1句')],
};

const replies = [];
const calls = [];
let socket;
let id = 100;
const wss = new WebSocketServer({ port: 3991 });
wss.on('connection', (ws) => {
  socket = ws;
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    calls.push(msg);
    if (msg.action === 'send_private_msg') replies.push(msg.params.message.filter((x) => x.type === 'text').map((x) => x.data.text).join(''));
    const dataOut = msg.action === 'get_forward_msg' ? { messages: forwards[msg.params.message_id] || [] } : { message_id: replies.length };
    ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: dataOut, echo: msg.echo }));
  });
  ws.send(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'lifecycle', self_id: BOT, time: Date.now() / 1000 }));
});
const send = (message) =>
  socket.send(JSON.stringify({ post_type: 'message', message_type: 'private', self_id: BOT, user_id: OWNER, message_id: ++id, time: Math.floor(Date.now() / 1000), message, sender: { user_id: OWNER, nickname: '阿青' } }));
const say = (text) => send([{ type: 'text', data: { text } }]);
const last = () => replies.at(-1) || '';

const bridge = spawn(process.execPath, [path.join(ROOT, 'bridge.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env, ONEBOT_WS: 'ws://127.0.0.1:3991', ALLOWED_QQ: String(OWNER), ALLOWED_GROUPS: '',
    DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'), DSH_HOME: path.join(data, 'dsh-home'), BRIDGE_DATA: data, AGENT_CWD: ROOT,
    DEEPSEEK_API_KEY: 'test', PHONE_MONITOR: 'false', AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false', PROACTIVE: 'false', FACTS: 'false', REFLECT: 'false', JOURNAL: 'false',
    MERGE_MS: '200', TYPING_MS_PER_CHAR: '0', TYPO_PROB: '0', SLEEP_DELAY_PROB: '0', REACT: 'false', CLOSENESS_SET: '',
    MIMIC: 'true', MIMIC_RAMP_DAYS: '0',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const mimic = () => JSON.parse(fs.readFileSync(path.join(data, 'mimic.json'), 'utf8'));
try {
  await waitFor(() => socket && socket.readyState === 1);
  await sleep(300);

  // 1. 合并转发（内容直接带在消息里，也带 id）→ 列人
  send([{ type: 'forward', data: { id: 'outer', content } }]);
  await waitFor(() => last().includes('学谁'));
  const list = last();
  check(/1\. 小明（4 条）/.test(list) && /阿青（2 条）/.test(list) && /路人（1 条）/.test(list), `列出了转发里的人和条数，嵌套的也算上（${list.split('\n').slice(1, 4).join(' | ')}）`);
  check(calls.some((c) => c.action === 'get_forward_msg' && c.params.message_id === 'outer'), '有 id 就去取完整的一份（带着的多就用带着的）');

  // 2. 选人期间问这段聊天：照常聊天，而且看得到转发的内容
  const n0 = replies.length;
  say('他们在聊啥');
  await waitFor(() => replies.length > n0 && last().includes('他们在聊啥'));
  check(last().includes('[看到转发]'), '选人期间问这段聊天，回答时看得到转发的内容');

  // 3. “第一个” → 只学小明
  say('第一个');
  await waitFor(() => fs.existsSync(path.join(data, 'mimic.json')) && mimic().active, 10_000);
  const a = mimic().active;
  check(a.name === '小明', '“第一个”也认，学的是小明');
  check(!a.traits.includes('LEAK_OTHER_PERSON'), '素材里只有那个人的话，没混进别人的');
  check(fs.readdirSync(path.join(data, 'mimic-samples')).length === 1, '原话素材存在 mimic-samples 里');
  await waitFor(() => /学到了|琢磨|研究|学学/.test(last()));

  // 4. 之后聊天带上（MIMIC_RAMP_DAYS=0：直接学到位，例句也带上）；选完之后不再带转发内容
  say('最近咋样');
  await waitFor(() => replies.some((r) => r.includes('最近咋样')));
  const r4 = replies.find((r) => r.includes('最近咋样'));
  check(r4.includes('[在学说话]') && r4.includes('[学到位]'), '聊天的提示词里带上了学到的说话方式和例句');
  check(!r4.includes('[看到转发]'), '选完人之后提示词里不再带转发的原文');

  // 5. /学说话
  say('/学说话');
  await waitFor(() => last().includes('在学 小明'));
  check(true, '/学说话 能看到在学谁、学了几成');

  // 6. 只带 id、一次 120 条（超过 59）+ 两张图：去取完整的，图不算条数
  send([{ type: 'forward', data: { id: 'big', content: big.slice(0, 59) } }]);
  await waitFor(() => last().includes('小红'));
  check(/收到 120 条/.test(last()) && /另有 2 条图片/.test(last()), `不卡在 59 条：取完整的 120 条，图片单独说（${last().split('\n')[0]}）`);
  check(/都是 小红 说的/.test(last()) && /回“学”/.test(last()), '只有一个人时直接问学不学');

  // 7. 接着再转一段：合在一起（重复的不算）
  send([{ type: 'forward', data: { id: 'part2' } }]);
  await waitFor(() => last().includes('合起来'));
  check(/合起来一共 121 条/.test(last()), `连着转两段合在一起（${last().split('\n')[0]}）`);

  // 8. 回“学” → 学小红（换人）
  say('学');
  await waitFor(() => mimic().active?.name === '小红', 10_000);
  check(true, '只有一个人时回“学”就开始学');

  // 9. 只带 id 的合并转发 → get_forward_msg；回“算了”取消
  send([{ type: 'forward', data: { id: 'only-id' } }]);
  await waitFor(() => last().includes('老王'));
  check(calls.some((c) => c.action === 'get_forward_msg' && c.params.message_id === 'only-id'), '消息里没带内容时，用 get_forward_msg 去取');
  say('算了');
  await waitFor(() => last().includes('不学'));
  check(mimic().active.name === '小红', '回“算了”不会换人');

  // 10. /别学了：停掉并删素材
  say('/别学了');
  await waitFor(() => last().includes('不学了'));
  check(mimic().active === null && !fs.existsSync(path.join(data, 'mimic-samples')), '/别学了 停掉并删掉了原话素材');
  say('还在吗');
  await waitFor(() => replies.some((r) => r.includes('还在吗')));
  check(!replies.find((r) => r.includes('还在吗')).includes('[在学说话]'), '停了之后提示词里不再带');
} catch (err) {
  check(false, `出错：${err.message}`);
} finally {
  bridge.kill();
  wss.close();
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  setTimeout(() => process.exit(failed ? 1 : 0), 200);
}
