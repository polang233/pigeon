import AppKit
import UserNotifications

/// 菜单栏里的小狐獴：闲着是轮廓，有活在跑显示件数，等你时变成暖色并举起感叹号。
@MainActor
final class StatusBar: NSObject, NSMenuDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var snapshot = Watch.Snapshot()
    private let showWindow: () -> Void
    private let detect: () -> Void

    init(showWindow: @escaping () -> Void, detect: @escaping () -> Void) {
        self.showWindow = showWindow
        self.detect = detect
        super.init()
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        item.button?.imagePosition = .imageLeading
        render()
    }

    func update(_ s: Watch.Snapshot) {
        snapshot = s
        render()
    }

    private func render() {
        guard let button = item.button else { return }
        if !snapshot.waiting.isEmpty {
            button.image = Self.icon(waiting: true)
            button.title = " 等你"
            button.toolTip = "Meerkat：Claude 在等你"
        } else if !snapshot.running.isEmpty {
            button.image = Self.icon(waiting: false)
            button.title = " \(snapshot.running.count)"
            button.toolTip = "Meerkat：\(snapshot.running.count) 件活在跑"
        } else {
            button.image = Self.icon(waiting: false)
            button.title = ""
            button.toolTip = "Meerkat：都闲着"
        }
    }

    // MARK: 菜单（每次打开时按当前状态重建）

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        if snapshot.waiting.isEmpty && snapshot.running.isEmpty {
            menu.addItem(Self.label("都闲着，没有在跑的活"))
        }
        if !snapshot.waiting.isEmpty {
            menu.addItem(Self.label("在等你"))
            for w in snapshot.waiting {
                let text = w.folder.isEmpty ? Watch.waitTitle(w.kind) : "\(w.folder) · \(Watch.waitTitle(w.kind))"
                let row = NSMenuItem(title: text, action: #selector(openClaude(_:)), keyEquivalent: "")
                row.target = self
                row.toolTip = w.message
                menu.addItem(row)
            }
        }
        if !snapshot.running.isEmpty {
            if !snapshot.waiting.isEmpty { menu.addItem(.separator()) }
            menu.addItem(Self.label("正在干活（\(snapshot.running.count)）"))
            for r in snapshot.running {
                let who = r.kind == .codex ? "Codex" : "子代理"
                let row = NSMenuItem(title: "\(who) · \(r.title) · \(Watch.duration(Date().timeIntervalSince(r.since)))",
                                     action: #selector(openWindow(_:)), keyEquivalent: "")
                row.target = self
                menu.addItem(row)
            }
        }
        menu.addItem(.separator())
        menu.addItem(withTitle: "打开 Meerkat 窗口", action: #selector(openWindow(_:)), keyEquivalent: "").target = self
        menu.addItem(withTitle: "检测连接", action: #selector(runDetect(_:)), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出 Meerkat", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
    }

    private static func label(_ text: String) -> NSMenuItem {
        let row = NSMenuItem(title: text, action: nil, keyEquivalent: "")
        row.isEnabled = false
        return row
    }

    @objc private func openWindow(_ sender: Any?) { showWindow() }
    @objc private func runDetect(_ sender: Any?) { detect() }
    @objc private func openClaude(_ sender: Any?) { Notifier.focusClaude(fallback: showWindow) }

    // MARK: 图标

    /// 12×16 的像素狐獴，每格 1pt。闲时用模板图跟随菜单栏颜色，等你时用暖色并在右边加感叹号。
    private static let grid = [
        "....XXXX....",
        "...XXXXXX...",
        "..XXXXXXXX..",
        "..X..XX..X..",
        "..XXXXXXXX..",
        "...XXXXXX...",
        "....XXXX....",
        "...XXXXXX...",
        "..XXXXXXXX..",
        "..XXXXXXXX..",
        "...XXXXXX...",
        "...XXXXXX...",
        "...XXXXXXX..",
        "...XX..XX.X.",
        "..XXX..XXXX.",
        "............",
    ]

    private static func icon(waiting: Bool) -> NSImage {
        let width = waiting ? 16 : 12
        let image = NSImage(size: NSSize(width: width, height: 16), flipped: true) { _ in
            let body = waiting ? NSColor(srgbRed: 0xff / 255, green: 0xcf / 255, blue: 0x6b / 255, alpha: 1) : NSColor.black
            body.setFill()
            for (y, row) in grid.enumerated() {
                for (x, ch) in row.enumerated() where ch == "X" {
                    NSRect(x: x, y: y, width: 1, height: 1).fill()
                }
            }
            if waiting {
                NSColor(srgbRed: 0xff / 255, green: 0x6b / 255, blue: 0x5a / 255, alpha: 1).setFill()
                NSRect(x: 14, y: 1, width: 2, height: 8).fill()
                NSRect(x: 14, y: 11, width: 2, height: 2).fill()
            }
            return true
        }
        image.isTemplate = !waiting
        return image
    }
}

/// 系统通知。点通知会切到 Claude 应用（没开就打开 Meerkat 窗口）。
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
        completionHandler()
        Task { @MainActor in Notifier.focusClaude(fallback: self.showWindow) }
    }
}
