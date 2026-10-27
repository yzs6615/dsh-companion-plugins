#!/usr/bin/env node
/** human.mjs 的纯函数单测（不碰网络，不花钱）。 */
import assert from 'node:assert/strict';
import {
  extractStickers,
  extractDiary,
  typingDelayMs,
  mergeWaitMs,
  nowDesc,
  selfState,
  playChance,
  familiarity,
  makeTypo,
  ackKind,
  looksLikeQuestion,
  askedSomething,
  isLeaving,
  chooseActivity,
  extractMoodTag,
  moodHours,
  computeRhythm,
  rhythmNote,
  sleepDrift,
  clockOf,
  unknownTopics,
  chimeWeight,
  parseJsonLoose,
  parseLocalTime,
  seededRand,
  extractVoice,
  voiceTone,
  VOICE_TONES,
} from '../packages/core/kernel/human.mjs';

const logicalMin = (h, m = 0) => (h * 60 + m - 300 + 1440) % 1440; // computeRhythm 那种从 5 点算起的分钟
let failed = 0;
const t = (name, fn) => {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
};

t('extractStickers: 两个相同标签只留一个情绪，且文字里没有残留', () => {
  const r = extractStickers('行 不消失 灌完还回来 [表情:委屈] [表情:委屈]');
  assert.deepEqual(r.moods, ['委屈']);
  assert.equal(r.text, '行 不消失 灌完还回来');
});
t('extractStickers: 不同情绪按出现顺序，全角冒号也行', () => {
  const r = extractStickers('[表情：得意]啊这 [表情:无语]');
  assert.deepEqual(r.moods, ['得意', '无语']);
  assert.equal(r.text, '啊这');
});
t('extractStickers: 没标签原样返回', () => {
  const r = extractStickers('在');
  assert.deepEqual(r, { text: '在', moods: [] });
});
t('extractDiary: 取走日记标签', () => {
  const r = extractDiary('看到个好玩的 [日记:刷了会儿B站]');
  assert.equal(r.diary, '刷了会儿B站');
  assert.equal(r.text, '看到个好玩的');
});
t('typingDelayMs: 越长越久、封顶、perChar=0 关闭', () => {
  const fixed = () => 0.5;
  assert.ok(typingDelayMs('在', 130, fixed) < typingDelayMs('这是一句比较长的话啊啊啊', 130, fixed));
  assert.ok(typingDelayMs('字'.repeat(500), 130, fixed) <= 6000);
  assert.equal(typingDelayMs('随便', 0), 0);
});
t('mergeWaitMs: 句子收尾少等，没说完多等', () => {
  assert.ok(mergeWaitMs('你好吗？', false, 3000) < mergeWaitMs('你好', false, 3000));
  assert.equal(mergeWaitMs('x', false, 0), 0);
});
t('nowDesc: 星期、时段、节日', () => {
  assert.match(nowDesc(new Date(2026, 9, 23, 15, 20)), /2026-10-23 星期五 15:20（下午）/);
  assert.match(nowDesc(new Date(2026, 9, 1, 9, 0)), /国庆节/);
});
t('selfState: 同一时段稳定，深夜精力低', () => {
  const a = selfState(new Date(2026, 9, 23, 15, 5));
  const b = selfState(new Date(2026, 9, 23, 15, 55));
  assert.equal(a.mood, b.mood);
  assert.ok(selfState(new Date(2026, 9, 23, 3, 0)).energy < 0.4);
  assert.ok(selfState(new Date(2026, 9, 23, 10, 0)).energy > 0.6);
});
t('seededRand: 同种子同序列', () => {
  const x = seededRand('abc');
  const y = seededRand('abc');
  assert.equal(x(), y());
  assert.equal(x(), y());
});
t('familiarity: 分档递增', () => {
  assert.equal(familiarity(0).tier, '刚认识');
  assert.equal(familiarity(10).tier, '一般熟');
  assert.equal(familiarity(40).tier, '熟');
  assert.equal(familiarity(200).tier, '很熟');
});
t('makeTypo: 换同音字并给出 *补正', () => {
  const r = makeTypo('我现在就去看看', () => 0);
  assert.ok(r);
  assert.notEqual(r.typo, '我现在就去看看');
  assert.match(r.fix, /^\*.$/);
  assert.equal([...r.typo].length, 7);
});
t('makeTypo: 太短 / 带代码或链接 / 没有可换的字都不出错', () => {
  assert.equal(makeTypo('在'), null);
  assert.equal(makeTypo('执行 npm install 看一下'), null);
  assert.equal(makeTypo('看 https://a.com 这个'), null);
  assert.equal(makeTypo('哈哈哈哈哈哈'), null);
});
t('ackKind: 附和 / 笑 / 正经话', () => {
  assert.equal(ackKind('嗯嗯'), 'ok');
  assert.equal(ackKind('好的~'), 'ok');
  assert.equal(ackKind('哈哈哈哈'), 'laugh');
  assert.equal(ackKind('好的我明天去'), '');
  assert.equal(ackKind('晚安'), '');
});
t('looksLikeQuestion', () => {
  assert.ok(looksLikeQuestion('要我现在去看吗？'));
  assert.ok(looksLikeQuestion('要不要现在弄'));
  assert.ok(!looksLikeQuestion('行 我去弄'));
});
t('chimeWeight: 问句和笑点权重更高', () => {
  assert.ok(chimeWeight('这个怎么办？') > chimeWeight('今天吃了饭'));
});
t('parseJsonLoose: 围栏、前后废话、坏 JSON', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('好的：{"add":["x"]} 完事'), { add: ['x'] });
  assert.equal(parseJsonLoose('没有 json'), null);
  assert.equal(parseJsonLoose('{坏的}'), null);
});
t('parseLocalTime', () => {
  assert.equal(parseLocalTime('2026-10-24 18:30'), new Date(2026, 9, 24, 18, 30).getTime());
  assert.equal(parseLocalTime('2026-10-24'), new Date(2026, 9, 24, 9, 0).getTime());
  assert.equal(parseLocalTime('明天'), 0);
});

t('chooseActivity: 不挑上一次的，今天干过的少挑', () => {
  const pool = [{ id: 'bili', w: 3 }, { id: 'zhihu', w: 2 }, { id: 'music', w: 2 }];
  const count = { bili: 0, zhihu: 0, music: 0 };
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 3000; i++) count[chooseActivity(pool, 'bili', ['zhihu', 'zhihu', 'zhihu'], rand).id]++;
  assert.equal(count.bili, 0); // 上一次刚刷过 B站：这次不挑
  assert.ok(count.music > count.zhihu * 2.5); // 知乎今天刷了三次：权重只剩四分之一
  assert.equal(chooseActivity([{ id: 'bili', w: 3 }], 'bili').id, 'bili'); // 只有一个就只能是它
});

t('extractMoodTag: 拿出心情和为啥，标记一律不发出去', () => {
  assert.deepEqual(extractMoodTag('嘿嘿 那当然 [心情:开心|被夸了]'), { text: '嘿嘿 那当然', mood: '开心', reason: '被夸了' });
  assert.deepEqual(extractMoodTag('哼 [心情：委屈]'), { text: '哼', mood: '委屈', reason: '' });
  assert.deepEqual(extractMoodTag('行吧 [心情:超级开心|乱写的]'), { text: '行吧', mood: '', reason: '' }); // 不认识的心情词：去掉但不算
  assert.ok(moodHours('生气') > moodHours('无聊'));
});

t('computeRhythm / rhythmNote: 平时几点冒头几点没动静，晚睡早起能看出来', () => {
  const at = (d, h, m = 0) => new Date(2026, 9, 10 + d, h, m).getTime();
  const times = [];
  for (let d = 0; d < 5; d++) times.push(at(d, 9, 30), at(d, 14), at(d, 23, 40), at(d + 1, 0, 20)); // 凌晨 0:20 算前一天
  const r = computeRhythm(times);
  assert.equal(clockOf(r.wake), '9:30');
  assert.equal(clockOf(r.sleep), '0:20');
  assert.equal(computeRhythm(times.slice(0, 8)), null); // 不够 4 天不算
  assert.equal(rhythmNote(at(6, 2, 0), r)?.kind, 'late'); // 平时 0:20 就没动静，今天 2 点还在
  assert.equal(rhythmNote(at(6, 0, 30), r), null); // 差不多的点：不算
  assert.equal(rhythmNote(at(6, 7, 40), r, at(6, 7, 30))?.kind, 'early'); // 平时 9:30 才冒头，今天 7:30
});

t('sleepDrift: 对方最近老熬夜/早睡，她的睡觉时间被带偏一大半，有上限', () => {
  const at = (h, m = 0) => logicalMin(h, m);
  assert.equal(sleepDrift(1, at(3, 30)), 2); // 她 1 点睡，对方 3 点半才没动静 → 晚 2 小时
  assert.equal(sleepDrift(1, at(6, 0)), 2); // 再晚也最多 2 小时
  assert.equal(sleepDrift(1, at(1, 20)), 0); // 差不多：不挪
  assert.equal(sleepDrift(1, at(23, 0)), -1); // 对方 11 点就睡了 → 早 1 小时
  assert.equal(sleepDrift(1, at(21, 0)), -1); // 再早也最多 1 小时
  assert.equal(sleepDrift(1, undefined), 0);
});

t('unknownTopics: 记住的事里没提到的方面', () => {
  const ids = (f, x) => unknownTopics(f, x).map((t) => t.id);
  assert.deepEqual(ids(['在读大学，学计算机', '喜欢吃辣'], {}), ['city', 'hobby', 'pet', 'birthday']);
  assert.deepEqual(ids(['家里养了只猫', '平时爱玩原神'], { city: '杭州', birthday: '05-20' }), ['job', 'food']);
});

t('extractVoice / voiceTone: [语音:语气]，认得的语气才算', () => {
  assert.deepEqual(extractVoice('别吓我 [语音:害怕]'), { text: '别吓我', voice: true, tone: '害怕' });
  assert.deepEqual(extractVoice('在呢 [语音]'), { text: '在呢', voice: true, tone: '' });
  assert.equal(extractVoice('嘿嘿 [语音:开心]').tone, '平常'); // 开心没做：点了就用平常的嗓子
  assert.equal(extractVoice('没标记').voice, false);
  assert.equal(voiceTone('伤心'), '难过');
  assert.equal(voiceTone('烦'), '嫌弃');
  assert.equal(voiceTone('开心'), '');
  assert.ok(VOICE_TONES.生气.includes('angry') && !('开心' in VOICE_TONES));
});

t('askedSomething / isLeaving: 问了一句 / 说了要走开', () => {
  assert.ok(askedSomething('今天好累\n你吃饭了没'));
  assert.ok(askedSomething('那你明天去不去？'));
  assert.ok(askedSomething('周末出去玩 要不要一起'));
  assert.ok(!askedSomething('你问我吗\n我也不知道'));
  assert.ok(!askedSomething('行吧 [表情:无语]'));
  assert.ok(isLeaving('我先去洗澡了'));
  assert.ok(isLeaving('晚安'));
  assert.ok(!isLeaving('洗澡的时候想到个事'));
});

t('playChance: 无聊比困更想玩，夹在 5%-90%', () => {
  assert.ok(playChance({ mood: '无聊', energy: 0.9 }) > playChance({ mood: '困', energy: 0.9 }));
  assert.ok(playChance({ mood: '平静', energy: 0.9 }) > playChance({ mood: '平静', energy: 0.1 }));
  assert.equal(playChance({ mood: '困', energy: 0.05 }, 0.1), 0.05);
  assert.equal(playChance({ mood: '无聊', energy: 1 }, 1), 0.9);
});

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
