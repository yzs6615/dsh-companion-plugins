#!/usr/bin/env node
/**
 * 跑全部测试（一个接一个，免得抢端口），每个只报通过没通过和最后几行：
 * packages/ 下的单元测试（*.test.mjs，node --test）+ test/ 下的端到端测试。
 *   node scripts/test-all.mjs [名字片段...]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const want = process.argv.slice(2);
const wanted = (f) => !want.length || want.some((w) => f.includes(w));
const lines = (r) => `${r.stdout || ''}${r.stderr || ''}`.trim().split(/\r?\n/);

const unit = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(path.join(d, e.name));
    } else if (/\.test\.mjs$/.test(e.name)) unit.push(path.join(d, e.name));
  }
};
walk(path.join(ROOT, 'packages'));
const files = fs.readdirSync(path.join(ROOT, 'test')).filter((f) => /\.mjs$/.test(f) && !['fake-dsh.mjs', 'radio.mjs'].includes(f));

let bad = 0;
const counts = []; // [名字, 通过几条]：最后列一张表
for (const f of unit.filter(wanted)) {
  const r = spawnSync(process.execPath, ['--no-warnings', '--test', f], { cwd: ROOT, encoding: 'utf8', timeout: 300_000 });
  const ok = r.status === 0;
  if (!ok) bad++;
  // 老的 Node 打印 “# pass N”，Node 24 打印 “ℹ pass N”，两种都认
  const pass = (r.stdout || '').match(/^(?:#|ℹ)\s*pass (\d+)/m)?.[1];
  counts.push([path.basename(f, '.test.mjs'), pass ? Number(pass) : 0, ok]);
  console.log(`${ok ? '通过' : '没过'}  ${path.relative(ROOT, f)}  ${pass ? `${pass} 条` : ''}`);
  if (!ok) console.log(lines(r).filter((l) => /not ok|Error/.test(l)).slice(0, 10).map((l) => `    ${l}`).join('\n'));
}
for (const f of files.filter(wanted)) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--no-warnings', path.join('test', f)], { cwd: ROOT, encoding: 'utf8', timeout: 600_000 });
  const out = lines(r);
  const ok = r.status === 0;
  if (!ok) bad++;
  // 端到端测试每条检查打印一行 “PASS  …”，数这些行
  counts.push([f.replace(/\.mjs$/, ''), out.filter((l) => l.startsWith('PASS ')).length, ok]);
  console.log(`${ok ? '通过' : '没过'}  ${f}  ${Math.round((Date.now() - t0) / 1000)}s  ${out.at(-1) || ''}`);
  if (!ok) console.log(out.filter((l) => /✗|FAIL|失败|Error|not ok|没过/i.test(l)).slice(0, 15).map((l) => `    ${l}`).join('\n'));
}
console.log('\n每个测试通过几条：');
for (const [name, n, ok] of counts) console.log(`  ${ok ? 'PASS' : '没过'}  ${name.padEnd(20)} ${n}`);
console.log(bad ? `${bad} 个没过` : '全部通过');
process.exit(bad ? 1 : 0);
