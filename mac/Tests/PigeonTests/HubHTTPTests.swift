import Foundation
import Testing
@testable import Pigeon

/// 用真的 Hub 和 127.0.0.1:47411–47419 测接口。同一套件里串行跑，共用临时 HOME。
@Suite(.serialized) struct HubHTTPTests {
    func queueItems(_ c: Client) async throws -> [[String: Any]] {
        json(try await c.get("/api/queue").1)["items"] as? [[String: Any]] ?? []
    }

    @Test func askHoldsThenResolves() async throws {
        TestEnv.prepare()
        let hub = try await Client.startHub(port: 47411)
        defer { hub.stop() }
        let c = Client(port: 47411)
        let body: [String: Any] = ["kind": "cross", "band": "b-aaa", "from": ["agent": "claude"], "to": ["agent": "codex", "loft": "remote-x"],
                                   "preview": "构建", "text": "原文内容", "secrets": ["npm token"]]
        let bodyData = jsonBytes(body)
        let first = Task { try await c.request("POST", "/api/ask", body: bodyData) }
        #expect(try await c.waitUntil { try await queueItems(c).count == 1 })
        // 同一个 band 再问，接着等原来那条
        let second = Task { try await c.request("POST", "/api/ask", body: bodyData) }
        try await Task.sleep(nanoseconds: 200_000_000)
        let items = try await queueItems(c)
        #expect(items.count == 1)
        let item = try #require(items.first)
        #expect(item["text"] as? String == "原文内容" && item["deadline"] != nil && item["secrets"] as? [String] == ["npm token"])
        let id = try #require(item["id"] as? String)

        let bad = try await c.post("/api/queue/\(id)", ["action": "nope"])
        #expect(bad.0 == 400)
        let ok = try await c.post("/api/queue/\(id)", ["action": "release_masked"])
        #expect(ok.0 == 200)
        for t in [first, second] {
            let (status, data) = try await t.value
            #expect(status == 200 && json(data)["action"] as? String == "release_masked")
        }
        #expect(try await queueItems(c).isEmpty)
        #expect(try await c.post("/api/queue/\(id)", ["action": "block"]).0 == 404)
    }

    @Test func askTimeout() async throws {
        TestEnv.prepare()
        let hub = try await Client.startHub(port: 47412)
        defer { hub.stop() }
        let c = Client(port: 47412)
        let (_, data) = try await c.post("/api/ask", ["kind": "cross", "band": "b-t", "preview": "x", "timeoutSec": 1])
        #expect(json(data)["action"] as? String == "timeout")
        #expect(try await queueItems(c).isEmpty)
        // 转派也有等待上限，不会一直挂着
        let (_, d2) = try await c.post("/api/ask", ["kind": "relay", "band": "b-r", "preview": "x", "timeoutSec": 1])
        #expect(json(d2)["action"] as? String == "timeout")
        #expect(try await queueItems(c).isEmpty)
    }

    @Test func brokenSettingsBackedUpBeforeOverwrite() throws {
        TestEnv.prepare()
        let fm = FileManager.default
        let dir = Paths.settingsFile.deletingLastPathComponent()
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        for f in (try? fm.contentsOfDirectory(atPath: dir.path)) ?? [] where f.hasPrefix("settings.json.bad-") {
            try? fm.removeItem(at: dir.appendingPathComponent(f))
        }
        try Data("{ \"post\": { 写坏了".utf8).write(to: Paths.settingsFile)
        #expect(Settings.object().isEmpty)
        try Settings.update { $0["perch"] = ["notch": true] }
        let baks = try fm.contentsOfDirectory(atPath: dir.path).filter { $0.hasPrefix("settings.json.bad-") }
        #expect(baks.count == 1)
        let bak = try String(contentsOf: dir.appendingPathComponent(baks[0]), encoding: .utf8)
        #expect(bak.contains("写坏了"))
        #expect((Settings.object()["perch"] as? [String: Any])?["notch"] as? Bool == true)
        try? fm.removeItem(at: Paths.settingsFile)
        for f in baks { try? fm.removeItem(at: dir.appendingPathComponent(f)) }
    }

    @Test func settingsDefaultTimeoutUsed() async throws {
        TestEnv.prepare()
        try FileManager.default.createDirectory(at: Paths.settingsFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        try jsonBytes(["post": ["crossTimeoutSec": 1]]).write(to: Paths.settingsFile)
        let hub = try await Client.startHub(port: 47413)
        defer { hub.stop() }
        let (_, data) = try await Client(port: 47413).post("/api/ask", ["band": "b-d"])
        #expect(json(data)["action"] as? String == "timeout")
    }

    @Test func droppedConnectionRemovesItem() async throws {
        TestEnv.prepare()
        let hub = try await Client.startHub(port: 47411)
        defer { hub.stop() }
        let c = Client(port: 47411)
        let dropBody = jsonBytes(["kind": "relay", "band": "b-drop", "preview": "p"])
        let t = Task { try await c.request("POST", "/api/ask", body: dropBody) }
        #expect(try await c.waitUntil { try await queueItems(c).count == 1 })
        t.cancel()  // URLSession 取消会关掉连接
        #expect(try await c.waitUntil { try await queueItems(c).isEmpty })
    }

    @Test func queueCallbacksAndResolveAPI() async throws {
        TestEnv.prepare()
        let hub = try await Client.startHub(port: 47414)
        defer { hub.stop() }
        let seen = Box<[Int]>([])
        hub.onQueue = { data in seen.mutate { $0.append((json(data)["items"] as? [Any])?.count ?? -1) } }
        let c = Client(port: 47414)
        let splitBody = jsonBytes(["kind": "split", "band": "b-s", "preview": "p", "parts": [["preview": "a"]]])
        let t = Task { try await c.request("POST", "/api/ask", body: splitBody) }
        #expect(try await c.waitUntil { try await queueItems(c).count == 1 })
        let id = try #require(try await queueItems(c).first?["id"] as? String)
        hub.resolveQueue(id: id, action: "block")
        let (_, data) = try await t.value
        #expect(json(data)["action"] as? String == "block")
        #expect(seen.value == [1, 0])
        let q = await withCheckedContinuation { cont in hub.currentQueue { cont.resume(returning: $0) } }
        #expect((json(q)["items"] as? [Any])?.isEmpty == true)
    }

    @Test func pauseUpdatesSettings() async throws {
        TestEnv.prepare()
        try FileManager.default.createDirectory(at: Paths.settingsFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        try jsonBytes(["notify": ["done": false]]).write(to: Paths.settingsFile)
        let hub = try await Client.startHub(port: 47415)
        defer { hub.stop() }
        let fired = Box<Int>(0)
        hub.onSettings = { _ in fired.mutate { $0 += 1 } }
        let c = Client(port: 47415)
        #expect(try await c.post("/api/pause", ["on": true]).0 == 200)
        #expect(try await c.post("/api/pause", ["loft": "remote-x", "on": true]).0 == 200)
        var s = json(try await c.get("/api/settings").1)
        #expect((s["paused"] as? [String: Any])?["all"] as? Bool == true)
        #expect(((s["paused"] as? [String: Any])?["lofts"] as? [String: Any])?["remote-x"] as? Bool == true)
        #expect((s["notify"] as? [String: Any])?["done"] as? Bool == false)
        #expect(try await c.post("/api/pause", ["on": false]).0 == 200)
        #expect(try await c.post("/api/pause", ["loft": "remote-x", "on": false]).0 == 200)
        s = json(try await c.get("/api/settings").1)
        #expect((s["paused"] as? [String: Any])?["all"] as? Bool == false)
        #expect(((s["paused"] as? [String: Any])?["lofts"] as? [String: Any])?.isEmpty == true)
        #expect(try await c.post("/api/pause", ["x": 1]).0 == 400)
        #expect(fired.value == 4)
        hub.setPaused(loft: nil, on: true)
        #expect(try await c.waitUntil { (json(try await c.get("/api/settings").1)["paused"] as? [String: Any])?["all"] as? Bool == true })
    }

    @Test func dispatchPutAndSuggest() async throws {
        TestEnv.prepare()
        try FileManager.default.createDirectory(at: Paths.settingsFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        let rules: [[String: Any]] = [["id": "r1", "when": "审", "kw": "审 review", "to": "codex@local", "fb": "claude@local", "ask": false, "on": true]]
        try jsonBytes(["dispatch": ["rules": rules], "lead": ["kind": "you"]]).write(to: Paths.settingsFile)
        let hub = try await Client.startHub(port: 47416)
        defer { hub.stop() }
        let c = Client(port: 47416)
        var r = json(try await c.post("/api/dispatch/suggest", ["text": "帮我审一下", "to": "codex@local"]).1)
        #expect(r["rule"] as? String == "r1" && r["kind"] as? String == "rule")
        let put = try await c.request("PUT", "/api/dispatch", body: jsonBytes(["text": "提示原文", "low": 20, "quota": ["codex@local": 5], "alive": ["codex@local", "claude@local"]]))
        #expect(put.0 == 200)
        r = json(try await c.post("/api/dispatch/suggest", ["text": "帮我审一下", "to": "claude@local"]).1)
        #expect(r["suggested"] as? String == "claude@local" && r["fb"] as? Bool == true && r["kind"] as? String == "quota")
        let file = json(try Data(contentsOf: Paths.dispatchFile))
        #expect(file["text"] as? String == "提示原文" && file["updated"] != nil && (file["lead"] as? [String: Any])?["kind"] as? String == "you")
        #expect(try await c.request("PUT", "/api/dispatch", body: Data("[1]".utf8)).0 == 400)
        let viaAPI = await withCheckedContinuation { cont in hub.suggest(jsonBytes(["text": "无关"])) { cont.resume(returning: $0) } }
        #expect(json(viaAPI)["rule"] as? String == "")
    }

    @Test func magpieProxyScrubs() async throws {
        TestEnv.prepare()
        let hub = Hub(webRoot: TestEnv.root, port: 47417)
        hub.magpieFetch = { path in
            if path.hasPrefix("/v1/magpie/quotas") {
                return jsonBytes(["data": [["provider": "p", "name": "someone@example.com", "token": "T", "windows": [["name": "w", "remaining": 50]]]]])
            }
            throw URLError(.cannotConnectToHost)
        }
        try await withCheckedThrowingContinuation { (cc: CheckedContinuation<Void, Error>) in
            hub.start(onReady: { cc.resume() }, onFailure: { _ in cc.resume(throwing: NSError(domain: "h", code: 1)) })
        }
        defer { hub.stop() }
        let c = Client(port: 47417)
        let (status, data) = try await c.get("/api/magpie/quotas")
        let text = String(decoding: data, as: UTF8.self)
        #expect(status == 200 && !text.contains("@") && text.contains("‹账号›") && !text.contains("\"token\""))
        let down = try await c.get("/api/magpie/hello")
        #expect(down.0 == 502 && json(down.1)["error"] != nil)
    }

    @Test func notchForwards() async throws {
        TestEnv.prepare()
        let hub = try await Client.startHub(port: 47418)
        defer { hub.stop() }
        let got = Box<[Data]>([])
        hub.onNotch = { d in got.mutate { $0.append(d) } }
        let c = Client(port: 47418)
        #expect(try await c.post("/api/notch", ["state": "queue", "demo": true]).0 == 200)
        #expect(try await c.post("/api/notch", ["state": "bogus"]).0 == 400)
        #expect(got.value.count == 1)
        #expect(json(got.value[0])["state"] as? String == "queue" && json(got.value[0])["demo"] as? Bool == true)
    }

    @Test func detectHasDeepseek() async throws {
        TestEnv.prepare()
        let hub = try await Client.startHub(port: 47419)
        defer { hub.stop() }
        let (_, data) = try await Client(port: 47419).get("/api/detect")
        #expect(json(data)["deepseek"] != nil)
    }

    @Test func loftsReflectHooks() async throws {
        TestEnv.prepare()
        let hub = try await Client.startHub(port: 47411)
        defer { hub.stop() }
        let c = Client(port: 47411)
        let pushed = Box<[Data]>([])
        hub.onLofts = { d in pushed.mutate { $0.append(d) } }
        _ = try await c.post("/ev", ["hook_event_name": "UserPromptSubmit", "session_id": "cl1", "cwd": "/tmp/demo", "prompt": "写个测试"])
        _ = try await c.post("/ev", ["hook_event_name": "PreToolUse", "session_id": "cl1", "tool_name": "Edit", "tool_use_id": "u1"])
        #expect(try await c.waitUntil {
            let sessions = ((json(try await c.get("/api/lofts").1)["lofts"] as? [[String: Any]])?.first?["sessions"] as? [[String: Any]]) ?? []
            return sessions.first?["activity"] as? String == "typing"
        })
        try await Task.sleep(nanoseconds: 800_000_000)
        #expect(pushed.value.count >= 1 && pushed.value.count <= 2)  // 两条 hook 合并推送
    }

    // MARK: 应用自己派活（用假的 pigeon.mjs）

    func fakePlugin(script: String) throws -> URL {
        let root = TestEnv.root.appendingPathComponent("fake-\(UUID().uuidString)")
        let scripts = root.appendingPathComponent("scripts")
        try FileManager.default.createDirectory(at: scripts, withIntermediateDirectories: true)
        try script.write(to: scripts.appendingPathComponent("pigeon.mjs"), atomically: true, encoding: .utf8)
        return scripts
    }

    static let recorder = """
    import fs from 'node:fs';
    const out = process.env.PIGEON_HOME + '/fake-call.json';
    let stdin = fs.readFileSync(0, 'utf8');
    fs.mkdirSync(process.env.PIGEON_HOME, { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ args: process.argv.slice(2), stdin, sid: process.env.CLAUDE_CODE_SESSION_ID || null, port: process.env.PIGEON_PORT }));
    if (process.argv[2] === 'lofts') process.exit(0);
    console.log(JSON.stringify({ ok: true, band: 'b-fake000001', state: 'flying' }));
    """

    /// 浏览器里别的网站的页面也能往 127.0.0.1 发请求。带着别处的 Origin 来的一律拒绝，免得它读到等你确认的原文、替你点放行。
    @Test func foreignOriginIsRefused() async throws {
        TestEnv.prepare()
        let port: UInt16 = 47409
        let hub = try await Client.startHub(port: port)
        defer { hub.stop() }
        func call(_ method: String, _ path: String, origin: String?, body: String? = nil) async throws -> (Int, [AnyHashable: Any]) {
            var r = URLRequest(url: URL(string: "http://127.0.0.1:\(port)\(path)")!)
            r.httpMethod = method
            if let origin { r.setValue(origin, forHTTPHeaderField: "Origin") }
            if let body { r.httpBody = Data(body.utf8); r.setValue("text/plain", forHTTPHeaderField: "Content-Type") }
            let (_, resp) = try await Client(port: port).session.data(for: r)
            let http = resp as! HTTPURLResponse
            return (http.statusCode, http.allHeaderFields)
        }
        for (method, path, body) in [("GET", "/api/queue", nil), ("POST", "/api/queue/q1", #"{"action":"release"}"#),
                                     ("POST", "/api/send", #"{"to":{"agent":"codex"},"text":"x"}"#), ("PUT", "/api/settings", "{}"),
                                     ("PATCH", "/api/settings", "{}"), ("POST", "/api/pause", #"{"on":true}"#), ("POST", "/ev", "{}"),
                                     ("OPTIONS", "/api/settings", nil), ("GET", "/events", nil)] as [(String, String, String?)] {
            #expect(try await call(method, path, origin: "https://evil.example", body: body).0 == 403, "\(method) \(path)")
        }
        #expect(try await call("GET", "/api/queue", origin: "null").0 == 403)
        // 本页面自己的、和不带 Origin 的（curl、插件）照常
        let own = try await call("GET", "/api/queue", origin: "http://127.0.0.1:\(port)")
        #expect(own.0 == 200)
        #expect(own.1["Access-Control-Allow-Origin"] == nil, "不再给任何来源开跨域")
        #expect(try await call("GET", "/api/queue", origin: nil).0 == 200)
        #expect(json(Settings.load())["paused"] == nil, "被拒的请求什么都没改")
    }

    /// `PATCH /api/settings` 只改给的那几处：逐层合并，null 删掉，别的原样留着
    @Test func patchSettingsMerges() async throws {
        TestEnv.prepare()
        let port: UInt16 = 47408
        let hub = try await Client.startHub(port: port)
        defer { hub.stop() }
        let c = Client(port: port)
        _ = try await c.request("PUT", "/api/settings", body: jsonBytes(["keep": ["x": 1], "post": ["maxHops": 7, "relayThread": "t1"], "quota": ["low": 20], "drop": true]))
        hub.setPaused(loft: nil, on: true)   // 页面读完之后、写之前，别处改了暂停
        let (st, data) = try await c.request("PATCH", "/api/settings", body: jsonBytes(["post": ["maxHops": 5], "quota": ["show": "always"], "drop": NSNull(), "devices": ["hidden": ["a"]]]))
        #expect(st == 200)
        let s = json(data)
        #expect((s["keep"] as? [String: Any])?["x"] as? Int == 1)
        #expect((s["post"] as? [String: Any])?["maxHops"] as? Int == 5)
        #expect((s["post"] as? [String: Any])?["relayThread"] as? String == "t1")
        #expect((s["quota"] as? [String: Any])?["low"] as? Int == 20)
        #expect((s["quota"] as? [String: Any])?["show"] as? String == "always")
        #expect(s["drop"] == nil)
        #expect((s["devices"] as? [String: Any])?["hidden"] as? [String] == ["a"])
        #expect((s["paused"] as? [String: Any])?["all"] as? Bool == true, "别处刚改的暂停还在")
        #expect(try await c.request("PATCH", "/api/settings", body: Data("[1]".utf8)).0 == 400)
    }

    @Test(.enabled(if: Detector.which("node") != nil)) func sendAndRetry() async throws {
        TestEnv.prepare()
        setenv("CLAUDE_CODE_SESSION_ID", "should-not-leak", 1)
        defer { unsetenv("CLAUDE_CODE_SESSION_ID") }
        let hub = try await Client.startHub(port: 47412)
        defer { hub.stop() }
        hub.pluginScriptsOverride = try fakePlugin(script: Self.recorder)
        let c = Client(port: 47412)
        let call = { json(try Data(contentsOf: Paths.dataDir.appendingPathComponent("fake-call.json"))) }

        let (st, data) = try await c.post("/api/send", ["to": ["loft": "local", "agent": "codex", "session": ""], "text": "多行\n正文", "title": "标题",
                                                         "project": "Mac", "model": "m1", "effort": "high", "why": ["kind": "lead", "reason": "因为所以"]])
        #expect(st == 200 && json(data)["ok"] as? Bool == true && json(data)["band"] as? String == "b-fake000001")
        var rec = try call()
        let args = rec["args"] as? [String] ?? []
        #expect(args.starts(with: ["new", "--loft=local", "--title=标题", "--project=Mac", "--model=m1", "--effort=high", "--reason=因为所以"]))
        #expect(args.suffix(2) == ["--stdin", "--json"])
        #expect(rec["stdin"] as? String == "多行\n正文")
        #expect(rec["sid"] is NSNull)
        #expect(rec["port"] as? String == "47412")

        // 发出去的原文留在内存里，journal 里这条记 retryable
        try FileManager.default.createDirectory(at: Paths.dataDir, withIntermediateDirectories: true)
        try jsonBytes(["notes": [["band": "b-fake000001", "updated": 2], ["band": "b-other", "updated": 1]]]).write(to: Paths.journalFile)
        let notes = json(try await c.get("/api/notes").1)["notes"] as? [[String: Any]] ?? []
        #expect(notes[0]["retryable"] as? Bool == true && notes[1]["retryable"] == nil)

        // 重发：不带原文，带 retry_of
        let re = try await c.post("/api/send", ["retry_of": "b-fake000001"])
        #expect(re.0 == 200)
        rec = try call()
        #expect((rec["args"] as? [String])?.contains("--retry-of=b-fake000001") == true && rec["stdin"] as? String == "多行\n正文")
        #expect(try await c.post("/api/send", ["retry_of": "b-unknown"]).0 == 400)

        // 给已有对话发
        _ = try await c.post("/api/send", ["to": ["loft": "remote-control:env_1", "agent": "codex", "session": "sess-1"], "text": "hi"])
        #expect((try call()["args"] as? [String])?.starts(with: ["send", "--to=sess-1@remote-control:env_1"]) == true)

        // 不支持的对象
        let bad = try await c.post("/api/send", ["to": ["agent": "cursor"], "text": "x"])
        #expect(bad.0 == 501 && json(bad.1)["ok"] as? Bool == false)
        #expect(try await c.post("/api/send", ["to": ["agent": "codex"], "text": "  "]).0 == 400)

        // 函数接口
        let viaAPI = await withCheckedContinuation { cont in
            hub.send(jsonBytes(["to": ["agent": "codex", "session": "s9"], "text": "yo"])) { cont.resume(returning: $0) }
        }
        #expect(json(viaAPI)["band"] as? String == "b-fake000001")

        // 本机新开对话带上 cwd（频道派活时用）
        let withCwd = try await c.post("/api/send", ["to": ["loft": "local", "agent": "antigravity", "session": ""], "text": "听一下", "cwd": "/tmp/my-proj"])
        #expect(withCwd.0 == 200 && json(withCwd.1)["ok"] as? Bool == true)
        let cwdArgs = try call()["args"] as? [String] ?? []
        #expect(cwdArgs.contains("--agent=antigravity") && cwdArgs.contains("--cwd=/tmp/my-proj"))
    }

    @Test(.enabled(if: Detector.which("node") != nil)) func setupAndLocalLoftsRefresh() async throws {
        TestEnv.prepare()
        let hub = try await Client.startHub(port: 47415)
        defer { hub.stop() }
        hub.pluginScriptsOverride = try fakePlugin(script: Self.recorder)
        let c = Client(port: 47415)

        let (st1, setupData) = try await c.get("/api/setup")
        #expect(st1 == 200)
        let setup = json(setupData)
        #expect((setup["node"] as? [String: Any])?["ok"] as? Bool == true)
        #expect(setup["claudePlugin"] != nil && setup["codexHooks"] != nil)

        let (st2, localData) = try await c.post("/api/lofts/local", [String: Any]())
        #expect(st2 == 200 && json(localData)["ok"] as? Bool == true)
        let rec = json(try Data(contentsOf: Paths.dataDir.appendingPathComponent("fake-call.json")))
        #expect(rec["args"] as? [String] == ["lofts"])
    }

    @Test(.enabled(if: Detector.which("node") != nil)) func refreshRunsLoftsCommand() async throws {
        TestEnv.prepare()
        let hub = try await Client.startHub(port: 47413)
        defer { hub.stop() }
        hub.pluginScriptsOverride = try fakePlugin(script: Self.recorder)
        let (st, data) = try await Client(port: 47413).post("/api/lofts/refresh", [String: Any]())
        #expect(st == 200 && json(data)["ok"] as? Bool == true)
        let rec = json(try Data(contentsOf: Paths.dataDir.appendingPathComponent("fake-call.json")))
        #expect(rec["args"] as? [String] == ["lofts", "--refresh"])

        hub.pluginScriptsOverride = try fakePlugin(script: "console.error('不行'); process.exit(3);")
        let fail = try await Client(port: 47413).post("/api/lofts/refresh", [String: Any]())
        #expect(json(fail.1)["ok"] as? Bool == false && json(fail.1)["error"] as? String == "不行")
    }

    @Test func openUsesInjectedOpener() async throws {
        TestEnv.prepare()
        let hub = try await Client.startHub(port: 47414)
        defer { hub.stop() }
        let calls = Box<[[String]]>([])
        hub.opener = { args in calls.mutate { $0.append(args) }; return (true, "") }
        let c = Client(port: 47414)
        let r = try await c.post("/api/open", ["loft": "local", "agent": "codex", "session": "abc"])
        #expect(json(r.1)["ok"] as? Bool == true && calls.value == [["codex://threads/abc"]])
        #expect(try await c.post("/api/open", ["agent": "codex", "session": "a b"]).0 == 400)
    }

    @Test func runsAndAutostartEndpoints() async throws {
        TestEnv.prepare()
        let fm = FileManager.default
        try fm.createDirectory(at: Paths.runsDir, withIntermediateDirectories: true)
        try fm.createDirectory(at: Paths.runningDir, withIntermediateDirectories: true)
        defer {
            try? fm.removeItem(at: Paths.runsDir)
            try? fm.removeItem(at: Paths.runningDir)
        }
        try jsonBytes(["id": "pg-done", "title": "已完成", "kind": "review", "status": "done", "started": 1000, "ended": 2000, "updated": 2000])
            .write(to: Paths.runsDir.appendingPathComponent("pg-done.meta.json"))
        try jsonBytes(["id": "pg-stale", "title": "中断了", "kind": "code", "status": "running", "started": 3000, "updated": 3000])
            .write(to: Paths.runsDir.appendingPathComponent("pg-stale.meta.json"))
        let deadLock = Paths.runningDir.appendingPathComponent("999999.pg-stale")
        try Data("3000".utf8).write(to: deadLock)
        try jsonBytes(["id": "pg-live", "title": "还在跑", "kind": "code", "status": "running", "started": 4000, "updated": 4000])
            .write(to: Paths.runsDir.appendingPathComponent("pg-live.meta.json"))
        let pid = ProcessInfo.processInfo.processIdentifier
        let liveLock = Paths.runningDir.appendingPathComponent("\(pid).pg-live")
        try Data("4000".utf8).write(to: liveLock)

        let hub = try await Client.startHub(port: 47416)
        defer { hub.stop() }
        let c = Client(port: 47416)

        let (stRuns, runsData) = try await c.get("/api/runs")
        #expect(stRuns == 200)
        let runs = json(runsData)["runs"] as? [[String: Any]] ?? []
        let byID = Dictionary(uniqueKeysWithValues: runs.compactMap { r in (r["id"] as? String).map { ($0, r) } })
        #expect(byID["pg-done"]?["status"] as? String == "done")
        #expect(byID["pg-stale"]?["status"] as? String == "failed")
        #expect(byID["pg-live"]?["status"] as? String == "running")
        #expect(!fm.fileExists(atPath: deadLock.path))
        #expect(fm.fileExists(atPath: liveLock.path))

        let (stAuto, autoData) = try await c.get("/api/autostart")
        #expect(stAuto == 200)
        let auto = json(autoData)
        #expect(auto["supported"] as? Bool == false && auto["enabled"] as? Bool == false)
    }

    @Test func mcpInstallAndHTTPEndpoints() async throws {
        TestEnv.prepare()
        let fm = FileManager.default
        let codexFile = MCPInstall.Client.codex.configFile
        let agyFile = MCPInstall.Client.antigravity.configFile
        let cursorFile = MCPInstall.Client.cursor.configFile
        try? fm.removeItem(at: codexFile)
        try? fm.removeItem(at: agyFile)
        try? fm.removeItem(at: cursorFile)
        try? fm.removeItem(at: MCPInstall.wrapperURL)

        // 已有注释、其他 MCP、项目表都要原样保留
        try fm.createDirectory(at: codexFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        let initialToml = """
        # keep comment
        [mcp_servers.node_repl]
        command = "node"

        [projects."/tmp/demo"]
        trust_level = "trusted"
        """
        try Data(initialToml.utf8).write(to: codexFile)

        try fm.createDirectory(at: cursorFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(#"{"mcpServers":{"other":{"command":"echo"}}}"#.utf8).write(to: cursorFile)

        // 提供虚假脚本目录 + fake node 检查
        let fakeScripts = TestEnv.root.appendingPathComponent("mcp-scripts", isDirectory: true)
        try fm.createDirectory(at: fakeScripts, withIntermediateDirectories: true)
        try Data("#!/usr/bin/env node\n".utf8).write(to: fakeScripts.appendingPathComponent("mcp.mjs"))

        let hub = try await Client.startHub(port: 47417)
        hub.pluginScriptsOverride = fakeScripts
        defer { hub.stop() }
        let c = Client(port: 47417)

        let (stGet, getData) = try await c.get("/api/mcp")
        #expect(stGet == 200)
        let clients0 = json(getData)["clients"] as? [String: Any]
        #expect((clients0?["codex"] as? [String: Any])?["installed"] as? Bool == false)
        #expect((clients0?["cursor"] as? [String: Any])?["installed"] as? Bool == false)

        // 安装 codex / antigravity / cursor
        let (stCodexOn, codexOn) = try await c.post("/api/mcp", ["client": "codex", "enable": true])
        #expect(stCodexOn == 200)
        #expect(((json(codexOn)["clients"] as? [String: Any])?["codex"] as? [String: Any])?["installed"] as? Bool == true)
        let savedToml = try String(contentsOf: codexFile, encoding: .utf8)
        #expect(savedToml.contains("# keep comment"))
        #expect(savedToml.contains("[mcp_servers.node_repl]"))
        #expect(savedToml.contains("[projects.\"/tmp/demo\"]"))
        #expect(savedToml.contains("[mcp_servers.pigeon]"))
        #expect(fm.isExecutableFile(atPath: MCPInstall.wrapperURL.path))

        let (stAgyOn, _) = try await c.post("/api/mcp", ["client": "antigravity", "enable": true])
        #expect(stAgyOn == 200)
        let agyObj = json(try Data(contentsOf: agyFile))
        #expect(((agyObj["mcpServers"] as? [String: Any])?["pigeon"] as? [String: Any])?["args"] as? [String] == ["--client", "antigravity"])

        let (stCurOn, _) = try await c.post("/api/mcp", ["client": "cursor", "enable": true])
        #expect(stCurOn == 200)
        let curObj = json(try Data(contentsOf: cursorFile))
        let curServers = curObj["mcpServers"] as? [String: Any]
        #expect(curServers?["other"] != nil && curServers?["pigeon"] != nil)

        // 卸载 codex & cursor：原有内容完好
        #expect(try await c.post("/api/mcp", ["client": "codex", "enable": false]).0 == 200)
        let afterToml = try String(contentsOf: codexFile, encoding: .utf8)
        #expect(!afterToml.contains("[mcp_servers.pigeon]"))
        #expect(afterToml.contains("[mcp_servers.node_repl]"))
        #expect(afterToml.contains("[projects.\"/tmp/demo\"]"))

        #expect(try await c.post("/api/mcp", ["client": "cursor", "enable": false]).0 == 200)
        let curAfter = json(try Data(contentsOf: cursorFile))["mcpServers"] as? [String: Any]
        #expect(curAfter?["other"] != nil && curAfter?["pigeon"] == nil)

        // 非法 client 与损坏的 JSON 均回 400 且不覆盖
        #expect(try await c.post("/api/mcp", ["client": "bogus", "enable": true]).0 == 400)
        try Data("{bad-json".utf8).write(to: cursorFile)
        #expect(try await c.post("/api/mcp", ["client": "cursor", "enable": true]).0 == 400)
        #expect(try String(contentsOf: cursorFile, encoding: .utf8) == "{bad-json")
    }
}

/// 测试里在回调和测试之间共享的小盒子
final class Box<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var v: T
    init(_ v: T) { self.v = v }
    var value: T { lock.lock(); defer { lock.unlock() }; return v }
    func mutate(_ f: (inout T) -> Void) { lock.lock(); f(&v); lock.unlock() }
}

extension HubHTTPTests {
    /// 设置留在内存里，但别处改了文件（命令行、手改）要读到新的
    @Test func settingsCacheFollowsFile() throws {
        TestEnv.prepare()
        #expect(Settings.object().isEmpty)
        #expect(Settings.hotkeyEnabled())
        #expect(Settings.hotkeySpec() == .defaultSpec)
        try Settings.save(Data(#"{"perch":{"notch":false,"hotkey":false,"hotkeySpec":"cmd+shift+p"}}"#.utf8))
        #expect(!Settings.notchEnabled())
        #expect(!Settings.hotkeyEnabled())
        #expect(Settings.hotkeySpec().raw == "shift+cmd+p")
        #expect(Settings.hotkeySpec().displayLabel == "⇧ ⌘ P")
        // 绕过 Settings 直接改文件
        try Data(#"{"perch":{"notch":true},"lead":"x"}"#.utf8).write(to: Paths.settingsFile, options: .atomic)
        #expect(Settings.notchEnabled())
        #expect(Settings.object()["lead"] as? String == "x")
        try FileManager.default.removeItem(at: Paths.settingsFile)
        #expect(Settings.object().isEmpty)
        #expect(String(decoding: Settings.load(), as: UTF8.self) == "{}")
    }
}
