import SwiftUI

/// 快速派活：按设备选对象，选新开对话还是发到已有对话，选模型和思考强度，写一句，发出
struct ComposeView: View {
    @Bindable var vm: NotchViewModel
    @FocusState private var fieldFocused: Bool

    var body: some View {
        let data = vm.model.compose
        let s = vm.compose
        VStack(alignment: .leading, spacing: 0) {
            HudHeader(title: ComposeLogic.title(s, in: data)) { EmptyView() }
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 10, verticalSpacing: 7) {
                ForEach(data.devices) { d in
                    GridRow {
                        label(d.name + (d.online ? "" : " · 连不上"))
                        FlowChips(spacing: 6) {
                            ForEach(d.agents, id: \.agent) { a in
                                TargetChip(agent: a, selected: s.target == TargetKey(agent: a.agent, device: d.id)) {
                                    ComposeLogic.selectTarget(&vm.compose, TargetKey(agent: a.agent, device: d.id), in: data)
                                }
                            }
                        }
                    }
                }
                if let t = s.target, let found = ComposeLogic.lookup(t, in: data) {
                    let agent = found.agent
                    if !agent.sessions.isEmpty {
                        GridRow {
                            label("发到")
                            Picker("发到", selection: Binding(get: { vm.compose.session },
                                                            set: { ComposeLogic.selectSession(&vm.compose, $0, in: data) })) {
                                Text("新开一个对话").tag("")
                                // 标题太长的截一下：这个下拉的宽度跟着最长的那一项走，不截会把面板撑宽
                                ForEach(agent.sessions) { r in
                                    Text("已有对话：\(r.title.count > 22 ? String(r.title.prefix(22)) + "…" : r.title)").tag(r.id)
                                }
                            }
                            .labelsHidden().pickerStyle(.menu).controlSize(.small).fixedSize().frame(maxWidth: 310, alignment: .leading)
                            .accessibilityLabel("发到新对话还是已有对话")
                        }
                    }
                    let pick = ComposeLogic.pick(s, for: t, in: data)
                    GridRow {
                        label("模型")
                        FlowChips(spacing: 5) {
                            ForEach(agent.models) { m in
                                ModelChip(model: m, selected: pick?.model == m.id) {
                                    ComposeLogic.selectModel(&vm.compose, m.id, in: data)
                                }
                            }
                        }
                    }
                    // magpie 的路由组自己定思考强度，这一行就不出现
                    if !ComposeLogic.isRouted(agent, model: pick?.model ?? "") {
                        GridRow {
                            label("思考")
                            EffortPicker(levels: ComposeLogic.levels(agent, model: pick?.model ?? ""), current: pick?.effort) {
                                ComposeLogic.selectEffort(&vm.compose, $0, in: data)
                            }
                        }
                    }
                }
            }
            TextField("让它做什么…", text: Binding(get: { vm.compose.draft }, set: { vm.draftChanged($0) }), axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...5)
                .font(.system(size: 13))
                .padding(.horizontal, 10).padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 10).fill(Theme.well))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.12)))
                .focused($fieldFocused)
                .onSubmit { vm.send() }
                .disabled(s.sending)
                .padding(.top, 10).padding(.bottom, 8)
                .accessibilityLabel("让它做什么")
            suggestion
            if let e = s.error {
                Label(e, systemImage: "exclamationmark.triangle.fill").font(.system(size: 11.5)).foregroundStyle(Theme.red)
                    .padding(.bottom, 6)
            } else if s.sentBand != nil {
                Label("已发出", systemImage: "checkmark").font(.system(size: 11.5)).foregroundStyle(Theme.go).padding(.bottom, 6)
            }
            HudFooter(vm: vm, pause: false) {
                Button("取消") { vm.collapse() }.buttonStyle(.hud())
                Button { vm.send() } label: { Label(s.sending ? "发送中…" : "发出", systemImage: "paperplane.fill") }
                    .buttonStyle(.hud(.go))
                    .disabled(s.sending || ComposeLogic.blockReason(s, in: data) != nil)
                    // 发到哪、要不要先确认，放在悬停提示里
                    .help(ComposeLogic.blockReason(s, in: data) ?? "\(ComposeLogic.footer(s, in: data))。回车发出")
            }
        }
        .onAppear { if vm.machine.keyAllowed { fieldFocused = true } }
        .onChange(of: vm.machine.keyAllowed) { _, k in if k { fieldFocused = true } }
    }

    private func label(_ t: String) -> some View {
        Text(t).font(.system(size: 11)).foregroundStyle(Color(hex: 0x7d7f88)).lineLimit(1)
            .gridColumnAlignment(.trailing)
    }

    @ViewBuilder private var suggestion: some View {
        let data = vm.model.compose
        if let k = vm.compose.suggestion, let found = ComposeLogic.lookup(k, in: data) {
            let name = found.agent.agent.displayName + (found.device.isLocal ? "" : " @ \(found.device.name)")
            if k != vm.compose.target {
                Button { ComposeLogic.selectTarget(&vm.compose, k, in: data) } label: { Label("按分派规则改给 \(name)", systemImage: "arrow.triangle.branch") }
                    .buttonStyle(.hud(.link))
                    .padding(.bottom, 6)
            }
        }
    }
}

/// 对象：logo 加短名；不能选的压暗，悬停写原因
struct TargetChip: View {
    var agent: ComposeAgent
    var selected: Bool
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                AgentLogo(agent: agent.agent, size: 14)
                Text(agent.agent.shortName)
            }
            .font(.system(size: 12))
            .foregroundStyle(Theme.soft)
            .padding(.leading, 5).padding(.trailing, 9).padding(.vertical, 3)
            .background(Capsule().fill(selected ? Theme.chipOn : .white.opacity(hover ? 0.06 : 0)))
            .overlay(Capsule().strokeBorder(selected ? .clear : Theme.line))
            .opacity(agent.enabled ? 1 : 0.5)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!agent.enabled)
        .onHover { hover = $0 }
        .help(agent.enabled ? agent.agent.displayName : agent.disabledReason)
        .accessibilityLabel(agent.agent.displayName + (agent.enabled ? "" : "，不能选：\(agent.disabledReason)"))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct ModelChip: View {
    var model: ModelOption
    var selected: Bool
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            Text(model.id)
                .font(.system(size: 11.5, design: .monospaced))
                .foregroundStyle(selected ? Color(hex: 0x0b0b0d) : Theme.mut)
                .padding(.horizontal, 8).padding(.vertical, 2)
                .background(RoundedRectangle(cornerRadius: 7).fill(selected ? Theme.text : .white.opacity(hover ? 0.08 : 0)))
                .overlay(RoundedRectangle(cornerRadius: 7)
                    .strokeBorder(selected ? .clear : Theme.line, style: StrokeStyle(lineWidth: 1, dash: model.routedByMagpie ? [3, 2] : [])))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help(model.note)
        .accessibilityLabel("模型 \(model.id)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// 思考强度：和节点上一样的竖条，点第几格就是哪一档
struct EffortPicker: View {
    var levels: [Effort]
    var current: Effort?
    var pick: (Effort) -> Void

    var body: some View {
        if levels.isEmpty {
            Text("不分思考强度").font(.system(size: 11.5)).foregroundStyle(Color(hex: 0x7d7f88))
        } else {
            let ci = current.flatMap { levels.firstIndex(of: $0) } ?? -1
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(Array(levels.enumerated()), id: \.element) { i, l in
                    Button { pick(l) } label: {
                        RoundedRectangle(cornerRadius: 1.5)
                            .fill(i <= ci ? Theme.text : .white.opacity(0.2))
                            .frame(width: 5, height: CGFloat(5 + l.bars * 3))
                            .padding(.horizontal, 2).padding(.bottom, 2)
                            .frame(height: 20, alignment: .bottom)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help(l.label)
                    .accessibilityLabel("思考强度 \(l.label)")
                    .accessibilityAddTraits(l == current ? .isSelected : [])
                }
                Text(current?.label ?? "").font(.system(size: 11.5)).foregroundStyle(Theme.mut).padding(.leading, 5).padding(.bottom, 3)
            }
        }
    }
}

/// 一排放不下就折行
struct FlowChips: Layout {
    var spacing: CGFloat = 6
    /// 最宽占多少。面板的宽度是按内容量出来的，不设上限的话，模型一多就排成一长行，把面板撑得比屏幕上那块还宽
    var maxWidth: CGFloat = 310

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = min(proposal.width ?? .infinity, maxWidth)
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, widest: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0 && x + s.width > maxW { y += row + spacing; x = 0; row = 0 }
            x += s.width + spacing
            row = max(row, s.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, maxW), height: y + row)
    }

    func placeSubviews(in b: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = b.minX, y = b.minY, row: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > b.minX && x + s.width > b.maxX { y += row + spacing; x = b.minX; row = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            row = max(row, s.height)
        }
    }
}
