import AppKit
import QuartzCore
import SwiftUI

// 光带和两侧的小圆点用 CALayer 画：形状、颜色、光晕都是静态的，呼吸交给 Core Animation 在渲染服务里跑，
// 应用自己不用每一帧重画。所有 agent 都闲着时没有动画，光带就是一张不动的图。

private func cgColor(_ hex: UInt32, alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
}

/// 在 low 和 high 之间来回的透明度动画，一来一回 period 秒
private func breathing(_ b: GlowStyle.Breath) -> CABasicAnimation {
    let a = CABasicAnimation(keyPath: "opacity")
    a.fromValue = b.high
    a.toValue = b.low
    a.duration = b.period / 2
    a.autoreverses = true
    a.repeatCount = .infinity
    a.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
    // 窗口收起、换 Space 后回来接着呼吸
    a.isRemovedOnCompletion = false
    return a
}

/// 光带的一段
struct GlowSegment: Equatable {
    var agent: AgentKind
    var state: RunState
}

struct GlowStripLayers: NSViewRepresentable {
    var segments: [GlowSegment]
    var pulse: [AgentKind: Date]
    var still: Bool

    func makeNSView(context: Context) -> GlowStripLayerView { GlowStripLayerView() }

    func updateNSView(_ view: GlowStripLayerView, context: Context) {
        view.apply(segments: segments, pulse: pulse, still: still)
    }
}

final class GlowStripLayerView: NSView {
    private var bars: [CALayer] = []
    private var shown: [GlowSegment] = []
    private var still = false
    private var styled = false
    private var seenPulse: [AgentKind: Date] = [:]

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.masksToBounds = false
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override var wantsUpdateLayer: Bool { true }

    func apply(segments: [GlowSegment], pulse: [AgentKind: Date], still: Bool) {
        guard let root = layer else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        if bars.count != segments.count {
            bars.forEach { $0.removeFromSuperlayer() }
            bars = segments.map { _ in
                let l = CALayer()
                // 锚点在上沿正中：亮一下时往下长
                l.anchorPoint = CGPoint(x: 0.5, y: 1)
                l.cornerRadius = GlowStyle.height / 2
                l.shadowOffset = .zero
                l.shadowRadius = 3
                root.addSublayer(l)
                return l
            }
            styled = false
        }
        if !styled || segments != shown || still != self.still {
            shown = segments
            self.still = still
            styled = true
            restyle()
        }
        layoutBars()
        CATransaction.commit()

        for (i, s) in segments.enumerated() {
            guard let at = pulse[s.agent], at != seenPulse[s.agent] else { continue }
            seenPulse[s.agent] = at
            guard !still, Date().timeIntervalSince(at) < GlowStyle.pulseDuration else { continue }
            flash(bars[i])
        }
    }

    private func restyle() {
        for (i, s) in shown.enumerated() {
            let l = bars[i], look = GlowStyle.look(s.state, still: still)
            l.backgroundColor = cgColor(s.agent.identityHex)
            l.shadowColor = cgColor(s.agent.identityHex)
            l.shadowOpacity = Float(look.glow)
            l.opacity = Float(look.alpha)
            if let b = look.breath {
                // 同一种呼吸已经在跑就不重来，免得每次数据刷新都跳一下
                if (l.animation(forKey: "breath") as? CABasicAnimation)?.duration != b.period / 2 {
                    l.add(breathing(b), forKey: "breath")
                }
            } else {
                l.removeAnimation(forKey: "breath")
            }
        }
    }

    /// 起飞、落地时这一段亮一下、粗一下
    private func flash(_ l: CALayer) {
        let grow = CABasicAnimation(keyPath: "bounds.size.height")
        grow.fromValue = GlowStyle.height + GlowStyle.pulseExtra
        grow.toValue = GlowStyle.height
        let bright = CABasicAnimation(keyPath: "opacity")
        bright.fromValue = 1
        bright.toValue = l.opacity
        let g = CAAnimationGroup()
        g.animations = [grow, bright]
        g.duration = GlowStyle.pulseDuration
        g.timingFunction = CAMediaTimingFunction(name: .easeOut)
        l.add(g, forKey: "pulse")
    }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layoutBars()
        CATransaction.commit()
    }

    private func layoutBars() {
        let b = bounds
        let segs = GlowLayout.segments(count: bars.count, width: b.width)
        // 这层的原点在左下：上沿是 maxY
        let top = isFlipped ? b.minY : b.maxY
        for (i, l) in bars.enumerated() {
            let s = segs[i]
            l.bounds = CGRect(x: 0, y: 0, width: s.w, height: GlowStyle.height)
            l.position = CGPoint(x: s.x + s.w / 2, y: top)
            if isFlipped { l.anchorPoint = CGPoint(x: 0.5, y: 0) }
            l.shadowPath = CGPath(roundedRect: l.bounds, cornerWidth: GlowStyle.height / 2, cornerHeight: GlowStyle.height / 2, transform: nil)
        }
    }
}

/// 两侧在干活的 agent 的小圆点，会呼吸
struct PipLayer: NSViewRepresentable {
    var hex: UInt32
    var breathing: Bool

    func makeNSView(context: Context) -> PipLayerView { PipLayerView() }
    func updateNSView(_ view: PipLayerView, context: Context) { view.apply(hex: hex, breathing: breathing) }
    func sizeThatFits(_ proposal: ProposedViewSize, nsView: PipLayerView, context: Context) -> CGSize? { CGSize(width: 8, height: 8) }
}

final class PipLayerView: NSView {
    private let dot = CALayer()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        dot.cornerRadius = 4
        layer?.addSublayer(dot)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override var intrinsicContentSize: NSSize { NSSize(width: 8, height: 8) }

    func apply(hex: UInt32, breathing on: Bool) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        dot.backgroundColor = cgColor(hex)
        if on {
            if dot.animation(forKey: "breath") == nil { dot.add(breathing(.init(low: 0.35, high: 1, period: 1.6)), forKey: "breath") }
        } else {
            dot.removeAnimation(forKey: "breath")
        }
        CATransaction.commit()
    }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        dot.frame = CGRect(x: (bounds.width - 8) / 2, y: (bounds.height - 8) / 2, width: 8, height: 8)
        CATransaction.commit()
    }
}
