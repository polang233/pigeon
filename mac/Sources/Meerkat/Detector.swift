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
}

enum Detector {
    static let codexBundleID = "com.openai.codex"
    static let cursorBundleID = "com.todesktop.230313mzl4w4u92"
    static let claudeBundleID = "com.anthropic.claudefordesktop"
    static let hookWindow: TimeInterval = 10 * 60

    @MainActor
    static func runningBundleIDs() -> Set<String> {
        Set(NSWorkspace.shared.runningApplications.compactMap(\.bundleIdentifier))
    }

    static func detect(runningIDs: Set<String>, lastHookAt: Date?, now: Date = Date()) -> Agents {
        Agents(
            claude: detectClaude(runningIDs: runningIDs, lastHookAt: lastHookAt, now: now),
            codex: detectCodex(runningIDs: runningIDs),
            cursor: detectCursor(runningIDs: runningIDs)
        )
    }

    private static func detectClaude(runningIDs: Set<String>, lastHookAt: Date?, now: Date) -> AgentStatus {
        let cli = which("claude") != nil
        let app = exists("/Applications/Claude.app")
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

    private static func detectCodex(runningIDs: Set<String>) -> AgentStatus {
        let cli = which("codex") != nil
        let framework = exists("/Applications/ChatGPT.app/Contents/Frameworks/Codex Framework.framework")
        let codexApp = exists("/Applications/Codex.app")
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
        let installed = exists("/Applications/Cursor.app") || which("cursor") != nil
        let running = runningIDs.contains(cursorBundleID)
        let detail = running ? "Cursor 正在运行" : (installed ? "已安装，没打开" : "没找到 Cursor")
        return AgentStatus(installed: installed || running, running: running, detail: detail)
    }

    private static func exists(_ path: String) -> Bool {
        FileManager.default.fileExists(atPath: path)
    }

    /// GUI 应用拿到的 PATH 很短，这里补上常见安装位置；不启动 login shell。
    static func which(_ name: String) -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        var dirs = (ProcessInfo.processInfo.environment["PATH"] ?? "")
            .split(separator: ":").map(String.init)
        dirs += [
            "/usr/local/bin", "/opt/homebrew/bin",
            "\(home)/.local/bin", "\(home)/.npm-global/bin",
            "\(home)/.claude/local", "\(home)/.bun/bin", "\(home)/.volta/bin", "\(home)/bin",
        ]
        var seen = Set<String>()
        for dir in dirs where !dir.isEmpty && seen.insert(dir).inserted {
            let path = (dir as NSString).appendingPathComponent(name)
            if FileManager.default.isExecutableFile(atPath: path) { return path }
        }
        return nil
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
