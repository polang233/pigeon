import Foundation

enum Paths {
    /// 源码里的 mac/ 目录（仅开发时有意义）
    static let packageDir: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // Meerkat
        .deletingLastPathComponent()  // Sources
        .deletingLastPathComponent()  // mac

    /// 顺序：MEERKAT_WEB_ROOT → .app 内 Resources/web → ../web（相对 mac/）→ 当前目录推断
    static func resolveWebRoot() -> URL {
        let env = ProcessInfo.processInfo.environment
        if let custom = env["MEERKAT_WEB_ROOT"], !custom.isEmpty {
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

    static let settingsFile: URL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Meerkat/settings.json")

    static var codexModelsCache: URL {
        let home = ProcessInfo.processInfo.environment["CODEX_HOME"].flatMap { $0.isEmpty ? nil : $0 }
        let dir = home.map { URL(fileURLWithPath: ($0 as NSString).expandingTildeInPath) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex")
        return dir.appendingPathComponent("models_cache.json")
    }

    static func devIconURL() -> URL? {
        let url = packageDir.appendingPathComponent("Resources/AppIcon.icns")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    static func isDirectory(_ url: URL) -> Bool {
        var isDir: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) && isDir.boolValue
    }
}
