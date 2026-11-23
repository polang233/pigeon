import Foundation

// 示例内容：演示程序和设置页的“演示”按钮（`show(..., demo: true)`）用。照网页 web/src/data/mock.js 的示例改写，
// 不是真数据，正式运行时不该出现在别处。

extension NotchModel {
    /// 示例。now 是“现在”，跨设备那件的倒计时按它算
    public static func sample(now: Date = Date()) -> NotchModel {
        let chen = "remote-control:env_chen"
        func local(_ a: AgentKind, _ s: String = "", _ t: String = "") -> Endpoint {
            Endpoint(agent: a, device: "local", deviceName: "本机", isLocal: true, session: s, sessionTitle: t)
        }
        func far(_ a: AgentKind, _ s: String = "", _ t: String = "") -> Endpoint {
            Endpoint(agent: a, device: chen, deviceName: "CHEN", isLocal: false, session: s, sessionTitle: t)
        }
        let ago = { (s: Double) in now.addingTimeInterval(-s) }

        let lead = local(.claude, "s1", "Pigeon 重构")
        let full: [Effort] = [.low, .medium, .high, .xhigh]
        let three: [Effort] = [.low, .medium, .high]
        let claudeModels = [ModelOption(id: "Opus 5.5", efforts: full), ModelOption(id: "Sonnet 5.5", efforts: full),
                            ModelOption(id: "Haiku 5.5", efforts: three)]
        let codexModels = [ModelOption(id: "GPT-5.5", efforts: full), ModelOption(id: "GPT-5.5 mini", efforts: three),
                           ModelOption(id: "group/smart", routedByMagpie: true, note: "magpie 的路由组：先用最快重置的订阅")]
        let cursorModels = [ModelOption(id: "Composer 2"), ModelOption(id: "Sonnet 5.5", efforts: three),
                            ModelOption(id: "GPT-5.5", efforts: three)]
        let dsModels = [ModelOption(id: "DeepSeek V4 Pro", efforts: [.low, .high]), ModelOption(id: "DeepSeek V4 Flash", efforts: [.low, .high])]

        let crossText = """
        在 Windows 上跑测试集，失败的贴回来。
        要先登录私有包源：NPM_TOKEN=npm_9fK2xQ7LmA3pR8sT1vW4yZ6b
        跑完把 test-results 目录打包发回来，别动 main 分支。
        """

        return NotchModel(
            paused: false,
            lead: .agent(.claude, device: "local"),
            agents: [LocalAgent(agent: .claude, state: .run), LocalAgent(agent: .codex, state: .run),
                     LocalAgent(agent: .cursor, state: .run), LocalAgent(agent: .deepseek, state: .idle)],
            sessions: [
                SessionInfo(id: "s1", agent: .claude, title: "Pigeon 重构", state: .run, detail: "正在把活分给 3 个 agent"),
                SessionInfo(id: "s2", agent: .codex, title: "画应用图标", state: .run, detail: "生图中，已跑 2 分 10 秒"),
                SessionInfo(id: "s3", agent: .codex, title: "审查确认框改动", state: .done, detail: "回信：两处建议"),
                SessionInfo(id: "s4", agent: .cursor, title: "设置页表单", state: .run, detail: "正在改 settings.js"),
                SessionInfo(id: "s5", agent: .deepseek, title: "批量改文案", state: .idle, detail: "空闲 12 分钟"),
                SessionInfo(id: "s6", agent: .codex, device: chen, deviceName: "CHEN", isLocal: false, title: "Windows 构建",
                            state: .run, detail: "cargo build，已跑 4 分钟"),
                SessionInfo(id: "s9", agent: .cursor, device: chen, deviceName: "CHEN", isLocal: false, title: "改安装脚本",
                            state: .error, detail: "连不上：那台的 Codex 没开，Cursor 带不起来"),
                SessionInfo(id: "s1a", agent: .claude, title: "子代理：查回调文档", state: .run, detail: "读文档中", parent: "s1"),
            ],
            queue: [
                QueueItem(id: "q2", kind: .relay, from: local(.codex, "s2", "画应用图标"), to: local(.deepseek),
                          preview: "把 assets/generated 里的 40 张图压成 webp，原图留着",
                          text: "把 assets/generated 里的 40 张图压成 webp，原图留着。压完列一下每张省了多少。",
                          ruleLabel: "批量、重复的小活", created: ago(300)),
                QueueItem(id: "q3", kind: .split, from: lead, to: local(.cursor),
                          preview: "设置页加“刘海”开关，审一遍，再改文档", created: ago(150),
                          parts: [QueuePart(to: local(.cursor), preview: "设置页加“刘海”开关"),
                                  QueuePart(to: local(.codex), preview: "审一遍开关的改动"),
                                  QueuePart(to: local(.deepseek), preview: "把文档里的旧叫法都换成“刘海”")]),
                QueueItem(id: "q1", kind: .cross, band: "t-3a07", from: lead, to: far(.claude, "s8", "跑测试集"),
                          preview: "在 Windows 上跑测试集，失败的贴回来", text: crossText, files: ["tests/README.md"],
                          project: "pigeon", contextTokens: 2400, ruleLabel: "要在 Windows 上做的", created: ago(25),
                          deadline: ago(25).addingTimeInterval(90), secrets: ["npm token"]),
            ],
            prompts: [
                WaitingPrompt(id: "p1", who: local(.claude, "s1", "Pigeon 重构"), title: "要你批准：运行 swift test",
                              message: "Claude Code 在等你点“允许”", since: ago(40)),
            ],
            notes: [
                NoteInFlight(band: "t-8f2c", from: lead, to: local(.codex, "s2", "画应用图标"), state: .flying,
                             title: "画应用图标：信鸽侧影，深色底，不要文字", since: ago(130)),
                NoteInFlight(band: "t-71ab", from: lead, to: far(.codex, "s6", "Windows 构建"), state: .delivered,
                             title: "在 Windows 上跑一遍构建，把报错贴回来", since: ago(242)),
            ],
            replies: [
                Reply(band: "t-5c11", from: local(.codex, "s3", "审查确认框改动"), to: lead, title: "审一下确认框的改动，重点看超时处理",
                      answer: "两处建议：\n1. 超时和用户点“拦下”现在是同一个退出码，建议分开。\n2. 正文超过 600 字被截断时，确认框里应当写明总字数。",
                      at: ago(20), unread: true, canForward: true, duration: "0:52"),
                Reply(band: "t-4b90", from: local(.codex, "s2", "画应用图标"), to: lead, title: "图标初稿好了，放在 assets/generated",
                      answer: "初稿两张，都在 assets/generated/ 下。第二张留白更多，更适合做小尺寸。", at: ago(780),
                      unread: false, canForward: true, duration: "0:04"),
            ],
            compose: ComposeData(
                devices: [
                    ComposeDevice(id: "local", name: "本机", isLocal: true, agents: [
                        ComposeAgent(agent: .claude, models: claudeModels, defaultModel: "Opus 5.5", defaultEffort: .high,
                                     sessions: [SessionRef(id: "s1", title: "Pigeon 重构")]),
                        ComposeAgent(agent: .codex, models: codexModels, defaultModel: "GPT-5.5", defaultEffort: .medium,
                                     sessions: [SessionRef(id: "s2", title: "画应用图标"), SessionRef(id: "s3", title: "审查确认框改动")]),
                        ComposeAgent(agent: .cursor, models: cursorModels, defaultModel: "Composer 2"),
                        ComposeAgent(agent: .deepseek, enabled: false, disabledReason: "DeepSeek Harness 还没接上，暂时不能派活",
                                     models: dsModels, defaultModel: "DeepSeek V4 Flash", defaultEffort: .low),
                    ]),
                    ComposeDevice(id: chen, name: "CHEN", isLocal: false, agents: [
                        ComposeAgent(agent: .codex, models: Array(codexModels.prefix(2)), defaultModel: "GPT-5.5", defaultEffort: .high,
                                     sessions: [SessionRef(id: "s6", title: "Windows 构建"), SessionRef(id: "s7", title: "问候")]),
                        ComposeAgent(agent: .claude, models: claudeModels, defaultModel: "Sonnet 5.5", defaultEffort: .medium,
                                     sessions: [SessionRef(id: "s8", title: "跑测试集")]),
                        ComposeAgent(agent: .cursor, enabled: false, disabledReason: "那台的 Codex 没开，Cursor 带不起来",
                                     models: cursorModels, defaultModel: "Composer 2"),
                    ]),
                ],
                defaultTarget: TargetKey(agent: .codex, device: "local")),
            settings: NotchSettings(secrets: .warn, crossTimeoutSec: 90)
        )
    }

    /// 示例（现在算起）
    public static var sample: NotchModel { sample() }

    /// 演示里“来一件”用：一件新的转派、拆活或跨设备
    public static func sampleItem(_ kind: QueueKind, now: Date = Date(), id: String = UUID().uuidString) -> QueueItem {
        let local = { (a: AgentKind, s: String, t: String) in Endpoint(agent: a, session: s, sessionTitle: t) }
        switch kind {
        case .relay:
            return QueueItem(id: id, kind: .relay, from: local(.cursor, "s4", "设置页表单"), to: local(.codex, "", ""),
                             preview: "帮我看一眼表单校验的正则对不对", text: "帮我看一眼表单校验的正则对不对，尤其是邮箱那条。",
                             ruleLabel: "审查、看一眼", created: now)
        case .split:
            return QueueItem(id: id, kind: .split, from: local(.claude, "s1", "Pigeon 重构"), to: local(.codex, "", ""),
                             preview: "空状态：插图、接进任务页、文案", created: now,
                             parts: [QueuePart(to: local(.codex, "", ""), preview: "画三张空状态插图"),
                                     QueuePart(to: local(.cursor, "", ""), preview: "把空状态接进任务页"),
                                     QueuePart(to: local(.deepseek, "", ""), preview: "空状态的文案过一遍")])
        case .cross:
            return QueueItem(id: id, kind: .cross, band: "t-" + id.prefix(4).lowercased(), from: local(.claude, "s1", "Pigeon 重构"),
                             to: Endpoint(agent: .codex, device: "remote-control:env_chen", deviceName: "CHEN", isLocal: false,
                                          session: "s6", sessionTitle: "Windows 构建"),
                             preview: "构建好了把安装包传上来", text: "构建好了把安装包传上来，文件名带上日期。",
                             contextTokens: 900, created: now, deadline: now.addingTimeInterval(90))
        }
    }
}
