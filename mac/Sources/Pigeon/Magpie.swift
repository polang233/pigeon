import Foundation

/// 代读本机 magpie（网页不能直接读它）。只读，不带钥匙，不改 magpie 的任何东西。
/// 转之前只留白名单里的字段，所有字符串里的邮箱换成 `‹账号›`：账号邮箱不能出现在回应里。
enum Magpie {
    enum Route: String, Sendable {
        case hello, quotas, models

        var upstream: String {
            switch self {
            case .hello: "/api/hello"
            case .quotas: "/v1/magpie/quotas?kept=1"
            case .models: "/v1/models"
            }
        }
    }

    static let cardKeys = ["provider", "name", "kind", "plan", "balance", "error", "readAt", "asOf", "last", "lastServedAt", "from"]
    static let windowKeys = ["name", "used", "remaining", "resetsAt", "display", "text", "lane", "unlimited"]
    static let modelKeys = ["id", "context_window", "reasoning_levels"]
    static let mask = "‹账号›"

    private static let emailRegex = try! NSRegularExpression(pattern: #"[\w.+-]+@[\w-]+(\.[\w-]+)+"#)

    /// 端口：MAGPIE_PORT → `~/.config/magpie/settings.json` 的 port → 3425
    static func port(env: [String: String], home: URL) -> Int {
        if let p = env["MAGPIE_PORT"], let n = Int(p), n > 0 { return n }
        let cfg = env["XDG_CONFIG_HOME"].flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0) }
            ?? home.appendingPathComponent(".config")
        let file = cfg.appendingPathComponent("magpie/settings.json")
        if let data = try? Data(contentsOf: file),
           let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
            if let n = (obj["port"] as? NSNumber)?.intValue, n > 0 { return n }
            if let s = obj["port"] as? String, let n = Int(s), n > 0 { return n }
        }
        return 3425
    }

    static func scrub(_ s: String) -> String {
        emailRegex.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: mask)
    }

    /// 递归把所有字符串（含字典的键）里的邮箱换掉
    static func scrub(_ v: Any) -> Any {
        switch v {
        case let s as String: return scrub(s)
        case let a as [Any]: return a.map { scrub($0) }
        case let d as [String: Any]: // 两个键打码后可能变成同一个，留第一个
            return Dictionary(d.map { (scrub($0.key), scrub($0.value)) }, uniquingKeysWith: { first, _ in first })
        default: return v
        }
    }

    static func slim(_ route: Route, _ raw: Any) -> Any {
        let d = raw as? [String: Any] ?? [:]
        switch route {
        case .hello:
            var out: [String: Any] = [:]
            for k in ["name", "version"] { if let v = d[k] { out[k] = scrub(v) } }
            return out
        case .quotas:
            return ["data": (d["data"] as? [[String: Any]] ?? []).map(slimCard)]
        case .models:
            let models = (d["data"] as? [[String: Any]] ?? []).map { m in
                var out: [String: Any] = [:]
                for k in modelKeys { if let v = m[k] { out[k] = scrub(v) } }
                return out
            }
            return ["data": models]
        }
    }

    private static func slimCard(_ c: [String: Any]) -> [String: Any] {
        var out: [String: Any] = [:]
        for k in cardKeys { if let v = c[k] { out[k] = scrub(v) } }
        out["windows"] = (c["windows"] as? [[String: Any]] ?? []).map { w in
            var o: [String: Any] = [:]
            for k in windowKeys { if let v = w[k] { o[k] = scrub(v) } }
            return o
        }
        return out
    }

    struct Failure: Error { var message: String }

    /// 真正去连 magpie。3 秒超时，不走代理，不带任何认证。
    static let liveFetch: @Sendable (String) async throws -> Data = { path in
        let number = port(env: ProcessInfo.processInfo.environment, home: Paths.home)
        guard let url = URL(string: "http://127.0.0.1:\(number)\(path)") else { throw Failure(message: "地址不对") }
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 3
        cfg.timeoutIntervalForResource = 3
        cfg.connectionProxyDictionary = [:]
        let session = URLSession(configuration: cfg)
        defer { session.finishTasksAndInvalidate() }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.timeoutInterval = 3
        let (data, resp) = try await session.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw Failure(message: "magpie 回了错误") }
        return data
    }
}
