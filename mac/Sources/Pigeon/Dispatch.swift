import Foundation

/// 分派规则的匹配。纯函数，和网页 `web/src/core/route.js` 跑同一份用例 `tests/fixtures/dispatch-cases.json`。
/// 交给的正好是指挥自己：这条的意思是“指挥自己做”，不管在不在能接活的名单里都算数，不问用户，提示里写成“你自己做”。
enum Dispatch {
    struct Rule: Sendable, Equatable {
        var id: String
        var when = ""
        var kw = ""
        var to = ""
        var fb = ""
        var ask = false
        var on = true
        var mode = "suggest"
    }

    struct Context: Sendable {
        var rules: [Rule] = []
        /// 额度低于这个数就改派
        var low: Double = 20
        /// "agent@设备" → 剩余额度百分比
        var quota: [String: Double] = [:]
        /// 在线的 "agent@设备"；nil 表示不限
        var alive: Set<String>?
        var confirmRemote = true
        /// 当前指挥的 "agent@设备"；用户自己当指挥时是 nil
        var lead: String?
    }

    struct Suggestion: Sendable, Equatable {
        var rule = ""
        var suggested = ""
        var fb = false
        var ask = false
        /// 给了 `to` 才有：`rule`、`quota`、`override`、`lead`
        var kind: String?

        var json: [String: Any] {
            var d: [String: Any] = ["rule": rule, "suggested": suggested, "fb": fb, "ask": ask]
            if let kind { d["kind"] = kind }
            return d
        }
    }

    /// 关键词按空格、顿号、逗号分开
    static func keywords(_ kw: String) -> [String] {
        kw.components(separatedBy: CharacterSet(charactersIn: " \t\n、，,；;")).map { $0.lowercased() }.filter { !$0.isEmpty }
    }

    static func matches(_ text: String, _ kw: String) -> Bool {
        let t = text.lowercased()
        return keywords(kw).contains { t.contains($0) }
    }

    static func isLocal(_ key: String) -> Bool {
        guard let at = key.firstIndex(of: "@") else { return true }
        return key[key.index(after: at)...] == "local"
    }

    static func suggest(text: String, to: String?, _ ctx: Context) -> Suggestion {
        func isAlive(_ key: String) -> Bool { key == ctx.lead || (ctx.alive?.contains(key) ?? true) }
        var result = Suggestion()
        for rule in ctx.rules where rule.on && matches(text, rule.kw) && isAlive(rule.to) {
            result.rule = rule.id
            result.suggested = rule.to
            if let q = ctx.quota[rule.to], q < ctx.low, !rule.fb.isEmpty, isAlive(rule.fb) {
                result.suggested = rule.fb
                result.fb = true
            }
            result.ask = result.suggested != ctx.lead && (rule.ask || (!isLocal(result.suggested) && ctx.confirmRemote))
            break
        }
        if let to, !to.isEmpty {
            if result.rule.isEmpty { result.kind = "lead" }
            else if to == result.suggested { result.kind = result.fb ? "quota" : "rule" }
            else { result.kind = "override" }
        }
        return result
    }

    /// 设置里的 `lead` 换成 "agent@设备"：没写就是本机的 Claude Code，用户自己当指挥是 nil
    static func leadKey(settings: [String: Any]) -> String? {
        let lead = settings["lead"] as? [String: Any] ?? [:]
        if (lead["kind"] as? String) == "you" { return nil }
        let agent = (lead["agent"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "claude"
        let loft = (lead["loft"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "local"
        return "\(agent == "dsh" ? "deepseek" : agent)@\(loft)"
    }

    /// 读设置里的 `dispatch.rules`
    static func rules(from settings: [String: Any]) -> [Rule] {
        let list = (settings["dispatch"] as? [String: Any])?["rules"] as? [[String: Any]] ?? []
        return list.map { r in
            Rule(id: r["id"] as? String ?? "", when: r["when"] as? String ?? "", kw: r["kw"] as? String ?? "",
                 to: r["to"] as? String ?? "", fb: r["fb"] as? String ?? "",
                 ask: r["ask"] as? Bool ?? false, on: r["on"] as? Bool ?? true,
                 mode: r["mode"] as? String ?? "suggest")
        }
    }

    /// 生成写进 `~/.pigeon/dispatch.json` 供 Claude Code 读取的派活建议文本，脱离主窗口 WebView 也能独立计算。
    static func promptText(settings: [String: Any], alive: Set<String>, quota: [String: Double] = [:],
                           low: Double? = nil, loftNames: [String: String] = [:]) -> String {
        guard let me = leadKey(settings: settings) else { return "" }
        let devices = settings["devices"] as? [String: Any] ?? [:]
        let customNames = devices["names"] as? [String: String] ?? [:]
        let post = settings["post"] as? [String: Any] ?? [:]
        let confirmRemote = (post["confirmRemote"] as? Bool) != false
        let rawTimeout = (post["crossTimeoutSec"] as? NSNumber)?.intValue ?? 90
        let crossTimeout = rawTimeout > 0 ? rawTimeout : 90
        let lowThreshold = low ?? ((settings["quota"] as? [String: Any])?["low"] as? NSNumber)?.doubleValue ?? 20

        func agentName(_ a: String) -> String {
            switch a {
            case "claude": "Claude Code"
            case "codex": "Codex"
            case "cursor": "Cursor"
            case "deepseek", "dsh": "DeepSeek Harness"
            case "antigravity": "Antigravity"
            default: a
            }
        }
        func nameOf(_ key: String) -> String {
            if key == "you" { return "你" }
            let parts = key.split(separator: "@", maxSplits: 1).map(String.init)
            let a = parts.first ?? key
            let d = parts.count > 1 ? parts[1] : "local"
            let devLabel: String
            if let n = customNames[d], !n.isEmpty { devLabel = n }
            else if d == "local" { devLabel = "本机" }
            else { devLabel = loftNames[d] ?? d }
            return "\(agentName(a))（\(devLabel)）"
        }
        func fmtQuota(_ v: Double) -> String {
            v.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(v)) : String(v)
        }

        // 指挥自己也算数（自己做）
        func ok(_ key: String) -> Bool { !key.isEmpty && (key == me || alive.contains(key)) }
        let active = rules(from: settings).filter { $0.on && !$0.when.isEmpty && ok($0.to) }
        if active.isEmpty { return "" }

        let lines = active.map { r in
            let isSelf = r.to == me
            var v = "- \(r.when) → \(isSelf ? "你自己做，不用交出去" : nameOf(r.to))"
            if let q = quota[r.to], q < lowThreshold {
                let who = isSelf ? "你" : "它"
                if ok(r.fb) {
                    v += "。\(who)的额度现在只剩 \(fmtQuota(q))%，先\(r.fb == me ? "你自己做" : "交给 \(nameOf(r.fb))")"
                } else {
                    v += "。\(who)的额度现在只剩 \(fmtQuota(q))%"
                }
            } else if r.fb == me {
                v += "。它额度不够时你自己做"
            }
            if !isSelf, r.ask || (!isLocal(r.to) && confirmRemote) { v += "。发之前要用户确认" }
            if r.mode == "must" {
                v += isSelf ? "。照做：这类活你自己做，除非用户明确说要交出去" : "。照做：用户的话里出现这类活就交给它，除非用户明确说不要"
            }
            return v
        }
        let askLine = confirmRemote ? "\n- 往别的电脑派活，Pigeon 会先问用户，\(crossTimeout) 秒没人点就不发" : ""
        let hasMust = active.contains { $0.mode == "must" }
        let header = "派活建议（Pigeon 写进来的\(hasMust ? "。标了“照做”的要照做，其余只是建议，由你判断" : "，只是建议，最后由你判断")）："
        return "\(header)\n\(lines.joined(separator: "\n"))\n- 其他的你自己做，或者自己决定交给谁\(askLine)\n派活时附一句理由；没照上面的建议做，也说明为什么。"
    }

    /// 网页用 `PUT /api/dispatch` 推来的东西，放在内存里
    struct Input: Sendable {
        var text = ""
        var low: Double?
        var quota: [String: Double] = [:]
        var alive: Set<String>?

        init() {}
        init?(_ obj: [String: Any]) {
            text = obj["text"] as? String ?? ""
            low = (obj["low"] as? NSNumber)?.doubleValue
            if let q = obj["quota"] as? [String: Any] {
                for (k, v) in q { if let n = v as? NSNumber { quota[k] = n.doubleValue } }
            }
            if let a = obj["alive"] as? [Any] { alive = Set(a.compactMap { $0 as? String }) }
        }
    }

    static func context(settings: [String: Any], input: Input) -> Context {
        let lowSetting = ((settings["quota"] as? [String: Any])?["low"] as? NSNumber)?.doubleValue
        let confirm = (settings["post"] as? [String: Any])?["confirmRemote"] as? Bool
        return Context(rules: rules(from: settings), low: input.low ?? lowSetting ?? 20, quota: input.quota,
                       alive: input.alive, confirmRemote: confirm != false, lead: leadKey(settings: settings))
    }
}
