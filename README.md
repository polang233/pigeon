# Meerkat

用像素工作室的小场景，实时看 Claude Code 把活派给子代理和 Codex：谁在干活、谁在挂机、哪件事完成了或出错了。

中间木箱上的狐獴负责放哨：眼睛跟着飞行中的任务转，点“检测连接”时它会站高张望，看看 Codex、Cursor 在不在线。

## 运行

需要 Xcode 命令行工具（Swift 6）。

```bash
mac/scripts/build-app.sh
```

```bash
open build/Meerkat.app
```

只想看画面：直接用浏览器打开 `web/index.html`，会自动进入模拟演示。

开发时也可以不打包，直接跑：

```bash
cd mac && swift run
```

## 接入 Claude Code

Meerkat 通过 Claude Code 的 hooks 收事件，只需要一步：把 `hooks/settings.example.json` 里的 `hooks` 一段加到你想观察的项目的 `.claude/settings.local.json` 里（这个文件只对你自己生效，不会提交）。

- 转发脚本 `hooks/forward.sh` 在后台发送，最多等 1 秒；Meerkat 没开时静默失败，不影响 Claude Code。
- 如果项目不在本机这个路径，改一下配置里 `forward.sh` 的绝对路径。
- 想让 Claude 通过 Codex 干活，需要先在 Claude Code 里把 Codex 接成 MCP 服务（名字叫 `codex`，工具名就是 `mcp__codex__*`）；用 Bash 跑 `codex exec` 也能识别。

接好后在那个项目里用 Claude Code 派一次子代理，画面就会动起来。

## 目录

| 路径 | 内容 |
|---|---|
| `mac/` | Mac 应用：窗口、内置接收服务（`127.0.0.1:47321`）、连接检测、图标 |
| `web/` | 画面：事件整理、模拟演示、像素工作室主题 |
| `hooks/` | hook 转发脚本和示例配置 |
| `docs/PRD.md` | 需求 |
| `docs/CONTRACT.md` | 应用和画面之间的接口 |
| `docs/IMPLEMENTATION.md` | 实际做了什么、验证了什么 |
