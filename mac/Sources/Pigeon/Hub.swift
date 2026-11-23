import Foundation
import Network

/// 本机 HTTP 服务 + SSE 广播 + 检测状态。所有可变状态只在 `queue` 上访问。
final class Hub: @unchecked Sendable {
    static let port: UInt16 = Paths.port
    static let origin = "http://127.0.0.1:\(port)"
    static let allowedHosts: Set<String> = ["127.0.0.1:\(port)", "localhost:\(port)", "[::1]:\(port)"]

    let queue = DispatchQueue(label: "dev.polang.pigeon.server")
    let webRoot: URL
    /// 实际监听的端口。默认是 `Hub.port`，测试时可以换成别的。
    let port: UInt16

    private var listener: NWListener?
    private var connections: [ObjectIdentifier: HTTPConnection] = [:]
    private var sseClients: [ObjectIdentifier: HTTPConnection] = [:]
    private var lastHookAt: Date?
    private var lastAgents: Agents?
    private var timers: [DispatchSourceTimer] = []
    private var reportedFailure = false
    private var watch = Watch()
    private var notify = NotifyPrefs.load()
    private var watching = false
    private let usage = Usage()
    private var lastUsage: Usage.Summary?
    private var usagePending = false
    private var lastCodexHookAt: Date?

    // 新界面要的状态（都只在 queue 上访问）
    var sessions = SessionTracker()
    var lastLoftsJSON = Data()
    var loftsPending = false
    var lastLoftsPush = Date.distantPast
    var lastLoftsTick = Date()
    var loftsMTime: Date?
    lazy var asks: AskQueue = AskQueue(queue: queue)
    var dispatchInput = Dispatch.Input()
    var sentBodies: [String: Data] = [:]
    var sentOrder: [String] = []
    /// 应用自己派出去、命令还没跑完的活：send_id → 回话的闭包和留给重发的原文。跨设备的那件一排进等你的一队就先回话。
    var pendingSends: [String: (completion: @Sendable (Int, Data) -> Void, remembered: Data)] = [:]
    var refreshWaiters: [@Sendable (Int, Data) -> Void] = []

    // 测试里可以换掉的外部依赖
    var pluginScriptsOverride: URL?
    var opener: @Sendable ([String]) -> (Bool, String) = Hub.defaultOpener
    var magpieFetch: @Sendable (String) async throws -> Data = Magpie.liveFetch

    /// 任务和等待状态变了、或者需要发通知时调用（在 queue 上）。
    var onWatch: (@Sendable (Watch.Snapshot, Watch.Alert?) -> Void)?
    /// 设置被页面或菜单改过后调用（在 queue 上），参数是新的设置原文。
    var onSettings: (@Sendable (Data) -> Void)?
    /// 等你处理的一队变了（在 queue 上），参数是 `{"items":[…]}`。
    var onQueue: (@Sendable (Data) -> Void)?
    /// 对话列表或状态变了（在 queue 上，最多每 500 毫秒一次），参数和 `GET /api/lofts` 一样。
    var onLofts: (@Sendable (Data) -> Void)?
    /// 网页请求打开刘海（在 queue 上），参数是 `POST /api/notch` 的请求体。
    var onNotch: (@Sendable (Data) -> Void)?
    /// 检测到的 agent 变了（装没装、开没开）时调用（在 queue 上）。
    var onAgents: (@Sendable (Agents) -> Void)?

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return e
    }()

    init(webRoot: URL, port: UInt16 = Hub.port) {
        self.webRoot = webRoot
        self.port = port
        watch.seed(journal: Self.readJournal())
        asks.onChange = { [weak self] in self?.queueChanged() }
    }

    /// 停掉监听、定时器和所有连接（测试用，应用退出时不必调）。
    func stop() {
        queue.sync {
            timers.forEach { $0.cancel() }
            timers = []
            listener?.cancel()
            listener = nil
            for c in connections.values { c.close() }
        }
    }

    /// 启动时的状态（含从任务记录接上的消息），给菜单栏和刘海画第一帧。
    func currentSnapshot(_ completion: @escaping @Sendable (Watch.Snapshot) -> Void) {
        queue.async { [weak self] in
            guard let self else { return }
            completion(self.watch.snapshot)
        }
    }

    func start(onReady: @escaping @Sendable () -> Void, onFailure: @escaping @Sendable (String) -> Void) {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = false
        params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: port)!)
        let listener: NWListener
        do {
            listener = try NWListener(using: params)
        } catch {
            onFailure(Self.describe(error, port: port))
            return
        }
        self.listener = listener
        listener.newConnectionHandler = { [weak self] nw in
            guard let self else { nw.cancel(); return }
            let conn = HTTPConnection(nw, hub: self)
            self.connections[conn.id] = conn
            conn.start()
        }
        listener.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.startTimers()
                self.runDetection(forceBroadcast: false)
                onReady()
            case let .failed(error), let .waiting(error):
                guard !self.reportedFailure else { return }
                self.reportedFailure = true
                self.listener?.cancel()
                onFailure(Self.describe(error, port: self.port))
            default:
                break
            }
        }
        listener.start(queue: queue)
    }

    private static func describe(_ error: Error, port: UInt16) -> String {
        if let nwError = error as? NWError, case let .posix(code) = nwError, code == .EADDRINUSE {
            return "端口 \(port) 已被占用。可能已经开着另一个 Pigeon，或者有别的程序在用这个端口。"
        }
        return "无法在 127.0.0.1:\(port) 上启动本机服务：\(error.localizedDescription)"
    }

    private func startTimers() {
        let heartbeat = DispatchSource.makeTimerSource(queue: queue)
        heartbeat.schedule(deadline: .now() + 15, repeating: 15)
        heartbeat.setEventHandler { [weak self] in
            guard let self else { return }
            let ping = Data(": ping\n\n".utf8)
            for client in self.sseClients.values { client.write(ping) }
        }
        let detect = DispatchSource.makeTimerSource(queue: queue)
        detect.schedule(deadline: .now() + 30, repeating: 30)
        detect.setEventHandler { [weak self] in self?.runDetection(forceBroadcast: false) }
        let expire = DispatchSource.makeTimerSource(queue: queue)
        expire.schedule(deadline: .now() + 60, repeating: 60)
        expire.setEventHandler { [weak self] in
            guard let self, self.watch.expire() else { return }
            self.onWatch?(self.watch.snapshot, nil)
        }
        let save = DispatchSource.makeTimerSource(queue: usage.queue)
        save.schedule(deadline: .now() + 30, repeating: 30)
        save.setEventHandler { [weak self] in self?.usage.saveIfNeeded() }
        save.resume()
        timers.append(save)
        heartbeat.resume()
        detect.resume()
        expire.resume()
        // 每 2 秒看一次：lofts.json 有没有被插件改过、有没有对话因为时间到了要变状态
        let loftsTick = DispatchSource.makeTimerSource(queue: queue)
        loftsTick.schedule(deadline: .now() + 2, repeating: 2)
        loftsTick.setEventHandler { [weak self] in self?.loftsTickFired() }
        loftsTick.resume()
        timers = [heartbeat, detect, expire, loftsTick]
    }

    func connectionClosed(_ conn: HTTPConnection) {
        connections[conn.id] = nil
        sseClients[conn.id] = nil
        asks.connectionClosed(conn.id)
    }

    // MARK: 路由

    func handle(_ req: HTTPRequest, on conn: HTTPConnection, keepAlive: Bool) {
        let hosts: Set<String> = ["127.0.0.1:\(port)", "localhost:\(port)", "[::1]:\(port)"]
        if let host = req.header("host"), !hosts.contains(host.lowercased()) {
            conn.respond(status: 403, body: Data("Forbidden host".utf8), contentType: "text/plain; charset=utf-8",
                         keepAlive: false)
            return
        }
        // 浏览器里别的网站的页面也能往 127.0.0.1 发请求（Host 是对的，上面那条拦不住），
        // 不拦的话它能读到等你确认的原文、替你点放行、替你派活、改设置。浏览器发这类请求会带 Origin：
        // 带了而且不是本页面自己的，一律拒绝。curl、插件、应用自己的窗口（同源的 GET）不带 Origin，不受影响。
        if let origin = req.header("origin"), !Self.allowedOrigins(port: port).contains(origin.lowercased()) {
            conn.respond(status: 403, body: Data("Forbidden origin".utf8), contentType: "text/plain; charset=utf-8",
                         keepAlive: false)
            return
        }
        let path = req.path
        switch (req.method, path) {
        case ("OPTIONS", _):
            // 同源的请求不需要预检；别的来源在上面已经拒了
            conn.respond(status: 204, keepAlive: keepAlive)
        case ("POST", "/ev"):
            handleHook(req, conn: conn, keepAlive: keepAlive)
        case ("POST", "/ev/codex"):
            let task = req.header("x-pigeon-task") ?? ""
            handleHook(req, conn: conn, keepAlive: keepAlive, codexTask: task)
        case (_, "/ev"):
            methodNotAllowed(conn, keepAlive: keepAlive)
        case ("GET", "/events"):
            startSSE(conn)
        case (_, "/events"):
            methodNotAllowed(conn, keepAlive: keepAlive)
        case ("GET", "/api/detect"), ("POST", "/api/detect"):
            runDetection(forceBroadcast: req.method == "POST") { [weak self] agents in
                guard let self else { return }
                conn.respond(status: 200, headers: Self.cors + [("Cache-Control", "no-store")],
                             body: (try? self.encoder.encode(agents)) ?? Data("{}".utf8),
                             contentType: "application/json; charset=utf-8", keepAlive: keepAlive)
            }
        case (_, "/api/detect"):
            methodNotAllowed(conn, keepAlive: keepAlive)
        case ("GET", "/api/settings"):
            respondJSON(conn, Settings.load(), keepAlive: keepAlive)
        case ("PUT", "/api/settings"):
            handleSaveSettings(req, conn: conn, keepAlive: keepAlive)
        case ("PATCH", "/api/settings"):
            handlePatchSettings(req, conn: conn, keepAlive: keepAlive)
        case (_, "/api/settings"):
            methodNotAllowed(conn, keepAlive: keepAlive)
        case ("GET", "/api/codex/models"):
            respondJSON(conn, (try? encoder.encode(Settings.codexModels())) ?? Data("[]".utf8), keepAlive: keepAlive)
        case (_, "/api/codex/models"):
            methodNotAllowed(conn, keepAlive: keepAlive)
        case ("GET", "/api/codex/hooks"):
            respondJSON(conn, (try? encoder.encode(CodexHooks.status(lastEventAt: lastCodexHookAt))) ?? Data("{}".utf8), keepAlive: keepAlive)
        case ("POST", "/api/codex/hooks"):
            handleCodexHooks(req, conn: conn, keepAlive: keepAlive)
        case (_, "/api/codex/hooks"):
            methodNotAllowed(conn, keepAlive: keepAlive)
        case ("GET", "/api/notes"):
            respondJSON(conn, Self.notesBody(retryable: Set(sentBodies.keys)), keepAlive: keepAlive)
        case (_, "/api/notes"):
            methodNotAllowed(conn, keepAlive: keepAlive)
        case ("GET", "/api/lofts"):
            respondJSON(conn, composeLofts(), keepAlive: keepAlive)
        case (_, "/api/lofts"):
            methodNotAllowed(conn, keepAlive: keepAlive)
        case ("POST", "/api/lofts/refresh"):
            performRefresh { [weak self] status, body in self?.respondStatus(conn, status, body, keepAlive: keepAlive) }
        case (_, "/api/lofts/refresh"):
            methodNotAllowed(conn, keepAlive: keepAlive)
        case ("GET", "/api/queue"):
            respondJSON(conn, asks.snapshot(), keepAlive: keepAlive)
        case (_, "/api/queue"):
            methodNotAllowed(conn, keepAlive: keepAlive)
        case ("POST", "/api/ask"):
            handleAsk(req, conn: conn, keepAlive: keepAlive)
        case (_, "/api/ask"):
            methodNotAllowed(conn, keepAlive: keepAlive)
        case ("POST", _) where path.hasPrefix("/api/queue/"):
            handleResolve(id: String(path.dropFirst("/api/queue/".count)), req, conn: conn, keepAlive: keepAlive)
        case ("POST", "/api/pause"):
            handlePause(req, conn: conn, keepAlive: keepAlive)
        case (_, "/api/pause"):
            methodNotAllowed(conn, keepAlive: keepAlive)
        case ("POST", "/api/send"):
            performSend(req.body) { [weak self] status, body in self?.respondStatus(conn, status, body, keepAlive: keepAlive) }
        case ("POST", "/api/open"):
            performOpen(req.body) { [weak self] status, body in self?.respondStatus(conn, status, body, keepAlive: keepAlive) }
        case (_, "/api/send"), (_, "/api/open"):
            methodNotAllowed(conn, keepAlive: keepAlive)
        case ("PUT", "/api/dispatch"):
            handleDispatchPut(req, conn: conn, keepAlive: keepAlive)
        case ("POST", "/api/dispatch/suggest"):
            let (status, body) = suggestNow(req.body)
            respondStatus(conn, status, body, keepAlive: keepAlive)
        case (_, "/api/dispatch"), (_, "/api/dispatch/suggest"):
            methodNotAllowed(conn, keepAlive: keepAlive)
        case ("GET", "/api/magpie/hello"):
            handleMagpie(.hello, conn: conn, keepAlive: keepAlive)
        case ("GET", "/api/magpie/quotas"):
            handleMagpie(.quotas, conn: conn, keepAlive: keepAlive)
        case ("GET", "/api/magpie/models"):
            handleMagpie(.models, conn: conn, keepAlive: keepAlive)
        case (_, "/api/magpie/hello"), (_, "/api/magpie/quotas"), (_, "/api/magpie/models"):
            methodNotAllowed(conn, keepAlive: keepAlive)
        case ("POST", "/api/notch"):
            handleNotch(req, conn: conn, keepAlive: keepAlive)
        case (_, "/api/notch"):
            methodNotAllowed(conn, keepAlive: keepAlive)
        case ("GET", "/api/usage"):
            usage.queue.async { [weak self] in
                guard let self else { return }
                let body = (try? self.encoder.encode(self.usage.summary())) ?? Data("{}".utf8)
                self.queue.async { self.respondJSON(conn, body, keepAlive: keepAlive) }
            }
        case (_, "/api/usage"):
            methodNotAllowed(conn, keepAlive: keepAlive)
        case ("GET", _), ("HEAD", _):
            if path.hasPrefix("/api/") {
                conn.respond(status: 404, headers: Self.cors, body: Data(#"{"error":"not found"}"#.utf8),
                             contentType: "application/json; charset=utf-8", keepAlive: keepAlive)
            } else {
                StaticFiles.serve(path: path, root: webRoot, head: req.method == "HEAD", conn: conn, keepAlive: keepAlive)
            }
        default:
            methodNotAllowed(conn, keepAlive: keepAlive)
        }
    }

    /// 以前给 file:// 打开的页面开过 `Access-Control-Allow-Origin: *`。现在页面只从本服务加载，不再给任何别的来源开。
    static let cors: [(String, String)] = []

    static func allowedOrigins(port: UInt16) -> Set<String> {
        ["http://127.0.0.1:\(port)", "http://localhost:\(port)", "http://[::1]:\(port)"]
    }

    private func methodNotAllowed(_ conn: HTTPConnection, keepAlive: Bool) {
        conn.respond(status: 405, headers: Self.cors, body: Data("Method Not Allowed".utf8),
                     contentType: "text/plain; charset=utf-8", keepAlive: keepAlive)
    }

    func respondStatus(_ conn: HTTPConnection, _ status: Int, _ body: Data, keepAlive: Bool) {
        conn.respond(status: status, headers: Self.cors + [("Cache-Control", "no-store")], body: body,
                     contentType: "application/json; charset=utf-8", keepAlive: keepAlive)
    }

    static func jsonData(_ obj: Any) -> Data {
        (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data("{}".utf8)
    }

    private func respondJSON(_ conn: HTTPConnection, _ body: Data, keepAlive: Bool) {
        conn.respond(status: 200, headers: Self.cors + [("Cache-Control", "no-store")], body: body,
                     contentType: "application/json; charset=utf-8", keepAlive: keepAlive)
    }

    // MARK: 设置

    private func handleSaveSettings(_ req: HTTPRequest, conn: HTTPConnection, keepAlive: Bool) {
        do {
            try Settings.save(req.body)
        } catch {
            let (status, message) = switch error {
            case .notObject: (400, "设置必须是一个 JSON 对象")
            case let .io(e): (500, "保存设置失败：\(e.localizedDescription)")
            }
            conn.respond(status: status, headers: Self.cors, body: Data(message.utf8),
                         contentType: "text/plain; charset=utf-8", keepAlive: keepAlive)
            return
        }
        respondJSON(conn, req.body, keepAlive: keepAlive)
        settingsChanged(req.body)
    }

    /// `PATCH /api/settings`：请求体是要改的那几处（对象逐层合并，值为 null 是删掉这一项，数组整个换），
    /// 在本服务的队列上读、合并、写，所以页面、菜单、刘海同时改不会互相盖掉。回保存后的完整设置。
    private func handlePatchSettings(_ req: HTTPRequest, conn: HTTPConnection, keepAlive: Bool) {
        guard let patch = (try? JSONSerialization.jsonObject(with: req.body)) as? [String: Any] else {
            conn.respond(status: 400, body: Data("设置必须是一个 JSON 对象".utf8), contentType: "text/plain; charset=utf-8", keepAlive: keepAlive)
            return
        }
        do {
            let body = try Settings.update { Settings.merge(&$0, patch: patch) }
            respondJSON(conn, body, keepAlive: keepAlive)
            settingsChanged(body)
        } catch {
            conn.respond(status: 500, body: Data("保存设置失败".utf8), contentType: "text/plain; charset=utf-8", keepAlive: keepAlive)
        }
    }

    func settingsChanged(_ body: Data) {
        notify = NotifyPrefs.load()
        broadcast(Self.envelope(type: "settings", key: "settings", json: Self.singleLine(body)))
        onSettings?(body)
    }

    // MARK: 任务记录和设备

    private static func readJSONObject(_ url: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    static func readJournal() -> [[String: Any]] {
        readJSONObject(Paths.journalFile)?["notes"] as? [[String: Any]] ?? []
    }

    /// `{ "notes": [...] }`：按 updated 从新到旧，最多 100 条。文件不存在或坏了时是空列表。
    /// `retryable` 里的编号是应用自己发的、原文还在内存里，加 `retryable: true`。
    static func notesBody(retryable: Set<String> = []) -> Data {
        func updated(_ n: [String: Any]) -> Double { (n["updated"] as? NSNumber)?.doubleValue ?? 0 }
        var notes = Array(readJournal().sorted { updated($0) > updated($1) }.prefix(100))
        for i in notes.indices where retryable.contains(notes[i]["band"] as? String ?? "") { notes[i]["retryable"] = true }
        let body: [String: Any] = ["notes": notes]
        return (try? JSONSerialization.data(withJSONObject: body, options: [.withoutEscapingSlashes])) ?? Data(#"{"notes":[]}"#.utf8)
    }

    static let defaultLofts = Data(#"{"version":1,"updated":0,"lofts":[{"id":"local","name":"这台 Mac","online":true,"sessions":[],"projects":[]}]}"#.utf8)

    /// lofts.json 原样返回；不存在或不是 JSON 对象时给只有本机的默认值。
    static func loftsBody() -> Data {
        guard let data = try? Data(contentsOf: Paths.loftsFile),
              (try? JSONSerialization.jsonObject(with: data)) is [String: Any] else { return defaultLofts }
        return singleLine(data)
    }

    // MARK: hook

    /// 网页只用得到这几种 hook（任务和消息的进度）；别的只在应用里用（对话状态、刘海、用量），不经 SSE 转给网页。
    /// Codex 自己的 hook 也不转：对话的状态由应用算好放进 lofts 里。
    static let forwardedHooks: Set<String> = ["PigeonNote", "PigeonRun"]

    static func forwardsHook(_ payload: [String: Any]) -> Bool {
        guard (payload["source"] as? String) != "codex" else { return false }
        return forwardedHooks.contains(payload["hook_event_name"] as? String ?? "")
    }

    /// 已经在服务自己的队列上（连接都跑在 queue 上）。请求体只解析一次。
    /// `codexTask` 不为 nil 表示这是 Codex 自己的 hook（/ev/codex）：给它加上 source 和包装层任务 id 再往下交。
    private func handleHook(_ req: HTTPRequest, conn: HTTPConnection, keepAlive: Bool, codexTask: String? = nil) {
        dispatchPrecondition(condition: .onQueue(queue))
        guard var payload = (try? JSONSerialization.jsonObject(with: req.body)) as? [String: Any] else {
            conn.respond(status: 400, headers: Self.cors, body: Data("body must be a JSON object".utf8),
                         contentType: "text/plain; charset=utf-8", keepAlive: keepAlive)
            return
        }
        conn.respond(status: 204, headers: Self.cors, keepAlive: keepAlive)
        if let codexTask {
            payload["source"] = "codex"
            payload["pigeon_task_id"] = codexTask
            lastCodexHookAt = Date()
        }
        lastHookAt = Date()
        // 转给网页的那几种原文本来就是插件发来的样子，直接用收到的字节
        if Self.forwardsHook(payload) {
            broadcast(Self.envelope(type: "hook", key: "payload", json: Self.singleLine(req.body)))
        }
        if sessions.ingest(payload) { scheduleLoftsPush() }
        let alert = watch.ingest(payload, notify: notify, watching: watching)
        onWatch?(watch.snapshot, alert)
        trackUsage(HookPayload(payload))
        if lastAgents?.claude.running != true {
            runDetection(forceBroadcast: false)
        }
    }

    /// 解析好的 hook 原文，交给用量的队列读。只读不改，所以可以跨队列
    struct HookPayload: @unchecked Sendable {
        let value: [String: Any]
        init(_ value: [String: Any]) { self.value = value }
    }

    /// JSON 字符串里的换行一定是转义过的，所以裸 CR/LF 只能是空白，换成空格不改变内容。
    static func singleLine(_ data: Data) -> Data {
        var out = data
        for i in out.indices where out[i] == 0x0A || out[i] == 0x0D { out[i] = 0x20 }
        return out
    }

    static func envelope(type: String, key: String, json: Data) -> Data {
        let ts = Int64(Date().timeIntervalSince1970 * 1000)
        var msg = Data("{\"type\":\"\(type)\",\"ts\":\(ts),\"\(key)\":".utf8)
        msg.append(json)
        msg.append(Data("}".utf8))
        return msg
    }

    // MARK: 用量

    /// 从 hook 原文里找对话记录文件，交给 Usage 在自己的队列上读；有变化时（最多每 2 秒一次）广播摘要。
    private func trackUsage(_ hook: HookPayload) {
        usage.queue.async { [weak self] in
            guard let self else { return }
            let p = hook.value
            let event = p["hook_event_name"] as? String ?? ""
            let fromCodex = (p["source"] as? String) == "codex"
            let force = event == "Stop" || event == "SubagentStop"
            var changed = false
            if event == "PigeonRun", p["phase"] as? String == "end" {
                // 包装层任务：优先读它的会话记录（和 Codex hook 读到的是同一份，不会重复计）；临时任务没有记录，用它报的总量
                if let thread = p["thread_id"] as? String, let path = Usage.codexRollout(thread: thread) {
                    changed = self.usage.scan(path: path, agent: "codex", kind: .codex, force: true)
                } else if let u = p["usage"] as? [String: Any] {
                    self.usage.add(agent: "codex", usage: u, model: p["model"] as? String)
                    changed = true
                }
            } else if let path = p["transcript_path"] as? String, !path.isEmpty {
                // 子代理的工具调用也带主对话的 transcript_path，算在 Claude 头上
                changed = self.usage.scan(path: path, agent: fromCodex ? "codex" : "claude", kind: fromCodex ? .codex : .claude, force: force)
            }
            if event == "SubagentStop", let path = p["agent_transcript_path"] as? String {
                changed = self.usage.scan(path: path, agent: "subagent", kind: .claude, force: true) || changed
            }
            if changed { self.queue.async { self.scheduleUsageBroadcast() } }
        }
    }

    private func scheduleUsageBroadcast() {
        guard !usagePending else { return }
        usagePending = true
        queue.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self else { return }
            self.usagePending = false
            self.usage.queue.async {
                let summary = self.usage.summary()
                self.queue.async {
                    guard summary != self.lastUsage else { return }
                    self.lastUsage = summary
                    if let json = try? self.encoder.encode(summary) {
                        self.broadcast(Self.envelope(type: "usage", key: "usage", json: json))
                    }
                }
            }
        }
    }

    // MARK: Codex hook 安装

    private func handleCodexHooks(_ req: HTTPRequest, conn: HTTPConnection, keepAlive: Bool) {
        let enable = ((try? JSONSerialization.jsonObject(with: req.body)) as? [String: Any])?["enable"] as? Bool ?? true
        do {
            if enable { try CodexHooks.install() } else { try CodexHooks.uninstall() }
        } catch {
            let message = switch error { case let .io(m): m }
            conn.respond(status: 500, headers: Self.cors, body: Data(message.utf8),
                         contentType: "text/plain; charset=utf-8", keepAlive: keepAlive)
            return
        }
        respondJSON(conn, (try? encoder.encode(CodexHooks.status(lastEventAt: lastCodexHookAt))) ?? Data("{}".utf8), keepAlive: keepAlive)
    }

    // MARK: SSE

    private func startSSE(_ conn: HTTPConnection) {
        conn.upgradeToSSE()
        runDetection(forceBroadcast: false) { [weak self] agents in
            guard let self else { return }
            conn.write(self.frame(self.detectMessage(agents)))
            self.sseClients[conn.id] = conn
        }
    }

    private func frame(_ json: Data) -> Data {
        var d = Data("data: ".utf8)
        d.append(json)
        d.append(Data("\n\n".utf8))
        return d
    }

    func broadcast(_ json: Data) {
        guard !sseClients.isEmpty else { return }
        let data = frame(json)
        for client in sseClients.values { client.write(data) }
    }

    private func detectMessage(_ agents: Agents) -> Data {
        Self.envelope(type: "detect", key: "agents", json: (try? encoder.encode(agents)) ?? Data("{}".utf8))
    }

    // MARK: 检测

    /// 用户是否正看着 Pigeon 窗口；看着时不发通知。
    func setWatching(_ value: Bool) {
        queue.async { [weak self] in self?.watching = value }
    }

    /// 菜单「检测连接」调用：检测并广播，等同于 POST /api/detect。
    func detectNow() {
        queue.async { [weak self] in self?.runDetection(forceBroadcast: true) }
    }

    /// 在 queue 上调用；completion 也在 queue 上执行。
    private func runDetection(forceBroadcast: Bool, completion: (@Sendable (Agents) -> Void)? = nil) {
        Task { @MainActor [weak self] in
            let ids = Detector.runningBundleIDs()
            guard let hub = self else { return }
            hub.queue.async { [weak hub] in
                guard let self = hub else { return }
                let agents = Detector.detect(runningIDs: ids, lastHookAt: self.lastHookAt)
                let changed = agents != self.lastAgents
                self.lastAgents = agents
                if changed || forceBroadcast { self.broadcast(self.detectMessage(agents)) }
                if changed { self.onAgents?(agents) }
                completion?(agents)
            }
        }
    }
}
