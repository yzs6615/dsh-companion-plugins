#!/usr/bin/env node
/**
 * 下载 Twemoji（CC-BY 4.0）表情图，按情绪放进表情库 <数据目录>/stickers/<情绪>/（设了 STICKER_DIR 就放那）。
 * 每个情绪 10 张；已存在就跳过。想换素材直接替换目录里的图即可。
 *
 *   node scripts/fetch-stickers.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
// 放进数据目录下的 stickers/（跟 speech 插件一样：STICKER_DIR 优先，其次 <数据目录>/stickers；
// 数据目录 BRIDGE_DATA，没有就是 <COMPANION_HOME>/data，装进 DSH 后单独跑也找得到，见 home.mjs；它要排在 config.mjs 前面）
import { dataDir } from './home.mjs';
import { env } from '../config.mjs';

const DIR = env.STICKER_DIR ? path.resolve(env.STICKER_DIR) : path.join(dataDir(env), 'stickers');
const BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72';

const MOODS = {
  开心: ['1f600', '1f603', '1f604', '1f601', '1f606', '1f605', '1f923', '1f602', '1f642', '1f643'],
  无语: ['1f611', '1f612', '1f613', '1f614', '1f615', '1f616', '1f61f', '1f62e', '1f644', '1f928'],
  生气: ['1f620', '1f621', '1f624', '1f625', '1f627', '1f628', '1f629', '1f62c', '1f92c', '1f92f'],
  卖萌: ['1f970', '1f60d', '1f618', '1f617', '1f619', '1f61a', '1f63a', '1f638', '1f439', '1f430'],
  得意: ['1f60e', '1f913', '1f60f', '1f612', '1f644', '1f929', '1f9d0', '1f60b', '1f61c', '1f92a'],
  委屈: ['1f97a', '1f622', '1f62d', '1f625', '1f62a', '1f62b', '1f629', '1f630', '1f631', '1f633'],
  震惊: ['1f631', '1f628', '1f630', '1f632', '1f626', '1f627', '1f62e', '1f92f', '1f633', '1f635'],
};

for (const [mood, codes] of Object.entries(MOODS)) {
  const dir = path.join(DIR, mood);
  fs.mkdirSync(dir, { recursive: true });
  for (const code of codes) {
    const dest = path.join(dir, `${code}.png`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 100) continue;
    try {
      const res = await fetch(`${BASE}/${code}.png`);
      if (!res.ok) {
        console.log(`skip ${mood}/${code}: HTTP ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) {
        console.log(`skip ${mood}/${code}: too small`);
        continue;
      }
      fs.writeFileSync(dest, buf);
    } catch (err) {
      console.log(`err ${mood}/${code}: ${err.message}`);
    }
  }
  const n = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).length;
  console.log(`${mood}: ${n} 张`);
}
