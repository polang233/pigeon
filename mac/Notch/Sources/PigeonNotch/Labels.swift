import Foundation

// 界面上的固定说法。照网页 web/src/core/labels.js；刘海永远是黑底，用深色配色的那套颜色。

extension AgentKind {
    /// 全名
    public var displayName: String {
        switch self {
        case .claude: "Claude Code"
        case .codex: "Codex"
        case .cursor: "Cursor"
        case .deepseek: "DeepSeek Harness"
        case .antigravity: "Antigravity"
        case .you: "你"
        }
    }

    /// 刘海里放得下的短名
    public var shortName: String {
        switch self {
        case .claude: "Claude"
        case .codex: "Codex"
        case .cursor: "Cursor"
        case .deepseek: "DSH"
        case .antigravity: "AGY"
        case .you: "你"
        }
    }

    /// 身份色（鸽子、光带用），0xRRGGBB。Codex 的标志是蓝紫色，身份色用绿色是为了和 DeepSeek 的蓝分开
    var identityHex: UInt32 {
        switch self {
        case .claude: 0xe07d58
        case .codex: 0x3ec79a
        case .cursor: 0xd9d5cc
        case .deepseek: 0x6f8bff
        case .antigravity: 0x8ab4f8
        case .you: 0xececee
        }
    }
}

extension Effort {
    public var label: String {
        switch self {
        case .low: "低"
        case .medium: "中"
        case .high: "高"
        case .xhigh: "极高"
        case .max: "最高"
        case .ultra: "超高"
        }
    }

    /// 竖条亮几格
    var bars: Int {
        switch self {
        case .low: 1
        case .medium: 2
        case .high: 3
        case .xhigh: 4
        case .max: 5
        case .ultra: 6
        }
    }
}

extension RunState {
    public var label: String {
        switch self {
        case .run: "在干活"
        case .wait: "等你"
        case .error: "出错"
        case .idle: "空闲"
        case .done: "刚完成"
        case .off: "没接上"
        }
    }
}

extension QueueKind {
    public var label: String {
        switch self {
        case .cross: "跨设备"
        case .relay: "转派"
        case .split: "拆活"
        }
    }
}

extension Endpoint {
    /// “Claude Code” 或 “Claude Code @ CHEN”
    var whoText: String { isLocal ? agent.displayName : "\(agent.displayName) @ \(deviceName)" }
}
