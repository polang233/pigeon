# 实施记录

## 结构

```
mac/                      Mac 应用（Swift Package，无第三方依赖）
  Sources/Meerkat/        窗口 + WKWebView、内置 HTTP 服务、连接检测
  scripts/build-app.sh    编译并组装 build/Meerkat.app，复制 web/，ad-hoc 签名
  scripts/make-icon.swift 用字符网格画像素狐獴图标，生成 AppIcon.icns
web/                      画面，纯 HTML/CSS/JS，不需要构建
  js/sprites.js           角色字符网格和调色板
  js/store.js             hook 事件 → 任务和动作（按 tool_use_id 配对）
  js/simulator.js         模拟剧本，发出和真实 hook 同格式的事件
  js/theme-pixel.js       像素工作室主题：288×162 画布 + DOM 文字层
  js/main.js              连接 /events、模拟开关、检测按钮、任务列表
hooks/                    forward.sh 和示例配置
```

## 选型

- **Mac 外壳 + 网页画面**：动效用 Canvas 画最快、最好调；Mac 外壳负责系统能力（检测其他应用、常驻窗口）。同一套网页在浏览器里也能直接看。
- **内置服务而不是单独网关**：hook 需要一个能收 HTTP 的地方，这个服务就在应用进程里，只监听 `127.0.0.1`，随应用启动和退出。
- **普通脚本而不是 ES 模块**：这样直接双击 `web/index.html`（`file://`）也能跑模拟演示。
- **低分辨率画布**：画面按 288×162 绘制，再放大并关闭平滑（`image-rendering: pixelated`），像素清脆。角色按每格 2 像素画。中文文字放在 DOM 层，不画进画布。
- **核心和主题分开**：`store.js` 只发出 `taskStart`、`taskEnd`、`activity`、`activityEnd`、`heard` 这几种事件，主题实现对应方法加上 `setAgents`、`detect`。以后加“蚂蚁工坊”“叽里咕噜办公室”只需要新写一个主题文件。

## 验证（2026-10-23）

**已验证**
- `swift build` 无警告；`mac/scripts/build-app.sh` 生成 `build/Meerkat.app` 并签名。
- 应用内置服务（用 curl 测）：
  - `/api/detect` 在本机识别出 Claude 桌面应用、ChatGPT 内置的 Codex、Cursor 的运行状态。
  - `/events` 连上先推 `detect`，15 秒心跳一次。
  - `POST /ev` 回 204 并原样广播，200KB 的请求体、分块传输、`Expect: 100-continue` 都正常。
  - 路径穿越请求一律拒绝；端口被占时弹窗退出，不抢端口。
- 画面（内置浏览器打开 `http://127.0.0.1:47321/`，用 `hooks/forward.sh` 发真实格式的事件）：
  - 顶栏显示“已连接”，开场狐獴检测并标出三个 agent 在线。
  - 子代理任务：派出、到达、完成、结果飞回，前排出现带道具的迷你子代理。
  - `mcp__codex__codex` 任务：Codex 收件、按内容播放生图动作，`isError` 结果标成出错。
  - Bash 里的 `codex exec` 能识别成 Codex 任务。
  - Claude 自己的 Grep 调用显示成“搜索”动作。
- 模拟演示：浏览器直接打开（连不上服务时）自动进入；在应用里点按钮也能切换。剧本覆盖并行子代理、Codex、出错、挂机和检测。

**真实会话验证**
- 在本项目 `.claude/settings.local.json` 接上 hook，新开一个 Claude Code 会话派出真实的 Explore 子代理，跑了两轮，事件全部到达。
- 真实事件里的发现，已据此修正：
  - 子代理现在默认在后台跑：`Agent` 的 `PostToolUse` 在派出时就触发，`tool_response` 是 `{isAsync: true, status: "async_launched", agentId}`，真正结束是 `SubagentStop`。现在遇到这种情况会保持“进行中”，等 `SubagentStop` 再收尾。
  - 子代理内部的工具调用带 `agent_id` 和 `agent_type`，按 `agent_id` 归到对应子代理头上。
  - 子代理交回报告时会调用 `SubagentHandback`，`tool_input.message` 就是报告全文，用作结果摘要。
  - 桌面应用自己的内部工具（`mcp__ccd_*`）不显示成动作。
- 第二轮在画面上确认：子代理坐在前排干活约 19 秒，期间显示它自己的“跑命令”，结束后标成完成，摘要是它的真实报告。

**没验证**
- 应用窗口本身的样子：本机截屏和辅助功能权限受限，只确认了 WebKit 进程连上了 `/events`。
- 真实的 Codex MCP 调用：本机没有 codex CLI，Codex 任务只用仿真事件测过。
- 同步（非后台）子代理的真实事件：这次两轮都是后台子代理。

## 已知问题

- 同时派出多个任务时，Claude 的打字气泡会排队依次播放，所以后派的任务出发会晚一两秒。
- 前排只有 3 张子代理桌，第 4 个起会占用最早那张。
- 任务列表最多保留 60 条，只在内存里，重开应用就清空。

## 下一步

1. 在真实 Claude Code 会话里接上 hook 走一遍，校正子代理归属和结果摘要。
2. 加第二个主题（蚂蚁工坊或叽里咕噜办公室），验证主题切换。
3. 菜单栏常驻和置顶小窗。
