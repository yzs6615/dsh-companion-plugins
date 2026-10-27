# NapCat 部署备忘

本目录只是辅助文件；真正跑起来的是 `..\tools\napcat\app\` 里的 NapCat。

## 这台机器的情况

- 已下载 `NapCat.Shell.Windows.Node.zip`（v4.18.41）并解压到 `tools\napcat\app`。
- 机器上**已安装 QQ**：`C:\yyb\QQ.exe`，版本 `9.9.29-47354`，在 NapCat 4.18.41
  的兼容列表里；注册表项 `HKLM\SOFTWARE\WOW6432Node\...\Uninstall\QQ` 也齐全。
- 启动入口是 `app\napcat\launcher.bat`（不是 `napcat.bat`）：它从注册表找 QQ，
  请求管理员权限后注入并启动。`start-napcat.cmd` 已指向它。
- DSH 沙箱里启动会 `spawn EPERM`，必须在桌面双击。

## 启动

1. 托盘退出正在运行的 QQ。
2. 双击 `start-napcat.cmd` 或桌面的「启动QQ机器人」。
3. UAC 点“是”，等 QQ 窗口出现，用手机扫码。
4. 登录后 NapCat 控制台会打印 WebUI 地址（默认 `http://127.0.0.1:6099`）和 token。

## 配置

`node napcat/setup-onebot.mjs [QQ号]` 会写 `config/onebot11.json`（模板）和
`config/onebot11_<QQ号>.json`，内容是一个监听 `127.0.0.1:3001` 的正向 WebSocket
服务，token 同步写进 `agent-bridge\.env` 的 `ONEBOT_TOKEN`。

如果你改用 OneKey 装到别的目录，用 `NAPCAT_CONFIG_DIR` 指定该目录的 `config`
再运行脚本。

## 风控提示

NapCat 属于第三方协议端，不是腾讯官方机器人。用主号有被封/冻结的风险，
建议用**不常用的小号**，不要群发、不要高频自动回复。
