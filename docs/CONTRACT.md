# 接口约定

Mac 应用（`mac/`）和前端（`web/`）之间只靠下面这几条接口沟通。两边各自改实现都没关系，只要接口不变。

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

消息格式：

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

设置由应用保存在 `~/Library/Application Support/Meerkat/settings.json`。插件里的包装层和页面都通过接口读写，应用没开时包装层用内置默认值。

| 请求 | 说明 |
|---|---|
| `GET /api/settings` | 返回完整设置。文件不存在时返回 `{}`（默认值由读取方补齐）。 |
| `PUT /api/settings` | 请求体是完整设置 JSON 对象，原样保存（写临时文件再改名），回 `200` 和保存后的内容，并通过 `/events` 广播 `{"type":"settings","settings":{...}}`。非对象回 `400`。 |
| `GET /api/codex/models` | 读 `~/.codex/models_cache.json`，返回 `[{"slug","name","efforts":[...]}]`；读不到返回 `[]`。 |

设置结构（`notify` 是系统通知，由应用读取；`codex` 给包装层用，以后加其他 agent）：

```json
{
  "version": 1,
  "notify": { "done": true, "failed": true, "waiting": true, "turnEnd": true, "turnMinSec": 60 },
  "scene": {
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
  }
}
```

## 包装层上报的 Codex 事件

包装层 `meerkat-codex` 把 Codex 的执行过程也发到 `POST /ev`，`hook_event_name` 固定为 `MeerkatCodex`：

```json
{ "hook_event_name": "MeerkatCodex", "phase": "start",    "task_id": "mk-…", "title": "…", "kind": "image", "prompt": "…", "cwd": "…", "model": "gpt-6.1-sol" }
{ "hook_event_name": "MeerkatCodex", "phase": "thread",   "task_id": "mk-…", "thread_id": "…" }
{ "hook_event_name": "MeerkatCodex", "phase": "activity", "task_id": "mk-…", "activity": "run", "detail": "npm test" }
{ "hook_event_name": "MeerkatCodex", "phase": "end",      "task_id": "mk-…", "status": "done", "summary": "…", "files": ["…"], "thread_id": "…", "usage": {…} }
```

## Codex 自己的 hook

Codex 原生 hook 也通过 `POST /ev` 和 SSE `hook` 发送，`payload.source` 固定为 `"codex"`。字段包括 `hook_event_name`（`SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `PermissionRequest` / `Stop` / `SubagentStart` / `SubagentStop`）、`session_id`、`turn_id`、`cwd`、`model`、`tool_name`、`tool_input`、`tool_response`、`prompt`、`last_assistant_message`、`meerkat_task_id`。最后一个字段仅包装层派活时有值，否则为空串。

`store.ingest` 先按 `source` 分流：Codex 事件不进入 Claude 的活动、等待清理和一轮结束逻辑。`SessionStart` 记录会话目录，`SubagentStart` / `SubagentStop` 暂不创建额外任务。`meerkat_task_id` 对上现有 Codex 任务时，工具事件更新该任务的 `activity`、`realActivity` 和去掉 shell 外壳并截短的 `detail`，发出 `taskActivity`；包装层任务仍由 `MeerkatCodex` 的 `end` 收尾。

应用内的 `UserPromptSubmit` 创建 `id = codex:<session_id>:<turn_id 或时间戳>`、`kind = codex`、`via = codex-app` 的任务，标题用 prompt 第一行，记录模型。工具事件更新活动；`Stop` 完成这一轮，摘要取 `last_assistant_message`。没有 `turn_id` 的后续事件关联同会话最近的进行中任务。

`PermissionRequest` 产生 `{agent:"codex", session, cwd, kind:"permission", message:"Codex 要用 <tool_name>", since}` 等待项，内部 key 为 `codex:<session_id>`；同会话后续的 Pre/PostToolUse 或 Stop 解除等待。Claude 的等待项带 `agent:"claude"`，继续沿用自己的会话 key。

所有任务都有 `model` 字段（未知为空串）；Claude 子代理取 `tool_input.model`，包装层取 start 的 `model`。`store.byAgent()` 返回 `{claude:[], codex:[], subagent:[]}`，按现有任务列表顺序分组，包含历史任务；画面可按 `status === "running"` 再取当前任务。当前任务列表不创建 Claude 主对话任务，所以 `claude` 通常为空。

## Codex hook 开关

| 请求 | 说明 |
|---|---|
| `GET /api/codex/hooks` | 返回 `{installed, working, detail}`。`installed` 表示已安装，`working` 表示已收到事件，`detail` 是给人看的中文状态。 |
| `POST /api/codex/hooks` | 请求体 `{"enable":true}` 或 `{"enable":false}`，立刻安装或停用，返回更新后的同结构状态。会修改本机 Codex 配置。 |

设置面板每次打开都 GET 状态，开关反映 `installed`，显示 `detail`。切换立即 POST，失败回拨并显示错误；不进入 `settings.json`，也不等“保存”。

## 场景设置的前端接口

`scene` 与 `codex`、`notify` 平级。默认 `seats = 3`（仅支持 2 / 3 / 4）、`showSubLabels = true`、`hoverCards = true`。`scene.layout` 由画面拖拽维护，面板保存时原样保留；保存完整设置同时保留其他顶层键及未知场景字段。

- `M.settings.scene()`：返回带默认值的当前场景设置。
- `M.settings.saveScene(patch)`：把 patch 浅合并到 scene，串行 PUT 完整设置，返回 Promise；尚未加载时先 GET，失败 reject。画面拖完可传 `{layout:{main:"claude",seats:["codex","cursor","deepseek"]}}`，调用方处理保存失败。
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

`js/usage.js` 加载时调用 `M.Usage.start()` GET 一次（并发调用复用请求）；`M.Usage.open()` 打开对话框并刷新。`apply(summary)` 接收 SSE 摘要，`get()` 返回最新数据（初始为 null），`on(fn)` 订阅后续摘要并返回取消订阅函数，`format(n)` 将 token 数转成 `1.2 万`、`3.4 亿` 等中文单位。GET 失败时对话框显示“没连上 Meerkat 应用”，重新打开会重试。

main.js 接入点：SSE 分支调用 `M.Usage?.apply(m.usage)`；顶栏按钮调用 `M.Usage.open()`。为覆盖首次连接之前的 usage 推送，页面初始化时可在 `DOMContentLoaded` 后再调用一次 `M.Usage.start()`（脚本位于 main.js 之后）。初次连上应用时 GET `/api/settings` 后交给 `M.settings.applyRemote`，并提前设置 `M.settings.onScene`；SSE 断连时调用 `M.settings.setLive(false)`。等待提示按 `item.agent` 区分 Claude 和 Codex。
