import Foundation

/// 面板的五种样子。原始值和 `POST /api/notch` 的 state 一样。
public enum NotchState: String, Sendable, Hashable, CaseIterable, Codable {
    /// 收起：只剩两侧和光带
    case idle
    /// 悬停总览，不抢焦点
    case overview
    /// 等你处理的一队
    case queue
    /// 回信到了
    case reply
    /// 快速派活
    case compose
}

/// 面板放在哪
public enum NotchPlacement: String, Sendable, Hashable, CaseIterable, Codable {
    /// 贴着刘海（没有刘海的屏幕在顶上正中画一个同样的黑胶囊）
    case notch
    /// 不画刘海，同一个面板从菜单栏图标下面展开
    case menuBar
    case hidden
}

/// 面板是怎么打开的，决定什么时候自己收起、能不能拿键盘焦点
enum PanelOpener: Equatable {
    /// 鼠标移上去：移开就收起，永远不拿焦点
    case hover
    /// 点进面板里：点别处收起
    case click
    /// 应用要它打开（网页上的“派活”、演示按钮、菜单栏图标）
    case programmatic
    /// 来了一件新的等你处理：不拿焦点，点别处也不收，处理完或 Esc 才收
    case attention
}

/// 打开、收起、能不能拿键盘焦点。纯逻辑，面板窗口照着它摆。
struct PanelMachine: Equatable {
    private(set) var state: NotchState = .idle
    private(set) var opener: PanelOpener = .hover
    /// 面板可以变成键盘焦点窗口（不会把应用切到前台）。只在点进队列、派活，或者应用主动打开这两种时为真
    private(set) var keyAllowed = false

    var isOpen: Bool { state != .idle }

    /// 鼠标移进来（已经等过一小会儿）。菜单栏模式下没有两侧可以悬停，不管
    mutating func hoverEntered(placement: NotchPlacement) {
        guard placement == .notch, state == .idle else { return }
        state = .overview
        opener = .hover
        keyAllowed = false
    }

    /// 鼠标移开（已经等过一小会儿）。只有悬停打开的才跟着收起
    mutating func hoverExited() {
        guard isOpen, opener == .hover else { return }
        collapse()
    }

    /// 在面板里点了一下：钉住；点在队列或派活里就允许拿键盘焦点
    mutating func clickedInside() {
        guard isOpen else { return }
        if opener != .programmatic { opener = .click }
        if state == .queue || state == .compose { keyAllowed = true }
    }

    /// 点在面板外面
    mutating func clickedOutside() {
        guard isOpen else { return }
        switch opener {
        case .click, .programmatic: collapse()
        case .hover, .attention: keyAllowed = false
        }
    }

    /// 切到某个样子。opener 为 click 表示面板里自己的按钮（比如总览里点“派活”）；
    /// takeFocus：打开派活或队列时要不要顺带拿键盘焦点
    mutating func show(_ s: NotchState, opener o: PanelOpener, takeFocus: Bool) {
        guard s != .idle else { collapse(); return }
        if isOpen && o == .click {
            if opener == .hover || opener == .attention { opener = .click }
        } else {
            opener = o
        }
        state = s
        keyAllowed = (s == .queue || s == .compose) && takeFocus && (opener == .click || opener == .programmatic)
    }

    mutating func collapse() {
        state = .idle
        opener = .hover
        keyAllowed = false
    }

    /// 队列变了。arrived：来了新的一件；becameEmpty：最后一件刚处理完（原型里也是这样收起）
    mutating func queueChanged(arrived: Bool, becameEmpty: Bool, autoOpen: Bool) {
        if state == .queue && becameEmpty {
            collapse()
            return
        }
        if arrived && autoOpen && state == .idle {
            state = .queue
            opener = .attention
            keyAllowed = false
        }
    }
}
