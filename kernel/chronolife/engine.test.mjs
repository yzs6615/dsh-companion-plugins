import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ChronoLife } from './engine.mjs';

const HOUR = 3600000, DAY = 24 * HOUR;
const START = Date.parse('2026-10-27T05:00:00Z'); // Noon Asia/Bangkok.
test('pause and disable across an unwatched month never catch up suspended plant growth', () => {
  let at = START;
  const e = new ChronoLife({ dbPath: ':memory:', now: () => at, random: () => 0 });
  try {
    e.set_rest_mode(true);
    at += 30 * DAY;
    e.set_rest_mode(false);
    assert.equal(e.get_state().world.plant.ageDays, 0);
    e.set_enabled(false);
    at += 30 * DAY;
    e.set_enabled(true);
    assert.equal(e.get_state().world.plant.ageDays, 0);
    at += HOUR;
    e.simulate_until(at);
    assert.ok(e.get_state().world.plant.ageDays > 0);
    assert.ok(e.get_state().world.plant.ageDays < 1);
  } finally { e.close(); }
});
function fixture(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronolife-'));
  const dbPath = path.join(dir, 'life.sqlite');
  let at = START;
  let engine = new ChronoLife({ dbPath, now: () => at, random: () => 0, settings });
  return {
    get engine() { return engine; },
    advance: ms => { at += ms; return engine.simulate_until(at); },
    time: () => at,
    reopen: () => { engine.close(); engine = new ChronoLife({ dbPath, now: () => at, random: () => 0 }); },
    close: () => { engine.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
test('months offline restore once with provenance; rollback cannot move time backwards', () => {
  const f = fixture();
  try {
    const state = f.advance(200 * DAY);
    assert.equal(state.world.plant.stage, '展开新叶');
    const memories = f.engine.get_relevant_memories({ scope: 'u1' });
    assert.equal(memories.length, 1);
    assert.equal(memories[0].source, 'reconstructed');
    assert.match(memories[0].text, /没有执行现实工具/);
    f.engine.simulate_until(f.time() - DAY);
    assert.equal(f.engine.get_state().at, f.time());
    f.reopen(); f.engine.simulate_until(f.time());
    assert.equal(f.engine.get_relevant_memories({ scope: 'u1' }).length, 1);
  } finally { f.close(); }
});
test('virtual events are idempotent, preference driven, capped and never actual drawing', () => {
  const f = fixture();
  try {
    for (const name of ['plant', 'notes', 'rest']) f.engine.set_interest(name, 0);
    f.engine.set_interest('sketch', 2);
    for (let i = 0; i < 10; i++) f.advance(30 * 60000);
    const entries = f.engine.get_relevant_memories({ scope: 'global', limit: 100 });
    assert.equal(entries.filter(e => e.source === 'virtual_event').length, 4);
    assert.match(entries[0].text, /没有生成图片/);
    const e = { id: 'same', content: '虚拟笔记', source: 'virtual_event' };
    assert.equal(f.engine.commit_virtual_event(e), true);
    assert.equal(f.engine.commit_virtual_event(e), false);
  } finally { f.close(); }
});
test('scope, expiry, correction, deletion and tombstones protect memory', () => {
  const f = fixture();
  try {
    f.engine.record_memory({ id: 'private', scope: 'u1', text: '只属于私聊', layer: 'L5' });
    assert.equal(f.engine.get_relevant_memories({ scope: 'g1:u1' }).length, 0);
    assert.equal(f.engine.correct_memory('u2', 'private', '不应成功'), false);
    assert.equal(f.engine.correct_memory('u1', 'private', '已修正'), true);
    assert.equal(f.engine.get_relevant_memories({ scope: 'u1' })[0].text, '已修正');
    assert.equal(f.engine.delete_memory('u1', 'private'), true);
    assert.equal(f.engine.record_memory({ id: 'private', scope: 'u1', text: '旧数据重新导入' }), false);
    assert.equal(f.engine.get_relevant_memories({ scope: 'u1' }).length, 0);
    f.engine.record_memory({ id: 'expiry', scope: 'u1', text: '过期', expires: f.time() });
    assert.equal(f.engine.get_relevant_memories({ scope: 'u1' }).length, 0);
    assert.throws(() => f.engine.record_memory({ id: 'bad', scope: 'u1', text: 'x', source: 'invented' }));
  } finally { f.close(); }
});
test('pause and disable freeze virtual growth; emotion decays without silence penalties', () => {
  const f = fixture();
  try {
    f.engine.set_emotion({ valence: .9, arousal: .8, curiosity: .8, reason: '一起看到了有趣的东西', scope: 'u1' });
    f.engine.set_rest_mode(true);
    f.advance(DAY);
    assert.equal(f.engine.get_state().world.plant.ageDays, 0);
    assert.equal(f.engine.get_state().mode, 'rest');
    assert.ok(Math.abs(f.engine.get_state().emotion.valence - .6) < .01);
    f.engine.set_rest_mode(false); f.engine.set_enabled(false);
    f.advance(DAY);
    assert.equal(f.engine.get_state().world.plant.ageDays, 0);
    assert.equal(f.engine.context('u1'), '');
    f.engine.set_enabled(true); f.advance(DAY);
    assert.equal(f.engine.get_state().world.plant.ageDays, 1);
  } finally { f.close(); }
});
test('proactive permissions, quiet hours, reservation, unanswered, ACK, cooldown and global weekly cap', () => {
  const f = fixture({ proactive: true });
  try {
    for (const id of ['plant', 'other', 'topic']) f.engine.record_memory({ id, scope: 'global', text: '实际有记录的虚拟生活事件', source: 'virtual_event' });
    const request = { scope: 'u1', reasonId: 'plant' };
    assert.equal(f.engine.evaluate_proactive_message({ ...request, active: true }).reason, 'active_chat');
    assert.equal(f.engine.evaluate_proactive_message({ ...request, at: START + 12 * HOUR }).reason, 'quiet_hours');
    assert.equal(f.engine.queue_message({ id: 'm1', ...request, content: '植物发芽了' }), true);
    assert.equal(f.engine.queue_message({ id: 'm1', ...request, content: '重试' }), false);
    assert.equal(f.engine.claim_message('m1').status, 'sending');
    assert.equal(f.engine.claim_message('m1'), null);
    assert.equal(f.engine.finish_message('m1', 'sent'), true);
    assert.equal(f.engine.evaluate_proactive_message({ scope: 'u1', reasonId: 'other' }).reason, 'unanswered');
    f.advance(1000);
    f.engine.record_interaction({ id: 'in1', scope: 'u1', direction: 'in' });
    assert.equal(f.engine.evaluate_proactive_message({ scope: 'u1', reasonId: 'other' }).reason, 'cooldown');
    for (const scope of ['u2', 'u3']) {
      assert.equal(f.engine.queue_message({ id: scope, scope, reasonId: 'topic', content: '新的话题' }), true);
      assert.ok(f.engine.claim_message(scope)); f.engine.finish_message(scope, 'sent');
    }
    assert.equal(f.engine.evaluate_proactive_message({ scope: 'u4', reasonId: 'topic' }).reason, 'weekly_limit');
    f.engine.set_proactive(false);
    assert.equal(f.engine.evaluate_proactive_message({ scope: 'u1', reasonId: 'topic' }).reason, 'disabled');
  } finally { f.close(); }
});
test('restart preserves pending; stale ambiguous deliveries never replay; same-scope input cancels pending', () => {
  const f = fixture({ proactive: true, cooldownHours: 0 });
  try {
    for (const id of ['r1', 'r3', 'next']) f.engine.record_memory({ id, scope: 'global', text: '实际有记录的虚拟生活事件', source: 'virtual_event' });
    f.engine.queue_message({ id: 'pending', scope: 'u1', reasonId: 'r1', content: '待发' });
    f.reopen(); assert.equal(f.engine.list_pending().length, 1);
    f.engine.record_interaction({ id: 'otherinput', scope: 'u2', direction: 'in' });
    assert.equal(f.engine.list_pending().length, 1);
    f.engine.record_interaction({ id: 'input', scope: 'u1', direction: 'in' });
    assert.equal(f.engine.list_pending().length, 0);
    f.advance(1000);
    f.engine.queue_message({ id: 'ambiguous', scope: 'u3', reasonId: 'r3', content: '可能已到达' });
    f.engine.claim_message('ambiguous');
    f.advance(11 * 60000); f.reopen();
    assert.equal(f.engine.claim_message('ambiguous'), null);
    assert.equal(f.engine.evaluate_proactive_message({ scope: 'u3', reasonId: 'next' }).reason, 'unanswered');
    assert.equal(f.engine.db.prepare('SELECT status FROM outbound_messages WHERE id=?').get('ambiguous').status, 'unknown');
  } finally { f.close(); }
});
test('proactive reason must be recent visible evidence; ACK at identical millisecond is effective', () => {
  const f = fixture({ proactive: true, cooldownHours: 0 });
  try {
    assert.equal(f.engine.evaluate_proactive_message({ scope: 'u1', reasonId: 'imaginary' }).reason, 'invalid_reason');
    f.engine.record_memory({ id: 'private', scope: 'u1', text: '只在私聊发生的事' });
    assert.equal(f.engine.evaluate_proactive_message({ scope: 'u2', reasonId: 'private' }).reason, 'invalid_reason');
    f.engine.record_memory({ id: 'guess', scope: 'global', text: '未经确认', source: 'inferred' });
    assert.equal(f.engine.evaluate_proactive_message({ scope: 'u1', reasonId: 'guess' }).reason, 'invalid_reason');
    f.engine.queue_message({ id: 'm', scope: 'u1', reasonId: 'private', content: '有记录的话题' });
    f.engine.claim_message('m'); f.engine.finish_message('m', 'sent');
    f.engine.record_interaction({ id: 'ack', scope: 'u1', direction: 'in' });
    assert.equal(f.engine.db.prepare('SELECT status FROM outbound_messages WHERE id=?').get('m').status, 'answered');
    f.engine.record_memory({ id: 'next', scope: 'u1', text: '另一个话题' });
    assert.equal(f.engine.evaluate_proactive_message({ scope: 'u1', reasonId: 'next' }).allowed, true);
    f.advance(3 * DAY);
    assert.equal(f.engine.evaluate_proactive_message({ scope: 'u1', reasonId: 'next' }).reason, 'invalid_reason');
  } finally { f.close(); }
});
test('two handles share one timeline and delivery claim; deleting a reason cancels pending delivery', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronolife-shared-'));
  const dbPath = path.join(dir, 'life.sqlite');
  let now = START;
  const a = new ChronoLife({ dbPath, now: () => now, random: () => 0, settings: { proactive: true } });
  const b = new ChronoLife({ dbPath, now: () => now, random: () => 0 });
  try {
    now += 30 * 60000;
    a.simulate_until(now); b.simulate_until(now);
    assert.equal(a.get_relevant_memories({ scope: 'global' }).length, 1);
    const reason = a.get_relevant_memories({ scope: 'global' })[0].id;
    assert.equal(a.queue_message({ id: 'one', scope: 'u1', reasonId: reason, content: '可以分享的事件' }), true);
    assert.equal(b.queue_message({ id: 'two', scope: 'u1', reasonId: reason, content: '重复事件' }), false);
    assert.equal(b.delete_memory('global', reason), true);
    assert.equal(a.claim_message('one'), null);
    assert.equal(a.get_memory('u1', reason), null);
    assert.equal(a.context('u1').includes('给虚拟窗台'), false);
  } finally { a.close(); b.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('input during transport ACK survives completion, same-millisecond ordering and restart', () => {
  const f = fixture({ proactive: true, cooldownHours: 0, weeklyMax: 10 });
  try {
    for (const id of ['r0', 'r1', 'r2', 'r3', 'r4']) f.engine.record_memory({ id, scope: 'global', text: '可核对的话题', source: 'virtual_event' });
    // Input already seen before queuing is not an ACK of a later delivery,
    // even though Date.now() has not advanced.
    f.engine.record_interaction({ id: 'before', scope: 'u0', direction: 'in' });
    assert.equal(f.engine.queue_message({ id: 'before-message', scope: 'u0', reasonId: 'r0', content: '后来发送' }), true);
    f.engine.claim_message('before-message'); f.engine.finish_message('before-message', 'sent');
    assert.equal(f.engine.evaluate_proactive_message({ scope: 'u0', reasonId: 'r1' }).reason, 'unanswered');

    f.engine.queue_message({ id: 'during', scope: 'u1', reasonId: 'r1', content: '正在发送' });
    f.engine.claim_message('during');
    f.engine.record_interaction({ id: 'during-input', scope: 'u1', direction: 'in' });
    assert.equal(f.engine.db.prepare('SELECT status FROM outbound_messages WHERE id=?').get('during').status, 'sending_answered');
    f.reopen();
    assert.equal(f.engine.finish_message('during', 'sent'), true);
    assert.equal(f.engine.db.prepare('SELECT status FROM outbound_messages WHERE id=?').get('during').status, 'answered');
    assert.equal(f.engine.evaluate_proactive_message({ scope: 'u1', reasonId: 'r2' }).allowed, true);

    f.engine.queue_message({ id: 'uncertain', scope: 'u2', reasonId: 'r2', content: '已回复但传输结果未知' });
    f.engine.claim_message('uncertain');
    f.engine.record_interaction({ id: 'uncertain-input', scope: 'u2', direction: 'in' });
    f.engine.finish_message('uncertain', 'unknown');
    assert.equal(f.engine.db.prepare('SELECT status FROM outbound_messages WHERE id=?').get('uncertain').status, 'answered');

    f.engine.queue_message({ id: 'stale-acked', scope: 'u3', reasonId: 'r3', content: '回执丢失但已有回复' });
    f.engine.claim_message('stale-acked');
    f.engine.record_interaction({ id: 'stale-input', scope: 'u3', direction: 'in' });
    f.advance(11 * 60000); f.reopen();
    assert.equal(f.engine.db.prepare('SELECT status FROM outbound_messages WHERE id=?').get('stale-acked').status, 'answered');
    assert.equal(f.engine.claim_message('stale-acked'), null);
    assert.equal(f.engine.evaluate_proactive_message({ scope: 'u3', reasonId: 'r4' }).allowed, true);
  } finally { f.close(); }
});
test('schema version rejects incompatible stores and recognizes the exact initial schema', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronolife-schema-'));
  try {
    const file = path.join(dir, 'known.sqlite');
    const original = new ChronoLife({ dbPath: file, now: () => START });
    original.record_memory({ id: 'keep', scope: 'u1', text: '迁移保留' });
    original.db.exec('PRAGMA user_version=0'); original.close();
    const upgraded = new ChronoLife({ dbPath: file, now: () => START });
    assert.equal(upgraded.db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(upgraded.get_memory('u1', 'keep').text, '迁移保留');
    upgraded.db.exec('PRAGMA user_version=99'); upgraded.close();
    assert.throws(() => new ChronoLife({ dbPath: file }), /不支持.*99/);
    const check = new DatabaseSync(file);
    assert.equal(check.prepare('PRAGMA user_version').get().user_version, 99);
    check.exec('PRAGMA user_version=1; ALTER TABLE outbound_messages ADD COLUMN incompatible TEXT'); check.close();
    assert.throws(() => new ChronoLife({ dbPath: file }), /字段不兼容/);

    const foreignFile = path.join(dir, 'foreign.sqlite');
    const foreign = new DatabaseSync(foreignFile);
    foreign.exec('CREATE TABLE unrelated(id INTEGER)'); foreign.close();
    assert.throws(() => new ChronoLife({ dbPath: foreignFile }), /数据库表不兼容/);
    const inspect = new DatabaseSync(foreignFile);
    assert.equal(inspect.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n, 1);
    inspect.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('invalid pending reasons release reservations, temporary quiet hours preserve them', () => {
  const f = fixture({ proactive: true, cooldownHours: 0 });
  try {
    f.engine.record_memory({ id: 'old', scope: 'global', text: '即将变旧', source: 'virtual_event' });
    f.engine.queue_message({ id: 'stale-pending', scope: 'u1', reasonId: 'old', content: '旧话题' });
    f.advance(3 * DAY);
    f.engine.record_memory({ id: 'fresh', scope: 'global', text: '新的话题', source: 'virtual_event' });
    assert.equal(f.engine.evaluate_proactive_message({ scope: 'u1', reasonId: 'fresh' }).allowed, true);
    assert.equal(f.engine.db.prepare('SELECT status FROM outbound_messages WHERE id=?').get('stale-pending').status, 'cancelled');
    assert.equal(f.engine.queue_message({ id: 'fresh-pending', scope: 'u1', reasonId: 'fresh', content: '新话题' }), true);
    f.advance(12 * HOUR);
    assert.equal(f.engine.claim_message('fresh-pending'), null);
    assert.equal(f.engine.list_pending().length, 1);
    f.advance(12 * HOUR);
    assert.ok(f.engine.claim_message('fresh-pending'));

    f.engine.record_memory({ id: 'expiring', scope: 'u2', text: '马上失效', expires: f.time() + 1 });
    f.engine.queue_message({ id: 'expires', scope: 'u2', reasonId: 'expiring', content: '过期不可投递' });
    f.advance(2);
    assert.equal(f.engine.claim_message('expires'), null);
    assert.equal(f.engine.db.prepare('SELECT status FROM outbound_messages WHERE id=?').get('expires').status, 'cancelled');
  } finally { f.close(); }
});

test('real tool runs are observed shared events; recent_events lists them newest first and hides deleted ones', () => {
  let at = Date.UTC(2026, 9, 27, 4);
  const life = new ChronoLife({ dbPath: ':memory:', now: () => at });
  assert.ok(life.commit_observed_event({ id: 'explore:1', at: at - 2000, kind: 'explore', content: '刷了个修猫爬架的视频', scope: 'u1', source: 'virtual_event' }));
  assert.ok(life.commit_virtual_event({ id: 'activity:2', at: at - 1000, kind: 'sketch', content: '留下一个文字草稿' }));
  const ev = life.recent_events({ since: 0 });
  assert.deepEqual(ev.map((e) => e.id), ['activity:2', 'explore:1']);
  assert.equal(ev[1].source, 'observed');
  assert.equal(ev[1].scope, 'global');
  assert.equal(life.evaluate_proactive_message({ scope: 'u1', reasonId: 'explore:1', at }).reason, 'disabled'); // 主动分享默认关
  assert.ok(life.delete_memory('global', 'explore:1'));
  assert.deepEqual(life.recent_events({ since: 0 }).map((e) => e.id), ['activity:2']);
  life.close();
});
