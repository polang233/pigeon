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
        heartbeat.resume()
        detect.resume()
        timers = [heartbeat, detect]
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
                ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
                ("Access-Control-Allow-Headers", "Content-Type"),
                ("Access-Control-Max-Age", "600"),
            ], keepAlive: keepAlive)
        case ("POST", "/ev"):
            handleHook(req, conn: conn, keepAlive: keepAlive)
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

    // MARK: hook

    private func handleHook(_ req: HTTPRequest, conn: HTTPConnection, keepAlive: Bool) {
        let body = req.body
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
