import Foundation

/// 分派规则的匹配。纯函数，和网页 `web/src/core/route.js` 跑同一份用例 `tests/fixtures/dispatch-cases.json`。
enum Dispatch {
    struct Rule: Sendable, Equatable {
        var id: String
        var when = ""
        var kw = ""
        var to = ""
        var fb = ""
        var ask = false
        var on = true
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
        func isAlive(_ key: String) -> Bool { ctx.alive?.contains(key) ?? true }
        var result = Suggestion()
        for rule in ctx.rules where rule.on && matches(text, rule.kw) && isAlive(rule.to) {
            result.rule = rule.id
            result.suggested = rule.to
            if let q = ctx.quota[rule.to], q < ctx.low, !rule.fb.isEmpty, isAlive(rule.fb) {
                result.suggested = rule.fb
                result.fb = true
            }
            result.ask = rule.ask || (!isLocal(result.suggested) && ctx.confirmRemote)
            break
        }
        if let to, !to.isEmpty {
            if result.rule.isEmpty { result.kind = "lead" }
            else if to == result.suggested { result.kind = result.fb ? "quota" : "rule" }
            else { result.kind = "override" }
        }
        return result
    }

    /// 读设置里的 `dispatch.rules`
    static func rules(from settings: [String: Any]) -> [Rule] {
        let list = (settings["dispatch"] as? [String: Any])?["rules"] as? [[String: Any]] ?? []
        return list.map { r in
            Rule(id: r["id"] as? String ?? "", when: r["when"] as? String ?? "", kw: r["kw"] as? String ?? "",
                 to: r["to"] as? String ?? "", fb: r["fb"] as? String ?? "",
                 ask: r["ask"] as? Bool ?? false, on: r["on"] as? Bool ?? true)
        }
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
                       alive: input.alive, confirmRemote: confirm != false)
    }
}
