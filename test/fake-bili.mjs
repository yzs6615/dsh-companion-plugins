#!/usr/bin/env node
/** 测试用的假 bili.mjs：不联网。watch 什么就原样报出来；带 BADVIDEO 的当打不开（退出码 1）。 */
const [cmd, ...rest] = process.argv.slice(2);
const target = rest.join(' ');
if (cmd !== 'watch' || target.includes('BADVIDEO')) {
  console.error('B站说刷太快了（风控）');
  process.exit(1);
}
console.log(`【FAKE_BILI 看了 ${target}】`);
console.log('UP 测试UP · 播放 1.2万');
console.log('（没登录看不到字幕；想知道讲了啥可以加 --listen 3 听一下）');
console.log('弹幕刷得最多：哈哈哈、典');
