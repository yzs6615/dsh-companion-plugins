#!/usr/bin/env node
/** Minimal stand-in for `dsh --profile headless --json`, used by the e2e test. */
const args = process.argv.slice(2);
const si = args.indexOf('--session-id');
const sid = si >= 0 ? args[si + 1] : null;
const prompt = args[args.length - 1] || '';
const sessionId = sid || `session-fake-${Date.now()}`;
// FAKE_PROMPT_LOG：每一轮的提示词都记一行（测人设怎么进的提示词）
if (process.env.FAKE_PROMPT_LOG) (await import('node:fs')).appendFileSync(process.env.FAKE_PROMPT_LOG, JSON.stringify(prompt) + '\n');
// buildPrompt() prepends persona + memory; echo only the actual user line.
const m = prompt.match(/对方刚说：\s*\n([\s\S]*?)(?:\n\n（|$)/);
const userText = (m ? m[1] : prompt).trim();
let reply = `[fake] 收到: ${userText} (会话 ${sessionId})`;
// SLOW<毫秒>：这一轮要跑这么久（像看视频、弄手机），测“她还在回上一条，对方又发消息”
const slow = userText.match(/SLOW(\d+)/);
if (slow) await new Promise((r) => setTimeout(r, Number(slow[1])));
// 测试用的暗号：让假模型按需吐出表情标签 / 事实提炼 JSON / 带上“记得的事”。
if (prompt.includes('的深夜电台」第')) {
  // 电台写稿：把提示词存一份给测试看（素材带对没有、群里有没有私事）；RADIO_BADJSON 第一遍故意写坏
  if (process.env.FAKE_PROMPT_DUMP) (await import('node:fs')).appendFileSync(process.env.FAKE_PROMPT_DUMP, JSON.stringify(prompt) + '\n');
  const short = prompt.includes('这是一分钟版');
  reply = prompt.includes('RADIO_BADJSON') && !prompt.includes('上一遍没按格式写')
    ? '我想想 这期聊下雨天吧'
    : '```json\n' + JSON.stringify({
      title: prompt.includes('听众投稿（') ? '念念你的投稿' : prompt.includes('你是这么说的') ? '接着上期聊' : '下雨天别急着emo',
      parts: short
        ? ['哎 今晚就一分钟啊。', '下雨天我刚刷到个视频 一个人踩水坑踩得特别开心 我看了半天。', '推荐一首雨天 孙燕姿的 就是觉得搭。', '行 就这么多 去睡吧。']
        : ['哎 这么晚还点我节目 行吧😂（笑）', '我今天刷B站看了个修猫爬架的视频，UP主嘴特别贫，弹幕都在刷典。'.repeat(5), '这期推荐一首雨天，孙燕姿的，下雨天听正好。', '行 就聊到这 我去吃宵夜了。'],
      song: { title: '雨天', artist: prompt.includes('RADIO_WRONGSINGER') ? '不存在的歌手' : '孙燕姿', why: '下雨天听' },
      line: '鞋湿了就笑一声',
      diary: '录了一期下雨天的',
    }) + '\n```';
} else if (prompt.includes('整理自己对一个朋友的长期记忆')) {
  const at = new Date(Date.now() - 10 * 60_000);
  const p = (n) => String(n).padStart(2, '0');
  const due = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}:${p(at.getMinutes())}`;
  reply = JSON.stringify({ add: ['喜欢吃辣'], drop: [], followups: [{ ask: '问问考试考得怎么样', at: due }], style: ['爱说“草”', '句尾老带“捏”'] });
} else if (prompt.includes('睡前回想自己最近干了啥')) {
  reply = JSON.stringify({
    add: [{ kind: '喜好', t: '爱看修东西的视频' }, { kind: '梗', t: '最近老想说『典』' }, { kind: '乱写', t: '不该被收' }, { kind: '观点', t: '我是个AI模型' }],
    reinforce: ['无聊就刷B站'],
    drop: [],
  });
} else if (prompt.includes('你在写今天（')) {
  // 日记：每个方括号编号写一行 DIARY_WITH_<编号>；混进 AI 字样的会被丢掉
  const keys = [...new Set((prompt.match(/\[(u\d+)\]/g) || []).map((x) => x.slice(1, -1)))];
  reply = JSON.stringify({ day: 'DIARY_DAY 今天还行 刷了会儿东西', with: Object.fromEntries([...keys.map((k) => [k, `DIARY_WITH_${k}`]), ['u999', '不存在的人'], ['bad', '我是AI']]), sign: '今天也在摸鱼' });
} else if (prompt.includes('对方刚把一条消息撤回了')) {
  reply = '撤回了啥 我都看到了';
} else if (prompt.includes('现在没人找你')) {
  // 自己找事做：可以故意慢一点（测“被打断”）；记得对方喜欢猫就分享，最后带日记和心情
  if (process.env.FAKE_AUTONOMY_DELAY) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_AUTONOMY_DELAY)));
  reply = (prompt.includes('你记得对方的事') && prompt.includes('LIKES_CATS') ? 'FORYOU 看到这个猫视频就想到你 BV1xx411c7mD' : '[SILENT]') + '\n[日记:刷到一个猫视频 笑死]\n[心情:开心|刷到可爱的猫]';
} else if (prompt.includes('你昨晚做了个梦，现在醒了')) {
  reply = '梦见你在考场里泡泡面 监考老师是条鲸鱼';
} else if (prompt.includes('你在给对方写一封信')) {
  reply = JSON.stringify({ to: '阿青：', body: 'LETTERBODY 这周你可真忙。\n下周见。', say: '给你写了封信' });
} else if (prompt.includes('你刚才在自己的小屋里')) {
  reply = prompt.includes('留下的文字草稿') ? 'SKETCHNOTE 雨落在窗台上像谁在小声数数' : 'LIFENOTE 记了一笔';
} else if (prompt.includes('你想跟对方随口分享一件你自己小屋里刚发生的事')) {
  reply = `LIFESHARE ${prompt.includes('SKETCHNOTE') ? '刚写了句雨的' : '没看到细节'}`;
} else if (prompt.includes('你在发一条 QQ 空间说说')) {
  reply = prompt.includes('NAMELEAK') ? 'QZONELINE 跟阿青去吃了火锅' : 'QZONELINE 今天刷到一个修猫爬架的视频 笑死';
} else if (prompt.includes('给对方寄一张明信片')) {
  reply = JSON.stringify({ to: '阿青：', body: 'POSTCARDBODY 鼓浪屿的猫比人还多', say: '给你寄了张明信片' });
} else if (prompt.includes('你住在对方这台电脑里，刚注意到')) {
  reply = `PCLINE ${prompt.includes('这周已经放了') ? '又是这首' : '在听这个啊'}`;
} else if (prompt.includes('在对方桌面上留一张便条')) {
  reply = 'NOTE 冰箱里还有半个西瓜 记得吃';
} else if (prompt.includes('用电脑喇叭直接跟对方说一句')) {
  reply = 'SPEAK 回来啦';
} else if (userText.includes('PHOTOME')) {
  reply = '在刷手机 [照片]';
} else if (userText.includes('GIFTME')) {
  reply = '谢谢 我摆起来 [收礼物:绿萝]';
} else if (userText.includes('PLAYSONG')) {
  reply = '行 给你放 [放歌:晴天 周杰伦]';
} else if (userText.includes('RADIOTAG')) {
  reply = '行 等我录一下 [电台:一分钟|下雨天]';
} else if (userText.includes('RADIOSUB')) {
  reply = '行 我念 [电台:投稿]';
} else if (userText.includes('SCAREDVOICE')) {
  reply = '啊 你别吓我 [语音:害怕]';
} else if (userText.includes('TONEHAPPY')) {
  reply = '嘿嘿 [语音:开心]';
} else if (userText.includes('ANGERME')) {
  reply = '你还知道来找我啊 [语音] [心情:生气|等了一下午]';
} else if (userText.includes('PRAISE')) {
  reply = '嘿嘿 那当然 [心情:开心|被对方夸了]';
} else if (userText.includes('ASKME')) {
  reply = '今天累死了\n你吃饭了没';
} else if (userText.includes('MEANSTICKER')) {
  reply = '行 [表情:无语翻白眼]';
} else if (userText.includes('NOMATCHSTICKER')) {
  reply = '行 [表情:吃饭饭]';
} else if (prompt.includes('请总结 TA 的说话风格')) {
  // 素材里混进了不该学的人的话，就返回一个会被测试抓到的标记
  reply = prompt.includes('ASHENG_LINE')
    ? JSON.stringify({ traits: ['LEAK_OTHER_PERSON'], examples: [] })
    : JSON.stringify({ traits: ['句尾爱加“捏”', '夸人只会说“绝了”', '不爱打标点'], examples: ['绝了捏', '6'] });
} else if (prompt.includes('你想起一件事，顺口问一句')) {
  reply = '考得咋样啊';
} else if (userText.includes('SINGUNKNOWN')) {
  reply = '行 [唱歌:不存在的歌]';
} else if (userText.includes('SING')) {
  reply = '行吧 给你唱两句 [唱歌:第一天]';
} else if (userText.includes('LONGVOICE')) {
  reply = '[语音] ' + '这句话特别特别长'.repeat(12);
} else if (userText.includes('VOICE')) {
  reply = '哈哈哈（笑）你好呀 [语音] [表情:开心]';
} else if (userText.includes('STICKERS')) {
  reply = '行 [表情:开心] [表情:开心]';
} else if (userText.includes('TYPO')) {
  reply = '我现在就去看看吧';
} else if (prompt.includes('你记得关于这个人的事')) {
  reply += ' [有记忆]';
}
if (!prompt.includes('整理自己对一个朋友的长期记忆') && !prompt.includes('你想起一件事，顺口问一句') && !prompt.includes('睡前回想自己最近干了啥') && !prompt.includes('请总结 TA 的说话风格') && !prompt.includes('你在写今天（') && !prompt.includes('现在没人找你') && !prompt.includes('的深夜电台」第') && !userText.includes('TYPO') && !prompt.includes('你昨晚做了个梦，现在醒了') && !prompt.includes('你在给对方写一封信') && !prompt.includes('你住在对方这台电脑里，刚注意到') && !prompt.includes('在对方桌面上留一张便条') && !prompt.includes('用电脑喇叭直接跟对方说一句') && !prompt.includes('给对方寄一张明信片') && !prompt.includes('你在发一条 QQ 空间说说') && !prompt.includes('你刚才在自己的小屋里') && !prompt.includes('你想跟对方随口分享一件你自己小屋里刚发生的事')) {
  // TYPO 那句要原样回：后面拼了“[只知道开心]”这种标记（她的默认心情随时段变），手滑测试就对不上了
  if (prompt.includes('对方说话的习惯')) reply += ' [有口头禅]';
  if (prompt.includes('最近的你（')) reply += ' [有自我]';
  if (prompt.includes('你最近好多句都没发表情包了')) reply += ' [该发表情]';
  if (prompt.includes('被 TA 的说话方式带跑偏了')) reply += ' [在学说话]';
  if (prompt.includes('已经被带得挺明显了') && prompt.includes('绝了捏')) reply += ' [学到位]';
  if (prompt.includes('主动找过对方')) reply += ' [有小情绪]';
  if (prompt.includes('你学会唱的歌：第一天')) reply += ' [知道会唱]';
  if (prompt.includes('对方刚把一段聊天记录合并转发给你') && prompt.includes('XM 今天绝了')) reply += ' [看到转发]';
  if (prompt.includes('你最近几天的日记') && prompt.includes('DIARY_DAY')) reply += ' [有日记]';
  if (prompt.includes('OLD_WITH_A')) reply += ' [旧日记A]';
  if (prompt.includes('张图片，已保存到')) reply += ' [有图]';
  if (prompt.includes('今天是你们认识的第 100 天')) reply += ' [纪念日]';
  if (prompt.includes('心情开心（因为被对方夸了）')) reply += ' [知道为啥开心]';
  else if (prompt.includes('心情开心，')) reply += ' [只知道开心]';
  if (prompt.includes('你这会儿正在')) reply += prompt.includes('你这会儿正在录电台') ? ' [在录电台]' : ' [正在忙]';
  if (prompt.includes('你自己弄了个小节目')) reply += prompt.includes('录到第 ') ? ' [知道上期]' : ' [知道电台]';
  if (prompt.includes('你对对方还不太了解')) reply += ' [好奇]';
  if (prompt.includes('你注意到：对方平时')) reply += ' [作息]';
  if (prompt.includes('今天是对方生日')) reply += ' [生日]';
  if (prompt.includes('对方那边的天气')) reply += prompt.includes('合适的时候顺口提醒一句') ? ' [提醒天气]' : ' [有天气]';
  if (prompt.includes('OLD_WITH_B')) reply += ' [旧日记B]';
  for (const m of prompt.match(/DIARY_WITH_u\d+/g) || []) reply += ` [日记:${m.slice(11)}]`;
  if (prompt.includes('（表情包）')) reply += ' [看到表情包]';
  if (prompt.includes('【这台电脑上】')) reply += ' [电脑上]';
  if (prompt.includes('你昨晚做了个梦：')) reply += ' [有梦]';
  if (prompt.includes('会拍一张你现在的样子')) reply += ' [提示照片]';
  if (prompt.includes('你能用对方电脑上的 QQ 音乐放歌')) reply += ' [能放歌]';
  if (prompt.includes('给对方寄了张明信片，这次回完话会一起发过去')) reply += ' [有明信片]';
  if (prompt.includes('对方要送你东西')) reply += ' [提示礼物]';
  if (prompt.includes('你房间里摆着对方送你的：绿萝')) reply += ' [有礼物]';
  if (prompt.includes('你自己小屋里的近况')) reply += ' [小屋]';
  if (prompt.includes('SKETCHNOTE')) reply += ' [有细节]';
  if (/可信度|virtual_event|\[ChronoLife/.test(prompt)) reply += ' [机器字段]';
  if (userText.includes('STEAL')) reply += ' [收表情:开心]'; // 不管是不是表情包都要收：测 bridge 自己会不会把关
}

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
emit({ type: 'session', sessionId });
emit({ type: 'status', phase: 'turn_end', turn: 1, reason: { kind: 'completed' } });
emit({ type: 'final', text: reply });
process.exit(0);
