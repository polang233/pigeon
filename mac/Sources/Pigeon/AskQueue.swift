import Foundation

/// 等你处理的一队。`POST /api/ask` 把一件事排进来，连接一直挂着，等你放行、拦下或到点。
/// 正文只在内存里，应用退出就没了。所有状态只在 hub.queue 上访问。
final class AskQueue: @unchecked Sendable {
    static let kinds: Set<String> = ["cross", "relay", "split"]
    static let actions: Set<String> = ["release", "release_masked", "block"]
    static let maxText = 4000
    static let maxPreview = 80

    struct Waiter {
        let conn: HTTPConnection
        let keepAlive: Bool
    }

    struct Item {
        var id: String
        var kind: String
        var band: String
        var from: Any
        var to: Any
        var preview: String
        var rule: String
        var created: Date
        var deadline: Date?
        var secrets: [String]
        var text: String
        var chars: Int
        var files: [String]
        var project: String
        var parts: [Any]?
        var waiters: [Waiter]
        var timer: DispatchWorkItem?

        var json: [String: Any] {
            var d: [String: Any] = [
                "id": id, "kind": kind, "band": band, "from": from, "to": to, "preview": preview, "rule": rule,
                "created": Int64(created.timeIntervalSince1970 * 1000),
                "text": text, "chars": chars, "files": files, "project": project,
            ]
            if let deadline { d["deadline"] = Int64(deadline.timeIntervalSince1970 * 1000) }
            if !secrets.isEmpty { d["secrets"] = secrets }
            if let parts { d["parts"] = parts }
            return d
        }
    }

    private let queue: DispatchQueue
    /// 队列变了（加了、解决了、断线删掉了）
    var onChange: (@Sendable () -> Void)?
    private(set) var items: [Item] = []
    private var counter = 0

    init(queue: DispatchQueue) { self.queue = queue }

    /// `{"items":[…]}`
    func snapshot() -> Data {
        let body: [String: Any] = ["items": items.map(\.json)]
        return (try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data(#"{"items":[]}"#.utf8)
    }

    /// 只有 items 数组本身，给 SSE 用
    func itemsArray() -> Data {
        (try? JSONSerialization.data(withJSONObject: items.map(\.json), options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data("[]".utf8)
    }

    /// 排进一件事。同一个 band 再问一次，接着等原来那条。返回 nil 表示成功，否则是出错说明（对应 400）。
    func ask(_ body: [String: Any], conn: HTTPConnection, keepAlive: Bool, defaultTimeoutSec: Int, now: Date = Date()) -> String? {
        let kind = body["kind"] as? String ?? "cross"
        guard Self.kinds.contains(kind) else { return "kind 只能是 cross、relay、split" }
        let band = body["band"] as? String ?? ""
        let waiter = Waiter(conn: conn, keepAlive: keepAlive)
        if !band.isEmpty, let i = items.firstIndex(where: { $0.band == band }) {
            items[i].waiters.append(waiter)
            return nil
        }
        let fullText = body["text"] as? String ?? ""
        let text = String(fullText.prefix(Self.maxText))
        var preview = String((body["preview"] as? String ?? "").prefix(Self.maxPreview))
        if preview.isEmpty {
            let firstLine = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
            preview = String(firstLine.prefix(Self.maxPreview))
        }
        counter += 1
        var item = Item(
            id: "q\(counter)", kind: kind, band: band,
            from: body["from"] as? [String: Any] ?? [String: Any](),
            to: body["to"] as? [String: Any] ?? [String: Any](),
            preview: preview, rule: body["rule"] as? String ?? "", created: now, deadline: nil,
            secrets: (body["secrets"] as? [Any])?.compactMap { $0 as? String } ?? [],
            text: text, chars: (body["chars"] as? NSNumber)?.intValue ?? fullText.count,
            files: (body["files"] as? [Any])?.compactMap { $0 as? String } ?? [],
            project: body["project"] as? String ?? "",
            parts: kind == "split" ? body["parts"] as? [Any] : nil,
            waiters: [waiter])
        if kind == "cross" {
            let given = (body["timeoutSec"] as? NSNumber)?.intValue ?? 0
            let sec = min(86400, max(1, given > 0 ? given : defaultTimeoutSec))
            item.deadline = now.addingTimeInterval(TimeInterval(sec))
            let id = item.id
            let work = DispatchWorkItem { [weak self] in _ = self?.resolve(id: id, action: "timeout") }
            item.timer = work
            queue.asyncAfter(deadline: .now() + .milliseconds(sec * 1000), execute: work)
        }
        items.append(item)
        onChange?()
        return nil
    }

    /// 给所有挂着的连接回话，并把这一条拿掉。没有这个 id 返回 false。
    @discardableResult
    func resolve(id: String, action: String) -> Bool {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return false }
        let item = items.remove(at: i)
        item.timer?.cancel()
        let body = Data("{\"action\":\"\(action)\"}".utf8)
        for w in item.waiters {
            w.conn.respond(status: 200, headers: Hub.cors + [("Cache-Control", "no-store")], body: body,
                           contentType: "application/json; charset=utf-8", keepAlive: w.keepAlive)
        }
        onChange?()
        return true
    }

    /// 挂着的连接断了：没人等了的就拿掉
    func connectionClosed(_ connID: ObjectIdentifier) {
        var removed = false
        var kept: [Item] = []
        for var item in items {
            item.waiters.removeAll { $0.conn.id == connID }
            if item.waiters.isEmpty {
                item.timer?.cancel()
                removed = true
            } else {
                kept.append(item)
            }
        }
        guard removed else { return }
        items = kept
        onChange?()
    }
}
