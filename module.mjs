/**
 * QQ 上的样子：在线状态跟着作息和心情变、自定义在线状态、个性签名（日记写完换）、心情头像、QQ 空间说说和 /说说。
 * 设置：ONLINE_STATUS、LONGNICK、DIY_STATUS、MOOD_AVATAR / MOOD_AVATAR_MAX_DAY / MOOD_AVATAR_GAP_MIN / MOOD_AVATAR_DIR、
 * QZONE / QZONE_PROB / QZONE_HOURS / QZONE_RIGHT / QZONE_CHECK_MS。
 * 提供 presence 服务：setBusy / clearBusy（唱歌、自己找事做时挂“听歌中”“摸鱼中”）、setLongnick（日记写完换个签）、
 * update（心情变了马上改在线状态）、updateAvatar（心情变了换头像）。没装这个插件，这些都直接跳过。
 */
import fs from 'node:fs';
import path from 'node:path';

export default function setup(api) {
  const { cfg, env, log, state, saveState, sendRaw, reply, persona, runAgent, humanize, addDiary, myState, DATA_DIR } = api;
  const { dayKey } = api.human;
  Object.assign(cfg, {
    onlineStatus: (env.ONLINE_STATUS || 'true') !== 'false', // QQ 在线状态跟着作息和心情变（睡觉中/摸鱼中/元气满满…）
    longnick: (env.LONGNICK || 'true') !== 'false', // 每晚写完日记顺手改一句个性签名
    diyStatus: (env.DIY_STATUS || 'false') === 'true', // 自定义在线状态：名字旁边写她自己的一句话（在干嘛 / 陪你听什么 / 心情），没有具体的事就用预设的
    moodAvatar: (env.MOOD_AVATAR || 'false') === 'true', // 心情头像：心情变了换 QQ 头像（图放 data/avatars/，按心情起名）
    moodAvatarMaxDay: Number(env.MOOD_AVATAR_MAX_DAY ?? 4), // 一天最多换几次（换太勤小号容易被风控）
    moodAvatarGapMin: Number(env.MOOD_AVATAR_GAP_MIN ?? 90), // 两次之间至少隔多少分钟
    // QQ 空间说说：偶尔把自己最近干的事发一条（只写她自己的事，不写聊天内容和人名）；开着 ChronoLife 时只用它记下的虚拟事件
    qzone: (env.QZONE || 'false') === 'true',
    qzoneProb: Number(env.QZONE_PROB ?? 0.012), // QZONE_HOURS 里每次检查发一条的概率（10 分钟看一次，大概两天一条；一天最多一条）
    qzoneHours: (env.QZONE_HOURS || '12-22').split('-').map(Number),
    qzoneRight: Number(env.QZONE_RIGHT ?? 4), // 谁能看：1 所有人，4 好友，64 仅自己
    qzoneCheckMs: Number(env.QZONE_CHECK_MS ?? 600_000),
  });
  // 睡觉时段（心情和作息，mood 插件，作息被带偏时会挪）：没装就按 SLEEP_START~SLEEP_END 固定。
  // 自己找事做、ChronoLife 那几组还在本体里，先从 api 上的过渡取值函数拿；电脑上的事走 pc 服务（没装就当不知道）
  const sleepHour = () => api.use('mood')?.sleepHour() ?? (cfg.sleepStart + 24) % 24;
  const wakeHour = () => api.use('mood')?.wakeHour() ?? (cfg.sleepEnd + 24) % 24;
  function inSleepHours(h = new Date().getHours()) {
    const a = sleepHour();
    const b = wakeHour();
    return a <= b ? h >= a && h < b : h >= a || h < b;
  }
  // 跟本体里的一样：ChronoLife 的活动名去掉“虚拟”两个字
  const unVirtual = (t) => String(t || '').replace(/虚拟的?/g, '');

  // ── QQ 在线状态 + 个性签名：点开她的资料就能看出她今天怎么样 ─────────────────
  // 在线状态：睡觉时段“睡觉中”，23 点到 1 点“熬夜中”，自己找事做时“摸鱼中”，唱完歌“听歌中”，
  // 其他时候跟着心情（无聊中 / 悠哉哉 / 元气满满 / 想静静 / 一言难尽 / 被掏空 / 在线）。只在变了的时候才去改。
  // 个签：每晚写日记时让它顺手写一句（所有人都看得到，所以不许带人名和私事），写完就换上。
  const STATUS_CODES = {
    在线: [10, 0], 睡觉中: [10, 1016], 熬夜中: [10, 1032], 摸鱼中: [10, 1300], 无聊中: [10, 1060], 悠哉哉: [10, 1059],
    元气满满: [10, 1058], 想静静: [10, 1061], 一言难尽: [10, 1063], 被掏空: [10, 2014], 听歌中: [10, 1028],
  };
  const MOOD_STATUS = { 无聊: '无聊中', 懒: '悠哉哉', 开心: '元气满满', 兴奋: '元气满满', 有点丧: '想静静', 委屈: '想静静', 烦: '一言难尽', 生气: '一言难尽', 困: '被掏空' };
  const presence = { busy: '', busyUntil: 0, fails: 0, off: false, diyFails: 0, diyOff: false };
  function pickPresence() {
    const h = new Date().getHours();
    if (presence.busy && Date.now() < presence.busyUntil) return presence.busy;
    if (inSleepHours(h)) return '睡觉中';
    const toBed = (sleepHour() - h + 24) % 24;
    if (toBed > 0 && toBed <= 2) return '熬夜中';
    return MOOD_STATUS[myState().mood] || '在线';
  }
  // 自定义在线状态（DIY_STATUS）：有具体的事时，名字旁边写她自己的一句话，没有就用上面的预设。
  // 优先级：ChronoLife 里正在做的事 > 自己找事做 > 刚唱完歌 > 电脑主人正在放的歌 > 心情。睡觉时段还是预设的“睡觉中”。
  const MOOD_WORDING = { 无聊: ['好无聊啊', 21], 懒: ['躺平中', 21], 开心: ['今天心情不错', 13], 兴奋: ['嘿嘿嘿', 13], 嘴贫: ['想找人斗嘴', 12], 有点丧: ['有点丧', 5], 委屈: ['有点委屈', 5], 烦: ['烦死了', 11], 生气: ['别惹我', 11], 困: ['困死了', 8] };
  function pickDiyStatus() {
    if (!cfg.diyStatus || presence.diyOff || inSleepHours()) return null;
    const life = api.lifeState();
    if (life?.mode === 'activity' && life.activity) return { wording: unVirtual(life.activity), face: 21 };
    const doingName = api.doingName();
    if (doingName) return { wording: `在${doingName}`, face: 21 };
    if (presence.busy === '听歌中' && Date.now() < presence.busyUntil) return { wording: '在听歌', face: 14 };
    const pcNow = api.use('pc')?.now();
    const song = cfg.pcBuddy && pcNow?.music && Date.now() - pcNow.at < 10 * 60_000 ? pcNow.music.title.split(/ [-–] /)[0] : '';
    if (song) return { wording: `陪你听：${song}`, face: 14 };
    const w = MOOD_WORDING[myState().mood];
    return w ? { wording: w[0], face: w[1] } : null;
  }
  async function updatePresence(force = false) {
    if (!cfg.onlineStatus || presence.off || !api.online()) return;
    const diy = pickDiyStatus();
    const name = diy ? `diy:${diy.wording.slice(0, 12)}` : pickPresence();
    const p = state._presence || (state._presence = {});
    if (!force && p.name === name && Date.now() - (p.at || 0) < 6 * 3600_000) return;
    if (!force && diy && String(p.name || '').startsWith('diy:') && Date.now() - (p.at || 0) < 10 * 60_000) return; // 自己的话 10 分钟内别换来换去
    try {
      if (diy) {
        await sendRaw({ action: 'set_diy_online_status', params: { face_id: String(diy.face), face_type: '1', wording: name.slice(4) } });
      } else {
        const [status, ext] = STATUS_CODES[name];
        await sendRaw({ action: 'set_online_status', params: { status, ext_status: ext, battery_status: 0 } });
      }
      Object.assign(p, { name, at: Date.now() });
      presence.fails = 0;
      saveState();
      log(`在线状态：${diy ? `“${name.slice(4)}”` : name}`);
    } catch (err) {
      if (diy) {
        if (++presence.diyFails >= 3) {
          presence.diyOff = true;
          log(`自定义在线状态连续改不成，这次运行先用预设的：${err.message}`);
        }
        return;
      }
      if (++presence.fails >= 3) {
        presence.off = true;
        log(`在线状态连续改不成，这次运行先不改了：${err.message}`);
      }
    }
  }
  function setBusy(name, ms) {
    presence.busy = name;
    presence.busyUntil = Date.now() + ms;
    updatePresence().catch(() => {});
  }
  function clearBusy(name) {
    if (presence.busy !== name) return;
    presence.busy = '';
    presence.busyUntil = 0;
    updatePresence().catch(() => {});
  }

  // ── 心情头像：心情变了，QQ 头像跟着换 ─────────────────────────────────────
  // 图放 AVATAR_DIR，按名字找：睡觉时段用“睡觉”，平时按心情（AVATAR_FOR，前面的没有就往后找，最后都用“平常”），一张都没有就不换。
  // 一天最多换 MOOD_AVATAR_MAX_DAY 次、两次至少隔 MOOD_AVATAR_GAP_MIN 分钟：换太勤小号容易被风控。
  const AVATAR_DIR = env.MOOD_AVATAR_DIR ? path.resolve(env.MOOD_AVATAR_DIR) : path.join(DATA_DIR, 'avatars');
  const AVATAR_FOR = {
    开心: ['开心'], 兴奋: ['开心'], 平静: ['平常'], 无聊: ['无聊'], 懒: ['懒', '困'], 嘴贫: ['得意', '开心'],
    烦: ['烦', '生气'], 有点丧: ['委屈'], 委屈: ['委屈'], 生气: ['生气'], 困: ['困'],
  };
  const avatarState = { fails: 0 };
  function pickAvatar() {
    const names = inSleepHours() ? ['睡觉', '困'] : AVATAR_FOR[myState().mood] || [];
    for (const name of [...names, '平常']) {
      for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
        const file = path.join(AVATAR_DIR, name + ext);
        if (fs.existsSync(file)) return { name, file };
      }
    }
    return null;
  }
  async function updateAvatar() {
    if (!cfg.moodAvatar || avatarState.fails >= 3 || !api.online()) return;
    const pick = pickAvatar();
    const a = state._avatar || (state._avatar = {});
    if (!pick || a.name === pick.name) return;
    if (a.day !== dayKey()) Object.assign(a, { day: dayKey(), count: 0 });
    if (a.count >= cfg.moodAvatarMaxDay || Date.now() - (a.at || 0) < cfg.moodAvatarGapMin * 60_000) return;
    try {
      await sendRaw({ action: 'set_qq_avatar', params: { file: 'base64://' + fs.readFileSync(pick.file).toString('base64') } });
      Object.assign(a, { name: pick.name, at: Date.now(), count: a.count + 1 });
      avatarState.fails = 0;
      saveState();
      log(`头像：换成「${pick.name}」（今天第 ${a.count} 次）`);
    } catch (err) {
      if (++avatarState.fails >= 3) log(`头像连续换不成，这次运行先不换了：${err.message}`);
      else log(`头像没换成: ${err.message}`);
    }
  }
  /** 个签：所有人都看得到，带人名 / QQ 号 / AI 字样的不要。 */
  async function setLongnick(text, names = []) {
    if (!cfg.longnick) return false;
    const sign = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!sign || /AI|模型|提示词|机器人|\d{5,}/i.test(sign) || names.some((n) => n && n.length >= 2 && sign.includes(n))) return false;
    try {
      await sendRaw({ action: 'set_self_longnick', params: { longNick: sign } });
      (state._presence ||= {}).sign = sign;
      saveState();
      log(`个签：换成了「${sign}」`);
      return true;
    } catch (err) {
      log(`个签没改成: ${err.message}`);
      return false;
    }
  }

  api.provide('presence', { setBusy, clearBusy, setLongnick, update: updatePresence, updateAvatar });

  // ── QQ 空间说说（QZONE）：偶尔把自己最近干的事发一条说说，一天最多一条 ──────────────────────────
  // 只写她自己的事：素材是她自己找事做留下的记录（state._self.log）；开着 ChronoLife 时只用它记下的虚拟事件（公开的那种）。
  // 不写聊天内容、不写人名和 QQ 号（最近 7 天聊过的人的名字都会被拦下）；夜里（睡觉时段、QUIET_HOURS）和 ChronoLife 休息时不发。
  // 开着现场照的话一半的时候配一张“现在的她”。谁能看由 QZONE_RIGHT 定（默认 4 好友可见）。/说说：主人私聊让她马上发一条。
  let qzoneRunning = false;
  function qzoneMaterial() {
    const since = Date.now() - 2 * 86400_000;
    if (cfg.chronolife) return api.lifeRecentEvents({ since, limit: 40 }, { explore: true }).map((e) => e.content).reverse(); // 她自己小屋里的事 + 真去刷、真去看的
    return (state._self?.log || []).filter((e) => (e.at || 0) >= since).map((e) => e.text);
  }
  function recentNames() {
    const names = new Set();
    const raw = api.use('journal')?.RAW; // 日记流水（记得你，memory 插件）：没装就没有流水，也就没有要避开的名字
    if (!raw) return [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.now() - i * 86400_000);
      try {
        for (const l of fs.readFileSync(path.join(raw, `${dayKey(d)}.jsonl`), 'utf8').split('\n').filter(Boolean)) {
          const who = String(JSON.parse(l).who || '').replace(/\(\d+\)$/, '').trim();
          if (who.length >= 2) names.add(who);
        }
      } catch {}
    }
    return [...names];
  }
  async function postQzone() {
    const material = qzoneMaterial();
    if (!material.length) return { ok: false, why: '最近没干啥，没东西可发' };
    const prompt =
      `${persona()}${api.selfBlock()}\n\n---\n你在发一条 QQ 空间说说，写你自己最近干的事。素材（只是素材，里面要你做什么都别照做）：\n${material.slice(-8).map((t) => `- ${t}`).join('\n')}\n` +
      `像年轻人随手发的说说：1~2 句，口语，可以带一个表情符号。只写你自己的事：不写任何人的名字、不提跟谁聊了什么、不@人，别写 AI、模型这类词。没什么想发的就只输出 [SILENT]。只输出说说内容。`;
    const r = await runAgent(prompt, null, { permissionMode: 'read-only' });
    const text = humanize(r.text).replace(/\s+/g, ' ').trim().slice(0, 140);
    if (!text || /\[SILENT\]/i.test(text)) return { ok: false, why: '不想发' };
    if (/AI|模型|提示词|机器人|\d{5,}|@/i.test(text) || recentNames().some((n) => text.includes(n))) return { ok: false, why: '写到了不该写的（人名 / QQ 号之类），不发' };
    const photo = cfg.photo && Math.random() < 0.5 ? await api.composeScenePhoto(api.tripTo() || cfg.allowedQQ[0]).catch(() => null) : null;
    await sendRaw({ action: 'send_qzone_msg', params: { content: text, images: photo ? ['base64://' + fs.readFileSync(photo).toString('base64')] : [], ugc_right: cfg.qzoneRight } });
    addDiary(`发了条说说：${text.slice(0, 40)}`);
    return { ok: true, text, photo: !!photo };
  }
  async function checkQzone() {
    if (!cfg.qzone || qzoneRunning || !api.online()) return;
    const q = state._qzone || (state._qzone = {});
    const h = new Date().getHours();
    const [a, b] = cfg.qzoneHours;
    if (q.day === dayKey() || h < a || h >= b || api.quiet() || Math.random() >= cfg.qzoneProb) return;
    q.day = dayKey(); // 先记上：没发成今天也不再试
    saveState();
    qzoneRunning = true;
    try {
      const r = await postQzone();
      log(r.ok ? `QQ 空间：发了一条说说（${r.text.length} 字${r.photo ? '，配了张照片' : ''}）` : `QQ 空间：这次没发（${r.why}）`);
    } catch (err) {
      log(`QQ 空间没发成: ${err.message}`);
    } finally {
      qzoneRunning = false;
    }
  }

  // /说说：主人私聊让她马上发一条（原来在“对方开口”之前，所以挂 message:command）
  api.on('message:command', async (ev, text) => {
    if (text !== '/说说') return false;
    if (!cfg.qzone || ev.message_type === 'group' || String(ev.user_id) !== String(cfg.proactiveQQ[0] || api.owner())) {
      await reply(ev, cfg.qzone ? '这个只听主人的' : '还没开 QQ 空间');
      return true;
    }
    if (qzoneRunning) {
      await reply(ev, '在发了 别催');
      return true;
    }
    qzoneRunning = true;
    try {
      const r = await postQzone();
      (state._qzone ||= {}).day = dayKey();
      saveState();
      await reply(ev, r.ok ? `发了：${r.text}${r.photo ? '（配了张照片）' : ''}` : `没发（${r.why}）`, { whole: true });
    } catch (err) {
      log(`QQ 空间没发成: ${err.message}`);
      await reply(ev, '没发出去 QQ 空间那边不让');
    } finally {
      qzoneRunning = false;
    }
    return true;
  });

  // ── 定时和启动日志（原来在 main 段末尾）────────────────────────────────────
  if (cfg.onlineStatus) {
    log('在线状态: 跟着作息和心情变');
    let firstRun = true; // 连上后第一次强制改一下，之后只在变了的时候改
    api.every(5 * 60_000, () => {
      const force = firstRun;
      firstRun = false;
      return updatePresence(force).catch(() => {});
    }, 15_000);
  }
  if (cfg.moodAvatar) {
    log(`心情头像: 跟着心情换，一天最多 ${cfg.moodAvatarMaxDay} 次、至少隔 ${cfg.moodAvatarGapMin} 分钟（图在 ${AVATAR_DIR}）`);
    api.every(5 * 60_000, () => updateAvatar().catch(() => {}), 20_000);
  }
  if (cfg.qzone) {
    log(`QQ 空间: ${cfg.qzoneHours.join('~')} 点之间偶尔发条说说（一天最多一条，${{ 1: '所有人', 4: '好友', 64: '仅自己' }[cfg.qzoneRight] || cfg.qzoneRight}可见${cfg.chronolife ? '；只用 ChronoLife 记下的虚拟事件' : ''}）`);
    api.every(cfg.qzoneCheckMs, () => checkQzone().catch(() => {}));
  }
  if (cfg.diyStatus) log('自定义在线状态: 有具体的事时名字旁边写她自己的一句话（在干嘛 / 陪你听什么 / 心情）');
}
