# dsh-companion-core（本体）

DSH 陪伴插件的本体。装上它，机器人就能接上 QQ（NapCat / OneBot 11），在 QQ 里像个朋友一样跟你私聊：
有自己的人设，记得最近聊过什么，越聊越熟，说话有打字的节奏。别的插件（表情包、长期记忆、心情、主动找你……）都装在它上面，**必装**。

机器人默认叫“小伴”，在 `.env` 的 `BOT_NAME` 里改。

## 她能做什么

- **聊天**：每条消息交给 DSH 的模型回，每个聊天一条自己的会话，接着上次的话往下聊。
- **人设**：`persona.md` 写她是谁、怎么说话，改完下一条消息就生效（不用重启）。默认人设里的 `{{NAME}}` 会换成 `BOT_NAME`。
- **短期记忆**：每个聊天记着最近几轮说了啥，换了会话也接得上。
- **熟悉度**：按聊过几天、几轮慢慢变熟（刚认识 → 一般熟 → 熟 → 很熟），越熟说话越随便。
- **像人的节奏**：连发几条会等你说完再一起回；按字数“打字”，对方能看到“正在输入”；偶尔手滑打错个字；
  深夜（睡觉时段）有时晚几分钟才回；上一轮还没忙完你又来消息，会说一句“等我下”。
- **附和点表情**：你只回了“嗯嗯”“哈哈”，她点个表情回应，不再调模型。
- **引用和撤回**：引用了某条消息她看得懂；你撤回了没回的那条，她就不回了，熟了偶尔调侃一句。
- **看图、看视频、看文件**：图片直接给模型看；视频挑几帧拼成图，有本地 Whisper 模型还能“听”里面说了啥；
  文本、代码、PDF、Word、Excel、PPT 读成字给她。
- **提醒**：`/提醒 30 喝水`，30 分钟后叫你。
- **白名单和权限**：只理白名单里的人；白名单里的人能让她用电脑上的工具做到什么程度，由 `DSH_PERMISSION_MODE` 决定。
- **守护**：内核跟着 DSH 一起起、一起停；意外退出 10 秒后自己拉起来；同一份数据只会有一个内核在跑，不会一条消息回两遍。

## 安装

先装好 DSH 和 NapCat（DSH 装插件要用 pnpm，按 DSH 的说明装好），然后：

```bash
dsh plugin --profile web add github:yzs6615/dsh-companion-plugins#core
```

用桌面版的话把 `web` 换成 `desktop`，并且先把桌面版完全退出。
也可以到 [Releases](https://github.com/yzs6615/dsh-companion-plugins/releases) 下载 `dsh-companion-core-<版本>.tgz`，
`dsh plugin --profile web add <文件路径>`。装好后重启 DSH。

卸载：`dsh plugin --profile web remove dsh-companion-core`（别的插件都靠它，一起卸掉）。

要求：Node.js 22 以上（用的是 Node 自带的 WebSocket，不用另装依赖）。

## 文件放在哪

本体的工作目录叫 COMPANION_HOME，默认是 `$DSH_HOME/companion`（没设 `DSH_HOME` 就是用户目录下的 `.dsh/companion`）。
想放别处，在 DSH 里把这个插件配置里的 `home` 改成别的目录（留空 = 默认）。第一次启动 DSH 时会在里面放好：

| 文件 | 是什么 |
| --- | --- |
| `.env` | 设置，第一次从 `.env.example` 复制一份，照着改；改完重启 DSH |
| `persona.md` | 人设，第一次从默认人设复制一份，改完下一条消息就生效 |
| `AGENTS.md` | 自动生成：装了的插件带的命令行工具怎么用（模型会读）。想自己写就删掉第一行的标记，之后不再覆盖 |
| `data/` | 聊天记录、状态、短期记忆、下载的图和文件；日志在 `data/bridge.log` |

## 连上 QQ（NapCat）

1. 装好 NapCat，用**小号**扫码登录（NapCat 是第三方协议端，主号有被风控、冻结的风险；别群发、别高频自动回复）。
2. 在 NapCat 的网页后台（WebUI）里加一个 OneBot 11 的 **WebSocket 服务器**（正向 WS）：地址 `127.0.0.1`，端口 `3001`，设一个 token。
3. 在 `.env` 里写上：

   ```ini
   ONEBOT_WS=ws://127.0.0.1:3001
   ONEBOT_TOKEN=刚才设的 token
   ALLOWED_QQ=你的QQ号
   ```

4. 重启 DSH。日志 `data/bridge.log` 里能看到连上了、白名单是谁。

## 白名单

- `ALLOWED_QQ`：哪些人私聊她会理，QQ 号逗号隔开。**空着谁都不理。**
- `ALLOWED_GROUPS`：哪些群会理，要装“群聊”插件（dsh-companion-group）才生效。
- `PROACTIVE_QQ`：主人。主动找你、写信、电脑上的事都只找这个人（第一个）；`PC_OWNER` 可以单独指定电脑是谁的。

## 只装本体时

能私聊、有人设、短期记忆、熟悉度、像人的节奏、看图看视频看文件、提醒，下面这些命令都能用。没有的：

- **群消息一概不理**（装群聊插件才理）。
- 不发表情包、语音、不唱歌：默认人设里教了她写 `[表情:…]` `[语音]` `[唱歌:…]`，本体会把这些标记抠掉，不会原样发出去。
- 心情只按时段变；不记长期的事；不会主动找你（提醒除外）。

## 命令

| 命令 | 干什么 |
| --- | --- |
| `/help`、`/帮助` | 能用哪些命令（装了的插件会补几行） |
| `/new`、`/reset` | 开一个新会话（短期记忆还在） |
| `/status` | 排错用：在不在线、正在跑几轮、熟悉度和分数 |
| `/心情`、`/亲密度` | 她现在心情怎么样、跟你多熟（只说人话，不报数字） |
| `/摸摸`（也认 `/喂鱼` `/rua` `/摸鱼`） | 摸一下，熟悉度加一点 |
| `/提醒 30 喝水` | 30 分钟后提醒你；单位可以写 `分钟` / `m` / `小时` / `h`，不写是分钟 |
| `/提醒`、`/提醒列表` | 看还有哪些提醒 |

模型输出里的 `[表情:…]` `[语音]` `[唱歌:…]` `[心情:词|为啥]` 这几个标记由本体抠掉，交给对应的插件处理；没装那个插件就只是抠掉、不发。

## 设置（.env）

开关写 `true` / `false`；**数字项别留空**（空着会被当成 0，等于关掉），不想改就整行不写。

**连接和白名单**

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ONEBOT_WS` | `ws://127.0.0.1:3001` | NapCat 的正向 WebSocket 地址 |
| `ONEBOT_TOKEN` | 空 | NapCat 里设的 token |
| `ALLOWED_QQ` | 空 | 私聊白名单，逗号隔开 |
| `ALLOWED_GROUPS` | 空 | 群白名单（要装群聊插件） |
| `PROACTIVE_QQ` | 空 | 主人 / 主动找谁，逗号隔开 |
| `PC_OWNER` | 空 | 电脑是谁的；没设就是 `PROACTIVE_QQ` 第一个 |
| `BOT_NAME` | `小伴` | 她的名字（默认人设、桌面便条这些地方用） |
| `WAKE_WORDS` | 同 `BOT_NAME` | 群里叫这些词能把她叫出来，逗号隔开 |

**模型**

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 空 | 空着就用 DSH 自己登录好的账号；填了就单独用这个 Key |
| `DSH_PERMISSION_MODE` | 空（DSH 默认） | 她能用工具做到什么程度：`read-only` / `workspace-write` / `danger-full-access` |
| `DSH_HOME` | 用户目录下的 `.dsh` | DSH 的配置目录（同一套登录和模型设置） |
| `DSH_CLI` | 自动找 | 找不到 DSH 时手动指定 `.../@deepseek-ai/dsh/lib/bin.js` |
| `AGENT_CWD` | COMPANION_HOME | 模型干活时的工作目录 |
| `PERSONA_FILE` | `COMPANION_HOME/persona.md` | 人设文件 |
| `SESSION_TIMEOUT_MS` | `300000` | 一轮最多等多久（毫秒） |
| `MAX_PROMPT_CHARS` | `6000` | 一条消息太长就截断 |
| `MAX_MESSAGE_AGE_SEC` | `120` | 比这更早的消息（比如刚连上时补过来的）不回 |
| `MEMORY` | 开 | 短期记忆 |

**像人的节奏**

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MERGE_MS` | `5000` | 连发合并：你停这么久没再发才回，0 关闭 |
| `MERGE_MAX_MS` | `15000` | 合并最多等多久 |
| `BUSY_NOTE_MS` | `45000` | 上一轮忙了这么久你又来消息，说一句“等我下” |
| `TYPING_MS_PER_CHAR` | `130` | 每个字“打”多久，0 关闭 |
| `INPUT_STATUS` | 开 | 让对方看到“正在输入” |
| `MARK_READ` | 开 | 标已读 |
| `HUMAN_SPLIT` | 开 | 一行一条拆成几个气泡发 |
| `ACK_PRIVATE` | 关 | 私聊收到就先回一句“等下” |
| `TYPO_PROB` | `0.04` | 手滑打错字的概率 |
| `SLEEP_START` / `SLEEP_END` | `1` / `7` | 睡觉时段（点）；装了“心情和作息”插件会被你带偏 |
| `SLEEP_DELAY_PROB` | `0.5` | 睡觉时段晚几分钟才回的概率，0 关闭 |
| `QUIET_HOURS` | `23-9` | 这几个钟头各插件不主动出声 |
| `REACT` / `REACT_PROB` | 开 / `0.7` | “嗯嗯”“哈哈”点表情回应 |
| `RECALL` / `RECALL_TEASE_PROB` | 开 / `0.5` | 你撤回了就不回那条；熟人偶尔调侃的概率 |
| `IGNORE_LIMIT` | `2` | 主动找了几次都没回，就先不找了，等你开口 |
| `CLOSENESS_SET` | 空 | 手动把某人的熟悉度分数调到指定值：`QQ号:分数`，逗号隔开 |

**看视频和文件**

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MEDIA` | 开 | 看懂发来的视频和文件 |
| `MEDIA_MAX_MB` | `60` | 比这大的不下 |
| `WHISPER_MODEL_DIR` | 空 | 本地 faster-whisper 模型目录（下面要有 `base/model.bin`）；不设就不“听”视频 |
| `PYTHON` | Windows 上 `python`，别的系统 `python3` | 跑 python 脚本用哪个 |

看视频要 Python 装了 `av`、`numpy`、`Pillow`；“听”要 `faster-whisper`；读 PDF / Word / Excel / PPT 分别要
`PyMuPDF`、`python-docx`、`openpyxl`、`python-pptx`。缺哪个，那一样就看不了，聊天不受影响。模型只用本地已有的，不会自己去网上下。

## 注意

- **她会在你的电脑上执行命令。** 白名单里的人（装了群聊插件的话，还有白名单群里叫她的人）说的话会交给 DSH 的模型，
  模型能用 DSH 的工具（跑命令、读写文件）。只把信得过的人加进白名单；只想让她陪聊，把 `DSH_PERMISSION_MODE` 设成 `read-only`。
- **花钱**：每轮聊天调一次模型，用的是 DSH 登录的账号（或 `DEEPSEEK_API_KEY`）的额度。
- **联网**：只连 NapCat，下载 QQ 发来的图和文件；模型调用走 DSH。
- `data/` 里有聊天内容，别发给别人。
- 用小号登 NapCat，主号有被风控的风险。

## 跟别的插件的关系

别的插件都把自己登记到本体，由本体的内核加载；插件装上、卸掉后重启 DSH 生效。没装的插件，它那部分当没有，聊天照常。
插件怎么写见仓库里的 [docs/插件接口.md](https://github.com/yzs6615/dsh-companion-plugins/blob/main/docs/插件接口.md)。

## 许可证

MIT
