import AppKit
import Observation
import SwiftUI

/// 面板摆放出来的几何：刘海多宽、上面那一排多高
struct NotchGeometry: Equatable {
    var placement: NotchPlacement = .notch
    /// 这块屏幕有物理刘海
    var hasNotch = false
    /// 刘海（摄像头那一块）的宽度；没有刘海的屏幕上是中间留的一小段
    var notchWidth: CGFloat = 0
    /// 上面那一排的高度：刘海高，或菜单栏高
    var topHeight: CGFloat = 32

    static let openWidth: CGFloat = 440
    static let menuWidth: CGFloat = 400
    /// 光带在面板下面占的高度
    static let stripRoom: CGFloat = 8
    /// 顶上两角往外反弯的小圆角：把黑色形状和菜单栏接上，像刘海本身那样
    static let flare: CGFloat = 8
    /// 下沿圆角：收起时贴近刘海本身的圆角，展开后更大
    static let idleRadius: CGFloat = 10
    static let openRadius: CGFloat = 24
    /// 菜单栏模式下的圆角
    static let menuRadius: CGFloat = 18
    /// 面板窗口比形状大出来的透明边，给阴影和弹簧回弹留地方
    static let shadowPad: CGFloat = 36
}

/// 面板的全部状态：数据、打开到哪、选中哪件、派活的草稿。视图读它，控制器照它摆窗口。
@MainActor @Observable
final class NotchViewModel {
    // MARK: 数据
    var realModel = NotchModel.empty
    var realActions = NotchActions.none
    private(set) var demo = false
    var demoModel = NotchModel.sample()
    /// 演示里每个操作都写一句（演示程序把它打到标准输出）
    @ObservationIgnored var demoLog: (String) -> Void = { _ in }

    var model: NotchModel { demo ? demoModel : realModel }

    // MARK: 面板
    var machine = PanelMachine()
    var geometry = NotchGeometry()
    var cursor = QueueCursor()
    var compose = ComposeState()
    var focusedButton: QueueButton?
    /// 回信那一页显示哪一封；nil 是最新的一封
    var replyBand: String?
    var pointerInside = false
    /// 光带上起飞、落地时亮一下的那一段
    var pulse: [AgentKind: Date] = [:]
    var reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    /// 黑色形状现在（动画的终点）在面板窗口里的位置，左上角为原点。控制器按它放行鼠标、摆窗口
    var panelRect: CGRect = .zero

    /// 形状变化用的动画：展开带一点弹性，收起干脆；减少动态效果时只淡入淡出
    var motion: Animation {
        if reduceMotion { return .easeInOut(duration: 0.14) }
        return state == .idle ? .spring(response: 0.24, dampingFraction: 1) : .spring(response: 0.3, dampingFraction: 0.8)
    }

    /// 状态变了要不要拿键盘焦点，由控制器接
    @ObservationIgnored var onKeyAllowedChange: (Bool) -> Void = { _ in }
    @ObservationIgnored private var suggestTask: Task<Void, Never>?

    var state: NotchState { machine.state }

    // MARK: 打开和收起

    func show(_ s: NotchState, opener: PanelOpener, takeFocus: Bool, target: TargetKey? = nil, session: String? = nil, band: String? = nil) {
        let before = machine.keyAllowed
        machine.show(s, opener: opener, takeFocus: takeFocus)
        switch s {
        case .compose:
            ComposeLogic.open(&compose, target: target, session: session, in: model.compose)
        case .queue:
            cursor.sync(model.queue)
            if let band, let q = model.queue.first(where: { $0.band == band || $0.id == band }) { cursor.select(q.id, in: model.queue) }
        case .reply:
            replyBand = band
        default: break
        }
        if machine.keyAllowed != before { onKeyAllowedChange(machine.keyAllowed) }
    }

    func collapse() {
        let wasKey = machine.keyAllowed
        machine.collapse()
        focusedButton = nil
        if demo { demo = false }
        if wasKey { onKeyAllowedChange(false) }
    }

    func setDemo(_ on: Bool) {
        if on && !demo { demoModel = NotchModel.sample() ; compose = ComposeState() }
        if !on && demo { compose = ComposeState() }
        demo = on
        cursor.sync(model.queue)
    }

    func clickedInside() {
        let before = machine.keyAllowed
        machine.clickedInside()
        if machine.keyAllowed != before { onKeyAllowedChange(machine.keyAllowed) }
    }

    func clickedOutside() {
        let before = machine.keyAllowed
        machine.clickedOutside()
        if !machine.isOpen { focusedButton = nil; if demo { demo = false } }
        if machine.keyAllowed != before { onKeyAllowedChange(machine.keyAllowed) }
    }

    // MARK: 等你的一队

    var selectedItem: QueueItem? { cursor.selected(in: model.queue) }

    func select(_ item: QueueItem) { cursor.select(item.id, in: model.queue) }

    func step(_ d: Int) { cursor.step(d, in: model.queue) }

    func press(_ b: QueueButton, on item: QueueItem) {
        switch b {
        case .jump: jump(item.from)
        case .autoRelay:
            if demo { demoLog("autoRelay \(item.id)"); demoRemove(item.id) } else { realActions.autoRelay(item.id) }
        default:
            if let d = QueueLogic.decision(for: b) { resolve(item, d) }
        }
    }

    func resolve(_ item: QueueItem, _ d: QueueDecision) {
        if demo {
            demoLog("resolve \(item.id) \(d.rawValue)")
            demoRemove(item.id)
        } else {
            realActions.resolve(item.id, d)
        }
    }

    func releaseSelected() {
        guard let it = selectedItem, let d = QueueLogic.enterDecision(it, mode: model.settings.secrets, now: Date()) else { return }
        resolve(it, d)
    }

    func blockSelected() {
        guard let it = selectedItem else { return }
        resolve(it, .block)
    }

    private func demoRemove(_ id: String) {
        demoModel.queue.removeAll { $0.id == id }
        queueChanged(old: nil)
    }

    /// 队列变了以后：选中跟着走，空了就收起，来了新的看要不要自动打开
    func queueChanged(old: [QueueItem]?, autoOpen: Bool = false) {
        let items = model.queue
        let oldIDs = Set((old ?? []).map(\.id))
        let arrived = old != nil && items.contains { !oldIDs.contains($0.id) }
        let becameEmpty = items.isEmpty && (old == nil || !(old ?? []).isEmpty)
        machine.queueChanged(arrived: arrived, becameEmpty: becameEmpty, autoOpen: autoOpen)
        if arrived, machine.state == .queue, let newest = items.last(where: { !oldIDs.contains($0.id) }), machine.opener == .attention {
            cursor.select(newest.id, in: items)
        }
        cursor.sync(items)
        if !machine.isOpen { focusedButton = nil }
    }

    // MARK: 其他操作

    func jump(_ e: Endpoint) {
        if demo { demoLog("jump \(e.key) \(e.session)") } else { realActions.jump(e) }
    }

    func setPaused(_ on: Bool) {
        if demo { demoLog("setPaused \(on)"); demoModel.paused = on } else { realActions.setPaused(on) }
    }

    func openMain(_ p: MainPage) {
        if demo { demoLog("openMainWindow \(p.rawValue)") } else { realActions.openMainWindow(p) }
        collapse()
    }

    var currentReply: Reply? {
        let r = model.replies
        if let b = replyBand, let x = r.first(where: { $0.band == b }) { return x }
        return r.first(where: \.unread) ?? r.first
    }

    func markRead(_ r: Reply) {
        if demo {
            demoLog("markReplyRead \(r.band)")
            if let i = demoModel.replies.firstIndex(where: { $0.band == r.band }) { demoModel.replies[i].unread = false }
        } else {
            realActions.markReplyRead(r.band)
        }
    }

    func forward(_ r: Reply) {
        if demo { demoLog("forward \(r.band)") } else { realActions.forward(r.band) }
        markRead(r)
        collapse()
    }

    // MARK: 快速派活

    func draftChanged(_ v: String) {
        compose.draft = v
        compose.error = nil
        suggestTask?.cancel()
        let text = v.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { ComposeLogic.applySuggestion(&compose, nil, in: model.compose); return }
        let isDemo = demo, actions = realActions
        suggestTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            let k: TargetKey? = isDemo ? Self.demoSuggest(text) : await actions.suggest(text)
            guard let self, !Task.isCancelled, self.compose.draft.trimmingCharacters(in: .whitespacesAndNewlines) == text else { return }
            ComposeLogic.applySuggestion(&self.compose, k, in: self.model.compose)
        }
    }

    /// 演示里的建议：说到 Windows 就给 CHEN 上的 Codex，说到图就给本机 Codex
    static func demoSuggest(_ t: String) -> TargetKey? {
        if t.localizedCaseInsensitiveContains("windows") { return TargetKey(agent: .codex, device: "remote-control:env_chen") }
        if t.contains("图") || t.localizedCaseInsensitiveContains("icon") { return TargetKey(agent: .codex, device: "local") }
        if t.contains("审") { return TargetKey(agent: .claude, device: "local") }
        return nil
    }

    func send() {
        guard !compose.sending, let req = ComposeLogic.request(compose, in: model.compose) else {
            compose.error = ComposeLogic.blockReason(compose, in: model.compose)
            return
        }
        let cross = ComposeLogic.isCross(compose, in: model.compose)
        compose.sending = true
        compose.error = nil
        let isDemo = demo, actions = realActions
        Task { [weak self] in
            let out: SendOutcome
            if isDemo {
                self?.demoLog("send \(req.to) session=\(req.session) model=\(req.model) effort=\(req.effort?.rawValue ?? "-") text=\(req.text)")
                try? await Task.sleep(for: .milliseconds(600))
                out = req.text.contains("失败") ? .failed("演示：那台没回应，没发出") : .sent(band: "t-demo")
            } else {
                out = await actions.send(req)
            }
            guard let self else { return }
            self.compose.sending = false
            switch out {
            case .failed(let msg):
                self.compose.error = msg
            case .sent(let band):
                self.compose.sentBand = band
                self.compose.draft = ""
                self.compose.suggestion = nil
                if isDemo && cross {
                    var q = NotchModel.sampleItem(.cross)
                    q.preview = String(req.text.prefix(80)); q.text = req.text; q.chars = req.text.count
                    q.from = Endpoint(agent: .you)
                    self.demoModel.queue.append(q)
                }
                try? await Task.sleep(for: .milliseconds(900))
                guard self.state == .compose, self.compose.sentBand == band else { return }
                // 跨设备的还要确认一次：翻到等你的一队，选中刚排进来的那件（应用那边排进队列后才看得到）
                if cross {
                    self.show(.queue, opener: .click, takeFocus: true)
                    if let l = self.model.queue.last { self.cursor.select(l.id, in: self.model.queue) }
                } else {
                    self.collapse()
                }
            }
        }
    }
}
