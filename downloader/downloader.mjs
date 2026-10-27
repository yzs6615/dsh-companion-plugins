#!/usr/bin/env node
/**
 * 下载器：把这套插件装进 DSH。
 *
 *   node downloader.mjs                 问你装哪些（回车 = 全部）
 *   node downloader.mjs --all           全部装，不问
 *   node downloader.mjs --only speech,memory
 *   node downloader.mjs --profile web   装进哪个 DSH 配置（默认 web）
 *   node downloader.mjs --list          只列出有哪些插件
 *
 * 安装包从哪来：下载器旁边的 packages\ 文件夹里有 .tgz（下的是“全部插件”离线包）就用本地的；
 * 没有就从 GitHub 上这个插件的分支下（由 DSH 自己的 pnpm 去下）。实际执行的是 `dsh plugin --profile <配置> add <安装包>`。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { PLUGINS, VERSION, REPO } from './plugins.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

if (flag('--list')) {
  PLUGINS.forEach((p, i) => console.log(`${i + 1}. ${p.title}（${p.pkg}）${p.required ? ' [必装]' : ''}\n   ${p.desc}`))
  process.exit(0)
}

/** 找 dsh：环境变量 DSH_CLI（指向 bin.js）> PATH 里的 dsh。返回 [命令, 前置参数]。 */
function findDsh() {
  if (process.env.DSH_CLI && fs.existsSync(process.env.DSH_CLI)) return [process.execPath, [process.env.DSH_CLI]]
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['dsh'], { encoding: 'utf8' })
  if (probe.status === 0 && probe.stdout.trim()) return ['dsh', []]
  return null
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
async function ask(q) {
  return (await rl.question(q)).trim()
}

async function main() {
  console.log(`DSH 陪伴插件下载器 v${VERSION}\n`)
  let dsh = findDsh()
  if (!dsh) {
    const p = await ask('没找到 dsh。把 DSH 的 lib\\bin.js 路径贴进来（在 DSH 安装目录 node_modules\\@deepseek-ai\\dsh\\lib\\bin.js）：')
    if (!p || !fs.existsSync(p)) {
      console.log('这个路径不存在。先装好 DeepSeek Harness（DSH）再来。')
      return 1
    }
    dsh = [process.execPath, [p]]
  }
  // DSH 装插件要用 pnpm（DSH 自己就要求装好）；没有就说清楚，不替人去下
  const pnpm = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['-v'], { encoding: 'utf8', shell: process.platform === 'win32' })
  if (pnpm.status !== 0) {
    console.log('没找到 pnpm。DSH 装插件要用它：先按 DSH 的说明装好 pnpm（比如 npm i -g pnpm），再来。')
    return 1
  }
  // 装进哪个 DSH 配置：命令行给了就用；不然列出这台电脑上已有的配置让人挑（网页版是 web，桌面版是 desktop）
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  let profiles = []
  try {
    profiles = fs.readdirSync(path.join(dshHome, 'profiles'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'node_modules' && d.name !== 'headless' && fs.existsSync(path.join(dshHome, 'profiles', d.name, 'package.json')))
      .map((d) => d.name)
  } catch {
    /* 还没有配置：DSH 会在第一次装插件时建 */
  }
  let profile = value('--profile')
  if (!profile) {
    const fallback = profiles.includes('web') ? 'web' : profiles[0] || 'web'
    if (profiles.length > 1 && !flag('--all') && !value('--only')) {
      const ans = await ask(`装进哪个 DSH 配置？这台电脑上有：${profiles.join('、')}（回车 = ${fallback}）：`)
      profile = profiles.includes(ans) ? ans : fallback
    } else profile = fallback
  }
  if (profile === 'desktop') console.log('装进桌面版（desktop）：先把 DeepSeek Harness 桌面版完全退出（托盘里也退掉），不然装不上。')

  let chosen
  if (value('--only')) {
    const ids = value('--only').split(',').map((s) => s.trim())
    chosen = PLUGINS.filter((p) => p.required || ids.includes(p.id))
  } else if (flag('--all')) {
    chosen = PLUGINS
  } else {
    PLUGINS.forEach((p, i) => console.log(`${String(i + 1).padStart(2)}. ${p.title}${p.required ? '（必装）' : ''}：${p.desc}`))
    const ans = await ask('\n装哪些？直接回车 = 全部；挑着装就写编号，用空格隔开（比如 2 3 5）：')
    if (!ans) chosen = PLUGINS
    else {
      const nums = new Set(ans.split(/[\s,，]+/).map(Number).filter((n) => n >= 1 && n <= PLUGINS.length))
      chosen = PLUGINS.filter((p, i) => p.required || nums.has(i + 1))
    }
  }

  const localDir = path.join(HERE, 'packages')
  const source = (p) => {
    const file = path.join(localDir, `${p.pkg}-${VERSION}.tgz`)
    // 有离线包就用本地的；没有就让 DSH 的 pnpm 直接从 GitHub 拉这个插件的分支（每个插件一个分支，分支根目录就是插件）
    return fs.existsSync(file) ? file : `github:${REPO}#${p.id}`
  }
  console.log(`\n要装进 DSH 的“${profile}”配置：${chosen.map((p) => p.title).join('、')}`)
  console.log(fs.existsSync(localDir) ? '安装包：用下载器旁边 packages 文件夹里的' : `安装包：从 GitHub 下（github.com/${REPO} 的各个插件分支）`)
  if (!flag('--all') && !value('--only') && /^n/i.test(await ask('开始？（回车开始，n 取消）'))) return 0

  let failed = 0
  for (const p of chosen) {
    console.log(`\n── 装 ${p.title}（${p.pkg}）`)
    const argv = [...dsh[1], 'plugin', '--profile', profile, 'add', source(p)]
    // PATH 里的 dsh 在 Windows 上是 dsh.cmd，得经过 shell 跑；路径里可能有空格、中文，每个参数都加上引号
    const viaShell = dsh[0] === 'dsh'
    const r = spawnSync(dsh[0], viaShell ? argv.map((a) => `"${a}"`) : argv, { stdio: 'inherit', shell: viaShell })
    if (r.status !== 0) {
      failed++
      console.log(`!! ${p.title} 没装上（退出码 ${r.status}）`)
      if (p.required) {
        console.log('本体没装上，别的插件也用不了，先停在这。')
        return 1
      }
    }
  }
  const home = path.join(dshHome, 'companion')
  console.log(`\n${failed ? `装完了，${failed} 个没装上（上面有原因）` : '都装好了'}。接下来：`)
  console.log(`1. 启动一次 DSH${profile === 'desktop' ? ' 桌面版' : `（dsh ${profile}）`}，会建好 ${home}，里面有 .env 和 persona.md`)
  console.log(`2. 在 ${path.join(home, '.env')} 里写好 QQ 连接（ONEBOT_WS）和白名单（ALLOWED_QQ），人设改 ${path.join(home, 'persona.md')}`)
  console.log(`3. 再重启一次 DSH，机器人会跟着起来；日志在 ${path.join(home, 'data', 'bridge.log')}`)
  return failed ? 1 : 0
}

main()
  .then((code) => {
    rl.close()
    process.exitCode = code
  })
  .catch((err) => {
    rl.close()
    console.error(`出错了：${err.message}`)
    process.exitCode = 1
  })
