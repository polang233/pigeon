import AppKit
import UserNotifications

/// 菜单栏里的鸽子：闲着是轮廓，有活在跑或消息在路上时显示件数，有事等你时变成暖色、举起感叹号并写上几件。
///
/// 刘海开着时，点图标出菜单。刘海关了（设置里改成用菜单栏）时，点图标在它下面展开和刘海同一个面板，
/// 右键或按住 Option 点才出菜单。
@MainActor
final class StatusBar: NSObject, NSMenuDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
    private var snapshot = Watch.Snapshot()
    /// 等你处理的件数（等你的一队加上等你批准的对话），由刘海那边算好给过来
    private var badge = 0
    private let showWindow: () -> Void
    private let detect: () -> Void
    private let notchEnabled: () -> Bool
    private let setNotch: (Bool) -> Void
    private let togglePanel: (NSRect?) -> Void

    init(showWindow: @escaping () -> Void, detect: @escaping () -> Void,
         notchEnabled: @escaping () -> Bool, setNotch: @escaping (Bool) -> Void,
         togglePanel: @escaping (NSRect?) -> Void) {
        self.showWindow = showWindow
        self.detect = detect
        self.notchEnabled = notchEnabled
        self.setNotch = setNotch
        self.togglePanel = togglePanel
        super.init()
        menu.delegate = self
        item.button?.imagePosition = .imageLeading
        item.button?.target = self
        item.button?.action = #selector(clicked(_:))
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        render()
    }

    func update(_ s: Watch.Snapshot) {
        snapshot = s
        render()
    }

    func setBadge(_ count: Int) {
        badge = count
        render()
    }

    /// 设置变了（比如刘海开关）后重画提示
    func refresh() { render() }

    @objc private func clicked(_ sender: Any?) {
        let event = NSApp.currentEvent
        let wantsMenu = event?.type == .rightMouseUp || event?.modifierFlags.contains(.option) == true
            || event?.modifierFlags.contains(.control) == true
        if notchEnabled() || wantsMenu {
            // 临时挂上菜单再点一下，菜单关掉后摘下来，这样左键、右键可以各做各的事
            item.menu = menu
            item.button?.performClick(nil)
            item.menu = nil
        } else {
            togglePanel(anchor())
        }
    }

    /// 图标在屏幕上的位置，面板从它下面展开
    private func anchor() -> NSRect? {
        guard let button = item.button, let window = button.window else { return nil }
        return window.convertToScreen(button.convert(button.bounds, to: nil))
    }

    private func render() {
        guard let button = item.button else { return }
        let busy = snapshot.running.count + snapshot.notes.count
        let waiting = max(badge, snapshot.waiting.count)
        let hint = notchEnabled() ? "" : "。点一下展开，右键出菜单"
        if waiting > 0 {
            button.image = Self.icon(waiting: true)
            button.title = " \(waiting)"
            button.toolTip = "Pigeon：\(waiting) 件事等你" + hint
        } else if busy > 0 {
            button.image = Self.icon(waiting: false)
            button.title = " \(busy)"
            var parts: [String] = []
            if !snapshot.notes.isEmpty { parts.append("\(snapshot.notes.count) 条消息在路上") }
            if !snapshot.running.isEmpty { parts.append("\(snapshot.running.count) 件活在跑") }
            button.toolTip = "Pigeon：" + parts.joined(separator: "，") + hint
        } else {
            button.image = Self.icon(waiting: false)
            button.title = ""
            button.toolTip = "Pigeon：都闲着" + hint
        }
    }

    // MARK: 菜单（每次打开时按当前状态重建）

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let now = Date()
        if snapshot.waiting.isEmpty && snapshot.running.isEmpty && snapshot.notes.isEmpty {
            menu.addItem(Self.label("都闲着，没有在路上的消息"))
        }
        var needSeparator = false
        if !snapshot.waiting.isEmpty {
            menu.addItem(Self.label("在等你"))
            for w in snapshot.waiting {
                let text = w.folder.isEmpty ? w.title : "\(w.folder) · \(w.title)"
                let row = NSMenuItem(title: text, action: #selector(openWaiting(_:)), keyEquivalent: "")
                row.target = self
                row.toolTip = w.message
                row.representedObject = w.session
                menu.addItem(row)
            }
            needSeparator = true
        }
        if !snapshot.notes.isEmpty {
            if needSeparator { menu.addItem(.separator()) }
            menu.addItem(Self.label("在路上的消息（\(snapshot.notes.count)）"))
            for n in snapshot.notes {
                let row = NSMenuItem(title: "\(n.from.label) → \(n.to.label) · \(n.stateText) · \(Watch.duration(now.timeIntervalSince(n.since)))",
                                     action: #selector(openNote(_:)), keyEquivalent: "")
                row.target = self
                row.toolTip = n.preview.isEmpty ? n.band : "\(n.band) · \(n.preview)"
                row.representedObject = n.url
                menu.addItem(row)
            }
            needSeparator = true
        }
        if !snapshot.running.isEmpty {
            if needSeparator { menu.addItem(.separator()) }
            menu.addItem(Self.label("正在干活（\(snapshot.running.count)）"))
            for r in snapshot.running {
                let who = r.kind == .codex ? "Codex" : "子代理"
                let row = NSMenuItem(title: "\(who) · \(r.title) · \(Watch.duration(now.timeIntervalSince(r.since)))",
                                     action: #selector(openWindow(_:)), keyEquivalent: "")
                row.target = self
                menu.addItem(row)
            }
        }
        menu.addItem(.separator())
        menu.addItem(withTitle: "打开 Pigeon 窗口", action: #selector(openWindow(_:)), keyEquivalent: "").target = self
        let notch = NSMenuItem(title: "在刘海上显示", action: #selector(toggleNotch(_:)), keyEquivalent: "")
        notch.target = self
        notch.state = notchEnabled() ? .on : .off
        notch.toolTip = "关掉后，点菜单栏上这个图标展开同一个面板"
        menu.addItem(notch)
        menu.addItem(withTitle: "检测连接", action: #selector(runDetect(_:)), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出 Pigeon", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
    }

    private static func label(_ text: String) -> NSMenuItem {
        let row = NSMenuItem(title: text, action: nil, keyEquivalent: "")
        row.isEnabled = false
        return row
    }

    @objc private func openWindow(_ sender: Any?) { showWindow() }
    @objc private func runDetect(_ sender: Any?) { detect() }
    @objc private func toggleNotch(_ sender: Any?) { setNotch(!notchEnabled()) }
    @objc private func openWaiting(_ sender: NSMenuItem) {
        Opener.waiting(session: sender.representedObject as? String ?? "", fallback: showWindow)
    }
    @objc private func openNote(_ sender: NSMenuItem) {
        Opener.open(sender.representedObject as? URL, fallback: showWindow)
    }

    // MARK: 图标

    /// 菜单栏上的鸽子：单色标志（mac/Resources/MenuBarIcon.svg，由 make-brand.swift 生成）。
    /// 打包的应用从包里读，swift run 时读源码里那份；都读不到时退回像素鸽子
    private static let glyph: NSImage? = {
        let url = Bundle.main.url(forResource: "MenuBarIcon", withExtension: "svg")
            ?? Paths.packageDir.appendingPathComponent("Resources/MenuBarIcon.svg")
        return NSImage(contentsOf: url)
    }()

    static func icon(waiting: Bool) -> NSImage {
        guard let glyph else { return pixelIcon(waiting: waiting) }
        let side: CGFloat = 18
        let width = waiting ? side + 3 : side
        let image = NSImage(size: NSSize(width: width, height: side), flipped: false) { _ in
            let rect = NSRect(x: 0, y: 0, width: side, height: side)
            glyph.draw(in: rect)
            if waiting {
                // 等你时不能用模板图（红点要保持红色），鸽子按菜单栏的文字色上色，右上角加一个红点
                NSColor.labelColor.set()
                rect.fill(using: .sourceAtop)
                NSColor.systemRed.setFill()
                NSBezierPath(ovalIn: NSRect(x: width - 7, y: side - 8, width: 7, height: 7)).fill()
            }
            return true
        }
        image.isTemplate = !waiting
        image.accessibilityDescription = waiting ? "Pigeon：有事等你" : "Pigeon"
        return image
    }

    private static func pixelIcon(waiting: Bool) -> NSImage {
        let width = waiting ? 20 : 16
        let image = NSImage(size: NSSize(width: width, height: 16), flipped: true) { _ in
            let body = waiting ? NSColor(srgbRed: 0xff / 255, green: 0xcf / 255, blue: 0x6b / 255, alpha: 1) : NSColor.black
            body.setFill()
            for (y, row) in PigeonPixels.grid.enumerated() {
                for (x, ch) in row.enumerated() where ch == "X" {
                    NSRect(x: x, y: y + 1, width: 1, height: 1).fill()
                }
            }
            if waiting {
                NSColor(srgbRed: 0xff / 255, green: 0x6b / 255, blue: 0x5a / 255, alpha: 1).setFill()
                NSRect(x: 18, y: 2, width: 2, height: 8).fill()
                NSRect(x: 18, y: 12, width: 2, height: 2).fill()
            }
            return true
        }
        image.isTemplate = !waiting
        return image
    }
}

/// 点菜单、刘海或通知时决定打开哪里。
@MainActor
enum Opener {
    /// 有地址就用系统打开（Codex 对话是 codex://threads/<id>），否则打开主窗口
    static func open(_ url: URL?, fallback: () -> Void) {
        if let url, NSWorkspace.shared.urlForApplication(toOpen: url) != nil {
            NSWorkspace.shared.open(url)
        } else {
            fallback()
        }
    }

    /// 等你处理的事：Codex 的（会话键是 `codex:<id>`）打开对应对话，Claude 的切到 Claude 应用
    static func waiting(session: String, fallback: () -> Void) {
        if session.hasPrefix("codex:") {
            let id = String(session.dropFirst("codex:".count))
            open(id.isEmpty ? nil : URL(string: "codex://threads/\(id)"), fallback: fallback)
        } else {
            Notifier.focusClaude(fallback: fallback)
        }
    }
}

/// 系统通知。点通知会打开通知带的地址（比如 Codex 对话），没有地址时切到 Claude 应用（没开就打开 Pigeon 窗口）。
@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    private let showWindow: () -> Void
    /// 用 swift run 直接跑时没有 bundle，系统通知用不了
    private let available = Bundle.main.bundleIdentifier != nil
    private enum Permission { case unknown, asking, granted, denied }
    private var permission = Permission.unknown
    /// 等用户回答授权弹窗期间来的通知先排队，允许后一起发
    private var queued: [Watch.Alert] = []

    init(showWindow: @escaping () -> Void) {
        self.showWindow = showWindow
        super.init()
        guard available else { return }
        UNUserNotificationCenter.current().delegate = self
    }

    func post(_ alert: Watch.Alert) {
        guard available else {
            FileHandle.standardError.write(Data("通知：\(alert.title) — \(alert.body)\n".utf8))
            return
        }
        switch permission {
        case .granted: Self.send(alert)
        case .denied: return
        case .asking: queued.append(alert)
        case .unknown:
            permission = .asking
            queued.append(alert)
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { [weak self] granted, _ in
                Task { @MainActor in self?.authorized(granted) }
            }
        }
    }

    private func authorized(_ granted: Bool) {
        permission = granted ? .granted : .denied
        if granted { queued.forEach(Self.send) }
        queued = []
    }

    private nonisolated static func send(_ alert: Watch.Alert) {
        let content = UNMutableNotificationContent()
        content.title = alert.title
        content.body = alert.body
        content.sound = .default
        if let url = alert.url { content.userInfo = ["url": url.absoluteString] }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)) { error in
            if let error { FileHandle.standardError.write(Data("发送通知失败：\(error.localizedDescription)\n".utf8)) }
        }
    }

    static func focusClaude(fallback: () -> Void) {
        if let app = NSRunningApplication.runningApplications(withBundleIdentifier: Detector.claudeBundleID).first {
            app.activate()
        } else {
            fallback()
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        let url = (response.notification.request.content.userInfo["url"] as? String).flatMap(URL.init(string:))
        completionHandler()
        Task { @MainActor in
            if let url { Opener.open(url, fallback: self.showWindow) } else { Notifier.focusClaude(fallback: self.showWindow) }
        }
    }
}

/// 像素鸽子的点阵，菜单栏图标用
enum PigeonPixels {
    /// 16×14 的像素鸽子（侧面朝右），每格 1pt，上下各留 1pt。
    /// 闲时用模板图跟随菜单栏颜色；等你时用暖色并在右边加感叹号。
    static let grid: [String] = [
        "..........XXX...",
        ".........XXXXX..",
        ".........XX.XXX.",
        ".........XXXXX..",
        "........XXXXXX..",
        "........XXXXXXX.",
        ".....XXXXXXXXXX.",
        "...XXXXXXXXXXXX.",
        "XXXXXXXXXXXXXXX.",
        "..XXXXXXXXXXXX..",
        "....XXXXXXXXX...",
        "......XXXXXX....",
        ".......X..X.....",
        "......XX.XX.....",
    ]

}
