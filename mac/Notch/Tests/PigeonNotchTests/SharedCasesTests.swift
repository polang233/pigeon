import Foundation
import Testing
@testable import PigeonNotch

/// 查密钥的共用用例（仓库里的 tests/fixtures/secrets-cases.json）。网页和命令行跑的是同一个文件。
@Test func secretsSharedCases() throws {
    let file = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()  // mac/Notch
        .deletingLastPathComponent().deletingLastPathComponent()                              // 仓库根目录
        .appendingPathComponent("tests/fixtures/secrets-cases.json")
    let root = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any]
    let cases = root?["cases"] as? [[String: Any]] ?? []
    #expect(cases.count >= 8)
    for c in cases {
        let text = c["text"] as? String ?? ""
        var seen = Set<String>()
        let kinds = Secrets.find(in: text).map(Secrets.kind(of:)).filter { seen.insert($0).inserted }
        #expect(kinds == c["kinds"] as? [String] ?? [], "\(text)")
        #expect(Secrets.masked(text) == c["masked"] as? String, "\(text)")
    }
}
