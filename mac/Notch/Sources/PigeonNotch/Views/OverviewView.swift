import SwiftUI

/// 悬停总览：等你的一条、在等你回答的 agent、新回信、正在进行的对话
struct OverviewView: View {
    @Bindable var vm: NotchViewModel

    var body: some View {
        let m = vm.model
        VStack(alignment: .leading, spacing: 0) {
            if m.queue.count > 0 {
                Banner(text: "\(m.queue.count) 件等你处理", color: Theme.red, bg: Theme.redBg) {
                    vm.show(.queue, opener: .click, takeFocus: true)
                }
                .padding(.trailing, 28)
            }
            if m.unreadReplies > 0 {
                Banner(text: "\(m.unreadReplies) 封新回信", color: Theme.go, bg: Theme.maskedBg) {
                    vm.show(.reply, opener: .click, takeFocus: false)
                }
                .padding(.trailing, m.queue.isEmpty ? 28 : 0)
            }
            ForEach(Array(m.prompts.enumerated()), id: \.element.id) { i, p in
                PromptRow(vm: vm, prompt: p).padding(.trailing, i == 0 && m.queue.isEmpty && m.unreadReplies == 0 ? 28 : 0)
            }
            HudHeader(title: "正在进行", reserveClose: m.queue.isEmpty && m.unreadReplies == 0 && m.prompts.isEmpty) {
                Text("\(m.liveSessions.count)").monospacedDigit()
            }
            if m.liveSessions.isEmpty {
                Text("现在没有在干活的对话").font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.vertical, 4)
            }
            ForEach(m.liveSessions.prefix(6)) { s in SessionRow(vm: vm, s: s) }
            if m.liveSessions.count > 6 {
                Button("还有 \(m.liveSessions.count - 6) 个，打开 Pigeon 看全部") { vm.openMain(.stage) }.buttonStyle(.hud(.link))
            }
            HStack {
                Text(vm.machine.opener == .hover ? "移开鼠标就收起" : (m.paused ? "已暂停：Pigeon 不再送出任何消息" : ""))
                    .font(.system(size: 11.5)).foregroundStyle(Theme.faint)
                Spacer()
                Button(m.paused ? "继续" : "全部暂停") { vm.setPaused(!m.paused) }.buttonStyle(.hud(m.paused ? .go : .no))
                Button("派活") { vm.show(.compose, opener: .click, takeFocus: true) }.buttonStyle(.hud())
                Button("打开 Pigeon") { vm.openMain(.stage) }.buttonStyle(.hud())
            }
            .padding(.top, 10)
        }
    }
}

struct Banner: View {
    var text: String
    var color: Color
    var bg: Color
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack { Text(text); Spacer(); Text("›") }
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundStyle(color)
                .padding(.horizontal, 11).padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(bg.opacity(hover ? 1.4 : 1)))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .padding(.bottom, 8)
    }
}

/// 在等你回答的 agent（比如 Claude Code 等你批准一个工具）
struct PromptRow: View {
    @Bindable var vm: NotchViewModel
    var prompt: WaitingPrompt

    var body: some View {
        HStack(spacing: 9) {
            AgentLogo(agent: prompt.who.agent, size: 18)
            VStack(alignment: .leading, spacing: 1) {
                Text(prompt.title).font(.system(size: 12.5, weight: .semibold)).lineLimit(1)
                Text([prompt.who.sessionTitle, prompt.message].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.system(size: 11.5)).foregroundStyle(Theme.dim).lineLimit(1)
            }
            Spacer(minLength: 4)
            if prompt.canJump {
                Button { vm.jump(prompt.who); vm.collapse() } label: { Label("跳回对话", systemImage: "arrow.up.forward.app") }
                    .buttonStyle(.hud(.link))
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 9).fill(Theme.redBg.opacity(0.6)))
        .padding(.bottom, 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(prompt.who.agent.displayName) 在等你：\(prompt.title)")
    }
}

struct SessionRow: View {
    @Bindable var vm: NotchViewModel
    var s: SessionInfo
    @State private var hover = false

    var body: some View {
        HStack(spacing: 9) {
            AgentLogo(agent: s.agent, size: 18).frame(width: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(s.title).font(.system(size: 12.5, weight: .medium)).lineLimit(1)
                Text(s.agent.displayName + (s.isLocal ? "" : " @ \(s.deviceName)") + (s.detail.isEmpty ? "" : " · \(s.detail)"))
                    .font(.system(size: 11.5)).foregroundStyle(Theme.dim).lineLimit(1)
            }
            Spacer(minLength: 4)
            Text(s.state.label).font(.system(size: 11)).foregroundStyle(Theme.state(s.state))
        }
        .padding(.horizontal, 8).padding(.vertical, 5)
        .background(RoundedRectangle(cornerRadius: 9).fill(.white.opacity(hover ? 0.07 : 0)))
        .onHover { hover = $0 }
        .contentShape(Rectangle())
        .onTapGesture { vm.jump(s.endpoint) }
        .help("点一下跳回这个对话")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(s.title)，\(s.agent.displayName)\(s.isLocal ? "" : "，在 \(s.deviceName)")，\(s.state.label)。\(s.detail)")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { vm.jump(s.endpoint) }
    }
}

/// 回信到了：谁答的、答给谁、任务、答话，跳回对话、知道了、转给指挥
struct ReplyView: View {
    @Bindable var vm: NotchViewModel

    var body: some View {
        if let r = vm.currentReply {
            VStack(alignment: .leading, spacing: 0) {
                HudHeader(title: r.unread ? "回信到了" : "回信") {
                    TimelineView(.periodic(from: .now, by: 30)) { c in Text(TimeText.ago(r.at, now: c.date)) }
                }
                RouteLine(from: r.from.agent, to: r.to.agent, device: r.from.isLocal ? nil : r.from.deviceName)
                Text(r.title).font(.system(size: 12)).foregroundStyle(Theme.dim).lineLimit(2).padding(.top, 6)
                ScrollView { Quote(text: Text(r.answer)) }
                    .frame(maxHeight: 160).fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 8)
                    .accessibilityLabel("回信：\(r.answer)")
                HStack(spacing: 4) {
                    if !r.duration.isEmpty { Text("用时 \(r.duration)").font(.system(size: 11.5)).foregroundStyle(Theme.faint) }
                    if r.canJump {
                        Button { vm.jump(r.from); vm.markRead(r); vm.collapse() } label: { Label("跳回对话", systemImage: "arrow.up.forward.app") }
                            .buttonStyle(.hud(.link))
                    }
                    Spacer()
                    Button("知道了") { vm.markRead(r); vm.collapse() }.buttonStyle(.hud())
                    if r.canForward { Button("转给指挥") { vm.forward(r) }.buttonStyle(.hud(.go)) }
                }
                let others = vm.model.replies.filter { $0.band != r.band && $0.unread }
                if !others.isEmpty {
                    Divider().overlay(Color.white.opacity(0.08)).padding(.vertical, 10)
                    Text("还有 \(others.count) 封没看").font(.system(size: 11.5)).foregroundStyle(Theme.dim)
                    ForEach(others.prefix(3)) { o in
                        Button { vm.replyBand = o.band } label: {
                            HStack(spacing: 6) {
                                AgentLogo(agent: o.from.agent, size: 14)
                                Text(o.title).lineLimit(1).foregroundStyle(Theme.mut)
                                Spacer()
                                Text(TimeText.ago(o.at, now: Date())).foregroundStyle(Theme.faint)
                            }.font(.system(size: 12)).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain).padding(.vertical, 3)
                    }
                }
            }
        } else {
            HudHeader(title: "没有新的回信") { EmptyView() }
            Text("派出去的任务回信后会在这里显示摘要。").font(.system(size: 12)).foregroundStyle(Theme.dim)
        }
    }
}
