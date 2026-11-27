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
    // 不引 TOML 库，只认表头和键名：表头可以带空格、引号键、行尾注释，多行字符串里的内容不当表头。
    // Pigeon 只管 [mcp_servers.pigeon] 这一张表（和它的子表）。别的写法（[mcp_servers] 下的 pigeon = {…}、
    // 点号键 mcp_servers.pigeon.command = …）认得出来但不动，让用户手动改，免得改坏。

    /// 从 s 开头读一串点号连起来的键名（a."b".'c'），读完停在键名后第一个不是点的字符上。读不出来返回 nil
    private static func readDottedKeys(_ s: inout Substring) -> [String]? {
        func skipWS() { while let c = s.first, c == " " || c == "\t" { s = s.dropFirst() } }
        var keys: [String] = []
        while true {
            skipWS()
            guard let c = s.first else { return nil }
            if c == "\"" || c == "'" {
                s = s.dropFirst()
                var key = ""
                var closed = false
                while let ch = s.first {
                    s = s.dropFirst()
                    if ch == c { closed = true; break }
                    if c == "\"" && ch == "\\" {
                        guard let n = s.first else { return nil }
                        s = s.dropFirst()
                        key.append(n)
                        continue
                    }
                    key.append(ch)
                }
                guard closed else { return nil }
                keys.append(key)
            } else {
                var key = ""
                while let ch = s.first, ch.isASCII, ch.isLetter || ch.isNumber || ch == "_" || ch == "-" {
                    key.append(ch)
                    s = s.dropFirst()
                }
                guard !key.isEmpty else { return nil }
                keys.append(key)
            }
            skipWS()
            guard s.first == "." else { return keys }
            s = s.dropFirst()
        }
    }

    /// 这一行是表头（[a.b] 或 [[a.b]]）就返回各段键名，不是返回 nil
    static func tomlHeaderKeys(_ line: String) -> [String]? {
        var s = Substring(line.trimmingCharacters(in: .whitespaces))
        guard s.hasPrefix("[") else { return nil }
        let double = s.hasPrefix("[[")
        s = s.dropFirst(double ? 2 : 1)
        guard let keys = readDottedKeys(&s), s.first == "]" else { return nil }
        s = s.dropFirst()
        if double {
            guard s.first == "]" else { return nil }
            s = s.dropFirst()
        }
        let rest = s.trimmingCharacters(in: .whitespaces)
        return rest.isEmpty || rest.hasPrefix("#") ? keys : nil
    }

    /// 这一行是“键 = 值”就返回键名各段
    private static func tomlAssignKeys(_ line: String) -> [String]? {
        var s = Substring(line.trimmingCharacters(in: .whitespaces))
        guard let keys = readDottedKeys(&s), s.first == "=" else { return nil }
        return keys
    }

    private struct TomlLine {
        let text: String
        let header: [String]?
        let table: [String]
    }

    /// 逐行扫一遍：是不是表头、属于哪张表。多行字符串（三个引号）里的行不当表头
    private static func codexLines(_ content: String) -> [TomlLine] {
        var out: [TomlLine] = []
        var table: [String] = []
        var inBasic = false, inLiteral = false
        let basicQuote = String(repeating: "\"", count: 3), literalQuote = String(repeating: "'", count: 3)
        for raw in content.split(separator: "\n", omittingEmptySubsequences: false).map(String.init) {
            let wasInString = inBasic || inLiteral
            if !inLiteral && (raw.components(separatedBy: basicQuote).count - 1) % 2 == 1 { inBasic.toggle() }
            if !inBasic && (raw.components(separatedBy: literalQuote).count - 1) % 2 == 1 { inLiteral.toggle() }
            let header = wasInString ? nil : tomlHeaderKeys(raw)
            if let header { table = header }
            out.append(TomlLine(text: raw, header: header, table: table))
        }
        return out
    }

    private static func isPigeonTable(_ keys: [String]) -> Bool {
        keys.count >= 2 && keys[0] == "mcp_servers" && keys[1] == "pigeon"
    }

    /// tables：[mcp_servers.pigeon] 这张表出现几次；other：有没有用别的写法写 pigeon
    static func scanCodex(_ content: String) -> (tables: Int, other: Bool) {
        var tables = 0, other = false
        for l in codexLines(content) {
            if let h = l.header {
                if h == ["mcp_servers", "pigeon"] { tables += 1 }
                continue
            }
            if isPigeonTable(l.table) { continue }
            guard let k = tomlAssignKeys(l.text) else { continue }
            if isPigeonTable(l.table + k) { other = true }
        }
        return (tables, other)
    }

    static func isCodexInstalled(_ content: String) -> Bool {
        let s = scanCodex(content)
        return s.tables > 0 || s.other
    }

    static func stripCodexSection(_ content: String) -> String {
        var out: [String] = []
        var skipping = false
        for l in codexLines(content) {
            if let h = l.header {
                skipping = isPigeonTable(h)
                if skipping { continue }
            }
            if !skipping { out.append(l.text) }
        }
        while out.last?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true {
            out.removeLast()
        }
        if out.isEmpty { return "" }
        return out.joined(separator: "\n") + "\n"
    }

    private static func otherFormError(_ file: URL) -> Failure {
        .io("\(file.path) 里的 pigeon 不是用 [mcp_servers.pigeon] 这张表写的，Pigeon 不自动改，请手动删掉后再开关")
    }

    private static func tomlEscape(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
    }

    private static func installCodex(wrapperPath: String) throws(Failure) {
        let file = Client.codex.configFile
        var old = ""
        if FileManager.default.fileExists(atPath: file.path) {
            do {
                old = try String(contentsOf: file, encoding: .utf8)
            } catch {
                throw .io("读 \(file.path) 失败：\(error.localizedDescription)")
            }
        }
        if scanCodex(old).other { throw otherFormError(file) }
        var next = stripCodexSection(old)
        if !next.isEmpty { next += "\n" }
        next += """
        [mcp_servers.pigeon]
        command = "\(tomlEscape(wrapperPath))"
        args = ["--client", "codex"]

        """
        let after = scanCodex(next)
        guard after.tables == 1, !after.other else {
            throw .io("改写 \(file.path) 的结果不对（pigeon 表出现 \(after.tables) 次），没有写入")
        }
        try safeWrite(Data(next.utf8), to: file)
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
        let scan = scanCodex(old)
        if scan.other { throw otherFormError(file) }
        guard scan.tables > 0 else { return }
        try safeWrite(Data(stripCodexSection(old).utf8), to: file)
    }

    // MARK: 写配置文件
    // 是链接就写到它指向的文件，链接本身留着；写之前把原文件存一份 <文件名>.pigeon-bak（只留最近一份）；
    // 原文件的权限照旧（Codex 的 config.toml 是 0600，原子写会换成默认的 0644）
    static func safeWrite(_ data: Data, to file: URL) throws(Failure) {
        let fm = FileManager.default
        let target = file.resolvingSymlinksInPath()
        do {
            try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            var perms: NSNumber?
            if fm.fileExists(atPath: target.path) {
                perms = (try? fm.attributesOfItem(atPath: target.path))?[.posixPermissions] as? NSNumber
                let bak = target.deletingLastPathComponent().appendingPathComponent(target.lastPathComponent + ".pigeon-bak")
                try? fm.removeItem(at: bak)
                try fm.copyItem(at: target, to: bak)
            }
            try data.write(to: target, options: .atomic)
            if let perms { try fm.setAttributes([.posixPermissions: perms], ofItemAtPath: target.path) }
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

    /// JSON 是整份重写的：内容都在，但键会按字母排、缩进会变（写之前备份过一份）
    private static func writeJSONConfig(_ root: [String: Any], to file: URL) throws(Failure) {
        let data: Data
        do {
            data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        } catch {
            throw .io("写 \(file.path) 失败：\(error.localizedDescription)")
        }
        try safeWrite(data, to: file)
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
