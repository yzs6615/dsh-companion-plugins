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

先装好 DSH 和 NapCat（DSH 装插件要用 pnpm，按 DSH 的说明装好）。插件不挑 DSH 版本，也不依赖 DSH 内部的包，
自己装的 DSH 直接就能装。三种装法任选：

**DSH 自己的命令（不用下载器）**：每个插件在 GitHub 上有自己的分支，先装本体，再装想要的：

```bash
dsh plugin --profile web add github:yzs6615/dsh-companion-plugins#core
```

```bash
dsh plugin --profile web add github:yzs6615/dsh-companion-plugins#speech
```

分支名：`core` `speech` `memory` `mood` `life` `proactive` `pc` `profile` `group` `phone`。
用桌面版的话把 `web` 换成 `desktop`，并且先把桌面版完全退出。

**下载器**：到 [Releases](https://github.com/yzs6615/dsh-companion-plugins/releases) 下载
`下载器.zip`（装的时候从 GitHub 拉插件）或 `全部插件.zip`（带全部安装包，不联网也能装），解压后双击 `安装.cmd`
（Linux / Mac：`node downloader.mjs`），回车装全部，或者写编号挑着装。

**单个安装包**：Releases 里每个插件有自己的 `.tgz`，下载后 `dsh plugin --profile web add <文件路径>`。

卸载：`dsh plugin --profile web remove dsh-companion-speech`。插件装上、卸掉后重启 DSH 生效。

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
