# DSH 陪伴插件

给 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 用的一套 QQ 陪伴机器人插件：接上 NapCat（OneBot 11），
机器人就会在 QQ 里像个朋友一样跟你聊天，记得你的事、有自己的心情和生活、偶尔主动找你。

功能拆成 10 个插件，**本体必装**，别的想要哪个装哪个。

| 插件 | 包名 | 有什么 |
| --- | --- | --- |
| 本体 | `dsh-companion-core` | 连 QQ、聊天、人设、短期记忆、熟悉度、连发合并、打字节奏、引用、撤回、看懂视频和文件、提醒、白名单和权限 |
| 说话的样子 | `dsh-companion-speech` | 表情包（按意思挑、偷对方的）、学对方说话、学某个人说话、发语音、唱歌 |
| 记得你 | `dsh-companion-memory` | 长期记住对方的事、记得作息、对你好奇、纪念日和天气、每天写日记 |
| 心情和作息 | `dsh-companion-mood` | 心情有来由、会延续；作息被你带偏；主动找你没回会有点小情绪 |
| 她自己的生活 | `dsh-companion-life` | ChronoLife 小屋、自己找事做（刷 B站、听歌、看番）、做梦、人设成长、深夜电台、旅行明信片、现场照、收礼物 |
| 主动找你 | `dsh-companion-proactive` | 早安晚安、到点回访、主动戳你、等你回、每周一封信 |
| 电脑上的她 | `dsh-companion-pc` | 电脑室友、喇叭说话、桌面便条、桌面抽屉、用 QQ 音乐放歌（只支持 Windows） |
| QQ 上的样子 | `dsh-companion-profile` | 在线状态和个签、自定义在线状态、心情头像、QQ 空间说说 |
| 群聊 | `dsh-companion-group` | 群白名单、叫名字唤醒、引用回复、偶尔插嘴、戳一戳（没装就不理群消息） |
| 手机 | `dsh-companion-phone` | 用 adb 控制安卓手机、手机看门狗、看手机直播 |

## 安装

先装好 DSH（0.2.1-rc.2 及以上）和 NapCat。然后二选一：

**用下载器（推荐）**：到 [Releases](https://github.com/yzs6615/dsh-companion-plugins/releases) 下载
`下载器.zip`（只有下载器，装的时候在线下插件）或 `全部插件.zip`（下载器 + 全部安装包，离线装），解压后双击 `安装.cmd`，
回车装全部，或者写编号挑着装。

**一个个装**：每个插件在 Releases 里有自己的安装包，用 DSH 自己的命令装（先装本体）：

```bash
dsh plugin --profile web add https://github.com/yzs6615/dsh-companion-plugins/releases/download/v0.1.0/dsh-companion-core-0.1.0.tgz
```

```bash
dsh plugin --profile web add https://github.com/yzs6615/dsh-companion-plugins/releases/download/v0.1.0/dsh-companion-speech-0.1.0.tgz
```

卸载：`dsh plugin --profile web remove dsh-companion-speech`。

## 设置

装好后启动一次 DSH（`dsh web`），会建好 `%USERPROFILE%\.dsh\companion\`：

- `.env`：QQ 连接和开关，照着 [.env 示例](packages/core/kernel/.env.example) 写；至少要 `ONEBOT_WS`、`ALLOWED_QQ`。
- `persona.md`：人设，改完下一条消息就生效。
- `data\`：聊天记录、记忆、日记，日志在 `data\bridge.log`。

每个插件的开关、设置和原理见各自文件夹里的 README。

## 开发

```bash
node scripts/test-all.mjs
```

不连 QQ、不花钱：假的 OneBot + 假的模型（`test/fake-dsh.mjs`）。插件怎么写见 [docs/插件接口.md](docs/插件接口.md)。

## 许可

MIT。
