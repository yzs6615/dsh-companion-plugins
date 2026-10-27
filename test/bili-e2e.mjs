#!/usr/bin/env node
/**
 * 刷 B站工具测试：假 B站接口（本地 http），临时数据目录，不联网。
 * 覆盖：热门 / 搜索 / 看视频（简介、标签、弹幕统计、热评、没登录的提示）/ 看过的打标记 / wbi 签名 /
 * 风控 412 → 冷却 15 分钟、冷却期间不再请求；
 * 看画面：弹幕高峰、sidx 分片索引、按时长定帧数（单测），以及用 PyAV 现场生成的 4 个镜头的小视频
 * 跑完整的 --frames（挑到弹幕高峰那一帧、每个镜头一帧不重复、拼出图）。
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { danmakuPeaks, parseSidx, autoFrames } from '../packages/core/kernel/bili/lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let failed = false;
const check = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed = true;
};

let mode = 'ok';
const hits = [];
const ok = (data) => JSON.stringify({ code: 0, message: '0', data });
// 现场生成一个 20 秒、4 个镜头（红绿蓝黄各 5 秒）的小视频，给 --frames 用
const tmpVideo = path.join(os.tmpdir(), `bili-test-${process.pid}.mp4`);
const gen = spawnSync('python', ['-c', `
import av, numpy as np, sys
c = av.open(sys.argv[1], 'w'); s = c.add_stream('mpeg4', rate=10); s.width = 64; s.height = 36; s.pix_fmt = 'yuv420p'
for i in range(200):
    a = np.zeros((36, 64, 3), np.uint8); a[:] = [(220,30,30),(30,200,30),(30,30,220),(230,220,30)][i // 50]; a[:, (i % 60):(i % 60) + 2] = 255
    for pk in s.encode(av.VideoFrame.from_ndarray(a, format='rgb24')): c.mux(pk)
for pk in s.encode(): c.mux(pk)
c.close()
`, tmpVideo], { encoding: 'utf8' });
const haveVideo = gen.status === 0 && fs.existsSync(tmpVideo);
const VIDEO2 = { bvid: 'BV1zz411c7mF', aid: 43, cid: 8, title: '四个颜色', duration: 20, pubdate: 1761200000, owner: { name: '测试' }, stat: { view: 1, danmaku: 40, like: 1, coin: 1 } };
const dm2 = [...Array.from({ length: 30 }, (_, i) => ({ t: 11 + (i % 10) * 0.2, text: '笑死' })), ...Array.from({ length: 10 }, (_, i) => ({ t: i * 2, text: `路过${i}` }))];

const VIDEO = { bvid: 'BV1xx411c7mD', aid: 42, cid: 7, title: '修<em class="keyword">老电视</em>', duration: 196, pubdate: 1761200000, tname: '数码', desc: '把八十年代的老电视修好了', owner: { name: '老王修电器' }, stat: { view: 123456, danmaku: 30, like: 5000, coin: 300 } };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  hits.push(u.pathname + u.search);
  if (mode === 'ban') {
    res.writeHead(412, { 'content-type': 'text/html' });
    return res.end('<html>banned</html>');
  }
  const p = u.pathname;
  let body;
  if (p === '/x/frontend/finger/spi') body = ok({ b_3: 'B3', b_4: 'B4' });
  else if (p === '/x/web-interface/nav') body = JSON.stringify({ code: -101, data: { wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } } });
  else if (p === '/x/web-interface/popular') body = ok({ list: [VIDEO, { ...VIDEO, bvid: 'BV1yy411c7mE', title: '第二条' }] });
  else if (p === '/x/web-interface/wbi/search/type') body = u.searchParams.get('w_rid') ? ok({ result: [{ bvid: 'BV1xx411c7mD', title: '修<em>老电视</em>', author: '老王修电器', play: 999, duration: '3:6' }] }) : JSON.stringify({ code: -403, message: 'no sign' });
  else if (p === '/x/web-interface/wbi/view') body = ok(u.searchParams.get('bvid') === VIDEO2.bvid ? VIDEO2 : VIDEO);
  else if (p === '/x/player/wbi/playurl') body = ok({ dash: { video: [{ codecid: 7, bandwidth: 1000, baseUrl: 'http://127.0.0.1:3994/v.mp4' }], audio: [] } });
  else if (p === '/v.mp4') {
    res.writeHead(200, { 'content-type': 'video/mp4' });
    return res.end(fs.readFileSync(tmpVideo));
  }
  else if (p === '/x/tag/archive/tags') body = ok([{ tag_name: '维修' }, { tag_name: '怀旧' }]);
  else if (p === '/x/player/wbi/v2') body = ok({ subtitle: { subtitles: [] }, need_login_subtitle: true });
  else if (p === '/x/v1/dm/list.so' && u.searchParams.get('oid') === '8') {
    res.writeHead(200, { 'content-type': 'text/xml' });
    return res.end(`<i>${dm2.map((d) => `<d p="${d.t},1,25,16777215">${d.text}</d>`).join('')}</i>`);
  } else if (p === '/x/v1/dm/list.so') {
    res.writeHead(200, { 'content-type': 'text/xml' });
    return res.end(`<?xml version="1.0"?><i>${['哈哈哈哈哈', '哈哈哈哈', '哈哈哈', '典', '典', '老王牛逼', '我家也有一台'].map((t, i) => `<d p="${i * 10}.5,1,25,16777215">${t}</d>`).join('')}</i>`);
  } else if (p === '/x/v2/reply/wbi/main') body = ok({ replies: [{ like: 12000, content: { message: '小时候就是看这台电视长大的' } }] });
  else body = JSON.stringify({ code: -404, message: 'nope' });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(body);
});
await new Promise((r) => server.listen(3994, r));

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-bili-'));
// 必须异步：同步跑子进程会把本进程里的假服务器堵死
const run = (...args) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'packages', 'core', 'kernel', 'bili', 'bili.mjs'), ...args], {
      env: { ...process.env, BRIDGE_DATA: data, BILI_API: 'http://127.0.0.1:3994', BILIBILI_SESSDATA: '' },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', () => resolve(out));
  });

try {
  const h = (await run('hot', '2'));
  check(h.includes('B站热门') && h.includes('BV1xx411c7mD') && h.includes('12.3万') && h.includes('3:16'), '热门：标题、BV 号、播放量、时长');

  const s = (await run('search', '老电视', '--n', '1'));
  check(s.includes('修老电视') && !s.includes('<em') && s.includes('3:06'), '搜索：去掉高亮标签、时长补零');
  check(hits.some((x) => x.startsWith('/x/web-interface/wbi/search/type') && /w_rid=[0-9a-f]{32}/.test(x) && /wts=\d+/.test(x)), '搜索请求带了 wbi 签名');

  const w = (await run('watch', 'https://www.bilibili.com/video/BV1xx411c7mD?p=1'));
  check(w.includes('【修老电视】') && w.includes('老王修电器') && w.includes('简介：把八十年代的老电视修好了'), '看视频：标题、UP、简介');
  check(w.includes('标签：维修、怀旧'), '看视频：标签');
  check(/弹幕刷得最多：哈哈哈×3、典×2/.test(w), `看视频：弹幕把“哈哈哈哈哈”这类归成一条再数（${(w.match(/弹幕刷得最多：.*/) || [''])[0]}）`);
  check(w.includes('(1.2万赞) 小时候就是看这台电视长大的'), '看视频：热评');
  check(w.includes('没登录看不到字幕') && w.includes('--listen'), '没字幕时提示可以 --listen');
  check(w.includes('--frames') && w.includes('弹幕最密'), '没要画面时提示可以 --frames');

  const h2 = (await run('hot', '2'));
  check(/修老电视（看过）/.test(h2) && !/第二条（看过）/.test(h2), '看过的视频在列表里打“（看过）”');
  check((await run('seen')).includes('修老电视（BV1xx411c7mD'), 'seen 列出最近看过的');

  // ── 看画面 ──
  {
    const dm = [...Array.from({ length: 50 }, (_, i) => ({ t: 300 + i * 0.1, text: '哈哈哈' })), ...Array.from({ length: 30 }, (_, i) => ({ t: 30 + i * 0.1, text: '前方高能' })), ...Array.from({ length: 60 }, (_, i) => ({ t: i * 10, text: '路过' }))];
    const pk = danmakuPeaks(dm, 600, 3);
    check(pk.length === 2 && Math.abs(pk[0].t - 300) < 8 && Math.abs(pk[1].t - 30) < 8 && pk[0].words[0].startsWith('哈哈哈'), `弹幕高峰：最密的排前面、带上刷的词（${pk.map((p) => `${Math.round(p.t)}s ${p.words[0]}`).join(' / ')}）`);
    check(danmakuPeaks(dm.slice(0, 10), 600, 3).length === 0, '弹幕太少就不找高峰');
    check(autoFrames(120) === 9 && autoFrames(400) === 18 && autoFrames(1200) === 27, '按时长定帧数 9 / 18 / 27');
    // 手搓一个 sidx：timescale 1000，两个分片（5s 100 字节、5s 200 字节），first_offset 0
    const sidx = Buffer.alloc(32 + 24);
    sidx.writeUInt32BE(sidx.length, 0);
    sidx.write('sidx', 4, 'ascii');
    sidx.writeUInt32BE(1000, 16);
    sidx.writeUInt16BE(2, 30);
    sidx.writeUInt32BE(100, 32);
    sidx.writeUInt32BE(5000, 36);
    sidx.writeUInt32BE(200, 44);
    sidx.writeUInt32BE(5000, 48);
    const refs = parseSidx(Buffer.concat([Buffer.alloc(10), sidx]), 10);
    check(refs?.length === 2 && refs[0].from === 66 && refs[0].to === 165 && refs[1].from === 166 && refs[1].start === 5 && refs[1].end === 10, 'sidx：算对每个分片的时间和字节范围');
  }
  if (haveVideo) {
    const f = (await run('watch', 'BV1zz411c7mF', '--frames', '4'));
    const sheets = fs.existsSync(path.join(data, 'bili', 'frames')) ? fs.readdirSync(path.join(data, 'bili', 'frames')) : [];
    check(sheets.includes('BV1zz411c7mF-1.jpg'), '--frames 拼出了图');
    const tl = (f.match(/时间轴：(.*)/) || [, ''])[1];
    const times = [...tl.matchAll(/\[0:(\d\d)\]/g)].map((m) => Number(m[1]));
    check(/弹幕高峰（笑死×/.test(tl) && times.some((t) => t >= 9 && t <= 13), `挑到了弹幕最密那一刻（${tl}）`);
    const scenes = new Set(times.map((t) => Math.floor(t / 5)));
    check(times.length === 4 && scenes.size === 4, `4 帧正好是 4 个不同的镜头，没有重复（${times.join(',')}）`);
  } else {
    check(false, `生成测试视频失败：${(gen.stderr || '').slice(-200)}`);
  }

  mode = 'ban';
  fs.rmSync(path.join(data, 'bili', 'cache.json'), { force: true });
  const b = (await run('hot'));
  check(b.includes('风控') && fs.existsSync(path.join(data, 'bili', 'cooldown')), '风控 412：说一声并记下冷却');
  mode = 'ok';
  const n = hits.length;
  const b2 = (await run('hot'));
  check(b2.includes('还得歇') && hits.length === n, '冷却期间直接说歇会，不再请求 B站');
} catch (err) {
  check(false, `出错：${err.message}`);
} finally {
  server.close();
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  fs.rmSync(tmpVideo, { force: true });
  process.exit(failed ? 1 : 0);
}
