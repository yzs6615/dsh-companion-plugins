/** 全部插件的清单：打包、下载器、生成 DSH 入口都看这一份。 */
export const VERSION = '0.1.0'
export const REPO = 'yzs6615/dsh-companion-plugins'

export const PLUGINS = [
  { id: 'core', pkg: 'dsh-companion-core', title: '本体', required: true,
    desc: '连 QQ（NapCat / OneBot 11）、聊天、人设、短期记忆、熟悉度、白名单和权限；别的插件都装在它上面。' },
  { id: 'speech', pkg: 'dsh-companion-speech', title: '说话的样子', deps: { ws: '^8.22.0' },
    desc: '表情包（按意思挑、偷对方的表情包）、学对方说话、学某个人说话、发语音、唱歌。' },
  { id: 'memory', pkg: 'dsh-companion-memory', title: '记得你',
    desc: '长期记住对方的事、记得作息、对你好奇、纪念日和天气、每天写日记。' },
  { id: 'mood', pkg: 'dsh-companion-mood', title: '心情和作息',
    desc: '心情有来由、会延续；作息被你带偏；主动找你没回会有点小情绪。' },
  { id: 'life', pkg: 'dsh-companion-life', title: '她自己的生活',
    desc: 'ChronoLife 小屋、自己找事做（刷 B站、听歌、看番）、做梦、人设成长、深夜电台、旅行明信片、现场照、收礼物。' },
  { id: 'proactive', pkg: 'dsh-companion-proactive', title: '主动找你',
    desc: '早安晚安、到点回访、主动戳你、等你回、每周一封信。' },
  { id: 'pc', pkg: 'dsh-companion-pc', title: '电脑上的她',
    desc: '电脑室友（看得见你在放的歌、开的游戏）、喇叭说话、桌面便条、桌面抽屉、用 QQ 音乐放歌。只支持 Windows。' },
  { id: 'profile', pkg: 'dsh-companion-profile', title: 'QQ 上的样子',
    desc: '在线状态和个签、自定义在线状态、心情头像、QQ 空间说说。' },
  { id: 'group', pkg: 'dsh-companion-group', title: '群聊',
    desc: '群白名单、叫名字唤醒、引用回复、偶尔插嘴、戳一戳。没装就不理群消息。' },
  { id: 'phone', pkg: 'dsh-companion-phone', title: '手机',
    desc: '用 adb 控制安卓手机（截图、点按、输入），手机看门狗，看手机直播。' },
]
