#!/usr/bin/env node
/** life 插件 life/life.mjs song --lyrics-json：假的网易云接口（本机随机端口），看存出来的歌词 JSON 能不能直接给 speech 插件 sing/learn.mjs --lyrics 用。不联网。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'life-lyrics-'));

const LRC = [
  '[00:00.00] 作词 : 某某',
  '[00:00.50] 作曲 : 某某',
  '[00:17.42]第一句歌词',
  '[00:21.12]第二句歌词',
  '[00:24.74][01:30.00]副歌这一句',
  '[00:28.51]',
  '[00:45.00]空了一会儿再唱',
].join('\n');

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (v) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(v));
  };
  if (u.pathname === '/music/search/get') return json({ result: { songs: [{ id: 222, name: '测试歌', artists: [{ name: '测试歌手' }] }] } });
  if (u.pathname === '/music/song/lyric') return json({ lrc: { lyric: u.searchParams.get('id') === '333' ? '纯音乐，请欣赏' : LRC } });
  if (u.pathname.startsWith('/music/v1/resource/comments')) return json({ hotComments: [] });
  res.writeHead(404);
  res.end('{}');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const life = (...args) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'packages', 'life', 'life', 'life.mjs'), ...args], {
      env: { ...process.env, BRIDGE_DATA: data, LIFE_MUSIC_API: `http://127.0.0.1:${port}/music` },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });

let failed = 0;
const t = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
};

await t('存成 learn.mjs 要的格式，放在 data/tmp/', async () => {
  const r = await life('song', '测试歌', '测试歌手', '--lyrics-json', '测试歌.json');
  assert.equal(r.code, 0, r.out);
  const file = path.join(data, 'tmp', '测试歌.json');
  assert.ok(r.out.includes(file), r.out);
  assert.ok(r.out.includes('--lyrics'), '告诉它学的时候怎么加');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(Array.isArray(j.lines));
  assert.deepEqual(j.lines[0], { start: 17.42, end: 21.12, text: '第一句歌词' });
  assert.ok(!j.lines.some((l) => /作词|作曲/.test(l.text)), '去掉作词作曲');
  assert.ok(j.lines.every((l) => typeof l.start === 'number' && l.end > l.start && l.text));
  // 一句后面空着：结束时间是下一个时间戳（空行），不会拖到 45 秒
  const chorus = j.lines.find((l) => l.text === '副歌这一句');
  assert.equal(chorus.end, 28.51);
  // 一行两个时间戳：两处都有
  assert.equal(j.lines.filter((l) => l.text === '副歌这一句').length, 2);
  // 歌名里没混进文件名
  assert.ok(r.out.includes('【测试歌 - 测试歌手】'), r.out);
});

await t('给了别的目录也只存到 data/tmp/，--offset 能挪时间', async () => {
  const r = await life('song', '测试歌', '--lyrics-json', '..\\..\\外面.json', '--offset', '-2');
  assert.equal(r.code, 0, r.out);
  assert.ok(!fs.existsSync(path.join(data, '..', '外面.json')));
  const j = JSON.parse(fs.readFileSync(path.join(data, 'tmp', '外面.json'), 'utf8'));
  assert.deepEqual(j.lines[0], { start: 15.42, end: 19.12, text: '第一句歌词' });
});

await t('没有带时间的歌词就说清楚', async () => {
  const r = await life('song', '333', '--lyrics-json', 'x.json');
  assert.notEqual(r.code, 0);
  assert.match(r.out, /没有带时间的歌词/);
});

await t('不加 --lyrics-json 时跟以前一样', async () => {
  const r = await life('song', '测试歌');
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes('第一句歌词') && !r.out.includes('学歌用的歌词'));
});

server.close();
fs.rmSync(data, { recursive: true, force: true });
console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
