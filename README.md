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

**推荐：装插件。** 插件会自动接好 hook，并带上“把活交给 Codex”的 skill，所有项目都生效。在 Claude Code 里：

```
/plugin marketplace add /Users/polang/Code/Projects/meerkat
/plugin install meerkat@meerkat
```

装好后新开一个会话。Claude 遇到生图、让 Codex 审查等情况会自动用上 `codex-delegation` skill，通过 `plugin/scripts/meerkat-codex.mjs` 调用 Codex，并读取 Meerkat 设置页里的偏好（生图优先、比例、是否在 Codex 里显示对话、模型、推理档位、超时等）。

**只想在某个项目里看画面**：把 `hooks/settings.example.json` 里的 `hooks` 一段加到那个项目的 `.claude/settings.local.json` 里（这个文件只对你自己生效，不会提交）。装了插件就不要再这样配，否则每个事件会收到两次。

- 转发脚本 `plugin/scripts/forward.sh` 在后台发送，最多等 1 秒；Meerkat 没开时静默失败，不影响 Claude Code。
- 如果项目不在本机这个路径，改一下配置里 `forward.sh` 的绝对路径。

## 让 Claude 把活交给 Codex

不装插件也可以直接用包装层：

```bash
plugin/scripts/meerkat-codex.mjs doctor
```

```bash
plugin/scripts/meerkat-codex.mjs run --kind image --title "登录页插图" --cwd <项目目录> --brief-file brief.md
```

它会用 ChatGPT 应用自带的 Codex 命令行，关闭 stdin（避免卡死）、按设置计时和限制并发，把每一步实时报给 Meerkat，生图结果复制到项目的 `assets/generated/`，最后只输出精简结果和 `codex://threads/<id>` 链接。
- 想让 Claude 通过 Codex 干活，需要先在 Claude Code 里把 Codex 接成 MCP 服务（名字叫 `codex`，工具名就是 `mcp__codex__*`）；用 Bash 跑 `codex exec` 也能识别。

hook 配置在会话打开时读取，所以改完后要**在那个项目里新开一个 Claude Code 会话**；之后派一次子代理，画面就会动起来。

## 目录

| 路径 | 内容 |
|---|---|
| `mac/` | Mac 应用：窗口、内置接收服务（`127.0.0.1:47321`）、连接检测、图标 |
| `web/` | 画面：事件整理、模拟演示、像素工作室主题 |
| `plugin/` | Claude Code 插件：hook、`codex-delegation` skill、包装层 `meerkat-codex`、转发脚本 |
| `hooks/` | 不装插件时手动接 hook 用的示例配置 |
| `docs/CODEX-FEASIBILITY.md` | Codex 接入实验和设置说明 |
| `docs/PRD.md` | 需求 |
| `docs/CONTRACT.md` | 应用和画面之间的接口 |
| `docs/IMPLEMENTATION.md` | 实际做了什么、验证了什么 |
