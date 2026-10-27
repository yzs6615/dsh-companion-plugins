#!/usr/bin/env node
/**
 * 第三批测试：
 * - 刷别的（life/life.mjs）：知乎热榜 / 微博热搜 / 网易云榜单 / 搜歌看歌词热评 / 新番 / 追番（弹幕热评、正片看不了退到 PV）/ 看过标记。
 *   用本地假接口，不联网。
 * - 等你回：她问了一句、没回 → 追一句；很快回了 → 不追；说了“去洗澡了” → 不追。mock OneBot + fake dsh。
 */
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import http from 'node:http';
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

// ── 假接口 ──
const json = (res, o) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(o));
};
const api = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  if (p === '/zhihu') return json(res, { data: [{ detail_text: '900 万热度', target: { id: 1, title: 'ZH 为什么猫爱推杯子', answer_count: 88, excerpt: '猫推杯子是在试探' } }, { detail_text: '500 万热度', target: { id: 2, title: 'ZH 第二个问题', answer_count: 9 } }] });
  if (p === '/weibo') return json(res, { data: { realtime: [{ word: 'WB 某某塌房', label_name: '爆', num: 1230000 }, { word: '广告', is_ad: 1 }, { word: 'WB 降温了', num: 500000 }] } });
  if (p === '/music/playlist/detail') return json(res, { result: { tracks: [{ id: 111, name: '晴天', artists: [{ name: '周杰伦' }] }, { id: 222, name: '稻香', artists: [{ name: '周杰伦' }] }] } });
  if (p === '/music/search/get') return json(res, { result: { songs: [{ id: 111, name: '晴天', artists: [{ name: '周杰伦' }] }] } });
  if (p === '/music/song/lyric') return json(res, { lrc: { lyric: '[00:00.00] 作词 : 方文山\n[00:01.00]故事的小黄花\n[00:02.00]从出生那年就飘着\n' } });
  if (p === '/music/v1/resource/comments/R_SO_4_111') return json(res, { hotComments: [{ likedCount: 123456, content: '高中的回忆全回来了' }] });
  if (p === '/bili/pgc/web/timeline') return json(res, { result: [{ date: '10-25', episodes: [{ title: '新番A', pub_index: '第3话', pub_time: '12:00', season_id: 9001 }] }] });
  if (p === '/bili/pgc/web/rank/list') return json(res, { result: { list: [{ title: '番剧排行一', season_id: 9001, rating: '9.5分', new_ep: { index_show: '更新至第3话' } }] } });
  if (p === '/bili/pgc/view/web/season') {
    if (u.searchParams.get('season_id') === '9001') return json(res, { result: { title: '新番A', evaluate: '一部很好看的番', rating: { score: 9.5 }, new_ep: { desc: '连载中' }, episodes: [{ title: '2', aid: 1, cid: 11 }, { title: '3', long_title: '大结局', aid: 2, cid: 12, badge: '会员' }] } });
    return json(res, { result: { title: '看不了的番', evaluate: '版权限制', episodes: [], section: [{ title: 'PV', episodes: [{ title: '先导PV', aid: 3, cid: 13 }] }] } });
  }
  if (p === '/bili/x/v1/dm/list.so') {
    const cid = u.searchParams.get('oid');
    const words = cid === '12' ? [] : ['哇酷哇酷', '哇酷哇酷', '哇酷哇酷', '终于来了', '终于来了', '好耶', 'AB', 'CD'];
    res.writeHead(200, { 'content-type': 'text/xml' });
    return res.end(`<i>${words.map((w, i) => `<d p="${i},1,25,1">${w}</d>`).join('')}</i>`);
  }
  if (p === '/bili/x/v2/reply/main') return json(res, { data: { replies: [{ like: 999, content: { message: '这集神了' } }] } });
  res.writeHead(404);
  res.end('{}');
});
await new Promise((r) => api.listen(3989, r));

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-life3-'));
const lifeEnv = { ...process.env, BRIDGE_DATA: data, LIFE_ZHIHU_API: 'http://127.0.0.1:3989/zhihu', LIFE_WEIBO_API: 'http://127.0.0.1:3989/weibo', LIFE_MUSIC_API: 'http://127.0.0.1:3989/music', LIFE_BILI_API: 'http://127.0.0.1:3989/bili' };
const life = (...args) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'packages', 'core', 'kernel', 'life', 'life.mjs'), ...args], { env: lifeEnv });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', () => resolve(out));
  });

// ── 等你回用的假 QQ ──
const sent = [];
let socket;
let mid = 700;
const wss = new WebSocketServer({ port: 3988 });
wss.on('connection', (ws) => {
  socket = ws;
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.action === 'send_private_msg') sent.push(msg.params.message.filter((x) => x.type === 'text').map((x) => x.data.text).join(''));
    ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 5000 + sent.length }, echo: msg.echo }));
  });
  ws.send(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'lifecycle', self_id: BOT, time: Date.now() / 1000 }));
});
const say = (text) => socket.send(JSON.stringify({ post_type: 'message', message_type: 'private', self_id: BOT, user_id: OWNER, message_id: ++mid, time: Math.floor(Date.now() / 1000), message: [{ type: 'text', data: { text } }], sender: { user_id: OWNER, nickname: '阿青' } }));
const CHASE = new Set(['人呢', '？', '嗯？', '人呢人呢', '说话', '又跑了', '睡了？', '人呢 睡着了？', '不理我是吧', '已读不回是吧', '喂']);
let mark = 0;
const next = () => (mark = sent.length);
const after = () => sent.slice(mark);

let bridge;
try {
  // ── 刷别的 ──
  const zh = await life('zhihu', '5');
  check(zh.includes('ZH 为什么猫爱推杯子') && zh.includes('900 万热度') && zh.includes('猫推杯子是在试探'), '知乎热榜：问题、热度、摘要');
  check((await life('zhihu', '5')).includes('ZH 为什么猫爱推杯子（看过）'), '刷过的知乎问题第二次标“（看过）”');
  const wb = await life('weibo');
  check(wb.includes('WB 某某塌房【爆】 123万') && !wb.includes('广告'), '微博热搜：带标签和热度，广告去掉');
  const mu = await life('music', '热歌');
  check(mu.includes('网易云热歌榜') && mu.includes('晴天 - 周杰伦') && mu.includes('id 111'), '网易云榜单');
  const sg = await life('song', '晴天');
  check(sg.includes('【晴天 - 周杰伦】') && sg.includes('故事的小黄花') && !sg.includes('作词') && sg.includes('12.3万赞') && sg.includes('高中的回忆全回来了'), '按歌名搜歌：歌词（去掉作词作曲）+ 网易云热评');
  const an = await life('anime');
  check(an.includes('新番A 第3话') && an.includes('season 9001'), '新番时间表');
  const aw = await life('anime-watch', '9001');
  check(aw.includes('【新番A】 评分 9.5') && aw.includes('第3话 大结局（会员）') && aw.includes('上一集弹幕刷得最多：哇酷哇酷×3') && aw.includes('这集神了'), '追番：最新一集、没弹幕就看上一集的、热评');
  const pv = await life('anime-watch', '9002');
  check(pv.includes('正片这边看不了，只能看PV') && pv.includes('最新一集：先导PV'), '正片看不了的番：退到 PV，标题不乱加“第…话”');
  check((await life('seen')).includes('[番] 新番A'), 'seen 列出最近看过的');

  // ── 等你回 ──
  fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ _closenessSeeded: 1 }));
  bridge = spawn(process.execPath, [path.join(ROOT, 'bridge.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env, ONEBOT_WS: 'ws://127.0.0.1:3988', ALLOWED_QQ: String(OWNER), ALLOWED_GROUPS: '',
      DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'), DSH_HOME: path.join(data, 'dsh-home'), BRIDGE_DATA: data, AGENT_CWD: ROOT,
      DEEPSEEK_API_KEY: 'test', PHONE_MONITOR: 'false', AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false', PROACTIVE: 'false', FACTS: 'false', REFLECT: 'false', JOURNAL: 'false', MIMIC: 'false',
      WEATHER: 'false', ONLINE_STATUS: 'false', MERGE_MS: '200', TYPING_MS_PER_CHAR: '0', TYPO_PROB: '0', SLEEP_DELAY_PROB: '0', REACT: 'false', CLOSENESS_SET: '',
      CHASE: 'true', CHASE_PROB: '1', CHASE_MIN: '0.04', CHASE_MAX: '0.05', CHASE_CHECK_MS: '300', SLEEP_START: '0', SLEEP_END: '0',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitFor(() => socket && socket.readyState === 1);
  await sleep(300);

  // 1. 问了没回 → 追一句
  next();
  say('ASKME 今天咋样');
  await waitFor(() => after().some((t) => t.includes('吃饭了没')));
  await waitFor(() => after().some((t) => CHASE.has(t)), 10_000).catch(() => {});
  check(after().some((t) => CHASE.has(t)), `问了一句没回：过一会追了一句（${after().find((t) => CHASE.has(t)) || '没追'}）`);
  check(after().filter((t) => CHASE.has(t)).length === 1, '只追一次，不刷屏');

  // 2. 很快就回了 → 不追
  await sleep(4000);
  next();
  say('ASKME 再问一次');
  await waitFor(() => after().some((t) => t.includes('吃饭了没')));
  say('吃了吃了');
  await sleep(5000);
  check(!after().some((t) => CHASE.has(t)), '很快就回了：不追');

  // 3. 说了要去洗澡 → 不追
  next();
  say('我先去洗澡了 ASKME');
  await waitFor(() => after().some((t) => t.includes('吃饭了没')));
  await sleep(5000);
  check(!after().some((t) => CHASE.has(t)), '对方说了要去洗澡：不追');
} catch (err) {
  check(false, `出错：${err.message}`);
} finally {
  bridge?.kill();
  wss.close();
  api.close();
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  setTimeout(() => process.exit(failed ? 1 : 0), 200);
}
