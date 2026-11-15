import Foundation

/// 面板上的操作，由应用提供。都在主线程调。演示模式（`show(..., demo: true)`）下一个也不调。
public struct NotchActions: Sendable {
    /// 放行或拦下队列里的一件：queue id、决定。对应 `POST /api/queue/<id>`
    public var resolve: @MainActor @Sendable (_ queueID: String, _ decision: QueueDecision) -> Void
    /// 跳回对话：回到那个对话所在的应用。对应 `POST /api/open`
    public var jump: @MainActor @Sendable (_ target: Endpoint) -> Void
    /// 全部暂停 / 继续。对应 `POST /api/pause`
    public var setPaused: @MainActor @Sendable (_ on: Bool) -> Void
    /// 快速派活发出。返回脚环，或者一句能直接显示的错。对应 `POST /api/send`
    public var send: @MainActor @Sendable (_ request: SendRequest) async -> SendOutcome
    /// 打字时问应用：按分派规则建议交给谁。没有建议返回 nil。对应 `POST /api/dispatch/suggest`
    public var suggest: @MainActor @Sendable (_ text: String) async -> TargetKey?
    /// “以后直接转”：关掉协作规矩里“转派前问我”那一条，再放行这一件
    public var autoRelay: @MainActor @Sendable (_ queueID: String) -> Void
    /// 回信标成已读
    public var markReplyRead: @MainActor @Sendable (_ band: String) -> Void
    /// 回信转给指挥
    public var forward: @MainActor @Sendable (_ band: String) -> Void
    /// 打开主窗口的某一页
    public var openMainWindow: @MainActor @Sendable (_ page: MainPage) -> Void

    public init(
        resolve: @escaping @MainActor @Sendable (String, QueueDecision) -> Void = { _, _ in },
        jump: @escaping @MainActor @Sendable (Endpoint) -> Void = { _ in },
        setPaused: @escaping @MainActor @Sendable (Bool) -> Void = { _ in },
        send: @escaping @MainActor @Sendable (SendRequest) async -> SendOutcome = { _ in .failed("还没接上应用") },
        suggest: @escaping @MainActor @Sendable (String) async -> TargetKey? = { _ in nil },
        autoRelay: @escaping @MainActor @Sendable (String) -> Void = { _ in },
        markReplyRead: @escaping @MainActor @Sendable (String) -> Void = { _ in },
        forward: @escaping @MainActor @Sendable (String) -> Void = { _ in },
        openMainWindow: @escaping @MainActor @Sendable (MainPage) -> Void = { _ in }
    ) {
        self.resolve = resolve
        self.jump = jump
        self.setPaused = setPaused
        self.send = send
        self.suggest = suggest
        self.autoRelay = autoRelay
        self.markReplyRead = markReplyRead
        self.forward = forward
        self.openMainWindow = openMainWindow
    }

    /// 什么都不做
    public static let none = NotchActions()
}
