import AppKit
import WebKit

/// 主窗口没有标题栏横条：网页铺满整个窗口，红黄绿三个按钮浮在侧栏左上角。
/// 网页里标了 data-drag 的空白处（侧栏顶上的标志、各页的标题行）按住能拖窗口、双击能缩放，
/// 这件事网页自己做不到，经 pigeonWindow 这个消息交给这里。

/// 记住最近一次鼠标按下：网页发来"拖"的消息时，用它让系统接着拖窗口
final class ChromeWebView: WKWebView {
    private(set) var lastMouseDown: NSEvent?

    override func mouseDown(with event: NSEvent) {
        lastMouseDown = event
        super.mouseDown(with: event)
    }
}

/// 网页发来的窗口操作。只认两种：drag（拖窗口）和 zoom（双击标题行，照系统设置缩放或最小化）
final class WindowChrome: NSObject, WKScriptMessageHandler {
    static let name = "pigeonWindow"
    private weak var webView: ChromeWebView?

    init(webView: ChromeWebView) { self.webView = webView }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let webView, let window = webView.window, let action = message.body as? String else { return }
        switch action {
        case "drag":
            // 消息是异步到的：只有按下的那一下还没松开时才拖，松开了就不动
            guard let down = webView.lastMouseDown, NSEvent.pressedMouseButtons & 1 == 1 else { return }
            window.performDrag(with: down)
        case "zoom":
            // 跟系统"双击窗口标题栏"的设置走：缩放，或者最小化
            let pref = UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") ?? "Maximize"
            if pref == "Minimize" { window.performMiniaturize(nil) } else if pref != "None" { window.performZoom(nil) }
        default:
            break
        }
    }

    /// 透明标题栏：内容铺到最顶上，标题不显示；加一个空工具栏让三个按钮落在 52pt 高的一行正中
    static func style(_ window: NSWindow) {
        window.styleMask.insert(.fullSizeContentView)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        let toolbar = NSToolbar(identifier: "PigeonMain")
        toolbar.showsBaselineSeparator = false
        window.toolbar = toolbar
        window.toolbarStyle = .unified
    }
}
