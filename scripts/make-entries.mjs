#!/usr/bin/env node
/**
 * 按 scripts/plugins.mjs 给每个插件写 DSH 要的几个文件：package.json、cordis.patch.yml，
 * 以及非本体插件的 index.js（登记到本体的 companion 服务）。本体的 index.js 是手写的，不动。
 *   node scripts/make-entries.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLUGINS, VERSION, REPO } from './plugins.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

for (const p of PLUGINS) {
  const dir = path.join(ROOT, 'packages', p.id)
  fs.mkdirSync(dir, { recursive: true })
  // 包里放哪些：DSH 要的入口文件一定放（这时候可能还没写出来），再加上目录里别的东西
  const files = [...new Set(['index.js', 'cordis.patch.yml', 'README.md', ...(p.id === 'core' ? [] : ['module.mjs']), ...fs.readdirSync(dir).filter((f) => !['package.json', 'node_modules'].includes(f))])]
  const pkg = {
    name: p.pkg,
    version: VERSION,
    description: `${p.title}：${p.desc}`,
    type: 'module',
    main: './index.js',
    exports: { '.': './index.js', './cordis.patch.yml': './cordis.patch.yml', './package.json': './package.json' },
    files: files.sort(),
    // 不写 engines.dsh、不依赖 @deepseek-ai/* 的包：DSH 装插件时按这两样卡版本，写了别人版本对不上就装不了。
    // 插件只用最基本的 apply(ctx) + 卸载回调，各版本 DSH 都有。
    engines: { node: '>=22' },
    ...(p.deps ? { dependencies: p.deps } : {}),
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    repository: { type: 'git', url: `git+https://github.com/${REPO}.git`, directory: `packages/${p.id}` },
    keywords: ['dsh', 'dsh-plugin', 'deepseek-harness', 'qq', 'onebot', 'napcat'],
    license: 'MIT',
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'),
    `# ${p.pkg}（${p.title}）：装上就挂进 DSH。${p.id === 'core' ? '' : '要先装 dsh-companion-core。'}\n` +
    `- insert:\n    - id: companion-${p.id}\n      name: '${p.pkg}'\n` +
    (p.id === 'core' ? `      config:\n        home: ''        # 留空 = $DSH_HOME/companion（放 .env、persona.md、聊天数据）\n        autoStart: true\n` : ''))
  if (p.id !== 'core') {
    fs.writeFileSync(path.join(dir, 'index.js'),
`/**
 * ${p.pkg}（${p.title}）：DSH 里的入口，只做一件事——把 module.mjs 登记给本体（dsh-companion-core），本体的内核会加载它。
 * 登记表放在 globalThis 上，本体和这个插件谁先加载都行；不 import DSH 的任何包，各版本 DSH 都能装。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = '${p.pkg}'

const REG = (globalThis.__dshCompanion ??= { modules: new Map(), listeners: new Set() })
const changed = () => REG.listeners.forEach((fn) => fn())

export function apply(ctx) {
  if (process.env.COMPANION_CHILD) return // 内核调模型时起的 dsh 里用不着
  const mod = { id: '${p.id}', file: path.join(path.dirname(fileURLToPath(import.meta.url)), 'module.mjs') }
  REG.modules.set(mod.id, mod)
  changed()
  const off = () => {
    if (REG.modules.get(mod.id) !== mod) return
    REG.modules.delete(mod.id)
    changed()
  }
  if (typeof ctx?.effect === 'function') ctx.effect(() => off)
  else ctx?.on?.('dispose', off)
}
`)
  }
  console.log(`写好了 packages/${p.id}`)
}
