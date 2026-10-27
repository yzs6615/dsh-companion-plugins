/**
 * dsh-companion-core：DSH 里的入口。
 *
 * 别的插件（dsh-companion-speech 这些）装上后，把自己的 module.mjs 登记到同一个进程里的公共登记表（globalThis.__dshCompanion）；
 * 本体把机器人内核（kernel/main.mjs）当子进程跑起来，把登记过的模块列表交给它；插件装上、卸掉时隔两秒重启内核。
 * 为了在各种版本的 DSH 里都能装：不 import 任何 DSH 内部的包，只用插件最基本的 apply(ctx) 和卸载回调。
 * 内核要调模型时会再起一个 `dsh --profile headless`，那时 COMPANION_CHILD=1，这里什么都不做，免得套娃。
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KERNEL = path.join(HERE, 'kernel', 'main.mjs')

export const name = 'dsh-companion-core'

/** 同一个 DSH 进程里所有 companion 插件共用的登记表（插件谁先加载都行）。 */
const REG = (globalThis.__dshCompanion ??= { modules: new Map(), listeners: new Set() })

/** DSH 的 bin.js：内核调模型时用同一个 DSH。按插件目录找（DSH 会把自己挂在配置目录的 node_modules 里），找不到再看启动参数和 PATH。 */
function dshCli() {
  if (process.env.DSH_CLI && fs.existsSync(process.env.DSH_CLI)) return process.env.DSH_CLI
  try {
    const pkg = createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')
    const bin = path.join(path.dirname(pkg), 'lib', 'bin.js')
    if (fs.existsSync(bin)) return bin
  } catch {
    /* 不是装在 DSH 配置目录里 */
  }
  const marker = `${path.sep}@deepseek-ai${path.sep}dsh${path.sep}`
  for (const a of process.argv) {
    const p = path.resolve(a)
    const at = p.indexOf(marker)
    if (at >= 0) return path.join(p.slice(0, at + marker.length - 1), 'lib', 'bin.js')
  }
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['dsh'], { encoding: 'utf8' })
  const shim = probe.status === 0 ? probe.stdout.split(/\r?\n/)[0].trim() : ''
  if (shim) {
    // npm 全局装的：dsh(.cmd) 旁边的 node_modules/@deepseek-ai/dsh/lib/bin.js
    for (const base of [path.dirname(shim), path.join(path.dirname(shim), '..', 'lib')]) {
      const bin = path.join(base, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      if (fs.existsSync(bin)) return bin
    }
  }
  return ''
}

/** 插件卸掉时要做的事：新版 DSH（cordis 4）是 ctx.effect，旧的是 ctx.on('dispose')。 */
function onDispose(ctx, fn) {
  if (typeof ctx?.effect === 'function') ctx.effect(() => fn)
  else ctx?.on?.('dispose', fn)
}

class Companion {
  constructor(config = {}) {
    this.config = { home: '', autoStart: true, ...config }
    this.child = null
    this.timer = null
    this.stopping = false
    const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    this.home = path.resolve(this.config.home || path.join(dshHome, 'companion'))
    fs.mkdirSync(this.home, { recursive: true })
    // 第一次装：放一份默认人设和 .env 模板，照着改就行
    const persona = path.join(this.home, 'persona.md')
    if (!fs.existsSync(persona)) fs.copyFileSync(path.join(HERE, 'kernel', 'persona.default.md'), persona)
    const dotenv = path.join(this.home, '.env')
    if (!fs.existsSync(dotenv)) fs.copyFileSync(path.join(HERE, 'kernel', '.env.example'), dotenv)
    this.onChange = () => this.schedule()
    REG.listeners.add(this.onChange)
    this.schedule()
  }

  /** 插件一个个登记进来，攒两秒再（重）启内核。 */
  schedule() {
    if (!this.config.autoStart || this.stopping) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.restart(), 2000)
  }

  restart() {
    // 旧内核要先完全退出（它退出时才放开 data/kernel.pid），再起新的
    const old = this.child
    if (old) {
      this.child = null
      old.once('exit', () => this.spawnKernel())
      try {
        old.kill()
      } catch {
        this.spawnKernel()
      }
      return
    }
    this.spawnKernel()
  }

  spawnKernel() {
    if (this.stopping || this.child) return
    const env = {
      ...process.env,
      COMPANION_CHILD: '1',
      COMPANION_HOME: this.home,
      COMPANION_MODULES: JSON.stringify([...REG.modules.values()]),
    }
    const cli = dshCli()
    if (cli) env.DSH_CLI = cli
    this.child = spawn(process.execPath, [KERNEL], { cwd: this.home, env, windowsHide: true, stdio: 'ignore' })
    const child = this.child
    child.on('exit', (code) => {
      if (this.child !== child || this.stopping) return
      this.child = null
      // 内核意外退出：过 10 秒再拉起来（原因在 <home>/data/bridge.log）；
      // 退出码 3 = 同一份数据已经有别的内核在跑（比如另开了一个 DSH），隔一分钟再看
      this.timer = setTimeout(() => this.restart(), code === 3 ? 60_000 : 10_000)
    })
  }

  stop() {
    this.stopping = true
    clearTimeout(this.timer)
    REG.listeners.delete(this.onChange)
    const c = this.child
    this.child = null
    try {
      c?.kill()
    } catch {
      /* 已经退了 */
    }
  }
}

export function apply(ctx, config) {
  if (process.env.COMPANION_CHILD) return // 内核自己调模型时起的 dsh：别再起一个内核
  const companion = new Companion(config)
  onDispose(ctx, () => companion.stop()) // DSH 关掉或本体被卸掉：内核一起停
}
