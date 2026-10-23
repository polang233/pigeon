import Foundation

/// 设置文件读写和 Codex 模型列表。设置按收到的原文保存，只要求顶层是 JSON 对象。
enum Settings {
    enum SaveError: Error { case notObject, io(Error) }

    static func load() -> Data {
        guard let data = try? Data(contentsOf: Paths.settingsFile), isObject(data) else { return Data("{}".utf8) }
        return data
    }

    static func save(_ body: Data) throws(SaveError) {
        guard isObject(body) else { throw .notObject }
        let url = Paths.settingsFile
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try body.write(to: url, options: .atomic)
        } catch {
            throw .io(error)
        }
    }

    private static func isObject(_ data: Data) -> Bool {
        (try? JSONSerialization.jsonObject(with: data)) is [String: Any]
    }

    struct CodexModel: Encodable {
        var slug: String
        var name: String
        var efforts: [String]
    }

    /// 读 ~/.codex/models_cache.json（`{"models":[{slug, display_name, supported_reasoning_levels:[{effort}]}]}`），保持原顺序。
    static func codexModels() -> [CodexModel] {
        guard let data = try? Data(contentsOf: Paths.codexModelsCache),
              let root = try? JSONSerialization.jsonObject(with: data) else { return [] }
        let list = (root as? [String: Any])?["models"] as? [Any] ?? root as? [Any] ?? []
        return list.compactMap { item in
            guard let m = item as? [String: Any], let slug = m["slug"] as? String, !slug.isEmpty,
                  (m["visibility"] as? String) != "hide" else { return nil }
            let name = (m["display_name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? slug
            let levels = m["supported_reasoning_levels"] as? [Any] ?? []
            let efforts = levels.compactMap { ($0 as? [String: Any])?["effort"] as? String ?? $0 as? String }
            return CodexModel(slug: slug, name: name, efforts: efforts)
        }
    }
}
