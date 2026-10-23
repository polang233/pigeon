import Foundation

/// 用量统计：读 Claude Code 和 Codex 自己写的对话记录（hook 里带 transcript_path），按天、按 agent 累计 token。
///
/// - Claude：每条 assistant 消息带 `message.usage` 和 `message.model`；同一条消息拆成几行时 usage 重复，按 message.id 去重。
/// - Codex：`token_count` 事件给的是会话累计值，取相邻两次的差额；`turn_context` 里有模型名。
/// - 每个文件记住读到哪里，只读新增的部分；状态存在 usage.json，重开应用不会重复计。
/// 所有方法只在自己的 queue 上调用。
final class Usage: @unchecked Sendable {
    struct Tally: Codable, Equatable, Sendable {
        var input = 0, output = 0, cacheRead = 0, cacheWrite = 0, messages = 0
        static func + (a: Tally, b: Tally) -> Tally {
            Tally(input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead,
                  cacheWrite: a.cacheWrite + b.cacheWrite, messages: a.messages + b.messages)
        }
        static func - (a: Tally, b: Tally) -> Tally {
            Tally(input: a.input - b.input, output: a.output - b.output, cacheRead: a.cacheRead - b.cacheRead,
                  cacheWrite: a.cacheWrite - b.cacheWrite, messages: a.messages - b.messages)
        }
    }
    private struct FileState: Codable {
        var offset: UInt64 = 0
        var lastID: String?        // Claude：上一条消息的 id
        var lastTally: Tally?      // Claude：上一条消息已经计入的量
        var lastTotal: Tally?      // Codex：上一次的会话累计值
        var day: String?           // 上一次计入的日期（Codex 差额按它记）
        var seenAt: Date = Date()
    }
    private struct Book: Codable {
        var days: [String: [String: Tally]] = [:]   // 日期 → agent → 量
        var models: [String: String] = [:]          // agent → 最近用的模型
        var files: [String: FileState] = [:]
    }

    /// 发给网页的摘要
    struct Summary: Encodable, Equatable {
        struct Agent: Encodable, Equatable {
            var model: String?
            var today: Tally
            var week: Tally
        }
        var agents: [String: Agent]
        var day: String
    }

    let queue = DispatchQueue(label: "dev.polang.meerkat.usage", qos: .utility)
    private var book = Book()
    private var lastScan: [String: Date] = [:]
    private var dirty = false
    private let file = Paths.settingsFile.deletingLastPathComponent().appendingPathComponent("usage.json")
    private static let dayFormat: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    // 只在 Usage 自己的串行队列上用
    nonisolated(unsafe) private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    init() {
        if let data = try? Data(contentsOf: file), let saved = try? JSONDecoder().decode(Book.self, from: data) {
            book = saved
        }
    }

    /// 读一个对话记录文件新增的部分。`force` 为假时同一文件 3 秒内只读一次。返回是否有新增用量。
    func scan(path: String, agent: String, kind: Kind, force: Bool) -> Bool {
        let now = Date()
        if !force, let last = lastScan[path], now.timeIntervalSince(last) < 3 { return false }
        lastScan[path] = now
        guard let handle = FileHandle(forReadingAtPath: path) else { return false }
        defer { try? handle.close() }
        var state = book.files[path] ?? FileState()
        let size = (try? handle.seekToEnd()) ?? 0
        if size < state.offset { state = FileState() }  // 文件被重写过，从头来
        guard size > state.offset else { return false }
        try? handle.seek(toOffset: state.offset)
        guard let data = try? handle.readToEnd() else { return false }
        // 只处理完整的行，最后半行留到下次
        guard let lastNewline = data.lastIndex(of: 0x0A) else { return false }
        let chunk = data[data.startIndex...lastNewline]
        state.offset += UInt64(chunk.count)

        var changed = false
        for line in chunk.split(separator: 0x0A) {
            guard let obj = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any] else { continue }
            let day = Self.day(of: obj["timestamp"] as? String) ?? Self.dayFormat.string(from: now)
            switch kind {
            case .claude: changed = claudeLine(obj, day: day, agent: agent, state: &state) || changed
            case .codex: changed = codexLine(obj, day: day, agent: agent, state: &state) || changed
            }
        }
        state.seenAt = now
        book.files[path] = state
        dirty = true
        return changed
    }

    enum Kind { case claude, codex }

    /// 包装层跑的临时任务没有对话记录文件，只能用它报上来的总量
    func add(agent: String, usage: [String: Any], model: String?) {
        let t = Tally(input: Self.int(usage["input_tokens"]) - Self.int(usage["cached_input_tokens"]),
                      output: Self.int(usage["output_tokens"]),
                      cacheRead: Self.int(usage["cached_input_tokens"]), cacheWrite: 0, messages: 1)
        record(t, agent: agent, day: Self.dayFormat.string(from: Date()))
        if let model, !model.isEmpty { book.models[agent] = model }
        dirty = true
    }

    func summary() -> Summary {
        let now = Date()
        let today = Self.dayFormat.string(from: now)
        let weekDays = (0..<7).compactMap { Calendar.current.date(byAdding: .day, value: -$0, to: now) }.map(Self.dayFormat.string)
        var agents: [String: Summary.Agent] = [:]
        let names = Set(book.days.values.flatMap(\.keys)).union(book.models.keys)
        for name in names {
            let week = weekDays.reduce(Tally()) { $0 + (book.days[$1]?[name] ?? Tally()) }
            agents[name] = Summary.Agent(model: book.models[name], today: book.days[today]?[name] ?? Tally(), week: week)
        }
        return Summary(agents: agents, day: today)
    }

    /// 写回磁盘；顺便清掉 30 天前的日期和很久没动的文件记录
    func saveIfNeeded() {
        guard dirty else { return }
        dirty = false
        let cutoff = Self.dayFormat.string(from: Date().addingTimeInterval(-30 * 86400))
        book.days = book.days.filter { $0.key >= cutoff }
        book.files = book.files.filter { Date().timeIntervalSince($0.value.seenAt) < 30 * 86400 }
        guard let data = try? JSONEncoder().encode(book) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: file, options: .atomic)
    }

    // MARK: 解析

    private func claudeLine(_ obj: [String: Any], day: String, agent: String, state: inout FileState) -> Bool {
        guard let msg = obj["message"] as? [String: Any], let usage = msg["usage"] as? [String: Any],
              let id = msg["id"] as? String else { return false }
        if let model = msg["model"] as? String, !model.isEmpty, !model.hasPrefix("<") { book.models[agent] = model }
        let t = Tally(input: Self.int(usage["input_tokens"]), output: Self.int(usage["output_tokens"]),
                      cacheRead: Self.int(usage["cache_read_input_tokens"]),
                      cacheWrite: Self.int(usage["cache_creation_input_tokens"]), messages: 1)
        if id == state.lastID, let prev = state.lastTally {
            // 同一条消息的后续行：只补上差额（通常为 0）
            let delta = t - prev
            guard delta != Tally() else { return false }
            record(Tally(input: delta.input, output: delta.output, cacheRead: delta.cacheRead, cacheWrite: delta.cacheWrite, messages: 0),
                   agent: agent, day: day)
        } else {
            record(t, agent: agent, day: day)
        }
        state.lastID = id
        state.lastTally = t
        return true
    }

    private func codexLine(_ obj: [String: Any], day: String, agent: String, state: inout FileState) -> Bool {
        let type = obj["type"] as? String
        let payload = obj["payload"] as? [String: Any] ?? [:]
        if type == "turn_context", let model = payload["model"] as? String, !model.isEmpty {
            book.models[agent] = model
            return false
        }
        guard type == "event_msg", payload["type"] as? String == "token_count",
              let info = payload["info"] as? [String: Any], let total = info["total_token_usage"] as? [String: Any] else { return false }
        let cached = Self.int(total["cached_input_tokens"])
        let now = Tally(input: Self.int(total["input_tokens"]) - cached, output: Self.int(total["output_tokens"]),
                        cacheRead: cached, cacheWrite: Self.int(total["cache_write_input_tokens"]), messages: 1)
        let prev = state.lastTotal ?? Tally()
        let delta = now - prev
        state.lastTotal = now
        guard delta.input > 0 || delta.output > 0 || delta.cacheRead > 0 else { return false }
        record(delta, agent: agent, day: day)
        return true
    }

    private func record(_ t: Tally, agent: String, day: String) {
        book.days[day, default: [:]][agent, default: Tally()] = (book.days[day]?[agent] ?? Tally()) + t
    }

    private static func day(of timestamp: String?) -> String? {
        guard let timestamp else { return nil }
        let date = iso.date(from: timestamp) ?? ISO8601DateFormatter().date(from: timestamp)
        return date.map(dayFormat.string)
    }

    private static func int(_ v: Any?) -> Int {
        (v as? Int) ?? (v as? NSNumber)?.intValue ?? 0
    }

    /// 包装层任务结束时只给了 thread id：到 ~/.codex/sessions 里找这个会话的记录文件
    static func codexRollout(thread: String) -> String? {
        let root = CodexHooks.codexHome.appendingPathComponent("sessions")
        guard let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) else { return nil }
        // 最近的放在最后的日期目录里；文件不多，直接找
        for case let url as URL in walker where url.lastPathComponent.hasSuffix("\(thread).jsonl") {
            return url.path
        }
        return nil
    }
}
