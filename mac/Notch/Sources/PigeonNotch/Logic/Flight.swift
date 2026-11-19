import CoreGraphics
import Foundation

/// 刘海上的信鸽：把刘海当成一颗星球，鸽子从发信那一段起飞，往下扎出去，被“引力”拉回来，落到收信那一段。
/// 横向匀速、竖向受朝上的恒定引力，是一条挂在刘海下面的抛物线；越靠近底部飞得越慢，往下时低头、往回时抬头。
/// 坐标以起点所在的那条横线为 y = 0，向下为正。纯计算，照原型 hud.js 的 flyNotch。
struct FlightPath: Equatable {
    var x0: CGFloat
    var x1: CGFloat

    var dx: CGFloat { x1 - x0 }
    /// 往下扎多深
    var depth: CGFloat { max(46, abs(dx) * 0.7) }
    /// 飞多久（秒）
    var duration: TimeInterval { 1.1 + Double(abs(dx)) * 0.005 }

    /// t 从 0 到 1
    func point(_ t: Double) -> CGPoint {
        let t = min(1, max(0, t))
        return CGPoint(x: x0 + dx * t, y: depth * 4 * t * (1 - t))
    }

    /// 机头的倾角（度）：往下扎时为正（低头），往回飞时为负（抬头）
    func tilt(_ t: Double) -> Double {
        let t = min(1, max(0, t))
        return atan2(Double(depth) * 4 * (1 - 2 * t), Double(abs(dx))) * 180 / .pi * 0.7
    }

    /// 朝左飞时把鸽子翻过来
    var facesLeft: Bool { dx < 0 }

    /// 身后那串渐隐的小点：每 45 毫秒一个，留 0.7 秒。返回 (位置, 透明度)
    func trail(at elapsed: TimeInterval) -> [(CGPoint, Double)] {
        let step = 0.045, life = 0.7
        var out: [(CGPoint, Double)] = []
        var s = (max(0, elapsed - life) / step).rounded(.up) * step
        while s < elapsed {
            let t = s / duration
            if t > 0.04 && t < 0.95 {
                out.append((point(t), 0.8 * (1 - (elapsed - s) / life)))
            }
            s += step
        }
        return out
    }
}

/// 光带：每个本机 agent 一段，左右各留 14，段与段之间空 3。返回每段的 (起点, 宽度)
enum GlowLayout {
    static let inset: CGFloat = 14
    static let gap: CGFloat = 3

    static func segments(count: Int, width: CGFloat) -> [(x: CGFloat, w: CGFloat)] {
        guard count > 0 else { return [] }
        let usable = max(0, width - inset * 2 - gap * CGFloat(count - 1))
        let w = usable / CGFloat(count)
        return (0..<count).map { (inset + CGFloat($0) * (w + gap), w) }
    }

    static func center(of index: Int, count: Int, width: CGFloat) -> CGFloat? {
        let s = segments(count: count, width: width)
        guard s.indices.contains(index) else { return nil }
        return s[index].x + s[index].w / 2
    }
}

/// 光带每一段长什么样：多亮、要不要呼吸。纯逻辑，画由 `GlowStripLayerView` 交给 Core Animation
enum GlowStyle {
    /// 每段平常的高度
    static let height: CGFloat = 3
    /// 起飞、落地时亮一下，多高出来多少，亮多久
    static let pulseExtra: CGFloat = 3
    static let pulseDuration: TimeInterval = 0.6

    /// 呼吸：在 low 和 high 之间来回，一来一回 period 秒
    struct Breath: Equatable {
        var low: Double
        var high: Double
        var period: TimeInterval
    }

    struct Look: Equatable {
        /// 不呼吸时的亮度；呼吸时是最亮的那一下
        var alpha: Double
        var breath: Breath?
        /// 外面一圈光晕的浓度
        var glow: Double
    }

    /// still：减少动态效果，只给固定亮度
    static func look(_ s: RunState, still: Bool) -> Look {
        switch s {
        case .idle, .done: return Look(alpha: 0.55, breath: nil, glow: 0.45)
        case .off: return Look(alpha: 0.2, breath: nil, glow: 0)
        case .run: return Look(alpha: 1, breath: still ? nil : Breath(low: 0.6, high: 1, period: 1.6), glow: 0.8)
        case .wait, .error: return Look(alpha: 1, breath: still ? nil : Breath(low: 0.55, high: 1, period: 1.1), glow: 0.8)
        }
    }

    /// 有没有哪一段在动。都不动时光带是一张静止的图，不占 CPU
    static func animates(_ states: [RunState], still: Bool) -> Bool {
        states.contains { look($0, still: still).breath != nil }
    }
}

/// 两侧写什么。纯逻辑
enum EarText {
    /// 右边：几件等你；没有就写几封新回信、几件在路上，都没有就空
    static func right(_ m: NotchModel) -> (text: String, urgent: Bool) {
        if m.waitingCount > 0 { return ("\(m.waitingCount) 件等你", true) }
        if m.unreadReplies > 0 { return ("\(m.unreadReplies) 封回信", false) }
        let live = m.notes.filter { $0.state != .home }.count
        if live > 0 { return ("\(live) 件在路上", false) }
        return ("", false)
    }

    /// 什么都没有：两侧收起来，只剩刘海本身那么宽
    static func isQuiet(_ m: NotchModel) -> Bool {
        !m.paused && m.runningAgents.isEmpty && right(m).text.isEmpty
    }

    /// 两侧合起来读给 VoiceOver 听
    static func summary(_ m: NotchModel) -> String {
        var parts: [String] = []
        if m.paused { parts.append("已暂停") }
        let run = m.runningAgents
        if !run.isEmpty { parts.append(run.map(\.displayName).joined(separator: "、") + " 在干活") }
        let r = right(m).text
        if !r.isEmpty { parts.append(r) }
        return parts.isEmpty ? "Pigeon：都闲着" : "Pigeon：" + parts.joined(separator: "，")
    }
}

/// 哪些任务要飞一只鸽子：新出现的往前飞，刚变成已回信的往回飞。只飞两头都是本机、而且不是同一家的
enum FlightPlanner {
    static func flights(old: [NoteInFlight], new: [NoteInFlight]) -> [(from: AgentKind, to: AgentKind)] {
        let before = Dictionary(old.map { ($0.band, $0.state) }, uniquingKeysWith: { a, _ in a })
        var out: [(AgentKind, AgentKind)] = []
        for n in new {
            let prev = before[n.band]
            var pair: (AgentKind, AgentKind)?
            if n.state == .home, prev != nil, prev != .home {
                pair = (n.to.agent, n.from.agent)
            } else if prev == nil, n.state == .flying || n.state == .delivered {
                pair = (n.from.agent, n.to.agent)
            }
            guard let (a, b) = pair, a != b, a != .you, b != .you, n.from.isLocal, n.to.isLocal else { continue }
            out.append((a, b))
        }
        return out
    }
}
