# 接口约定

Mac 应用（`mac/`）、前端（`web/`）和插件（`plugin/`）之间只靠下面这几条接口沟通。各自改实现都没关系，只要接口不变。

应用内置一个只监听本机的小 HTTP 服务：`127.0.0.1:47321`。它不是单独的网关进程，随应用启动、随应用退出。

## 静态页面

| 请求 | 说明 |
|---|---|
| `GET /` 和 `GET /<path>` | 返回打包进应用的 `web/` 目录里的文件（打包时去掉 `web/test/`、`web/README.md`、`web/art/local/`）。窗口里的 WKWebView 加载 `http://127.0.0.1:47321/`，浏览器打开同一个地址也能看。 |

## 接收 Claude Code 的 hook

| 请求 | 说明 |
|---|---|
| `POST /ev` | 请求体是 Claude Code hook 通过 stdin 传来的原始 JSON，不做改写。应用收到后立刻回 `204`，再异步广播。 |

hook JSON 里会用到的字段：`hook_event_name`（`PreToolUse` / `PostToolUse` / `SubagentStop` / `UserPromptSubmit` / `Notification` / `Stop`）、`message`、`notification_type`（`permission_prompt` / `idle_prompt` / `elicitation_dialog`）、`session_id`、`cwd`、`tool_name`、`tool_use_id`、`tool_input`、`tool_response`。

## 推送给页面

| 请求 | 说明 |
|---|---|
| `GET /events` | Server-Sent Events。每条消息是一行 `data: <json>`。连上时先推一条 `detect`。 |

消息格式（`hook` 只转网页用得到的 `PigeonNote`、`PigeonRun`；Claude Code 自己的 hook 和 Codex 的 hook 只在应用里用，不经 `/events` 转出去）：

```json
{ "type": "hook",   "ts": 1730000000000, "payload": { ...原始 hook JSON... } }
{ "type": "detect", "ts": 1730000000000, "agents": { ...见下... } }
{ "type": "usage", "usage": { ...见用量统计... } }
{ "type": "settings", "settings": { ...完整设置... } }
{ "type": "lofts", "lofts": { ...和 GET /api/lofts 一样... } }
{ "type": "queue", "items": [ ...等你处理的一队... ] }
```

`lofts` 和 `queue` 两种见后面「等你处理的一队」和「对话：`GET /api/lofts` 现在带状态」。

## 检测 agent 是否在线

| 请求 | 说明 |
|---|---|
| `GET /api/detect` | 立即检测一次，返回 `agents` 对象。 |
| `POST /api/detect` | 同上，并通过 `/events` 广播一条 `detect`。 |

```json
{
  "claude": { "installed": true,  "running": true,  "detail": "收到过 hook" },
  "codex":  { "installed": true,  "running": true,  "detail": "ChatGPT 应用内置 Codex" },
  "cursor": { "installed": true,  "running": false, "detail": "已安装，没打开" },
  "deepseek":    { "installed": true, "running": false, "detail": "已安装，没打开" },
  "antigravity": { "installed": true, "running": true,  "detail": "Antigravity 正在运行" }
}
```

检测规则：

- **codex**：`installed` = PATH 里有 `codex`，或 `/Applications/ChatGPT.app/Contents/Frameworks/Codex Framework.framework` 存在，或 `/Applications/Codex.app` 存在；`running` = bundle id 为 `com.openai.codex` 的应用在运行（本机的 ChatGPT.app 就是这个 id），或有 `codex` CLI 进程在跑。
- **cursor**：`installed` = `/Applications/Cursor.app` 存在或 PATH 里有 `cursor`；`running` = 有 bundle id `com.todesktop.230313mzl4w4u92` 的应用在运行（用 `NSWorkspace.runningApplications`）。
- **claude**：`installed` = PATH 里有 `claude`，或 `/Applications/Claude.app` 存在；`running` = 最近 10 分钟内收到过 hook，或 bundle id 为 `com.anthropic.claudefordesktop` 的应用在运行。
- **deepseek**：`installed` = `/Applications/DeepSeek Harness.app` 存在；`running` = bundle id `com.deepseek.dsh` 的应用在运行。
- **antigravity**：`installed` = `/Applications/Antigravity.app` 存在；`running` = bundle id `com.google.antigravity` 的应用在运行。给它派活要它开着。
- `detail` 是给人看的一句中文。

## 页面没有应用时

网页启动时读一次 `GET /api/lofts` 来判断是谁在服务它：

- 读得到，并且回的是 `{ "lofts": [...] }`：当作应用在服务，用真数据（应用模式），经 HTTP 读写、经 `/events` 收更新。
- 读不到（页面是 `python3 tools/serve.py` 或别的静态服务放出来的，`/api/*` 回 404），或回的不是这个形状：进入演示模式，用示例数据，页面里画一个假的菜单栏和刘海，侧栏底下标"演示"。演示模式不报错，也不往任何服务写东西。

不再支持在 Finder 里双击 `index.html`（`file://`）打开：页面用 ES 模块，要经 HTTP 加载。想不开应用就看页面：看演示用 `python3 tools/serve.py <端口>`；看应用模式用 `node tools/fake-hub.mjs 47421`（一个假的本机服务，在内存里实现本文里网页要用的接口，数据是编的，不要用 47321）。`tools/serve.py` 只转 `/api/magpie/hello` 和 `/api/magpie/quotas`，其余 `/api/*` 回 404。

## 设置

设置由应用保存在 `~/Library/Application Support/Pigeon/settings.json`。插件里的包装层和页面都通过接口读写；应用没开时，包装层直接读这个文件，读不到就用内置默认值。

| 请求 | 说明 |
|---|---|
| `GET /api/settings` | 返回完整设置。文件不存在时返回 `{}`（默认值由读取方补齐）。 |
| `PUT /api/settings` | 请求体是完整设置 JSON 对象，原样保存（写临时文件再改名），回 `200` 和保存后的内容，并通过 `/events` 广播 `{"type":"settings","settings":{...}}`。非对象回 `400`。 |
| `PATCH /api/settings` | 请求体只写要改的那几处：对象逐层合并，值为 `null` 是删掉这一项，数组整个换。读、合并、写都在应用里一次做完，所以页面、菜单栏、刘海、命令行同时改不会互相盖掉。回 `200` 和保存后的完整设置，照样广播 `settings`。页面存设置都用它；`PUT` 留给要整个换掉的场合。非对象回 `400`。 |
| `GET /api/codex/models` | 读 `~/.codex/models_cache.json`，返回 `[{"slug","name","efforts":[...]}]`；读不到返回 `[]`。 |

设置结构（`notify` 是系统通知，由应用读取；`codex` 给包装层用，以后加其他 agent；`post`、`perch` 和 `scene.theme` 是 Pigeon 新增的，见"设置新增的字段"；`scene` 是旧界面的，现在不用，见"场景设置（旧界面）"）：

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
    "openWhen": "end",
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

包装层（`pigeon run`）把 Codex 的执行过程也发到 `POST /ev`，`hook_event_name` 固定为 `PigeonRun`。任务 id 前缀是 `pg-`：

```json
{ "hook_event_name": "PigeonRun", "phase": "start",    "task_id": "pg-…", "title": "…", "kind": "image", "prompt": "…", "cwd": "…", "model": "gpt-6.1-sol" }
{ "hook_event_name": "PigeonRun", "phase": "thread",   "task_id": "pg-…", "thread_id": "…" }
{ "hook_event_name": "PigeonRun", "phase": "activity", "task_id": "pg-…", "activity": "run", "detail": "npm test" }
{ "hook_event_name": "PigeonRun", "phase": "end",      "task_id": "pg-…", "status": "done", "summary": "…", "files": ["…"], "thread_id": "…", "usage": {…} }
```

## Codex 自己的 hook

Codex 原生 hook 也通过 `POST /ev` 和 SSE `hook` 发送，`payload.source` 固定为 `"codex"`。字段包括 `hook_event_name`（`SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `PermissionRequest` / `Stop` / `SubagentStart` / `SubagentStop`）、`session_id`、`turn_id`、`cwd`、`model`、`tool_name`、`tool_input`、`tool_response`、`prompt`、`last_assistant_message`、`pigeon_task_id`。最后一个字段仅包装层派活时有值，否则为空串。

新界面里，这些事件由页面和应用按下面的规则处理（旧前端 `web/js/store.js` 里按任务展示这些事件的那套逻辑已经删除，不再是约定）：

- 页面（`web/src/backend/adapt.js` 的 `mergeRun`）：把 `PigeonRun` 的 `start`、`thread`、`activity`、`end` 合并成一件"交给 Codex 的活"，和 `PigeonNote` 的消息一起放进任务列表。
- 应用（`mac/Sources/Pigeon/Sessions.swift`）：按 `payload.source` 区分 Codex 和 Claude Code 的 hook，算出每个对话的 `state`、`activity`（见「对话的状态和在做什么」）；`PermissionRequest` 让对话变成 `wait`、`activity` 是 `waiting`。
- `pigeon_task_id` 仅在 `pigeon run` 派活时有值，用来把 Codex 的事件对上那件活。

## Codex hook 开关

| 请求 | 说明 |
|---|---|
| `GET /api/codex/hooks` | 返回 `{installed, working, detail}`。`installed` 表示已安装（`~/.codex/hooks.json` 里有指向 `~/.pigeon/codex-hook.sh` 的 hook），`working` 表示已收到事件，`detail` 是给人看的中文状态。 |
| `POST /api/codex/hooks` | 请求体 `{"enable":true}` 或 `{"enable":false}`，立刻安装或停用，返回更新后的同结构状态。会修改本机 Codex 配置。 |

设置面板每次打开都 GET 状态，开关反映 `installed`，显示 `detail`。切换立即 POST，失败回拨并显示错误；不进入 `settings.json`，也不等“保存”。

## 场景设置（旧界面）

`scene` 与 `codex`、`notify` 平级，是旧界面（像素鸽舍、像素工作室）用的设置：`theme`、`seats`、`showSubLabels`、`hoverCards`、`layout`。新界面不读、不写这些字段，应用和插件也不用。它们仍然可能出现在用户的设置文件里，所以保存设置时要原样保留（新界面的设置面板就是先 GET 完整设置、只改自己关心的字段、再 PUT 回去，不认识的字段原样留着）。新界面的外观设置（明暗、配色、场景、连线、实验样式）只存在浏览器里，不进设置文件，见「第一版重构补充的接口」。

旧界面在页面里暴露过的 `M.settings`、`M.Usage` 这些脚本接口，随旧前端（`web/js/`）一起删除了，不再是约定。

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

页面读用量的做法在 `web/src/backend/live.js`：加载时 GET 一次，之后靠 SSE 的 `usage` 更新。应用没开（演示模式）时用示例数据。

## 送信（Pigeon 新增）

### 端口和环境变量

端口：`127.0.0.1:47321`，环境变量 `PIGEON_PORT` 可以改。包装层上报事件的目标端口按同样的规则取。

### 环境变量

以 `plugin/scripts/lib/common.mjs` 为准，常用的有：

| 变量 | 说明 |
|---|---|
| `PIGEON_PORT` | 应用端口，默认 47321 |
| `PIGEON_HOME` | 数据目录，默认 `~/.pigeon`（应用和插件都认） |
| `PIGEON_SETTINGS_FILE` | 指定设置文件，设了就不再找默认位置 |
| `PIGEON_CODEX_BIN` | 指定 `codex` 命令 |
| `PIGEON_WEB_ROOT` | 应用使用的网页目录 |
| `PIGEON_TASK_ID` | `pigeon run` 给 Codex 子进程设置的任务 id |

`pigeon run` 的并发槽位放在 `~/.pigeon/running`。

### 本机文件

| 路径 | 说明 |
|---|---|
| `~/.pigeon/journal.json` | 任务记录。插件写，应用读。保留最近 7 天。 |
| `~/.pigeon/lofts.json` | 设备和对话的缓存。插件写，应用读。 |
| `~/.pigeon/runs/` | `pigeon run` 的记录。 |
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
      "model": "",
      "effort": "",
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

- `band` 是编号，形如 `b-` 加 10 位十六进制。
- `chain` 是链首消息的编号，`count` 是这是链上第几次传递。回信沿用同一条链，`count` 加一；超过设置里的 `post.maxHops`（默认 10）就拒发，状态 `refused`。
- `kind` 是 `send`（给已有对话送）或 `new`（新开对话）；`via` 是 `queue`（本机直接排队）或 `relay`（经中继站）。
- `model` 和 `effort` 是 `pigeon new --model / --effort` 指定的新对话模型和思考强度；没指定是空串，表示用对方的默认设置。本机经 `codex exec` 的 `-m` 和 `model_reasoning_effort` 生效，远程经中继站写进 `create_thread` 的 `model` 和 `thinking` 生效。`send` 给已有对话发时总是空串，已有对话换不了模型。
- `state` 取六个值，见下表。时间戳是毫秒。
- 正文不写进文件。
- `from.cwd`（2026-11-23 起）：发件那个 Claude Code 对话的项目目录。应用按它把消息归进项目频道（见 `CHANNELS.md`）；你自己发的、旧的记录没有这个字段。
- 每条消息还有一个内部用的 `track` 对象（后台进程的截止时间、中继站对话和记录文件的位置等）。它是额外字段，读取方应忽略不认识的字段。

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

本机设备的 id 固定是 `local`；远程设备的 id 是 Codex 的主机 id。`relay: true` 标出哪条对话是中继站。

实际文件里还有几个额外字段：顶层的 `remoteUpdated`（上次经中继站读远程的时间），远程会话的 `projectId`。读取方应忽略不认识的字段。

### 消息的状态

| `state` | 界面上叫 | 旧叫法 | 含义 |
|---|---|---|---|
| `queued` | 排队 | 待飞 | 已经排进队列，对方还没接 |
| `flying` | 进行中 | 飞行中 | 正在送：对方已接手，或中继站正在转发 |
| `delivered` | 已送达 | 已送达 | 对方开始处理 |
| `home` | 已回信 | 已归巢 | 对方这一轮结束，回信已取回 |
| `refused` | 没发出 | 被拒收 | 发送被拒（用户拦下或没人确认、对方不存在、超过往返上限）。原因见下面的 `reason` |
| `lost` | 没回音 | 迷路 | 超时没有结果。不自动重发。经中继站送到了、只是没等到回信的，可以 `pigeon fetch <编号>` 补取，取到后改成 `home` |

"旧叫法"是旧界面和旧文档里的说法，现在只在这里留作对照。第一版另加 `asking`（界面上叫等你确认），见「新界面要的数据」。

### `PigeonNote` 事件

插件发到 `POST /ev`，应用把原文原样经 SSE 广播为 `{type:"hook", payload}`（`PigeonRun` 也一样）：

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
- `new` 类型的消息，`to.session` 在对方对话建好之前是空串，建好后的事件里补上。
- 应用端把超过 2 小时没有任何新消息的消息视为过期，不再计入"进行中"的数字。
- 发件人 `from.agent`：环境变量 `CLAUDE_CODE_SESSION_ID` 存在时是 `claude`，否则是 `you`。

### 新增的 HTTP 接口

| 请求 | 说明 |
|---|---|
| `GET /api/notes` | 读 `~/.pigeon/journal.json`，返回 `{ "notes": [...] }`，按 `updated` 从新到旧，最多 100 条。文件不存在返回 `{ "notes": [] }`。应用自己发出、原文还在内存里的消息多一个 `retryable: true`（见「应用自己派活」）。 |
| `GET /api/lofts` | 读 `~/.pigeon/lofts.json` 原样返回。文件不存在返回 `{ "version": 1, "updated": 0, "lofts": [ { "id": "local", "name": "这台 Mac", "online": true, "sessions": [], "projects": [] } ] }`。 |

其余接口不变。页面加载时用 `GET /api/notes` 恢复最近的任务记录，之后靠 SSE 里的 `PigeonNote` 更新。

### 设置新增的字段

```json
{
  "post":  { "relayThread": "", "maxHops": 10, "waitTimeoutMin": 10, "confirmRemote": true },
  "perch": { "enabled": true },
  "scene": { "theme": "loft" }
}
```

- `post.relayThread`：中继站对话的 id；空串表示没设置。所有远程设备默认共用这条。
- `post.relayByHost`：某台远程设备单独用的中继站，`{ "主机 id": "对话 id" }`。往那台发、在那台新开对话、补取那台的回信都经它；没写的跟着 `post.relayThread`。重读远程设备（`lofts --refresh`）总是用共用的那条。
- `post.relayUsed`：用过的中继站对话 id，最新的在前，最多 20 条。换中继站时换下来的和换上去的都记进来，接入页列出来，能归档、删除。
- `post.maxHops`：一条消息链最多传递几次，默认 10。
- `post.waitTimeoutMin`：等待一张消息的超时，单位分钟，默认 10。
- `post.confirmRemote`：往别的电脑发送或新建前是否让人确认，默认开；只有明确写 `false` 才关。没同意（拦下、`post.crossTimeoutSec` 秒没人点、问不出）时不发，消息状态 `refused`。确认现在先在 Pigeon 自己的面板里问（见"等你处理的一队"），问不出来才退回系统对话框。
- `perch.enabled`：旧版的"是否显示屏幕上沿的提醒条"，默认开。新版用 `perch.notch`（见"设置再新增"）；`perch.notch` 没写过时应用沿用 `perch.enabled`（`mac/Sources/Pigeon/Settings.swift` 的 `notchEnabled()`）。
- `scene.theme`：旧界面的画面主题（`loft`、`pixel-studio`；旧值 `studio`、`illustrated` 映射成 `loft`）。新界面不用，保存时原样保留。
- `notify.noteHome`（已回信，默认开）和 `notify.noteLost`（没发出或没回音，默认开）：消息的系统通知。

这些和现有的 `notify`、`scene`、`codex` 平级。读取方给缺失的字段补默认值，保存时保留不认识的字段。

## 新界面要的数据

2026-11-13 按新界面原型定的，取舍见 `DESIGN.md` 的"重构前定下的事"。第一版已经实现，但哪些真能做以「第一版真的能做的」为准（比如 `relay`、`split` 两类等你处理的事只留了接口，还不会产生）。现有字段不变，下面都是新增。读取方照旧忽略不认识的字段。

### 指挥

设置里新增 `lead`：

```json
{ "lead": { "kind": "agent", "agent": "claude", "loft": "local" } }
{ "lead": { "kind": "you" } }
```

- `kind: "agent"` 时，这个 agent 最近一次派活的那个对话画在指挥台中心。
- `kind: "you"` 时由用户在 Pigeon 里派活，消息的 `from.agent` 是 `you`，回信只进任务页和刘海，不送回任何对话。
- 默认 `{ "kind": "agent", "agent": "claude", "loft": "local" }`。

### 消息的状态和原因

在原来六个状态上加一个 `asking`，没发出（`refused`）加原因：

| `state` | 界面上叫 | 说明 |
|---|---|---|
| `asking` | 等你确认 | 新增。排在等你处理的一队里 |
| `queued` | 排队 | 不变 |
| `flying` | 进行中 | 不变 |
| `delivered` | 已送达 | 不变 |
| `home` | 已回信 | 不变 |
| `refused` | 没发出 | 新增 `reason`：`blocked` 你拦下、`timeout` 没人理、`no_target` 对方不在了、`max_hops` 来回超过上限、`offline` 那台连不上 |
| `lost` | 没回音 | 不变。界面上给"重发"：新消息带 `retry_of`，值是原来的编号 |

- 暂停不是一个状态：消息上 `paused: true`，叠在 `queued` 或 `asking` 上。
- 拦下和超时以前都只是 `refused`，靠 `reason` 分开。

### 为什么给它、交出去多少

消息新增两个对象，派活工具从指挥那里收到：

```json
"why": { "kind": "rule", "rule": "r3", "suggested": { "agent": "codex", "loft": "…" }, "reason": "指挥写的一句理由" },
"ctx": { "tokens": 61000, "window": 200000, "files": ["mac/Sources/Pigeon/Settings.swift"] }
```

- `why.kind`：`rule` 照规则、`quota` 额度不够改派、`override` 指挥没照建议、`lead` 没有规则命中由指挥判断。
- `ctx.tokens` 是估算；装了 magpie 时可以用它的 `/v1/messages/count_tokens` 数。`window` 是对方模型的上下文长度。

### 对话的状态和在做什么

对话（`lofts.json` 的 sessions）新增：

| 字段 | 说明 |
|---|---|
| `state` | `run` 在干活、`wait` 等你、`idle` 空闲、`done` 刚完成，新增 `error` 出错 |
| `error` | 出错时的一句话（连不上、额度用完、进程退出），界面上显示并给"重试" |
| `activity` | 在做什么，给形象挑动作。由应用按 hook 算，不让页面去猜标题 |

`activity` 的取值和来源：

| 值 | 来源 |
|---|---|
| `thinking` | `UserPromptSubmit` 之后、还没调工具 |
| `reading` | 调 Read、Grep、Glob、WebFetch 这类读的工具 |
| `typing` | 调 Edit、Write 这类改文件的工具 |
| `building` | 调 Bash，命令像构建（build、make、cargo、xcodebuild…） |
| `testing` | 调 Bash，命令像测试（test、pytest、jest…） |
| `delegating` | 派活给别的 agent，或开了子代理 |
| `waiting` | 在等你批准或回答 |

### 等你处理的一队

| 请求 | 说明 |
|---|---|
| `GET /api/queue` | `{ "items": [...] }`，按时间从旧到新 |
| `POST /api/queue/<id>` | 请求体 `{ "action": "release" \| "block" \| "release_masked" }`。`release_masked` 是打码后放行 |
| `POST /api/ask` | 插件用：把一件要问的事排进队列，挂着等结果再返回 `{ "action": … }`。应用没开时插件退回系统对话框 |

SSE 新增 `{ "type": "queue", "items": [...] }`，队列一变就推一次。

一条：

```json
{ "id": "q1", "kind": "cross", "band": "b-…", "from": { "loft": "local", "agent": "claude", "session": "…" },
  "to": { "loft": "…", "agent": "claude", "session": "" }, "preview": "…", "rule": "r3",
  "created": 1794370024000, "deadline": 1794370114000, "secrets": ["npm token"] }
```

- `kind`：`cross` 跨设备发送、`relay` 接活的 agent 往下转派、`split` 指挥拆活（带 `parts`：`[{ "to": {...}, "preview": "…" }]`）。
- `deadline` 只有 `cross` 有，默认创建后 90 秒。
- `secrets` 是发送前查到的疑似密钥类别，没有就不带。

### 设置再新增

```json
{
  "post":   { "askRelay": true, "askSplit": true, "crossTimeoutSec": 90 },
  "perch":  { "notch": true },
  "quota":  { "show": "hover", "low": 20 },
  "secrets":{ "mode": "warn" }
}
```

- `post.askRelay`：接活的 agent 往下转派前问不问；`post.askSplit`：指挥一次拆 3 件以上时问不问；`post.crossTimeoutSec`：跨设备发送等几秒没人点就不发。
- `perch.notch`：用刘海还是菜单栏图标。
- `quota.show`：`hover` 悬停时看、`always` 一直显示；`quota.low`：额度改派的阈值。
- `secrets.mode`：`warn` 提醒、`mask` 自动打码、`off` 关。

查密钥（`secrets.mode`）有三处实现：网页（`web/src/core/secrets.js`）、命令行（`plugin/scripts/lib/secrets.mjs`）和原生刘海（`mac/Notch` 里的 `Secrets.swift`），三处跑同一份用例 `tests/fixtures/secrets-cases.json`：每条给原文、应有的类别（按出现顺序、去重）和打码后的文字。类别现在有 npm token、GitHub token、API key、AWS 密钥、Slack token、私钥（`-----BEGIN … PRIVATE KEY-----` 到 `END`，没有结尾就到文末）。打码的占位符写成 `‹类别 已打码›`。

## 第一版重构补充的接口

2026-11-14 开始按新界面重构时定的。上一节没写到、四个模块（应用的本机服务、原生刘海、网页、插件）之间又要用的，都在这里。和上一节冲突的地方以这里为准。

### 写法上的统一

- agent 的 id：`claude`、`codex`、`cursor`、`deepseek`，另有 `you`。原型里的 `dsh` 在接口上一律写 `deepseek`。
- "agent@设备"：比如 `codex@local`、`codex@remote-control:env_…`。规则、额度、默认模型、派活对象都用这种键。设备 id 就是 `lofts.json` 里的 id，本机固定是 `local`。
- 正文只在内存里：等确认时的原文、应用自己派出去的活的原文，都不写进任何文件，应用退出就没了。
- 没有后端的功能，界面上置灰并写一句原因，或者不显示；不能假装成功。

### 第一版真的能做的

| 事情 | 第一版 |
|---|---|
| 指挥 | 本机的 Claude Code，或者你自己 |
| 接活 | 本机和远程电脑上的 Codex：给已有对话发消息、新开对话 |
| 等你的一队 | 只有跨设备发送（`cross`）会排进来。`relay`、`split` 接口留着，等统一的 MCP |
| 添加设备 | 只有"Codex 应用内"：经中继站重读一次远程电脑。SSH、经 magpie 置灰 |
| Cursor、DeepSeek Harness | 检测得到就显示，标"还没接上"，不能选 |

### 设置再新增

```json
{
  "paused":   { "all": false, "lofts": { "remote-control:env_…": true } },
  "devices":  { "names": { "remote-control:env_…": "办公室" }, "hidden": [], "off": { "local": ["cursor"] },
                "models": { "codex@local": { "model": "gpt-6.1-sol", "effort": "medium" } } },
  "dispatch": { "rules": [ { "id": "r1", "when": "生图、改图", "kw": "图 画 icon logo", "to": "codex@local", "fb": "", "ask": false, "on": true } ] }
}
```

- `paused`：全部暂停和每台暂停。暂停时插件不送出：消息记成 `queued` 加 `paused: true`，后台后台进程每 2 秒读一次设置，继续后自己送出。最多排 `post.pauseMaxMin` 分钟（默认 120），到点记成 `refused`、`timeout`；后台进程没了也一样（原文只在它的内存里）。
- `devices.names`：设备的显示名，只改显示。`devices.hidden`：从界面上移除的设备。`devices.off`：每台上关掉的 agent。`devices.models`：Pigeon 派活时默认用的模型和思考强度。
- `devices.customModels`：自己填的模型名，`{ "codex@<主机 id>": ["local/qwen3-coder"] }`。模型列表是从本机 Codex 读的，别的电脑上自定义的模型读不到，可以填在这里；这些模型几档思考强度（`low` 到 `ultra`）都列出来，由对方建对话时校验。
- `dispatch.rules`：分派规则，从上到下第一条命中的算数。`kw` 按空格、顿号、逗号分开，任意一个出现在任务文字里就命中，不分大小写；没写关键词的永远不命中。阈值是 `quota.low`。
- `dispatch.rules[].mode`：`suggest`（默认，只是建议，由指挥判断）或 `must`（照做：用户的话里出现这类活就交给它，除非用户在那句话里明说不要）。两种都只是写进提示的口气不同，Pigeon 不硬拦。
- `dispatch.seeded`：加过默认规则就是 `1`。网页第一次在应用里打开时加四条：生图、改图交给 `codex@local`（`must`；原来的 `codex.preferForImages` 关着时这条也关着）；音频交给 `antigravity@local`；复审、复核交给 `deepseek@local`；简单、要快的小活交给 `deepseek@local`（后三条 `suggest`）。已经有同一类规则的不重复加。加过以后，生图交给谁只看规则，`codex.preferForImages` 不再用。
- 关键词命中时的提醒：插件的 `UserPromptSubmit` hook 读设置里的 `dispatch.rules`，用户这句话命中某条规则的关键词时（最多两条；规则开着、交给的那家在 `dispatch.json` 的 `alive` 里），在这一轮的提示里点名“像是哪类活、交给谁、怎么交”；`must` 写“请交给”，`suggest` 写“建议交给，由你判断”。只在指挥是 Claude Code、`dispatch.seeded` 了的时候。整段“派活建议”照旧来自 `dispatch.json` 的 `text`。
- 配色、明暗、场景、连线样式、实验样式这些纯外观的设置只记在浏览器里，不进设置文件。

### 对话：`GET /api/lofts` 现在带状态

应用把 `lofts.json` 读出来，再叠上从 hook 里算出的状态后返回；`lofts.json` 文件本身不变。每个对话多这些字段，没有就不带：

| 字段 | 说明 |
|---|---|
| `state` | `run`、`wait`、`idle`、`done`、`error`。`done` 是这一轮结束后 10 分钟内，之后回到 `idle`。没收到过 hook 的是 `idle` |
| `activity` | 见上一节的表，只在 `run`、`wait` 时有 |
| `detail` | 在做什么的一句话（工具名、命令的前 80 个字） |
| `error` | 出错时的一句话 |
| `model`、`effort` | 这个对话正在用的模型和思考强度，读得到才有 |
| `parent` | 子对话是从哪个对话拆出来的 |

- 本机的 Claude Code 对话也在里面：`agent: "claude"`，`id` 是它的 `session_id`，`title` 是最近一句用户输入的第一行（没有就用目录名）。只收最近 24 小时内有过 hook 的。它的子代理是 `parent` 指向它的子对话，`id` 是 `<session_id>:<tool_use_id>`。
- 一变就经 SSE 推 `{ "type": "lofts", "lofts": { ...和 GET 一样... } }`，最多每 500 毫秒一次。`queue`、`lofts` 这两种推送和别的一样带 `ts`。刚连上 SSE 时不会先推一份，页面加载时各 `GET` 一次。
- `POST /api/lofts/refresh`：跑一次 `pigeon lofts --refresh`（经中继站重读远程，有 token 成本），回 `{ "ok": true }` 或 `{ "ok": false, "error": "…" }`。
- `GET /api/relay`：跑 `pigeon relay list --json`，回 `{ "shared": "对话 id", "byHost": { "主机 id": "对话 id" }, "warnAt": 150000, "relays": [ … ] }`。`relays` 先列在用的，再列用过的，每条是 `{ id, title, missing, archived, updated, model, effort, tokensUsed, context, window, approval, source, shared, hosts }`：`model`、`effort`、`tokensUsed` 来自 Codex 的对话数据库；`context` 是上一轮读进去的 token 数、`window` 是模型的上下文窗口，从对话记录最后一次 `token_count` 读（Codex 把闲着的记录压成 `.jsonl.zst` 后也读得到），读不到是 `null`；`shared` 是不是共用的那条，`hosts` 是单独用它的主机。`context` 超过 `warnAt` 时界面提醒换一条。
- `POST /api/relay`：请求体 `{ "action": "use" | "archive" | "unarchive" | "delete", "id": "对话 id", "host": "主机 id" }`，跑对应的 `pigeon relay …`。`use` 不带 `host` 换共用的，带 `host` 只给那台换；`id` 为空、带 `host` 表示那台不再单独用。`archive`、`unarchive`、`delete` 只处理 `post.relayUsed` 里的、现在没在用的对话，调 `codex archive|unarchive|delete <id>`；`delete` 是永久删除，界面上要点两次。成功回 `200` 和命令行的 JSON；用法错误 `400`；还在用、Codex 命令失败 `409`，正文 `{ "ok": false, "error": "…" }`。
- 中继站的模型和思考强度改不了：`codex queue` 只能往已有对话里排消息，Pigeon 自己用 `codex app-server` 新建的对话又拿不到 `codex_app` 的工具（2026-11-24 用 codex-cli 0.171 试过），所以中继站对话要在 Codex 应用里建、在 Codex 应用里换模型。

### 等你的一队：补充

- `POST /api/ask` 的请求体：

```json
{ "kind": "cross", "band": "b-…", "from": {…}, "to": {…}, "preview": "最多 80 字", "text": "原文，最多 4000 字",
  "chars": 1234, "files": [], "project": "", "rule": "r3", "secrets": ["npm token"], "timeoutSec": 90 }
```

- 连接一直挂着，直到有结果，回 `{ "action": "release" | "release_masked" | "block" | "timeout" }`。`timeout` 是到点没人理。同一个 `band` 再问一次，接着等原来那条。
- 队列里的每一条比上一节多 `text`、`chars`、`files`、`project`，都只在内存里。
- 暂停时点放行：照样回 `release`，由插件按 `paused` 把消息排着。
- 应用退出、连接断了、回的不是 `200` 或看不懂，插件都当成"弹不出来"，退回系统对话框。所以想拦下时要回 `200` 和 `block`，不能回 404 或 5xx。
- 请求体里的 `to` 还带 `loft_name` 和 `title`，给界面显示用。
- 应用自己派的活（`POST /api/send`）去问时多带一个 `send_id`（应用经环境变量 `PIGEON_SEND_ID` 给命令行的），应用靠它认出是哪一次派活。
- `POST /api/queue/<id>` 回 `{ "ok": true, "action": "…" }`；没有这一条回 `404`，`action` 不对回 `400`。队列里的 id 是 `q1`、`q2`…，应用每次启动从 1 重新数。
- `post.crossTimeoutSec` 界面上最多让填到 100：Claude Code 跑命令默认 120 秒超时，再长命令会先被杀掉（这时消息记成 `refused`、`timeout`）。

### 全部暂停

| 请求 | 说明 |
|---|---|
| `POST /api/pause` | 请求体 `{ "on": true }`（全部）或 `{ "loft": "<id>", "on": true }`（一台）。改 `settings.paused`，广播 `settings`。回 `{ "ok": true, "paused": { "all": …, "lofts": {…} } }`，`paused` 是存下之后的样子 |

### 应用自己派活（指挥是你）

| 请求 | 说明 |
|---|---|
| `POST /api/send` | 请求体见下。应用用自带的 `pigeon.mjs` 去发，发件人是 `you`。回 `{ "ok": true, "band": "b-…" }` 或 `{ "ok": false, "error": "…" }`；不支持的对象回 `501`。重发时请求体只要带 `retry_of`（原来那条的编号），其余字段（对象、正文、模型……）由应用按内存里留着的原文补上；请求里另外写了的字段优先 |
| `POST /api/open` | 请求体 `{ "loft": "…", "agent": "…", "session": "…" }`，跳回那个对话所在的应用。回 `{ "ok": true }` 或 `{ "ok": false, "error": "…" }` |

```json
{ "to": { "loft": "local", "agent": "codex", "session": "" }, "text": "…", "title": "", "project": "",
  "model": "", "effort": "", "why": { "kind": "lead", "reason": "…" }, "retry_of": "" }
```

- `to.session` 为空是新开对话。跨设备的照样经 `/api/ask` 排进等你的一队：这时不等你点完，一排进去就回 `{ "ok": true, "band": "b-…", "state": "asking" }`，之后看消息的状态。
- 命令跑起来了就回 `200`，发没发出看 `ok`；请求体不对、消息是空的、找不到要重发的原文回 `400`；找不到 `node` 或脚本回 `500`。
- 新开对话指定的 `model`、`effort` 本机和别的电脑上都生效：别的电脑上由中继站写进 `create_thread` 的 `model` 和 `thinking`。能选哪些由对方主机决定，不支持的组合在建对话时被拒；`effort` 不是 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`、`ultra` 之一时插件直接拒（退出码 64，不建消息）。给已有对话发不带这两个字段：已有对话换不了模型，`send` 带了会被拒。
- 应用把自己发出去的原文留在内存里，`GET /api/notes` 里这些消息多一个 `retryable: true`，界面上才给"重发"：再调一次 `/api/send`，带 `retry_of`。agent 发的消息没有原文，不能重发。
- 应用这样调：`node <脚本目录>/pigeon.mjs send --to=<对话 id>@<设备 id> --stdin --json`，新开对话是 `new --loft=<设备 id> --title=<标题> [--project=<项目>] [--model=…] [--effort=…] --stdin --json`；环境变量里不带 `CLAUDE_CODE_SESSION_ID`，所以发件人是 `you`。值一律写成 `--名字=值`：标题取自消息的第一行，可能以 `-` 开头，分开写会被命令行当成另一个参数。
- 应用自带的脚本在 `Pigeon.app/Contents/Resources/plugin/scripts/`；开发时用仓库里的 `plugin/scripts/`；`PIGEON_PLUGIN_ROOT` 可以指到别处。

### 命令行新增的参数

| 参数 | 说明 |
|---|---|
| `pigeon send/new/run --reason "<一句理由>"` | 指挥为什么交给它，写进消息的 `why.reason` |
| `pigeon send/new --retry-of <编号>` | 重发，写进 `retry_of` |
| `pigeon new --model <模型> --effort <思考强度>` | 新开对话时指定，本机和远程都生效，写进消息的 `model`、`effort`。`send` 不接受这两个参数（退出码 64） |
| `pigeon fetch <编号> [--wait-min 分钟]` | 经中继站送到了、但没等到回信（`lost`）的远程消息：请中继站再等一次、再读一次对方最新一轮。只读，不给对方发东西，所以不问放不放行；取到后改成 `home`。没有 `--json` |
| `pigeon send/new --ctx-files a,b --ctx-tokens 1200` | 交出去的上下文，写进 `ctx`；不给 `--ctx-tokens` 时按原文长度估 |
| `pigeon send/new --stdin` | 正文从标准输入读，不出现在命令行里。应用派活时用 |
| `pigeon send/new --json` | 只往标准输出写一行 JSON：`{ "ok": true, "band": "b-…", "state": "flying" }` 或 `{ "ok": false, "band": "b-…", "state": "refused", "reason": "blocked", "error": "…" }`。暂停中排着的是 `ok: true`、`state: "queued"`、`paused: true` |

### DeepSeek Harness 和 Antigravity

2026-11-24 加上。都只在这台 Mac 上，不经中继站、不问放行，由后台看护进程跑。回信拿到后存一份在 `~/.pigeon/answers/<编号>.md`（只有自己能读；它们的对话记录不像 Codex 那样好按编号找），任务记录里照旧不存正文。线上的 agent 名字是 `deepseek` 和 `antigravity`。

- **DeepSeek Harness（DSH）**：用它自带的命令行 `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`（测试时 `PIGEON_DSH_BIN`）。新开对话跑 `dsh headless --json -`（正文从标准输入给），接着已有对话加 `--session-id <id>`；`--sandbox read-only|workspace-write` 传成 `--permission-mode`，不写用它自己的默认（能改工作目录）。模型用它自己配的。事件 `session` 给出对话 id，`final` 是回复。对话存在 `$DSH_HOME/sessions/<目录>/<id>/session.v4.jsonl.zstd`（默认 `~/.dsh`，几段 zstd 接在一起），插件从这里列出最近的对话和标题。
- **Antigravity**：新开对话 `agentapi new-conversation --model=<模型 id> --title=<标题> <正文>`，接着说 `agentapi send-message <对话 id> <正文>`（`~/.gemini/antigravity/bin/agentapi`，测试时 `PIGEON_AGY_AGENTAPI`）。`agentapi` 要环境变量 `ANTIGRAVITY_LS_ADDRESS`、`ANTIGRAVITY_CSRF_TOKEN`，插件从 `~/.gemini/antigravity/daemon/hub_*.json`（测试时 `PIGEON_AGY_HOME`）读它本机服务的端口和令牌，进程不在了就算没开。状态和回复读它本机服务的 `GetAllCascadeTrajectories`、`GetCascadeTrajectorySteps`（令牌经 curl 的标准输入给）：不在跑了、发出之后有了 `PLANNER_RESPONSE`，就是回信。**这是它自己界面用的内部接口，不是公开的，Antigravity 升级可能会变。** 新开的对话不绑目录，要看的文件得写完整路径。它读工作区外的文件时会停下来等用户批准（那一步 `status` 是 `WAITING`、带 `requestedInteraction`）：插件把“在等你批准：…”写进任务的 `error`，对话在 `lofts` 里标 `state: "wait"`，Pigeon 不替你点。
- **Antigravity 的模型**：`pigeon models antigravity [--json]` 读它本机服务的 `GetAvailableModels`，按它推荐的顺序列出来：同一系列的几档思考强度并成一个（`{ id: "gemini-4-neon", name, efforts: ["low","medium","high","xhigh"], tag }`），Orchestrator、GPT-OSS 这类不分档的单列；`default` 是它自己的默认（`defaultAgentModelId`，比如 `gemini-4-neon-high`，拆成 `{ model, effort }`）。读到就存一份在 `~/.pigeon/models/antigravity.json`，Antigravity 没开时用这份。新开对话时系列 + 思考强度拼成它认的 id（`gemini-4-neon` + `high` → `gemini-4-neon-high`），这个系列没有的强度直接拒（退出码 64）。模型的选法：命令里的 `--model`/`--effort` > 接入页的“默认模型”（`devices.models["antigravity@local"]`）> 它自己的默认。老的 `flash_lite`、`flash`、`pro` 档位照样认，但 `flash_lite` 落到很旧的 gemini-3.5-flash-lite，不要用。
- `GET /api/agents/models`：应用跑 `pigeon models --json`，回 `{ "antigravity": { "updated", "live", "default": { "model", "effort" }, "models": [ … ] } }`。网页打开时读一次；刘海的派活面板直接读 `~/.pigeon/models/antigravity.json`。
- **命令行**：`pigeon new --agent dsh|antigravity [--cwd <目录>] [--model …] [--effort …] [--sandbox …] --title … "<话>"`；`pigeon send --to <对话 id 或标题>` 认得出是它们的对话。`--agent` 认 `codex`、`dsh`、`deepseek`、`antigravity`、`agy`。
- **对话列表**：`lofts.json` 本机那台的 `sessions` 里加上它们最近的对话（`agent` 是 `deepseek` 或 `antigravity`）；有消息正在等它回的标 `state: "run"`。
- **设置**：`agents.deepseek` 和 `agents.antigravity`，接入页那一行的“设置”里改。`sandbox`（只 DSH：`read-only`、`workspace-write`，空串是它自己的默认）是没在命令里写 `--sandbox` 时用的权限；`cwd`（只 DSH）是在 Pigeon 应用里派活、没说目录时的工作目录，空串是主目录（Claude Code 派的活用它当前的目录，带 `PIGEON_SEND_ID` 环境变量的才算应用派的）；`timeoutMin` 是等多久没完成就记成没回音，0 是跟着 `post.waitTimeoutMin`。Antigravity 新开对话没写 `--model` 时，用 `devices.models["antigravity@local"].model`（接入页的“默认模型”）。
- **应用派活**：`POST /api/send` 的 `to.agent` 现在可以是 `deepseek` 或 `antigravity`（只能 `loft: "local"`），应用跑 `pigeon new --agent …` 或 `pigeon send`。`POST /api/open` 对它们是打开那个应用。

### 分派规则的建议

规则怎么判只有两处实现：网页（`web/src/core/route.js`，带逐条的过程，给试算用）和应用（给插件和原生刘海用）。两边跑同一份用例 `tests/fixtures/dispatch-cases.json`。

| 请求 | 说明 |
|---|---|
| `PUT /api/dispatch` | 网页在规则、额度、设备变了时发：`{ "text": "写进指挥提示里的原文，指挥是你时为空串", "low": 20, "quota": { "codex@local": 16 }, "alive": ["codex@local", "…"] }`。应用记在内存里，并写到 `~/.pigeon/dispatch.json`（加 `updated`、`lead`） |
| `POST /api/dispatch/suggest` | 请求体 `{ "text": "任务文字", "to": "codex@local" }`（`to` 可以不给）。回 `{ "rule": "r3", "suggested": "codex@local", "fb": false, "ask": true, "kind": "rule" }`；没有规则命中时 `rule`、`suggested` 是空串。给了 `to` 才有 `kind`：`rule`、`quota`、`override`、`lead` |

- 判法：从上到下，跳过关着的、没命中的、交给的那家不在 `alive` 里的；命中的那条如果 `quota[to] < low` 并且 `fb` 在 `alive` 里，就改派给 `fb`（`fb: true`）。规则读设置里的 `dispatch.rules`；还没收到过 `PUT /api/dispatch` 时 `alive` 当作不限、`quota` 当作没有。
- `ask`：规则写了问，或者 `suggested` 不在本机并且 `post.confirmRemote` 没关。
- 插件的 `prompt-hint.mjs` 在指挥是 Claude Code 时，每一轮把 `~/.pigeon/dispatch.json` 里的 `text` 写进提示。文件读不到就不写。
- 插件发消息时调 `/api/dispatch/suggest` 拿 `kind` 填 `why.kind`；应用没开就填 `lead`。

### magpie

应用代读本机 magpie（网页不能直接读它）。只读，不带钥匙，不改 magpie 的任何东西。端口读 `MAGPIE_PORT`，没有就读 `~/.config/magpie/settings.json` 的 `port`，再没有用 3425。连不上一律回 `502` 和 `{ "error": "…" }`。

| 请求 | 转到 | 说明 |
|---|---|---|
| `GET /api/magpie/hello` | `/api/hello` | 只留 `name`、`version` |
| `GET /api/magpie/quotas` | `/v1/magpie/quotas?kept=1` | `{ "data": [卡…] }`。只留白名单里的字段，字符串里的邮箱换成 `‹账号›`。字段和 `tools/serve.py` 转出来的一样 |
| `GET /api/magpie/models` | `/v1/models` | `{ "data": [ { "id", "context_window", "reasoning_levels" } ] }` |

### 让原生刘海打开

| 请求 | 说明 |
|---|---|
| `POST /api/notch` | 请求体 `{ "state": "idle" \| "overview" \| "queue" \| "reply" \| "compose", "target": "codex@local", "session": "", "band": "", "demo": false }`。网页上的"派活""给它发消息"、设置里的演示按钮都调它。`demo: true` 时刘海用内置的示例内容演示这个状态，不动真数据。`state` 不对回 `400`；否则回 `{ "ok": true }`（先回，再让刘海动） |

### 检测

`GET /api/detect` 多一家 `deepseek`，结构不变。

### 谁能调本机服务

本机服务只监听 `127.0.0.1`，但浏览器里别的网站的页面也能往这个地址发请求。所以除了原来查 `Host`，现在还查 `Origin`：

- 请求带了 `Origin`，并且不是 `http://127.0.0.1:<端口>`、`http://localhost:<端口>`、`http://[::1]:<端口>` 之一，一律回 `403`，所有接口都一样（包括 `/ev` 和 `/events`）。
- 不带 `Origin` 的照常：命令行、插件的 hook 脚本（curl）、应用自己窗口里同源的读请求。
- 不再回 `Access-Control-Allow-Origin`。以前给 `file://` 打开的页面开过 `*`，现在页面只从本服务加载，用不着了。

不这样的话，你开着的任何一个网页都能读到等你确认的原文、替你点放行、以你的名义派活、改设置。

### 只起本机服务

环境变量 `PIGEON_HEADLESS=1` 时应用只起本机服务，不开窗口、菜单栏和刘海。给自动测试用：`node --test tests/e2e` 用它把应用和命令行串起来跑（要先 `cd mac && swift build`）。

### 给自动检查存图

环境变量 `PIGEON_SNAPSHOT_DIR=<目录>` 时，应用启动后（等 `PIGEON_SNAPSHOT_DELAY` 秒，没设时 5 秒）把主窗口的四页和刘海的五种状态各存一张 PNG 到这个目录，然后退出。图是应用自己的窗口画出来的（`mac/Sources/Pigeon/App.swift`），用来在没人操作时看界面画得对不对。它和 `PIGEON_HEADLESS` 不是一回事：存图需要真的开窗口。
