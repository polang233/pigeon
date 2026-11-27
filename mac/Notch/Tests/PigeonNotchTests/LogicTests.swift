import Foundation
import Testing
@testable import PigeonNotch

// 纯逻辑的测试：键盘规矩、选中、按钮、倒计时、思考强度落到中间、打码、开合、光带和抛物线。

private let now = Date(timeIntervalSince1970: 1_800_000_000)
private func item(_ id: String, _ kind: QueueKind = .relay, secrets: [String] = [], deadline: Date? = nil, canJump: Bool = true) -> QueueItem {
    QueueItem(id: id, kind: kind, from: Endpoint(agent: .claude, session: "s1"), to: Endpoint(agent: .codex), preview: id,
              created: now, deadline: deadline, secrets: secrets, canJump: canJump)
}
private func ctx(_ s: NotchState = .queue, pointer: Bool = false, focus: Bool = true, editing: Bool = false,
                 button: QueueButton? = nil, sel: Bool = true) -> KeyContext {
    KeyContext(state: s, pointerInside: pointer, focusInside: focus, editingText: editing, focusedButton: button, hasSelection: sel)
}

@Suite struct KeyRules {
    @Test func 收起或鼠标焦点都不在时不接() {
        #expect(KeyRouter.route(.down, ctx(.idle, pointer: true)) == .pass)
        #expect(KeyRouter.route(.down, ctx(pointer: false, focus: false)) == .pass)
        #expect(KeyRouter.route(.escape, ctx(pointer: false, focus: false)) == .pass)
        #expect(KeyRouter.route(.enter, ctx(pointer: false, focus: false)) == .pass)
    }

    @Test func 鼠标或焦点在面板里就算数() {
        #expect(KeyRouter.route(.down, ctx(pointer: true, focus: false)) == .step(1))
        #expect(KeyRouter.route(.up, ctx(pointer: false, focus: true)) == .step(-1))
    }

    @Test func 回车放行_焦点在按钮上就按那个按钮() {
        #expect(KeyRouter.route(.enter, ctx()) == .releaseSelected)
        #expect(KeyRouter.route(.enter, ctx(button: .block)) == .press(.block))
        #expect(KeyRouter.route(.enter, ctx(button: .jump)) == .press(.jump))
    }

    @Test func 删除键拦下_Esc收起() {
        #expect(KeyRouter.route(.delete, ctx()) == .blockSelected)
        #expect(KeyRouter.route(.escape, ctx()) == .collapse)
        #expect(KeyRouter.route(.escape, ctx(.compose)) == .collapse)
    }

    @Test func 输入框里打字不抢() {
        #expect(KeyRouter.route(.delete, ctx(editing: true)) == .pass)
        #expect(KeyRouter.route(.enter, ctx(editing: true)) == .pass)
        #expect(KeyRouter.route(.escape, ctx(editing: true)) == .collapse)
    }

    @Test func 别的样子里方向键不管() {
        #expect(KeyRouter.route(.down, ctx(.overview, pointer: true)) == .pass)
        #expect(KeyRouter.route(.enter, ctx(.reply)) == .pass)
    }

    @Test func 没有选中的时候不放行() {
        #expect(KeyRouter.route(.enter, ctx(sel: false)) == .pass)
        #expect(KeyRouter.route(.delete, ctx(sel: false)) == .pass)
    }
}

@Suite struct QueueRules {
    @Test func 选中按id跟着走_没了就选原来位置上的() {
        var c = QueueCursor()
        let a = [item("a"), item("b"), item("c")]
        c.sync(a)
        #expect(c.selectedID == "a")
        c.step(1, in: a)
        #expect(c.selectedID == "b")
        // 前面插进来一件，还是 b
        c.sync([item("z")] + a)
        #expect(c.selectedID == "b")
        // b 处理掉了：选原来位置上的那件
        c.sync([item("z"), item("a"), item("c")])
        #expect(c.selectedID == "c")
        // 到头绕回去
        c.step(1, in: [item("z"), item("a"), item("c")])
        #expect(c.selectedID == "z")
        c.step(-1, in: [item("z"), item("a"), item("c")])
        #expect(c.selectedID == "c")
        c.sync([])
        #expect(c.selectedID == nil)
    }

    @Test func 按钮() {
        let relay = QueueLogic.buttons(for: item("r"), mode: .warn, now: now)
        #expect(relay.leading == [.jump, .autoRelay])
        #expect(relay.trailing == [.block, .release])
        let secret = item("x", .cross, secrets: ["npm token"], deadline: now.addingTimeInterval(30))
        #expect(QueueLogic.buttons(for: secret, mode: .warn, now: now).trailing == [.block, .releaseRaw, .releaseMasked])
        #expect(QueueLogic.buttons(for: secret, mode: .mask, now: now).trailing == [.block, .release])
        #expect(QueueLogic.buttons(for: item("n", canJump: false), mode: .warn, now: now).leading == [.autoRelay])
        #expect(QueueLogic.title(.release, kind: .split) == "全部放行")
        #expect(QueueLogic.title(.release, kind: .cross) == "放行")
    }

    @Test func 过了点的不能放行() {
        let late = item("x", .cross, deadline: now.addingTimeInterval(-1))
        #expect(QueueLogic.isExpired(late, now: now))
        #expect(QueueLogic.buttons(for: late, mode: .warn, now: now).trailing.isEmpty)
        #expect(QueueLogic.enterDecision(late, mode: .warn, now: now) == nil)
    }

    @Test func 回车放行用哪种() {
        let secret = item("x", .cross, secrets: ["npm token"], deadline: now.addingTimeInterval(30))
        #expect(QueueLogic.enterDecision(secret, mode: .warn, now: now) == .releaseMasked)
        #expect(QueueLogic.enterDecision(secret, mode: .off, now: now) == .release)
        #expect(QueueLogic.enterDecision(item("r"), mode: .warn, now: now) == .release)
        #expect(QueueLogic.decision(for: .releaseRaw) == .release)
        #expect(QueueLogic.decision(for: .jump) == nil)
    }
}

@Suite struct Texts {
    @Test func 倒计时() {
        #expect(TimeText.countdownShort(now.addingTimeInterval(62.2), now: now) == "剩 63 秒")
        #expect(TimeText.countdownLong(now.addingTimeInterval(5), now: now) == "还剩 5 秒，不点就不发")
        #expect(TimeText.countdownShort(now.addingTimeInterval(-3), now: now) == "到时间了")
    }

    @Test func 多久以前() {
        #expect(TimeText.ago(now.addingTimeInterval(-20), now: now) == "刚刚")
        #expect(TimeText.ago(now.addingTimeInterval(-300), now: now) == "5 分钟前")
        #expect(TimeText.ago(now.addingTimeInterval(-7300), now: now) == "2 小时前")
    }

    @Test func 上下文() {
        #expect(TimeText.tokens(800) == "约 800 token")
        #expect(TimeText.tokens(2400) == "约 2.4k token")
        #expect(TimeText.tokens(61000) == "约 61k token")
    }

    @Test func 查密钥和打码() {
        let t = "先登录：NPM_TOKEN=npm_9fK2xQ7LmA3pR8sT1vW4yZ6b，还有 ghp_abcdefghijklmnopqrstuvwx"
        #expect(Secrets.find(in: t).count == 2)
        #expect(Secrets.masked(t) == "先登录：NPM_TOKEN=‹npm token 已打码›，还有 ‹GitHub token 已打码›")
        #expect(Secrets.split("没有").count == 1)
        #expect(Secrets.kind(of: "AKIAABCDEFGHIJKLMNOP") == "AWS 密钥")
        #expect(Secrets.peek("npm_9fK2xQ7Lm") == "npm_9fK2…")
        #expect(Secrets.note(kinds: ["npm token"], found: 1, mode: .off) == nil)
        #expect(Secrets.note(kinds: ["npm token"], found: 1, mode: .warn)?.contains("原样放行") == true)
    }

    @Test func 两侧() {
        var m = NotchModel(agents: [LocalAgent(agent: .claude, state: .idle)])
        #expect(EarText.isQuiet(m))
        m.paused = true
        #expect(!EarText.isQuiet(m))
        #expect(EarText.summary(m).contains("已暂停"))
        m = NotchModel.sample(now: now)
        #expect(EarText.right(m).text == "4 件等你")
        #expect(EarText.right(m).urgent)
        m.queue = []; m.prompts = []
        #expect(EarText.right(m).text == "1 封回信")
    }

    @Test func 耳朵按内容收窄() {
        // 什么都没有：两边都不长出来
        var m = NotchModel(agents: [LocalAgent(agent: .claude, state: .idle)])
        var e = EarLayout.widths(model: m, open: false, notchWidth: 185, openWidth: 440)
        #expect(e == EarWidths(left: 0, right: 0))
        // 只有一个在干活：只长左边，而且比原来固定的 74 窄得多
        m.agents = [LocalAgent(agent: .claude, state: .run)]
        e = EarLayout.widths(model: m, open: false, notchWidth: 185, openWidth: 440)
        #expect(e.right == 0 && e.left > 0 && e.left <= 40)
        // 有等你的：右边是图标加数字，也不宽
        m = NotchModel.sample(now: now)
        e = EarLayout.widths(model: m, open: false, notchWidth: 185, openWidth: 440)
        #expect(e.right > 0 && e.right <= 56)
        #expect(EarLayout.badge(m)?.urgent == true && EarLayout.badge(m)?.help == "4 件等你")
        // 展开：两边平分，凑够面板宽
        e = EarLayout.widths(model: m, open: true, notchWidth: 185, openWidth: 440)
        #expect(e.left == e.right && e.left * 2 + 185 == 440)
    }
}

@Suite struct ComposeRules {
    let data = NotchModel.sample(now: now).compose
    let codex = TargetKey(agent: .codex, device: "local")
    let claude = TargetKey(agent: .claude, device: "local")
    let chen = TargetKey(agent: .codex, device: "remote-control:env_chen")

    @Test func 中间那档() {
        #expect(ComposeLogic.midLevel([.low, .medium, .high, .xhigh]) == .medium)
        #expect(ComposeLogic.midLevel([.low, .medium, .high]) == .medium)
        #expect(ComposeLogic.midLevel([.low, .high]) == .low)
        #expect(ComposeLogic.midLevel([]) == nil)
    }

    @Test func 打开时选默认对象_不能选的不选() {
        var s = ComposeState()
        ComposeLogic.open(&s, target: nil, session: nil, in: data)
        #expect(s.target == codex)
        ComposeLogic.open(&s, target: TargetKey(agent: .deepseek, device: "local"), session: nil, in: data)
        #expect(s.target == codex)
        ComposeLogic.open(&s, target: claude, session: "s1", in: data)
        #expect(s.target == claude && s.session == "s1" && s.manualTarget)
        #expect(ComposeLogic.title(s, in: data) == "发给「Pigeon 重构」")
    }

    @Test func 换模型没有那档就落到中间_不分档写nil() {
        var s = ComposeState()
        ComposeLogic.open(&s, target: claude, session: nil, in: data)
        #expect(ComposeLogic.pick(s, for: claude, in: data) == ComposePick(model: "Opus 5.5", effort: .high))
        ComposeLogic.selectEffort(&s, .xhigh, in: data)
        ComposeLogic.selectModel(&s, "Haiku 5.5", in: data)
        #expect(ComposeLogic.pick(s, for: claude, in: data)?.effort == .medium)
        ComposeLogic.selectModel(&s, "Opus 5.5", in: data)
        #expect(ComposeLogic.pick(s, for: claude, in: data)?.effort == .medium)
        ComposeLogic.selectTarget(&s, TargetKey(agent: .cursor, device: "local"), in: data)
        #expect(ComposeLogic.pick(s, for: s.target!, in: data)?.effort == nil)
        ComposeLogic.selectEffort(&s, .high, in: data) // 不分档的模型点不了
        #expect(ComposeLogic.pick(s, for: s.target!, in: data)?.effort == nil)
    }

    @Test func 每个对象各记一份_草稿换对象还在() {
        var s = ComposeState()
        ComposeLogic.open(&s, target: codex, session: nil, in: data)
        s.draft = "写了一半"
        ComposeLogic.selectModel(&s, "GPT-5.5 mini", in: data)
        ComposeLogic.selectTarget(&s, claude, in: data)
        ComposeLogic.selectModel(&s, "Sonnet 5.5", in: data)
        ComposeLogic.selectTarget(&s, codex, in: data)
        #expect(ComposeLogic.pick(s, for: codex, in: data)?.model == "GPT-5.5 mini")
        #expect(ComposeLogic.pick(s, for: claude, in: data)?.model == "Sonnet 5.5")
        #expect(s.draft == "写了一半")
    }

    @Test func magpie路由组不分思考强度() {
        var s = ComposeState()
        ComposeLogic.open(&s, target: codex, session: nil, in: data)
        ComposeLogic.selectModel(&s, "group/smart", in: data)
        #expect(ComposeLogic.pick(s, for: codex, in: data)?.effort == nil)
        ComposeLogic.selectModel(&s, "GPT-5.5", in: data)
        #expect(ComposeLogic.pick(s, for: codex, in: data)?.effort == .medium)
    }

    @Test func 建议只在没手动选过时生效() {
        var s = ComposeState()
        ComposeLogic.open(&s, target: nil, session: nil, in: data)
        ComposeLogic.applySuggestion(&s, chen, in: data)
        #expect(s.target == chen && s.suggestion == chen)
        ComposeLogic.selectTarget(&s, claude, in: data)
        ComposeLogic.applySuggestion(&s, codex, in: data)
        #expect(s.target == claude && s.suggestion == codex)
        // 建议一个不能选的：不记
        ComposeLogic.applySuggestion(&s, TargetKey(agent: .deepseek, device: "local"), in: data)
        #expect(s.suggestion == nil)
    }

    @Test func 换对象就不是发给原来那个对话() {
        var s = ComposeState()
        ComposeLogic.open(&s, target: codex, session: "s2", in: data)
        #expect(s.session == "s2")
        ComposeLogic.selectTarget(&s, claude, in: data)
        #expect(s.session == "")
    }

    @Test func 新开对话选本机目录() {
        var s = ComposeState()
        ComposeLogic.open(&s, target: codex, session: nil, in: data)
        let first = try! #require(data.projects.first)
        ComposeLogic.selectCwd(&s, first.path, in: data)
        #expect(s.cwd == first.path)
        // 不在列表里的目录忽略
        ComposeLogic.selectCwd(&s, "/nope/not-listed", in: data)
        #expect(s.cwd == first.path)
        s.draft = "看看这个目录"
        #expect(ComposeLogic.request(s, in: data)?.cwd == first.path)
        // 选已有对话时不再带 cwd；切到远程新开对话也不带本机 cwd
        ComposeLogic.selectSession(&s, "s2", in: data)
        #expect(ComposeLogic.request(s, in: data)?.cwd == "")
        ComposeLogic.selectTarget(&s, chen, in: data)
        #expect(ComposeLogic.request(s, in: data)?.cwd == "")
    }

    @Test func 底下那句和能不能发() {
        var s = ComposeState()
        ComposeLogic.open(&s, target: chen, session: nil, in: data)
        #expect(ComposeLogic.footer(s, in: data) == "跨设备，新开一个对话，发之前还会让你确认一次")
        #expect(ComposeLogic.blockReason(s, in: data) == "先写一句要它做什么")
        #expect(ComposeLogic.request(s, in: data) == nil)
        s.draft = "  跑一遍测试 "
        let r = ComposeLogic.request(s, in: data)
        #expect(r == SendRequest(to: chen, session: "", text: "跑一遍测试", model: "GPT-5.5", effort: .high))
        #expect(ComposeLogic.isCross(s, in: data))
        ComposeLogic.selectTarget(&s, codex, in: data)
        ComposeLogic.selectSession(&s, "s2", in: data)
        #expect(ComposeLogic.footer(s, in: data) == "发到这个对话里")
        var off = data
        off.devices[1].online = false
        ComposeLogic.selectTarget(&s, chen, in: off)
        #expect(ComposeLogic.blockReason(s, in: off) == "CHEN 现在连不上，发不出去")
    }

    @Test func 目标键() {
        #expect(TargetKey("codex@remote-control:env_x") == TargetKey(agent: .codex, device: "remote-control:env_x"))
        #expect(TargetKey("nobody@local") == nil)
        #expect(TargetKey("codex@") == nil)
        #expect(TargetKey(agent: .deepseek, device: "local").description == "deepseek@local")
    }
}

@Suite struct PanelRules {
    @Test func 悬停打开_移开收起_永远不拿焦点() {
        var m = PanelMachine()
        m.hoverEntered(placement: .notch)
        #expect(m.state == .overview && !m.keyAllowed)
        m.hoverExited()
        #expect(m.state == .idle)
        m.hoverEntered(placement: .menuBar)
        #expect(m.state == .idle)
    }

    @Test func 点进队列才拿焦点_点进来就钉住() {
        var m = PanelMachine()
        m.hoverEntered(placement: .notch)
        m.show(.queue, opener: .click, takeFocus: true)
        #expect(m.keyAllowed && m.opener == .click)
        m.hoverExited()
        #expect(m.state == .queue)
        m.clickedOutside()
        #expect(m.state == .idle)
    }

    @Test func 悬停后点在总览里钉住但不拿焦点() {
        var m = PanelMachine()
        m.hoverEntered(placement: .notch)
        m.clickedInside()
        #expect(m.opener == .click && !m.keyAllowed)
        m.hoverExited()
        #expect(m.state == .overview)
    }

    @Test func 应用打开派活拿焦点_来了新的一件不拿() {
        var m = PanelMachine()
        m.show(.compose, opener: .programmatic, takeFocus: true)
        #expect(m.keyAllowed)
        m.collapse()
        m.queueChanged(arrived: true, becameEmpty: false, autoOpen: true)
        #expect(m.state == .queue && m.opener == .attention && !m.keyAllowed)
        // 点别处不收，但不再算焦点
        m.clickedOutside()
        #expect(m.state == .queue)
        // 点进来才拿焦点
        m.clickedInside()
        #expect(m.keyAllowed)
        m.queueChanged(arrived: false, becameEmpty: true, autoOpen: true)
        #expect(m.state == .idle)
    }

    @Test func 开着别的样子时来了新的一件不打断() {
        var m = PanelMachine()
        m.show(.compose, opener: .programmatic, takeFocus: true)
        m.queueChanged(arrived: true, becameEmpty: false, autoOpen: true)
        #expect(m.state == .compose)
    }
}

@Suite struct FlightRules {
    @Test func 抛物线() {
        let p = FlightPath(x0: 10, x1: 110)
        #expect(p.depth == 70)
        #expect(p.point(0) == CGPoint(x: 10, y: 0))
        #expect(p.point(1) == CGPoint(x: 110, y: 0))
        #expect(p.point(0.5).y == 70)
        #expect(p.tilt(0.2) > 0 && p.tilt(0.8) < 0)
        #expect(abs(p.duration - 1.6) < 1e-9)
        #expect(FlightPath(x0: 0, x1: 20).depth == 46)
        #expect(FlightPath(x0: 50, x1: 0).facesLeft)
        #expect(!p.trail(at: 0.5).isEmpty)
    }

    @Test func 光带分段() {
        let s = GlowLayout.segments(count: 4, width: 200)
        #expect(s.count == 4)
        #expect(s[0].x == 14)
        #expect(abs(s[3].x + s[3].w - 186) < 1e-9)
        #expect(GlowLayout.center(of: 5, count: 4, width: 200) == nil)
    }

    @Test func 光带空闲时不动() {
        // 全都闲着、关着：没有一段呼吸，光带是静止的
        #expect(!GlowStyle.animates([.idle, .done, .off], still: false))
        #expect(GlowStyle.animates([.idle, .run], still: false))
        #expect(GlowStyle.animates([.wait], still: false))
        #expect(GlowStyle.animates([.error], still: false))
        // 减少动态效果时什么都不动，干活的给最亮
        #expect(!GlowStyle.animates([.run, .wait, .error], still: true))
        #expect(GlowStyle.look(.run, still: true).alpha == 1)
    }

    @Test func 光带亮度() {
        let idle = GlowStyle.look(.idle, still: false), off = GlowStyle.look(.off, still: false)
        let run = GlowStyle.look(.run, still: false)
        #expect(off.alpha < idle.alpha && idle.alpha >= 0.5)
        #expect(run.breath != nil && run.breath!.low > idle.alpha && run.breath!.high == 1)
        #expect(GlowStyle.look(.wait, still: false).breath!.period < run.breath!.period)
        #expect(GlowStyle.height >= 3)
        // 光带占的高度装得下亮一下时长出来的那截
        #expect(NotchGeometry.stripRoom >= GlowStyle.height + GlowStyle.pulseExtra)
    }

    @Test func 哪些任务要飞() {
        let a = Endpoint(agent: .claude), b = Endpoint(agent: .codex)
        let far = Endpoint(agent: .codex, device: "x", deviceName: "X", isLocal: false)
        let old = [NoteInFlight(band: "1", from: a, to: b, state: .flying, title: "", since: now)]
        let new = [NoteInFlight(band: "1", from: a, to: b, state: .home, title: "", since: now),
                   NoteInFlight(band: "2", from: b, to: a, state: .flying, title: "", since: now),
                   NoteInFlight(band: "3", from: a, to: far, state: .flying, title: "", since: now),
                   NoteInFlight(band: "4", from: Endpoint(agent: .you), to: b, state: .flying, title: "", since: now)]
        let f = FlightPlanner.flights(old: old, new: new)
        #expect(f.count == 2)
        #expect(f[0].from == .codex && f[0].to == .claude) // 回信往回飞
        #expect(f[1].from == .codex && f[1].to == .claude)
    }
}

@Suite struct SampleData {
    @Test func 示例齐全() {
        let m = NotchModel.sample(now: now)
        #expect(Set(m.queue.map(\.kind)) == Set(QueueKind.allCases))
        #expect(m.queue.first { $0.kind == .cross }?.deadline == now.addingTimeInterval(65))
        #expect(m.waitingCount == 4)
        #expect(m.liveSessions.count == 6)
        #expect(NotchModel.sampleItem(.split).parts.count == 3)
    }
}
