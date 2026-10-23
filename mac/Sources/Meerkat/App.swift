import AppKit
import WebKit

@main
@MainActor
enum MeerkatMain {
    static let delegate = AppDelegate()

    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        app.delegate = delegate
        app.run()
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var hub: Hub!
    private var statusBar: StatusBar!
    private var notifier: Notifier!
    private var serverReady = false
    private let night = NSColor(srgbRed: 0x1d / 255.0, green: 0x2b / 255.0, blue: 0x38 / 255.0, alpha: 1)

    func applicationDidFinishLaunching(_ notification: Notification) {
        if Bundle.main.bundleIdentifier == nil, let icon = Paths.devIconURL(), let image = NSImage(contentsOf: icon) {
            NSApp.applicationIconImage = image
        }
        buildMenu()
        buildWindow()

        let show: () -> Void = { [weak self] in self?.showMainWindow(nil) }
        statusBar = StatusBar(showWindow: show, detect: { [weak self] in self?.hub?.detectNow(); return })
        notifier = Notifier(showWindow: show)

        hub = Hub(webRoot: Paths.resolveWebRoot())
        hub.onWatch = { [weak self] snapshot, alert in
            Task { @MainActor in
                guard let self else { return }
                self.statusBar.update(snapshot)
                if let alert { self.notifier.post(alert) }
            }
        }
        hub.start(
            onReady: { [weak self] in Task { @MainActor in self?.serverDidStart() } },
            onFailure: { [weak self] message in Task { @MainActor in self?.serverDidFail(message) } }
        )
        for name in [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification,
                     NSWindow.didMiniaturizeNotification, NSApplication.didResignActiveNotification] {
            NotificationCenter.default.addObserver(self, selector: #selector(focusChanged(_:)), name: name, object: nil)
        }
        NSApp.activate()
    }

    @objc private func focusChanged(_ note: Notification) {
        // 通知回调时窗口状态可能还没切换完，下一轮再读
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.hub?.setWatching(self.isWatching)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    private func serverDidStart() {
        serverReady = true
        log("Meerkat 已启动：\(Hub.origin)/ ，网页目录 \(hub.webRoot.path)")
        webView.load(URLRequest(url: URL(string: Hub.origin + "/")!))
    }

    private func serverDidFail(_ message: String) {
        log("Meerkat 无法启动：\(message)")
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "Meerkat 无法启动"
        alert.informativeText = message
        alert.addButton(withTitle: "退出")
        alert.runModal()
        NSApp.terminate(nil)
    }

    private func log(_ text: String) {
        FileHandle.standardError.write(Data((text + "\n").utf8))
    }

    // MARK: 窗口

    private func buildWindow() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.mediaTypesRequiringUserActionForPlayback = []
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isInspectable = true
        webView.underPageBackgroundColor = night
        webView.setValue(false, forKey: "drawsBackground")

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false
        )
        window.title = "Meerkat"
        window.contentMinSize = NSSize(width: 640, height: 420)
        window.backgroundColor = night
        window.isReleasedWhenClosed = false
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("MeerkatMainWindow")
        window.makeKeyAndOrderFront(nil)
    }

    @objc private func reloadPage(_ sender: Any?) {
        guard serverReady else { return }
        if webView.url == nil {
            webView.load(URLRequest(url: URL(string: Hub.origin + "/")!))
        } else {
            webView.reload()
        }
    }

    @objc private func detectConnections(_ sender: Any?) {
        hub?.detectNow()
    }

    @objc private func showMainWindow(_ sender: Any?) {
        NSApp.activate()
        window.makeKeyAndOrderFront(nil)
    }

    /// 正盯着 Meerkat 窗口时画面已经在演了，不再弹通知
    private var isWatching: Bool {
        NSApp.isActive && window.isKeyWindow && !window.isMiniaturized
    }

    // MARK: 菜单

    private func buildMenu() {
        let main = NSMenu()

        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于 Meerkat", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 Meerkat", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "全部显示", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 Meerkat", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        addSubmenu(appMenu, title: "Meerkat", to: main)

        let edit = NSMenu(title: "编辑")
        edit.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        addSubmenu(edit, title: "编辑", to: main)

        let view = NSMenu(title: "显示")
        view.addItem(withTitle: "重新加载", action: #selector(reloadPage(_:)), keyEquivalent: "r").target = self
        view.addItem(withTitle: "检测连接", action: #selector(detectConnections(_:)), keyEquivalent: "d").target = self
        view.addItem(.separator())
        let fullScreen = view.addItem(withTitle: "进入全屏幕", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.command, .control]
        addSubmenu(view, title: "显示", to: main)

        let windowMenu = NSMenu(title: "窗口")
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(withTitle: "关闭", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: "Meerkat", action: #selector(showMainWindow(_:)), keyEquivalent: "0").target = self
        addSubmenu(windowMenu, title: "窗口", to: main)
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = main
    }

    private func addSubmenu(_ menu: NSMenu, title: String, to main: NSMenu) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.submenu = menu
        main.addItem(item)
    }

    // MARK: 外部链接用默认浏览器打开

    private static func isLocal(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return true }
        if ["about", "data", "blob", "javascript"].contains(scheme) { return true }
        let host = url.host?.lowercased() ?? ""
        return host == "127.0.0.1" || host == "localhost" || host == "::1"
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 preferences: WKWebpagePreferences) async -> (WKNavigationActionPolicy, WKWebpagePreferences) {
        guard let url = navigationAction.request.url,
              navigationAction.targetFrame?.isMainFrame ?? true,
              !Self.isLocal(url) else { return (.allow, preferences) }
        NSWorkspace.shared.open(url)
        return (.cancel, preferences)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }
}
