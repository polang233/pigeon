import AppKit
import SwiftUI

/// 栖木（Perch）：贴在刘海下沿（没有刘海的屏幕贴在菜单栏下沿正中）的小提醒条。
///
/// - 一个不抢焦点的浮动面板：`NSPanel` + `.nonactivatingPanel`，不会变成主窗口或键盘焦点窗口，
///   所有 Space 可见，全屏应用里也在（`.fullScreenAuxiliary`）。
/// - 收起时是一枚小胶囊：鸽子 + "几张在飞、几件等你"。都闲着时淡到几乎看不见。
/// - 鼠标移上去展开，移开后收起；点胶囊可以钉住展开，再点一次或点别处收起。
/// - 面板尺寸直接跳到目标大小，内容只做淡入淡出，不做位移动画；"减少动态效果"打开时连淡入淡出也去掉。
@MainActor
final class Perch: NSObject {
    private let panel: PerchPanel
    private let container: PerchContainerView
    private let host: PerchHostingView
    private let showWindow: () -> Void

    private var snapshot = Watch.Snapshot()
    private var enabled = false
    private var hovering = false
    private var pinned = false
    private var expanded = false
    private var pendingHover: DispatchWorkItem?
    private var monitors: [Any] = []

    /// 都闲着时的透明度
    private let idleAlpha: CGFloat = 0.16
    /// 胶囊和刘海（或菜单栏）下沿之间的空隙
    private let gap: CGFloat = 3

    init(showWindow: @escaping () -> Void) {
        self.showWindow = showWindow
        panel = PerchPanel(contentRect: NSRect(x: 0, y: 0, width: 60, height: 26),
                           styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        container = PerchContainerView(frame: NSRect(x: 0, y: 0, width: 60, height: 26))
        host = PerchHostingView(rootView: PerchView(snapshot: Watch.Snapshot(), expanded: false, actions: PerchActions()))
        super.init()

        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        panel.hidesOnDeactivate = false
        panel.isMovable = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        panel.title = "栖木"
        panel.setAccessibilityLabel("Pigeon 栖木")

        host.sizingOptions = [.intrinsicContentSize]
        host.translatesAutoresizingMaskIntoConstraints = true
        host.autoresizingMask = [.width, .height]
        container.addSubview(host)
        container.onHover = { [weak self] inside in self?.hoverChanged(inside) }
        panel.contentView = container

        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged(_:)),
                                               name: NSApplication.didChangeScreenParametersNotification, object: nil)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(screensChanged(_:)),
                                                          name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil)
    }

    // MARK: 对外

    func setEnabled(_ on: Bool) {
        guard on != enabled else { return }
        enabled = on
        if on {
            render()
            panel.orderFrontRegardless()
        } else {
            pinned = false
            hovering = false
            expanded = false
            removeMonitors()
            panel.orderOut(nil)
        }
    }

    func update(_ s: Watch.Snapshot) {
        snapshot = s
        guard enabled else { return }
        render()
    }

    // MARK: 状态

    private var isIdle: Bool { snapshot.notes.isEmpty && snapshot.waiting.isEmpty }
    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    private func hoverChanged(_ inside: Bool) {
        hovering = inside
        pendingHover?.cancel()
        // 展开稍等一下，免得鼠标划过菜单栏时误触；收起多等一会儿，鼠标在边上抖一下不至于闪
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.hovering == inside else { return }
            self.setExpanded(inside || self.pinned)
        }
        pendingHover = work
        DispatchQueue.main.asyncAfter(deadline: .now() + (inside ? 0.12 : 0.35), execute: work)
        updateAlpha()
    }

    private func togglePinned() {
        pinned.toggle()
        setExpanded(pinned || hovering)
        if pinned { addMonitors() } else { removeMonitors() }
    }

    private func setExpanded(_ value: Bool) {
        guard value != expanded else { return }
        expanded = value
        if !value {
            pinned = false
            removeMonitors()
        }
        render()
    }

    private func collapse() {
        pinned = false
        removeMonitors()
        setExpanded(false)
    }

    /// 钉住展开时，点面板以外的任何地方都收起（别的应用里的点击用全局监听，自己窗口里的用本地监听）
    private func addMonitors() {
        guard monitors.isEmpty else { return }
        if let global = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { [weak self] _ in
            Task { @MainActor in self?.collapse() }
        }) { monitors.append(global) }
        if let local = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { [weak self] event in
            if let self, event.window !== self.panel { self.collapse() }
            return event
        }) { monitors.append(local) }
    }

    private func removeMonitors() {
        monitors.forEach(NSEvent.removeMonitor)
        monitors = []
    }

    // MARK: 绘制和摆放

    private func render() {
        let actions = PerchActions(
            toggle: { [weak self] in self?.togglePinned() },
            openNote: { [weak self] note in
                guard let self else { return }
                self.collapse()
                Opener.open(note.url, fallback: self.showWindow)
            },
            openWaiting: { [weak self] w in
                guard let self else { return }
                self.collapse()
                Opener.waiting(session: w.session, fallback: self.showWindow)
            },
            openWindow: { [weak self] in
                guard let self else { return }
                self.collapse()
                self.showWindow()
            }
        )
        host.rootView = PerchView(snapshot: snapshot, expanded: expanded, actions: actions)
        place()
        updateAlpha()
    }

    private func updateAlpha() {
        let target: CGFloat = (isIdle && !hovering && !expanded) ? idleAlpha : 1
        guard panel.alphaValue != target else { return }
        if reduceMotion || !panel.isVisible {
            panel.alphaValue = target
        } else {
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = 0.25
                panel.animator().alphaValue = target
            }
        }
    }

    @objc private func screensChanged(_ note: Notification) {
        guard enabled else { return }
        render()
    }

    /// 有刘海的内建屏优先，否则主屏（带菜单栏的那块）
    private static func targetScreen() -> NSScreen? {
        NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.screens.first
    }

    private func place() {
        guard let screen = Self.targetScreen() else { return }
        let size = host.fittingSize
        let width = ceil(max(size.width, 40)), height = ceil(max(size.height, 22))
        // 有刘海：贴刘海下沿；没有：贴菜单栏下沿（菜单栏自动隐藏时就是屏幕上沿）
        let top = screen.safeAreaInsets.top > 0
            ? screen.frame.maxY - screen.safeAreaInsets.top
            : screen.visibleFrame.maxY
        // 刘海总在内建屏正中，所以两种情况都按屏幕中线居中
        let frame = NSRect(x: round(screen.frame.midX - width / 2), y: round(top - gap - height), width: width, height: height)
        if panel.frame != frame {
            panel.setFrame(frame, display: true)
            host.frame = container.bounds
        }
        panel.invalidateShadow()
    }
}

// MARK: - 面板和容器

/// 永远不当键盘焦点窗口和主窗口，点它也不会把 Pigeon 切到前台
final class PerchPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// 负责鼠标进出：应用不在前台时也要能感知（`.activeAlways`）
final class PerchContainerView: NSView {
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

/// 面板不是焦点窗口，第一下点击也要直接生效
final class PerchHostingView: NSHostingView<PerchView> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

// MARK: - SwiftUI 画面

struct PerchActions {
    var toggle: () -> Void = {}
    var openNote: (Watch.Note) -> Void = { _ in }
    var openWaiting: (Watch.Waiting) -> Void = { _ in }
    var openWindow: () -> Void = {}
}

struct PerchView: View {
    var snapshot: Watch.Snapshot
    var expanded: Bool
    var actions: PerchActions

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static let warm = Color(red: 0xe8 / 255, green: 0x8a / 255, blue: 0x2c / 255)
    private static let maxNotes = 6
    private static let maxWaiting = 4

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            capsule
            if expanded {
                list
                    .transition(.opacity)
            }
        }
        .frame(width: expanded ? 320 : nil, alignment: .leading)
        .fixedSize(horizontal: !expanded, vertical: true)
        .background(
            PerchMaterial()
                .clipShape(RoundedRectangle(cornerRadius: expanded ? 14 : 13, style: .continuous))
        )
        .overlay(
            RoundedRectangle(cornerRadius: expanded ? 14 : 13, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.10), lineWidth: 0.5)
        )
        .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: expanded)
    }

    // MARK: 胶囊

    private var capsule: some View {
        Button(action: actions.toggle) {
            HStack(spacing: 6) {
                PigeonGlyph(color: snapshot.waiting.isEmpty ? .primary : Self.warm)
                    .frame(width: 16, height: 14)
                if !snapshot.notes.isEmpty {
                    Text("\(snapshot.notes.count) 在飞")
                        .foregroundStyle(.primary)
                }
                if !snapshot.notes.isEmpty && !snapshot.waiting.isEmpty {
                    Text("·").foregroundStyle(.secondary)
                }
                if !snapshot.waiting.isEmpty {
                    Text("\(snapshot.waiting.count) 等你")
                        .foregroundStyle(Self.warm)
                }
                if expanded {
                    Spacer(minLength: 8)
                    Text(expanded && snapshot.notes.isEmpty && snapshot.waiting.isEmpty ? "都闲着" : "Pigeon")
                        .foregroundStyle(.secondary)
                }
            }
            .font(.system(size: 12, weight: .medium).monospacedDigit())
            .lineLimit(1)
            .padding(.horizontal, 10)
            .frame(height: 26)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(summaryText)
        .help(summaryText)
    }

    private var summaryText: String {
        var parts: [String] = []
        if !snapshot.notes.isEmpty { parts.append("\(snapshot.notes.count) 张纸条在飞") }
        if !snapshot.waiting.isEmpty { parts.append("\(snapshot.waiting.count) 件事在等你") }
        return parts.isEmpty ? "都闲着" : parts.joined(separator: "，")
    }

    // MARK: 展开后的列表

    private var list: some View {
        VStack(alignment: .leading, spacing: 2) {
            Divider().padding(.horizontal, 10).padding(.bottom, 4)
            if snapshot.notes.isEmpty && snapshot.waiting.isEmpty {
                Text("没有在飞的纸条，也没有事在等你")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
            }
            if !snapshot.waiting.isEmpty {
                section("等你处理")
                ForEach(Array(snapshot.waiting.prefix(Self.maxWaiting).enumerated()), id: \.offset) { _, w in
                    PerchRow(action: { actions.openWaiting(w) }) {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.circle.fill")
                                .foregroundStyle(Self.warm)
                                .font(.system(size: 12))
                            VStack(alignment: .leading, spacing: 1) {
                                Text(w.title).font(.system(size: 12, weight: .medium))
                                if !w.folder.isEmpty || !w.message.isEmpty {
                                    Text([w.folder, w.message].filter { !$0.isEmpty }.joined(separator: " · "))
                                        .font(.system(size: 11))
                                        .foregroundStyle(.secondary)
                                        .truncationMode(.tail)
                                }
                            }
                            Spacer(minLength: 0)
                            Elapsed(since: w.since)
                        }
                    }
                }
                more(snapshot.waiting.count - Self.maxWaiting)
            }
            if !snapshot.notes.isEmpty {
                section("在飞的纸条")
                ForEach(snapshot.notes.prefix(Self.maxNotes), id: \.band) { n in
                    PerchRow(action: { actions.openNote(n) }) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            StateDot(state: n.state)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("\(n.from.name) → \(n.to.name)")
                                    .font(.system(size: 12, weight: .medium))
                                    .truncationMode(.middle)
                                Text([n.stateText, n.to.title, n.preview].filter { !$0.isEmpty }.joined(separator: " · "))
                                    .font(.system(size: 11))
                                    .foregroundStyle(.secondary)
                                    .truncationMode(.tail)
                            }
                            Spacer(minLength: 0)
                            Elapsed(since: n.since)
                        }
                    }
                }
                more(snapshot.notes.count - Self.maxNotes)
            }
            Divider().padding(.horizontal, 10).padding(.top, 4)
            PerchRow(action: actions.openWindow) {
                Text("打开 Pigeon 窗口")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
            .padding(.bottom, 4)
        }
        .lineLimit(1)
    }

    private func section(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.top, 4)
    }

    @ViewBuilder
    private func more(_ extra: Int) -> some View {
        if extra > 0 {
            PerchRow(action: actions.openWindow) {
                Text("还有 \(extra) 条，打开窗口看全部")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// 一行可以点的条目，鼠标移上去有浅色底
private struct PerchRow<Content: View>: View {
    var action: () -> Void
    @ViewBuilder var content: Content
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            content
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(Color.primary.opacity(hover ? 0.08 : 0))
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 4)
        .onHover { hover = $0 }
    }
}

/// 纸条状态的小圆点：待飞灰、飞行中蓝、已送达绿
private struct StateDot: View {
    var state: String
    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 7, height: 7)
            .accessibilityLabel(Watch.noteStateText(state))
    }
    private var color: Color {
        switch state {
        case "flying": .blue
        case "delivered": .green
        default: .gray
        }
    }
}

/// 已用时间，每秒刷新一次（只在展开时存在）
private struct Elapsed: View {
    var since: Date
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            Text(Self.format(ctx.date.timeIntervalSince(since)))
                .font(.system(size: 11).monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }
    static func format(_ seconds: TimeInterval) -> String {
        let s = max(0, Int(seconds))
        if s < 60 { return "\(s) 秒" }
        if s < 3600 { return "\(s / 60) 分" }
        return "\(s / 3600) 时 \(s % 3600 / 60) 分"
    }
}

/// 和菜单栏图标同一张像素鸽子
struct PigeonGlyph: View {
    var color: Color
    var body: some View {
        Canvas { ctx, size in
            let rows = PigeonPixels.grid
            let cols = rows.first?.count ?? 1
            let cell = min(size.width / CGFloat(cols), size.height / CGFloat(rows.count))
            var path = Path()
            for (y, row) in rows.enumerated() {
                for (x, ch) in row.enumerated() where ch == "X" {
                    path.addRect(CGRect(x: CGFloat(x) * cell, y: CGFloat(y) * cell, width: cell, height: cell))
                }
            }
            ctx.fill(path, with: .color(color))
        }
        .accessibilityHidden(true)
    }
}

/// 毛玻璃底。面板永远不是焦点窗口，所以要强制成"活跃"外观，不然会是灰扑扑的失焦样式。
private struct PerchMaterial: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let v = NSVisualEffectView()
        v.material = .popover
        v.blendingMode = .behindWindow
        v.state = .active
        return v
    }
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}
