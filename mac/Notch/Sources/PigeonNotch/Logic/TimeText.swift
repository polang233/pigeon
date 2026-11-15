import Foundation

/// 时间和数量的说法。纯函数，now 传进来，方便测试。
enum TimeText {
    /// 还剩几秒（向上取整，不小于 0）
    static func secondsLeft(_ deadline: Date, now: Date) -> Int {
        max(0, Int(ceil(deadline.timeIntervalSince(now))))
    }

    /// 队列一行右边：“剩 63 秒”；到点了写“到时间了”
    static func countdownShort(_ deadline: Date, now: Date) -> String {
        let s = secondsLeft(deadline, now: now)
        return s > 0 ? "剩 \(s) 秒" : "到时间了"
    }

    /// 展开后那一句
    static func countdownLong(_ deadline: Date, now: Date) -> String {
        let s = secondsLeft(deadline, now: now)
        return s > 0 ? "还剩 \(s) 秒，不点就不发" : "到时间了，没人理就不发"
    }

    /// 多久以前：刚刚、3 分钟前、2 小时前、1 天前
    static func ago(_ t: Date, now: Date) -> String {
        let m = Int(floor(now.timeIntervalSince(t) / 60))
        if m < 1 { return "刚刚" }
        if m < 60 { return "\(m) 分钟前" }
        if m < 1440 { return "\(m / 60) 小时前" }
        return "\(m / 1440) 天前"
    }

    /// 上下文：“约 61k token”、“约 2.4k token”、“约 800 token”
    static func tokens(_ n: Int) -> String {
        if n < 1000 { return "约 \(n) token" }
        let k = (Double(n) / 100).rounded() / 10
        let s = k == k.rounded() ? String(Int(k)) : String(format: "%.1f", k)
        return "约 \(s)k token"
    }
}
