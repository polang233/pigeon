import Foundation

/// 找 `pigeon.mjs` 所在的脚本目录。
enum PluginScripts {
    /// 顺序：PIGEON_PLUGIN_ROOT（下面的 scripts/）→ 应用包里的 Resources/plugin/scripts → 仓库里的 plugin/scripts
    static func locate(env: [String: String], resourceURL: URL?, packageDir: URL,
                       fileExists: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) }) -> URL? {
        var candidates: [URL] = []
        if let root = env["PIGEON_PLUGIN_ROOT"], !root.isEmpty {
            let base = URL(fileURLWithPath: (root as NSString).expandingTildeInPath, isDirectory: true)
            candidates.append(base.appendingPathComponent("scripts", isDirectory: true))
            candidates.append(base)
        }
        if let resourceURL { candidates.append(resourceURL.appendingPathComponent("plugin/scripts", isDirectory: true)) }
        candidates.append(packageDir.appendingPathComponent("../plugin/scripts", isDirectory: true).standardizedFileURL)
        return candidates.first { fileExists($0.appendingPathComponent("pigeon.mjs").path) }
    }

    static func locate() -> URL? {
        locate(env: ProcessInfo.processInfo.environment,
               resourceURL: Bundle.main.bundleIdentifier != nil ? Bundle.main.resourceURL : nil,
               packageDir: Paths.packageDir)
    }
}

/// 跑一个子进程并等它结束。阻塞，只能在 hub.queue 以外的线程上调用。
enum Runner {
    struct Result: Sendable {
        var status: Int32
        var stdout: Data
        var stderr: Data
        var timedOut: Bool

        var stdoutText: String { String(decoding: stdout, as: UTF8.self) }
        var stderrText: String { String(decoding: stderr, as: UTF8.self) }
    }

    private final class Collector: @unchecked Sendable {
        private let lock = NSLock()
        private var data = Data()
        func append(_ d: Data) { lock.lock(); data.append(d); lock.unlock() }
        var value: Data { lock.lock(); defer { lock.unlock() }; return data }
    }

    private static let ignoreSIGPIPE: Void = { signal(SIGPIPE, SIG_IGN) }()

    static func run(executable: String, arguments: [String], stdin: Data?, environment: [String: String],
                    cwd: URL? = nil, timeout: TimeInterval) -> Result {
        _ = ignoreSIGPIPE
        let p = Process()
        p.executableURL = URL(fileURLWithPath: executable)
        p.arguments = arguments
        p.environment = environment
        if let cwd { p.currentDirectoryURL = cwd }
        let out = Pipe(), err = Pipe(), inp = Pipe()
        p.standardOutput = out
        p.standardError = err
        p.standardInput = inp
        let outBuf = Collector(), errBuf = Collector()
        out.fileHandleForReading.readabilityHandler = { h in outBuf.append(h.availableData) }
        err.fileHandleForReading.readabilityHandler = { h in errBuf.append(h.availableData) }
        let done = DispatchSemaphore(value: 0)
        p.terminationHandler = { _ in done.signal() }
        do {
            try p.run()
        } catch {
            out.fileHandleForReading.readabilityHandler = nil
            err.fileHandleForReading.readabilityHandler = nil
            return Result(status: -1, stdout: Data(), stderr: Data("无法启动 \(executable)：\(error.localizedDescription)".utf8), timedOut: false)
        }
        if let stdin, !stdin.isEmpty { try? inp.fileHandleForWriting.write(contentsOf: stdin) }
        try? inp.fileHandleForWriting.close()
        var timedOut = false
        if done.wait(timeout: .now() + timeout) == .timedOut {
            timedOut = true
            p.terminate()
            if done.wait(timeout: .now() + 3) == .timedOut { kill(p.processIdentifier, SIGKILL); _ = done.wait(timeout: .now() + 2) }
        }
        // 进程结束后管道里可能还有没读完的，等读到头
        out.fileHandleForReading.readabilityHandler = nil
        err.fileHandleForReading.readabilityHandler = nil
        outBuf.append((try? out.fileHandleForReading.readToEnd()) ?? Data())
        errBuf.append((try? err.fileHandleForReading.readToEnd()) ?? Data())
        return Result(status: p.terminationStatus, stdout: outBuf.value, stderr: errBuf.value, timedOut: timedOut)
    }
}

/// 应用自己派活：用自带的 `pigeon.mjs` 去发，发件人是你。
extension Hub {
    static let sendTimeout: TimeInterval = 300
    static let refreshTimeout: TimeInterval = 180
    static let maxRemembered = 200
    /// 能收活的 agent（线上的名字）
    static let receivers: Set<String> = ["codex", "deepseek", "antigravity"]

    /// 子进程的环境：去掉 CLAUDE_CODE_SESSION_ID（这样发件人是 you），端口和数据目录照本应用的，补上 GUI 应用缺的 PATH
    func childEnvironment(nodePath: String) -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        env["CLAUDE_CODE_SESSION_ID"] = nil
        env["PIGEON_PORT"] = String(port)
        env["PIGEON_HOME"] = Paths.dataDir.path
        let nodeDir = (nodePath as NSString).deletingLastPathComponent
        let extra = [nodeDir, "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin",
                     Paths.home.appendingPathComponent(".local/bin").path,
                     Paths.home.appendingPathComponent(".npm-global/bin").path]
        var seen = Set<String>()
        env["PATH"] = ((env["PATH"] ?? "").split(separator: ":").map(String.init) + extra)
            .filter { !$0.isEmpty && seen.insert($0).inserted }.joined(separator: ":")
        return env
    }

    private func scriptsDir() -> URL? { pluginScriptsOverride ?? PluginScripts.locate() }

    private func bodyObject(_ body: Data) -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
    }

    private func fail(_ status: Int, _ message: String) -> (Int, Data) {
        (status, Self.jsonData(["ok": false, "error": message]))
    }

    /// 在 queue 上调用。`completion` 在 queue 上执行，参数是状态码和回应正文。
    func performSend(_ body: Data, completion: @escaping @Sendable (Int, Data) -> Void) {
        guard var req = bodyObject(body) else { return completion(400, fail(400, "请求体必须是 JSON 对象").1) }
        let retryOf = req["retry_of"] as? String ?? ""
        if !retryOf.isEmpty {
            // 重发：原文只在内存里，界面不会再传
            guard let old = sentBodies[retryOf], let saved = bodyObject(old) else {
                return completion(400, fail(400, "找不到这条消息的原文（应用重启过，或不是在这里发的），不能重发").1)
            }
            for (k, v) in saved where (req[k] == nil || (req[k] as? String)?.isEmpty == true) { req[k] = v }
        }
        let to = req["to"] as? [String: Any] ?? [:]
        let agent = to["agent"] as? String ?? ""
        let loftRaw = to["loft"] as? String ?? ""
        let loft = loftRaw.isEmpty ? "local" : loftRaw
        let session = to["session"] as? String ?? ""
        let text = req["text"] as? String ?? ""
        guard !agent.isEmpty else { return completion(400, fail(400, "没有写发给哪个 agent").1) }
        guard Self.receivers.contains(agent) else {
            return completion(501, fail(501, "现在只能给 Codex、DeepSeek Harness、Antigravity 派活，\(Self.agentLabel(agent)) 还没接上").1)
        }
        guard agent == "codex" || loft == "local" else {
            return completion(400, fail(400, "\(Self.agentLabel(agent)) 只能在这台 Mac 上派活").1)
        }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return completion(400, fail(400, "消息是空的").1) }
        guard let node = Detector.which("node") else { return completion(500, fail(500, "没找到 node，发不出去").1) }
        guard let scripts = scriptsDir() else { return completion(500, fail(500, "没找到 pigeon.mjs，应用里没带上插件脚本").1) }

        var args = [scripts.appendingPathComponent("pigeon.mjs").path]
        if session.isEmpty {
            var title = (req["title"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if title.isEmpty { title = String((text.split(whereSeparator: \.isNewline).first ?? "").prefix(30)) }
            // 值一律写成 --名字=值：值以 - 开头时（标题取自消息第一行，可能是“--verbose 不管用”）不会被命令行当成另一个参数
            args += ["new", "--loft=\(loft)", "--title=\(title)"]
            if agent != "codex" { args += ["--agent=\(agent)"] }
            if let p = req["project"] as? String, !p.isEmpty { args += ["--project=\(p)"] }
            if loft == "local", let cwd = req["cwd"] as? String, !cwd.isEmpty { args += ["--cwd=\(cwd)"] }
            if let m = req["model"] as? String, !m.isEmpty { args += ["--model=\(m)"] }
            if let e = req["effort"] as? String, !e.isEmpty { args += ["--effort=\(e)"] }
        } else {
            args += ["send", "--to=\(session)@\(loft)"]
        }
        if let reason = (req["why"] as? [String: Any])?["reason"] as? String, !reason.isEmpty { args += ["--reason=\(reason)"] }
        if !retryOf.isEmpty { args += ["--retry-of=\(retryOf)"] }
        args += ["--stdin", "--json"]

        // 留给重发用的：去掉 retry_of，正文原样留在内存里
        var remembered = req
        remembered["retry_of"] = nil
        let rememberData = Self.jsonData(remembered)
        // 子进程去问 /api/ask 时带回这个号，见 sendAsked
        let sendID = UUID().uuidString
        let env = childEnvironment(nodePath: node).merging(["PIGEON_SEND_ID": sendID]) { _, new in new }
        let arguments = args
        pendingSends[sendID] = (completion, rememberData)
        let stdin = Data(text.utf8)
        let queue = self.queue
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let r = Runner.run(executable: node, arguments: arguments, stdin: stdin, environment: env,
                               cwd: Paths.home, timeout: Self.sendTimeout)
            let (status, out) = Self.interpretSend(r)
            let band = (try? JSONSerialization.jsonObject(with: out) as? [String: Any])?["band"] as? String ?? ""
            queue.async { [weak self] in
                guard let self else { return }
                if !band.isEmpty { self.remember(band: band, body: rememberData) }
                // 已经在排进等你的一队时回过话了，就不再回第二次；结果看任务的状态
                if let pending = self.pendingSends.removeValue(forKey: sendID) { pending.completion(status, out) }
            }
        }
    }

    /// 应用自己派的活走到了“等你确认”：先回界面，不用等你点完。在 queue 上调用。
    func sendAsked(sendID: String, band: String) {
        guard let pending = pendingSends.removeValue(forKey: sendID) else { return }
        if !band.isEmpty { remember(band: band, body: pending.remembered) }
        pending.completion(200, Self.jsonData(["ok": true, "band": band, "state": "asking"]))
    }

    /// 命令行 `--json` 的最后一行 JSON → 回应。没有 JSON 时用退出码和错误输出说明。
    static func interpretSend(_ r: Runner.Result) -> (Int, Data) {
        if r.timedOut { return (200, jsonData(["ok": false, "error": "等了很久没有结果，已经放弃"])) }
        let lines = r.stdoutText.split(whereSeparator: \.isNewline).reversed()
        for line in lines {
            guard let obj = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any] else { continue }
            var out: [String: Any] = [:]
            for k in ["band", "state", "reason", "error", "paused"] { if let v = obj[k] { out[k] = v } }
            out["ok"] = (obj["ok"] as? Bool) ?? (r.status == 0)
            return (200, jsonData(out))
        }
        let err = r.stderrText.split(whereSeparator: \.isNewline).last.map { String($0.prefix(200)) } ?? ""
        return (200, jsonData(["ok": false, "error": err.isEmpty ? "发送失败（退出码 \(r.status)）" : err]))
    }

    private func remember(band: String, body: Data) {
        if sentBodies[band] == nil { sentOrder.append(band) }
        sentBodies[band] = body
        while sentOrder.count > Self.maxRemembered { sentBodies[sentOrder.removeFirst()] = nil }
    }

    static func agentLabel(_ agent: String) -> String {
        switch agent {
        case "claude": "Claude Code"
        case "cursor": "Cursor"
        case "deepseek": "DeepSeek Harness"
        case "antigravity": "Antigravity"
        case "codex": "Codex"
        default: agent
        }
    }

    // MARK: 跳回对话

    private static let safeID = try! NSRegularExpression(pattern: #"^[A-Za-z0-9_.:\-]+$"#)

    /// 按 loft/agent/session 算出 `open` 命令的参数。不支持的返回错误说明。
    static func openArguments(agent: String, session: String) -> (args: [String]?, error: String) {
        if !session.isEmpty, safeID.firstMatch(in: session, range: NSRange(session.startIndex..., in: session)) == nil {
            return (nil, "对话 id 里有不能用的字符")
        }
        switch agent {
        case "codex":
            return (session.isEmpty ? ["-b", Detector.codexBundleID] : ["codex://threads/\(session)"], "")
        case "claude": return (["-b", Detector.claudeBundleID], "")
        case "cursor": return (["-b", Detector.cursorBundleID], "")
        case "deepseek": return (["-b", Detector.deepseekBundleID], "")
        case "antigravity": return (["-b", Detector.antigravityBundleID], "")
        default: return (nil, "不知道怎么打开 \(agent)")
        }
    }

    /// Antigravity 命令行 agy 的对话不显示在 Antigravity 应用里（官方还没打通，见 google-antigravity/antigravity-cli#1773），
    /// 所以在终端里用 `agy -r <id>` 接着打开：写一个 .command 小脚本，交给“终端”运行。cwd 是那个对话原来的目录（agy 的历史按目录分）
    static func agyTerminalScript(session: String, cwd: String, agy: String) -> String? {
        guard !session.isEmpty, safeID.firstMatch(in: session, range: NSRange(session.startIndex..., in: session)) != nil else { return nil }
        let q = { (s: String) in "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }
        let dir = cwd.isEmpty ? "" : "cd \(q(cwd)) 2>/dev/null || "
        return "#!/bin/zsh\n\(dir)cd ~\nexec \(q(agy)) -r \(session)\n"
    }
    static func agyPath() -> String? {
        let local = Paths.home.appendingPathComponent(".local/bin/agy").path
        return FileManager.default.isExecutableFile(atPath: local) ? local : Detector.which("agy")
    }

    func performOpen(_ body: Data, completion: @escaping @Sendable (Int, Data) -> Void) {
        guard let req = bodyObject(body) else { return completion(400, fail(400, "请求体必须是 JSON 对象").1) }
        var (args, error) = Self.openArguments(agent: req["agent"] as? String ?? "", session: req["session"] as? String ?? "")
        if req["agent"] as? String == "antigravity", req["via"] as? String == "cli" {
            guard let agy = Self.agyPath() else { return completion(400, fail(400, "没找到 Antigravity 的命令行 agy").1) }
            guard let script = Self.agyTerminalScript(session: req["session"] as? String ?? "", cwd: req["cwd"] as? String ?? "", agy: agy) else { return completion(400, fail(400, "对话 id 里有不能用的字符").1) }
            let dir = Paths.dataDir.appendingPathComponent("tmp", isDirectory: true), file = dir.appendingPathComponent("agy-resume.command")
            do {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                try script.write(to: file, atomically: true, encoding: .utf8)
                try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: file.path)
            } catch { return completion(500, fail(500, "没能写出打开用的小脚本").1) }
            args = ["-a", "Terminal", file.path]; error = ""
        }
        guard let args else { return completion(400, fail(400, error).1) }
        let opener = self.opener
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let (ok, message) = opener(args)
            let out = ok ? Self.jsonData(["ok": true]) : Self.jsonData(["ok": false, "error": message])
            self?.queue.async { completion(200, out) }
        }
    }

    static let defaultOpener: @Sendable ([String]) -> (Bool, String) = { args in
        let r = Runner.run(executable: "/usr/bin/open", arguments: args, stdin: nil,
                           environment: ProcessInfo.processInfo.environment, timeout: 10)
        if r.status == 0 { return (true, "") }
        let line = r.stderrText.split(whereSeparator: \.isNewline).first.map { String($0.prefix(160)) } ?? ""
        return (false, line.isEmpty ? "没能打开" : "没能打开：\(line)")
    }

    // MARK: 别家的模型列表

    /// GET /api/agents/models：`pigeon models --json`（现在只有 Antigravity：读它本机服务，没开时是上次存的）
    func performAgentModels(completion: @escaping @Sendable (Int, Data) -> Void) {
        guard let node = Detector.which("node") else { return completion(500, fail(500, "没找到 node").1) }
        guard let scripts = scriptsDir() else { return completion(500, fail(500, "没找到 pigeon.mjs").1) }
        let env = childEnvironment(nodePath: node), queue = self.queue
        let full = [scripts.appendingPathComponent("pigeon.mjs").path, "models", "--json"]
        DispatchQueue.global(qos: .userInitiated).async {
            let r = Runner.run(executable: node, arguments: full, stdin: nil, environment: env, cwd: Paths.home, timeout: 30)
            let (status, out) = Self.interpretRelay(r)
            queue.async { completion(status, out) }
        }
    }

    // MARK: 一张纸条的全文

    static let bandPattern = try! NSRegularExpression(pattern: #"^[a-z]-[0-9a-f]{6,16}$"#)
    /// GET /api/notes/<编号>：`pigeon read <编号> --json`，发出去的正文和完整回信（原样的 Markdown），任务详情和频道里看全文用
    func performNoteFull(band: String, completion: @escaping @Sendable (Int, Data) -> Void) {
        guard Self.bandPattern.firstMatch(in: band, range: NSRange(band.startIndex..., in: band)) != nil else { return completion(400, fail(400, "编号不对").1) }
        guard let node = Detector.which("node") else { return completion(500, fail(500, "没找到 node").1) }
        guard let scripts = scriptsDir() else { return completion(500, fail(500, "没找到 pigeon.mjs").1) }
        let env = childEnvironment(nodePath: node), queue = self.queue
        let full = [scripts.appendingPathComponent("pigeon.mjs").path, "read", band, "--json"]
        DispatchQueue.global(qos: .userInitiated).async {
            let r = Runner.run(executable: node, arguments: full, stdin: nil, environment: env, cwd: Paths.home, timeout: 30)
            let (status, out) = Self.interpretRelay(r)
            queue.async { completion(status == 409 ? 404 : status, out) }
        }
    }

    // MARK: 中继站

    static let relayTimeout: TimeInterval = 60
    static let relayActions: Set<String> = ["use", "archive", "unarchive", "delete"]

    /// POST /api/relay 的请求体 → `pigeon relay …` 的参数。use 不带 id 而带 host：那台不再单独用，跟着共用的
    static func relayArguments(_ req: [String: Any]) -> (args: [String]?, error: String) {
        let action = req["action"] as? String ?? ""
        guard relayActions.contains(action) else { return (nil, "action 只能是 use、archive、unarchive、delete") }
        let id = (req["id"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let host = (req["host"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if action == "use" {
            if id.isEmpty && host.isEmpty { return (nil, "要给对话 id") }
            return (["relay", "use", id.isEmpty ? "default" : id] + (host.isEmpty ? [] : ["--host", host]) + ["--json"], "")
        }
        guard !id.isEmpty else { return (nil, "要给对话 id") }
        return (["relay", action, id, "--json"], "")
    }

    /// 命令行最后一行是 JSON：退出码 0 原样回 200；用法错误 400；别的失败 409，正文里有 error
    static func interpretRelay(_ r: Runner.Result) -> (Int, Data) {
        if r.timedOut { return (504, jsonData(["ok": false, "error": "等太久，已经放弃"])) }
        let last = r.stdoutText.split(whereSeparator: \.isNewline).last.map(String.init) ?? ""
        if let d = last.data(using: .utf8), (try? JSONSerialization.jsonObject(with: d)) is [String: Any] {
            return (r.status == 0 ? 200 : r.status == 64 ? 400 : 409, d)
        }
        let said = r.stderrText.split(whereSeparator: \.isNewline).last.map { String($0.prefix(200)) } ?? ""
        return (500, jsonData(["ok": false, "error": said.isEmpty ? "中继站命令失败（退出码 \(r.status)）" : said]))
    }

    /// GET（body 为 nil）：`pigeon relay list --json`；POST：换中继站、归档、恢复、删除用过的
    func performRelay(_ body: Data?, completion: @escaping @Sendable (Int, Data) -> Void) {
        var args = ["relay", "list", "--json"]
        if let body {
            guard let req = bodyObject(body) else { return completion(400, fail(400, "请求体必须是 JSON 对象").1) }
            let (a, error) = Self.relayArguments(req)
            guard let a else { return completion(400, fail(400, error).1) }
            args = a
        }
        guard let node = Detector.which("node") else { return completion(500, fail(500, "没找到 node").1) }
        guard let scripts = scriptsDir() else { return completion(500, fail(500, "没找到 pigeon.mjs").1) }
        let env = childEnvironment(nodePath: node), queue = self.queue, changes = body != nil
        let full = [scripts.appendingPathComponent("pigeon.mjs").path] + args
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let r = Runner.run(executable: node, arguments: full, stdin: nil, environment: env,
                               cwd: Paths.home, timeout: Self.relayTimeout)
            let (status, out) = Self.interpretRelay(r)
            queue.async {
                completion(status, out)
                // 换了中继站，对话列表里哪条标成中继站跟着变
                if changes && status == 200 { self?.scheduleLoftsPush() }
            }
        }
    }

    // MARK: 重读远程

    /// `pigeon lofts --refresh`。同时来了几次就合并成一次。
    func performRefresh(completion: @escaping @Sendable (Int, Data) -> Void) {
        refreshWaiters.append(completion)
        guard refreshWaiters.count == 1 else { return }
        guard let node = Detector.which("node") else { return finishRefresh(500, fail(500, "没找到 node").1) }
        guard let scripts = scriptsDir() else { return finishRefresh(500, fail(500, "没找到 pigeon.mjs").1) }
        let args = [scripts.appendingPathComponent("pigeon.mjs").path, "lofts", "--refresh"]
        let env = childEnvironment(nodePath: node)
        let queue = self.queue
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let r = Runner.run(executable: node, arguments: args, stdin: nil, environment: env,
                               cwd: Paths.home, timeout: Self.refreshTimeout)
            let out: Data
            if r.status == 0 && !r.timedOut {
                out = Self.jsonData(["ok": true])
            } else {
                // 命令行把原因写在错误输出或标准输出里（比如还没设中继站），哪边有就用哪边的最后一行
                let said = r.stderrText.split(whereSeparator: \.isNewline).last ?? r.stdoutText.split(whereSeparator: \.isNewline).last
                let err = r.timedOut ? "等太久，已经放弃" : (said.map { String($0.prefix(200)) } ?? "重读失败")
                out = Self.jsonData(["ok": false, "error": err.isEmpty ? "重读失败" : err])
            }
            queue.async { [weak self] in
                self?.finishRefresh(200, out)
                self?.scheduleLoftsPush()
            }
        }
    }

    private func finishRefresh(_ status: Int, _ body: Data) {
        let waiters = refreshWaiters
        refreshWaiters = []
        for w in waiters { w(status, body) }
    }

    // MARK: 重读本机对话

    /// `pigeon lofts`（不带 `--refresh`，只扫本机，零 token 成本）。同时来了几次就合并成一次。
    func performLocalLoftsRefresh(completion: (@Sendable (Int, Data) -> Void)? = nil) {
        queue.async { [weak self] in
            guard let self else { completion?(500, Self.jsonData(["ok": false, "error": "应用正在退出"])); return }
            if let completion { self.localRefreshWaiters.append(completion) }
            guard !self.localRefreshing else { return }
            self.localRefreshing = true
            guard let node = Detector.which("node") else {
                self.finishLocalRefresh(500, self.fail(500, "没找到 node").1)
                return
            }
            guard let scripts = self.scriptsDir() else {
                self.finishLocalRefresh(500, self.fail(500, "没找到 pigeon.mjs").1)
                return
            }
            let args = [scripts.appendingPathComponent("pigeon.mjs").path, "lofts"]
            let env = self.childEnvironment(nodePath: node)
            let queue = self.queue
            DispatchQueue.global(qos: .utility).async { [weak self] in
                let r = Runner.run(executable: node, arguments: args, stdin: nil, environment: env,
                                   cwd: Paths.home, timeout: 20)
                let out: Data
                if r.status == 0 && !r.timedOut {
                    out = Self.jsonData(["ok": true])
                } else {
                    let said = r.stderrText.split(whereSeparator: \.isNewline).last ?? r.stdoutText.split(whereSeparator: \.isNewline).last
                    let err = r.timedOut ? "扫描本机对话超时" : (said.map { String($0.prefix(200)) } ?? "扫描失败")
                    out = Self.jsonData(["ok": false, "error": err.isEmpty ? "扫描失败" : err])
                }
                queue.async { [weak self] in
                    self?.finishLocalRefresh(200, out)
                    self?.scheduleLoftsPush()
                }
            }
        }
    }

    private func finishLocalRefresh(_ status: Int, _ body: Data) {
        localRefreshing = false
        let waiters = localRefreshWaiters
        localRefreshWaiters = []
        for w in waiters { w(status, body) }
    }
}
