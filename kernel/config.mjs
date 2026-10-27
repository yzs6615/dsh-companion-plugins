/**
 * 内核的配置：读 COMPANION_HOME/.env（已在环境变量里的优先），算出 cfg。各插件自己的设置在插件里挂上去。
 * bridge.mjs 和 scripts/features.mjs（功能与机制页）共用这一份，默认值只写在这里。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
// 用户自己的东西（.env、人设、data）放 COMPANION_HOME；没设就跟内核放一起（测试、直接 node main.mjs 跑时）
export const HOME = process.env.COMPANION_HOME ? path.resolve(process.env.COMPANION_HOME) : ROOT;

// ── .env loading (no dependencies) ────────────────────────────────────────
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv(path.join(HOME, '.env'));

export const env = process.env;
export const cfg = {
  wsUrl: env.ONEBOT_WS || 'ws://127.0.0.1:3001',
  token: env.ONEBOT_TOKEN || '',
  allowedQQ: parseList(env.ALLOWED_QQ),
  allowedGroups: parseList(env.ALLOWED_GROUPS),
  dshCli: env.DSH_CLI || guessDshCli(),
  // 装在 DSH 里跑（有 COMPANION_HOME）时跟着 DSH 自己的配置目录走，用同一套登录和模型设置
  dshHome: env.DSH_HOME || (env.COMPANION_HOME ? path.join(os.homedir(), '.dsh') : path.join(HOME, '.dsh-home')),
  agentCwd: env.AGENT_CWD || HOME,
  apiKey: env.DEEPSEEK_API_KEY || '',
  permissionMode: env.DSH_PERMISSION_MODE || '',
  timeoutMs: Number(env.SESSION_TIMEOUT_MS || 300_000),
  maxPrompt: Number(env.MAX_PROMPT_CHARS || 6000),
  ackPrivate: (env.ACK_PRIVATE || 'false') !== 'false',
  maxAgeSec: Number(env.MAX_MESSAGE_AGE_SEC || 120),
  personaFile: env.PERSONA_FILE || path.join(HOME, 'persona.md'),
  humanSplit: (env.HUMAN_SPLIT || 'true') !== 'false',
  botName: env.BOT_NAME || '小伴', // 启动器 / 状态窗口 / 功能页上显示的名字
  wakeWords: parseList(env.WAKE_WORDS || env.BOT_NAME || '小伴'), // 机器人的名字：群里叫这些词能把它叫出来，私聊点电台时也会去掉
  quietHours: (env.QUIET_HOURS || '23-9').split('-').map(Number), // 这几个钟头不出声、不留条、不发空间（各插件主动做事前看 api.quiet()）
  memoryEnabled: (env.MEMORY || 'true') !== 'false',
  // 主动找谁（早安晚安、回访、写信在 proactive 插件里；自己找事做的分享、ChronoLife、明信片、主人是谁也认这个）
  proactiveQQ: parseList(env.PROACTIVE_QQ || ''),
  autonomy: (env.AUTONOMY || 'false') === 'true',
  autonomyMinutes: Number(env.AUTONOMY_MINUTES || 45), // 两次自己玩之间至少隔多久
  autonomyMax: Number(env.AUTONOMY_MAX || 8), // 一天最多自己玩几次
  autonomyRollProb: Number(env.AUTONOMY_ROLL_PROB ?? 0.35), // 每小时掷骰子“想不想玩”的基础概率（再按心情/精神调）
  autonomyIdleMin: Number(env.AUTONOMY_IDLE_MIN ?? 20), // 对方这么多分钟内找过它，这小时就不自己玩（在陪人聊呢）
  // ChronoLife旁存时间线；不开启时沿用旧行为。
  chronolife: env.CHRONOLIFE === 'true',
  chronolifeTimezone: env.CHRONOLIFE_TIMEZONE || 'Asia/Bangkok',
  chronolifeTickMinutes: Number(env.CHRONOLIFE_TICK_MINUTES || 30),
  chronolifeProactive: env.CHRONOLIFE_PROACTIVE === 'true',
  chronolifeCheckMs: Number(env.CHRONOLIFE_CHECK_MS || 0), // 测试用：bridge 多久看一次（不填就按 CHRONOLIFE_TICK_MINUTES）
  // ── 拟人行为 ──
  mergeMs: Number(env.MERGE_MS ?? 5000), // 连发合并：对方停这么久没再发才回（手机打字一句要好几秒），0 关闭
  mergeMaxMs: Number(env.MERGE_MAX_MS ?? 15_000),
  busyNoteMs: Number(env.BUSY_NOTE_MS ?? 45_000), // 上一轮忙了这么久还没回完、对方又来消息，才说一句“手上还有一个 等我下”（一轮最多一次）
  typingMsPerChar: Number(env.TYPING_MS_PER_CHAR ?? 130), // 0 关闭打字延迟
  inputStatus: (env.INPUT_STATUS || 'true') !== 'false', // 让对方看到“正在输入”
  markRead: (env.MARK_READ || 'true') !== 'false',
  sleepStart: Number(env.SLEEP_START ?? 1),
  sleepEnd: Number(env.SLEEP_END ?? 7),
  sleepDelayProb: Number(env.SLEEP_DELAY_PROB ?? 0.5), // 睡觉时段慢回的概率，0 关闭
  typoProb: Number(env.TYPO_PROB ?? 0.04),
  react: (env.REACT || 'true') !== 'false', // “嗯嗯/哈哈”点表情回应，不调模型
  reactProb: Number(env.REACT_PROB ?? 0.7),
  ignoreLimit: Number(env.IGNORE_LIMIT ?? 2), // 主动找了几次都没回，就先不找了（等对方开口）
  sulk: (env.SULK || 'true') !== 'false', // 被冷落后对方再开口，第一句带点小情绪
  sulkAfterMin: Number(env.SULK_AFTER_MIN ?? 120), // 主动消息发出后隔多久才回算“被冷落”
  reflect: (env.REFLECT || 'true') !== 'false', // 生活 → 反思 → 人设成长
  // 深夜电台：点一期，她录两三分钟的语音节目（节目卡 + 推荐一首歌）。没开语音就发文字版
  radio: (env.RADIO || 'true') !== 'false',
  radioMaxDay: Number(env.RADIO_MAX_DAY ?? 6), // 一天最多录几期（重播不算）
  radioVoiceSec: Number(env.RADIO_VOICE_SEC ?? 58), // 拼成的每条语音最长几秒
  radioCollectMs: Number(env.RADIO_COLLECT_MS ?? 6000), // 投稿连发几条：最后一条之后等这么久再开录
  emotion: (env.EMOTION || 'true') !== 'false', // 心情有来由、会延续（模型写 [心情:词|为啥]）
  autonomyHours: (env.AUTONOMY_HOURS || '10-23').split('-').map(Number), // 自己找事做的时段
  autonomyRollWindowMin: Number(env.AUTONOMY_ROLL_WINDOW_MIN ?? 45), // 每小时在前多少分钟里随机掷骰子
  autonomyCheckMs: Number(env.AUTONOMY_CHECK_MS ?? 300_000),
  recall: (env.RECALL || 'true') !== 'false', // 对方撤回：没回的那条就不回了；熟人偶尔调侃一句
  recallTeaseProb: Number(env.RECALL_TEASE_PROB ?? 0.5),
  sleepDrift: (env.SLEEP_DRIFT || 'false') === 'true', // 作息被带偏：电脑的主人最近老熬夜 / 早睡，她的睡觉时段跟着挪
  sleepDriftMax: Number(env.SLEEP_DRIFT_MAX ?? 2), // 最多被带晚几个小时（带早最多 1 小时）
  pcOwner: env.PC_OWNER || '', // 电脑是谁的 QQ（默认 PROACTIVE_QQ 第一个）。主人是谁本体也要用（写信、明信片、作息被带偏…），电脑上的她那些设置在 pc 插件里
  // 做梦：早上醒来有时记得昨晚的梦（最近的事拼的），今天第一次聊天、或者早安时顺口说
  dream: (env.DREAM || 'false') === 'true',
  dreamProb: Number(env.DREAM_PROB ?? 0.5), // 每天每个人做梦的概率
  dreamUntil: Number(env.DREAM_UNTIL ?? 12), // 睡醒（SLEEP_END）到几点之间做梦；过了这个点再三个小时就不提了
  dreamCheckMs: Number(env.DREAM_CHECK_MS ?? 600_000),
  // 现场照：问她在干嘛时，可能发一张“现在的她”（data/scene/bg 房间背景 × data/scene/pose 动作）
  photo: (env.PHOTO || 'false') === 'true',
  photoMaxDay: Number(env.PHOTO_MAX_DAY ?? 5),
  // 百炼画图用哪个模型：信纸（每周一封信在 proactive 插件里）、收到的礼物都用它
  letterModel: env.LETTER_IMAGE_MODEL || 'wanx2.1-t2i-turbo',
  // 旅行明信片：隔几周的周末她在自己的小世界里出去玩一趟（周五定去哪），周日下午给 PROACTIVE_QQ 寄一张明信片（正面百炼画当地风景）
  postcard: (env.POSTCARD || 'false') === 'true',
  postcardEveryWeeks: Number(env.POSTCARD_EVERY_WEEKS ?? 3),
  postcardModel: env.POSTCARD_IMAGE_MODEL || env.LETTER_IMAGE_MODEL || 'wanx2.1-t2i-turbo',
  postcardCheckMs: Number(env.POSTCARD_CHECK_MS ?? 600_000),
  media: (env.MEDIA || 'true') !== 'false', // 看懂发来的视频（抽帧 + 听）和文件
  mediaMaxMB: Number(env.MEDIA_MAX_MB ?? 60),
  reflectHour: Number(env.REFLECT_HOUR ?? 22), // 每天几点后回想一次
  reflectCheckMs: Number(env.REFLECT_CHECK_MS ?? 600_000),
  selfMax: Number(env.SELF_MAX ?? 30), // “最近的自己”最多几条
  selfForgetDays: Number(env.SELF_FORGET_DAYS ?? 14), // 多久没再印证就忘掉
  recentForgetDays: Number(env.RECENT_FORGET_DAYS ?? 5), // “最近在看”忘得快
};

export function parseList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// 安装包把 DSH 装进本目录的 node_modules；自己装在别处的话在 .env 里写 DSH_CLI
function guessDshCli() {
  return path.join(ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
}
