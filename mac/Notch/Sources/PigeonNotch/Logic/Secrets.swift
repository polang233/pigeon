import Foundation

/// 跨设备发送前查一遍：消息里像密钥、token 的字符串。规则和网页（web/src/core/secrets.js）、命令行（plugin/scripts/lib/secrets.mjs）一样，三处跑同一份用例 tests/fixtures/secrets-cases.json。纯函数。
public enum Secrets {
    private static let pattern = try! NSRegularExpression(
        pattern: #"\b(?:npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[0-9A-Z]{16}\b|xox[abprs]-[A-Za-z0-9-]{10,})|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)"#)

    /// 一段话切成的片段：普通文字，或者一个密钥（带它是哪一类）
    public struct Segment: Sendable, Hashable {
        public var text: String
        public var kind: String?
        public var isSecret: Bool { kind != nil }
    }

    /// 是哪一类：npm token、GitHub token、API key、AWS 密钥、Slack token、私钥
    public static func kind(of secret: String) -> String {
        if secret.hasPrefix("npm_") { return "npm token" }
        if secret.hasPrefix("gh") || secret.hasPrefix("github_pat_") { return "GitHub token" }
        if secret.hasPrefix("sk-") { return "API key" }
        if secret.hasPrefix("AKIA") || secret.hasPrefix("ASIA") { return "AWS 密钥" }
        if secret.hasPrefix("-----BEGIN") { return "私钥" }
        return "Slack token"
    }

    /// 找到的每一个（原文）
    public static func find(in text: String) -> [String] {
        split(text).filter(\.isSecret).map(\.text)
    }

    public static func split(_ text: String) -> [Segment] {
        let ns = text as NSString
        var out: [Segment] = []
        var at = 0
        for m in pattern.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            if m.range.location > at {
                out.append(Segment(text: ns.substring(with: NSRange(location: at, length: m.range.location - at)), kind: nil))
            }
            let s = ns.substring(with: m.range)
            out.append(Segment(text: s, kind: kind(of: s)))
            at = m.range.location + m.range.length
        }
        if at < ns.length { out.append(Segment(text: ns.substring(from: at), kind: nil)) }
        return out
    }

    /// 打码后的样子：密钥换成“‹npm token 已打码›”
    public static func masked(_ text: String) -> String {
        split(text).map { $0.kind.map { "‹\($0) 已打码›" } ?? $0.text }.joined()
    }

    /// 标红时露出来的那一点：前 8 个字加省略号
    static func peek(_ secret: String) -> String { String(secret.prefix(8)) + "…" }

    /// 原文下面那一句提醒。mode 为 off 或没有密钥时为 nil。kinds 是应用查到的类别（契约里的 secrets）
    static func note(kinds: [String], found: Int, mode: SecretsMode) -> String? {
        guard !kinds.isEmpty, mode != .off else { return nil }
        let n = max(found, kinds.count)
        var seen = Set<String>()
        let names = kinds.filter { seen.insert($0).inserted }.joined(separator: "、")
        return mode == .mask
            ? "里面有 \(n) 个 \(names)，已按设置打码，对方收到的是占位符"
            : "里面有 \(n) 个像 \(names) 的字符串，原样放行的话，对方电脑上看得到原文"
    }
}
