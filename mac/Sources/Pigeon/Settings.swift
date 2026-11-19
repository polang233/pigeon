import Foundation

/// 设置文件读写和 Codex 模型列表。设置按收到的原文保存，只要求顶层是 JSON 对象。
///
/// 读过的设置留在内存里：文件的修改时间、大小、inode 都没变就不再读盘、不再解析。
/// 主线程（菜单、刘海）和服务的队列都会读，所以用一把锁护着，不绑在哪个队列上。
enum Settings {
    enum SaveError: Error { case notObject, io(Error) }

    /// 文件的“指纹”：别处（命令行、手改）写了文件，这几样至少变一样
    private struct Stamp: Equatable {
        var modified: Date?
        var size: Int
        var inode: Int
    }

    private struct Cache {
        var stamp: Stamp?
        var data: Data
        var object: [String: Any]
    }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var cache: Cache?

    private static func stamp() -> Stamp? {
        guard let a = try? FileManager.default.attributesOfItem(atPath: Paths.settingsFile.path) else { return nil }
        return Stamp(modified: a[.modificationDate] as? Date, size: (a[.size] as? NSNumber)?.intValue ?? -1,
                     inode: (a[.systemFileNumber] as? NSNumber)?.intValue ?? -1)
    }

    /// 读盘（或拿内存里的）。文件不存在或坏了时是 `{}`
    private static func current() -> Cache {
        lock.lock()
        defer { lock.unlock() }
        let now = stamp()
        if let c = cache, c.stamp == now { return c }
        var c = Cache(stamp: now, data: Data("{}".utf8), object: [:])
        if now != nil, let data = try? Data(contentsOf: Paths.settingsFile),
           let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
            c.data = data
            c.object = obj
        }
        cache = c
        return c
    }

    static func load() -> Data { current().data }

    static func save(_ body: Data) throws(SaveError) {
        guard let obj = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else { throw .notObject }
        let url = Paths.settingsFile
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            lock.lock()
            defer { lock.unlock() }
            try body.write(to: url, options: .atomic)
            // 刚写的就是最新的，不用再读一次
            cache = Cache(stamp: stamp(), data: body, object: obj)
        } catch {
            throw .io(error)
        }
    }

    /// 读成字典；文件不存在或坏了时是空字典
    static func object() -> [String: Any] { current().object }

    /// 改一处字段再存回去，其余字段（包括不认识的）原样保留。返回存下的内容。
    @discardableResult
    static func update(_ change: (inout [String: Any]) -> Void) throws(SaveError) -> Data {
        var root = object()
        change(&root)
        let data: Data
        do {
            data = try JSONSerialization.data(withJSONObject: root, options: [.sortedKeys, .withoutEscapingSlashes])
        } catch {
            throw .io(error)
        }
        try save(data)
        return data
    }

    /// 把 patch 合并进 base：对象逐层合并，值为 null 删掉这一项，其余（含数组）整个换
    static func merge(_ base: inout [String: Any], patch: [String: Any]) {
        for (key, value) in patch {
            if value is NSNull {
                base[key] = nil
            } else if let sub = value as? [String: Any] {
                var inner = base[key] as? [String: Any] ?? [:]
                merge(&inner, patch: sub)
                base[key] = inner
            } else {
                base[key] = value
            }
        }
    }

    /// 用刘海还是菜单栏图标（`perch.notch`）。没写过时沿用以前的 `perch.enabled`，都没有就是开
    static func notchEnabled() -> Bool {
        let perch = object()["perch"] as? [String: Any]
        return (perch?["notch"] as? Bool) ?? (perch?["enabled"] as? Bool) ?? true
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
