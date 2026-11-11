# Pigeon 改版方案

Meerkat 改名为 **Pigeon（信鸽）**。这份文档是这次改版的总方案和各模块之间的接口约定，四个模块并行开发时以它为准。

## 一句话

Pigeon 让你的 agent 互相传话：跨工具，也跨电脑，每张纸条的去向你都看得见。

## 和原来的 Meerkat 有什么不同

| | Meerkat | Pigeon |
|---|---|---|
| 核心 | 看 Claude Code 把活派给谁 | agent 之间送纸条：发送、等待、读回信 |
| Codex | 只能开一次性任务（`codex exec`） | 还能给已有对话发消息、新开对话、读回复 |
| 范围 | 本机 | 本机，以及 Codex 里已连接的远程设备 |
| 画面 | 夜里的像素工作室 | 黄昏屋顶上的像素鸽舍，远处是别的电脑的鸽舍 |
| 提醒 | 菜单栏和系统通知 | 再加一条贴着刘海或屏幕上沿的栖木（Perch） |

保留的东西：Claude Code hook 转发、子代理和 Codex 派活的展示、用量统计、设置页、`run` 派活（生图、审查、写代码）。

## 名词

| 英文 | 中文 | 指的是 |
|---|---|---|
| Loft | 鸽舍 | 一台电脑。本机的 id 固定是 `local`，远程的 id 是 Codex 的主机 id（`remote-control:env_…`） |
| Flock | 鸽群 | 一台电脑上的各个 agent |
| Note | 纸条 | 一条消息 |
| Band | 脚环 | 纸条的编号，形如 `b-` 加 10 位十六进制 |
| Perch | 栖木 | 贴着刘海或屏幕上沿的提醒条 |
| Waystation | 中继站 | 本机 Codex 桌面应用里专门用来转发的那条对话 |

纸条的状态（`state`），界面上用中文：

| state | 中文 | 含义 |
|---|---|---|
| `queued` | 待飞 | 已经排进队列，对方还没接 |
| `flying` | 飞行中 | 正在送：对方已接手，或中继站正在转发 |
| `delivered` | 已送达 | 对方开始处理 |
| `home` | 已归巢 | 对方这一轮结束，回信已取回 |
| `refused` | 被拒收 | 发送被拒（审批被拒、对方不存在、超过往返上限） |
| `lost` | 迷路 | 超时没有结果。不自动重发 |

## 已验证的技术事实（2026-11-11 实测）

这些是设计的依据，不要再假设别的机制：

1. `codex queue --thread <id> --message <text>` 能往本机已有的 Codex 对话排消息。Codex 桌面应用开着时，约 10～15 秒后自动接手执行。输出里有 `Queued message <id> for thread <id>`。
2. 对话的进展可以从 `~/.codex/sessions/年/月/日/rollout-*-<threadId>.jsonl` 读：每行一个 JSON，`payload.type == "task_complete"` 表示一轮结束，`payload.last_agent_message` 是这一轮的最终回复。
3. 本机对话列表在 `~/.codex/state_5.sqlite` 的 `threads` 表（字段含 `id`、`title`、`cwd`、`source`、`approval_mode`、`updated_at`、`archived`）。只读访问，用 `sqlite3` 命令行。
4. `codex exec` 建的对话 `approval_mode` 是 `never`，而且**拿不到** `codex_app` 工具。只有 Codex 桌面应用接手执行的那一轮才有 `mcp__codex_app__*` 工具。
5. 远程设备上的对话只能通过 `codex_app` 工具操作：`list_threads`、`list_projects`、`send_message_to_thread`、`create_thread`、`wait_threads`、`read_thread`。所以跨设备要经过中继站：往中继站对话排一条指令，让它替我们调这些工具。
6. 中继站必须是用户在 Codex 应用里手动建的对话（`approval_mode` 为 `on-request`）。`never` 的对话会直接拒绝 `send_message_to_thread` 和 `create_thread`。
7. 在远程新开对话要指定远程主机上已保存的项目：`create_thread({ target: { type: "project", projectId, environment: { type: "local" } }, prompt, title })`。
8. 直接连桌面应用的工具 socket（`/tmp/codex-app-tools/*.sock`）会被立刻断开。**不要尝试绕过。**
9. 每次经中继站转发都要跑一轮模型，有 token 成本。本机对话之间的发送不经过模型。

没有验证、这一版不做的：往 Claude Code 的会话里投递消息（Claude Code 只当发件方）、在栖木上直接审批。

## 模块划分

四个模块各管各的目录，互不改对方的文件。跨模块只靠下面的"接口约定"。

| 模块 | 目录 | 做什么 |
|---|---|---|
| A 送信核心 | `plugin/` | `pigeon` 命令、日志、中继、Claude Code 插件和 skill |
| B Mac 应用 | `mac/` | 改名、数据迁移、新接口、栖木 |
| C 画面 | `web/` | 鸽舍主题、飞行记录、设置页 |
| D 文档和收尾 | `docs/`、`README.md`、`.claude-plugin/`、`hooks/` | 文档改写、仓库级清单 |

`site/` 这一版不动，等功能做完再重做。

### A 送信核心（`plugin/`）

新增 `plugin/scripts/pigeon.mjs`，是唯一的命令入口。`plugin/scripts/meerkat-codex.mjs` 保留成一个转发到 `pigeon.mjs` 的薄壳，`forward.sh`、`route-codex.mjs`、`prompt-hint.mjs` 的文件名不变（已安装的插件按这些路径调用）。代码可以拆到 `plugin/scripts/lib/`。

命令：

```
pigeon lofts                      列出能到达的鸽舍和上面的对话
pigeon lofts --refresh            经中继站重新读远程鸽舍（有 token 成本）
pigeon send --to <对话> "<话>"    给已有对话送一张纸条
pigeon new --loft <鸽舍> [--project <项目>] --title "<标题>" "<话>"   新开一个对话
pigeon wait <脚环> [--timeout 分钟]   等到归巢或迷路
pigeon read <脚环>                读回信
pigeon log [-n 20]                最近的飞行记录
pigeon relay [use <对话id|latest>|check]   查看、设置或检查中继站
pigeon run …                      原来的 meerkat-codex run，行为不变
pigeon settings | doctor | open   原有命令，文案改成 Pigeon
```

要求：

- `--to` 接受对话 id、对话标题（唯一匹配时），远程对话写成 `<对话>@<鸽舍名或id>`。
- `send` 和 `new` 立刻返回脚环，同时在后台启动一个独立的看护进程跟到底（更新日志、上报事件、超时标 `lost`）。加 `--wait` 时同步等到结果并打印回信。
- 本机对话：直接 `codex queue`，然后跟对方的 rollout 文件。
- 远程对话：往中继站排一条指令，要求它调 `send_message_to_thread`（或 `create_thread`）、`wait_threads`、`read_thread`，并在最终回复里给出一段固定格式的 JSON（含脚环、是否发出、对方 threadId、回信原文）。从中继站的 rollout 里解析。指令里必须写明"用户授权本次发送"。
- 防循环：每张纸条有 `chain`（链首的脚环）和 `count`（第几次传递）。`send --reply-to <脚环>` 沿用同一条链并把 `count` 加一。`count` 超过设置里的 `post.maxHops`（默认 10）就拒发，状态 `refused`。
- 日志不存正文。只在事件里带最多 80 个字的预览，供画面显示。
- 不盲目重发。任何不确定的情况标 `lost`，把决定交给用户。
- 发件人：有环境变量 `CLAUDE_CODE_SESSION_ID` 时是 `claude`，否则是 `you`。
- Codex 桌面应用没开、中继站没设置或审批策略是 `never` 时，给出一句能照着做的中文提示。
- 给核心逻辑写测试（`node --test`），放在 `plugin/tests/`：参数解析、rollout 解析、中继回复解析、日志读写、防循环。测试不能真的调用 Codex。

插件：`plugin/.claude-plugin/plugin.json` 的 `name` 改成 `pigeon`。原 skill `codex-delegation` 保留并改文案；新增 skill `pigeon-post`，教 Claude 什么时候送纸条、怎么写纸条（对方看不到这边的对话，纸条要自成一体）、怎么等和读回信。`prompt-hint.mjs` 和 `route-codex.mjs` 的提示语改成 Pigeon，并指向新的命令和 skill 名。

### B Mac 应用（`mac/`）

- 改名：产物 `build/Pigeon.app`，可执行文件和显示名 `Pigeon`，bundle id `dev.polang.pigeon`。Swift 包和源码目录改成 `Pigeon`。
- 数据迁移：设置从 `~/Library/Application Support/Meerkat/settings.json` 搬到 `…/Pigeon/settings.json`（新文件不存在而旧文件存在时复制一次，不删旧的）。
- 新接口（见接口约定）：`GET /api/notes`、`GET /api/lofts`，以及对 `PigeonNote`、`PigeonRun` 事件的处理。
- `Watch` 认识纸条：飞行中的纸条计入菜单栏数字；归巢、被拒、迷路时按设置发系统通知。
- 栖木（Perch）：一个不抢焦点的浮动面板，贴在刘海下沿；没有刘海的屏幕贴在屏幕上沿正中。
  - 收起时是一条很小的胶囊：一只鸽子图标，加上"几张在飞、几件在等你"。全部空闲时自动淡出到几乎看不见。
  - 鼠标移上去或点击时展开：列出飞行中的纸条（从谁到谁、状态、已用时间）和等你处理的事。每行可以点：Codex 对话用 `codex://threads/<id>` 打开，其余打开主窗口。
  - 用 AppKit 或 SwiftUI 原生绘制，不依赖 `web/`。
  - 设置里可以关掉（`perch.enabled`），菜单栏菜单里也有开关。
- 菜单栏图标换成鸽子（用代码画的模板图，和现在的做法一致）。应用图标可以经包装层交给 Codex 生成。
- `mac/scripts/build-app.sh` 改成构建 `Pigeon.app`。必须能 `swift build` 通过。

### C 画面（`web/`）

- 新的默认主题"鸽舍"：黄昏的屋顶，本机是近处的大鸽舍，每个 agent 是一只有辨识度的鸽子，各有一根栖木；远程鸽舍在远处的屋顶上，按 `GET /api/lofts` 的结果出现。
- 纸条是飞行的鸽子：从发件人飞向收件人，状态变化有对应的动作（待飞时在栖木上等，飞行中沿弧线飞，已送达时落下，归巢时带着回信飞回，被拒收和迷路各有明显不同的表现）。跨鸽舍的飞行要飞过中间的天空。
- 原有的派活展示继续有效：子代理、`run` 派给 Codex 的活，在本机鸽舍内部用短途飞行表现。
- 沿用现在的做法：Canvas 上用代码画像素美术（参考 `pixel-art.js`），放大不糊。不要用缩小后会糊的位图当主体。
- 侧边的列表改成"飞行记录"：脚环、从谁到谁、状态、用时、预览。点一条能看到回信预览和打开 Codex 对话的链接。页面加载时用 `GET /api/notes` 恢复最近的记录。
- 设置页：加"送信"一组（中继站对话 id、往返上限、等待超时）和"栖木"开关。文案全部从 Meerkat 改成 Pigeon。
- 旧主题：`theme-studio.js`（插画主题，自己承认偏糊）删掉；像素工作室保留为"旧版"选项。
- 模拟模式（`simulator.js`）加一段送纸条的剧本，包括一次跨鸽舍往返，这样不开应用也能看到新画面。
- 交互和动效要有设计感，但只在关键时刻用力：一次放飞、一次归巢。照顾"减少动态效果"。

### D 文档和收尾

- `README.md`、`docs/PRD.md` 按 Pigeon 重写；`docs/CONTRACT.md` 把下面的接口约定并进去；`docs/IMPLEMENTATION.md` 末尾加一节记录这次改版。
- `.claude-plugin/marketplace.json` 改名成 `pigeon`；`hooks/settings.example.json` 里的说明同步。
- README 里的安装路径不要写死成某台机器的绝对路径。
- 最后做一遍全仓库检查：除了兼容代码和迁移说明，不应再有面向用户的"Meerkat"字样。只报告，不改 A、B、C 的目录。

## 接口约定

端口不变：`127.0.0.1:47321`。环境变量 `PIGEON_PORT` 优先，没有时读 `MEERKAT_PORT`。

### 本机文件

| 路径 | 说明 |
|---|---|
| `~/.pigeon/journal.json` | 飞行记录，A 写，B 读。保留最近 7 天。 |
| `~/.pigeon/lofts.json` | 鸽舍和对话的缓存，A 写，B 读。 |
| `~/.pigeon/runs/` | `run` 的记录（原 `~/.meerkat/runs/`）。旧目录不迁移，不删。 |
| `~/Library/Application Support/Pigeon/settings.json` | 设置，B 写。A 在应用没开时直接读这个文件，读不到再读旧的 Meerkat 路径。 |

`journal.json`：

```json
{
  "version": 1,
  "notes": [
    {
      "band": "b-3f9a02c1d7",
      "chain": "b-3f9a02c1d7",
      "count": 1,
      "kind": "send",
      "reply_to": "",
      "from": { "loft": "local", "agent": "claude", "session": "…", "title": "" },
      "to":   { "loft": "remote-control:env_…", "loft_name": "CHEN-Y9000P2023", "agent": "codex", "session": "01a1c898-…", "title": "问候" },
      "via": "relay",
      "state": "home",
      "created": 1794370024000,
      "updated": 1794370045000,
      "fingerprint": "sha256 的前 16 位",
      "error": ""
    }
  ]
}
```

`kind` 是 `send` 或 `new`；`via` 是 `queue`（本机直接排队）或 `relay`（经中继站）。正文不写进文件。

`lofts.json`：

```json
{
  "version": 1,
  "updated": 1794370000000,
  "lofts": [
    { "id": "local", "name": "这台 Mac", "online": true,
      "sessions": [ { "id": "…", "agent": "codex", "title": "…", "cwd": "…", "updated": 1794370000000, "relay": false } ],
      "projects": [] },
    { "id": "remote-control:env_…", "name": "CHEN-Y9000P2023", "online": true,
      "sessions": [ { "id": "…", "agent": "codex", "title": "问候", "cwd": "F:\\Code\\Projects", "updated": 1794366776000 } ],
      "projects": [ { "id": "477552e8-…", "name": "Mac", "path": "F:/Code/Projects" } ] }
  ]
}
```

### 事件（A 发到 `POST /ev`，应用原样经 SSE 广播为 `{type:"hook", payload}`）

纸条：

```json
{ "hook_event_name": "PigeonNote", "ts": 1794370024000,
  "band": "b-3f9a02c1d7", "chain": "b-3f9a02c1d7", "count": 1, "kind": "send", "via": "relay",
  "state": "flying",
  "from": { "loft": "local", "agent": "claude", "session": "…", "title": "" },
  "to":   { "loft": "remote-control:env_…", "loft_name": "CHEN-Y9000P2023", "agent": "codex", "session": "…", "title": "问候" },
  "preview": "构建 main 分支，把报错带回来",
  "answer_preview": "",
  "error": "" }
```

- 每次状态变化发一条，`state` 取上面六个值。
- `preview` 只在第一条里带（最多 80 字）；`answer_preview` 只在 `home` 那条里带（最多 160 字）。
- `new` 类型的纸条，`to.session` 在对方对话建好之前是空串，建好后的事件里补上。

派活（原 `MeerkatCodex`）：`hook_event_name` 改成 `PigeonRun`，字段和 `phase` 不变。B 和 C 两个名字都要认。任务 id 前缀从 `mk-` 改成 `pg-`。Codex hook 里的 `meerkat_task_id` 改成 `pigeon_task_id`，环境变量 `MEERKAT_TASK_ID` 改成 `PIGEON_TASK_ID`，读取方新旧都认。

### 新增的 HTTP 接口（B 实现）

| 请求 | 说明 |
|---|---|
| `GET /api/notes` | 读 `~/.pigeon/journal.json`，返回 `{ "notes": [...] }`，按 `updated` 从新到旧，最多 100 条。文件不存在返回 `{ "notes": [] }`。 |
| `GET /api/lofts` | 读 `~/.pigeon/lofts.json` 原样返回。文件不存在返回 `{ "version": 1, "updated": 0, "lofts": [ { "id": "local", "name": "这台 Mac", "online": true, "sessions": [], "projects": [] } ] }`。 |

其余接口不变。

### 设置新增的字段

```json
{
  "post":  { "relayThread": "", "maxHops": 10, "waitTimeoutMin": 10 },
  "perch": { "enabled": true },
  "scene": { "theme": "loft" }
}
```

和现有的 `notify`、`scene`、`codex` 平级。`notify` 增加 `noteHome`（归巢，默认开）和 `noteLost`（被拒或迷路，默认开）。读取方给缺失的字段补默认值，保存时保留不认识的字段。

## 做事的规矩

- 只改自己目录里的文件。发现别的模块需要改动，写进交付说明，不要自己动手。
- 不提交 git，不切分支，不推送。
- 界面文字和文档用中文。不机翻、不硬翻；中英并列时中文放括号里。
- 需要生成图片时，经包装层交给 Codex：`node plugin/scripts/meerkat-codex.mjs run --kind image --title "…" --cwd <仓库根> --brief-file <说明文件>`（这个入口在改版期间一直可用）。Codex 生图的注意点：
  - 提示词要逐条写清主体、朝向、占画面比例、颜色色值、背景、风格，以及明确不要什么。
  - 它画不好文字，不要让它在图里写字。
  - 颜色不会完全准，背景也不会是真正的纯色，要靠构图或边框容错。
  - 位图缩得很小会糊。画面主体仍然用代码画的像素美术。
  - 每张约 3 分钟，token 开销不小。只在确实需要位图时用（比如应用图标）。
- 做完要自己验证：能跑的测试跑一遍，能构建的构建一遍，画面在浏览器里实际看过。交付说明里分开写清楚：做了什么、怎么验证的、哪些没做或没把握。
