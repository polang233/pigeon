import SwiftUI

/// 等你处理的一队：每件一行，选中的那件展开；底下是全部暂停
struct QueueView: View {
    @Bindable var vm: NotchViewModel
    @FocusState private var focus: QueueButton?

    var body: some View {
        let m = vm.model
        VStack(alignment: .leading, spacing: 0) {
            if m.queue.isEmpty && m.prompts.isEmpty {
                HudHeader(title: "没有等你的事") { EmptyView() }
                Text("跨设备发送、转派、拆活要你点头时会排在这里。")
                    .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.bottom, 10)
                HStack {
                    Button("派活") { vm.show(.compose, opener: .click, takeFocus: true) }.buttonStyle(.hud())
                    Spacer()
                    PauseButton(vm: vm)
                }
            } else {
                HudHeader(title: "等你 · \(m.waitingCount)") {
                    if !m.queue.isEmpty { Text("↑↓ 选　↩ 放行　⌫ 拦下").font(.system(size: 10.5)).foregroundStyle(Theme.faint) }
                }
                ForEach(m.prompts) { p in PromptRow(vm: vm, prompt: p) }
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 4) {
                            ForEach(m.queue) { item in
                                QueueRow(vm: vm, item: item, selected: vm.cursor.selectedID == item.id, focus: $focus).id(item.id)
                            }
                        }
                    }
                    .frame(maxHeight: 420)
                    .fixedSize(horizontal: false, vertical: true)
                    .onChange(of: vm.cursor.selectedID) { _, id in
                        guard let id else { return }
                        withAnimation(vm.reduceMotion ? nil : .easeOut(duration: 0.15)) { proxy.scrollTo(id) }
                    }
                }
                Divider().overlay(Color.white.opacity(0.08)).padding(.top, 10).padding(.bottom, 10)
                HStack {
                    Text(m.paused ? "暂停中：放行的先排着，继续后再送出" : "拿不准时，可以先全部停下")
                        .font(.system(size: 11.5)).foregroundStyle(m.paused ? Theme.amber : Theme.faint)
                    Spacer()
                    PauseButton(vm: vm)
                }
            }
        }
        .onChange(of: focus) { _, f in vm.focusedButton = f }
    }
}

struct PauseButton: View {
    @Bindable var vm: NotchViewModel
    var body: some View {
        let p = vm.model.paused
        Button { vm.setPaused(!p) } label: { Label(p ? "继续" : "全部暂停", systemImage: p ? "play.fill" : "pause.fill") }
            .buttonStyle(.hud(p ? .go : .no))
            .help(p ? "继续送出排着的消息" : "Pigeon 不再送出任何消息，在路上的停在原地")
    }
}

/// 一行：类别、谁发给谁、一句话、时间；选中时下面展开
struct QueueRow: View {
    @Bindable var vm: NotchViewModel
    var item: QueueItem
    var selected: Bool
    var focus: FocusState<QueueButton?>.Binding
    @State private var hover = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { vm.select(item) } label: { head }
                .buttonStyle(.plain)
                .accessibilityLabel(QueueA11y.rowLabel(item, now: Date()))
                .accessibilityHint(selected ? "回车放行，删除键拦下" : "选中这件")
                .accessibilityAddTraits(selected ? .isSelected : [])
            if selected {
                QueueDetail(vm: vm, item: item, focus: focus)
                    .padding(.horizontal, 10).padding(.bottom, 10)
            }
        }
        .background(RoundedRectangle(cornerRadius: 11, style: .continuous)
            .fill(.white.opacity(selected ? 0.07 : (hover ? 0.05 : 0))))
        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
            .strokeBorder(.white.opacity(selected ? 0.1 : 0), lineWidth: 1))
        .onHover { hover = $0 }
    }

    private var head: some View {
        HStack(spacing: 6) {
            KindBadge(kind: item.kind)
            AgentLogo(agent: item.from.agent, size: 16)
            Text("→").foregroundStyle(Theme.arrow)
            HStack(spacing: 2) {
                if item.kind == .split {
                    ForEach(Array(item.parts.enumerated()), id: \.offset) { _, p in AgentLogo(agent: p.to.agent, size: 16) }
                } else {
                    AgentLogo(agent: item.to.agent, size: 16)
                }
            }
            Text(item.preview).foregroundStyle(Theme.mut).lineLimit(1).truncationMode(.tail)
            Spacer(minLength: 4)
            TimelineView(.periodic(from: .now, by: 1)) { c in
                if item.kind == .cross, let d = item.deadline {
                    Text(TimeText.countdownShort(d, now: c.date)).foregroundStyle(Theme.red).monospacedDigit()
                } else {
                    Text(TimeText.ago(item.created, now: c.date)).foregroundStyle(Theme.faint)
                }
            }
            .font(.system(size: 11))
        }
        .font(.system(size: 12.5))
        .padding(.horizontal, 9).padding(.vertical, 7)
        .contentShape(Rectangle())
    }
}

struct KindBadge: View {
    var kind: QueueKind
    var body: some View {
        Text(kind.label)
            .font(.system(size: 10.5))
            .padding(.horizontal, 6)
            .frame(height: 17)
            .foregroundStyle(kind == .cross ? Theme.red : Theme.mut)
            .background(RoundedRectangle(cornerRadius: 5).fill(kind == .cross ? Theme.redBg : .white.opacity(0.1)))
    }
}

/// 展开的那件
struct QueueDetail: View {
    @Bindable var vm: NotchViewModel
    var item: QueueItem
    var focus: FocusState<QueueButton?>.Binding

    var body: some View {
        let mode = vm.model.settings.secrets
        VStack(alignment: .leading, spacing: 0) {
            switch item.kind {
            case .cross:
                RouteLine(from: item.from.agent, to: item.to.agent, device: item.to.deviceName).padding(.top, 2)
                fullText(mode)
                if let note = Secrets.note(kinds: item.secrets, found: Secrets.find(in: item.text).count, mode: mode) {
                    Label(note, systemImage: "key.fill")
                        .font(.system(size: 11.5)).foregroundStyle(mode == .mask ? Theme.maskedFg : Theme.red)
                        .padding(.bottom, 6)
                }
                TimelineView(.periodic(from: .now, by: 1)) { c in
                    Text(QueueA11y.crossNote(item, now: c.date)).font(.system(size: 11.5)).foregroundStyle(Theme.faint)
                }
                .padding(.bottom, 9)
            case .relay:
                (Text("\(item.from.agent.displayName)\(item.from.sessionTitle.isEmpty ? "" : "（\(item.from.sessionTitle)）") 想把这件转给 ")
                 + Text(item.to.whoText).fontWeight(.semibold))
                    .font(.system(size: 12.5)).foregroundStyle(Theme.soft).padding(.top, 2)
                fullText(mode)
                if !item.ruleLabel.isEmpty {
                    Text("命中规则「\(item.ruleLabel)」").font(.system(size: 11.5)).foregroundStyle(Theme.faint).padding(.bottom, 9)
                }
            case .split:
                Text("指挥想把「\(item.from.sessionTitle.isEmpty ? item.preview : item.from.sessionTitle)」拆成 \(item.parts.count) 件，同时派出去")
                    .font(.system(size: 12.5)).foregroundStyle(Theme.soft).padding(.top, 2)
                VStack(spacing: 4) {
                    ForEach(Array(item.parts.enumerated()), id: \.offset) { _, p in
                        HStack(spacing: 7) {
                            AgentLogo(agent: p.to.agent, size: 16)
                            Text(p.to.agent.shortName).fontWeight(.medium)
                            Text(p.preview).foregroundStyle(Theme.mut).lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .font(.system(size: 12.5))
                        .padding(.horizontal, 8).padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Theme.well))
                        .accessibilityElement(children: .combine)
                    }
                }
                .padding(.vertical, 8)
            }
            buttons(mode)
        }
    }

    @ViewBuilder private func fullText(_ mode: SecretsMode) -> some View {
        let body = item.text.isEmpty ? item.preview : item.text
        ScrollView {
            SecretText.render(body, mode: mode)
                .font(.system(size: 12.5)).foregroundStyle(Theme.soft)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 11).padding(.vertical, 9)
        }
        .frame(maxHeight: 140)
        .fixedSize(horizontal: false, vertical: true)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.well))
        .padding(.top, 7).padding(.bottom, 8)
        .accessibilityLabel("原文：\(mode == .off ? body : Secrets.masked(body))")
    }

    @ViewBuilder private func buttons(_ mode: SecretsMode) -> some View {
        let set = QueueLogic.buttons(for: item, mode: mode, now: Date())
        HStack(spacing: 4) {
            ForEach(set.leading, id: \.self) { b in button(b) }
            Spacer(minLength: 4)
            ForEach(set.trailing, id: \.self) { b in button(b) }
        }
    }

    private func button(_ b: QueueButton) -> some View {
        let title = QueueLogic.title(b, kind: item.kind)
        let style: HudButtonStyle.Kind = switch b {
        case .jump, .autoRelay: .link
        case .block: .no
        case .release, .releaseMasked: .go
        case .releaseRaw: .plain
        }
        return Button { vm.press(b, on: item) } label: {
            if b == .jump { Label(title, systemImage: "arrow.up.forward.app") } else { Text(title) }
        }
        .buttonStyle(.hud(style))
        .focused(focus, equals: b)
        .help(b == .autoRelay ? "以后接活的 agent 转派不再问你，在“接入 → 协作的规矩”里能改回来" : "")
    }
}

/// 读给 VoiceOver 听的句子，以及跨设备那件的说明行
enum QueueA11y {
    static func rowLabel(_ item: QueueItem, now: Date) -> String {
        let to = item.kind == .split ? item.parts.map(\.to.agent.displayName).joined(separator: "、") : item.to.whoText
        var s = "\(item.kind.label)，\(item.from.agent.displayName) 发给 \(to)：\(item.preview)"
        if item.kind == .cross, let d = item.deadline { s += "，" + TimeText.countdownShort(d, now: now) } else { s += "，" + TimeText.ago(item.created, now: now) }
        return s
    }

    /// 跨设备：带几个文件、多少上下文、倒计时
    static func crossNote(_ item: QueueItem, now: Date) -> String {
        var parts: [String] = []
        parts.append(item.files.isEmpty ? "不带文件" : "带 \(item.files.count) 个文件")
        if item.chars > 0 { parts.append("\(item.chars) 字") }
        if let t = item.contextTokens { parts.append(TimeText.tokens(t)) }
        if let d = item.deadline { parts.append(TimeText.countdownLong(d, now: now)) }
        return parts.joined(separator: " · ")
    }
}
