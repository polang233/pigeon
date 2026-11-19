import AppKit

/// 刘海两侧"耳朵"的宽度。收起时按内容算，左右各算各的，没东西的一边不长出来：
/// 耳朵会盖住菜单栏，越窄越不挡菜单和状态栏图标。展开时两边一样宽。
struct EarWidths: Equatable {
    var left: CGFloat
    var right: CGFloat
}

/// 右边那一项的紧凑写法：图标加数字（完整说法放在悬停提示和 VoiceOver 里）
struct EarBadge: Equatable {
    var symbol: String
    var count: Int
    var urgent: Bool
    var help: String
}

enum EarLayout {
    static let lead: CGFloat = 12
    static let trail: CGFloat = 10
    static let pip: CGFloat = 8
    static let pipGap: CGFloat = 5
    static let badgeFont: CGFloat = 11.5
    static let symbolWidth: CGFloat = 13
    static let symbolGap: CGFloat = 4

    static func badge(_ m: NotchModel) -> EarBadge? {
        let r = EarText.right(m)
        guard !r.text.isEmpty else { return nil }
        if m.waitingCount > 0 { return EarBadge(symbol: "hand.raised.fill", count: m.waitingCount, urgent: true, help: r.text) }
        if m.unreadReplies > 0 { return EarBadge(symbol: "envelope.fill", count: m.unreadReplies, urgent: false, help: r.text) }
        let live = m.notes.filter { $0.state != .home }.count
        return EarBadge(symbol: "paperplane.fill", count: live, urgent: false, help: r.text)
    }

    static func textWidth(_ s: String, weight: NSFont.Weight) -> CGFloat {
        let font = NSFont.monospacedDigitSystemFont(ofSize: badgeFont, weight: weight)
        return ceil((s as NSString).size(withAttributes: [.font: font]).width)
    }

    /// 左边：暂停时是"已暂停"，否则每个在干活的 agent 一个圆点
    static func leftNeed(_ m: NotchModel) -> CGFloat {
        if m.paused { return lead + symbolWidth + symbolGap + textWidth("已暂停", weight: .semibold) + trail }
        let n = CGFloat(m.runningAgents.count)
        guard n > 0 else { return 0 }
        return lead + n * pip + (n - 1) * pipGap + trail
    }

    /// 右边：图标加数字
    static func rightNeed(_ m: NotchModel) -> CGFloat {
        guard let b = badge(m) else { return 0 }
        return trail + symbolWidth + symbolGap + textWidth("\(b.count)", weight: b.urgent ? .semibold : .regular) + lead
    }

    /// 收起时两边各多宽；展开时两边平分，凑够面板宽
    static func widths(model m: NotchModel, open: Bool, notchWidth: CGFloat, openWidth: CGFloat) -> EarWidths {
        if open {
            let side = max(0, (openWidth - notchWidth) / 2)
            return EarWidths(left: side, right: side)
        }
        return EarWidths(left: leftNeed(m), right: rightNeed(m))
    }
}
