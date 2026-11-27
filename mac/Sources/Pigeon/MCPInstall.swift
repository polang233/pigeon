import Foundation

/// 把统一的 Pigeon MCP 服务（`~/.pigeon/pigeon-mcp`）一键写进 Codex / Antigravity / Cursor 的配置里，或者安全移除。
/// 注意：所有路径都用计算属性读 `Paths.*`，不在静态初始化期提前求值，方便测试用临时 `HOME`。
enum MCPInstall {
    enum Client: String, CaseIterable, Sendable {
        case codex
        case antigravity
        case cursor

        var configFile: URL {
            switch self {
            case .codex: Paths.codexHome.appendingPathComponent("config.toml")
            case .antigravity: Paths.home.appendingPathComponent(".gemini/config/mcp_config.json")
            case .cursor: Paths.home.appendingPathComponent(".cursor/mcp.json")
            }
        }

        var displayName: String {
            switch self {
            case .codex: "Codex"
            case .antigravity: "Antigravity"
            case .cursor: "Cursor"
            }
        }
    }

    enum Failure: Error {
        case io(String)
    }

    static var wrapperURL: URL {
        Paths.dataDir.appendingPathComponent("pigeon-mcp")
    }

    static func scriptURL(scriptsDir: URL?) -> URL? {
        guard let dir = scriptsDir ?? PluginScripts.locate() else { return nil }
        let file = dir.appendingPathComponent("mcp.mjs")
        return FileManager.default.fileExists(atPath: file.path) ? file : nil
    }

    static func refreshWrapperIfPresent(scriptsDir: URL?) {
        let fm = FileManager.default
        guard fm.fileExists(atPath: wrapperURL.path),
              let nodePath = Detector.which("node"),
              let script = scriptURL(scriptsDir: scriptsDir) else { return }
        try? writeWrapper(nodePath: nodePath, scriptPath: script.path)
    }

    static func statusObject(scriptsDir: URL?) -> [String: Any] {
        let nodePath = Detector.which("node") ?? ""
        let script = scriptURL(scriptsDir: scriptsDir)?.path ?? ""
        var clients: [String: Any] = [:]
        for c in Client.allCases {
            let file = c.configFile
            let installed = isInstalled(client: c)
            let detail = installed
                ? "已接入（\(file.path)），重开对话即可主动派活"
                : "未接入：开启后会写入 \(file.path)"
            clients[c.rawValue] = [
                "installed": installed,
                "configPath": file.path,
                "detail": detail,
            ]
        }
        return [
            "wrapper": wrapperURL.path,
            "script": script,
            "nodeOk": !nodePath.isEmpty,
            "clients": clients,
        ]
    }

    static func body(scriptsDir: URL?) -> Data {
        Hub.jsonData(statusObject(scriptsDir: scriptsDir))
    }

    static func setEnabled(clientName: String, enable: Bool, scriptsDir: URL?) -> (status: Int, body: Data) {
        guard let client = Client(rawValue: clientName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) else {
            return (400, Hub.jsonData(["error": "client 只能是 codex、antigravity、cursor"]))
        }
        do {
            if enable {
                try install(client: client, scriptsDir: scriptsDir)
            } else {
                try uninstall(client: client)
            }
        } catch {
            let message = switch error { case let .io(m): m }
            return (400, Hub.jsonData(["error": message]))
        }
        return (200, body(scriptsDir: scriptsDir))
    }

    static func isInstalled(client: Client) -> Bool {
        let file = client.configFile
        guard let data = try? Data(contentsOf: file) else { return false }
        switch client {
        case .codex:
            let text = String(decoding: data, as: UTF8.self)
            return isCodexInstalled(text)
        case .antigravity, .cursor:
            guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let servers = root["mcpServers"] as? [String: Any] else { return false }
            return servers["pigeon"] != nil
        }
    }

    static func install(client: Client, scriptsDir: URL?) throws(Failure) {
        guard let nodePath = Detector.which("node"), !nodePath.isEmpty else {
            throw .io("没找到 node，无法写入 MCP 入口脚本")
        }
        guard let script = scriptURL(scriptsDir: scriptsDir) else {
            throw .io("没找到 mcp.mjs，无法写入 MCP 入口脚本")
        }
        try writeWrapper(nodePath: nodePath, scriptPath: script.path)
        let wp = wrapperURL.path
        switch client {
        case .codex:
            try installCodex(wrapperPath: wp)
        case .antigravity, .cursor:
            try installJSON(client: client, wrapperPath: wp)
        }
    }

    static func uninstall(client: Client) throws(Failure) {
        switch client {
        case .codex:
            try uninstallCodex()
        case .antigravity, .cursor:
            try uninstallJSON(client: client)
        }
    }

    // MARK: Wrapper Script

    private static func shSingleQuote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    static func writeWrapper(nodePath: String, scriptPath: String) throws(Failure) {
        let nodeDir = URL(fileURLWithPath: nodePath).deletingLastPathComponent().path
        let content = """
        #!/bin/sh
        # Pigeon MCP 入口：由 Pigeon 应用自动维护，移动应用位置后会自动更新路径。
        export PATH=\(shSingleQuote(nodeDir))':/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin':"${PATH:-}"
        NODE=\(shSingleQuote(nodePath))
        [ -x "$NODE" ] || NODE="$(command -v node 2>/dev/null || true)"
        SCRIPT=\(shSingleQuote(scriptPath))
        [ -f "$SCRIPT" ] || SCRIPT="/Applications/Pigeon.app/Contents/Resources/plugin/scripts/mcp.mjs"
        exec "$NODE" "$SCRIPT" "$@"

        """
        do {
            try FileManager.default.createDirectory(at: wrapperURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(content.utf8).write(to: wrapperURL, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: wrapperURL.path)
        } catch {
            throw .io("写 \(wrapperURL.path) 失败：\(error.localizedDescription)")
        }
    }

    // MARK: Codex (TOML)

    static func isCodexInstalled(_ content: String) -> Bool {
        for rawLine in content.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line == "[mcp_servers.pigeon]" { return true }
        }
        return false
    }

    static func stripCodexSection(_ content: String) -> String {
        let lines = content.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var out: [String] = []
        var skipping = false
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.hasPrefix("[") && trimmed.hasSuffix("]") {
                if trimmed == "[mcp_servers.pigeon]" || trimmed.hasPrefix("[mcp_servers.pigeon.") {
                    skipping = true
                    continue
                }
                skipping = false
            }
            if !skipping {
                out.append(line)
            }
        }
        while out.last?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true {
            out.removeLast()
        }
        if out.isEmpty { return "" }
        return out.joined(separator: "\n") + "\n"
    }

    private static func tomlEscape(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
    }

    private static func installCodex(wrapperPath: String) throws(Failure) {
        let file = Client.codex.configFile
        let old = (try? String(contentsOf: file, encoding: .utf8)) ?? ""
        var next = stripCodexSection(old)
        if !next.isEmpty { next += "\n" }
        next += """
        [mcp_servers.pigeon]
        command = "\(tomlEscape(wrapperPath))"
        args = ["--client", "codex"]

        """
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(next.utf8).write(to: file, options: .atomic)
        } catch {
            throw .io("写 \(file.path) 失败：\(error.localizedDescription)")
        }
    }

    private static func uninstallCodex() throws(Failure) {
        let file = Client.codex.configFile
        guard FileManager.default.fileExists(atPath: file.path) else { return }
        let old: String
        do {
            old = try String(contentsOf: file, encoding: .utf8)
        } catch {
            throw .io("读 \(file.path) 失败：\(error.localizedDescription)")
        }
        guard isCodexInstalled(old) else { return }
        let next = stripCodexSection(old)
        do {
            try Data(next.utf8).write(to: file, options: .atomic)
        } catch {
            throw .io("写 \(file.path) 失败：\(error.localizedDescription)")
        }
    }

    // MARK: Antigravity / Cursor (JSON)

    private static func readJSONConfig(at file: URL) throws(Failure) -> [String: Any] {
        guard FileManager.default.fileExists(atPath: file.path) else { return [:] }
        let data: Data
        do {
            data = try Data(contentsOf: file)
        } catch {
            throw .io("读 \(file.path) 失败：\(error.localizedDescription)")
        }
        let trimmed = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return [:] }
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw .io("\(file.path) 不是有效的 JSON 对象，为避免覆盖原有配置已取消操作")
        }
        return obj
    }

    private static func writeJSONConfig(_ root: [String: Any], to file: URL) throws(Failure) {
        do {
            let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: file, options: .atomic)
        } catch {
            throw .io("写 \(file.path) 失败：\(error.localizedDescription)")
        }
    }

    private static func installJSON(client: Client, wrapperPath: String) throws(Failure) {
        let file = client.configFile
        var root = try readJSONConfig(at: file)
        var servers: [String: Any] = [:]
        if let existing = root["mcpServers"] {
            guard let dict = existing as? [String: Any] else {
                throw .io("\(file.path) 中的 mcpServers 不是对象，为避免覆盖已取消操作")
            }
            servers = dict
        }
        servers["pigeon"] = [
            "command": wrapperPath,
            "args": ["--client", client.rawValue],
        ]
        root["mcpServers"] = servers
        try writeJSONConfig(root, to: file)
    }

    private static func uninstallJSON(client: Client) throws(Failure) {
        let file = client.configFile
        guard FileManager.default.fileExists(atPath: file.path) else { return }
        var root = try readJSONConfig(at: file)
        guard let existing = root["mcpServers"] else { return }
        guard var servers = existing as? [String: Any] else {
            throw .io("\(file.path) 中的 mcpServers 不是对象，为避免覆盖已取消操作")
        }
        guard servers["pigeon"] != nil else { return }
        servers.removeValue(forKey: "pigeon")
        root["mcpServers"] = servers
        try writeJSONConfig(root, to: file)
    }
}
