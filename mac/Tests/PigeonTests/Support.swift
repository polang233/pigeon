import Foundation
@testable import Pigeon

/// 所有测试共用一个临时的 HOME / PIGEON_HOME，绝不碰真的 ~/.pigeon 和应用设置。
/// 必须在第一次访问 Paths 之前设好环境变量，所以每个会碰文件的测试开头都调 `TestEnv.prepare()`。
enum TestEnv {
    static let root: URL = {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("pigeon-test-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        setenv("HOME", dir.path, 1)
        setenv("PIGEON_HOME", dir.appendingPathComponent(".pigeon").path, 1)
        setenv("CODEX_HOME", dir.appendingPathComponent(".codex").path, 1)
        setenv("PIGEON_PORT", "47419", 1)
        unsetenv("CLAUDE_CODE_SESSION_ID")
        return dir
    }()

    /// 清掉设置、飞行记录等，返回临时目录
    @discardableResult
    static func prepare() -> URL {
        _ = root
        precondition(Paths.home.path == root.path, "测试没有用上临时 HOME")
        let fm = FileManager.default
        try? fm.removeItem(at: Paths.dataDir)
        try? fm.removeItem(at: Paths.settingsFile)
        return root
    }
}

func json(_ data: Data) -> [String: Any] {
    (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
}

func jsonBytes(_ obj: Any) -> Data {
    (try? JSONSerialization.data(withJSONObject: obj)) ?? Data()
}

/// 极简 HTTP 客户端：不走代理，不复用连接
struct Client: Sendable {
    let port: UInt16
    let session: URLSession

    init(port: UInt16) {
        self.port = port
        let cfg = URLSessionConfiguration.ephemeral
        cfg.connectionProxyDictionary = [:]
        cfg.timeoutIntervalForRequest = 30
        session = URLSession(configuration: cfg)
    }

    func request(_ method: String, _ path: String, body: Data? = nil) async throws -> (Int, Data) {
        var r = URLRequest(url: URL(string: "http://127.0.0.1:\(port)\(path)")!)
        r.httpMethod = method
        if let body { r.httpBody = body; r.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, resp) = try await session.data(for: r)
        return ((resp as! HTTPURLResponse).statusCode, data)
    }

    func get(_ path: String) async throws -> (Int, Data) { try await request("GET", path) }
    func post(_ path: String, _ obj: Any) async throws -> (Int, Data) { try await request("POST", path, body: jsonBytes(obj)) }

    /// 启动一个 Hub 并等它就绪
    static func startHub(port: UInt16) async throws -> Hub {
        let hub = Hub(webRoot: TestEnv.root, port: port)
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            hub.start(onReady: { c.resume() }, onFailure: { c.resume(throwing: NSError(domain: "hub", code: 1, userInfo: [NSLocalizedDescriptionKey: $0])) })
        }
        return hub
    }

    func waitUntil(timeout: Double = 3, _ cond: () async throws -> Bool) async throws -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if try await cond() { return true }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        return false
    }
}
