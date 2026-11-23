import AppKit
import SwiftUI

/// 刘海面板。应用持有一个，喂数据（`model`）、给操作（`actions`），选放在哪（`placement`）。
///
/// - 一个不抢焦点的浮动面板（`NSPanel` + `.nonactivatingPanel`），所有 Space 可见，全屏应用上也在，技术照 Perch.swift。
/// - 鼠标移上去展开总览，永远不拿键盘焦点；只有点进队列、派活，或者应用用 `show` 打开这两种时，
///   面板才变成键盘焦点窗口（不会把应用切到前台），这时键盘规矩才算数。
@MainActor
public final class NotchController {
    private let vm = NotchViewModel()
    private let panel: NotchPanel
    private let container: NotchContainerView
    private let host: NotchHostingView
    private var flight: FlightOverlay?
    private var monitors: [Any] = []
    private var pollTimer: Timer?
    private var pendingHover: DispatchWorkItem?
    private var menuAnchor: NSRect?
    private var lastBadge = -1
    private var seeded = false

    /// 有新的一件等你处理时自动展开那一队（不拿焦点）
    public var autoOpenOnNewQueueItem = true
    /// 件数变了（菜单栏图标上的红色数字用）
    public var onBadgeChange: ((Int) -> Void)?
    /// 面板打开到哪变了
    public var onStateChange: ((NotchState) -> Void)?
    /// 演示模式下每个操作写一句（演示程序打到标准输出）
    public var onDemoAction: ((String) -> Void)? {
        didSet { vm.demoLog = { [weak self] s in self?.onDemoAction?(s) } }
    }

    public init(model: NotchModel = .empty, actions: NotchActions = .none, placement: NotchPlacement = .notch) {
        panel = NotchPanel(contentRect: NSRect(x: 0, y: 0, width: 200, height: 32),
                           styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        container = NotchContainerView(frame: NSRect(x: 0, y: 0, width: 200, height: 32))
        host = NotchHostingView(rootView: NotchRootView(vm: vm))
        vm.realModel = model
        seeded = model != .empty
        vm.realActions = actions
        vm.geometry.placement = placement

        panel.isFloatingPanel = true
        // 比菜单栏高一层，盖得住刘海两侧的菜单栏
        panel.level = .statusBar + 1
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        panel.hidesOnDeactivate = false
        panel.isMovable = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        panel.becomesKeyOnlyIfNeeded = false
        panel.title = "Pigeon 刘海"
        panel.setAccessibilityLabel("Pigeon 刘海面板")
        // 刘海永远是黑底：窗口固定深色外观。不然系统是浅色时，灰白色的图标会被当成浅色外观画成黑的
        panel.appearance = NSAppearance(named: .darkAqua)

        // 窗口大小由控制器定（比形状大、只长不缩），不跟着 SwiftUI 内容的尺寸跳
        host.sizingOptions = []
        host.translatesAutoresizingMaskIntoConstraints = true
        host.autoresizingMask = [.width, .height]
        container.addSubview(host)
        panel.contentView = container

        panel.ignoresMouseEvents = true
        panel.acceptsMouseMovedEvents = true
        // 兜底：有的情况下收不到鼠标移动事件（比如鼠标停在别的应用不接收移动事件的窗口上），隔一会儿看一眼
        let poll = Timer(timeInterval: 0.15, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.pointerMoved() } }
        RunLoop.main.add(poll, forMode: .common)
        pollTimer = poll
        panel.keyHandler = { [weak self] e in self?.handleKey(e) ?? false }
        panel.onResignKey = { [weak self] in self?.vm.focusedButton = nil }
        vm.onKeyAllowedChange = { [weak self] allowed in self?.keyAllowedChanged(allowed) }

        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.layout() }
        }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.vm.reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
        }
        addMonitors()
        observe()
        layout()
    }

    // MARK: 对外：数据

    /// 整份数据。换了以后：队列选中跟着走，来了新的一件按 autoOpenOnNewQueueItem 展开，新任务在光带上飞一只鸽子
    public var model: NotchModel {
        get { vm.realModel }
        set { update(newValue) }
    }

    public var actions: NotchActions {
        get { vm.realActions }
        set { vm.realActions = newValue }
    }

    public func update(_ m: NotchModel) {
        let old = vm.realModel
        vm.realModel = m
        // 第一份数据不算“来了新的”，不自动展开、不飞鸽子
        guard seeded else { seeded = true; vm.cursor.sync(m.queue); notifyBadge(); return }
        guard !vm.demo else { notifyBadge(); return }
        let before = vm.state
        vm.queueChanged(old: old.queue, autoOpen: autoOpenOnNewQueueItem && vm.geometry.placement != .hidden)
        for f in FlightPlanner.flights(old: old.notes, new: m.notes) { flyPigeon(from: f.from, to: f.to) }
        if vm.state != before { stateDidChange() }
        notifyBadge()
    }

    // MARK: 对外：放在哪

    public var placement: NotchPlacement {
        get { vm.geometry.placement }
        set {
            guard newValue != vm.geometry.placement else { return }
            vm.collapse()
            vm.geometry.placement = newValue
            layout()
        }
    }

    /// 菜单栏模式下面板从哪里垂下来：状态栏图标按钮在屏幕上的位置（`button.window.frame` 或 `convertToScreen`）
    public func setMenuBarAnchor(_ rect: NSRect?) {
        menuAnchor = rect
        if placement == .menuBar { layout() }
    }

    /// 点了菜单栏图标：收着就展开（有事等你展开那一队，没有展开总览），开着就收起
    public func toggleFromMenuBar(anchor: NSRect? = nil) {
        if let anchor { menuAnchor = anchor }
        if vm.state == .idle {
            show(vm.model.waitingCount > 0 ? .queue : .overview)
        } else {
            collapse()
        }
    }

    /// 等你的件数（菜单栏图标上的红色数字）
    public var badgeCount: Int { vm.realModel.waitingCount }

    // MARK: 对外：打开

    public var state: NotchState { vm.state }
    public var isDemo: Bool { vm.demo }

    /// 打开某个样子（对应 `POST /api/notch`）。target、session 给派活预先选好对象（“给它发消息”），band 选中队列里那件或那封回信。
    /// takeFocus：打开队列或派活时顺带拿键盘焦点（不会把应用切到前台）。demo：用内置的示例内容演示，不动真数据、不调任何操作，收起就退出演示
    public func show(_ s: NotchState, target: TargetKey? = nil, session: String? = nil, band: String? = nil,
                     takeFocus: Bool = true, demo: Bool = false) {
        guard s != .idle else { collapse(); return }
        guard placement != .hidden || demo else { return }
        vm.setDemo(demo)
        vm.show(s, opener: .programmatic, takeFocus: takeFocus, target: target, session: session, band: band)
        stateDidChange()
    }

    public func collapse() {
        vm.collapse()
        stateDidChange()
    }

    /// 光带上飞一只鸽子：从 from 那一段飞到 to 那一段。收起时才飞；暂停、减少动态效果时不飞
    public func flyPigeon(from: AgentKind, to: AgentKind) {
        let m = vm.model
        guard placement == .notch, vm.state == .idle, !m.paused, !vm.reduceMotion, panel.isVisible,
              let i0 = m.agents.firstIndex(where: { $0.agent == from }), let i1 = m.agents.firstIndex(where: { $0.agent == to }), i0 != i1
        else { return }
        let shape = shapeScreenRect
        let inset = NotchGeometry.flare + 4
        let width = shape.width - inset * 2
        guard width > 0,
              let c0 = GlowLayout.center(of: i0, count: m.agents.count, width: width),
              let c1 = GlowLayout.center(of: i1, count: m.agents.count, width: width) else { return }
        let left = shape.minX + inset
        let y = shape.minY - 1
        flight?.close()
        let f = FlightOverlay(from: CGPoint(x: left + c0, y: y), to: CGPoint(x: left + c1, y: y), color: from.identityHex)
        flight = f
        vm.pulse[from] = Date()
        f.onLand = { [weak self] in self?.vm.pulse[to] = Date(); if self?.flight === f { self?.flight = nil } }
        f.start()
    }

    // MARK: 键盘

    private func handleKey(_ e: NSEvent) -> Bool {
        let key: NotchKey = switch e.keyCode {
        case 126: .up
        case 125: .down
        case 36, 76: .enter
        case 51, 117: .delete
        case 53: .escape
        default: .other
        }
        if e.modifierFlags.contains(.command) { return false }
        let ctx = KeyContext(state: vm.state, pointerInside: vm.pointerInside, focusInside: panel.isKeyWindow,
                             editingText: panel.firstResponder is NSText, focusedButton: vm.focusedButton,
                             hasSelection: vm.selectedItem != nil)
        switch KeyRouter.route(key, ctx) {
        case .pass: return false
        case .collapse: collapse()
        case .step(let d): vm.step(d)
        case .releaseSelected: vm.releaseSelected()
        case .blockSelected: vm.blockSelected()
        case .press(let b): if let it = vm.selectedItem { vm.press(b, on: it) }
        }
        stateDidChange()
        return true
    }

    private func keyAllowedChanged(_ allowed: Bool) {
        panel.keyAllowed = allowed
        if allowed {
            if panel.isVisible { panel.makeKey() }
        } else if panel.isKeyWindow {
            panel.resignKey()
        }
    }

    // MARK: 鼠标

    private func hoverChanged(_ inside: Bool) {
        vm.pointerInside = inside
        pendingHover?.cancel()
        // 鼠标停到刘海上几乎马上展开；只有很快地横扫过去时多等一下，免得划过菜单栏时误触。
        // 移开后稍等一下再收，鼠标在边上抖一下不至于闪
        let delay = inside ? (pointerSpeed > HoverTiming.sweepSpeed ? HoverTiming.sweepDelay : HoverTiming.enterDelay) : HoverTiming.exitDelay
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.vm.pointerInside == inside else { return }
            if inside { self.vm.machine.hoverEntered(placement: self.placement) } else { self.vm.machine.hoverExited() }
            if !self.vm.machine.isOpen { self.vm.collapse() }
            self.stateDidChange()
        }
        pendingHover = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    /// 鼠标是不是在黑色形状上。窗口比形状大，形状外面要让鼠标穿过去，所以靠监听鼠标移动来判断，
    /// 而不是窗口自己的进出（窗口忽略鼠标时收不到）
    private var pointerOverShape = false
    private var lastPointer: (at: NSPoint, time: TimeInterval)?
    /// 鼠标最近的移动速度（点每秒），用来分辨"停在刘海上"和"横扫过去"
    private var pointerSpeed: CGFloat = 0
    private func pointerMoved() {
        guard panel.isVisible else { return }
        let now = ProcessInfo.processInfo.systemUptime, at = NSEvent.mouseLocation
        if let last = lastPointer, now > last.time {
            pointerSpeed = hypot(at.x - last.at.x, at.y - last.at.y) / CGFloat(now - last.time)
        }
        lastPointer = (at, now)
        let r = shapeScreenRect
        // 顶边多算一点：鼠标顶到屏幕最上沿也算在刘海上
        let hit = r.width > 0 && NSRect(x: r.minX, y: r.minY, width: r.width, height: r.height + 2).contains(NSEvent.mouseLocation)
        if panel.ignoresMouseEvents == hit { panel.ignoresMouseEvents = !hit }
        if hit != pointerOverShape {
            pointerOverShape = hit
            hoverChanged(hit)
        }
    }

    /// 面板里点一下：钉住，必要时拿焦点；面板外点一下：按打开的方式决定收不收
    private func addMonitors() {
        let moves: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDragged, .rightMouseDragged]
        if let local = NSEvent.addLocalMonitorForEvents(matching: moves, handler: { [weak self] event in
            self?.pointerMoved()
            return event
        }) { monitors.append(local) }
        if let global = NSEvent.addGlobalMonitorForEvents(matching: moves, handler: { [weak self] _ in
            MainActor.assumeIsolated { self?.pointerMoved() }
        }) { monitors.append(global) }
        if let local = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { [weak self] event in
            guard let self else { return event }
            if event.window === self.panel {
                self.vm.clickedInside()
            } else if self.vm.machine.isOpen {
                self.vm.clickedOutside()
                self.stateDidChange()
            }
            return event
        }) { monitors.append(local) }
        if let global = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.vm.machine.isOpen else { return }
                // 菜单栏模式下点的是状态栏图标的话，交给 toggleFromMenuBar
                if self.placement == .menuBar, let a = self.menuAnchor, a.contains(NSEvent.mouseLocation) { return }
                self.vm.clickedOutside()
                self.stateDidChange()
            }
        }) { monitors.append(global) }
    }

    // MARK: 摆放

    /// 观察 SwiftUI 那边的状态：变了就重新摆
    private func observe() {
        withObservationTracking {
            _ = vm.state
            _ = vm.geometry
            _ = vm.panelRect
            _ = vm.model.paused
            _ = vm.model.agents
            _ = vm.model.queue.count
            _ = vm.model.unreadReplies
            _ = vm.model.notes.count
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.scheduleLayout()
                self?.observe()
            }
        }
    }

    private var layoutScheduled = false
    private func scheduleLayout() {
        guard !layoutScheduled else { return }
        layoutScheduled = true
        DispatchQueue.main.async { [weak self] in
            self?.layoutScheduled = false
            self?.layout()
        }
    }

    private var lastState: NotchState = .idle
    private func stateDidChange() {
        if vm.state != lastState {
            lastState = vm.state
            onStateChange?(vm.state)
            if !vm.machine.keyAllowed && panel.isKeyWindow { panel.resignKey() }
        }
        scheduleLayout()
    }

    private func notifyBadge() {
        let n = badgeCount
        guard n != lastBadge else { return }
        lastBadge = n
        onBadgeChange?(n)
    }

    /// 有刘海的内建屏优先，否则主屏（带菜单栏的那块）
    private static func targetScreen() -> NSScreen? {
        NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.screens.first
    }

    /// 窗口高度只长不缩（形状缩回去的动画要有地方画）；换屏幕、换放法时重新算
    private var windowHeight: CGFloat = 0
    private var windowKey = ""
    private var hideWork: DispatchWorkItem?

    /// 黑色形状在屏幕上的位置（动画终点）
    private var shapeScreenRect: NSRect {
        let r = vm.panelRect, f = panel.frame
        guard r.width > 0 else { return .zero }
        return NSRect(x: f.minX + r.minX, y: f.maxY - r.maxY, width: r.width, height: r.height)
    }

    private func layout() {
        notifyBadge()
        let p = placement
        hideWork?.cancel()
        if p == .hidden { panel.orderOut(nil); return }
        if p == .menuBar && vm.state == .idle {
            // 菜单栏模式收起：等形状缩回去再藏窗口
            guard panel.isVisible else { return }
            let work = DispatchWorkItem { [weak self] in
                guard let self, self.placement == .menuBar, self.vm.state == .idle else { return }
                self.panel.orderOut(nil)
            }
            hideWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + (vm.reduceMotion ? 0.2 : 0.45), execute: work)
            return
        }
        guard let screen = (p == .menuBar ? menuScreen() : Self.targetScreen()) else { return }
        var g = vm.geometry
        if p == .notch {
            let inset = screen.safeAreaInsets.top
            g.hasNotch = inset > 0
            if g.hasNotch, let l = screen.auxiliaryTopLeftArea, let r = screen.auxiliaryTopRightArea {
                g.notchWidth = max(0, r.minX - l.maxX)
                g.topHeight = inset
            } else {
                g.notchWidth = 12
                let bar = screen.frame.maxY - screen.visibleFrame.maxY
                g.topHeight = bar > 0 ? bar : 24
            }
        }
        if g != vm.geometry { vm.geometry = g }

        let pad = NotchGeometry.shadowPad
        let key = "\(p.rawValue) \(screen.frame) \(g.notchWidth)"
        if key != windowKey { windowKey = key; windowHeight = 0 }
        let need = vm.panelRect.height + NotchGeometry.stripRoom + pad * 1.5
        windowHeight = min(max(windowHeight, need, 160), screen.frame.height * 0.9)
        let h = ceil(windowHeight)
        var frame: NSRect
        if p == .notch {
            // 收起时两侧耳朵最宽也就七八十，展开宽度装得下
            let w = ceil(max(NotchGeometry.openWidth, g.notchWidth + 200) + 2 * NotchGeometry.flare + 2 * pad)
            // 刘海总在内建屏正中，窗口顶边贴屏幕顶
            frame = NSRect(x: round(screen.frame.midX - w / 2), y: screen.frame.maxY - h, width: w, height: h)
        } else {
            let w = NotchGeometry.menuWidth + 2 * pad
            let a = menuAnchor ?? NSRect(x: screen.frame.maxX - 120, y: screen.visibleFrame.maxY, width: 24, height: 0)
            let vis = screen.visibleFrame
            let x = min(max(vis.minX + 8 - pad, a.midX - w / 2), vis.maxX - w - 8 + pad)
            frame = NSRect(x: round(x), y: round(a.minY - 6 - h), width: w, height: h)
        }
        if panel.frame != frame {
            panel.setFrame(frame, display: true)
            host.frame = container.bounds
        }
        if !panel.isVisible { panel.orderFrontRegardless() }
        if panel.keyAllowed && !panel.isKeyWindow && vm.machine.keyAllowed { panel.makeKey() }
        // 形状变了，鼠标可能已经在里面或外面了
        pointerMoved()
    }

    private func menuScreen() -> NSScreen? {
        if let a = menuAnchor, let s = NSScreen.screens.first(where: { $0.frame.contains(NSPoint(x: a.midX, y: a.midY)) }) { return s }
        return NSScreen.screens.first
    }

    // MARK: 测试和演示用

    /// 把一个按键当成在面板里按下的（演示程序自测键盘规矩用）。返回面板有没有接住
    @discardableResult
    public func simulateKey(keyCode: UInt16, pointerInside: Bool? = nil) -> Bool {
        if let p = pointerInside { vm.pointerInside = p }
        guard let e = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0,
                                       windowNumber: panel.windowNumber, context: nil, characters: "", charactersIgnoringModifiers: "",
                                       isARepeat: false, keyCode: keyCode) else { return false }
        return handleKey(e)
    }

    /// 把面板现在的样子画成 PNG（只画自己的窗口，不用屏幕录制权限）。演示程序截图用
    public func snapshotPNG() -> Data? {
        guard let v = panel.contentView, v.bounds.width > 0 else { return nil }
        // 只截形状加一圈阴影，窗口其余是透明的
        var crop = v.bounds
        let r = vm.panelRect
        if r.width > 0 {
            let pad: CGFloat = 16, below = NotchGeometry.stripRoom + pad
            // panelRect 左上角为原点，NSView 这里左下角为原点；顶边贴着窗口顶
            crop = NSRect(x: r.minX - pad, y: v.bounds.height - r.maxY - below,
                          width: r.width + 2 * pad, height: r.maxY + below).intersection(v.bounds).integral
        }
        guard let rep = v.bitmapImageRepForCachingDisplay(in: crop) else { return nil }
        v.cacheDisplay(in: crop, to: rep)
        return rep.representation(using: .png, properties: [:])
    }

    /// 黑色形状现在的位置（屏幕坐标）。演示程序截图用
    public var panelFrame: NSRect? { panel.isVisible ? shapeScreenRect : nil }
    /// 面板是不是键盘焦点窗口
    public var isKey: Bool { panel.isKeyWindow }
    /// 队列里选中的那件
    public var selectedQueueID: String? { vm.cursor.selectedID }
}

/// 悬停展开、收起要等多久
enum HoverTiming {
    static let enterDelay: TimeInterval = 0.03
    static let sweepDelay: TimeInterval = 0.14
    static let exitDelay: TimeInterval = 0.1
    /// 比这快算横扫（点每秒）
    static let sweepSpeed: CGFloat = 1400
}

// MARK: - 窗口和视图

/// 平时不当键盘焦点窗口；只有 keyAllowed 时才可以（不会激活应用，`.nonactivatingPanel`）
final class NotchPanel: NSPanel {
    var keyAllowed = false
    var keyHandler: ((NSEvent) -> Bool)?
    var onResignKey: (() -> Void)?

    override var canBecomeKey: Bool { keyAllowed }
    override var canBecomeMain: Bool { false }

    override func sendEvent(_ event: NSEvent) {
        if event.type == .keyDown, let h = keyHandler, h(event) { return }
        super.sendEvent(event)
    }

    override func resignKey() {
        super.resignKey()
        onResignKey?()
    }
}

/// 面板的底：鼠标进出由控制器按形状判断（窗口比形状大，见 `pointerMoved`）
final class NotchContainerView: NSView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

/// 面板不是焦点窗口时第一下点击也要直接生效
final class NotchHostingView: NSHostingView<NotchRootView> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
