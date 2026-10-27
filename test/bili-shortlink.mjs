#!/usr/bin/env node
/** life 插件 bili/lib.mjs 认视频号 + b23.tv 短链跟跳转（跳转用假的 fetch，不联网）。 */
import assert from 'node:assert/strict';
import { parseVideoRef, resolveVideoRef } from '../packages/life/bili/lib.mjs';

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

// 假 fetch：按 url 查表给 302 + Location；记下请求过啥
const fakeFetch = (table, calls = []) => async (url, opts) => {
  calls.push({ url, redirect: opts?.redirect });
  const loc = table[url];
  return { status: loc ? 302 : 404, headers: { get: (k) => (k.toLowerCase() === 'location' ? loc || null : null) } };
};

await t('BV 号、完整链接、av 号直接认', async () => {
  assert.deepEqual(parseVideoRef('BV1xx411c7mD'), { bvid: 'BV1xx411c7mD' });
  assert.deepEqual(parseVideoRef('https://www.bilibili.com/video/BV1xx411c7mD/?p=2'), { bvid: 'BV1xx411c7mD' });
  assert.deepEqual(parseVideoRef('https://www.bilibili.com/video/av170001'), { aid: '170001' });
  assert.equal(parseVideoRef('随便一句话'), null);
  assert.equal(parseVideoRef(''), null);
});

await t('认出分享文案里的短链', async () => {
  assert.deepEqual(parseVideoRef('【好笑的视频】 https://b23.tv/AbC123x'), { short: 'https://b23.tv/AbC123x' });
  assert.deepEqual(parseVideoRef('b23.tv/AbC123x'), { short: 'https://b23.tv/AbC123x' });
  assert.deepEqual(parseVideoRef('https://bili2233.cn/q1W2e3'), { short: 'https://bili2233.cn/q1W2e3' });
});

await t('短链跟一次跳转拿到 BV 号，不自动跳', async () => {
  const calls = [];
  const f = fakeFetch({ 'https://b23.tv/AbC123x': 'https://www.bilibili.com/video/BV1xx411c7mD?share_source=copy_web' }, calls);
  assert.deepEqual(await resolveVideoRef('看这个 https://b23.tv/AbC123x', f), { bvid: 'BV1xx411c7mD' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].redirect, 'manual');
});

await t('短链跳到短链再跳到视频也行', async () => {
  const f = fakeFetch({ 'https://b23.tv/a1': 'https://b23.tv/b2', 'https://b23.tv/b2': 'https://m.bilibili.com/video/av170001' });
  assert.deepEqual(await resolveVideoRef('https://b23.tv/a1', f), { aid: '170001' });
});

await t('跳到的不是视频、没跳转、一直跳：都返回 null', async () => {
  assert.equal(await resolveVideoRef('https://b23.tv/x1', fakeFetch({ 'https://b23.tv/x1': 'https://space.bilibili.com/123' })), null);
  assert.equal(await resolveVideoRef('https://b23.tv/x2', fakeFetch({})), null);
  const loop = fakeFetch({ 'https://b23.tv/l1': 'https://b23.tv/l2', 'https://b23.tv/l2': 'https://b23.tv/l1' });
  assert.equal(await resolveVideoRef('https://b23.tv/l1', loop), null);
});

await t('有 BV 号就不去请求', async () => {
  const calls = [];
  assert.deepEqual(await resolveVideoRef('BV1xx411c7mD', fakeFetch({}, calls)), { bvid: 'BV1xx411c7mD' });
  assert.equal(calls.length, 0);
});

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
