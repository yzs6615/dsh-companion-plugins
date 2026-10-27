#!/usr/bin/env node
/** 深夜电台（radio.mjs）单元测试：听懂点播、稿子、找歌、切块拼语音、录/重播/续录/投稿/群私分开。不联网、不花钱。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import {
  createRadio, radioRequest, extractRadioTag, parseAsk, parseEpisode, splitSpeech, packVoices, findRadioSong, personaCore, cardText,
} from '../packages/core/kernel/radio.mjs';
import { makeWav, parseWav } from '../packages/core/kernel/tts.mjs';

let failed = 0;
const t = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.stack?.split('\n').slice(0, 3).join('\n      ')}`);
  }
};
const wavOf = (sec, rate = 24000) => makeWav(new Int16Array(Math.round(sec * rate)).fill(1000), rate);
const draft = (o = {}) => JSON.stringify({
  title: '下雨天别急着emo',
  parts: ['哎 这么晚还点我节目😂（笑）', '我今天刷B站看了个修猫爬架的视频，UP主嘴特别贫。'.repeat(8), '推荐一首雨天，孙燕姿的。', '行 就聊到这。'],
  song: { title: '雨天', artist: '孙燕姿', why: '下雨天听' },
  line: '鞋湿了就笑一声',
  diary: '录了一期下雨天的',
  ...o,
});

await t('听懂点播：开台、来一期、投稿、续上期、一分钟、重播；闲聊不算', () => {
  const c = { wake: ['小伴', '小伴'] };
  const s = { ...c, hasShow: true };
  assert.equal(radioRequest('小伴，开台，今晚想听点适合下雨的。', c).topic, '今晚想听点适合下雨的');
  assert.equal(radioRequest('来一期开心的，别聊大道理。', c).topic, '开心的，别聊大道理');
  const sub = radioRequest('今天我来投稿，你帮我念。', c);
  assert.ok(sub.submit && sub.submission === '');
  assert.equal(radioRequest('我投个稿：楼下的猫生了五只小猫', c).submission, '楼下的猫生了五只小猫');
  assert.equal(radioRequest('我来投稿', c), null); // 没录过节目、又没说念：交给聊天
  assert.ok(radioRequest('我来投稿', s).submit);
  assert.equal(radioRequest('我要投稿到B站', s), null);
  assert.equal(radioRequest('我之前投稿被拒了', s), null);
  assert.ok(radioRequest('上期那个话题接着讲。', s).cont);
  assert.equal(radioRequest('上期那个话题接着讲。', c), null);
  assert.ok(radioRequest('今晚只听一分钟。', s).short);
  assert.equal(radioRequest('再放一遍', s).action, 'replay');
  assert.deepEqual([radioRequest('/电台 帮助', c).action, radioRequest('/电台 列表', c).action, radioRequest('/电台 重播', c).action], ['help', 'list', 'replay']);
  const cmd = radioRequest('/电台 一分钟 开心一点', c);
  assert.ok(cmd.short && cmd.topic === '开心一点');
  for (const chat of ['电台不赖', '你电台录到第几期了', 'B站那个up又来一期了', '我在听电台', '再放一遍']) assert.equal(radioRequest(chat, c), null, chat);
});

await t('聊天里的 [电台:…] 标记：拿出来、不发出去', () => {
  const a = extractRadioTag('行 等我录一下 [电台:一分钟|下雨天]');
  assert.equal(a.text, '行 等我录一下');
  assert.ok(a.radio.short && a.radio.topic === '下雨天');
  assert.ok(extractRadioTag('发来吧[电台:投稿]').radio.submit);
  assert.ok(extractRadioTag('[电台:续上期]').radio.cont);
  assert.equal(extractRadioTag('没有标签').radio, null);
  assert.equal(parseAsk('投稿：你帮我念一下：今天下雨了').submission, '今天下雨了');
});

await t('稿子：宽松收 JSON，去掉表情符号和（笑），太短/不是 JSON 算没写成', () => {
  const e = parseEpisode('好的，这是稿子：\n```json\n' + draft({ title: '《下雨天别急着emo》' }) + '\n```');
  assert.equal(e.title, '下雨天别急着emo');
  assert.equal(e.parts[0], '哎 这么晚还点我节目');
  assert.equal(e.song.artist, '孙燕姿');
  assert.throws(() => parseEpisode('这期聊下雨天'));
  assert.throws(() => parseEpisode(draft({ parts: ['太短', '了'] })));
  const long = parseEpisode(draft({ parts: ['开场。', '很长的一句话说了好多好多。'.repeat(200), '推荐曲。', '收尾。'] }));
  assert.ok(long.parts.join('').length <= 1400, '写太长会截短');
});

await t('人设：录节目用不上的段落（表情包、唱歌、干活）去掉', () => {
  const p = '# 她\n是个人\n## 怎么说话\n口语\n## 表情包\n[表情:…]\n## 唱歌\n[唱歌]\n## 干活的时候\n调工具';
  const core = personaCore(p);
  assert.ok(core.includes('口语') && !core.includes('[表情') && !core.includes('[唱歌]') && !core.includes('调工具'));
});

await t('切块 + 拼语音：每条不超过上限，换段多停一下', () => {
  const chunks = splitSpeech(['第一句。第二句。', '很长的一句话。'.repeat(40)], 120);
  assert.ok(chunks.every((c) => c.text.length <= 180));
  assert.equal(chunks.map((c) => c.text).join(''), '第一句。第二句。' + '很长的一句话。'.repeat(40));
  const voices = packVoices([{ wav: wavOf(20), part: 0 }, { wav: wavOf(30), part: 1 }, { wav: wavOf(20), part: 1 }, { wav: wavOf(5), part: 2 }], 58);
  assert.equal(voices.length, 2);
  assert.ok(Math.abs(voices[0].seconds - 50.7) < 0.01, `第一条 ${voices[0].seconds}`); // 20 + 换段 0.7 + 30
  assert.ok(Math.abs(voices[1].seconds - 25.7) < 0.01, `第二条 ${voices[1].seconds}`); // 20 + 换段 0.7 + 5
  assert.equal(parseWav(voices[0].wav).samples.length, Math.round(50.7 * 24000));
});

// 假网易云：歌名对、歌手对才给链接
const music = http.createServer((req, res) => {
  const q = decodeURIComponent(new URL(req.url, 'http://x').searchParams.get('s') || '');
  const songs = q.includes('雨天') ? [{ id: 11, name: '雨天 (Live)', artists: [{ name: '别人' }] }, { id: 22, name: '雨天', artists: [{ name: '孙燕姿' }] }] : [];
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ result: { songs } }));
});
music.listen(0, '127.0.0.1');
await once(music, 'listening');
const MUSIC = `http://127.0.0.1:${music.address().port}`;
await t('找歌：歌名和歌手都对得上才给链接，对不上不瞎给', async () => {
  const hit = await findRadioSong({ title: '雨天', artist: '孙燕姿' }, MUSIC);
  assert.equal(hit.url, 'https://music.163.com/song?id=22');
  assert.equal(await findRadioSong({ title: '雨天', artist: '周杰伦' }, MUSIC), null);
  assert.equal(await findRadioSong({ title: '不存在的歌', artist: '' }, MUSIC), null);
});

/** 一套假依赖：记下发了什么、模型/语音被调了几次。 */
function rig(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radio-unit-'));
  const r = { dir, prompts: [], sent: [], tts: 0, failAt: 0, done: [], busy: [] };
  r.run = createRadio({
    dir,
    botName: '测试鱼',
    persona: () => '# 测试鱼\n嘴贫\n## 表情包\n别发出来',
    generate: async (p) => {
      r.prompts.push(p);
      return draft();
    },
    synthesize: async () => {
      r.tts++;
      if (r.tts === r.failAt) throw new Error('合成挂了');
      return { wav: wavOf(12), seconds: 12 };
    },
    findSong: async (s) => (s.title === '雨天' ? { title: '雨天', artist: '孙燕姿', url: 'https://music.163.com/song?id=22' } : null),
    material: ({ target }) => (target.group ? { group: true, did: ['今天 14:00 刷B站看了个修猫爬架的'] } : { listener: '阿青', did: ['今天 14:00 刷B站看了个修猫爬架的'], facts: ['喜欢猫'], weather: '小雨 12~16℃' }),
    sendText: async (target, text) => r.sent.push({ to: target.id, kind: 'text', text }),
    sendAudio: async (target, wav) => r.sent.push({ to: target.id, kind: 'voice', sec: parseWav(wav).samples.length / 24000 }),
    sendImage: async (target, file) => r.sent.push({ to: target.id, kind: 'image', ok: fs.existsSync(file) }),
    makeCard: async (info, out) => {
      fs.writeFileSync(out, JSON.stringify(info));
      return true;
    },
    onDone: ({ e }) => r.done.push(e.number),
    onBusy: (on) => r.busy.push(on),
    gapMs: [0, 0],
    collectMs: 50,
    ...over,
  });
  r.texts = () => r.sent.filter((m) => m.kind === 'text').map((m) => m.text);
  r.kinds = () => r.sent.map((m) => m.kind);
  r.clean = () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  return r;
}
const A = { id: 'a' };
const G = { id: 'g', group: true };

await t('录一期：先回一句 → 节目卡 → 几条语音 → 歌的链接；提示词带人设和她真干过的事', async () => {
  const r = rig();
  try {
    await r.run('private:a', parseAsk('下雨天'), A, { who: '阿青', mood: '平静' });
    const k = r.kinds();
    assert.equal(k[0], 'text'); // 先回一句“等我录一下”
    assert.equal(k[1], 'image');
    assert.ok(k.filter((x) => x === 'voice').length >= 2);
    assert.ok(r.texts().at(-1).includes('https://music.163.com/song?id=22'));
    assert.ok(r.sent.filter((m) => m.kind === 'voice').every((m) => m.sec <= 58));
    const p = r.prompts[0];
    assert.ok(p.includes('嘴贫') && !p.includes('别发出来'), '人设带上了，表情包那段去掉了');
    assert.ok(p.includes('「测试鱼的深夜电台」第 1 期') && p.includes('只录给阿青一个人听'));
    assert.ok(p.includes('修猫爬架') && p.includes('喜欢猫') && p.includes('小雨'));
    assert.ok(!p.includes('欢迎收听」') && p.includes('不要播音腔'));
    assert.deepEqual(r.done, [1]);
    assert.deepEqual(r.busy, [true, false]);
  } finally {
    r.clean();
  }
});

await t('重播不再花钱；录到一半断了先给稿子，重播时接着录', async () => {
  const r = rig();
  try {
    r.failAt = 3;
    await r.run('private:a', parseAsk('下雨天'), A, { who: '阿青' });
    assert.ok(r.texts().some((x) => x.includes('录到一半')), '断了会说一声');
    assert.ok(r.texts().some((x) => x.includes('修猫爬架')), '先把稿子发过去');
    assert.equal(r.kinds().filter((x) => x === 'voice').length, 0);
    const chunks = r.tts;
    r.failAt = 0;
    r.sent.length = 0;
    await r.run('private:a', { action: 'replay' }, A, {});
    assert.equal(r.prompts.length, 1, '重播不再写稿');
    assert.ok(r.tts > chunks, '接着录剩下的');
    const voices = r.kinds().filter((x) => x === 'voice').length;
    assert.ok(voices >= 2);
    const after = r.tts;
    r.sent.length = 0;
    await r.run('private:a', { action: 'replay' }, A, {});
    assert.equal(r.tts, after, '录全了再重播：一次合成都不用');
    assert.equal(r.kinds().filter((x) => x === 'voice').length, voices);
  } finally {
    r.clean();
  }
});

await t('续上期带上期原话；群节目不带私事；投稿等稿子、连发合起来、能取消', async () => {
  const r = rig();
  try {
    await r.run('private:a', parseAsk('下雨天'), A, { who: '阿青' });
    await r.run('private:a', { ...parseAsk(''), cont: true }, A, { who: '阿青' });
    assert.ok(r.prompts[1].includes('你是这么说的') && r.prompts[1].includes('修猫爬架的视频'));
    assert.ok(r.prompts[1].includes('之前推荐过的歌（这次别重复）：《雨天》孙燕姿'));

    r.sent.length = 0;
    await r.run('group:g', { ...parseAsk(''), cont: true }, G, { who: '群友' });
    assert.ok(r.texts()[0].includes('还没录过上期'), '群里没录过：续不了');
    await r.run('group:g', parseAsk('随便聊聊'), G, { who: '群友' });
    const gp = r.prompts.at(-1);
    assert.ok(gp.includes('在群里放') && !gp.includes('只录给') && !gp.includes('喜欢猫') && gp.includes('第 1 期'), '群节目单独编号、不带私事');

    r.sent.length = 0;
    await r.run('private:a', parseAsk('投稿'), A, { who: '阿青', uid: 1 });
    assert.ok(/发来|写吧|写完/.test(r.texts()[0]));
    assert.equal(r.run.collect('private:a', 2, '别人说的话', A), false, '别人说的不算');
    assert.ok(r.run.collect('private:a', 1, '今天楼下的猫', A, { who: '阿青' }));
    assert.ok(r.run.collect('private:a', 1, '生了五只小猫', A, { who: '阿青' }));
    await new Promise((res) => setTimeout(res, 400));
    const sp = r.prompts.at(-1);
    assert.ok(sp.includes('听众投稿（阿青投的）：\n今天楼下的猫\n生了五只小猫') && sp.includes('先把下面的听众投稿念出来'));
    assert.equal(r.run.collect('private:a', 1, '这句不是稿子', A), false, '念完就不等了');

    await r.run('private:a', parseAsk('投稿'), A, { uid: 1 });
    r.sent.length = 0;
    assert.ok(r.run.collect('private:a', 1, '算了', A));
    assert.ok(/不念了|下次/.test(r.texts()[0]));
  } finally {
    r.clean();
  }
});

await t('同时点两期：说在录；一天录太多：明天再录；稿子写坏重写一遍', async () => {
  let release;
  const r = rig({ generate: () => new Promise((res) => { release = res; }), maxDay: 1 });
  try {
    const first = r.run('private:a', parseAsk(''), A, {});
    await new Promise((res) => setTimeout(res, 20));
    await r.run('private:a', parseAsk(''), A, {});
    assert.ok(/在录|没录完|还在录/.test(r.texts().at(-1)));
    release(draft());
    await first;
    await r.run('private:b', parseAsk(''), { id: 'b' }, {});
    assert.ok(/明天/.test(r.texts().at(-1)), '一天的量用完了');
  } finally {
    r.clean();
  }
  let n = 0;
  const r2 = rig({ generate: async (p) => (++n === 1 ? '我想想' : (assert.ok(p.includes('上一遍没按格式写')), draft())) });
  try {
    await r2.run('private:a', parseAsk(''), A, {});
    assert.equal(n, 2);
    assert.ok(r2.kinds().includes('voice'));
  } finally {
    r2.clean();
  }
});

await t('没开语音发文字版；画不出卡发文字卡；歌没搜着不瞎给链接', async () => {
  const r = rig({ synthesize: null, makeCard: null, findSong: async () => null });
  try {
    await r.run('private:a', parseAsk('下雨天'), A, {});
    const x = r.texts();
    assert.ok(x.some((s) => s.startsWith('测试鱼的深夜电台 · 第1期')), '文字节目卡');
    assert.ok(x.some((s) => /出不了声|罢工/.test(s)));
    assert.ok(x.some((s) => s.includes('没搜着')) && !x.some((s) => s.includes('http')));
    assert.ok(!r.kinds().includes('voice'));
    assert.ok(!cardText({ number: 1, title: 'x', createdAt: new Date().toISOString() }, '鱼').includes('/电台'), '节目卡不印命令');
  } finally {
    r.clean();
  }
});

music.close();
setTimeout(() => process.exit(failed ? 1 : 0), 50);
