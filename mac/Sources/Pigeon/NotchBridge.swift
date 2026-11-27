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
    /// 每个对话的附加信息（经哪条路、工作目录），跳回对话时用
    private var sessionMeta: [String: (via: String, cwd: String)] = [:]
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
        var meta: [String: (via: String, cwd: String)] = [:]
        for loft in lofts {
            let dev = loft["id"] as? String ?? ""
            for s in loft["sessions"] as? [[String: Any]] ?? [] {
                if let sid = s["id"] as? String, !sid.isEmpty {
                    meta["\(dev)|\(sid)"] = (via: s["via"] as? String ?? "", cwd: s["cwd"] as? String ?? "")
                }
            }
        }
        sessionMeta = meta
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

    /// 全局快捷键（⌥ 空格）或菜单「快速派活」：在刘海或菜单栏下切换快速派活面板
    func toggleCompose(anchor: NSRect? = nil) {
        if let anchor { notch.setMenuBarAnchor(anchor) }
        if notch.state == .compose {
            notch.collapse()
        } else {
            notch.show(.compose, takeFocus: true)
        }
    }

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
        var body: [String: Any] = ["loft": target.device, "agent": target.agent.rawValue, "session": target.session]
        if target.agent == .antigravity, let meta = sessionMeta["\(target.device)|\(target.session)"], meta.via == "cli" {
            body["via"] = "cli"
            body["cwd"] = meta.cwd
        }
        hub.open(Self.data(body)) { _ in }
    }

    private func send(_ request: SendRequest) async -> SendOutcome {
        var body: [String: Any] = [
            "to": ["loft": request.to.device, "agent": request.to.agent.rawValue, "session": request.session],
            "text": request.text, "model": request.model, "effort": request.effort?.rawValue ?? "",
            "why": ["reason": "你在 Pigeon 里自己派的"],
        ]
        if request.session.isEmpty {
            if !request.cwd.isEmpty { body["cwd"] = request.cwd }
            if let project = defaultProject(loft: request.to.device) { body["project"] = project }
        }
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
        guard let key = TargetKey(reply["suggested"] as? String ?? ""),
              [.codex, .deepseek, .antigravity].contains(key.agent) else { return nil }
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
            let canJump = answered.agent == .codex ? !answered.session.isEmpty : [.deepseek, .antigravity].contains(answered.agent)
            return Reply(band: r.band, from: answered, to: endpoint(r.from), title: r.preview, answer: r.answer, at: r.at,
                         unread: !readBands.contains(r.band), canForward: false,
                         canJump: canJump, duration: Watch.duration(r.took))
        }

        // 派活面板
        let codexDefault = (settings["codex"] as? [String: Any]) ?? [:]
        let customModels = devices["customModels"] as? [String: [String]] ?? [:]
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
                        // 模型列表是插件上次从 Antigravity 读到的（系列 + 几档思考强度）；默认先看接入页选的，再看它自己的默认
                        let saved = defaults["antigravity@local"] ?? [:]
                        let (options, def) = Self.antigravityModels()
                        let model = Self.text(saved["model"]) ?? def.model ?? options.first?.id ?? ""
                        let effort = Effort(rawValue: Self.text(saved["effort"]) ?? def.effort ?? "")
                        return ComposeAgent(agent: .antigravity, models: options, defaultModel: model, defaultEffort: effort, sessions: refs("local", .antigravity))
                    default:
                        return ComposeAgent(agent: agent, enabled: false, disabledReason: "\(agent.displayName) 还没接上")
                    }
                }
                compose.append(ComposeDevice(id: id, name: deviceName(id), isLocal: true, agents: list))
            } else {
                guard !Set(off[id] ?? []).contains("codex") else { continue }
                let saved = defaults["codex@\(id)"] ?? [:]
                let mine = (customModels["codex@\(id)"] ?? [])
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { name in !name.isEmpty && !modelOptions.contains(where: { $0.id == name }) }
                    .map { ModelOption(id: $0, efforts: Effort.allCases, note: "自定义模型") }
                let remoteModels = modelOptions + mine
                let defModel = Self.text(saved["model"]) ?? remoteModels.first?.id ?? ""
                let defEffort = Effort(rawValue: Self.text(saved["effort"]) ?? "")
                compose.append(ComposeDevice(id: id, name: deviceName(id), isLocal: false, online: loft["online"] as? Bool ?? true,
                                             agents: [ComposeAgent(agent: .codex, models: remoteModels, defaultModel: defModel, defaultEffort: defEffort, sessions: refs(id))]))
            }
        }
        var localProjects: [ProjectRef] = []
        var seenPaths: Set<String> = []
        func addProject(path rawPath: String, name rawName: String? = nil) {
            let clean = (rawPath as NSString).standardizingPath
            guard !clean.isEmpty, !seenPaths.contains(clean), localProjects.count < 15 else { return }
            seenPaths.insert(clean)
            let fallback = URL(fileURLWithPath: clean).lastPathComponent
            let name = Self.text(rawName) ?? (fallback.isEmpty ? clean : fallback)
            localProjects.append(ProjectRef(name: name, path: clean))
        }
        if let localLoft = shown.first(where: { ($0["id"] as? String) == "local" }) {
            for p in localLoft["projects"] as? [[String: Any]] ?? [] {
                if let path = p["path"] as? String { addProject(path: path, name: p["name"] as? String) }
            }
            for s in localLoft["sessions"] as? [[String: Any]] ?? [] {
                if let cwd = s["cwd"] as? String { addProject(path: cwd) }
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
            compose: ComposeData(devices: compose, projects: localProjects, defaultTarget: defaultTarget, crossNeedsConfirm: (post["confirmRemote"] as? Bool) ?? true),
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
    /// ~/.pigeon/models/antigravity.json → 刘海派活面板的模型选项和它自己的默认
    static func antigravityModels() -> ([ModelOption], (model: String?, effort: String?)) {
        guard let data = try? Data(contentsOf: Paths.antigravityModelsFile),
              let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return ([], (nil, nil)) }
        let list = (root["models"] as? [[String: Any]] ?? []).compactMap { m -> ModelOption? in
            guard let id = m["id"] as? String, !id.isEmpty else { return nil }
            let efforts = (m["efforts"] as? [String] ?? []).compactMap(Effort.init(rawValue:))
            return ModelOption(id: id, efforts: efforts, note: m["name"] as? String ?? "")
        }
        let def = root["default"] as? [String: Any] ?? [:]
        return (list, (text(def["model"]), text(def["effort"])))
    }

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
