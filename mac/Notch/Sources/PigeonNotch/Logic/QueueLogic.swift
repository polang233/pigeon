import Foundation

/// 队列里展开那件的按钮。键盘焦点停在哪个上，回车就是按哪个。
public enum QueueButton: String, Sendable, Hashable, CaseIterable {
    case jump, autoRelay, block, release, releaseRaw, releaseMasked
}

/// 等你处理的一队：选中哪件、展开后有哪些按钮、回车放行用哪种放法。纯逻辑。
enum QueueLogic {
    /// 跨设备的过了点：不能再放行，等应用把它移走（应用那边记成“没人理，没发出”）
    static func isExpired(_ item: QueueItem, now: Date) -> Bool {
        guard item.kind == .cross, let d = item.deadline else { return false }
        return d <= now
    }

    /// 要不要给“原样放行 / 打码后放行”两个按钮：查到密钥并且设置是“提醒”
    static func offersMaskChoice(_ item: QueueItem, mode: SecretsMode) -> Bool {
        !item.secrets.isEmpty && mode == .warn
    }

    /// 展开那件的按钮，从左到右。左边一组是跳回对话、以后直接转；右边是拦下和放行
    static func buttons(for item: QueueItem, mode: SecretsMode, now: Date) -> (leading: [QueueButton], trailing: [QueueButton]) {
        var lead: [QueueButton] = []
        if item.canJump && item.from.agent != .you { lead.append(.jump) }
        if item.kind == .relay { lead.append(.autoRelay) }
        if isExpired(item, now: now) { return (lead, []) }
        if offersMaskChoice(item, mode: mode) { return (lead, [.block, .releaseRaw, .releaseMasked]) }
        return (lead, [.block, .release])
    }

    /// 按钮上的字
    static func title(_ b: QueueButton, kind: QueueKind) -> String {
        switch b {
        case .jump: "跳回对话"
        case .autoRelay: "以后直接转"
        case .block: "拦下"
        case .release: kind == .split ? "全部放行" : "放行"
        case .releaseRaw: "原样放行"
        case .releaseMasked: "打码后放行"
        }
    }

    /// 回车放行时用哪种：有密钥且没关查密钥时打码后放（更稳妥），否则原样；过了点的不能放
    static func enterDecision(_ item: QueueItem, mode: SecretsMode, now: Date) -> QueueDecision? {
        if isExpired(item, now: now) { return nil }
        if !item.secrets.isEmpty && mode != .off { return .releaseMasked }
        return .release
    }

    /// 按钮对应的决定；jump、autoRelay 不是决定，返回 nil
    static func decision(for b: QueueButton) -> QueueDecision? {
        switch b {
        case .block: .block
        case .release, .releaseRaw: .release
        case .releaseMasked: .releaseMasked
        case .jump, .autoRelay: nil
        }
    }
}

/// 队列里选中的那件。按 id 记，队列变了还选着同一件；那件没了就选原来位置上的那件。
struct QueueCursor: Equatable {
    private(set) var selectedID: String?
    private var lastIndex = 0

    mutating func sync(_ items: [QueueItem]) {
        if let id = selectedID, let i = items.firstIndex(where: { $0.id == id }) {
            lastIndex = i
            return
        }
        guard !items.isEmpty else { selectedID = nil; lastIndex = 0; return }
        let i = min(lastIndex, items.count - 1)
        selectedID = items[i].id
        lastIndex = i
    }

    mutating func select(_ id: String, in items: [QueueItem]) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        selectedID = id
        lastIndex = i
    }

    /// 上下选，到头了绕回去
    mutating func step(_ delta: Int, in items: [QueueItem]) {
        guard !items.isEmpty else { return }
        sync(items)
        let n = items.count
        let i = ((lastIndex + delta) % n + n) % n
        selectedID = items[i].id
        lastIndex = i
    }

    func selected(in items: [QueueItem]) -> QueueItem? {
        guard let id = selectedID else { return nil }
        return items.first { $0.id == id }
    }
}

// MARK: - 键盘

/// 刘海关心的几个键
enum NotchKey: Equatable {
    case up, down, enter, delete, escape, other
}

/// 键按下时面板的样子
struct KeyContext: Equatable {
    var state: NotchState
    /// 鼠标在面板上
    var pointerInside: Bool
    /// 面板是键盘焦点窗口
    var focusInside: Bool
    /// 焦点在输入框里
    var editingText: Bool
    /// 焦点停在队列的哪个按钮上
    var focusedButton: QueueButton?
    var hasSelection: Bool
}

enum KeyOutcome: Equatable {
    /// 不管，交给系统（或者面板里的控件）
    case pass
    case step(Int)
    /// 放行选中的那件
    case releaseSelected
    case blockSelected
    /// 按焦点停着的那个按钮
    case press(QueueButton)
    case collapse
}

/// 照 DESIGN.md“等你处理的那一队”定下的键盘规矩：只在面板展开、并且鼠标或焦点在面板里时算数；
/// 上下选，回车放行选中的那件，焦点在某个按钮上时回车就是按那个按钮，⌫ 拦下，Esc 收起。
enum KeyRouter {
    static func route(_ key: NotchKey, _ c: KeyContext) -> KeyOutcome {
        guard c.state != .idle, c.pointerInside || c.focusInside else { return .pass }
        if key == .escape { return .collapse }
        // 输入框里打字：方向键、回车、删除都归输入框
        if c.editingText { return .pass }
        guard c.state == .queue else { return .pass }
        switch key {
        case .up: return c.hasSelection ? .step(-1) : .pass
        case .down: return c.hasSelection ? .step(1) : .pass
        case .enter:
            if let b = c.focusedButton { return .press(b) }
            return c.hasSelection ? .releaseSelected : .pass
        case .delete: return c.hasSelection ? .blockSelected : .pass
        case .escape, .other: return .pass
        }
    }
}
