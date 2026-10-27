import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChronoLife } from './engine.mjs';
import { LifeAdapter } from './adapter.mjs';

test('legacy inference, correction, deletion and restart do not restore exact old evidence', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-adapter-'));
  const engine = new ChronoLife({ dbPath: path.join(dir, 'chronolife/life.sqlite') });
  let resets = 0;
  const adapter = new LifeAdapter({ engine, dataDir: dir, owner: '1', clearSession: () => resets++ });
  const messages = [];
  const command = (text, scope = 'u1', userId = '1') => adapter.command({ text, scope, userId, isGroup: false, send: async x => messages.push(x) });
  try {
    engine.record_interaction({ id: 'incoming', scope: 'u1', text: '我住杭州', direction: 'in' });
    adapter.importFacts('u1', [{ t: '住杭州' }]);
    const fact = engine.get_relevant_memories({ scope: 'u1', query: '住杭州' }).find(m => m.id.startsWith('fact:'));
    assert.equal(fact.source, 'inferred');
    await command(`/生活 更正 ${fact.id} 住苏州`);
    assert.equal(resets, 1);
    assert.ok(!engine.context('u1').includes('住杭州'));
    assert.ok(engine.context('u1').includes('住苏州'));
    assert.equal(adapter.filter('u1', '- 对方：我住杭州\n- 你：好'), '- 你：好');
    assert.equal(adapter.filter('u2', '住杭州'), '住杭州');
    await command(`/生活 删除 ${fact.id}`, 'u2', '2');
    assert.ok(engine.context('u1').includes('住苏州'));
    await command(`/生活 删除 ${fact.id}`);
    const restarted = new LifeAdapter({ engine, dataDir: dir, owner: '1', clearSession: () => {} });
    restarted.importFacts('u1', [{ t: '住杭州' }]);
    assert.ok(!engine.context('u1').includes('住杭州'));
    assert.ok(!engine.context('u1').includes('住苏州'));
    await command('/生活 主动 开', 'u2', '2');
    assert.equal(engine.settings().proactive, false);
    await command('/生活 主动 开'); assert.equal(engine.settings().proactive, true);
    await command('/生活 暂停'); assert.equal(engine.settings().rest, true);
    await command('/生活 恢复'); assert.equal(engine.settings().rest, false);
    engine.commit_virtual_event({ id: 'public-event', content: '虚拟植物开了新叶' });
    await command('/生活 删除 public-event', 'u2', '2');
    assert.ok(engine.get_memory('global', 'public-event'));
    await command('/生活 删除 public-event');
    assert.equal(engine.get_memory('global', 'public-event'), null);
    assert.equal(adapter.filter('u2', '昨天：虚拟植物开了新叶'), '');
  } finally { engine.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('findMemory: plain-language forget/correct finds the note by its words, never chat logs or other chats', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-find-'));
  const engine = new ChronoLife({ dbPath: path.join(dir, 'chronolife/life.sqlite') });
  const adapter = new LifeAdapter({ engine, dataDir: dir, owner: '1', clearSession: () => {} });
  try {
    engine.record_interaction({ id: 'qq:u1:5:in', scope: 'u1', text: '帮我记着下周三考试', direction: 'in' });
    engine.record_memory({ id: 'note:a', scope: 'u1', text: '下周三考试', source: 'observed', layer: 'L3', importance: .9 });
    engine.record_memory({ id: 'note:b', scope: 'u2', text: '下周五搬家', source: 'observed', layer: 'L3', importance: .9 });
    assert.equal(adapter.findMemory('u1', '周三考试')?.id, 'note:a');
    assert.equal(adapter.findMemory('u1', '下周三的考试')?.id, 'note:a');
    assert.equal(adapter.findMemory('u1', '下周五搬家'), null);
    assert.equal(adapter.findMemory('u1', '完全不相干'), null);
    assert.equal(adapter.findMemory('u1', ''), null);
  } finally { engine.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
