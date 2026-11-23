import SwiftUI

/// 刘海的外形：顶边贴屏幕，两角向外反弯接上菜单栏；下面两角圆。宽高跟着布局动，圆角跟着 animatableData 动。
/// flare 为 0、topRadius 大于 0 时是普通的四角圆（菜单栏模式）
struct NotchShape: Shape {
    var flare: CGFloat
    var bottomRadius: CGFloat
    var topRadius: CGFloat = 0

    var animatableData: AnimatablePair<CGFloat, AnimatablePair<CGFloat, CGFloat>> {
        get { AnimatablePair(flare, AnimatablePair(bottomRadius, topRadius)) }
        set { flare = newValue.first; bottomRadius = newValue.second.first; topRadius = newValue.second.second }
    }

    /// 用三次曲线近似四分之一圆
    private static let k: CGFloat = 0.5523

    func path(in r: CGRect) -> Path {
        let k = Self.k
        let f = max(0, min(flare, r.width / 4, r.height / 2))
        let b = max(0, min(bottomRadius, (r.height - f) / 2, (r.width - 2 * f) / 2))
        let t = max(0, min(topRadius, r.height / 2 - b / 2, (r.width - 2 * f) / 2))
        let l = r.minX + f, rr = r.maxX - f
        var p = Path()
        if f > 0 {
            // 左上：从屏幕上沿往里反弯下来
            p.move(to: CGPoint(x: r.minX, y: r.minY))
            p.addCurve(to: CGPoint(x: l, y: r.minY + f),
                       control1: CGPoint(x: r.minX + f * k, y: r.minY),
                       control2: CGPoint(x: l, y: r.minY + f * (1 - k)))
        } else {
            p.move(to: CGPoint(x: l, y: r.minY + t))
            if t > 0 {
                p.addCurve(to: CGPoint(x: l + t, y: r.minY),
                           control1: CGPoint(x: l, y: r.minY + t * (1 - k)),
                           control2: CGPoint(x: l + t * (1 - k), y: r.minY))
                p.addLine(to: CGPoint(x: rr - t, y: r.minY))
                p.addCurve(to: CGPoint(x: rr, y: r.minY + t),
                           control1: CGPoint(x: rr - t * (1 - k), y: r.minY),
                           control2: CGPoint(x: rr, y: r.minY + t * (1 - k)))
            } else {
                p.addLine(to: CGPoint(x: rr, y: r.minY))
            }
        }
        if f > 0 {
            // 先画左边一路下来，最后在右上角反弯回屏幕上沿
            p.addLine(to: CGPoint(x: l, y: r.maxY - b))
            p.addCurve(to: CGPoint(x: l + b, y: r.maxY),
                       control1: CGPoint(x: l, y: r.maxY - b * (1 - k)),
                       control2: CGPoint(x: l + b * (1 - k), y: r.maxY))
            p.addLine(to: CGPoint(x: rr - b, y: r.maxY))
            p.addCurve(to: CGPoint(x: rr, y: r.maxY - b),
                       control1: CGPoint(x: rr - b * (1 - k), y: r.maxY),
                       control2: CGPoint(x: rr, y: r.maxY - b * (1 - k)))
            p.addLine(to: CGPoint(x: rr, y: r.minY + f))
            p.addCurve(to: CGPoint(x: r.maxX, y: r.minY),
                       control1: CGPoint(x: rr, y: r.minY + f * (1 - k)),
                       control2: CGPoint(x: r.maxX - f * k, y: r.minY))
        } else {
            p.addLine(to: CGPoint(x: rr, y: r.maxY - b))
            p.addCurve(to: CGPoint(x: rr - b, y: r.maxY),
                       control1: CGPoint(x: rr, y: r.maxY - b * (1 - k)),
                       control2: CGPoint(x: rr - b * (1 - k), y: r.maxY))
            p.addLine(to: CGPoint(x: l + b, y: r.maxY))
            p.addCurve(to: CGPoint(x: l, y: r.maxY - b),
                       control1: CGPoint(x: l + b * (1 - k), y: r.maxY),
                       control2: CGPoint(x: l, y: r.maxY - b * (1 - k)))
        }
        p.closeSubpath()
        return p
    }
}

/// 内容出现、消失时的模糊
private struct BlurFx: ViewModifier {
    var radius: CGFloat
    func body(content: Content) -> some View { content.blur(radius: radius) }
}

/// 整个面板。面板窗口固定得比形状大，形状贴着窗口顶边正中；展开收起只是形状在动画里长大缩小，窗口不跳。
/// 刘海模式：上面一排是两侧（中间空出摄像头那块），展开后下面是内容；菜单栏模式只有内容
struct NotchRootView: View {
    @Bindable var vm: NotchViewModel
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        let notch = vm.geometry.placement == .notch
        let ears = NotchLayout.ears(vm)
        VStack(spacing: 0) {
            panel
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { vm.panelRect = $0 }
            if notch {
                GlowStrip(vm: vm).frame(height: NotchGeometry.stripRoom, alignment: .top)
                    .padding(.horizontal, NotchGeometry.flare + 4)
            }
        }
        .frame(width: NotchLayout.width(vm), alignment: .top)
        // 两侧耳朵不一样宽时，整块往宽的那边挪，中间那段始终对着刘海
        .padding(.leading, max(0, ears.right - ears.left))
        .padding(.trailing, max(0, ears.left - ears.right))
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .animation(vm.motion, value: vm.state)
        .animation(vm.motion, value: NotchLayout.width(vm))
        .animation(vm.motion, value: ears)
        .animation(vm.motion, value: vm.model.queue.count)
        .animation(vm.motion, value: vm.geometry)
        .environment(\.colorScheme, .dark)
    }

    private var still: Bool { reduce || vm.reduceMotion }
    private var open: Bool { vm.state != .idle }

    @ViewBuilder private var panel: some View {
        let g = vm.geometry
        VStack(spacing: 0) {
            if g.placement == .notch {
                EarsRow(vm: vm).frame(height: g.topHeight)
            }
            if open {
                content
                    .id(vm.state)
                    .padding(.horizontal, 14)
                    .padding(.top, g.placement == .notch ? 4 : 12)
                    .padding(.bottom, 14)
                    .transition(contentTransition)
            }
        }
        .padding(.horizontal, g.placement == .notch ? NotchGeometry.flare : 0)
        .background {
            shape.fill(Theme.bg)
                .shadow(color: .black.opacity(open ? 0.45 : 0), radius: open ? 22 : 0, y: open ? 10 : 0)
        }
        .clipShape(shape)
        .contentShape(shape)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Pigeon 刘海面板")
    }

    /// 展开：形状先长出来，内容稍后淡入、从略小放大、由模糊变清楚；收起：内容先很快淡出，形状再缩回去
    private var contentTransition: AnyTransition {
        if still { return .opacity.animation(.easeInOut(duration: 0.16)) }
        return .asymmetric(
            insertion: .opacity
                .combined(with: .scale(scale: 0.96, anchor: .top))
                .combined(with: .modifier(active: BlurFx(radius: 6), identity: BlurFx(radius: 0)))
                .animation(.easeOut(duration: 0.18).delay(0.04)),
            removal: .opacity
                .combined(with: .modifier(active: BlurFx(radius: 4), identity: BlurFx(radius: 0)))
                .animation(.easeIn(duration: 0.07)))
    }

    private var shape: NotchShape {
        if vm.geometry.placement == .menuBar {
            return NotchShape(flare: 0, bottomRadius: NotchGeometry.menuRadius, topRadius: NotchGeometry.menuRadius)
        }
        return NotchShape(flare: NotchGeometry.flare, bottomRadius: open ? NotchGeometry.openRadius : NotchGeometry.idleRadius)
    }

    @ViewBuilder private var content: some View {
        // 没有关闭按钮：鼠标移开、点面板外面、按 Esc 都会收起
        Group {
            switch vm.state {
            case .idle: EmptyView()
            case .overview: OverviewView(vm: vm)
            case .queue: QueueView(vm: vm)
            case .reply: ReplyView(vm: vm)
            case .compose: ComposeView(vm: vm)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .foregroundStyle(Theme.text)
        .accessibilityAction(.escape) { vm.collapse() }
    }
}

/// 宽度规矩
enum NotchLayout {
    /// 中间那段：刘海本身那么宽。没有刘海的屏幕上什么事都没有时，留一小段胶囊当入口
    @MainActor static func center(_ vm: NotchViewModel) -> CGFloat {
        let g = vm.geometry
        if !g.hasNotch && vm.state == .idle && EarText.isQuiet(vm.model) { return 120 }
        return g.notchWidth
    }

    /// 两侧耳朵：收起时按内容各算各的，展开时平分
    @MainActor static func ears(_ vm: NotchViewModel) -> EarWidths {
        let g = vm.geometry
        if g.placement == .menuBar { return EarWidths(left: 0, right: 0) }
        return EarLayout.widths(model: vm.model, open: vm.state != .idle, notchWidth: g.notchWidth, openWidth: NotchGeometry.openWidth)
    }

    @MainActor static func width(_ vm: NotchViewModel) -> CGFloat {
        if vm.geometry.placement == .menuBar { return NotchGeometry.menuWidth }
        let e = ears(vm)
        return center(vm) + e.left + e.right + NotchGeometry.flare * 2
    }
}

/// 上面一排：左边在干活的 agent（或“已暂停”），右边几件等你
struct EarsRow: View {
    @Bindable var vm: NotchViewModel
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        let m = vm.model
        let ears = NotchLayout.ears(vm)
        let badge = EarLayout.badge(m)
        HStack(spacing: 0) {
            HStack(spacing: EarLayout.pipGap) {
                if m.paused {
                    Label("已暂停", systemImage: "pause.fill").labelStyle(.titleAndIcon)
                        .font(.system(size: EarLayout.badgeFont, weight: .semibold)).foregroundStyle(Theme.amber)
                        .fixedSize()
                } else {
                    ForEach(m.runningAgents, id: \.self) { a in
                        Pip(agent: a, breathing: !reduce && !vm.reduceMotion)
                            .help("\(a.displayName) 在干活")
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.leading, EarLayout.lead)
            .frame(width: ears.left, alignment: .leading)
            .clipped()
            Color.clear.frame(width: NotchLayout.center(vm))
            HStack(spacing: EarLayout.symbolGap) {
                Spacer(minLength: 0)
                if let badge {
                    Image(systemName: badge.symbol).font(.system(size: 10, weight: .semibold))
                        .frame(width: EarLayout.symbolWidth)
                    Text("\(badge.count)")
                        .font(.system(size: EarLayout.badgeFont, weight: badge.urgent ? .semibold : .regular).monospacedDigit())
                        .fixedSize()
                }
            }
            .foregroundStyle(badge?.urgent == true ? Theme.red : Theme.mut)
            .padding(.trailing, EarLayout.lead)
            .frame(width: ears.right, alignment: .trailing)
            .clipped()
            .help(badge?.help ?? "")
            .onTapGesture {
                if badge?.urgent == true { vm.show(.queue, opener: .click, takeFocus: true) } else if m.unreadReplies > 0 { vm.show(.reply, opener: .click, takeFocus: false) }
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(EarText.summary(m))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { vm.show(m.waitingCount > 0 ? .queue : .overview, opener: .click, takeFocus: true) }
    }
}

/// 在干活的 agent 的小圆点。呼吸由 Core Animation 跑，不在干活时这个点根本不在
struct Pip: View {
    var agent: AgentKind
    var breathing: Bool

    var body: some View {
        PipLayer(hex: agent.identityHex, breathing: breathing).frame(width: 8, height: 8)
    }
}

/// 下沿的光带：每个本机 agent 一段，身份色；在干活的、等你的会呼吸，空闲的淡。
/// 没有一段在呼吸时就是一张静止的图，不占 CPU
struct GlowStrip: View {
    @Bindable var vm: NotchViewModel
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        GlowStripLayers(segments: vm.model.agents.map { GlowSegment(agent: $0.agent, state: $0.state) },
                        pulse: vm.pulse, still: reduce || vm.reduceMotion)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}
