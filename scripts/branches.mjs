#!/usr/bin/env node
/**
 * 把每个插件拆成自己的分支（分支根目录就是那个插件），这样别人不用下载器，用 DSH 自己的命令一行就能从 GitHub 装：
 *   dsh plugin --profile web add github:<仓库>#speech
 * 做法是 git subtree split，只拿 packages/<插件>/ 的提交历史；在 main 上提交完再跑。推送要另外 git push（这里不推）。
 *   node scripts/branches.mjs
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLUGINS } from './plugins.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()

if (git('status', '--porcelain')) {
  console.log('还有没提交的改动，先在 main 上提交再拆分支。')
  process.exit(1)
}
for (const p of PLUGINS) {
  const commit = git('subtree', 'split', `--prefix=packages/${p.id}`)
  git('branch', '-f', p.id, commit)
  console.log(`分支 ${p.id} -> ${commit.slice(0, 8)}（${p.title}）`)
}
console.log('\n推送：git push -f origin ' + PLUGINS.map((p) => p.id).join(' '))
