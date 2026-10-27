#!/usr/bin/env node
/**
 * 测试和本地开发用的入口：把 packages/ 下每个插件的 module.mjs 都当“已经装上”，起内核。
 * 真装进 DSH 时不走这里，由 dsh-companion-core 插件按装了哪些插件来起内核。
 * 想只带几个插件：COMPANION_ONLY=speech,memory node bridge.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PKGS = path.join(ROOT, 'packages');
if (!process.env.COMPANION_MODULES) {
  const only = (process.env.COMPANION_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
  const mods = fs.readdirSync(PKGS)
    .filter((id) => id !== 'core' && fs.existsSync(path.join(PKGS, id, 'module.mjs')) && (!only.length || only.includes(id)))
    .map((id) => ({ id, file: path.join(PKGS, id, 'module.mjs') }));
  process.env.COMPANION_MODULES = JSON.stringify(mods);
}
await import(pathToFileURL(path.join(PKGS, 'core', 'kernel', 'main.mjs')).href);
