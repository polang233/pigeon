import Foundation

/// 从 hook 事件里整理出"谁在干活、谁在等你"，并决定要不要发系统通知。
/// 和网页里的 Store 规则一致，但只留菜单栏和通知需要的那一小部分。只在 Hub 的 queue 上调用。
struct Watch {
    struct Running: Sendable {
        var id: String
        var title: String
        var kind: Kind
        var session: String
        var agentID: String?
        var since: Date
    }
    struct Waiting: Sendable {
        var title: String
        var session: String
        var folder: String
        var message: String
        var kind: WaitKind
        var since: Date
    }
    /// 一条消息的一端（发件人或收件人）
    struct Party: Sendable {
        var loft = "local"
        var loftName = ""
        var agent = ""
        var session = ""
        var title = ""

        init() {}
        init(_ raw: Any?) {
            guard let d = raw as? [String: Any] else { return }
            loft = (d["loft"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "local"
            loftName = d["loft_name"] as? String ?? ""
            agent = d["agent"] as? String ?? ""
            session = d["session"] as? String ?? ""
            title = d["title"] as? String ?? ""
        }

        var isRemote: Bool { loft != "local" }

        /// 例如 `Claude`、`Codex「问候」`、`Codex「问候」@CHEN-PC`
        var label: String {
            var s = Self.agentName(agent)
            if !title.isEmpty { s += "「\(title.count > 16 ? String(title.prefix(16)) + "…" : title)」" }
            if isRemote { s += "@" + (loftName.isEmpty ? "远程" : loftName) }
            return s
        }

        /// 不带对话标题的短名字，例如 `Codex@CHEN-PC`
        var name: String {
            Self.agentName(agent) + (isRemote ? "@" + (loftName.isEmpty ? "远程" : loftName) : "")
        }

        var codexURL: URL? {
            guard agent == "codex", !session.isEmpty else { return nil }
            return URL(string: "codex://threads/\(session)")
        }

        static func agentName(_ agent: String) -> String {
            switch agent {
            case "claude": "Claude"
            case "codex": "Codex"
            case "you", "": "你"
            default: agent
            }
        }

        /// 后来的事件可能只补了一部分字段（比如新对话建好后才有 session），空的不覆盖旧值
        mutating func merge(_ other: Party) {
            if other.loft != "local" || loft.isEmpty { loft = other.loft }
            if !other.loftName.isEmpty { loftName = other.loftName }
            if !other.agent.isEmpty { agent = other.agent }
            if !other.session.isEmpty { session = other.session }
            if !other.title.isEmpty { title = other.title }
        }
    }
    /// 还在路上的消息（等你确认、排队、进行中、已送达）
    struct Note: Sendable {
        var band: String
        var state: String
        var from: Party
        var to: Party
        var since: Date
        var updated: Date
        var preview: String

        var stateText: String { Watch.noteStateText(state) }
        /// 点这一行时打开哪里：优先对方的 Codex 对话，其次发件的 Codex 对话
        var url: URL? { to.codexURL ?? from.codexURL }
    }
    enum Kind: Sendable { case subagent, codex }
    enum WaitKind: Sendable { case permission, question, idle, other }

    /// 一封回信（已回信的任务）。只留最近几封，给刘海的“回信到了”用
    struct Reply: Sendable {
        var band: String
        /// 当初发出的一方（回信是回给它的）
        var from: Party
        /// 当初收到的一方（回信是它写的）
        var to: Party
        var preview: String
        var answer: String
        var at: Date
        var took: TimeInterval
    }

    struct Snapshot: Sendable {
        var running: [Running] = []
        var waiting: [Waiting] = []
        var notes: [Note] = []
        var replies: [Reply] = []
    }
    struct Alert: Sendable {
        var title: String
        var body: String
        /// 点通知时打开的地址（比如 Codex 对话）；没有时切到 Claude
        var url: URL? = nil
    }

    private var running: [String: Running] = [:]
    private var waiting: [String: Waiting] = [:]
    private var turnStart: [String: Date] = [:]
    private var lastTurnAlert: [String: Date] = [:]
    private var notes: [String: Note] = [:]
    /// 最近的回信，新的在前
    private var replies: [Reply] = []
    static let keepReplies = 10
    /// 已经收尾的编号，防止乱序到达的旧事件把消息"复活"，也防止重复提醒
    private var endedBands: [String: Date] = [:]

    var snapshot: Snapshot {
        Snapshot(running: running.values.sorted { $0.since < $1.since },
                 waiting: waiting.values.sorted { $0.since < $1.since },
                 notes: notes.values.sorted { $0.since < $1.since },
                 replies: replies)
    }

    /// 处理一条 hook 原文；返回需要发出的通知（可能没有）。
    /// `watching` 为真表示用户正看着 Pigeon 窗口：照样更新状态，但不发通知，也不记作"已提醒过"。
    mutating func ingest(_ p: [String: Any], notify: NotifyPrefs, watching: Bool, now: Date = Date()) -> Alert? {
        let event = p["hook_event_name"] as? String ?? ""
        let session = p["session_id"] as? String ?? ""
        let folder = Self.folder(p["cwd"] as? String)
        if event == "PigeonNote" {
            let alert = note(p, notify: notify, now: now)
            return watching ? nil : alert
        }
        if (p["source"] as? String) == "codex" {
            let alert = codex(p, event: event, session: session, folder: folder, notify: notify, now: now)
            return watching ? nil : alert
        }
        // 子代理里的工具调用也带同一个 session_id，不能拿来判断主对话已经不等你了
        let fromMain = p["agent_id"] == nil
        dropStale(now)

        let alert: Alert?
        switch event {
        case "UserPromptSubmit":
            waiting[session] = nil
            turnStart[session] = now
            lastTurnAlert[session] = nil
            alert = nil
        case "Notification":
            let message = p["message"] as? String ?? ""
            guard let kind = Self.waitKind(p["notification_type"] as? String, message) else {
                // 登录成功、问询结束之类不是在等你；问询结束要把对应的等待清掉
                if (p["notification_type"] as? String)?.hasPrefix("elicitation_") == true { waiting[session] = nil }
                return nil
            }
            waiting[session] = Waiting(title: Self.waitTitle(kind), session: session, folder: folder, message: message, kind: kind, since: now)
            // 刚提醒过"说完了"，紧跟着的空闲提醒就不再重复
            if kind == .idle, lastTurnAlert[session] != nil { return nil }
            alert = notify.waiting ? Alert(title: Self.waitTitle(kind), body: Self.join(folder, Self.waitBody(kind, message))) : nil
        case "Stop":
            waiting[session] = nil
            guard let start = turnStart.removeValue(forKey: session) else { return nil }
            let took = now.timeIntervalSince(start)
            guard notify.turnEnd, took >= Double(notify.turnMinSec) else { return nil }
            alert = Alert(title: "Claude 说完了", body: Self.join(folder, "这一轮用了 \(Self.duration(took))，轮到你了"))
            if !watching { lastTurnAlert[session] = now }
        case "PreToolUse":
            if fromMain { waiting[session] = nil }
            let name = p["tool_name"] as? String ?? ""
            guard let id = p["tool_use_id"] as? String else { return nil }
            let input = p["tool_input"] as? [String: Any] ?? [:]
            if name == "Agent" || name == "Task" {
                let title = (input["description"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "子代理任务"
                running[id] = Running(id: id, title: title, kind: .subagent, session: session, since: now)
            } else if Self.isCodexCall(name, input) {
                running[id] = Running(id: id, title: "Codex 任务", kind: .codex, session: session, since: now)
            }
            alert = nil
        case "PostToolUse", "PostToolUseFailure":
            if fromMain { waiting[session] = nil }
            guard let id = p["tool_use_id"] as? String, var task = running[id] else { return nil }
            let resp = p["tool_response"]
            if event == "PostToolUse", let r = resp as? [String: Any],
               (r["isAsync"] as? Bool) == true || (r["status"] as? String) == "async_launched" {
                task.agentID = r["agentId"] as? String  // 后台子代理：等 SubagentStop 再算结束
                running[id] = task
                return nil
            }
            running[id] = nil
            alert = finished(task, ok: event == "PostToolUse" && !Self.failed(resp), folder: folder, notify: notify)
        case "SubagentStop":
            // 只有后台子代理靠这个收尾；同步子代理已经在 Agent 的 PostToolUse 结束了
            guard let agent = p["agent_id"] as? String,
                  let task = running.values.first(where: { $0.kind == .subagent && $0.agentID == agent }) else { return nil }
            running[task.id] = nil
            alert = finished(task, ok: true, folder: folder, notify: notify)
        case "PigeonRun", "MeerkatCodex":
            guard let id = p["task_id"] as? String else { return nil }
            switch p["phase"] as? String {
            case "start":
                let title = (p["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Codex 任务"
                running[id] = Running(id: id, title: title, kind: .codex, session: session, since: now)
                alert = nil
            case "end":
                guard let task = running.removeValue(forKey: id) else { return nil }
                alert = finished(task, ok: (p["status"] as? String) == "done", folder: folder, notify: notify)
            default:
                alert = nil
            }
        default:
            alert = nil
        }
        return watching ? nil : alert
    }

    /// Codex 自己的 hook 事件（Pigeon 装在 ~/.codex/hooks.json 里的）。
    /// 包装层派的任务带 pigeon_task_id（旧版叫 meerkat_task_id），开始和结束已经由包装层报过，这里只管"等你批准"。
    /// 用户自己在 Codex 里聊的，每一轮算一件 Codex 的活。
    private mutating func codex(_ p: [String: Any], event: String, session: String, folder: String,
                                notify: NotifyPrefs, now: Date) -> Alert? {
        let key = "codex:" + session
        let viaWrapper = !((p["pigeon_task_id"] as? String) ?? "").isEmpty || !((p["meerkat_task_id"] as? String) ?? "").isEmpty
        switch event {
        case "UserPromptSubmit":
            waiting[key] = nil
            guard !viaWrapper else { return nil }
            let prompt = (p["prompt"] as? String ?? "").split(separator: "\n").first.map(String.init) ?? ""
            let title = prompt.isEmpty ? "Codex 对话" : String(prompt.prefix(24))
            running[key] = Running(id: key, title: title, kind: .codex, session: session, since: now)
        case "PermissionRequest":
            let tool = p["tool_name"] as? String ?? ""
            let message = tool.isEmpty ? "Codex 等你批准" : "Codex 要用 \(tool)"
            waiting[key] = Waiting(title: "Codex 等你批准", session: key, folder: folder, message: message, kind: .permission, since: now)
            return notify.waiting ? Alert(title: "Codex 等你批准", body: Self.join(folder, message)) : nil
        case "PreToolUse", "PostToolUse":
            waiting[key] = nil
        case "Stop":
            waiting[key] = nil
            guard let task = running.removeValue(forKey: key) else { return nil }
            // 自己在 Codex 里聊的短回合很多，只有较长的一轮才提醒
            guard now.timeIntervalSince(task.since) >= Double(notify.turnMinSec) else { return nil }
            return finished(task, ok: true, folder: folder, notify: notify)
        default:
            break
        }
        return nil
    }

    // MARK: 消息

    static let inFlightStates: Set<String> = ["asking", "queued", "flying", "delivered"]

    /// 处理一条 PigeonNote：在路上的记下来，收尾的（已回信、没发出、没回音）拿掉并按设置提醒。
    private mutating func note(_ p: [String: Any], notify: NotifyPrefs, now: Date) -> Alert? {
        guard let band = p["band"] as? String, !band.isEmpty else { return nil }
        let state = p["state"] as? String ?? ""
        let from = Party(p["from"]), to = Party(p["to"])
        if Self.inFlightStates.contains(state) {
            guard endedBands[band] == nil else { return nil }
            var n = notes[band] ?? Note(band: band, state: state, from: from, to: to,
                                        since: Self.date(p["ts"]) ?? now, updated: now, preview: "")
            n.state = state
            n.updated = now
            n.from.merge(from)
            n.to.merge(to)
            if let preview = p["preview"] as? String, !preview.isEmpty { n.preview = preview }
            notes[band] = n
            return nil
        }
        guard ["home", "refused", "lost"].contains(state) else { return nil }
        var n = notes.removeValue(forKey: band)
            ?? Note(band: band, state: state, from: from, to: to, since: now, updated: now, preview: "")
        n.from.merge(from)
        n.to.merge(to)
        guard endedBands[band] == nil else { return nil }
        endedBands[band] = now
        let route = "\(n.from.label) → \(n.to.label)"
        let took = now.timeIntervalSince(n.since)
        switch state {
        case "home":
            let answer = (p["answer_preview"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            replies.insert(Reply(band: band, from: n.from, to: n.to, preview: n.preview, answer: answer, at: now, took: took), at: 0)
            if replies.count > Self.keepReplies { replies.removeLast(replies.count - Self.keepReplies) }
            guard notify.noteHome else { return nil }
            let tail = answer.isEmpty ? "用了 \(Self.duration(took))" : answer
            return Alert(title: "回信到了", body: "\(route) · \(tail)", url: n.url)
        case "refused":
            // 你自己点的拦下不用再提醒一遍
            let reason = p["reason"] as? String ?? ""
            guard notify.noteLost, reason != "blocked" else { return nil }
            let error = (p["error"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let why = Self.refusedText(reason) ?? (error.isEmpty ? "对方没有收下" : error)
            return Alert(title: "消息没发出", body: "\(route) · \(why)", url: n.url)
        default:
            guard notify.noteLost else { return nil }
            return Alert(title: "消息没回音", body: "\(route) · 一直没等到结果，没有自动重发", url: n.url)
        }
    }

    /// 应用启动时从任务记录里接上还在路上的消息（不发通知）。只认两小时内更新过的。
    mutating func seed(journal: [[String: Any]], now: Date = Date()) {
        for raw in journal {
            guard let band = raw["band"] as? String, !band.isEmpty,
                  let state = raw["state"] as? String, Self.inFlightStates.contains(state),
                  notes[band] == nil else { continue }
            let updated = Self.date(raw["updated"]) ?? now
            guard now.timeIntervalSince(updated) < Self.noteStaleAfter else { continue }
            notes[band] = Note(band: band, state: state, from: Party(raw["from"]), to: Party(raw["to"]),
                               since: Self.date(raw["created"]) ?? updated, updated: updated, preview: "")
        }
    }

    /// 两小时没有任何动静的消息多半是看护进程没了，不再算在路上
    static let noteStaleAfter: TimeInterval = 2 * 3600

    /// 没发出的原因（接口里的 reason）怎么说；不认识的返回 nil
    static func refusedText(_ reason: String) -> String? {
        switch reason {
        case "blocked": "你拦下了"
        case "timeout": "没人理，没发出"
        case "no_target": "对方不在了"
        case "max_hops": "来回超过上限"
        case "offline": "连不上，没发出"
        default: nil
        }
    }

    static func noteStateText(_ state: String) -> String {
        switch state {
        case "asking": "等你确认"
        case "queued": "排队"
        case "flying": "进行中"
        case "delivered": "已送达"
        case "home": "已回信"
        case "refused": "没发出"
        case "lost": "没回音"
        default: state
        }
    }

    /// 毫秒时间戳 → Date
    private static func date(_ raw: Any?) -> Date? {
        guard let ms = (raw as? NSNumber)?.doubleValue, ms > 0 else { return nil }
        return Date(timeIntervalSince1970: ms / 1000)
    }

    /// 定时调用：会话直接关掉后不会再有事件，靠这里把过期状态清掉。返回状态是否变了。
    mutating func expire(now: Date = Date()) -> Bool {
        let before = (running.count, waiting.count, notes.count)
        dropStale(now)
        return before != (running.count, waiting.count, notes.count)
    }

    /// 和网页 store.js 的识别规则一致：Codex 的 MCP 工具，或 Bash 里直接跑 codex 命令
    private static func isCodexCall(_ name: String, _ input: [String: Any]) -> Bool {
        if name.lowercased().hasPrefix("mcp__codex") { return true }
        guard name == "Bash", let command = input["command"] as? String else { return false }
        return command.range(of: #"(^|[\s;&|(])codex(\s|$)"#, options: .regularExpression) != nil
    }

    private func finished(_ task: Running, ok: Bool, folder: String, notify: NotifyPrefs) -> Alert? {
        guard ok ? notify.done : notify.failed else { return nil }
        let who = task.kind == .codex ? "Codex" : "子代理"
        let took = Self.duration(Date().timeIntervalSince(task.since))
        return Alert(title: ok ? "\(who)完成了" : "\(who)出错了", body: Self.join(folder, "\(task.title) · \(took)"))
    }

    /// 两小时还没收尾的任务多半是丢了结束事件（会话被关掉等），不再算在跑。
    private mutating func dropStale(_ now: Date) {
        running = running.filter { now.timeIntervalSince($0.value.since) < 2 * 3600 }
        waiting = waiting.filter { now.timeIntervalSince($0.value.since) < 6 * 3600 }
        turnStart = turnStart.filter { now.timeIntervalSince($0.value) < 6 * 3600 }
        notes = notes.filter { now.timeIntervalSince($0.value.updated) < Self.noteStaleAfter }
        endedBands = endedBands.filter { now.timeIntervalSince($0.value) < 3600 }
    }

    // MARK: 文案

    /// 返回 nil 表示这条通知不是在等你（比如登录成功）。老版本 Claude Code 不带类型，只能看文字猜。
    static func waitKind(_ type: String?, _ message: String) -> WaitKind? {
        switch type {
        case "permission_prompt": return .permission
        case "elicitation_dialog": return .question
        case "idle_prompt": return .idle
        case nil, "":
            if message.localizedCaseInsensitiveContains("permission") { return .permission }
            if message.localizedCaseInsensitiveContains("waiting for your input") { return .idle }
            return .other
        default:
            return nil
        }
    }

    static func waitTitle(_ kind: WaitKind) -> String {
        switch kind {
        case .permission: "Claude 等你批准"
        case .question: "Claude 有问题问你"
        case .idle: "轮到你了"
        case .other: "Claude 在等你"
        }
    }

    private static func waitBody(_ kind: WaitKind, _ message: String) -> String {
        // Claude Code 的提示是英文固定句，常见的翻成中文，其余原样显示
        if kind == .idle { return "Claude 在等你回复" }
        if let range = message.range(of: "Claude needs your permission to use ") {
            return "要用 \(message[range.upperBound...])"
        }
        return message.isEmpty ? "去看看吧" : message
    }

    private static func join(_ folder: String, _ text: String) -> String {
        folder.isEmpty ? text : "\(folder) · \(text)"
    }

    static func folder(_ cwd: String?) -> String {
        guard let cwd, !cwd.isEmpty else { return "" }
        return URL(fileURLWithPath: cwd).lastPathComponent
    }

    static func duration(_ seconds: TimeInterval) -> String {
        let s = max(1, Int(seconds.rounded()))
        return s < 60 ? "\(s) 秒" : "\(s / 60) 分 \(s % 60) 秒"
    }

    private static func failed(_ resp: Any?) -> Bool {
        if let r = resp as? [String: Any] {
            if (r["is_error"] as? Bool) == true || (r["isError"] as? Bool) == true { return true }
            if let e = r["error"], !(e is NSNull) { return true }
            return false
        }
        if let s = resp as? String {
            return s.trimmingCharacters(in: .whitespaces).range(of: #"^(error|错误|failed)\b"#, options: [.regularExpression, .caseInsensitive]) != nil
        }
        return false
    }
}

/// 设置里的 `notify` 一段；缺省时全开。
struct NotifyPrefs: Sendable {
    var done = true
    var failed = true
    var waiting = true
    var turnEnd = true
    var turnMinSec = 60
    /// 回信到了
    var noteHome = true
    /// 消息没发出或没回音
    var noteLost = true

    static func load() -> NotifyPrefs {
        var prefs = NotifyPrefs()
        guard let n = Settings.object()["notify"] as? [String: Any] else { return prefs }
        if let v = n["done"] as? Bool { prefs.done = v }
        if let v = n["failed"] as? Bool { prefs.failed = v }
        if let v = n["waiting"] as? Bool { prefs.waiting = v }
        if let v = n["turnEnd"] as? Bool { prefs.turnEnd = v }
        if let v = n["turnMinSec"] as? Int { prefs.turnMinSec = min(3600, max(10, v)) }
        if let v = n["noteHome"] as? Bool { prefs.noteHome = v }
        if let v = n["noteLost"] as? Bool { prefs.noteLost = v }
        return prefs
    }
}
