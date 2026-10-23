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

## 提醒和菜单栏（2026-10-24）

目标是让 Meerkat 在你不盯着看的时候也有用。

- **插件**：多转发 `UserPromptSubmit`、`Notification`、`Stop`、`PostToolUseFailure`（工具失败走这个单独的事件）。
- **应用（`Watch.swift`）**：在服务的串行队列上记下"在跑的任务"和"等你的会话"，规则和网页里的 `Store` 一致。
  - `Notification` 表示这个会话在等你；同一会话再来 `UserPromptSubmit`、工具调用或 `Stop`，就算等待结束。
  - `Stop` 时，如果这一轮（从 `UserPromptSubmit` 算起）超过 `turnMinSec` 秒，就发"Claude 说完了"；之后 5 分钟内的空闲提醒不再重复。
  - 子代理里的工具调用（带 `agent_id`）不算主对话恢复，不会清掉"等你"。
  - 只有批准、提问、空闲三类通知算等你；登录成功之类忽略。
  - 两小时没收尾的任务、六小时没解除的等待当作丢了事件，每分钟清一次。
  - 正看着 Meerkat 窗口时不发通知，也不记作"已提醒过"。
- **菜单栏（`StatusBar.swift`）**：像素狐獴图标。闲着时是轮廓，有活时显示件数，等你时变成暖色、举起感叹号，并显示"等你"。菜单里列出等待项和在跑的任务。
- **系统通知**：完成、出错、等你批准或回复、长一轮说完时发出；正看着 Meerkat 窗口时不发。点通知会切到 Claude 应用。第一次发通知时，系统会问你是否允许。
- **网页**（Codex 实现）：任务列表顶部加了"Claude 在等你"横条，狐獴举牌喊人，设置里加了"提醒"一节。

Codex 审查了这批改动，找出 7 个问题（漏了工具失败事件、子代理误清等待等），都已修掉。

验证：伪造 hook 事件后，画面横条、狐獴举牌、任务完成都正常；设置面板的提醒一节能显示。菜单栏图标在这台机器上被刘海或菜单栏管理工具挡住了，没截到图。系统通知还没有在真实会话里收到过。

## 立体工作室、用量和 Codex 事件（2026-10-24）

- **场景**（`web/js/theme-studio.js`）：画布 384×216，3/4 俯视角。房间、家具、角色是 Codex 按同一份风格说明画的三张表（`assets/scene-src/`），`mac/scripts/slice-scene.swift` 按透明区域切格、缩到像素尺寸、把半透明边缘二值化。
  - 显示器正对观众，角色坐在显示器旁边（主桌坐左、工位坐右），不然脸会被挡住。
  - 所有东西按地板 y 从远到近画；物体下面有像素阴影；鼠标移动时背景有 3 像素视差。
  - 工位 2/3/4 各有一套位置。增减工位时桌子从地板升起或沉下，角色从左下角候场区走进走出；走路时走在桌子前面。
  - 拖拽：角色或候场区的名牌拖到桌子上，和桌上的人交换；拖到主桌当指挥。布局存在 `settings.json` 的 `scene.layout`；模拟演示里的拖动不保存。
  - 子代理小帮手是浅灰图，按主人颜色染色；边桌优先放在朝画面中间的一侧。
  - 悬停或点击角色显示卡片：状态、连接、模型、今天和近 7 天的用量、正在跑的子代理。
- **用量**（`Usage.swift`）：hook 里带 `transcript_path`，应用在后台读对话记录新增的部分。Claude 按 message.id 去重；Codex 取 `token_count` 累计值的差额，`turn_context` 里取模型名。按记录里的时间戳分天，读到的位置存在 `usage.json`，重开不重复计。包装层的临时任务没有记录文件，用它报的总量。
- **Codex 自己的 hook**（`CodexHooks.swift`）：装在 `~/.codex/hooks.json`，只增删指向 `~/.meerkat/codex-hook.sh` 的条目。事件发到 `/ev/codex`，应用加上 `source:"codex"` 和包装层任务 id 再广播；网页和菜单栏都不把它们当成 Claude 的事件。Codex 的信任记录带内容哈希，这边算不出来，所以用"收到过事件"判断是否生效。
- **统一走包装层**（`plugin/scripts/route-codex.mjs`）：PreToolUse 拦下 Bash 里的 `codex exec` / `codex e` 和 Codex MCP 的派活工具（继续对话的 reply 放行），用 deny 理由告诉 Claude 改用包装层。
- **DeepSeek**：检测 DeepSeek Harness（`com.deepseek.dsh`）在不在线。
- 网页的 Codex 事件处理、用量面板、hook 开关和场景设置由 Codex 实现。

- **改用像素美术包（同一天）**：Codex 生成的图本身不是严格的像素网格，缩到二三十像素时比例不是整数，边缘发糊。默认画面改成 `web/js/pixel-art.js`：房间（透视木地板、月光和台灯光用棋盘格抖动）、3/4 视角的桌子、角色全部用代码按格子画，主角色每格 3 像素，小帮手和狐獴每格 2 像素，外面统一描 1 像素深色边。场景引擎不变，只是换了美术包；插画版保留为「插画工作室（实验）」。Cursor 重画成带箭头徽记的小立方体，新增 DeepSeek 小鲸鱼；干活时有两帧交替，像在打字。角色排在自己桌子前面画，下半身被桌面挡住。

验证：新场景在浏览器里跑模拟，2/3/4 工位切换、拖到主桌、从候场区拖上场、悬停卡片都看过；用量读到了真实的 Claude 数据；Codex hook 已装进 `~/.codex/hooks.json`，还没在 Codex 里信任，所以 Codex 自己的事件还没实测。

## 已知问题

- 同时派出多个任务时，Claude 的打字气泡会排队依次播放，所以后派的任务出发会晚一两秒。
- 每个主人旁边最多 3 张子代理边桌，第 4 个起会占用最早那张。4 人布局时边桌可能和别的桌子挨得很近。
- 任务列表最多保留 60 条，只在内存里，重开应用就清空。

## 下一步

1. 在真实 Claude Code 会话里接上 hook 走一遍，校正子代理归属和结果摘要。
2. Codex 在 Codex 里信任 hook 后，实测它自己的对话和子代理（SubagentStart）在画面里的表现。
3. 置顶小窗。
