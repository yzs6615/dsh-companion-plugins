/**
 * 电脑上的她：电脑室友（看得见在放的歌、开着的游戏、电脑开了多久、人在不在电脑前，pc.mjs）、
 * 回来时从电脑喇叭打个招呼、离开久了在桌面留张便条、桌面抽屉、用电脑上的 QQ 音乐放歌（qqmusic.mjs）。只支持 Windows。
 * 设置：PC_BUDDY / PC_MAX_DAY / PC_SONG_PROB / PC_CHECK_MS、QUIET_HOURS / AWAY_MIN、SPEAKER / SPEAKER_MAX_DAY、
 * NOTES / NOTE_AFTER_MIN、DRAWER、PLAY_MUSIC / PLAY_MUSIC_MAX_DAY / QQMUSIC_EXE。电脑是谁的（PC_OWNER）还在本体，走 api.owner()。
 * 提供 pc 服务：now()（最近一次看到的电脑）、owner()、quiet()（现在该不该安静）；
 * 提供 drawer 服务：put(sub, name, file) / append(file, line)（写信、明信片、现场照、梦、收藏往抽屉里放）。没装这个插件，这些都跳过。
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pcSnapshot } from './pc.mjs';
import { searchSong, pickSong, playInClient, openSongPage, songUrl } from './qqmusic.mjs';

export default function setup(api) {
  const { cfg, env, log, state, saveState, userState, persona, lifeBlock, appendMemory, say, reply, runAgent, humanize, activeChats, batches, pick, sleep, pace, ROOT, DATA_DIR } = api;
  const { dayKey, speakable } = api.human;
  Object.assign(cfg, {
    // 电脑室友：看得见这台电脑在放什么歌、开着什么游戏、开了多久、人在不在电脑前；只跟电脑的主人提
    pcBuddy: (env.PC_BUDDY || 'false') === 'true',
    pcMaxDay: Number(env.PC_MAX_DAY ?? 3), // 一天最多因为电脑上的事主动说几句
    pcSongProb: Number(env.PC_SONG_PROB ?? 0.12), // 新放一首歌时顺口说一句的概率（同一首这周放到第 3 遍必说）
    pcCheckMs: Number(env.PC_CHECK_MS ?? 120_000),
    // 电脑上的她（都靠电脑室友看键盘鼠标多久没动；夜里不出声、不留条）
    awayMin: Number(env.AWAY_MIN ?? 120), // 键盘鼠标这么久没动、又动了，算“回来了”
    speaker: (env.SPEAKER || 'false') === 'true', // 早上第一次开电脑、离开很久又回来时，用她的声音从电脑喇叭说一句（要开语音）
    speakerMaxDay: Number(env.SPEAKER_MAX_DAY ?? 3),
    notes: (env.NOTES || 'false') === 'true', // 离开电脑好几个小时时，她在桌面留张便条，回来时弹个通知
    noteAfterMin: Number(env.NOTE_AFTER_MIN ?? 180),
    drawer: (env.DRAWER || 'false') === 'true', // 桌面上“<名字>的抽屉”：写给主人的信、明信片、现场照、梦、便条、收藏的视频都放一份
    playMusic: (env.PLAY_MUSIC || 'false') === 'true', // 用电脑上的 QQ 音乐放歌：模型写 [放歌:歌名 歌手]，主人在电脑前就直接放，不在就发链接
    playMusicMaxDay: Number(env.PLAY_MUSIC_MAX_DAY ?? 6),
    qqMusicExe: env.QQMUSIC_EXE || 'C:\\Program Files (x86)\\Tencent\\QQMusic\\QQMusic.exe',
  });
  // PowerShell、桌面、托盘通知、QQ 音乐都只有 Windows 上有
  if (process.platform !== 'win32') {
    log('电脑上的她只支持 Windows');
    return;
  }
  // 人设成长那段在她自己的生活（life 插件）里，没装就不带
  const selfBlock = () => api.use('life')?.selfBlock() || '';
  const pad2 = (n) => String(n).padStart(2, '0');

  // ── 电脑室友：她住在这台电脑里，看得见在放什么歌、开着什么游戏、电脑开了多久、人在不在电脑前（pc.mjs）───────────
  // 只跟电脑的主人（PC_OWNER，默认 PROACTIVE_QQ 第一个）提，只在私聊里带；群里、别的人都不知道。
  // 聊天时提示词里带一段“这台电脑上”；碰上值得说的事（一首歌这周放到第 3 遍、凌晨还在打游戏 / 还在电脑前、电脑连开好几天），
  // 偶尔主动说一句：一天最多 PC_MAX_DAY 句、两句至少隔 90 分钟、同一件事隔几天才再提，对方正在跟她聊的时候不插话。
  const pcOwner = () => api.owner();
  let pcNow = null; // 最近一次看到的电脑（只在内存里，不落盘）
  let pcRunning = false;
  function spanDesc(ms) {
    const m = Math.max(1, Math.round(ms / 60_000));
    return m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时${m % 60 >= 10 ? ` ${m % 60} 分钟` : ''}`;
  }
  function pcPlays(title) {
    return (state._pc?.plays?.[title] || []).filter((t) => Date.now() - t < 7 * 86400_000).length;
  }
  function pcBlock(qq, isGroup) {
    if (!cfg.pcBuddy || isGroup || String(qq) !== pcOwner() || !pcNow || Date.now() - pcNow.at > 10 * 60_000) return '';
    const h = new Date().getHours();
    const out = [];
    if (pcNow.music) {
      const n = pcPlays(pcNow.music.title);
      out.push(`正在放：${pcNow.music.title}（${pcNow.music.app}${n >= 2 ? `，这周放了 ${n} 遍` : ''}）`);
    }
    if (pcNow.game) out.push(`开着游戏：${pcNow.game.name}（玩了 ${spanDesc(Date.now() - pcNow.game.since)}）`);
    const up = pcNow.bootAt ? (Date.now() - pcNow.bootAt) / 3600_000 : 0;
    if (up >= 24) out.push(`电脑已经连着开了 ${Math.floor(up / 24)} 天没关`);
    if (h < 5 && pcNow.idleSec < 300) out.push('这么晚了，人还在电脑前（键盘鼠标刚刚还在动）');
    if (!out.length) return '';
    return `\n\n---\n【这台电脑上】（你就住在这台电脑里，这些你直接听得到、看得到）\n${out.map((s) => `- ${s}`).join('\n')}\n（像住在一起的室友，偶尔顺口提一句就行，别每次都提，别像在监视，别说“检测到”这种词。）`;
  }
  function pcEvent(snap, started, pc) {
    const owner = pcOwner();
    if (!owner || !api.online()) return null;
    const now = Date.now();
    const h = new Date().getHours();
    if (pc.day !== dayKey()) Object.assign(pc, { day: dayKey(), count: 0 });
    if (pc.count >= cfg.pcMaxDay || now - (pc.lastAt || 0) < 90 * 60_000) return null;
    const chatKey = `u${owner}`;
    if (activeChats.has(chatKey) || batches.has(chatKey) || now - (userState(owner).lastUserAt || 0) < 10 * 60_000) return null; // 正聊着：提示词里有，不另外插话
    const said = (k, days) => now - (pc.said[k] || 0) < days * 86400_000;
    if (started) {
      const n = pcPlays(started.title);
      if (n >= 3 && !said(`song:${started.title}`, 3)) return { key: `song:${started.title}`, what: `电脑上刚开始放《${started.title}》（${started.app}），这首这周已经放了 ${n} 遍` };
      if (Math.random() < cfg.pcSongProb && !said('song', 0.25)) return { key: 'song', what: `电脑上刚开始放《${started.title}》（${started.app}）` };
    }
    if (h < 5 && snap.game && now - snap.game.since > 3600_000 && !said('lategame', 0.5)) return { key: 'lategame', what: `现在凌晨 ${h} 点多了，对方还在玩${snap.game.name}（已经玩了 ${spanDesc(now - snap.game.since)}）` };
    if (h >= 1 && h < 5 && !snap.game && snap.idleSec < 180 && !said('late', 0.5)) return { key: 'late', what: `现在凌晨 ${h} 点多了，对方还在电脑前（键盘鼠标刚刚还在动）` };
    const up = snap.bootAt ? (now - snap.bootAt) / 86400_000 : 0;
    if (up >= 2 && h >= 10 && h < 22 && !said('uptime', 3)) return { key: 'uptime', what: `对方的电脑已经连着开了 ${Math.floor(up)} 天没关机` };
    return null;
  }
  async function pcSay(event, pc) {
    if (cfg.chronolife) return;
    const owner = pcOwner();
    const prompt =
      `${persona()}${lifeBlock(owner)}${selfBlock()}\n\n---\n你住在对方这台电脑里，刚注意到：${event.what}。\n` +
      `像住在一起的室友那样随口说一句：吐槽、关心、跟着哼两句、问一句都行，1 句，口语。你本来就在这台电脑里，别解释是怎么知道的，别说“检测到”“监控”这种词；` +
      `正在睡觉时段的话可以说是被吵醒的。不想说就只输出 [SILENT]。只输出要发的话。`;
    try {
      const r = await runAgent(prompt, null, { permissionMode: 'read-only' });
      const text = humanize(r.text).trim();
      pc.said[event.key] = Date.now(); // 不管说没说，这件事这几天都不再提
      saveState();
      if (!text || /\[SILENT\]/i.test(text)) return;
      await say({ message_type: 'private', user_id: Number(owner) }, text, { casual: true, autoMood: 0.3 });
      Object.assign(pc, { count: (pc.count || 0) + 1, lastAt: Date.now() });
      saveState();
      appendMemory(`u${owner}`, `（你注意到电脑上：${event.what}）`, text);
      log(`电脑室友：${event.key} → ${text.slice(0, 60)}`);
    } catch (err) {
      log(`电脑室友没说成: ${err.message}`);
    }
  }
  async function checkPc() {
    if (!cfg.pcBuddy || pcRunning || !api.online()) return; // 没连上 QQ 时别看：刚开始放的歌会被白白记掉
    pcRunning = true;
    try {
      let snap;
      try {
        snap = await pcSnapshot();
      } catch {
        return; // 这次没看成，下次再看
      }
      const pc = state._pc || (state._pc = { song: '', plays: {}, said: {} });
      const now = Date.now();
      let started = null; // 这一眼刚开始放的歌
      if (snap.music && snap.music.title !== pc.song) {
        started = snap.music;
        pc.plays[started.title] = [...(pc.plays[started.title] || []), now];
      }
      pc.song = snap.music?.title || '';
      for (const [t, list] of Object.entries(pc.plays)) {
        const keep = list.filter((x) => now - x < 14 * 86400_000);
        if (keep.length) pc.plays[t] = keep;
        else delete pc.plays[t];
      }
      // 离开 / 回来：上一次看到的“最后动键盘鼠标的时间”到这一次之间隔了 AWAY_MIN 以上，就是刚回来
      const lastInput = now - snap.idleSec * 1000;
      const prevInput = pc.lastInput || lastInput;
      const back = snap.idleSec < 120 && lastInput - prevInput >= cfg.awayMin * 60_000 ? lastInput - prevInput : 0;
      pc.lastInput = Math.max(prevInput, lastInput);
      pcNow = snap;
      saveState();
      if (back) return void (await pcCameBack(back, pc));
      if (snap.idleSec >= cfg.noteAfterMin * 60) await pcLeaveNote(pc, snap.idleSec * 1000);
      const event = pcEvent(snap, started, pc);
      if (event) await pcSay(event, pc);
    } finally {
      pcRunning = false;
    }
  }

  // ── 电脑上的她：回来时从电脑喇叭打个招呼（SPEAKER）、离开很久时在桌面留张便条，回来弹个通知（NOTES）、桌面抽屉（DRAWER）──────
  // 这些不是 QQ 消息，开着 ChronoLife 也照做，但跟它的作息对齐：睡觉时段、QUIET_HOURS（默认 23~9 点）、它在休息时都不出声、不留条。
  // 测试用 SPEAKER_LOG / NOTIFY_LOG / DESKTOP_DIR 代替真的放声音、弹通知、写桌面。
  let desktopPath = '';
  function desktop() {
    if (desktopPath) return desktopPath;
    if (env.DESKTOP_DIR) return (desktopPath = path.resolve(env.DESKTOP_DIR));
    try {
      const b64 = execFileSync('powershell', ['-NoProfile', '-Command', "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([Environment]::GetFolderPath('Desktop')))"], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
      desktopPath = Buffer.from(b64.trim(), 'base64').toString('utf8');
    } catch {}
    return desktopPath || (desktopPath = path.join(env.USERPROFILE || ROOT, 'Desktop'));
  }
  const pcQuiet = () => api.quiet(); // 免打扰在本体（睡觉时段、QUIET_HOURS、ChronoLife 休息）
  function runHiddenPs(script) {
    spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
  const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
  /** 右下角弹个通知（NotifyIcon 气泡，Win11 上就是一条系统通知）。 */
  function desktopNotify(title, text) {
    if (env.NOTIFY_LOG) return void fs.appendFileSync(env.NOTIFY_LOG, `${title}｜${text}\n`);
    runHiddenPs(`Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(15000, ${psq(title)}, ${psq(text)}, 'None'); Start-Sleep -Seconds 20; $n.Dispose()`);
  }
  /** 用她的声音从电脑喇叭说一句（百炼合成，PowerShell 放 wav）。没开语音、没装“说话的样子”就不说。 */
  async function speakOnPc(text) {
    if (env.SPEAKER_LOG) return fs.appendFileSync(env.SPEAKER_LOG, `${text}\n`), true;
    if (!cfg.voice) return false;
    const voice = api.use('voice');
    if (!voice?.speak) return false;
    const { wav } = await voice.speak(text, { url: cfg.voiceWs, apiKey: env.DASHSCOPE_API_KEY, voice: cfg.voiceId, model: cfg.voiceModel, rate: cfg.voiceRate, cutMs: cfg.voiceCutMs });
    const dir = path.join(DATA_DIR, 'speaker');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${Date.now()}.wav`);
    fs.writeFileSync(f, wav);
    runHiddenPs(`(New-Object System.Media.SoundPlayer ${psq(f)}).PlaySync()`);
    for (const old of fs.readdirSync(dir).filter((x) => x.endsWith('.wav')).sort().slice(0, -10)) fs.rmSync(path.join(dir, old), { force: true });
    return true;
  }
  async function pcCameBack(awayMs, pc) {
    const owner = pcOwner();
    if (!owner) return;
    if (cfg.notes && pc.note && !pc.note.shown) {
      pc.note.shown = true;
      saveState();
      desktopNotify(`${cfg.botName}给你留了张便条`, `${pc.note.text.split(/\n/)[0].slice(0, 50)}（在桌面上）`);
      log('便条：对方回来了，弹了个通知');
    }
    if (!cfg.speaker || pcQuiet()) return;
    const sp = pc.speak || (pc.speak = {});
    if (sp.day !== dayKey()) Object.assign(sp, { day: dayKey(), count: 0 });
    if (sp.count >= cfg.speakerMaxDay || Date.now() - (sp.at || 0) < 3600_000) return;
    const morning = new Date().getHours() < 12 && sp.morning !== dayKey() && awayMs > 4 * 3600_000; // 今天头一回坐到电脑前
    const what = morning ? '早上对方第一次坐到电脑前' : `对方离开电脑 ${spanDesc(awayMs)}，刚回来`;
    const prompt =
      `${persona()}${lifeBlock(owner)}\n\n---\n${what}。你住在这台电脑里，用电脑喇叭直接跟对方说一句（会用你自己的声音念出来，对方在房间里能听到）：` +
      `很短，5~15 个字，像室友打招呼（“早”“回来啦 去哪了”这种），别带表情、括号和标记。只输出要说的话。`;
    try {
      const r = await runAgent(prompt, null, { permissionMode: 'read-only' });
      const text = speakable(humanize(r.text)).slice(0, 30);
      if (!text || !(await speakOnPc(text))) return;
      Object.assign(sp, { count: sp.count + 1, at: Date.now(), ...(morning ? { morning: dayKey() } : {}) });
      saveState();
      appendMemory(`u${owner}`, `（${what}）`, `（用电脑喇叭说）${text}`);
      log(`电脑喇叭：${morning ? '早上' : '回来'} → ${text}`);
    } catch (err) {
      log(`电脑喇叭没说成: ${err.message}`);
    }
  }
  async function pcLeaveNote(pc, awayMs) {
    const owner = pcOwner();
    if (!cfg.notes || !owner || pcQuiet() || pc.noteDay === dayKey()) return;
    pc.noteDay = dayKey(); // 一天最多一张，先记上
    saveState();
    const prompt =
      `${persona()}${lifeBlock(owner)}${selfBlock()}\n\n---\n对方离开电脑 ${spanDesc(awayMs)} 了。你住在这台电脑里，在对方桌面上留一张便条，像室友贴在门上的纸条：` +
      `1~3 句，口语，可以写你刚才干了啥、想到的事、提醒对方的小事。便条放在桌面上，别人也可能看到，别写私密的事和聊天内容。只输出便条内容。`;
    try {
      const r = await runAgent(prompt, null, { permissionMode: 'read-only' });
      const text = humanize(r.text).trim().slice(0, 200);
      if (!text || /AI|模型|提示词/i.test(text)) return;
      const now = new Date();
      const stamp = `${now.getMonth() + 1}月${now.getDate()}日 ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
      fs.writeFileSync(path.join(desktop(), `${cfg.botName}的便条.txt`), `${text}\r\n\r\n—— ${cfg.botName}  ${stamp}\r\n`);
      pc.note = { text, at: Date.now(), shown: false };
      saveState();
      drawerAppend('便条.txt', `${dayKey()} ${pad2(now.getHours())}:${pad2(now.getMinutes())}  ${text.replace(/\s*\n\s*/g, ' ')}`);
      appendMemory(`u${owner}`, '（对方离开电脑好几个小时）', `（在对方桌面留了张便条）${text}`);
      log(`便条：留在了桌面（${text.length} 字）`);
    } catch (err) {
      log(`便条没留成: ${err.message}`);
    }
  }
  /** 桌面抽屉：她做的东西放一份（信、明信片、现场照、电台节目卡…）。 */
  function drawerDir() {
    const d = path.join(desktop(), `${cfg.botName}的抽屉`);
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, '说明.txt'), `这是${cfg.botName}的抽屉。她写给你的信、寄的明信片、发给你的照片、梦见你的梦、留过的便条、自己收藏的视频，都会放一份在这里。\r\n`);
    }
    return d;
  }
  function drawerPut(sub, name, src) {
    if (!cfg.drawer || !src || !fs.existsSync(src)) return;
    try {
      const d = path.join(drawerDir(), sub);
      fs.mkdirSync(d, { recursive: true });
      if (!fs.existsSync(path.join(d, name))) fs.copyFileSync(src, path.join(d, name));
    } catch (err) {
      log(`抽屉：没放进去（${err.message}）`);
    }
  }
  function drawerAppend(file, line) {
    if (!cfg.drawer) return;
    try {
      fs.appendFileSync(path.join(drawerDir(), file), `${line}\r\n`);
    } catch (err) {
      log(`抽屉：没记上（${err.message}）`);
    }
  }

  // ── 放歌（PLAY_MUSIC）：模型写 [放歌:歌名 歌手]，先在 QQ 音乐搜到这首（搜不到就说一声）──────────────────────
  // 电脑的主人在电脑前（键盘鼠标 5 分钟内动过）就在电脑上的 QQ 音乐里直接放（qqmusic.mjs）；不在电脑前、或者是别人点的，发 QQ 音乐的链接。
  // 只在私聊里放，一天最多 PLAY_MUSIC_MAX_DAY 首。测试用 QQMUSIC_SEARCH_FILE / PLAY_MUSIC_LOG 代替联网搜歌、真的放。
  const MUSIC_ASK = /歌|音乐|bgm|听点|听首|放首|放一首|放个/i;
  function musicHint(qq, text, isGroup) {
    if (!cfg.playMusic || isGroup || String(qq) !== pcOwner()) return '';
    const h = new Date().getHours();
    if (!MUSIC_ASK.test(text) && !(h >= 22 || h < 2)) return '';
    return '\n（你能用对方电脑上的 QQ 音乐放歌：对方让你放首歌、或者你想给对方放一首（比如夜里放首睡前听的），就在回复最后加 [放歌:歌名 歌手]，对方在电脑前就直接在 QQ 音乐里放，不在就发个链接；不想放就不加，别老放。）';
  }
  async function playSong(ev, query) {
    const day = state._music?.day === dayKey() ? state._music : (state._music = { day: dayKey(), count: 0 });
    if (day.count >= cfg.playMusicMaxDay) return log('放歌：今天放够了');
    let song;
    try {
      song = pickSong(await searchSong(query, { file: env.QQMUSIC_SEARCH_FILE }), query);
    } catch (err) {
      return log(`放歌：没搜成（${err.message}）`);
    }
    if (!song) return void (await reply(ev, pick(['QQ 音乐上没搜到这首', '这首没搜到 换一首？'])));
    day.count++;
    saveState();
    const label = `${song.name} - ${song.singer}`;
    const snap = String(ev.user_id) === pcOwner() ? await pcSnapshot().catch(() => null) : null;
    if (snap && snap.idleSec < 300 && playInClient(song, { exe: cfg.qqMusicExe, dir: path.join(DATA_DIR, 'music'), log: env.PLAY_MUSIC_LOG })) {
      log(`放歌：在电脑上的 QQ 音乐放《${label}》`);
      if (!env.PLAY_MUSIC_LOG) setTimeout(() => checkPlaying(song).catch(() => {}), 25_000);
      return;
    }
    await sleep((600 + Math.random() * 900) * pace());
    await reply(ev, `${label}\n${songUrl(song.mid)}`);
    log(`放歌：发了《${label}》的链接`);
  }
  /** 放了 25 秒后看一眼：QQ 音乐压根没起来，就改成在浏览器里打开网页版这首歌。 */
  async function checkPlaying(song) {
    const snap = await pcSnapshot();
    const name = song.name.replace(/\s*[（(].*$/, '');
    if (snap.music?.app === 'QQ音乐' && snap.music.title.includes(name)) return log('放歌：QQ 音乐已经在放了');
    const running = /QQMusic\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq QQMusic.exe', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }));
    if (running) return log('放歌：QQ 音乐开着，但没看到在放这首（可能缩在托盘里）');
    openSongPage(song);
    log('放歌：QQ 音乐没起来，改成在浏览器里打开网页版');
  }

  // ── 钩子（原来在本体“还没搬走的”那几段里，order 照旧）───────────────────────────
  api.on('prompt:context', (t) => pcBlock(t.qq, t.isGroup), 90);
  api.on('prompt:hint', (t) => musicHint(t.qq, t.text, t.isGroup), 40);
  api.on('turn:answer', (answer, t) => {
    // [放歌:歌名 歌手]：回完这句在对方电脑上的 QQ 音乐里放（不在电脑前就发链接）
    t.tags.play = answer.match(/\[放歌[:：]\s*([^\]]+?)\s*\]/)?.[1] || '';
    return answer.replace(/\[放歌[:：][^\]]*\]/g, '').trim() || '给你放首歌';
  }, 50);
  api.on('turn:spoken', (tags, t) => (t.tags.play && cfg.playMusic ? `（放了首歌：${t.tags.play}）` : ''), 20);
  // 原来跟现场照、收礼物在本体同一个 turn:after 里，排在现场照后面、收礼物前面（本体那边拆成了 10 和 30）
  api.on('turn:after', async (t) => {
    if (t.tags.play && cfg.playMusic && !t.isGroup) await playSong(t.ev, t.tags.play).catch((err) => log(`放歌失败: ${err.message}`));
  }, 20);

  api.provide('pc', { now: () => pcNow, owner: pcOwner, quiet: pcQuiet });
  api.provide('drawer', { put: drawerPut, append: drawerAppend });

  // ── 定时和启动日志（原来在 main 段末尾）────────────────────────────────────
  if (cfg.pcBuddy) {
    log(`电脑室友: 每 ${Math.round(cfg.pcCheckMs / 1000)} 秒看一眼电脑（只看在放的歌、开着的游戏、开机多久、人在不在），只跟 ${pcOwner() || '（没设）'} 提，一天最多主动说 ${cfg.pcMaxDay} 句`);
    api.every(cfg.pcCheckMs, () => checkPc().catch(() => {}), Math.min(30_000, cfg.pcCheckMs));
  }
  if (cfg.speaker || cfg.notes) {
    log(`电脑上的她: ${[cfg.speaker && '回来时从喇叭打招呼', cfg.notes && '离开久了在桌面留便条'].filter(Boolean).join('、')}（${cfg.pcBuddy ? '' : '没开电脑室友，暂时用不上；'}${cfg.quietHours.join('~')} 点不出声）`);
  }
  if (cfg.drawer) log(`桌面抽屉: ${drawerDir()}`); // 以前写的信放进抽屉：本体启动时（startup）用 drawer.put 补一遍
  if (cfg.playMusic) log(`放歌: [放歌:歌名 歌手] → ${fs.existsSync(cfg.qqMusicExe) ? '主人在电脑前就用 QQ 音乐放' : '没找到 QQ 音乐，只发链接'}，不在电脑前发链接（一天最多 ${cfg.playMusicMaxDay} 首）`);
}
