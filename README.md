# Meerkat

用一间 3/4 视角的像素小工作室，实时看 Claude Code 把活派给子代理和 Codex：谁在干活、谁在挂机、哪件事完成了或出错了。

- **工位可以调**：右上角切 2 / 3 / 4 个工位；把角色拖到另一张桌子上就换位置，拖到主桌就让它当指挥；没上桌的在左下角候场，也能拖上来。
- **子代理坐在主人桌旁**的小边桌上，旁边有简短的任务名。
- **鼠标悬停或点一下角色**，能看到它在用什么模型、今天和近 7 天用了多少 token；顶栏的「用量」里有汇总（数据来自 Claude Code 和 Codex 自己的对话记录，只在本机统计）。
- 角色有 Claude Code、Codex、Cursor、DeepSeek；Cursor 和 DeepSeek 目前只检测在不在线。
- 画面全是代码一格一格画的像素图（`web/js/pixel-art.js`），放大也不糊。主题里还有「插画工作室（实验）」（用 Codex 画的图，缩小后偏糊）和「像素工作室（旧版）」。

不盯着看也行：菜单栏里的小狐獴会显示有几件活在跑。Claude 等你批准或回复时，它会变色、举起感叹号；任务完成、出错，或者 Claude 说完一段较长的回复时，会发系统通知（可以在设置的"提醒"里关掉）。

木箱上的狐獴负责放哨：跟着飞行中的任务张望，点“检测连接”时它会招手，看看大家在不在线。

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
- 单次任务可以加 `--temp`（临时任务，不在 Codex 应用里留对话）或 `--keep`；默认按设置里的「对话记录」。
- 设置里开着「统一走 Meerkat 包装层」时，Claude 直接跑 `codex exec` 或调用 Codex 的 MCP 派活工具会被插件拦下，提示它改用包装层，这样所有派给 Codex 的活都能看到进度、按设置执行。

## 接收 Codex 自己的事件

设置 → Codex →「接收 Codex 自己的事件」打开后，Meerkat 会往 `~/.codex/hooks.json` 加几条转发 hook（脚本在 `~/.meerkat/codex-hook.sh`，你自己的 hook 原样保留；关掉就原样删掉）。下次打开 Codex 时它会弹出 hook 审查，选「全部信任」一次就行。之后你直接在 Codex 应用里聊天干活，Meerkat 也会演出来，Codex 等你批准时也会提醒。

hook 配置在会话打开时读取，所以改完后要**在那个项目里新开一个 Claude Code 会话**；之后派一次子代理，画面就会动起来。

## 目录

| 路径 | 内容 |
|---|---|
| `mac/` | Mac 应用：窗口、内置接收服务（`127.0.0.1:47321`）、连接检测、图标 |
| `web/` | 画面：事件整理、模拟演示、场景引擎（`theme-studio.js`）和像素美术包（`pixel-art.js`）、旧版主题、用量面板 |
| `plugin/` | Claude Code 插件：hook、`codex-delegation` skill、包装层 `meerkat-codex`、转发脚本 |
| `hooks/` | 不装插件时手动接 hook 用的示例配置 |
| `assets/brand/` | logo 原图（Codex 生成）和合成好的 1024 应用图标；`mac/scripts/compose-icon.swift` 负责合成 |
| `assets/scene-src/` | 场景美术原图（Codex 生成的角色表、道具表、房间）；`mac/scripts/slice-scene.swift` 切成 `web/assets/scene/` 里的小图 |
| `docs/CODEX-FEASIBILITY.md` | Codex 接入实验和设置说明 |
| `docs/PRD.md` | 需求 |
| `docs/CONTRACT.md` | 应用和画面之间的接口 |
| `docs/IMPLEMENTATION.md` | 实际做了什么、验证了什么 |
