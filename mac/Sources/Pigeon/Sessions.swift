import Foundation

/// 从 hook 里判断一个工具调用大概在做什么，给形象挑动作。纯函数，方便测试。
enum Activity {
    static let reading: Set<String> = ["read", "grep", "glob", "ls", "webfetch", "websearch", "notebookread", "view", "search"]
    static let typing: Set<String> = ["edit", "write", "multiedit", "notebookedit", "apply_patch", "applypatch", "str_replace_editor"]
    static let shells: Set<String> = ["bash", "shell", "exec", "exec_command", "local_shell", "shell_command", "run_terminal_cmd"]

    /// `thinking`、`reading`、`typing`、`building`、`testing`、`delegating` 之一
    static func classify(tool: String, input: [String: Any]) -> String {
        let name = tool.lowercased()
        if name == "agent" || name == "task" || name.hasPrefix("mcp__codex") { return "delegating" }
        if reading.contains(name) { return "reading" }
        if typing.contains(name) { return "typing" }
        if shells.contains(name) {
            let cmd = command(of: input)
            if isDelegation(cmd) { return "delegating" }
            if matches(cmd, testPattern) { return "testing" }
            if matches(cmd, buildPattern) { return "building" }
        }
        return "thinking"
    }

    /// 在做什么的一句话：Bash 取命令的前 80 个字，其他取工具名
    static func detail(tool: String, input: [String: Any]) -> String {
        if shells.contains(tool.lowercased()) {
            let cmd = command(of: input).replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
            if !cmd.isEmpty { return String(cmd.prefix(80)) }
        }
        return tool
    }

    static func command(of input: [String: Any]) -> String {
        if let s = input["command"] as? String { return s }
        if let a = input["command"] as? [Any] { return a.compactMap { $0 as? String }.joined(separator: " ") }
        if let s = input["cmd"] as? String { return s }
        return ""
    }

    private static let testPattern = #"\b(tests?|pytest|jest|vitest|xctest|mocha|rspec|unittest)\b"#
    private static let buildPattern = #"\b(build|make|cmake|cargo|xcodebuild|gradle|gradlew|mvn|tsc|webpack|compile|bazel)\b"#
    private static let delegationPattern = #"(^|[\s;&|(])codex(\s|$)|pigeon(\.mjs)?\s+(send|new|run)\b"#

    private static func isDelegation(_ cmd: String) -> Bool { matches(cmd, delegationPattern) }

    private static func matches(_ text: String, _ pattern: String) -> Bool {
        text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
}

/// 从 hook 里算出每个对话（和子代理）的状态，给 `GET /api/lofts` 叠上去。只在 hub.queue 上使用。
struct SessionTracker {
    struct Entry: Equatable {
        var agent: String
        var id: String
        var parent: String?
        var cwd = ""
        var title = ""
        /// `run`、`wait`、`idle`、`done`、`error`
        var state = "idle"
        var activity = ""
        var detail = ""
        var error = ""
        var model = ""
        var effort = ""
        var started: Date
        var lastHook: Date
        var endedAt: Date?
        var agentID = ""

        /// 对外可见的内容有没有变（不看 lastHook）
        func sameVisible(as other: Entry) -> Bool {
            var copy = self
            copy.lastHook = other.lastHook
            return copy == other
        }
    }

    /// 一轮结束后算 `done` 的时间
    static let doneWindow: TimeInterval = 10 * 60
    /// 只收最近 24 小时内有过 hook 的
    static let keepWindow: TimeInterval = 24 * 3600
    static let runStale: TimeInterval = 2 * 3600
    static let waitStale: TimeInterval = 6 * 3600

    private(set) var entries: [String: Entry] = [:]
    /// "<session>|<agent_id>" → 子代理条目的 key
    private var agentMap: [String: String] = [:]

    func entry(agent: String, id: String) -> Entry? { entries["\(agent):\(id)"] }

    /// 处理一条 hook 原文，返回对外可见的内容有没有变。
    @discardableResult
    mutating func ingest(_ p: [String: Any], now: Date = Date()) -> Bool {
        let event = p["hook_event_name"] as? String ?? ""
        if event == "PigeonNote" || event == "PigeonRun" { return false }
        guard let sid = p["session_id"] as? String, !sid.isEmpty else { return false }
        let agent = (p["source"] as? String) == "codex" ? "codex" : "claude"
        let key = "\(agent):\(sid)"
        let before = entries[key]
        var e = before ?? Entry(agent: agent, id: sid, started: now, lastHook: now)
        var childChanged = false

        if let cwd = p["cwd"] as? String, !cwd.isEmpty { e.cwd = cwd }
        if let m = p["model"] as? String, !m.isEmpty { e.model = m }
        if let f = (p["effort"] as? String) ?? (p["reasoning_effort"] as? String), !f.isEmpty { e.effort = f }
        let fromMain = p["agent_id"] == nil
        let input = p["tool_input"] as? [String: Any] ?? [:]
        let tool = p["tool_name"] as? String ?? ""
        let toolUse = p["tool_use_id"] as? String ?? ""

        switch event {
        case "SessionEnd":
            e.state = "idle"; e.activity = ""; e.detail = ""
        case "UserPromptSubmit":
            guard fromMain else { break }
            e.state = "run"; e.activity = "thinking"; e.detail = ""; e.error = ""; e.endedAt = nil
            if let t = Self.title(p["prompt"]) { e.title = t }
        case "Notification":
            let message = p["message"] as? String ?? ""
            guard let kind = Watch.waitKind(p["notification_type"] as? String, message) else {
                if (p["notification_type"] as? String)?.hasPrefix("elicitation_") == true, e.state == "wait" {
                    e.state = "run"; e.activity = "thinking"; e.detail = ""
                }
                break
            }
            // 说完了之后的空闲提醒不改状态，让 done 保持到时间
            if kind == .idle { break }
            e.state = "wait"; e.activity = "waiting"; e.detail = String(message.prefix(80)); e.endedAt = nil
        case "PermissionRequest":
            e.state = "wait"; e.activity = "waiting"; e.endedAt = nil
            e.detail = tool.isEmpty ? "等你批准" : "要用 \(tool)"
        case "Stop":
            guard fromMain else { break }
            e.state = "done"; e.activity = ""; e.detail = ""; e.endedAt = now
        case "StopFailure":
            e.state = "error"; e.activity = ""; e.detail = ""; e.endedAt = now
            e.error = Self.failureText(p)
        case "PreToolUse":
            if fromMain {
                e.state = "run"; e.error = ""; e.endedAt = nil
                e.activity = Activity.classify(tool: tool, input: input)
                e.detail = Activity.detail(tool: tool, input: input)
                if (tool == "Agent" || tool == "Task"), !toolUse.isEmpty {
                    let desc = (input["description"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                        ?? (input["subagent_type"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "子代理任务"
                    var c = Entry(agent: "claude", id: "\(sid):\(toolUse)", started: now, lastHook: now)
                    c.parent = sid; c.cwd = e.cwd; c.title = String(desc.prefix(60))
                    c.state = "run"; c.activity = "thinking"
                    c.model = input["model"] as? String ?? ""
                    entries["claude:\(c.id)"] = c
                    e.detail = String(desc.prefix(80))
                    childChanged = true
                }
            } else if let ck = childKey(sid, p["agent_id"]), var c = entries[ck] {
                c.state = "run"; c.lastHook = now
                c.activity = Activity.classify(tool: tool, input: input)
                c.detail = Activity.detail(tool: tool, input: input)
                entries[ck] = c
                childChanged = true
            }
        case "PostToolUse", "PostToolUseFailure":
            if fromMain {
                if e.state == "wait" { e.state = "run" }
                let ck = "claude:\(sid):\(toolUse)"
                if tool == "Agent" || tool == "Task", var c = entries[ck] {
                    let resp = p["tool_response"] as? [String: Any]
                    if event == "PostToolUse", resp?["isAsync"] as? Bool == true || resp?["status"] as? String == "async_launched" {
                        // 后台子代理：等 SubagentStop 再算结束
                        if let aid = resp?["agentId"] as? String, !aid.isEmpty {
                            c.agentID = aid
                            agentMap["\(sid)|\(aid)"] = ck
                        }
                    } else {
                        c.state = event == "PostToolUse" ? "done" : "error"
                        if c.state == "error" { c.error = "子代理没有完成" }
                        c.activity = ""; c.detail = ""; c.endedAt = now
                    }
                    c.lastHook = now
                    entries[ck] = c
                    childChanged = true
                }
                if e.state == "run" { e.activity = "thinking"; e.detail = "" }
            } else if let ck = childKey(sid, p["agent_id"]), var c = entries[ck], c.state == "run" {
                c.activity = "thinking"; c.detail = ""; c.lastHook = now
                entries[ck] = c
                childChanged = true
            }
        case "SubagentStop":
            if let aid = p["agent_id"] as? String, let ck = agentMap["\(sid)|\(aid)"] ?? childKey(sid, aid), var c = entries[ck] {
                c.state = "done"; c.activity = ""; c.detail = ""; c.endedAt = now; c.lastHook = now
                entries[ck] = c
                childChanged = true
            }
        default:
            break
        }

        e.lastHook = now
        entries[key] = e
        guard let before else { return true }
        return childChanged || !before.sameVisible(as: e)
    }

    /// 子代理自己的工具事件只带 agent_id：第一次出现时认给这个会话里最早开的、还没认领的子代理
    private mutating func childKey(_ sid: String, _ rawAgent: Any?) -> String? {
        guard let aid = rawAgent as? String, !aid.isEmpty else { return nil }
        let mk = "\(sid)|\(aid)"
        if let k = agentMap[mk], entries[k] != nil { return k }
        let claimed = Set(agentMap.values)
        let candidate = entries.filter { $0.value.parent == sid && $0.value.state == "run" && !claimed.contains($0.key) }
            .min { $0.value.started < $1.value.started }
        guard let candidate else { return nil }
        agentMap[mk] = candidate.key
        return candidate.key
    }

    /// 定时清理超过 24 小时没有 hook 的。返回有没有删东西。
    mutating func prune(now: Date = Date()) -> Bool {
        let before = entries.count
        entries = entries.filter { now.timeIntervalSince($0.value.lastHook) < Self.keepWindow }
        agentMap = agentMap.filter { entries[$0.value] != nil }
        return before != entries.count
    }

    /// 在 (from, to] 之间有没有哪个对话因为时间到了而变状态（done 回到 idle、太久没动静的 run 回到 idle）
    func hasTransition(from: Date, to: Date) -> Bool {
        for e in entries.values {
            var times: [Date] = [e.lastHook.addingTimeInterval(Self.keepWindow)]
            switch e.state {
            case "done", "error": times.append((e.endedAt ?? e.lastHook).addingTimeInterval(Self.doneWindow))
            case "run": times.append(e.lastHook.addingTimeInterval(Self.runStale))
            case "wait": times.append(e.lastHook.addingTimeInterval(Self.waitStale))
            default: break
            }
            if times.contains(where: { $0 > from && $0 <= to }) { return true }
        }
        return false
    }

    /// 到现在这一刻实际显示的状态
    func effectiveState(_ e: Entry, now: Date) -> String {
        switch e.state {
        case "done": return now.timeIntervalSince(e.endedAt ?? e.lastHook) > Self.doneWindow ? "idle" : "done"
        case "run": return now.timeIntervalSince(e.lastHook) > Self.runStale ? "idle" : "run"
        case "wait": return now.timeIntervalSince(e.lastHook) > Self.waitStale ? "idle" : "wait"
        default: return e.state
        }
    }

    /// 对话标题取用户这一轮说的第一行。Claude Code 自己发起的一轮（后台任务做完的 <task-notification>、
    /// 斜杠命令的 <command-name>、<local-command-stdout> 之类）不是用户说的话，不拿来当标题，原标题不动
    static func title(_ raw: Any?) -> String? {
        guard let s = raw as? String else { return nil }
        guard let line = s.split(whereSeparator: \.isNewline).map({ $0.trimmingCharacters(in: .whitespaces) }).first(where: { !$0.isEmpty }) else { return nil }
        if line.range(of: #"^<[a-z]+(-[a-z]+)+[ >]"#, options: .regularExpression) != nil { return nil }
        return String(line.prefix(60))
    }

    /// StopFailure 里的错误原因，翻成一句中文
    static func failureText(_ p: [String: Any]) -> String {
        let raw = (p["error"] as? String) ?? (p["error_message"] as? String) ?? (p["message"] as? String) ?? ""
        switch raw {
        case "rate_limit": return "额度用完或被限流了"
        case "authentication_failed": return "登录失效了"
        case "billing_error": return "账号额度或账单有问题"
        case "server_error": return "服务那边出错了"
        case "": return "这一轮没有做完"
        default: return String(raw.prefix(120))
        }
    }
}

/// 把 lofts.json 和 hook 算出的状态合成 `GET /api/lofts` 的内容。
enum LoftsComposer {
    static var defaultLocal: [String: Any] {
        ["id": "local", "name": "这台 Mac", "online": true, "sessions": [Any](), "projects": [Any]()]
    }

    static func compose(file: Data?, tracker: SessionTracker, now: Date = Date()) -> Data {
        var root = file.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }
            ?? ["version": 1, "updated": 0, "lofts": [Any]()]
        var lofts = root["lofts"] as? [[String: Any]] ?? []
        if !lofts.contains(where: { ($0["id"] as? String) == "local" }) { lofts.insert(defaultLocal, at: 0) }

        var claimed = Set<String>()
        var idsInFile = Set<String>()
        for li in lofts.indices {
            let isLocal = (lofts[li]["id"] as? String) == "local"
            var sessions = lofts[li]["sessions"] as? [[String: Any]] ?? []
            for si in sessions.indices {
                var s = sessions[si]
                let id = s["id"] as? String ?? ""
                if isLocal { idsInFile.insert(id) }
                let agent = s["agent"] as? String ?? ""
                let entry = isLocal ? (tracker.entry(agent: agent, id: id) ?? (agent.isEmpty ? tracker.entry(agent: "codex", id: id) : nil)) : nil
                if let entry {
                    claimed.insert("\(entry.agent):\(entry.id)")
                    overlay(&s, entry, tracker: tracker, now: now)
                } else if s["state"] == nil {
                    s["state"] = "idle"
                }
                sessions[si] = s
            }
            if isLocal { sessions += extras(tracker: tracker, claimed: claimed, idsInFile: idsInFile, now: now) }
            lofts[li]["sessions"] = sessions
        }
        root["lofts"] = lofts
        return (try? JSONSerialization.data(withJSONObject: root, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data()
    }

    private static func overlay(_ s: inout [String: Any], _ e: SessionTracker.Entry, tracker: SessionTracker, now: Date) {
        let state = tracker.effectiveState(e, now: now)
        s["state"] = state
        let active = state == "run" || state == "wait"
        set(&s, "activity", active ? (state == "wait" ? "waiting" : e.activity) : "")
        set(&s, "detail", active ? e.detail : "")
        set(&s, "error", state == "error" ? e.error : "")
        if !e.model.isEmpty { s["model"] = e.model }
        if !e.effort.isEmpty { s["effort"] = e.effort }
        if let parent = e.parent { s["parent"] = parent }
        let ms = Int64(e.lastHook.timeIntervalSince1970 * 1000)
        if ms > ((s["updated"] as? NSNumber)?.int64Value ?? 0) { s["updated"] = ms }
    }

    private static func set(_ s: inout [String: Any], _ key: String, _ value: String) {
        if value.isEmpty { s[key] = nil } else { s[key] = value }
    }

    /// lofts.json 里没有的本机 Claude Code 对话（最近 24 小时有 hook 的），以及它们还在的子代理
    private static func extras(tracker: SessionTracker, claimed: Set<String>, idsInFile: Set<String>, now: Date) -> [[String: Any]] {
        let mine = tracker.entries.values.filter { $0.agent == "claude" }
        let parents = mine.filter { $0.parent == nil && now.timeIntervalSince($0.lastHook) < SessionTracker.keepWindow }
            .sorted { $0.lastHook > $1.lastHook }
        func children(of id: String) -> [SessionTracker.Entry] {
            mine.filter { $0.parent == id && visibleChild($0, tracker: tracker, now: now) }.sorted { $0.started < $1.started }
        }
        var out: [[String: Any]] = []
        for p in parents {
            if !idsInFile.contains(p.id) {
                out.append(make(p, tracker: tracker, now: now))
            }
            out += children(of: p.id).map { make($0, tracker: tracker, now: now) }
        }
        return out
    }

    /// 子代理结束超过 10 分钟就不再列出
    private static func visibleChild(_ e: SessionTracker.Entry, tracker: SessionTracker, now: Date) -> Bool {
        let state = tracker.effectiveState(e, now: now)
        if state == "idle" { return false }
        if state == "error" { return now.timeIntervalSince(e.lastHook) < SessionTracker.doneWindow }
        return true
    }

    private static func make(_ e: SessionTracker.Entry, tracker: SessionTracker, now: Date) -> [String: Any] {
        var s: [String: Any] = ["id": e.id, "agent": e.agent, "relay": false, "cwd": e.cwd,
                                "title": e.title.isEmpty ? (Watch.folder(e.cwd).isEmpty ? "Claude Code 对话" : Watch.folder(e.cwd)) : e.title]
        overlay(&s, e, tracker: tracker, now: now)
        return s
    }
}
