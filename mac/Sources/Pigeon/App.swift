import AppKit
import PigeonNotch
import WebKit

@main
@MainActor
enum PigeonMain {
    static let delegate = AppDelegate()

    static func main() {
        // 只起本机服务，不开窗口、菜单栏和刘海。给自动测试用（tests/e2e）。
        if Paths.envValue("PIGEON_HEADLESS") == "1" { runHeadless() }
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        app.delegate = delegate
        app.run()
    }
}

extension PigeonMain {
    static func runHeadless() -> Never {
        let log: @Sendable (String) -> Void = { FileHandle.standardError.write(Data(($0 + "\n").utf8)) }
        let hub = Hub(webRoot: Paths.resolveWebRoot())
        hub.start(onReady: { log("Pigeon 本机服务已启动（没有界面）：\(Hub.origin)/") },
                  onFailure: { message in log("Pigeon 无法启动：\(message)"); exit(1) })
        withExtendedLifetime(hub) { dispatchMain() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, NSMenuItemValidation, NSWindowDelegate {
    private var window: NSWindow!
    /// 主窗口里的网页。窗口关掉或最小化一阵子后整个丢掉（连同 WebContent 进程占的内存），再打开时重建
    private var webView: ChromeWebView?
    private var releaseTask: Task<Void, Never>?
    /// 网页还没加载好时要翻到的那一页，加载完再翻
    private var pendingPage: String?
    /// 关窗、最小化后过多久丢掉网页
    private static let releaseDelay: Duration = .seconds(30)
    private var hub: Hub!
    private var statusBar: StatusBar!
    private var notifier: Notifier!
    private var notch: NotchBridge!
    private var hotkey: GlobalHotKey?
    private var serverReady = false
    private let night = NSColor(srgbRed: 0x1d / 255.0, green: 0x2b / 255.0, blue: 0x38 / 255.0, alpha: 1)

    func applicationDidFinishLaunching(_ notification: Notification) {
        if Bundle.main.bundleIdentifier == nil, let icon = Paths.devIconURL(), let image = NSImage(contentsOf: icon) {
            NSApp.applicationIconImage = image
        }
        buildMenu()
        buildWindow()

        let show: () -> Void = { [weak self] in self?.showMainWindow(nil) }
        hub = Hub(webRoot: Paths.resolveWebRoot())
        notch = NotchBridge(hub: hub, showWindow: { [weak self] page in self?.showPage(page) })
        statusBar = StatusBar(showWindow: show, detect: { [weak self] in self?.hub?.detectNow(); return },
                              notchEnabled: { Settings.notchEnabled() },
                              setNotch: { [weak self] on in self?.setNotchEnabled(on) },
                              togglePanel: { [weak self] anchor in self?.notch.toggleFromMenuBar(anchor: anchor) },
                              compose: { [weak self] anchor in self?.notch.toggleCompose(anchor: anchor) },
                              setAutostart: { [weak self] on in self?.setAutostartEnabled(on) })
        notifier = Notifier(showWindow: show)
        notch.onBadge = { [weak self] count in self?.statusBar.setBadge(count) }
        if Paths.envValue("PIGEON_SNAPSHOT_DIR") == nil {
            let hk = GlobalHotKey { [weak self] in
                guard let self else { return }
                self.notch.toggleCompose(anchor: self.statusBar.panelAnchor())
            }
            hk.setEnabled(Settings.hotkeyEnabled())
            hotkey = hk
        }

        // 本机服务的每一种变化都转给菜单栏和刘海。回调在服务自己的队列上，这里换到主线程
        hub.onWatch = { [weak self] snapshot, alert in
            Task { @MainActor in
                guard let self else { return }
                self.statusBar.update(snapshot)
                self.notch.update(snapshot: snapshot)
                if let alert { self.notifier.post(alert) }
            }
        }
        hub.onSettings = { [weak self] _ in
            Task { @MainActor in
                self?.notch.reloadSettings()
                self?.statusBar.refresh()
                self?.hotkey?.setEnabled(Settings.hotkeyEnabled())
            }
        }
        hub.onQueue = { [weak self] data in Task { @MainActor in self?.notch.update(queue: data) } }
        hub.onLofts = { [weak self] data in Task { @MainActor in self?.notch.update(lofts: data) } }
        hub.onAgents = { [weak self] agents in Task { @MainActor in self?.notch.update(agents: agents) } }
        hub.onNotch = { [weak self] data in Task { @MainActor in self?.notch.handleRequest(data) } }
        hub.currentSnapshot { [weak self] snapshot in
            Task { @MainActor in
                guard let self else { return }
                self.statusBar.update(snapshot)
                self.notch.update(snapshot: snapshot)
            }
        }
        hub.currentLofts { [weak self] data in Task { @MainActor in self?.notch.update(lofts: data) } }
        hub.currentQueue { [weak self] data in Task { @MainActor in self?.notch.update(queue: data) } }
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
        if !flag { showMainWindow(nil) }
        return true
    }

    private func serverDidStart() {
        serverReady = true
        log("Pigeon 已启动：\(Hub.origin)/ ，网页目录 \(hub.webRoot.path)")
        if Paths.envValue("PIGEON_SNAPSHOT_DIR") == nil {
            MCPInstall.refreshWrapperIfPresent(scriptsDir: PluginScripts.locate())
        }
        hub.performLocalLoftsRefresh()
        webView?.load(URLRequest(url: URL(string: Hub.origin + "/")!))
        if let dir = Paths.envValue("PIGEON_SNAPSHOT_DIR") {
            let delay = Double(Paths.envValue("PIGEON_SNAPSHOT_DELAY") ?? "") ?? 5
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                await self?.takeSnapshots(into: URL(fileURLWithPath: dir, isDirectory: true))
            }
        }
    }

    /// 给自动检查用（环境变量 PIGEON_SNAPSHOT_DIR）：把主窗口的四页和刘海的五种状态各存一张图，然后退出。
    /// 图是窗口自己画出来的，不用屏幕录制权限。
    private func takeSnapshots(into dir: URL) async {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        func save(_ data: Data?, _ name: String) {
            guard let data else { log("没存下 \(name)"); return }
            try? data.write(to: dir.appendingPathComponent(name + ".png"))
        }
        func pause(_ seconds: Double) async { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
        for page in ["stage", "tasks", "rules", "devices"] {
            showPage(page)
            await pause(1)
            let image = try? await webView?.takeSnapshot(configuration: nil)
            let png = image?.tiffRepresentation.flatMap { NSBitmapImageRep(data: $0)?.representation(using: .png, properties: [:]) }
            save(png.flatMap { withWindowButtons($0) } ?? png, "window-\(page)")
        }
        for state in [NotchState.idle, .overview, .queue, .reply, .compose] {
            if state == .idle { notch.notch.collapse() } else { notch.notch.show(state, takeFocus: false) }
            await pause(0.6)
            save(notch.notch.snapshotPNG(), "notch-\(state.rawValue)")
        }
        NSApp.terminate(nil)
    }

    /// 网页截图里没有系统的红黄绿按钮（它们画在标题栏那一层），自检时把它们按实际位置叠上去
    private func withWindowButtons(_ png: Data) -> Data? {
        guard let base = NSBitmapImageRep(data: png), let content = window.contentView else { return nil }
        let scale = CGFloat(base.pixelsWide) / content.bounds.width
        let image = NSImage(size: NSSize(width: base.pixelsWide, height: base.pixelsHigh))
        image.lockFocus()
        base.draw(in: NSRect(origin: .zero, size: image.size))
        for kind in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            guard let button = window.standardWindowButton(kind), let rep = button.bitmapImageRepForCachingDisplay(in: button.bounds) else { continue }
            button.cacheDisplay(in: button.bounds, to: rep)
            let frame = content.convert(button.bounds, from: button)
            let y = content.isFlipped ? content.bounds.height - frame.maxY : frame.minY
            rep.draw(in: NSRect(x: frame.minX * scale, y: y * scale, width: frame.width * scale, height: frame.height * scale))
        }
        image.unlockFocus()
        return image.tiffRepresentation.flatMap { NSBitmapImageRep(data: $0)?.representation(using: .png, properties: [:]) }
    }

    private func serverDidFail(_ message: String) {
        log("Pigeon 无法启动：\(message)")
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "Pigeon 无法启动"
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
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false
        )
        window.title = "Pigeon"
        WindowChrome.style(window)
        window.contentMinSize = NSSize(width: 640, height: 420)
        window.backgroundColor = night
        window.isReleasedWhenClosed = false
        window.delegate = self
        ensureWebView()
        window.center()
        window.setFrameAutosaveName("PigeonMainWindow")
        window.makeKeyAndOrderFront(nil)
    }

    /// 网页不在就建一个（连同拖窗口的消息处理），服务已经起来就加载
    private func ensureWebView() {
        releaseTask?.cancel()
        releaseTask = nil
        guard webView == nil else { return }
        let view = WindowChrome.makeWebView(background: night)
        view.navigationDelegate = self
        view.uiDelegate = self
        webView = view
        window.contentView = view
        if serverReady { view.load(URLRequest(url: URL(string: Hub.origin + "/")!)) }
    }

    /// 窗口关了或最小化了：过一阵子还没回来就丢掉网页。页面里的连接（/events）跟着断，重建时页面自己重新连、重新读
    private func scheduleRelease() {
        releaseTask?.cancel()
        releaseTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: Self.releaseDelay)
            guard !Task.isCancelled, let self else { return }
            self.releaseTask = nil
            guard !self.window.isVisible || self.window.isMiniaturized else { return }
            self.releaseWebView()
        }
    }

    private func releaseWebView() {
        guard let view = webView else { return }
        webView = nil
        pendingPage = nil
        view.navigationDelegate = nil
        view.uiDelegate = nil
        WindowChrome.tearDown(view)
        // 留一块同色的底，最小化时 Dock 里的缩略图、再打开那一下都不会是白的
        let blank = NSView()
        blank.wantsLayer = true
        blank.layer?.backgroundColor = night.cgColor
        window.contentView = blank
        log("主窗口的网页已释放")
    }

    func windowWillClose(_ notification: Notification) { scheduleRelease() }
    func windowDidMiniaturize(_ notification: Notification) { scheduleRelease() }
    func windowDidDeminiaturize(_ notification: Notification) { ensureWebView() }
    func windowDidBecomeKey(_ notification: Notification) { ensureWebView() }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let page = pendingPage else { return }
        pendingPage = nil
        openPage(page)
    }

    @objc private func reloadPage(_ sender: Any?) {
        guard serverReady else { return }
        guard let webView else { ensureWebView(); return }
        if webView.url == nil {
            webView.load(URLRequest(url: URL(string: Hub.origin + "/")!))
        } else {
            webView.reload()
        }
    }

    @objc private func detectConnections(_ sender: Any?) {
        hub?.detectNow()
        hub?.performLocalLoftsRefresh()
    }

    @objc private func toggleNotch(_ sender: Any?) {
        setNotchEnabled(!Settings.notchEnabled())
    }

    /// 用刘海还是菜单栏图标：改 `perch.notch`，其余设置原样保留
    private func setNotchEnabled(_ on: Bool) {
        hub?.updateSettings { root in
            var perch = root["perch"] as? [String: Any] ?? [:]
            perch["notch"] = on
            root["perch"] = perch
        }
    }

    private func setAutostartEnabled(_ on: Bool) {
        let res = LoginItem.setEnabled(on)
        if res.status == 200 {
            hub?.broadcastAutostart(res.body)
        }
        statusBar.refresh()
    }

    /// 打开主窗口并翻到某一页（刘海上的“在窗口里看”）。页面还没加载好时只打开窗口
    private func showPage(_ page: String) {
        showMainWindow(nil)
        guard !page.isEmpty, page.allSatisfy({ $0.isLetter }) else { return }
        // 网页刚重建、还在加载：等加载完再翻
        if webView.map({ $0.isLoading || $0.url == nil }) ?? true { pendingPage = page; return }
        openPage(page)
    }

    private func openPage(_ page: String) {
        webView?.evaluateJavaScript("window.PigeonApp && window.PigeonApp.open && window.PigeonApp.open('\(page)')", completionHandler: nil)
    }

    @objc private func showMainWindow(_ sender: Any?) {
        NSApp.activate()
        ensureWebView()
        window.makeKeyAndOrderFront(nil)
    }

    /// 正盯着 Pigeon 窗口时画面已经在演了，不再弹通知
    private var isWatching: Bool {
        NSApp.isActive && window.isKeyWindow && !window.isMiniaturized
    }

    // MARK: 菜单

    private func buildMenu() {
        let main = NSMenu()

        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于 Pigeon", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 Pigeon", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "全部显示", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 Pigeon", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        addSubmenu(appMenu, title: "Pigeon", to: main)

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
        view.addItem(withTitle: "在刘海上显示", action: #selector(toggleNotch(_:)), keyEquivalent: "").target = self
        view.addItem(.separator())
        let fullScreen = view.addItem(withTitle: "进入全屏幕", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.command, .control]
        addSubmenu(view, title: "显示", to: main)

        let windowMenu = NSMenu(title: "窗口")
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(withTitle: "关闭", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: "Pigeon", action: #selector(showMainWindow(_:)), keyEquivalent: "0").target = self
        addSubmenu(windowMenu, title: "窗口", to: main)
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = main
    }

    private func addSubmenu(_ menu: NSMenu, title: String, to main: NSMenu) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.submenu = menu
        main.addItem(item)
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if item.action == #selector(toggleNotch(_:)) { item.state = Settings.notchEnabled() ? .on : .off }
        return true
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
