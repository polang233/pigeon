import Foundation

enum Paths {
    /// 源码里的 mac/ 目录（仅开发时有意义）
    static let packageDir: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // Pigeon
        .deletingLastPathComponent()  // Sources
        .deletingLastPathComponent()  // mac

    private static var env: [String: String] { ProcessInfo.processInfo.environment }

    /// 先看环境变量里的新名字，再看旧名字；空串当作没设
    static func envValue(_ names: String...) -> String? {
        for name in names {
            if let v = env[name], !v.isEmpty { return v }
        }
        return nil
    }

    /// 用户主目录。优先用 HOME（方便用临时目录测试），没有时用系统记录的主目录。
    static let home: URL = {
        if let h = ProcessInfo.processInfo.environment["HOME"], !h.isEmpty {
            return URL(fileURLWithPath: h, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
    }()

    /// 本机服务端口：PIGEON_PORT → MEERKAT_PORT → 47321
    static let port: UInt16 = {
        if let text = envValue("PIGEON_PORT", "MEERKAT_PORT"), let p = UInt16(text), p > 0 { return p }
        return 47321
    }()

    /// 顺序：PIGEON_WEB_ROOT / MEERKAT_WEB_ROOT → .app 内 Resources/web → ../web（相对 mac/）→ 当前目录推断
    static func resolveWebRoot() -> URL {
        if let custom = envValue("PIGEON_WEB_ROOT", "MEERKAT_WEB_ROOT") {
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
    /// Meerkat 时期的设置文件，只读，用来迁移
    static let legacySettingsFile: URL = home.appendingPathComponent("Library/Application Support/Meerkat/settings.json")

    /// ~/.pigeon：飞行记录、鸽舍缓存、run 记录。PIGEON_HOME 可以改到别处（测试用）。
    static let dataDir: URL = {
        if let custom = envValue("PIGEON_HOME") {
            return URL(fileURLWithPath: (custom as NSString).expandingTildeInPath, isDirectory: true).standardizedFileURL
        }
        return home.appendingPathComponent(".pigeon", isDirectory: true)
    }()
    static var journalFile: URL { dataDir.appendingPathComponent("journal.json") }
    static var loftsFile: URL { dataDir.appendingPathComponent("lofts.json") }

    /// 新设置文件不存在而旧的存在时复制一份过来。旧文件不删，旧版应用还能接着用。
    static func migrateSettingsIfNeeded() {
        let fm = FileManager.default
        guard !fm.fileExists(atPath: settingsFile.path), fm.fileExists(atPath: legacySettingsFile.path) else { return }
        do {
            try fm.createDirectory(at: settingsFile.deletingLastPathComponent(), withIntermediateDirectories: true)
            try fm.copyItem(at: legacySettingsFile, to: settingsFile)
        } catch {
            FileHandle.standardError.write(Data("迁移旧设置失败：\(error.localizedDescription)\n".utf8))
        }
    }

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
