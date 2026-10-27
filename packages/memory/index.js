/**
 * dsh-companion-memory（记得你）：DSH 里的入口，只做一件事——把 module.mjs 登记给本体（dsh-companion-core），本体的内核会加载它。
 * 登记表放在 globalThis 上，本体和这个插件谁先加载都行；不 import DSH 的任何包，各版本 DSH 都能装。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-companion-memory'

const REG = (globalThis.__dshCompanion ??= { modules: new Map(), listeners: new Set() })
const changed = () => REG.listeners.forEach((fn) => fn())

export function apply(ctx) {
  if (process.env.COMPANION_CHILD) return // 内核调模型时起的 dsh 里用不着
  const mod = { id: 'memory', file: path.join(path.dirname(fileURLToPath(import.meta.url)), 'module.mjs') }
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
