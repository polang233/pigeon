# 接口约定

Mac 应用（`mac/`）、前端（`web/`）和插件（`plugin/`）之间只靠下面这几条接口沟通。各自改实现都没关系，只要接口不变。

项目原名 Meerkat，2026-11-11 改名 Pigeon（见 `PIGEON-PLAN.md`）。本文里用新名字，凡是旧名字仍被兼容的地方，在"改名和兼容"一节集中列出。

应用内置一个只监听本机的小 HTTP 服务：`127.0.0.1:47321`。它不是单独的网关进程，随应用启动、随应用退出。

## 静态页面

| 请求 | 说明 |
|---|---|
| `GET /` 和 `GET /<path>` | 返回打包进应用的 `web/` 目录里的文件。窗口里的 WKWebView 加载 `http://127.0.0.1:47321/`，浏览器打开同一个地址也能看。 |

## 接收 Claude Code 的 hook

| 请求 | 说明 |
|---|---|
| `POST /ev` | 请求体是 Claude Code hook 通过 stdin 传来的原始 JSON，不做改写。应用收到后立刻回 `204`，再异步广播。 |

hook JSON 里会用到的字段：`hook_event_name`（`PreToolUse` / `PostToolUse` / `SubagentStop` / `UserPromptSubmit` / `Notification` / `Stop`）、`message`、`notification_type`（`permission_prompt` / `idle_prompt` / `elicitation_dialog`）、`session_id`、`cwd`、`tool_name`、`tool_use_id`、`tool_input`、`tool_response`。

## 推送给页面

| 请求 | 说明 |
|---|---|
| `GET /events` | Server-Sent Events。每条消息是一行 `data: <json>`。连上时先推一条 `detect`。 |

消息格式（`hook` 的 payload 里可能是 Claude Code 的 hook、`PigeonRun`、`PigeonNote` 或 Codex 的 hook）：

```json
{ "type": "hook",   "ts": 1730000000000, "payload": { ...原始 hook JSON... } }
{ "type": "detect", "ts": 1730000000000, "agents": { ...见下... } }
{ "type": "usage", "usage": { ...见用量统计... } }
{ "type": "settings", "settings": { ...完整设置... } }
```

## 检测 agent 是否在线

| 请求 | 说明 |
|---|---|
| `GET /api/detect` | 立即检测一次，返回 `agents` 对象。 |
| `POST /api/detect` | 同上，并通过 `/events` 广播一条 `detect`。 |

```json
{
  "claude": { "installed": true,  "running": true,  "detail": "收到过 hook" },
  "codex":  { "installed": true,  "running": true,  "detail": "ChatGPT 应用内置 Codex" },
  "cursor": { "installed": true,  "running": false, "detail": "已安装，没打开" }
}
```

检测规则：

- **codex**：`installed` = PATH 里有 `codex`，或 `/Applications/ChatGPT.app/Contents/Frameworks/Codex Framework.framework` 存在，或 `/Applications/Codex.app` 存在；`running` = bundle id 为 `com.openai.codex` 的应用在运行（本机的 ChatGPT.app 就是这个 id），或有 `codex` CLI 进程在跑。
- **cursor**：`installed` = `/Applications/Cursor.app` 存在或 PATH 里有 `cursor`；`running` = 有 bundle id `com.todesktop.230313mzl4w4u92` 的应用在运行（用 `NSWorkspace.runningApplications`）。
- **claude**：`installed` = PATH 里有 `claude`，或 `/Applications/Claude.app` 存在；`running` = 最近 10 分钟内收到过 hook，或 bundle id 为 `com.anthropic.claudefordesktop` 的应用在运行。
- `detail` 是给人看的一句中文。

## 页面没有应用时

前端在 `file://` 打开或连不上 `/events` 时，自动进入模拟模式，用内置剧本演示，不报错。

## 设置

设置由应用保存在 `~/Library/Application Support/Pigeon/settings.json`（旧路径 `…/Meerkat/settings.json` 的迁移和兼容见"改名和兼容"）。插件里的包装层和页面都通过接口读写；应用没开时，包装层直接读这个文件，读不到再读旧的 Meerkat 路径，都没有就用内置默认值。

| 请求 | 说明 |
|---|---|
| `GET /api/settings` | 返回完整设置。文件不存在时返回 `{}`（默认值由读取方补齐）。 |
| `PUT /api/settings` | 请求体是完整设置 JSON 对象，原样保存（写临时文件再改名），回 `200` 和保存后的内容，并通过 `/events` 广播 `{"type":"settings","settings":{...}}`。非对象回 `400`。 |
| `GET /api/codex/models` | 读 `~/.codex/models_cache.json`，返回 `[{"slug","name","efforts":[...]}]`；读不到返回 `[]`。 |

设置结构（`notify` 是系统通知，由应用读取；`codex` 给包装层用，以后加其他 agent；`post`、`perch` 和 `scene.theme` 是 Pigeon 新增的，见"设置新增的字段"）：

```json
{
  "version": 1,
  "notify": { "done": true, "failed": true, "waiting": true, "turnEnd": true, "turnMinSec": 60, "noteHome": true, "noteLost": true },
  "scene": {
    "theme": "loft",
    "seats": 3,
    "showSubLabels": true,
    "hoverCards": true,
    "layout": { "main": "claude", "seats": ["codex", "cursor", "deepseek"] }
  },
  "codex": {
    "preferForImages": true,
    "imageMode": "builtin",
    "imageModel": "gpt-image-2",
    "imageQuality": "medium",
    "imageAspect": "square",
    "imageTransparent": false,
    "imageDir": "assets/generated",
    "sessionMode": "keep",
    "routeAll": true,
    "autoOpen": false,
    "model": "",
    "effort": "",
    "sandbox": "auto",
    "timeoutMin": 10,
    "maxConcurrent": 2,
    "summaryChars": 300
  },
  "post": { "relayThread": "", "maxHops": 10, "waitTimeoutMin": 10, "confirmRemote": true },
  "perch": { "enabled": true }
}
```

## 包装层上报的 Codex 事件（`pigeon run`）

包装层（`pigeon run`，旧入口 `meerkat-codex` 转发到同一处）把 Codex 的执行过程也发到 `POST /ev`，`hook_event_name` 固定为 `PigeonRun`（旧名 `MeerkatCodex`，接收方两个都认）。任务 id 前缀是 `pg-`（旧前缀 `mk-`）：

```json
{ "hook_event_name": "PigeonRun", "phase": "start",    "task_id": "pg-…", "title": "…", "kind": "image", "prompt": "…", "cwd": "…", "model": "gpt-6.1-sol" }
{ "hook_event_name": "PigeonRun", "phase": "thread",   "task_id": "pg-…", "thread_id": "…" }
{ "hook_event_name": "PigeonRun", "phase": "activity", "task_id": "pg-…", "activity": "run", "detail": "npm test" }
{ "hook_event_name": "PigeonRun", "phase": "end",      "task_id": "pg-…", "status": "done", "summary": "…", "files": ["…"], "thread_id": "…", "usage": {…} }
```

## Codex 自己的 hook

Codex 原生 hook 也通过 `POST /ev` 和 SSE `hook` 发送，`payload.source` 固定为 `"codex"`。字段包括 `hook_event_name`（`SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `PermissionRequest` / `Stop` / `SubagentStart` / `SubagentStop`）、`session_id`、`turn_id`、`cwd`、`model`、`tool_name`、`tool_input`、`tool_response`、`prompt`、`last_assistant_message`、`pigeon_task_id`（旧名 `meerkat_task_id`，读取方新旧都认）。最后一个字段仅包装层派活时有值，否则为空串。

`store.ingest` 先按 `source` 分流：Codex 事件不进入 Claude 的活动、等待清理和一轮结束逻辑。`SessionStart` 记录会话目录，`SubagentStart` / `SubagentStop` 暂不创建额外任务。`pigeon_task_id` 对上现有 Codex 任务时，工具事件更新该任务的 `activity`、`realActivity` 和去掉 shell 外壳并截短的 `detail`，发出 `taskActivity`；包装层任务仍由 `PigeonRun` 的 `end` 收尾。

应用内的 `UserPromptSubmit` 创建 `id = codex:<session_id>:<turn_id 或时间戳>`、`kind = codex`、`via = codex-app` 的任务，标题用 prompt 第一行，记录模型。工具事件更新活动；`Stop` 完成这一轮，摘要取 `last_assistant_message`。没有 `turn_id` 的后续事件关联同会话最近的进行中任务。

`PermissionRequest` 产生 `{agent:"codex", session, cwd, kind:"permission", message:"Codex 要用 <tool_name>", since}` 等待项，内部 key 为 `codex:<session_id>`；同会话后续的 Pre/PostToolUse 或 Stop 解除等待。Claude 的等待项带 `agent:"claude"`，继续沿用自己的会话 key。

所有任务都有 `model` 字段（未知为空串）；Claude 子代理取 `tool_input.model`，包装层取 start 的 `model`。`store.byAgent()` 返回 `{claude:[], codex:[], subagent:[]}`，按现有任务列表顺序分组，包含历史任务；画面可按 `status === "running"` 再取当前任务。当前任务列表不创建 Claude 主对话任务，所以 `claude` 通常为空。

## Codex hook 开关

| 请求 | 说明 |
|---|---|
| `GET /api/codex/hooks` | 返回 `{installed, working, detail, legacy}`。`installed` 表示已安装，`working` 表示已收到事件，`detail` 是给人看的中文状态，`legacy` 为 true 表示装的是 Meerkat 时期的 `~/.meerkat/codex-hook.sh`（仍算已安装、还能用；关掉再打开一次会换成新脚本 `~/.pigeon/codex-hook.sh`）。 |
| `POST /api/codex/hooks` | 请求体 `{"enable":true}` 或 `{"enable":false}`，立刻安装或停用，返回更新后的同结构状态。会修改本机 Codex 配置。 |

设置面板每次打开都 GET 状态，开关反映 `installed`，显示 `detail`。切换立即 POST，失败回拨并显示错误；不进入 `settings.json`，也不等“保存”。

## 场景设置的前端接口

注意：鸽舍主题（`loft`）不再使用下面的 `seats`、`showSubLabels`、`layout`，它们只对旧版 `pixel-studio` 主题有意义，保存时一律原样保留。

`scene` 与 `codex`、`notify` 平级。默认 `seats = 3`（仅支持 2 / 3 / 4）、`showSubLabels = true`、`hoverCards = true`。`scene.layout` 由画面拖拽维护，面板保存时原样保留；保存完整设置同时保留其他顶层键及未知场景字段。

- `M.settings.scene()`：返回带默认值的当前场景设置。
- `M.settings.saveScene(patch)`：把 patch 浅合并到 scene，串行 PUT 完整设置，返回 Promise；尚未加载时先 GET，失败 reject。画面拖完可传 `{layout:{main:"claude",seats:["codex","cursor","deepseek"]}}`，调用方处理保存失败。
- `M.settings.post()`、`M.settings.perch()`：返回带默认值的"送信"和"栖木"设置；`M.settings.setLofts(lofts)`：把鸽舍列表交给设置页，用来填中继站对话的选项。前端命名空间现在是 `window.Pigeon`（脚本里仍简写为 `M`）。
- `M.settings.onScene = scene => …`：面板读取、保存、拖拽保存及 `applyRemote(settings)` 后调用。远端设置由 main.js 转交；连接状态继续由 `setLive(boolean)` 更新。

## 用量统计

| 请求 | 说明 |
|---|---|
| `GET /api/usage` | 返回今天和近 7 天的用量摘要；更新通过 SSE `{"type":"usage","usage":{…}}` 推送。 |

```json
{
  "day": "2026-10-24",
  "agents": {
    "claude": {
      "model": "claude-opus-5-5",
      "today": { "input": 228, "output": 100286, "cacheRead": 28879364, "cacheWrite": 548907, "messages": 112 },
      "week": { "input": 680, "output": 380856, "cacheRead": 97425216, "cacheWrite": 1549481, "messages": 336 }
    },
    "codex": {
      "model": "gpt-6.1-sol",
      "today": { "input": 79548, "output": 19940, "cacheRead": 1205632, "cacheWrite": 0, "messages": 1 },
      "week": { "input": 79548, "output": 19940, "cacheRead": 1205632, "cacheWrite": 0, "messages": 1 }
    }
  }
}
```

`agents` 可含 `subagent`、`cursor`、`deepseek` 或后续新增 agent；没数据的 agent 不显示。用量来自 Claude Code 和 Codex 自己的对话记录，只在本机统计。

`js/usage.js` 加载时调用 `M.Usage.start()` GET 一次（并发调用复用请求）；`M.Usage.open()` 打开对话框并刷新。`apply(summary)` 接收 SSE 摘要，`get()` 返回最新数据（初始为 null），`on(fn)` 订阅后续摘要并返回取消订阅函数，`format(n)` 将 token 数转成 `1.2 万`、`3.4 亿` 等中文单位。GET 失败时对话框显示“没连上 Pigeon 应用”，重新打开会重试。

main.js 接入点：SSE 分支调用 `M.Usage?.apply(m.usage)`；顶栏按钮调用 `M.Usage.open()`。为覆盖首次连接之前的 usage 推送，页面初始化时可在 `DOMContentLoaded` 后再调用一次 `M.Usage.start()`（脚本位于 main.js 之后）。初次连上应用时 GET `/api/settings` 后交给 `M.settings.applyRemote`，并提前设置 `M.settings.onScene`；SSE 断连时调用 `M.settings.setLive(false)`。等待提示按 `item.agent` 区分 Claude 和 Codex。

## 送信（Pigeon 新增）

### 端口和环境变量

端口不变：`127.0.0.1:47321`。环境变量 `PIGEON_PORT` 优先，没有时读 `MEERKAT_PORT`。包装层上报事件的目标端口按同样的规则取。

### 环境变量

以 `plugin/scripts/lib/common.mjs` 为准，常用的有：

| 变量 | 说明 |
|---|---|
| `PIGEON_PORT` | 应用端口，优先于 `MEERKAT_PORT` |
| `PIGEON_HOME` | 数据目录，默认 `~/.pigeon`（应用和插件都认） |
| `PIGEON_SETTINGS_FILE` | 指定设置文件，设了就不再找默认位置 |
| `PIGEON_CODEX_BIN` | 指定 `codex` 命令（兼容 `MEERKAT_CODEX_BIN`） |
| `PIGEON_WEB_ROOT` | 应用使用的网页目录（兼容 `MEERKAT_WEB_ROOT`） |
| `PIGEON_TASK_ID` | `pigeon run` 给 Codex 子进程设置的任务 id；同时设置旧名 `MEERKAT_TASK_ID` |

`pigeon run` 的并发槽位放在 `~/.pigeon/running`。

### 本机文件

| 路径 | 说明 |
|---|---|
| `~/.pigeon/journal.json` | 飞行记录。插件写，应用读。保留最近 7 天。 |
| `~/.pigeon/lofts.json` | 鸽舍和对话的缓存。插件写，应用读。 |
| `~/.pigeon/runs/` | `pigeon run` 的记录（原 `~/.meerkat/runs/`）。旧目录不迁移，也不删。 |
| `~/Library/Application Support/Pigeon/settings.json` | 设置，应用写。 |

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

- `band` 是脚环，形如 `b-` 加 10 位十六进制。
- `chain` 是链首纸条的脚环，`count` 是这是链上第几次传递。回信沿用同一条链，`count` 加一；超过设置里的 `post.maxHops`（默认 10）就拒发，状态 `refused`。
- `kind` 是 `send`（给已有对话送）或 `new`（新开对话）；`via` 是 `queue`（本机直接排队）或 `relay`（经中继站）。
- `state` 取六个值，见下表。时间戳是毫秒。
- 正文不写进文件。
- 每条纸条还有一个内部用的 `track` 对象（看护进程的截止时间、中继站对话和记录文件的位置等）。它是额外字段，读取方应忽略不认识的字段。

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

本机鸽舍的 id 固定是 `local`；远程鸽舍的 id 是 Codex 的主机 id。`relay: true` 标出哪条对话是中继站。

实际文件里还有几个额外字段：顶层的 `remoteUpdated`（上次经中继站读远程的时间），远程会话的 `projectId`。读取方应忽略不认识的字段。

### 纸条的状态

| `state` | 中文 | 含义 |
|---|---|---|
| `queued` | 待飞 | 已经排进队列，对方还没接 |
| `flying` | 飞行中 | 正在送：对方已接手，或中继站正在转发 |
| `delivered` | 已送达 | 对方开始处理 |
| `home` | 已归巢 | 对方这一轮结束，回信已取回 |
| `refused` | 被拒收 | 发送被拒（用户在确认框里拦下或没人确认、对方不存在、超过往返上限） |
| `lost` | 迷路 | 超时没有结果。不自动重发 |

### `PigeonNote` 事件

插件发到 `POST /ev`，应用原样经 SSE 广播为 `{type:"hook", payload}`：

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

- 每次状态变化发一条。
- `preview` 只在第一条里带（最多 80 字）；`answer_preview` 只在 `home` 那条里带（最多 160 字）。
- `new` 类型的纸条，`to.session` 在对方对话建好之前是空串，建好后的事件里补上。
- 应用端把超过 2 小时没有任何新消息的纸条视为过期，不再计入"在飞"的数字。
- 发件人 `from.agent`：环境变量 `CLAUDE_CODE_SESSION_ID` 存在时是 `claude`，否则是 `you`。

### 新增的 HTTP 接口

| 请求 | 说明 |
|---|---|
| `GET /api/notes` | 读 `~/.pigeon/journal.json`，返回 `{ "notes": [...] }`，按 `updated` 从新到旧，最多 100 条。文件不存在返回 `{ "notes": [] }`。 |
| `GET /api/lofts` | 读 `~/.pigeon/lofts.json` 原样返回。文件不存在返回 `{ "version": 1, "updated": 0, "lofts": [ { "id": "local", "name": "这台 Mac", "online": true, "sessions": [], "projects": [] } ] }`。 |

其余接口不变。页面加载时用 `GET /api/notes` 恢复最近的飞行记录，之后靠 SSE 里的 `PigeonNote` 更新。

### 设置新增的字段

```json
{
  "post":  { "relayThread": "", "maxHops": 10, "waitTimeoutMin": 10, "confirmRemote": true },
  "perch": { "enabled": true },
  "scene": { "theme": "loft" }
}
```

- `post.relayThread`：中继站对话的 id；空串表示没设置。
- `post.maxHops`：一条纸条链最多传递几次，默认 10。
- `post.waitTimeoutMin`：等待一张纸条的超时，单位分钟，默认 10。
- `post.confirmRemote`：往别的电脑发送或新建前是否弹框让人确认，默认开；只有明确写 `false` 才关。没同意（拦下、90 秒没人点、弹不出框）时不发，纸条状态 `refused`。
- `perch.enabled`：是否显示栖木，默认开。
- `scene.theme`：画面主题，`loft`（鸽舍）是新的默认，`pixel-studio` 是旧版像素工作室；旧值 `studio`、`illustrated` 读取时映射成 `loft`。
- 新主题不再使用 `scene.seats`、`showSubLabels`、`layout`，但保存时原样保留。
- `notify.noteHome`（归巢，默认开）和 `notify.noteLost`（被拒或迷路，默认开）：纸条的系统通知。

这些和现有的 `notify`、`scene`、`codex` 平级。读取方给缺失的字段补默认值，保存时保留不认识的字段。

## 改名和兼容

| 项目 | 旧（Meerkat） | 新（Pigeon） | 兼容情况 |
|---|---|---|---|
| 设置文件 | `~/Library/Application Support/Meerkat/settings.json` | `~/Library/Application Support/Pigeon/settings.json` | 应用启动时，新文件不存在而旧文件存在就复制一次，不删旧的；插件在应用没开时先读新路径，读不到再读旧路径 |
| 派活记录目录 | `~/.meerkat/runs/` | `~/.pigeon/runs/` | 旧目录不迁移，不删 |
| 派活事件名 | `MeerkatCodex` | `PigeonRun` | 应用和页面两个名字都认；字段和 `phase` 不变 |
| 任务 id 前缀 | `mk-` | `pg-` | 以接口约定为准，旧前缀的历史任务不受影响 |
| Codex hook 里的任务 id 字段 | `meerkat_task_id` | `pigeon_task_id` | 读取方新旧都认 |
| 任务 id 环境变量 | `MEERKAT_TASK_ID` | `PIGEON_TASK_ID` | `pigeon run` 两个都设；读取方新旧都认 |
| Codex 转发的请求头 | `x-meerkat-task` | `x-pigeon-task` | `/ev/codex` 先读新的，没有再读旧的；转发的 payload 同时带 `pigeon_task_id` 和 `meerkat_task_id` |
| Codex 转发脚本 | `~/.meerkat/codex-hook.sh` | `~/.pigeon/codex-hook.sh` | 旧脚本仍算已装（`GET /api/codex/hooks` 的 `legacy`） |
| 前端本地存储键 | `meerkat-theme` | `pigeon-theme` | 旧键仍会读 |
| 前端主题 id | `studio`、`illustrated` | `loft`（默认）、`pixel-studio`（旧版） | 旧值自动映射成 `loft`；插画主题已删除 |
| 端口环境变量 | `MEERKAT_PORT` | `PIGEON_PORT` | `PIGEON_PORT` 优先，没有时读 `MEERKAT_PORT` |
| 包装层入口 | `plugin/scripts/meerkat-codex.mjs` | `plugin/scripts/pigeon.mjs` | 旧文件保留成转发到新入口的薄壳 |
| 插件和 marketplace 名 | `meerkat` | `pigeon` | 不兼容，需要重新添加 marketplace 并安装 |
| 应用 | `Meerkat.app` | `Pigeon.app`（bundle id `dev.polang.pigeon`） | 无 |

`forward.sh`、`route-codex.mjs`、`prompt-hint.mjs` 的文件名没变（已安装的插件按这些路径调用）。
