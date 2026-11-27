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
            ctx.lead = c["lead"] as? String
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

    @Test func promptTextGeneration() {
        let settings: [String: Any] = [
            "lead": ["kind": "agent", "agent": "claude", "loft": "local"],
            "devices": ["names": ["win": "台式机"]],
            "post": ["confirmRemote": true, "crossTimeoutSec": 90],
            "dispatch": ["rules": [
                ["id": "r1", "when": "生图", "kw": "画图", "to": "codex@local", "fb": "deepseek@local", "ask": false, "on": true, "mode": "must"],
                ["id": "r2", "when": "远程", "kw": "win", "to": "codex@win", "fb": "", "ask": false, "on": true, "mode": "suggest"],
            ]],
        ]
        let prompt = Dispatch.promptText(settings: settings, alive: ["codex@local", "deepseek@local", "codex@win"],
                                         quota: ["codex@local": 15], low: 20)
        #expect(prompt.contains("标了“照做”的要照做"))
        #expect(prompt.contains("生图 → Codex（本机）。它的额度现在只剩 15%，先交给 DeepSeek Harness（本机）。照做"))
        #expect(prompt.contains("远程 → Codex（台式机）。发之前要用户确认"))

        let youSettings: [String: Any] = ["lead": ["kind": "you"], "dispatch": settings["dispatch"]!]
        #expect(Dispatch.promptText(settings: youSettings, alive: ["codex@local"]).isEmpty)
    }

    /// 交给的正好是指挥：写成“你自己做”，不在能接活的名单里也写，不写要确认；改派写的是指挥时写“它额度不够时你自己做”
    @Test func promptTextForLeadItself() {
        let rules: [[String: Any]] = [
            ["id": "p", "when": "规划、拆解", "kw": "规划", "to": "claude@local", "fb": "", "ask": true, "on": true, "mode": "suggest"],
            ["id": "c", "when": "创作", "kw": "创作", "to": "antigravity@local", "fb": "claude@local", "ask": false, "on": true, "mode": "suggest"],
        ]
        let settings: [String: Any] = ["dispatch": ["rules": rules]]  // 没写 lead：本机的 Claude Code
        let prompt = Dispatch.promptText(settings: settings, alive: ["antigravity@local"])
        #expect(prompt.contains("- 规划、拆解 → 你自己做，不用交出去\n"))
        #expect(prompt.contains("- 创作 → Antigravity（本机）。它额度不够时你自己做\n"))
        let low = Dispatch.promptText(settings: settings, alive: ["antigravity@local"], quota: ["antigravity@local": 8], low: 20)
        #expect(low.contains("创作 → Antigravity（本机）。它的额度现在只剩 8%，先你自己做"))

        // 指挥换成 Codex：Claude Code 不在能接活的名单里，规划那条不写，创作那条也不提它
        let codexLead: [String: Any] = ["lead": ["kind": "agent", "agent": "codex", "loft": "local"], "dispatch": ["rules": rules]]
        let other = Dispatch.promptText(settings: codexLead, alive: ["antigravity@local", "codex@local"])
        #expect(!other.contains("规划"))
        #expect(other.contains("- 创作 → Antigravity（本机）\n"))

        // 给派出去的活打标签：建议指挥自己做、它却派了出去，算改判
        var ctx = Dispatch.context(settings: settings, input: Dispatch.Input())
        ctx.alive = ["antigravity@local"]
        let s = Dispatch.suggest(text: "规划一下", to: "antigravity@local", ctx)
        #expect(s.rule == "p" && s.suggested == "claude@local" && !s.ask && s.kind == "override")
    }
}

@Suite struct DetectorAndWatchTests {
    @Test func extraBinDirsAndNodeVersion() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("det-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root.appendingPathComponent(".nvm/versions/node/v20.11.0/bin"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: root.appendingPathComponent(".nvm/versions/node/v22.16.0/bin"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: root.appendingPathComponent(".nvm/alias"), withIntermediateDirectories: true)
        try "22.16.0\n".write(to: root.appendingPathComponent(".nvm/alias/default"), atomically: true, encoding: .utf8)

        let dirs = Detector.extraBinDirs(home: root.path)
        #expect(dirs.contains("\(root.path)/.asdf/shims"))
        #expect(dirs.contains("\(root.path)/.local/share/mise/shims"))
        #expect(dirs.contains("\(root.path)/.nodenv/shims"))
        #expect(dirs.contains("\(root.path)/.fnm/current/bin"))
        let i22 = dirs.firstIndex(of: "\(root.path)/.nvm/versions/node/v22.16.0/bin")!
        let i20 = dirs.firstIndex(of: "\(root.path)/.nvm/versions/node/v20.11.0/bin")!
        #expect(i22 < i20)

        #expect(Detector.parseNodeZstdSupport("v22.15.0"))
        #expect(Detector.parseNodeZstdSupport("v24.1.0"))
        #expect(!Detector.parseNodeZstdSupport("v22.14.9"))
        #expect(!Detector.parseNodeZstdSupport("v20.18.0"))
    }

    @Test func watchPartyAgentNames() {
        #expect(Watch.Party.agentName("deepseek") == "DeepSeek Harness")
        #expect(Watch.Party.agentName("antigravity") == "Antigravity")
        #expect(Watch.Party.agentName("cursor") == "Cursor")
        #expect(Watch.Party.agentName("codex") == "Codex")
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
        // Claude Code 自己发起的一轮（后台任务做完的通知、斜杠命令）不改标题
        for raw in ["<task-notification>\n<task-id>b1</task-id>", "<command-name>/clear</command-name>", "  \n<local-command-stdout>x</local-command-stdout>"] {
            t.ingest(ev("UserPromptSubmit", ["prompt": raw]), now: t0)
        }
        #expect(t.entry(agent: "claude", id: "s1")!.title == "修一下登录")
        #expect(SessionTracker.title("<b>粗体</b> 也是用户写的") == "<b>粗体</b> 也是用户写的")
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

    @Test func relayArgs() {
        #expect(Hub.relayArguments(["action": "use", "id": "t1"]).args == ["relay", "use", "t1", "--json"])
        #expect(Hub.relayArguments(["action": "use", "id": "t1", "host": "h"]).args == ["relay", "use", "t1", "--host", "h", "--json"])
        // 不给 id 只给 host：那台跟着共用的
        #expect(Hub.relayArguments(["action": "use", "host": "h"]).args == ["relay", "use", "default", "--host", "h", "--json"])
        #expect(Hub.relayArguments(["action": "delete", "id": "t1"]).args == ["relay", "delete", "t1", "--json"])
        #expect(Hub.relayArguments(["action": "delete"]).args == nil)
        #expect(Hub.relayArguments(["action": "rm", "id": "t1"]).args == nil)
        #expect(Hub.relayArguments(["action": "use"]).args == nil)
        let r = { (out: String, status: Int32) in Runner.Result(status: status, stdout: Data(out.utf8), stderr: Data("坏了\n".utf8), timedOut: false) }
        #expect(Hub.interpretRelay(r("{\"relays\":[]}\n", 0)).0 == 200)
        #expect(Hub.interpretRelay(r("{\"ok\":false,\"error\":\"还在用\"}", 1)).0 == 409)
        #expect(Hub.interpretRelay(r("{\"ok\":false,\"error\":\"用法\"}", 64)).0 == 400)
        #expect(Hub.interpretRelay(r("", 2)).0 == 500)
    }

    @Test func openArgs() {
        #expect(Hub.openArguments(agent: "codex", session: "abc-123").args == ["codex://threads/abc-123"])
        #expect(Hub.openArguments(agent: "codex", session: "a b/../x").args == nil)
        #expect(Hub.openArguments(agent: "you", session: "").args == nil)
        // agy 命令行的对话：在终端里 agy -r 接着打开，目录用单引号包好
        let sc = Hub.agyTerminalScript(session: "4db2e2c5-a12d", cwd: "/Users/x/it's", agy: "/Users/x/.local/bin/agy")
        #expect(sc == "#!/bin/zsh\ncd '/Users/x/it'\\''s' 2>/dev/null || cd ~\nexec '/Users/x/.local/bin/agy' -r 4db2e2c5-a12d\n")
        #expect(Hub.agyTerminalScript(session: "a; rm -rf x", cwd: "", agy: "agy") == nil)
    }
}

@Suite struct HookForwardTests {
    @Test func 只把网页用得到的转给网页() {
        #expect(Hub.forwardsHook(["hook_event_name": "PigeonNote", "band": "b-1"]))
        #expect(Hub.forwardsHook(["hook_event_name": "PigeonRun", "task_id": "pg-1"]))
        // Claude Code 自己的 hook、Codex 的 hook 只在应用里用
        #expect(!Hub.forwardsHook(["hook_event_name": "PreToolUse", "tool_name": "Edit"]))
        #expect(!Hub.forwardsHook(["hook_event_name": "UserPromptSubmit"]))
        #expect(!Hub.forwardsHook(["hook_event_name": "PigeonRun", "source": "codex"]))
        #expect(!Hub.forwardsHook([:]))
    }
}

@Suite struct HotKeySpecTests {
    @Test func parsesCanonicalSpecsAndLabels() {
        #expect(HotKeySpec.defaultSpec.raw == "opt+space")
        #expect(HotKeySpec.defaultSpec.displayLabel == "⌥ 空格")
        let a = HotKeySpec.parse("Cmd+Shift+P")
        #expect(a?.raw == "shift+cmd+p")
        #expect(a?.displayLabel == "⇧ ⌘ P")
        let b = HotKeySpec.parse("alt + control + F5")
        #expect(b?.raw == "ctrl+opt+f5")
        #expect(b?.displayLabel == "⌃ ⌥ F5")
        #expect(HotKeySpec.parse("space") == nil)
        #expect(HotKeySpec.parse("opt+bogus") == nil)
        #expect(HotKeySpec.parse("shift+a") == nil)
        #expect(HotKeySpec.parse("shift+f5")?.raw == "shift+f5")
        #expect(HotKeySpec.parse("") == nil)
    }
}

@Suite struct CodexConfigEdit {
    @Test func 删pigeon表不连带后面的表() {
        let src = """
        model = "x"

        [mcp_servers.pigeon]
        command = "/old"
        args = ["--client", "codex"]

        [mcp_servers.pigeon.env]
        A = "1"

        [projects."/Users/me/foo"] # 备注
        trust_level = "trusted"

        [ desktop ]
        x = 1
        """
        let out = MCPInstall.stripCodexSection(src)
        #expect(!out.contains("/old"))
        #expect(!out.contains("A = \"1\""))
        #expect(out.contains("[projects.\"/Users/me/foo\"] # 备注"))
        #expect(out.contains("trust_level = \"trusted\""))
        #expect(out.contains("[ desktop ]"))
        #expect(out.contains("model = \"x\""))
    }

    @Test func 认得各种写法的表头() {
        #expect(MCPInstall.tomlHeaderKeys("[mcp_servers.pigeon]  # 注释") == ["mcp_servers", "pigeon"])
        #expect(MCPInstall.tomlHeaderKeys("[ mcp_servers . \"pigeon\" ]") == ["mcp_servers", "pigeon"])
        #expect(MCPInstall.tomlHeaderKeys("[[skills.config]]") == ["skills", "config"])
        #expect(MCPInstall.tomlHeaderKeys("  [1, 2]") == nil)
        #expect(MCPInstall.tomlHeaderKeys("[a] x") == nil)
        #expect(MCPInstall.scanCodex("[mcp_servers.\"pigeon\"] # x\ncommand = \"a\"\n").tables == 1)
    }

    @Test func 多行字符串里的方括号不当表头() {
        let src = "[mcp_servers.pigeon]\ncommand = \"a\"\n[other]\nnote = \"\"\"\n[mcp_servers.pigeon]\n\"\"\"\n"
        #expect(MCPInstall.scanCodex(src).tables == 1)
        let out = MCPInstall.stripCodexSection(src)
        #expect(out.contains("[other]"))
        #expect(out.contains("note = \"\"\"\n[mcp_servers.pigeon]\n\"\"\""))
    }

    @Test func 别的写法认出来但不自动改() {
        #expect(MCPInstall.scanCodex("[mcp_servers]\npigeon = { command = \"a\" }\n").other)
        #expect(MCPInstall.scanCodex("mcp_servers.pigeon.command = \"a\"\n").other)
        #expect(!MCPInstall.scanCodex("[mcp_servers]\nidea = { command = \"a\" }\n").other)
        #expect(MCPInstall.isCodexInstalled("[mcp_servers]\npigeon.command = \"a\"\n"))
    }

    @Test func 写配置保留链接和权限并留备份() throws {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("pigeon-safewrite-\(UUID().uuidString)")
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: dir) }
        let real = dir.appendingPathComponent("real.toml"), link = dir.appendingPathComponent("config.toml")
        try Data("old\n".utf8).write(to: real)
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: real.path)
        try fm.createSymbolicLink(at: link, withDestinationURL: real)
        try MCPInstall.safeWrite(Data("new\n".utf8), to: link)
        #expect(try fm.destinationOfSymbolicLink(atPath: link.path) == real.path)
        #expect(try String(contentsOf: real, encoding: .utf8) == "new\n")
        let perms = try fm.attributesOfItem(atPath: real.path)[.posixPermissions] as? NSNumber
        #expect(perms?.intValue == 0o600)
        let bak = try String(contentsOf: dir.appendingPathComponent("real.toml.pigeon-bak").resolvingSymlinksInPath(), encoding: .utf8)
        #expect(bak == "old\n")
    }
}
