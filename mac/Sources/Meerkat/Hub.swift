import Foundation
import Network

/// 本机 HTTP 服务 + SSE 广播 + 检测状态。所有可变状态只在 `queue` 上访问。
final class Hub: @unchecked Sendable {
    static let port: UInt16 = 47321
    static let origin = "http://127.0.0.1:\(port)"
    static let allowedHosts: Set<String> = ["127.0.0.1:\(port)", "localhost:\(port)", "[::1]:\(port)"]

    let queue = DispatchQueue(label: "dev.polang.meerkat.server")
    let webRoot: URL

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

    /// 任务和等待状态变了、或者需要发通知时调用（在 queue 上）。
    var onWatch: (@Sendable (Watch.Snapshot, Watch.Alert?) -> Void)?

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return e
    }()

    init(webRoot: URL) {
        self.webRoot = webRoot
    }

    func start(onReady: @escaping @Sendable () -> Void, onFailure: @escaping @Sendable (String) -> Void) {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = false
        params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: Self.port)!)
        let listener: NWListener
        do {
            listener = try NWListener(using: params)
        } catch {
            onFailure(Self.describe(error))
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
                onFailure(Self.describe(error))
            default:
                break
            }
        }
        listener.start(queue: queue)
    }

    private static func describe(_ error: Error) -> String {
        if let nwError = error as? NWError, case let .posix(code) = nwError, code == .EADDRINUSE {
            return "端口 \(port) 已被占用。可能已经开着另一个 Meerkat，或者有别的程序在用这个端口。"
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
        timers = [heartbeat, detect, expire]
    }

    func connectionClosed(_ conn: HTTPConnection) {
        connections[conn.id] = nil
        sseClients[conn.id] = nil
    }

    // MARK: 路由

    func handle(_ req: HTTPRequest, on conn: HTTPConnection, keepAlive: Bool) {
        if let host = req.header("host"), !Self.allowedHosts.contains(host.lowercased()) {
            conn.respond(status: 403, body: Data("Forbidden host".utf8), contentType: "text/plain; charset=utf-8",
                         keepAlive: false)
            return
        }
        let path = req.path
        switch (req.method, path) {
        case ("OPTIONS", _):
            conn.respond(status: 204, headers: Self.cors + [
                ("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS"),
                ("Access-Control-Allow-Headers", "Content-Type"),
                ("Access-Control-Max-Age", "600"),
            ], keepAlive: keepAlive)
        case ("POST", "/ev"):
            handleHook(req, conn: conn, keepAlive: keepAlive)
        case ("POST", "/ev/codex"):
            handleHook(req, conn: conn, keepAlive: keepAlive, codexTask: req.header("x-meerkat-task") ?? "")
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

    static let cors: [(String, String)] = [("Access-Control-Allow-Origin", "*")]

    private func methodNotAllowed(_ conn: HTTPConnection, keepAlive: Bool) {
        conn.respond(status: 405, headers: Self.cors, body: Data("Method Not Allowed".utf8),
                     contentType: "text/plain; charset=utf-8", keepAlive: keepAlive)
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
        notify = NotifyPrefs.load()
        broadcast(Self.envelope(type: "settings", key: "settings", json: Self.singleLine(req.body)))
    }

    // MARK: hook

    /// `codexTask` 不为 nil 表示这是 Codex 自己的 hook（/ev/codex）：给原文加上 source 和包装层任务 id 再广播。
    private func handleHook(_ req: HTTPRequest, conn: HTTPConnection, keepAlive: Bool, codexTask: String? = nil) {
        var raw = req.body
        if let codexTask, var obj = (try? JSONSerialization.jsonObject(with: raw)) as? [String: Any] {
            obj["source"] = "codex"
            obj["meerkat_task_id"] = codexTask
            raw = (try? JSONSerialization.data(withJSONObject: obj)) ?? raw
        }
        let body = raw
        if codexTask != nil { queue.async { [weak self] in self?.lastCodexHookAt = Date() } }
        guard (try? JSONSerialization.jsonObject(with: body)) is [String: Any] else {
            conn.respond(status: 400, headers: Self.cors, body: Data("body must be a JSON object".utf8),
                         contentType: "text/plain; charset=utf-8", keepAlive: keepAlive)
            return
        }
        conn.respond(status: 204, headers: Self.cors, keepAlive: keepAlive)
        queue.async { [weak self] in
            guard let self else { return }
            self.lastHookAt = Date()
            self.broadcast(Self.envelope(type: "hook", key: "payload", json: Self.singleLine(body)))
            if let payload = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] {
                let alert = self.watch.ingest(payload, notify: self.notify, watching: self.watching)
                self.onWatch?(self.watch.snapshot, alert)
                self.trackUsage(body)
            }
            if self.lastAgents?.claude.running != true {
                self.runDetection(forceBroadcast: false)
            }
        }
    }

    /// JSON 字符串里的换行一定是转义过的，所以裸 CR/LF 只能是空白，换成空格不改变内容。
    private static func singleLine(_ data: Data) -> Data {
        var out = data
        for i in out.indices where out[i] == 0x0A || out[i] == 0x0D { out[i] = 0x20 }
        return out
    }

    private static func envelope(type: String, key: String, json: Data) -> Data {
        let ts = Int64(Date().timeIntervalSince1970 * 1000)
        var msg = Data("{\"type\":\"\(type)\",\"ts\":\(ts),\"\(key)\":".utf8)
        msg.append(json)
        msg.append(Data("}".utf8))
        return msg
    }

    // MARK: 用量

    /// 从 hook 原文里找对话记录文件，交给 Usage 在自己的队列上读；有变化时（最多每 2 秒一次）广播摘要。
    private func trackUsage(_ body: Data) {
        usage.queue.async { [weak self] in
            guard let self, let p = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else { return }
            let event = p["hook_event_name"] as? String ?? ""
            let fromCodex = (p["source"] as? String) == "codex"
            let force = event == "Stop" || event == "SubagentStop"
            var changed = false
            if event == "MeerkatCodex", p["phase"] as? String == "end" {
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

    private func broadcast(_ json: Data) {
        guard !sseClients.isEmpty else { return }
        let data = frame(json)
        for client in sseClients.values { client.write(data) }
    }

    private func detectMessage(_ agents: Agents) -> Data {
        Self.envelope(type: "detect", key: "agents", json: (try? encoder.encode(agents)) ?? Data("{}".utf8))
    }

    // MARK: 检测

    /// 用户是否正看着 Meerkat 窗口；看着时不发通知。
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
                completion?(agents)
            }
        }
    }
}
