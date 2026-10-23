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

hook JSON 里会用到的字段：`hook_event_name`（`PreToolUse` / `PostToolUse` / `SubagentStop`）、`session_id`、`cwd`、`tool_name`、`tool_use_id`、`tool_input`、`tool_response`。

## 推送给页面

| 请求 | 说明 |
|---|---|
| `GET /events` | Server-Sent Events。每条消息是一行 `data: <json>`。连上时先推一条 `detect`。 |

消息格式：

```json
{ "type": "hook",   "ts": 1730000000000, "payload": { ...原始 hook JSON... } }
{ "type": "detect", "ts": 1730000000000, "agents": { ...见下... } }
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
