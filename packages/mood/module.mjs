/**
 * 心情和作息：心情有来由、会延续（模型写 [心情:词|为啥]，这个心情持续几个小时；凌晨还在聊，第二天上午犯困）、
 * 作息被带偏（电脑的主人最近老熬夜 / 早睡，她的睡觉时段跟着挪）、被冷落（主动找了没回，对方隔好久才开口，这一轮带点小情绪）。
 * 设置：EMOTION、SLEEP_DRIFT / SLEEP_DRIFT_MAX、SULK / SULK_AFTER_MIN。
 * 睡觉时段本身（SLEEP_START / SLEEP_END）、找了几次没回就先不找（IGNORE_LIMIT）、“没回”计数（st.ignored）还在本体。
 * [心情] 标记由本体抠掉（没装这个插件也不会原样发出去），抠出来的心情本体交给这里的 setEmotion；按时段的日常心情、ChronoLife 的心情也在本体，
 * 这里在 state:mood 里把被事情影响的心情换上去。
 * 提供 mood 服务：setEmotion(mood, reason, chatKey)、inSleepHours(h)、sleepHour()、wakeHour()、sleepShift()。
 * 没装这个插件：心情只按时段（开着 ChronoLife 就跟着它），睡觉时段按 SLEEP_START~SLEEP_END 固定，被冷落也不带小情绪。
 */
export default function setup(api) {
  const { cfg, env, log, state, saveState, userState } = api;
  const { EVENT_MOODS, moodHours, computeRhythm, sleepDrift, clockOf } = api.human;
  Object.assign(cfg, {
    sulk: (env.SULK || 'true') !== 'false', // 被冷落后对方再开口，第一句带点小情绪
    sulkAfterMin: Number(env.SULK_AFTER_MIN ?? 120), // 主动消息发出后隔多久才回算“被冷落”
    emotion: (env.EMOTION || 'true') !== 'false', // 心情有来由、会延续（模型写 [心情:词|为啥]）
    sleepDrift: (env.SLEEP_DRIFT || 'false') === 'true', // 作息被带偏：电脑的主人最近老熬夜 / 早睡，她的睡觉时段跟着挪
    sleepDriftMax: Number(env.SLEEP_DRIFT_MAX ?? 2), // 最多被带晚几个小时（带早最多 1 小时）
  });

  // ── 睡觉时段 ────────────────────────────────────────────────────────────
  // 作息被带偏（SLEEP_DRIFT）：按电脑主人最近 7 天几点没动静算出挪几个小时（见下面 rhythm:times），睡觉时段整体跟着挪
  const sleepShift = () => (cfg.sleepDrift ? state._sleepDrift?.shift || 0 : 0);
  const sleepHour = () => (cfg.sleepStart + sleepShift() + 24) % 24;
  const wakeHour = () => (cfg.sleepEnd + sleepShift() + 24) % 24;
  function inSleepHours(h = new Date().getHours()) {
    const a = sleepHour();
    const b = wakeHour();
    return a <= b ? h >= a && h < b : h >= a || h < b;
  }

  // ── 心情有来由、会延续 ───────────────────────────────────────────────────
  // 聊天、自己找事做时，模型觉得心情变了就在最后写 [心情:词|为啥]（不发出去）→ 这个心情持续几个小时（moodHours），
  // 期间“此刻”、在线状态、/心情、想不想玩都跟着它走；过了就回到按时段的日常心情。
  // 凌晨 1~5 点还在聊：第二天 7 点到中午犯困（昨晚熬夜了）。
  // 为啥心情变了只告诉“惹出这事的那个聊天”，别的人只看得到心情本身。
  // 标记是本体抠的；开着 ChronoLife 时本体先让它记一笔（“没回”“冷落”这种由它自己管，就不传过来了），再调这里。
  function setEmotion(mood, reason, chatKey = '') {
    if (!cfg.emotion || !EVENT_MOODS.includes(mood)) return;
    const now = Date.now();
    state._emotion = { mood, reason: String(reason || '').slice(0, 40), chatKey, from: now, until: now + moodHours(mood) * 3600_000 };
    saveState();
    log(`心情：${mood}${reason ? `（${reason}）` : ''}`);
    api.use('presence')?.update().catch(() => {});
    api.use('presence')?.updateAvatar().catch(() => {});
  }
  function markStayedUp() {
    const h = new Date().getHours();
    if (!cfg.emotion || h < 1 || h >= 5) return;
    const wake = new Date();
    wake.setHours(7, 0, 0, 0);
    state._tired = { from: wake.getTime(), until: wake.getTime() + 5 * 3600_000 };
  }
  // 现在的她：本体算好按时段的日常心情（开着 ChronoLife 就跟着它，不会到这里），被事情影响了就换成那个心情（chatKey 是那件事的聊天才告诉为啥）
  api.on('state:mood', (s, chatKey) => {
    const now = Date.now();
    const e = state._emotion;
    const t = state._tired;
    if (cfg.emotion && e && now >= e.from && now < e.until) {
      s.mood = e.mood;
      if (e.reason && (!e.chatKey || e.chatKey === chatKey)) s.reason = e.reason;
    } else if (cfg.emotion && t && now >= t.from && now < t.until) {
      s.mood = '困';
      s.reason = '昨晚熬夜了';
      s.energy = Math.min(s.energy, 0.35);
      s.energyDesc = '有点没精神，懒得多说';
    }
    return s;
  });
  // 回完这一轮：凌晨还在聊就记一笔，第二天上午犯困（原来在本体 turn:answer 的 70）
  api.on('turn:answer', () => {
    markStayedUp();
  }, 70);
  const MOOD_TAG_HINT = '\n（聊着聊着心情真变了——被夸、被怼、听到好消息坏消息、对方难过——就在回复最后加个 [心情:心情词|为啥]，不会发出去；心情词只能用：开心、兴奋、平静、无聊、懒、嘴贫、烦、有点丧、委屈、生气、困。没变就别加。）';
  api.on('prompt:hint', () => (cfg.emotion ? MOOD_TAG_HINT : ''), 10);

  // ── 作息被带偏 ──────────────────────────────────────────────────────────
  // 记得你（memory 插件）按 bridge.log 算完大家的作息，把按 QQ 分好的消息时间交给这里（它算完才 saveState）。
  // 电脑主人最近 7 天几点没动静 → 她的睡觉时段跟着挪（至少要有 3 天的数据）。没装 memory 就不再挪（停在上次算的）
  api.on('rhythm:times', (per) => {
    if (cfg.sleepDrift) {
      const owner = api.owner();
      const recent = computeRhythm((per.get(owner) || []).filter((t) => Date.now() - t < 7 * 86400_000), 3);
      const shift = recent ? sleepDrift(cfg.sleepStart, recent.sleep, cfg.sleepDriftMax) : 0;
      const prev = state._sleepDrift?.shift || 0;
      state._sleepDrift = { shift, ownerSleep: recent ? clockOf(recent.sleep) : '', at: Date.now() };
      if (shift !== prev) log(`作息：${shift > 0 ? `被带得晚睡 ${shift} 小时` : shift < 0 ? `被带得早睡 ${-shift} 小时` : '回到原来的点'}（对方最近 ${state._sleepDrift.ownerSleep || '?'} 左右没动静）`);
    }
  });
  // 【此刻】那段里：被主人带偏了，她心里知道（order 10，在今天是个日子、天气前面）
  api.on('prompt:state', (qq) =>
    qq && sleepShift() && String(qq) === api.owner()
      ? `\n你最近被对方带得${sleepShift() > 0 ? '睡晚了' : '早睡了'}，现在大概 ${sleepHour()} 点才犯困（对方最近 ${state._sleepDrift?.ownerSleep || '?'} 左右才没动静）；偶尔可以抱怨一句“都怪你”。`
      : '', 10);

  // ── 被冷落 ──────────────────────────────────────────────────────────────
  // 主动找了对方、隔了好久（默认 2 小时）才回，这一轮带点小情绪；刚发完马上回的不算被冷落。
  // “没回”计数 st.ignored 是本体的（主动找你、自己找事做分享时加，对方一开口本体清零）：message:user 里还是清零前的数
  api.on('message:user', (ev, st) => {
    if (cfg.chronolife) st.sulk = 0;
    else if (st.ignored && cfg.sulk && Date.now() - (st.lastProactiveAt || 0) > cfg.sulkAfterMin * 60_000) st.sulk = st.ignored;
  });
  function sulkBlockOf(qq) {
    const sulk = cfg.chronolife ? 0 : userState(qq).sulk || 0;
    return sulk ? `\n\n---\n你之前主动找过对方 ${sulk} 次，对方都没理你，现在才冒出来。可以带一点小情绪（阴阳一句、假装不在意、委屈一下都行），一两句就过去，别真生气、别翻旧账。` : '';
  }
  api.on('prompt:context-late', (t) => sulkBlockOf(t.qq), 180);
  // 小情绪只带这一轮：原来在本体回完这一轮（turn:after 全跑完）之后清，这里排在 turn:after 最后，之后本体 saveState
  api.on('turn:after', (t) => {
    userState(t.ev.user_id).sulk = 0;
  }, 10_000);

  api.provide('mood', { setEmotion, inSleepHours, sleepHour, wakeHour, sleepShift });

  // ── 启动日志（原来在 main 段末尾）────────────────────────────────────────
  if (cfg.sleepDrift) log(`作息被带偏: 按 ${api.owner() || '（没设）'} 最近 7 天几点没动静挪她的睡觉时段（最多晚 ${cfg.sleepDriftMax} 小时、早 1 小时）`);
}
