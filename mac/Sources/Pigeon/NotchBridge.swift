import AppKit
import PigeonNotch

/// 把本机服务的数据喂给原生刘海，把刘海上的操作交回本机服务。
///
/// 刘海那个包（mac/Notch）不认识本机服务，只认 `NotchModel` 和 `NotchActions`。这里负责两边的翻译：
/// 设备和对话来自 `GET /api/lofts` 那份数据，等你的一队来自 `GET /api/queue`，在路上的消息、回信、
/// 等你批准的对话来自 `Watch.Snapshot`，其余读设置。任何一样变了就整份重算一次，交给 `notch.update`。
@MainActor
final class NotchBridge {
    let notch: NotchController
    private let hub: Hub
    /// 打开主窗口；参数是要翻到的页（空串就是不翻页）
    private let showWindow: (String) -> Void

    private var lofts: [[String: Any]] = []
    private var queue: [[String: Any]] = []
    private var snapshot = Watch.Snapshot()
    private var agents: Agents?
    private var settings: [String: Any] = [:]
    private var codexModels: [Settings.CodexModel] = []
    /// 在刘海上看过的回信（只记在内存里）
    private var readBands: Set<String> = []
    private var rebuildPending = false

    /// 菜单栏图标上要挂的数字变了
    var onBadge: ((Int) -> Void)? {
        didSet { notch.onBadgeChange = onBadge }
    }

    init(hub: Hub, showWindow: @escaping (String) -> Void) {
        self.hub = hub
        self.showWindow = showWindow
        notch = NotchController(model: .empty, actions: .none, placement: .hidden)
        notch.actions = makeActions()
        reloadSettings()
    }

    // MARK: 数据进来

    func update(snapshot s: Watch.Snapshot) { snapshot = s; scheduleRebuild() }
    func update(agents a: Agents) { agents = a; scheduleRebuild() }

    /// `GET /api/lofts` 那份 JSON
    func update(lofts data: Data) {
        let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        lofts = root?["lofts"] as? [[String: Any]] ?? []
        scheduleRebuild()
    }

    /// `GET /api/queue` 那份 JSON
    func update(queue data: Data) {
        let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        queue = root?["items"] as? [[String: Any]] ?? []
        scheduleRebuild()
    }

    /// 设置变了：重读设置和 Codex 的模型列表，刘海还是菜单栏也跟着换
    func reloadSettings() {
        settings = Settings.object()
        codexModels = Settings.codexModels()
        notch.placement = Settings.notchEnabled() ? .notch : .menuBar
        scheduleRebuild()
    }

    /// 网页让刘海打开某个状态（`POST /api/notch` 的请求体）
    func handleRequest(_ data: Data) {
        guard let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let state = NotchState(rawValue: body["state"] as? String ?? "") else { return }
        if state == .idle { notch.collapse(); return }
        let session = body["session"] as? String ?? "", band = body["band"] as? String ?? ""
        notch.show(state, target: TargetKey(body["target"] as? String ?? ""),
                   session: session.isEmpty ? nil : session, band: band.isEmpty ? nil : band,
                   demo: body["demo"] as? Bool ?? false)
    }

    /// 点菜单栏图标：在图标下面展开或收起同一个面板
    func toggleFromMenuBar(anchor: NSRect?) { notch.toggleFromMenuBar(anchor: anchor) }

    /// 同一轮里来的几次变化合成一次重算
    private func scheduleRebuild() {
        guard !rebuildPending else { return }
        rebuildPending = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.rebuildPending = false
            self.notch.update(self.build())
        }
    }

    // MARK: 操作出去

    private func makeActions() -> NotchActions {
        NotchActions(
            resolve: { [weak self] id, decision in self?.hub.resolveQueue(id: id, action: decision.rawValue) },
            jump: { [weak self] target in self?.jump(target) },
            setPaused: { [weak self] on in self?.hub.setPaused(loft: nil, on: on) },
            send: { [weak self] request in await self?.send(request) ?? .failed("应用正在退出") },
            suggest: { [weak self] text in await self?.suggest(text) },
            autoRelay: { [weak self] id in
                // “以后直接转”：关掉“转派前问我”，再放行这一件
                self?.hub.updateSettings { root in
                    var post = root["post"] as? [String: Any] ?? [:]
                    post["askRelay"] = false
                    root["post"] = post
                }
                self?.hub.resolveQueue(id: id, action: QueueDecision.release.rawValue)
            },
            markReplyRead: { [weak self] band in
                self?.readBands.insert(band)
                self?.scheduleRebuild()
            },
            forward: { _ in },
            openMainWindow: { [weak self] page in self?.showWindow(page.rawValue) }
        )
    }

    private func jump(_ target: Endpoint) {
        // Claude Code 没有“打开某个对话”的地址，切到它所在的应用
        if target.agent == .claude {
            Notifier.focusClaude(fallback: { [showWindow] in showWindow("") })
            return
        }
        let body: [String: Any] = ["loft": target.device, "agent": target.agent.rawValue, "session": target.session]
        hub.open(Self.data(body)) { _ in }
    }

    private func send(_ request: SendRequest) async -> SendOutcome {
        var body: [String: Any] = [
            "to": ["loft": request.to.device, "agent": request.to.agent.rawValue, "session": request.session],
            "text": request.text, "model": request.model, "effort": request.effort?.rawValue ?? "",
            "why": ["reason": "你在 Pigeon 里自己派的"],
        ]
        if request.session.isEmpty, let project = defaultProject(loft: request.to.device) { body["project"] = project }
        let hub = self.hub
        let payload = Self.data(body)
        let out: Data = await withCheckedContinuation { c in hub.send(payload) { c.resume(returning: $0) } }
        let reply = (try? JSONSerialization.jsonObject(with: out)) as? [String: Any] ?? [:]
        if reply["ok"] as? Bool == true { return .sent(band: reply["band"] as? String ?? "") }
        return .failed(Self.text(reply["error"]) ?? "没发出去")
    }

    private func suggest(_ text: String) async -> TargetKey? {
        let hub = self.hub
        let payload = Self.data(["text": text])
        let out: Data = await withCheckedContinuation { c in hub.suggest(payload) { c.resume(returning: $0) } }
        let reply = (try? JSONSerialization.jsonObject(with: out)) as? [String: Any] ?? [:]
        guard let key = TargetKey(reply["suggested"] as? String ?? ""), key.agent == .codex else { return nil }
        return key
    }

    /// 在别的电脑上新开对话要说放进哪个项目：用那台最近用过的对话所在的项目，没有就用第一个。本机不用说
    private func defaultProject(loft id: String) -> String? {
        guard id != "local", let loft = lofts.first(where: { $0["id"] as? String == id }) else { return nil }
        let projects = (loft["projects"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String }
        let recent = (loft["sessions"] as? [[String: Any]] ?? [])
            .sorted { Self.number($0["updated"]) > Self.number($1["updated"]) }
            .compactMap { $0["projectId"] as? String }
            .first { projects.contains($0) }
        return recent ?? projects.first
    }

    // MARK: 拼成刘海要的样子

    private func build() -> NotchModel {
        let devices = settings["devices"] as? [String: Any] ?? [:]
        let hidden = Set(devices["hidden"] as? [String] ?? [])
        let off = devices["off"] as? [String: [String]] ?? [:]
        let defaults = devices["models"] as? [String: [String: Any]] ?? [:]
        let post = settings["post"] as? [String: Any] ?? [:]
        let shown = lofts.filter { !hidden.contains($0["id"] as? String ?? "") }

        // 对话
        var sessions: [SessionInfo] = []
        for loft in shown {
            let id = loft["id"] as? String ?? ""
            for s in loft["sessions"] as? [[String: Any]] ?? [] where s["relay"] as? Bool != true {
                guard let agent = AgentKind(rawValue: s["agent"] as? String ?? ""), let sid = s["id"] as? String else { continue }
                sessions.append(SessionInfo(id: sid, agent: agent, device: id, deviceName: deviceName(id), isLocal: id == "local",
                                            title: Self.text(s["title"]) ?? "没有标题的对话",
                                            state: RunState(rawValue: s["state"] as? String ?? "") ?? .idle,
                                            detail: s["detail"] as? String ?? "", parent: s["parent"] as? String ?? ""))
            }
        }

        // 本机接着哪几家：两耳和光带用
        let installed: [(AgentKind, Bool)] = agents.map {
            [(.claude, $0.claude.installed), (.codex, $0.codex.installed), (.cursor, $0.cursor.installed), (.deepseek, $0.deepseek.installed),
             (.antigravity, $0.antigravity.installed)]
        } ?? [(.claude, true), (.codex, true)]
        let localOff = Set(off["local"] ?? [])
        let present = installed.filter { $0.1 && !localOff.contains($0.0.rawValue) }.map(\.0)
        let local = present.map { agent -> LocalAgent in
            guard agent != .cursor else { return LocalAgent(agent: agent, state: .off) } // 还没接上
            let states = sessions.filter { $0.isLocal && $0.agent == agent }.map(\.state)
            let worst: RunState = [.wait, .error, .run, .done].first(where: states.contains) ?? .idle
            return LocalAgent(agent: agent, state: worst)
        }

        // 等你的一队
        let rules = ((settings["dispatch"] as? [String: Any])?["rules"] as? [[String: Any]]) ?? []
        let items = queue.compactMap { q -> QueueItem? in
            guard let id = q["id"] as? String else { return nil }
            let from = endpoint(q["from"]), to = endpoint(q["to"])
            let ruleID = q["rule"] as? String ?? ""
            let rule = ruleID.isEmpty ? nil : rules.first { $0["id"] as? String == ruleID }
            let parts = (q["parts"] as? [[String: Any]] ?? []).map { QueuePart(to: endpoint($0["to"]), preview: $0["preview"] as? String ?? "") }
            return QueueItem(id: id, kind: QueueKind(rawValue: q["kind"] as? String ?? "") ?? .cross, band: q["band"] as? String ?? "",
                             from: from, to: to, preview: q["preview"] as? String ?? "", text: q["text"] as? String ?? "",
                             chars: (q["chars"] as? NSNumber)?.intValue, files: q["files"] as? [String] ?? [],
                             project: q["project"] as? String ?? "", ruleLabel: Self.text(rule?["when"]) ?? "",
                             created: Self.date(q["created"]) ?? Date(), deadline: Self.date(q["deadline"]),
                             secrets: q["secrets"] as? [String] ?? [], parts: parts,
                             canJump: from.agent != .you)
        }

        // 等你批准或回答的对话
        let prompts = snapshot.waiting.map { w -> WaitingPrompt in
            let codex = w.session.hasPrefix("codex:")
            let sid = codex ? String(w.session.dropFirst("codex:".count)) : w.session
            let who = Endpoint(agent: codex ? .codex : .claude, session: sid,
                               sessionTitle: sessions.first { $0.id == sid }?.title ?? w.folder)
            return WaitingPrompt(id: w.session, who: who, title: w.title, message: w.message, since: w.since)
        }

        // 在路上的消息和最近的回信
        let notes = snapshot.notes.map {
            NoteInFlight(band: $0.band, from: endpoint($0.from), to: endpoint($0.to),
                         state: NoteState(rawValue: $0.state) ?? .flying, title: $0.preview, since: $0.since)
        }
        let replies = snapshot.replies.map { r -> Reply in
            let answered = endpoint(r.to)
            return Reply(band: r.band, from: answered, to: endpoint(r.from), title: r.preview, answer: r.answer, at: r.at,
                         unread: !readBands.contains(r.band), canForward: false,
                         canJump: answered.agent == .codex && !answered.session.isEmpty, duration: Watch.duration(r.took))
        }

        // 派活面板
        let codexDefault = (settings["codex"] as? [String: Any]) ?? [:]
        let modelOptions = codexModels.map { ModelOption(id: $0.slug, efforts: $0.efforts.compactMap(Effort.init(rawValue:))) }
        func refs(_ loft: String, _ agent: AgentKind = .codex) -> [SessionRef] {
            sessions.filter { $0.device == loft && $0.agent == agent && $0.parent.isEmpty }.prefix(20).map { SessionRef(id: $0.id, title: $0.title) }
        }
        var compose: [ComposeDevice] = []
        for loft in shown {
            let id = loft["id"] as? String ?? ""
            if id == "local" {
                let list = present.map { agent -> ComposeAgent in
                    switch agent {
                    case .codex:
                        let saved = defaults["codex@local"] ?? [:]
                        let model = Self.text(saved["model"]) ?? Self.text(codexDefault["model"]) ?? modelOptions.first?.id ?? ""
                        let effort = Effort(rawValue: Self.text(saved["effort"]) ?? Self.text(codexDefault["effort"]) ?? "")
                        return ComposeAgent(agent: .codex, models: modelOptions, defaultModel: model, defaultEffort: effort, sessions: refs("local"))
                    case .claude:
                        return ComposeAgent(agent: .claude, enabled: false, disabledReason: "Claude Code 现在只能发出，还不能接收消息")
                    case .deepseek:
                        // DSH 用它自己配的模型
                        return ComposeAgent(agent: .deepseek, sessions: refs("local", .deepseek))
                    case .antigravity:
                        let saved = defaults["antigravity@local"] ?? [:]
                        let tiers = ["flash_lite", "flash", "pro"].map { ModelOption(id: $0) }
                        return ComposeAgent(agent: .antigravity, models: tiers, defaultModel: Self.text(saved["model"]) ?? "flash", sessions: refs("local", .antigravity))
                    default:
                        return ComposeAgent(agent: agent, enabled: false, disabledReason: "\(agent.displayName) 还没接上")
                    }
                }
                compose.append(ComposeDevice(id: id, name: deviceName(id), isLocal: true, agents: list))
            } else {
                guard !Set(off[id] ?? []).contains("codex") else { continue }
                // 别的电脑上只有 Codex。命令行已经能给远程新开的对话指定模型，这里还没接上（见 docs/TODO.md），先不列模型
                compose.append(ComposeDevice(id: id, name: deviceName(id), isLocal: false, online: loft["online"] as? Bool ?? true,
                                             agents: [ComposeAgent(agent: .codex, sessions: refs(id))]))
            }
        }
        let hasLocalCodex = compose.first { $0.isLocal }?.agents.contains { $0.agent == .codex && $0.enabled } ?? false
        let firstRemote = compose.first { !$0.isLocal }?.id
        let defaultTarget = hasLocalCodex ? TargetKey(agent: .codex, device: "local") : firstRemote.map { TargetKey(agent: .codex, device: $0) }

        let leadRaw = settings["lead"] as? [String: Any] ?? [:]
        let lead: Lead = leadRaw["kind"] as? String == "you" ? .you
            : .agent(AgentKind(rawValue: leadRaw["agent"] as? String ?? "") ?? .claude, device: Self.text(leadRaw["loft"]) ?? "local")
        let timeout = (post["crossTimeoutSec"] as? NSNumber)?.intValue ?? 90

        return NotchModel(
            paused: ((settings["paused"] as? [String: Any])?["all"] as? Bool) ?? false,
            lead: lead, agents: local, sessions: sessions, queue: items, prompts: prompts, notes: notes, replies: replies,
            compose: ComposeData(devices: compose, defaultTarget: defaultTarget, crossNeedsConfirm: (post["confirmRemote"] as? Bool) ?? true),
            settings: NotchSettings(secrets: SecretsMode(rawValue: (settings["secrets"] as? [String: Any])?["mode"] as? String ?? "") ?? .warn,
                                    crossTimeoutSec: timeout > 0 ? timeout : 90))
    }

    /// 设备显示的名字：改过名用改的，本机叫“本机”，别的电脑用它自己的名字
    private func deviceName(_ id: String, fallback: String = "") -> String {
        let names = (settings["devices"] as? [String: Any])?["names"] as? [String: String] ?? [:]
        if let n = names[id], !n.isEmpty { return n }
        if id == "local" { return "本机" }
        let loft = lofts.first { $0["id"] as? String == id }
        return Self.text(loft?["name"]) ?? (fallback.isEmpty ? "另一台电脑" : fallback)
    }

    private func sessionTitle(_ loft: String, _ session: String) -> String? {
        guard !session.isEmpty else { return nil }
        let sessions = lofts.first { $0["id"] as? String == loft }?["sessions"] as? [[String: Any]] ?? []
        return Self.text(sessions.first { $0["id"] as? String == session }?["title"])
    }

    /// 接口里的一端（`{loft, loft_name, agent, session, title}`）
    private func endpoint(_ raw: Any?) -> Endpoint {
        let d = raw as? [String: Any] ?? [:]
        let loft = Self.text(d["loft"]) ?? "local", session = d["session"] as? String ?? ""
        return Endpoint(agent: AgentKind(rawValue: d["agent"] as? String ?? "") ?? .you, device: loft,
                        deviceName: deviceName(loft, fallback: d["loft_name"] as? String ?? ""), isLocal: loft == "local",
                        session: session, sessionTitle: Self.text(d["title"]) ?? sessionTitle(loft, session) ?? "")
    }

    private func endpoint(_ p: Watch.Party) -> Endpoint {
        Endpoint(agent: AgentKind(rawValue: p.agent) ?? .you, device: p.loft, deviceName: deviceName(p.loft, fallback: p.loftName),
                 isLocal: !p.isRemote, session: p.session, sessionTitle: p.title.isEmpty ? (sessionTitle(p.loft, p.session) ?? "") : p.title)
    }

    // MARK: 小工具

    private static func data(_ obj: [String: Any]) -> Data {
        (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8)
    }

    /// 非空的字符串，否则 nil
    private static func text(_ raw: Any?) -> String? {
        guard let s = raw as? String, !s.isEmpty else { return nil }
        return s
    }

    private static func number(_ raw: Any?) -> Double { (raw as? NSNumber)?.doubleValue ?? 0 }

    /// 接口里的时间是毫秒
    private static func date(_ raw: Any?) -> Date? {
        let ms = number(raw)
        return ms > 0 ? Date(timeIntervalSince1970: ms / 1000) : nil
    }
}
