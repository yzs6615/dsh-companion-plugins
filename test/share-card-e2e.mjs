#!/usr/bin/env node
/**
 * 分享卡片：mock OneBot <-> bridge.mjs <-> fake dsh，B站 换成 test/fake-bili.mjs，不联网、不花钱。
 * 覆盖：B站小程序卡片 / 新闻卡片 / 打的 BV 号 → 真去看一眼（看到的写进这轮，主人私聊多一句能再细看）；
 * QQ音乐卡片、网页卡片、认不出的卡片写成一行；只发卡片的消息不再被当空消息丢掉；合并转发的 json 不当卡片；
 * 视频打不开补一句；群里卡片标题里带唤醒词不算叫她；SHARE_CARDS=false 时照旧不理。
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-share-'));

async function start(port, extraEnv = {}) {
  const data = fs.mkdtempSync(path.join(TMP, 'data-'));
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
      PC_OWNER: '',
      WAKE_WORDS: '测试鱼',
      DSH_CLI: path.join(ROOT, 'test', 'fake-dsh.mjs'),
      DSH_HOME: path.join(data, 'dsh-home'),
      DSH_PERMISSION_MODE: 'danger-full-access',
      BRIDGE_DATA: data,
      STICKER_DIR: path.join(data, 'stickers'),
      AGENT_CWD: ROOT,
      DEEPSEEK_API_KEY: 'test',
      DASHSCOPE_API_KEY: '',
      BILI_SCRIPT: path.join(ROOT, 'test', 'fake-bili.mjs'),
      PHONE_MONITOR: 'false', ACK_PRIVATE: 'false',
      AUTONOMY: 'false', PC_BUDDY: 'false', DREAM: 'false', PHOTO: 'false', LETTER: 'false', CHRONOLIFE: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false',
      PROACTIVE: 'false', GREETINGS: 'false', FACTS: 'false', REFLECT: 'false', VOICE: 'false', RADIO: 'false', MIMIC: 'false', WEATHER: 'false', JOURNAL: 'false',
      CURIOUS: 'false', RHYTHM: 'false', POKE_SELF: 'false', CHASE: 'false', CHIME_PROB: '0', REACT: 'false', CLOSENESS_SET: '', ONLINE_STATUS: 'false', LONGNICK: 'false', MOOD_AVATAR: 'false', ANNIVERSARY: 'false',
      MERGE_MS: '200', TYPING_MS_PER_CHAR: '0', TYPO_PROB: '0', SLEEP_DELAY_PROB: '0', SLEEP_START: '0', SLEEP_END: '0', QUIET_HOURS: '0-0',
      HEAR_VOICE: 'false', DRAW: 'false',
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
      .map((c) => ({ to: c.params.user_id ?? c.params.group_id, text: c.params.message.filter((s) => s.type === 'text').map((s) => s.data.text).join('') }));
  return {
    sent,
    priv: (message, user = OWNER) =>
      send({ post_type: 'message', message_type: 'private', self_id: BOT, user_id: user, message_id: ++id, time: now(), message, sender: { user_id: user, nickname: `u${user}` } }),
    group: (message, user = OWNER) =>
      send({ post_type: 'message', message_type: 'group', self_id: BOT, group_id: GROUP, user_id: user, message_id: ++id, time: now(), message, sender: { user_id: user, nickname: `u${user}` } }),
    async turn(how, mark) {
      const n = sent().length;
      how();
      await waitFor(() => sent().slice(n).some((m) => m.text.includes(mark)));
      await sleep(300);
      return sent().slice(n).map((m) => m.text).join('\n');
    },
    async silent(how, ms = 2500) {
      const n = sent().length;
      how();
      await sleep(ms);
      return sent().length === n;
    },
    stop() {
      bridge.kill();
      wss.close();
    },
  };
}

const json = (obj) => [{ type: 'json', data: { data: JSON.stringify(obj) } }];
const BILI_MINIAPP = json({
  app: 'com.tencent.miniapp_01', prompt: '[QQ小程序]哔哩哔哩', ver: '1.0.0.19',
  meta: { detail_1: { appid: '1109937557', title: '哔哩哔哩', desc: '猫猫修好了猫爬架', qqdocurl: 'https://b23.tv/AbCd123?share_medium=android', url: 'm.q.qq.com/a/s/xyz' } },
});
const BILI_NEWS = json({
  app: 'com.tencent.structmsg', prompt: '[分享]老电视修复全过程', view: 'news',
  meta: { news: { title: '老电视修复全过程', desc: '花了三天', jumpUrl: 'https://www.bilibili.com/video/BV1xx411c7mD?share=1', tag: '哔哩哔哩' } },
});
const MUSIC = json({
  app: 'com.tencent.music.lua', prompt: '[分享]晴天', view: 'music',
  meta: { music: { title: '晴天', desc: '周杰伦', jumpUrl: 'https://i.y.qq.com/v8/playsong.html?songmid=0039MnYb0qxYhV', tag: 'QQ音乐' } },
});
const LINK = json({
  app: 'com.tencent.structmsg', prompt: '[分享]今天的晚霞', view: 'news',
  meta: { news: { title: '今天的晚霞', desc: '杭州西湖边拍的', jumpUrl: 'https://example.com/sunset', tag: '小红书' } },
});
const ODD = json({ app: 'com.tencent.contact.lua', prompt: '推荐联系人：张三', meta: { contact: { nickname: '张三' } } });
const MULTI = json({ app: 'com.tencent.multimsg', prompt: '[聊天记录]', meta: { detail: { news: [] } } });

const B = await start(39811);
try {
  let r = await B.turn(() => B.priv(BILI_MINIAPP), '[fake]');
  check(r.includes('[分享了一个B站视频：猫猫修好了猫爬架 https://b23.tv/AbCd123'), 'B站小程序卡片：认出来是 B站视频、带标题和短链');
  check(r.includes('FAKE_BILI 看了 https://b23.tv/AbCd123'), 'B站小程序卡片：真去看了一眼（短链交给刷 B站那套）');
  check(r.includes('弹幕刷得最多') && !r.includes('--listen 3 听一下'), '看到的写进这轮；命令行提示那句去掉了');
  check(r.includes('自己用刷 B站的工具加 --listen'), '主人私聊：提醒她想细看可以自己再听、再看画面');

  r = await B.turn(() => B.priv(BILI_NEWS), '[fake]');
  check(r.includes('FAKE_BILI 看了 BV1xx411c7mD'), 'B站新闻卡片：从链接里认出 BV 号去看');

  r = await B.turn(() => B.priv(MUSIC), '[fake]');
  check(r.includes('[分享了一首歌：《晴天》 周杰伦（QQ音乐）]') && !r.includes('FAKE_BILI'), 'QQ音乐卡片：知道是哪首、谁唱的，不去刷 B站');

  r = await B.turn(() => B.priv(LINK), '[fake]');
  check(r.includes('[分享了一个链接：今天的晚霞（小红书） —— 杭州西湖边拍的 https://example.com/sunset]'), '网页卡片：标题、来源、简介、链接');

  r = await B.turn(() => B.priv(ODD), '[fake]');
  check(r.includes('[分享：推荐联系人：张三]'), '认不出的卡片：用卡片自带的那句话');

  r = await B.turn(() => B.priv([{ type: 'text', data: { text: '你看这个 BV1Ab411c7XY 笑死' } }]), '[fake]');
  check(r.includes('FAKE_BILI 看了 BV1Ab411c7XY'), '打字发的 BV 号也去看');

  r = await B.turn(() => B.priv([{ type: 'text', data: { text: '这个打不开吧 BV1BADVIDEO1' } }]), '[fake]');
  check(r.includes('没打开'), '视频打不开：补一句没打开，照常回');

  r = await B.turn(() => B.priv(BILI_MINIAPP, OTHER), '[fake]');
  check(r.includes('FAKE_BILI') && !r.includes('自己用刷 B站的工具'), '别人私聊：也去看，但不提示自己动手（只读）');

  check(await B.silent(() => B.priv(MULTI)), '合并转发的 json 不当卡片（没学说话时照旧不回）');

  const gTitle = json({ app: 'com.tencent.structmsg', prompt: '[分享]测试鱼的视频', view: 'news', meta: { news: { title: '测试鱼的视频', desc: '', jumpUrl: 'https://example.com/a', tag: '小红书' } } });
  check(await B.silent(() => B.group(gTitle)), '群里：卡片标题里带唤醒词不算叫她');
  r = await B.turn(() => B.group([{ type: 'text', data: { text: '测试鱼 看看这个' } }, ...LINK]), '[fake]');
  check(r.includes('[分享了一个链接：今天的晚霞'), '群里：打字叫了她，卡片一起看到');
} finally {
  B.stop();
}

const C = await start(39812, { SHARE_CARDS: 'false' });
try {
  check(await C.silent(() => C.priv(BILI_MINIAPP)), 'SHARE_CARDS=false：只发卡片照旧不理');
} finally {
  C.stop();
}

console.log(`\n${failed ? 'FAILED' : 'ALL PASS'}（${passed} 项通过）`);
process.exit(failed ? 1 : 0);
