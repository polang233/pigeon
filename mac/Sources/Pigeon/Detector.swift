import AppKit
import Darwin

struct AgentStatus: Codable, Equatable, Sendable {
    var installed: Bool
    var running: Bool
    var detail: String
}

struct Agents: Codable, Equatable, Sendable {
    var claude: AgentStatus
    var codex: AgentStatus
    var cursor: AgentStatus
    var deepseek: AgentStatus
    var antigravity: AgentStatus
}

enum Detector {
    static let codexBundleID = "com.openai.codex"
    static let cursorBundleID = "com.todesktop.230313mzl4w4u92"
    static let claudeBundleID = "com.anthropic.claudefordesktop"
    static let deepseekBundleID = "com.deepseek.dsh"
    static let antigravityBundleID = "com.google.antigravity"
    static let hookWindow: TimeInterval = 10 * 60

    @MainActor
    static func runningBundleIDs() -> Set<String> {
        Set(NSWorkspace.shared.runningApplications.compactMap(\.bundleIdentifier))
    }

    static func detect(runningIDs: Set<String>, lastHookAt: Date?, now: Date = Date()) -> Agents {
        Agents(
            claude: detectClaude(runningIDs: runningIDs, lastHookAt: lastHookAt, now: now),
            codex: detectCodex(runningIDs: runningIDs),
            cursor: detectCursor(runningIDs: runningIDs),
            deepseek: detectDeepSeek(runningIDs: runningIDs),
            antigravity: detectAntigravity(runningIDs: runningIDs)
        )
    }

    private static func detectClaude(runningIDs: Set<String>, lastHookAt: Date?, now: Date) -> AgentStatus {
        let cli = which("claude") != nil
        let app = appExists("Claude.app")
        let hookRecent = lastHookAt.map { now.timeIntervalSince($0) <= hookWindow } ?? false
        let appRunning = runningIDs.contains(claudeBundleID)
        let running = hookRecent || appRunning
        let detail: String
        switch (hookRecent, appRunning) {
        case (true, true): detail = "收到过 hook，Claude 桌面应用也开着"
        case (true, false): detail = "收到过 hook"
        case (false, true): detail = "Claude 桌面应用在运行"
        default:
            if cli || app {
                detail = lastHookAt == nil ? "已安装，还没收到 hook" : "已安装，最近 10 分钟没有 hook"
            } else {
                detail = "没找到 claude 命令或 Claude 应用"
            }
        }
        return AgentStatus(installed: cli || app || running, running: running, detail: detail)
    }

    private static var currentHomePath: String {
        if let h = ProcessInfo.processInfo.environment["HOME"], !h.isEmpty { return h }
        return FileManager.default.homeDirectoryForCurrentUser.path
    }

    private static func detectCodex(runningIDs: Set<String>) -> AgentStatus {
        let cli = which("codex") != nil
        let framework = exists("/Applications/ChatGPT.app/Contents/Frameworks/Codex Framework.framework")
            || exists("\(currentHomePath)/Applications/ChatGPT.app/Contents/Frameworks/Codex Framework.framework")
        let codexApp = appExists("Codex.app")
        let appRunning = runningIDs.contains(codexBundleID)
        let cliRunning = !appRunning && processRunning(named: "codex")
        let running = appRunning || cliRunning
        let detail: String
        if appRunning {
            detail = framework ? "ChatGPT 应用内置 Codex" : "Codex 应用在运行"
        } else if cliRunning {
            detail = "codex 命令行在运行"
        } else if framework {
            detail = "ChatGPT 应用内置 Codex，没打开"
        } else if codexApp {
            detail = "Codex 应用已安装，没打开"
        } else if cli {
            detail = "已安装 codex 命令行，没在运行"
        } else {
            detail = "没找到 Codex"
        }
        return AgentStatus(installed: cli || framework || codexApp || running, running: running, detail: detail)
    }

    private static func detectCursor(runningIDs: Set<String>) -> AgentStatus {
        let installed = appExists("Cursor.app") || which("cursor") != nil
        let running = runningIDs.contains(cursorBundleID)
        let detail = running ? "Cursor 正在运行" : (installed ? "已安装，没打开" : "没找到 Cursor")
        return AgentStatus(installed: installed || running, running: running, detail: detail)
    }

    private static func detectDeepSeek(runningIDs: Set<String>) -> AgentStatus {
        let app = appExists("DeepSeek Harness.app")
        let cli = which("dsh") != nil
        let running = runningIDs.contains(deepseekBundleID)
        let detail: String
        if running {
            detail = "DeepSeek Harness 正在运行"
        } else if cli {
            detail = app ? "命令行 dsh 可用，不用开应用" : "已安装 dsh 命令行"
        } else if app {
            detail = "已安装，没打开"
        } else {
            detail = "没找到 DeepSeek Harness"
        }
        return AgentStatus(installed: app || cli || running, running: running, detail: detail)
    }

    private static func detectAntigravity(runningIDs: Set<String>) -> AgentStatus {
        let app = appExists("Antigravity.app")
        let agy = which("agy") != nil
        let running = runningIDs.contains(antigravityBundleID)
        let detail: String
        if running && agy {
            detail = "Antigravity 正在运行（命令行 agy 也可用）"
        } else if running {
            detail = "Antigravity 正在运行"
        } else if agy {
            detail = "命令行 agy 可用，不用开应用"
        } else if app {
            detail = "已安装，没打开：给它派活前要先打开（或装命令行 agy）"
        } else {
            detail = "没找到 Antigravity 或 agy 命令"
        }
        return AgentStatus(installed: app || agy || running, running: running, detail: detail)
    }

    private static func exists(_ path: String) -> Bool {
        FileManager.default.fileExists(atPath: path)
    }

    private static func appExists(_ name: String) -> Bool {
        exists("/Applications/\(name)") || exists("\(currentHomePath)/Applications/\(name)")
    }

    /// GUI 应用拿到的 PATH 很短，这里补上常见安装位置和版本管理器（nvm / fnm / mise / asdf / nodenv）；不启动 login shell。
    static func extraBinDirs(home: String) -> [String] {
        var dirs = [
            "/usr/local/bin", "/opt/homebrew/bin",
            "\(home)/.local/bin", "\(home)/.npm-global/bin",
            "\(home)/.claude/local", "\(home)/.bun/bin", "\(home)/.volta/bin", "\(home)/bin",
            "\(home)/.asdf/shims", "\(home)/.local/share/mise/shims", "\(home)/.nodenv/shims",
            "\(home)/.fnm/current/bin", "\(home)/Library/Application Support/fnm/current/bin",
        ]
        dirs += nvmBinDirs(home: home)
        dirs += fnmBinDirs(base: "\(home)/.local/share/fnm/node-versions")
        dirs += fnmBinDirs(base: "\(home)/Library/Application Support/fnm/node-versions")
        return dirs
    }

    private static func nvmBinDirs(home: String) -> [String] {
        let versionsDir = "\(home)/.nvm/versions/node"
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: versionsDir) else { return [] }
        let sorted = names.filter { $0.hasPrefix("v") }.sorted { compareSemver($0, $1) == .orderedDescending }
        var out: [String] = []
        if let alias = (try? String(contentsOfFile: "\(home)/.nvm/alias/default", encoding: .utf8))?
            .trimmingCharacters(in: .whitespacesAndNewlines), !alias.isEmpty {
            let norm = alias.hasPrefix("v") ? alias : "v\(alias)"
            if let hit = sorted.first(where: { $0 == norm || $0.hasPrefix(norm + ".") }) {
                out.append("\(versionsDir)/\(hit)/bin")
            }
        }
        for v in sorted {
            let bin = "\(versionsDir)/\(v)/bin"
            if !out.contains(bin) { out.append(bin) }
        }
        return out
    }

    private static func fnmBinDirs(base: String) -> [String] {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: base) else { return [] }
        return names.sorted { compareSemver($0, $1) == .orderedDescending }
            .map { "\(base)/\($0)/installation/bin" }
    }

    private static func compareSemver(_ a: String, _ b: String) -> ComparisonResult {
        func parts(_ s: String) -> [Int] {
            s.drop(while: { $0 == "v" || $0 == "V" }).split(separator: ".").map { Int($0) ?? 0 }
        }
        let pa = parts(a), pb = parts(b)
        for i in 0..<max(pa.count, pb.count) {
            let va = i < pa.count ? pa[i] : 0, vb = i < pb.count ? pb[i] : 0
            if va != vb { return va < vb ? .orderedAscending : .orderedDescending }
        }
        return .orderedSame
    }

    static func which(_ name: String) -> String? {
        let home = currentHomePath
        var dirs = (ProcessInfo.processInfo.environment["PATH"] ?? "")
            .split(separator: ":").map(String.init)
        dirs += extraBinDirs(home: home)
        var seen = Set<String>()
        for dir in dirs where !dir.isEmpty && seen.insert(dir).inserted {
            let path = (dir as NSString).appendingPathComponent(name)
            if FileManager.default.isExecutableFile(atPath: path) { return path }
        }
        return nil
    }

    private static let nodeCacheLock = NSLock()
    nonisolated(unsafe) private static var nodeCache: [String: (version: String, zstd: Bool)] = [:]

    static func parseNodeZstdSupport(_ version: String) -> Bool {
        let clean = version.trimmingCharacters(in: .whitespacesAndNewlines)
        let parts = (clean.hasPrefix("v") ? String(clean.dropFirst()) : clean).split(separator: ".").map { Int($0) ?? 0 }
        let major = parts.count > 0 ? parts[0] : 0
        let minor = parts.count > 1 ? parts[1] : 0
        return major > 22 || (major == 22 && minor >= 15)
    }

    static func nodeInfo(at path: String?) -> (ok: Bool, path: String, version: String, zstd: Bool) {
        guard let path, !path.isEmpty else { return (false, "", "", false) }
        nodeCacheLock.lock()
        if let cached = nodeCache[path] {
            nodeCacheLock.unlock()
            return (true, path, cached.version, cached.zstd)
        }
        nodeCacheLock.unlock()
        let r = Runner.run(executable: path, arguments: ["-v"], stdin: nil, environment: ProcessInfo.processInfo.environment, timeout: 3)
        let ver = r.status == 0 ? r.stdoutText.trimmingCharacters(in: .whitespacesAndNewlines) : ""
        let zstd = !ver.isEmpty && parseNodeZstdSupport(ver)
        if !ver.isEmpty {
            nodeCacheLock.lock()
            nodeCache[path] = (ver, zstd)
            nodeCacheLock.unlock()
        }
        return (true, path, ver, zstd)
    }

    static func processRunning(named target: String) -> Bool {
        let count = proc_listallpids(nil, 0)
        guard count > 0 else { return false }
        var pids = [pid_t](repeating: 0, count: Int(count) + 128)
        let n = pids.withUnsafeMutableBufferPointer {
            proc_listallpids($0.baseAddress, Int32($0.count * MemoryLayout<pid_t>.stride))
        }
        guard n > 0 else { return false }
        var buf = [CChar](repeating: 0, count: 256)
        for pid in pids.prefix(Int(n)) where pid > 0 {
            let len = proc_name(pid, &buf, UInt32(buf.count))
            guard len > 0 else { continue }
            let name = buf.withUnsafeBufferPointer { String(cString: $0.baseAddress!) }
            if name == target { return true }
        }
        return false
    }
}
