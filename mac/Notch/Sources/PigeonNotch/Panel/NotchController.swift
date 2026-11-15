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

        host.sizingOptions = [.intrinsicContentSize]
        host.translatesAutoresizingMaskIntoConstraints = true
        host.autoresizingMask = [.width, .height]
        container.addSubview(host)
        panel.contentView = container

        container.onHover = { [weak self] inside in self?.hoverChanged(inside) }
        host.onSizeChange = { [weak self] in self?.scheduleLayout() }
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
        let width = panel.frame.width - NotchGeometry.flare * 2
        guard let c0 = GlowLayout.center(of: i0, count: m.agents.count, width: width),
              let c1 = GlowLayout.center(of: i1, count: m.agents.count, width: width) else { return }
        let left = panel.frame.minX + NotchGeometry.flare
        let y = panel.frame.minY + NotchGeometry.stripRoom - 1
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
        // 展开稍等一下，免得鼠标划过菜单栏时误触；收起多等一会儿，鼠标在边上抖一下不至于闪
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.vm.pointerInside == inside else { return }
            if inside { self.vm.machine.hoverEntered(placement: self.placement) } else { self.vm.machine.hoverExited() }
            if !self.vm.machine.isOpen { self.vm.collapse() }
            self.stateDidChange()
        }
        pendingHover = work
        DispatchQueue.main.asyncAfter(deadline: .now() + (inside ? 0.12 : 0.35), execute: work)
    }

    /// 面板里点一下：钉住，必要时拿焦点；面板外点一下：按打开的方式决定收不收
    private func addMonitors() {
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

    private func layout() {
        notifyBadge()
        let p = placement
        if p == .hidden || (p == .menuBar && vm.state == .idle) {
            panel.orderOut(nil)
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
        host.layoutSubtreeIfNeeded()
        let size = host.fittingSize
        let w = ceil(size.width), h = ceil(max(size.height, 10))
        var frame: NSRect
        if p == .notch {
            // 刘海总在内建屏正中
            frame = NSRect(x: round(screen.frame.midX - w / 2), y: screen.frame.maxY - h, width: w, height: h)
        } else {
            let a = menuAnchor ?? NSRect(x: screen.frame.maxX - 120, y: screen.visibleFrame.maxY, width: 24, height: 0)
            let vis = screen.visibleFrame
            let x = min(max(vis.minX + 8, a.midX - w / 2), vis.maxX - w - 8)
            frame = NSRect(x: round(x), y: round(a.minY - 6 - h), width: w, height: h)
        }
        panel.hasShadow = vm.state != .idle
        if panel.frame != frame {
            panel.setFrame(frame, display: true)
            host.frame = container.bounds
        }
        if !panel.isVisible { panel.orderFrontRegardless() }
        if panel.keyAllowed && !panel.isKeyWindow && vm.machine.keyAllowed { panel.makeKey() }
        panel.invalidateShadow()
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
        guard let rep = v.bitmapImageRepForCachingDisplay(in: v.bounds) else { return nil }
        v.cacheDisplay(in: v.bounds, to: rep)
        return rep.representation(using: .png, properties: [:])
    }

    /// 面板现在的位置（屏幕坐标）。演示程序截图用
    public var panelFrame: NSRect? { panel.isVisible ? panel.frame : nil }
    /// 面板是不是键盘焦点窗口
    public var isKey: Bool { panel.isKeyWindow }
    /// 队列里选中的那件
    public var selectedQueueID: String? { vm.cursor.selectedID }
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

/// 负责鼠标进出：应用不在前台时也要能感知（`.activeAlways`）
final class NotchContainerView: NSView {
    var onHover: ((Bool) -> Void)?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                       owner: self, userInfo: nil))
    }

    override func mouseEntered(with event: NSEvent) { onHover?(true) }
    override func mouseExited(with event: NSEvent) { onHover?(false) }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

/// 面板不是焦点窗口时第一下点击也要直接生效；内容大小变了告诉控制器重新摆
final class NotchHostingView: NSHostingView<NotchRootView> {
    var onSizeChange: (() -> Void)?
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func invalidateIntrinsicContentSize() {
        super.invalidateIntrinsicContentSize()
        onSizeChange?()
    }
}
