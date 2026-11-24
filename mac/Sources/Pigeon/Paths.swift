import Foundation

enum Paths {
    /// 源码里的 mac/ 目录（仅开发时有意义）
    static let packageDir: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // Pigeon
        .deletingLastPathComponent()  // Sources
        .deletingLastPathComponent()  // mac

    private static var env: [String: String] { ProcessInfo.processInfo.environment }

    /// 环境变量的值；空串当作没设
    static func envValue(_ name: String) -> String? {
        if let v = env[name], !v.isEmpty { return v }
        return nil
    }

    /// 用户主目录。优先用 HOME（方便用临时目录测试），没有时用系统记录的主目录。
    static let home: URL = {
        if let h = ProcessInfo.processInfo.environment["HOME"], !h.isEmpty {
            return URL(fileURLWithPath: h, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
    }()

    /// 本机服务端口：PIGEON_PORT，没设时 47321
    static let port: UInt16 = {
        if let text = envValue("PIGEON_PORT"), let p = UInt16(text), p > 0 { return p }
        return 47321
    }()

    /// 顺序：PIGEON_WEB_ROOT → .app 内 Resources/web → ../web（相对 mac/）→ 当前目录推断
    static func resolveWebRoot() -> URL {
        if let custom = envValue("PIGEON_WEB_ROOT") {
            return URL(fileURLWithPath: (custom as NSString).expandingTildeInPath).standardizedFileURL
        }
        if Bundle.main.bundleIdentifier != nil,
           let res = Bundle.main.resourceURL?.appendingPathComponent("web"), isDirectory(res) {
            return res.standardizedFileURL
        }
        let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let candidates = [
            packageDir.appendingPathComponent("../web"),
            cwd.appendingPathComponent("../web"),
            cwd.appendingPathComponent("web"),
        ].map { $0.standardizedFileURL }
        return candidates.first(where: isDirectory) ?? candidates[0]
    }

    static let settingsFile: URL = home.appendingPathComponent("Library/Application Support/Pigeon/settings.json")

    /// ~/.pigeon：任务记录、设备和对话的缓存、run 记录。PIGEON_HOME 可以改到别处（测试用）。
    static let dataDir: URL = {
        if let custom = envValue("PIGEON_HOME") {
            return URL(fileURLWithPath: (custom as NSString).expandingTildeInPath, isDirectory: true).standardizedFileURL
        }
        return home.appendingPathComponent(".pigeon", isDirectory: true)
    }()
    static var journalFile: URL { dataDir.appendingPathComponent("journal.json") }
    static var loftsFile: URL { dataDir.appendingPathComponent("lofts.json") }
    /// 插件上次读到的 Antigravity 模型列表（pigeon models 写的）
    static var antigravityModelsFile: URL { dataDir.appendingPathComponent("models/antigravity.json") }

    static var codexHome: URL {
        if let custom = envValue("CODEX_HOME") {
            return URL(fileURLWithPath: (custom as NSString).expandingTildeInPath)
        }
        return home.appendingPathComponent(".codex")
    }

    static var codexModelsCache: URL { codexHome.appendingPathComponent("models_cache.json") }

    static func devIconURL() -> URL? {
        let url = packageDir.appendingPathComponent("Resources/AppIcon.icns")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    static func isDirectory(_ url: URL) -> Bool {
        var isDir: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) && isDir.boolValue
    }
}

extension Paths {
    /// 分派建议：网页推来的规则文字、额度、在线的设备，插件每一轮读它写进提示
    static var dispatchFile: URL { dataDir.appendingPathComponent("dispatch.json") }
}
