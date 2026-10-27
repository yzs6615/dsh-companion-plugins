#!/usr/bin/env node
/**
 * 打发布用的东西，放 dist/：
 *   dsh-companion-<插件>-<版本>.tgz   每个插件单独的安装包（dsh plugin add 能直接装）
 *   下载器.zip                        只有下载器（装的时候从 GitHub Releases 下插件）
 *   全部插件.zip                      下载器 + 全部安装包（离线装）
 * 打完扫一遍：包里不能有 .env、data、persona.md，也不能出现 scripts/private-words.txt 里列的词（QQ 号、名字、key……，这个文件不进仓库）。
 *   node scripts/pack.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLUGINS, VERSION } from './plugins.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DIST = path.join(ROOT, 'dist')
fs.rmSync(DIST, { recursive: true, force: true })
fs.mkdirSync(DIST, { recursive: true })

execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'make-entries.mjs')], { stdio: 'inherit' })

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const tgzs = []
for (const p of PLUGINS) {
  const out = execFileSync(npm, ['pack', '--pack-destination', DIST, '--json'], { cwd: path.join(ROOT, 'packages', p.id), encoding: 'utf8', shell: true })
  const info = JSON.parse(out)[0]
  tgzs.push(path.join(DIST, info.filename))
  console.log(`打好 ${info.filename}（${info.entryCount} 个文件，${Math.round(info.size / 1024)}KB）`)
}

// ── 扫私人数据 ──
const banned = [/(^|\/)\.env$/, /(^|\/)data\//, /(^|\/)persona\.md$/, /\.sqlite/, /bridge\.log/]
const wordsFile = path.join(ROOT, 'scripts', 'private-words.txt')
const words = fs.existsSync(wordsFile) ? fs.readFileSync(wordsFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')) : []
if (!words.length) console.log('提醒：没有 scripts/private-words.txt，只查了文件名，没查内容里的私人词')
const scan = fs.mkdtempSync(path.join(DIST, 'scan-'))
let bad = 0
for (const t of tgzs) {
  const dir = path.join(scan, path.basename(t))
  fs.mkdirSync(dir)
  execFileSync('tar', ['-xzf', t, '-C', dir])
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
  for (const f of walk(dir)) {
    const rel = path.relative(dir, f).replace(/\\/g, '/')
    if (banned.some((re) => re.test(rel))) {
      console.log(`!! ${path.basename(t)} 里不该有：${rel}`)
      bad++
    }
    const text = fs.readFileSync(f, 'latin1')
    const utf = fs.readFileSync(f, 'utf8')
    for (const w of words) {
      if (text.includes(w) || utf.includes(w)) {
        console.log(`!! ${path.basename(t)} 的 ${rel} 里出现了私人词（第 ${words.indexOf(w) + 1} 个）`)
        bad++
      }
    }
  }
}
fs.rmSync(scan, { recursive: true, force: true })
if (bad) {
  console.log(`有 ${bad} 处问题，没打 zip。`)
  process.exit(1)
}

// ── 下载器 zip ──
const stage = path.join(DIST, 'stage')
const dl = path.join(stage, '下载器')
fs.mkdirSync(dl, { recursive: true })
for (const f of ['downloader.mjs']) fs.copyFileSync(path.join(ROOT, 'downloader', f), path.join(dl, f))
fs.copyFileSync(path.join(ROOT, 'scripts', 'plugins.mjs'), path.join(dl, 'plugins.mjs')) // 换掉仓库里那个转手的 plugins.mjs
fs.writeFileSync(path.join(dl, '安装.cmd'), fs.readFileSync(path.join(ROOT, 'downloader', '安装.cmd'), 'utf8').replace(/\r?\n/g, '\r\n'))
const zip = (from, to) => execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${from}\\*' -DestinationPath '${to}' -Force`])
zip(dl, path.join(DIST, '下载器.zip'))
const all = path.join(stage, '全部插件')
fs.cpSync(dl, all, { recursive: true })
fs.mkdirSync(path.join(all, 'packages'))
for (const t of tgzs) fs.copyFileSync(t, path.join(all, 'packages', path.basename(t)))
zip(all, path.join(DIST, '全部插件.zip'))
fs.rmSync(stage, { recursive: true, force: true })
console.log(`\n好了：dist/ 里 ${tgzs.length} 个安装包 + 下载器.zip + 全部插件.zip（v${VERSION}）`)
