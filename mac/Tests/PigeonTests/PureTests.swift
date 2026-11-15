import Foundation
import Testing
@testable import Pigeon

@Suite struct DispatchTests {
    static let fixtureURL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("tests/fixtures/dispatch-cases.json")

    @Test func fixtureCases() throws {
        let root = json(try Data(contentsOf: Self.fixtureURL))
        let low = (root["low"] as? NSNumber)?.doubleValue ?? 20
        let rules = Dispatch.rules(from: ["dispatch": ["rules": root["rules"] ?? []]])
        let cases = try #require(root["cases"] as? [[String: Any]])
        #expect(cases.count >= 20)
        for c in cases {
            let name = c["name"] as? String ?? ""
            var ctx = Dispatch.Context(rules: rules, low: low)
            ctx.alive = Set((c["alive"] as? [String]) ?? [])
            for (k, v) in c["quota"] as? [String: Any] ?? [:] { ctx.quota[k] = (v as? NSNumber)?.doubleValue }
            ctx.confirmRemote = c["confirmRemote"] as? Bool ?? true
            let got = Dispatch.suggest(text: c["text"] as? String ?? "", to: c["to"] as? String, ctx)
            let exp = c["expect"] as? [String: Any] ?? [:]
            #expect(got.rule == exp["rule"] as? String, "\(name): rule")
            #expect(got.suggested == exp["suggested"] as? String, "\(name): suggested")
            #expect(got.fb == exp["fb"] as? Bool, "\(name): fb")
            #expect(got.ask == exp["ask"] as? Bool, "\(name): ask")
            if let kind = exp["kind"] as? String { #expect(got.kind == kind, "\(name): kind") }
        }
    }

    @Test func aliveUnlimitedByDefault() {
        let rules = [Dispatch.Rule(id: "r1", kw: "图", to: "codex@x")]
        let s = Dispatch.suggest(text: "画图", to: nil, Dispatch.Context(rules: rules))
        #expect(s.rule == "r1")
        #expect(s.ask)  // 不在本机，默认要问
    }
}

@Suite struct ActivityTests {
    @Test func classify() {
        #expect(Activity.classify(tool: "Read", input: [:]) == "reading")
        #expect(Activity.classify(tool: "Grep", input: [:]) == "reading")
        #expect(Activity.classify(tool: "Edit", input: [:]) == "typing")
        #expect(Activity.classify(tool: "Bash", input: ["command": "swift build -c release"]) == "building")
        #expect(Activity.classify(tool: "Bash", input: ["command": "npm test"]) == "testing")
        #expect(Activity.classify(tool: "Bash", input: ["command": "cargo test"]) == "testing")
        #expect(Activity.classify(tool: "Bash", input: ["command": "node pigeon.mjs send --to x"]) == "delegating")
        #expect(Activity.classify(tool: "Agent", input: [:]) == "delegating")
        #expect(Activity.classify(tool: "Bash", input: ["command": "ls"]) == "thinking")
    }

    @Test func detailTruncates() {
        let long = String(repeating: "a", count: 200)
        #expect(Activity.detail(tool: "Bash", input: ["command": long]).count == 80)
        #expect(Activity.detail(tool: "Read", input: [:]) == "Read")
    }
}

@Suite struct SessionTrackerTests {
    let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    func ev(_ name: String, _ extra: [String: Any] = [:], sid: String = "s1") -> [String: Any] {
        var d: [String: Any] = ["hook_event_name": name, "session_id": sid, "cwd": "/tmp/proj"]
        for (k, v) in extra { d[k] = v }
        return d
    }

    @Test func turnLifecycle() {
        var t = SessionTracker()
        t.ingest(ev("UserPromptSubmit", ["prompt": "修一下登录\n第二行"]), now: t0)
        var e = t.entry(agent: "claude", id: "s1")!
        #expect(e.state == "run" && e.activity == "thinking" && e.title == "修一下登录")
        t.ingest(ev("PreToolUse", ["tool_name": "Bash", "tool_input": ["command": "swift test"], "tool_use_id": "u1"]), now: t0 + 1)
        e = t.entry(agent: "claude", id: "s1")!
        #expect(e.activity == "testing" && e.detail == "swift test")
        t.ingest(ev("Notification", ["notification_type": "permission_prompt", "message": "Claude needs your permission to use Bash"]), now: t0 + 2)
        #expect(t.entry(agent: "claude", id: "s1")!.state == "wait")
        t.ingest(ev("PreToolUse", ["tool_name": "Read", "tool_use_id": "u2"]), now: t0 + 3)
        #expect(t.entry(agent: "claude", id: "s1")!.state == "run")
        t.ingest(ev("Stop"), now: t0 + 10)
        e = t.entry(agent: "claude", id: "s1")!
        #expect(t.effectiveState(e, now: t0 + 11) == "done")
        #expect(t.effectiveState(e, now: t0 + 10 + 601) == "idle")
        #expect(t.hasTransition(from: t0 + 100, to: t0 + 700))
        #expect(!t.hasTransition(from: t0 + 11, to: t0 + 100))
    }

    @Test func subagentChild() {
        var t = SessionTracker()
        t.ingest(ev("UserPromptSubmit", ["prompt": "x"]), now: t0)
        t.ingest(ev("PreToolUse", ["tool_name": "Agent", "tool_use_id": "tu9",
                                   "tool_input": ["description": "查日志", "model": "haiku"]]), now: t0 + 1)
        #expect(t.entry(agent: "claude", id: "s1:tu9")?.parent == "s1")
        #expect(t.entry(agent: "claude", id: "s1")!.activity == "delegating")
        t.ingest(ev("PreToolUse", ["tool_name": "Grep", "agent_id": "a1", "tool_use_id": "u5"]), now: t0 + 2)
        #expect(t.entry(agent: "claude", id: "s1:tu9")!.activity == "reading")
        #expect(t.entry(agent: "claude", id: "s1")!.activity == "delegating")  // 主对话不受子代理影响
        t.ingest(ev("PostToolUse", ["tool_name": "Agent", "tool_use_id": "tu9", "tool_response": [String: Any]()]), now: t0 + 3)
        #expect(t.entry(agent: "claude", id: "s1:tu9")!.state == "done")
    }

    @Test func composeAddsClaudeAndOverlaysCodex() throws {
        var t = SessionTracker()
        t.ingest(ev("UserPromptSubmit", ["prompt": "你好"], sid: "cl1"), now: t0)
        t.ingest(ev("PreToolUse", ["tool_name": "Agent", "tool_use_id": "tu1", "tool_input": ["description": "子任务"]], sid: "cl1"), now: t0 + 1)
        t.ingest(ev("UserPromptSubmit", ["prompt": "codex 在干活", "source": "codex", "model": "gpt-x"], sid: "cx1"), now: t0)
        let file = jsonBytes(["version": 1, "updated": 5, "lofts": [
            ["id": "local", "name": "这台 Mac", "online": true, "projects": [],
             "sessions": [["id": "cx1", "agent": "codex", "title": "老标题", "updated": 1], ["id": "cx2", "agent": "codex", "title": "没 hook"]]],
            ["id": "remote-x", "name": "远程", "online": true, "projects": [], "sessions": [["id": "r1", "agent": "codex", "title": "t"]]],
        ]])
        let out = json(LoftsComposer.compose(file: file, tracker: t, now: t0 + 5))
        let lofts = try #require(out["lofts"] as? [[String: Any]])
        let local = try #require(lofts.first { $0["id"] as? String == "local" }?["sessions"] as? [[String: Any]])
        func s(_ id: String) -> [String: Any] { local.first { $0["id"] as? String == id } ?? [:] }
        #expect(s("cx1")["state"] as? String == "run")
        #expect(s("cx1")["model"] as? String == "gpt-x")
        #expect(s("cx2")["state"] as? String == "idle")
        #expect(s("cl1")["title"] as? String == "你好")
        #expect(s("cl1")["agent"] as? String == "claude")
        #expect(s("cl1:tu1")["parent"] as? String == "cl1")
        let remote = try #require(lofts.first { $0["id"] as? String == "remote-x" }?["sessions"] as? [[String: Any]])
        #expect(remote[0]["state"] as? String == "idle")
        #expect(out["updated"] as? Int == 5)
    }

    @Test func composeWithoutFile() throws {
        let out = json(LoftsComposer.compose(file: nil, tracker: SessionTracker(), now: t0))
        let lofts = try #require(out["lofts"] as? [[String: Any]])
        #expect(lofts.count == 1 && lofts[0]["id"] as? String == "local")
    }
}

@Suite struct MagpieTests {
    @Test func scrubEmails() {
        // 两个键打码后重名：不能崩，留一个
        let twin = Magpie.scrub(["a@example.com": 1, "b@example.com": 2] as [String: Any]) as? [String: Any]
        #expect(twin?.count == 1 && twin?["‹账号›"] != nil)
        #expect(Magpie.scrub("登录为 someone@example.com 的账号") == "登录为 ‹账号› 的账号")
        let nested = Magpie.scrub(["a": ["x@example.org", ["k": "y.z+1@mail.example.co.uk"]]] as [String: Any])
        let text = String(decoding: jsonBytes(nested), as: UTF8.self)
        #expect(!text.contains("@"))
    }

    @Test func quotasWhitelist() throws {
        let raw: [String: Any] = ["data": [[
            "provider": "openai", "name": "someone@example.com", "plan": "Pro", "token": "SECRET", "email": "someone@example.com",
            "balance": ["note": "owner other@example.com"],
            "windows": [["name": "7 天", "used": 10, "remaining": 90, "secret": "x", "text": "账号 someone@example.com"]],
        ]]]
        let out = Magpie.slim(.quotas, raw)
        let text = String(decoding: jsonBytes(out), as: UTF8.self)
        #expect(!text.contains("@") && !text.contains("SECRET") && !text.contains("\"email\""))
        let card = try #require((out as? [String: Any])?["data"] as? [[String: Any]])[0]
        #expect(card["name"] as? String == "‹账号›")
        let w = try #require(card["windows"] as? [[String: Any]])[0]
        #expect(w["secret"] == nil && w["remaining"] as? Int == 90)
    }

    @Test func helloAndModels() {
        let h = Magpie.slim(.hello, ["name": "magpie", "version": "1", "path": "/x"]) as? [String: Any]
        #expect(h?.keys.sorted() == ["name", "version"])
        let m = Magpie.slim(.models, ["data": [["id": "a", "context_window": 1000, "reasoning_levels": ["low"], "owned_by": "x"]]]) as? [String: Any]
        #expect(((m?["data"] as? [[String: Any]])?[0].keys.sorted()) == ["context_window", "id", "reasoning_levels"])
    }

    @Test func portResolution() throws {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent("mp-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home.appendingPathComponent(".config/magpie"), withIntermediateDirectories: true)
        #expect(Magpie.port(env: [:], home: home) == 3425)
        try Data(#"{"port": 4555}"#.utf8).write(to: home.appendingPathComponent(".config/magpie/settings.json"))
        #expect(Magpie.port(env: [:], home: home) == 4555)
        #expect(Magpie.port(env: ["MAGPIE_PORT": "4000"], home: home) == 4000)
    }
}

@Suite struct SenderPureTests {
    @Test func locateScripts() {
        let existing: Set<String> = ["/root/scripts/pigeon.mjs", "/app/Resources/plugin/scripts/pigeon.mjs"]
        let exists: (String) -> Bool = { existing.contains($0) }
        let pkg = URL(fileURLWithPath: "/nowhere/mac")
        #expect(PluginScripts.locate(env: ["PIGEON_PLUGIN_ROOT": "/root"], resourceURL: URL(fileURLWithPath: "/app/Resources"), packageDir: pkg, fileExists: exists)?.path == "/root/scripts")
        #expect(PluginScripts.locate(env: [:], resourceURL: URL(fileURLWithPath: "/app/Resources"), packageDir: pkg, fileExists: exists)?.path == "/app/Resources/plugin/scripts")
        #expect(PluginScripts.locate(env: [:], resourceURL: nil, packageDir: pkg, fileExists: exists) == nil)
        #expect(PluginScripts.locate(env: [:], resourceURL: nil, packageDir: pkg, fileExists: { $0 == "/nowhere/plugin/scripts/pigeon.mjs" })?.path == "/nowhere/plugin/scripts")
    }

    @Test func interpretOutput() {
        func r(_ out: String, _ err: String = "", _ status: Int32 = 0) -> Runner.Result {
            Runner.Result(status: status, stdout: Data(out.utf8), stderr: Data(err.utf8), timedOut: false)
        }
        var (_, d) = Hub.interpretSend(r("提示\n{\"ok\":true,\"band\":\"b-1\",\"state\":\"flying\"}\n"))
        #expect(json(d)["band"] as? String == "b-1" && json(d)["ok"] as? Bool == true)
        (_, d) = Hub.interpretSend(r("{\"ok\":false,\"band\":\"b-2\",\"state\":\"refused\",\"reason\":\"blocked\",\"error\":\"拦下\"}", "", 1))
        #expect(json(d)["ok"] as? Bool == false && json(d)["reason"] as? String == "blocked")
        (_, d) = Hub.interpretSend(r("", "boom\n", 2))
        #expect(json(d)["error"] as? String == "boom")
    }

    @Test func openArgs() {
        #expect(Hub.openArguments(agent: "codex", session: "abc-123").args == ["codex://threads/abc-123"])
        #expect(Hub.openArguments(agent: "codex", session: "a b/../x").args == nil)
        #expect(Hub.openArguments(agent: "you", session: "").args == nil)
    }
}
