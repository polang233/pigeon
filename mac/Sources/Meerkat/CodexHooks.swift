import Foundation

/// 往 Codex 的 ~/.codex/hooks.json 里装 / 卸 Meerkat 的转发 hook。
///
/// - 只增删命令指向 `~/.meerkat/codex-hook.sh` 的那几条，用户自己的 hook 原样保留。
/// - 转发脚本放在 ~/.meerkat 下而不是项目里：项目挪位置也不会让 hook 失效，
///   命令字符串不变，Codex 记下的信任也就一直有效（只需要在 Codex 里信任一次）。
/// - 不写 Codex 的信任记录：信任必须由用户在 Codex 里点。
enum CodexHooks {
    static let events = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse",
                         "PermissionRequest", "Stop", "SubagentStart", "SubagentStop"]

    static var codexHome: URL {
        let env = ProcessInfo.processInfo.environment["CODEX_HOME"].flatMap { $0.isEmpty ? nil : $0 }
        return env.map { URL(fileURLWithPath: ($0 as NSString).expandingTildeInPath) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex")
    }
    static var hooksFile: URL { codexHome.appendingPathComponent("hooks.json") }
    static let script = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".meerkat/codex-hook.sh")

    struct Status: Encodable {
        var installed: Bool
        /// 收到过 Codex 发来的事件，说明用户已经在 Codex 里信任了这些 hook
        var working: Bool
        var detail: String
    }

    /// Codex 的信任记录带内容哈希，没法在这边可靠地算出来，所以用"有没有真的收到事件"判断是否生效。
    static func status(lastEventAt: Date?) -> Status {
        let root = readHooks()
        let installed = events.contains { event in
            (root[event] as? [[String: Any]] ?? []).contains { group in
                (group["hooks"] as? [[String: Any]] ?? []).contains(where: isMine)
            }
        }
        let working = installed && lastEventAt != nil
        let detail = !installed ? "没装"
            : working ? "已生效，收到过 Codex 的事件"
            : "已装好。下次打开 Codex 时会弹出 hook 审查，选“全部信任”一次就行；之后在 Codex 里干活会在这里出现"
        return Status(installed: installed, working: working, detail: detail)
    }

    enum Failure: Error { case io(String) }

    static func install() throws(Failure) {
        try writeScript()
        var root = readHooks()
        let command = "\"\(script.path)\""
        for event in events {
            var groups = strip(root[event])
            groups.append(["hooks": [["type": "command", "command": command]]])
            root[event] = groups
        }
        try writeHooks(root)
    }

    static func uninstall() throws(Failure) {
        var root = readHooks()
        for event in events {
            let groups = strip(root[event])
            root[event] = groups.isEmpty ? nil : groups
        }
        try writeHooks(root)
    }

    // MARK: 文件

    private static func isMine(_ hook: [String: Any]) -> Bool {
        (hook["command"] as? String)?.contains(script.path) == true
    }

    /// 去掉这个事件下属于 Meerkat 的 hook；去掉后空了的分组也删掉
    private static func strip(_ value: Any?) -> [[String: Any]] {
        (value as? [[String: Any]] ?? []).compactMap { group in
            var g = group
            let hooks = (group["hooks"] as? [[String: Any]] ?? []).filter { !isMine($0) }
            if hooks.isEmpty { return nil }
            g["hooks"] = hooks
            return g
        }
    }

    /// hooks.json 可能是 `{"hooks": {...}}`，也可能是空对象
    private static func readHooks() -> [String: Any] {
        guard let data = try? Data(contentsOf: hooksFile),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj["hooks"] as? [String: Any] ?? [:]
    }

    private static func writeHooks(_ hooks: [String: Any]) throws(Failure) {
        var top: [String: Any] = [:]
        if let data = try? Data(contentsOf: hooksFile),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { top = obj }
        top["hooks"] = hooks.isEmpty ? nil : hooks
        do {
            let data = try JSONSerialization.data(withJSONObject: top, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
            try FileManager.default.createDirectory(at: codexHome, withIntermediateDirectories: true)
            try data.write(to: hooksFile, options: .atomic)
        } catch {
            throw .io("写 \(hooksFile.path) 失败：\(error.localizedDescription)")
        }
    }

    /// 转发脚本：把 Codex 的 hook JSON 原样发给 Meerkat，带上包装层设的任务 id。后台发送，不拖慢 Codex。
    private static func writeScript() throws(Failure) {
        let body = """
        #!/bin/sh
        # Meerkat 装的 Codex hook：把事件原样转给 Meerkat 应用。Meerkat 没开时静默失败。
        # 由 Meerkat 设置里的“接收 Codex 自己的事件”开关管理，不要手动改这一行以外的内容。
        body=$(cat)
        (printf '%s' "$body" | curl -s -m 1 -o /dev/null -X POST \\
          -H 'content-type: application/json' -H "x-meerkat-task: ${MEERKAT_TASK_ID:-}" --data-binary @- \\
          "http://127.0.0.1:${MEERKAT_PORT:-47321}/ev/codex" >/dev/null 2>&1 &)
        exit 0

        """
        do {
            try FileManager.default.createDirectory(at: script.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(body.utf8).write(to: script, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: script.path)
        } catch {
            throw .io("写 \(script.path) 失败：\(error.localizedDescription)")
        }
    }
}
