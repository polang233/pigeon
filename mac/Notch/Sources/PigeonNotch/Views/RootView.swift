import SwiftUI

/// 刘海的外形：顶上两角往外翻一点贴住屏幕上沿，下面两角圆
struct NotchShape: Shape {
    var flare: CGFloat
    var bottomRadius: CGFloat

    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { AnimatablePair(flare, bottomRadius) }
        set { flare = newValue.first; bottomRadius = newValue.second }
    }

    func path(in r: CGRect) -> Path {
        let f = flare, b = min(bottomRadius, (r.height - f) / 2, (r.width - 2 * f) / 2)
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.minY))
        p.addQuadCurve(to: CGPoint(x: r.minX + f, y: r.minY + f), control: CGPoint(x: r.minX + f, y: r.minY))
        p.addLine(to: CGPoint(x: r.minX + f, y: r.maxY - b))
        p.addQuadCurve(to: CGPoint(x: r.minX + f + b, y: r.maxY), control: CGPoint(x: r.minX + f, y: r.maxY))
        p.addLine(to: CGPoint(x: r.maxX - f - b, y: r.maxY))
        p.addQuadCurve(to: CGPoint(x: r.maxX - f, y: r.maxY - b), control: CGPoint(x: r.maxX - f, y: r.maxY))
        p.addLine(to: CGPoint(x: r.maxX - f, y: r.minY + f))
        p.addQuadCurve(to: CGPoint(x: r.maxX, y: r.minY), control: CGPoint(x: r.maxX - f, y: r.minY))
        p.closeSubpath()
        return p
    }
}

/// 整个面板。刘海模式：上面一排是两侧（中间空出摄像头那块），展开后下面是内容；菜单栏模式只有内容
struct NotchRootView: View {
    @Bindable var vm: NotchViewModel

    var body: some View {
        VStack(spacing: 0) {
            panel
            if vm.geometry.placement == .notch {
                GlowStrip(vm: vm).frame(height: NotchGeometry.stripRoom, alignment: .top)
                    .padding(.horizontal, NotchGeometry.flare)
            }
        }
        .frame(width: NotchLayout.width(vm), alignment: .top)
        .fixedSize(horizontal: false, vertical: true)
        .environment(\.colorScheme, .dark)
    }

    @ViewBuilder private var panel: some View {
        let g = vm.geometry
        VStack(spacing: 0) {
            if g.placement == .notch {
                EarsRow(vm: vm).frame(height: g.topHeight)
            }
            if vm.state != .idle {
                content
                    .padding(.horizontal, 14)
                    .padding(.top, g.placement == .notch ? 4 : 12)
                    .padding(.bottom, 14)
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, g.placement == .notch ? NotchGeometry.flare : 0)
        .background(shape.fill(Theme.bg))
        .clipShape(shape)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Pigeon 刘海面板")
    }

    private var shape: AnyShape {
        if vm.geometry.placement == .menuBar { return AnyShape(RoundedRectangle(cornerRadius: 14, style: .continuous)) }
        return AnyShape(NotchShape(flare: NotchGeometry.flare, bottomRadius: vm.state == .idle ? 10 : 22))
    }

    @ViewBuilder private var content: some View {
        ZStack(alignment: .topTrailing) {
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
            Button { vm.collapse() } label: {
                Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)).frame(width: 24, height: 24)
            }
            .buttonStyle(.hud(.link))
            .padding(.top, -4)
            .accessibilityLabel("收起刘海面板")
            .help("收起（Esc）")
        }
        .foregroundStyle(Theme.text)
    }
}

/// 宽度规矩
enum NotchLayout {
    @MainActor static func width(_ vm: NotchViewModel) -> CGFloat {
        let g = vm.geometry
        if g.placement == .menuBar { return NotchGeometry.menuWidth }
        let flare = NotchGeometry.flare * 2
        if vm.state != .idle { return max(NotchGeometry.openWidth, g.notchWidth + 2 * NotchGeometry.earWidth) + flare }
        if EarText.isQuiet(vm.model) { return (g.hasNotch ? g.notchWidth : 120) + flare }
        return g.notchWidth + 2 * NotchGeometry.earWidth + flare
    }
}

/// 上面一排：左边在干活的 agent（或“已暂停”），右边几件等你
struct EarsRow: View {
    @Bindable var vm: NotchViewModel
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        let m = vm.model
        let right = EarText.right(m)
        HStack(spacing: 0) {
            HStack(spacing: 5) {
                if m.paused {
                    Label("已暂停", systemImage: "pause.fill").labelStyle(.titleAndIcon)
                        .font(.system(size: 11.5, weight: .semibold)).foregroundStyle(Theme.amber)
                } else {
                    ForEach(m.runningAgents, id: \.self) { a in
                        Pip(color: Theme.identity(a), breathing: !reduce && !vm.reduceMotion)
                            .help("\(a.displayName) 在干活")
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.leading, 12)
            Spacer(minLength: vm.geometry.notchWidth)
            HStack {
                Spacer(minLength: 0)
                if !right.text.isEmpty {
                    Text(right.text)
                        .font(.system(size: 11.5, weight: right.urgent ? .semibold : .regular).monospacedDigit())
                        .foregroundStyle(right.urgent ? Theme.red : Theme.mut)
                        .lineLimit(1)
                        .onTapGesture { if right.urgent { vm.show(.queue, opener: .click, takeFocus: true) } else if m.unreadReplies > 0 { vm.show(.reply, opener: .click, takeFocus: false) } }
                }
            }
            .padding(.trailing, 12)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(EarText.summary(m))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { vm.show(m.waitingCount > 0 ? .queue : .overview, opener: .click, takeFocus: true) }
    }
}

struct Pip: View {
    var color: Color
    var breathing: Bool
    @State private var dim = false

    var body: some View {
        Circle().fill(color).frame(width: 8, height: 8)
            .opacity(dim ? 0.35 : 1)
            .onAppear {
                guard breathing else { return }
                withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) { dim = true }
            }
    }
}

/// 下沿的光带：每个本机 agent 一段，身份色；在干活的、等你的会呼吸，空闲的淡
struct GlowStrip: View {
    @Bindable var vm: NotchViewModel
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        let agents = vm.model.agents
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduce || vm.reduceMotion)) { ctx in
            Canvas { g, size in
                let segs = GlowLayout.segments(count: agents.count, width: size.width)
                let t = ctx.date.timeIntervalSinceReferenceDate
                for (i, a) in agents.enumerated() {
                    let s = segs[i]
                    var alpha = 0.9
                    let still = reduce || vm.reduceMotion
                    switch a.state {
                    case .idle, .done: alpha = 0.35
                    case .off: alpha = 0.15
                    case .run: alpha = still ? 0.9 : 0.625 + 0.275 * cos(t * 2 * .pi / 1.6)
                    case .wait, .error: alpha = still ? 0.9 : 0.625 + 0.275 * cos(t * 2 * .pi / 1.1)
                    }
                    var h: CGFloat = 2
                    if let p = vm.pulse[a.agent], !still {
                        let age = ctx.date.timeIntervalSince(p)
                        if age < 0.6 { let k = 1 - age / 0.6; h += 4 * k; alpha = min(1, alpha + k) }
                    }
                    let rect = CGRect(x: s.x, y: 0, width: s.w, height: h)
                    let color = Theme.identity(a.agent)
                    var layer = g
                    layer.addFilter(.shadow(color: color.opacity(0.6), radius: 3))
                    layer.fill(Path(roundedRect: rect, cornerRadius: 1), with: .color(color.opacity(alpha)))
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
