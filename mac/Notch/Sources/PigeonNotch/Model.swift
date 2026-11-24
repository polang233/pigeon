import Foundation

// 刘海面板吃的数据。全是值类型，由应用按本机服务的数据拼好后整份喂进来（NotchController.model）。
// 字段名尽量照 docs/CONTRACT.md 的“新界面要的数据”和“第一版重构补充的接口”：设备 id 就是 lofts.json 里的 id（本机是 local），
// agent 的 id 是 claude、codex、cursor、deepseek，另有 you（你自己）。

// MARK: - 基本单位

/// 哪一家 agent。you 是你自己：指挥可以是你，你在 Pigeon 里派的活发件人也是你。
public enum AgentKind: String, Sendable, Hashable, CaseIterable, Codable {
    case claude, codex, cursor, deepseek, you
}

/// 对话或 agent 此刻的状态。off 是这台上关掉了或还没接上的 agent（光带上那一段压暗）。
public enum RunState: String, Sendable, Hashable, CaseIterable, Codable {
    case run, wait, idle, done, error, off
}

/// 思考强度。每个模型分的档不一样，没有档的模型 `efforts` 是空数组。
public enum Effort: String, Sendable, Hashable, CaseIterable, Codable {
    case low, medium, high, xhigh, max, ultra
}

/// “agent@设备”，比如 `codex@local`。规则、默认模型、派活对象都用这种键。
public struct TargetKey: Sendable, Hashable, Codable, CustomStringConvertible {
    public var agent: AgentKind
    public var device: String

    public init(agent: AgentKind, device: String) {
        self.agent = agent
        self.device = device
    }

    /// 从 `codex@local` 这样的字符串读；读不懂返回 nil。设备 id 里可以带 `@` 以外的任何字符。
    public init?(_ string: String) {
        guard let at = string.firstIndex(of: "@") else { return nil }
        guard let a = AgentKind(rawValue: String(string[..<at])) else { return nil }
        let d = String(string[string.index(after: at)...])
        guard !d.isEmpty else { return nil }
        self.init(agent: a, device: d)
    }

    public var description: String { "\(agent.rawValue)@\(device)" }
}

/// 一端：哪台设备上的哪家 agent 的哪个对话。session 为空表示还没建对话（新开）。
/// 跳回对话（`NotchActions.jump`）也用它，对应 `POST /api/open` 的 `{ loft, agent, session }`。
public struct Endpoint: Sendable, Hashable, Codable {
    public var agent: AgentKind
    public var device: String
    public var deviceName: String
    public var isLocal: Bool
    public var session: String
    public var sessionTitle: String

    public init(agent: AgentKind, device: String = "local", deviceName: String = "本机", isLocal: Bool = true,
                session: String = "", sessionTitle: String = "") {
        self.agent = agent
        self.device = device
        self.deviceName = deviceName
        self.isLocal = isLocal
        self.session = session
        self.sessionTitle = sessionTitle
    }

    public var key: TargetKey { TargetKey(agent: agent, device: device) }
}

// MARK: - 两侧和光带

/// 本机接着的一个 agent：两侧和光带用。光带按数组顺序一段一段排。
public struct LocalAgent: Sendable, Hashable, Codable {
    public var agent: AgentKind
    public var state: RunState

    public init(agent: AgentKind, state: RunState) {
        self.agent = agent
        self.state = state
    }
}

/// 一个对话（悬停总览里“正在进行”的那几行）。
public struct SessionInfo: Sendable, Hashable, Identifiable, Codable {
    public var id: String
    public var agent: AgentKind
    public var device: String
    public var deviceName: String
    public var isLocal: Bool
    public var title: String
    public var state: RunState
    /// 在做什么的一句话（契约里的 detail）；出错时放 error
    public var detail: String
    /// 子对话从哪个对话拆出来的；总览里只列顶层的
    public var parent: String

    public init(id: String, agent: AgentKind, device: String = "local", deviceName: String = "本机", isLocal: Bool = true,
                title: String, state: RunState, detail: String = "", parent: String = "") {
        self.id = id
        self.agent = agent
        self.device = device
        self.deviceName = deviceName
        self.isLocal = isLocal
        self.title = title
        self.state = state
        self.detail = detail
        self.parent = parent
    }

    public var endpoint: Endpoint {
        Endpoint(agent: agent, device: device, deviceName: deviceName, isLocal: isLocal, session: id, sessionTitle: title)
    }
}

// MARK: - 等你处理的一队

/// 三类：跨设备发送（红标）、接活的 agent 往下转派、指挥拆活。
public enum QueueKind: String, Sendable, Hashable, CaseIterable, Codable {
    case cross, relay, split
}

/// 拆活里的一件
public struct QueuePart: Sendable, Hashable, Codable {
    public var to: Endpoint
    public var preview: String

    public init(to: Endpoint, preview: String) {
        self.to = to
        self.preview = preview
    }
}

/// 队列里的一件（契约 `GET /api/queue` 的一条，加上应用知道的名字）。
public struct QueueItem: Sendable, Hashable, Identifiable, Codable {
    public var id: String
    public var kind: QueueKind
    public var band: String
    public var from: Endpoint
    /// 拆活没有单一的收件方，用 parts；这里放第一件的收件方或者和 from 一样
    public var to: Endpoint
    /// 一句话，最多 80 字
    public var preview: String
    /// 要发的原文（最多 4000 字，只在内存里）
    public var text: String
    /// 原文总字数（原文被截断时比 text 长）
    public var chars: Int
    public var files: [String]
    public var project: String
    /// 交出去的上下文估算（token），不知道就是 nil
    public var contextTokens: Int?
    /// 命中的规则，界面上写“命中规则「…」”；没有就是空串
    public var ruleLabel: String
    public var created: Date
    /// 只有 cross 有：到点没人点就不发
    public var deadline: Date?
    /// 发送前查到的疑似密钥类别，比如 ["npm token"]
    public var secrets: [String]
    public var parts: [QueuePart]
    /// 能不能“跳回对话”（发起的那个对话能打开）
    public var canJump: Bool

    public init(id: String, kind: QueueKind, band: String = "", from: Endpoint, to: Endpoint, preview: String,
                text: String = "", chars: Int? = nil, files: [String] = [], project: String = "", contextTokens: Int? = nil,
                ruleLabel: String = "", created: Date, deadline: Date? = nil, secrets: [String] = [],
                parts: [QueuePart] = [], canJump: Bool = true) {
        self.id = id
        self.kind = kind
        self.band = band
        self.from = from
        self.to = to
        self.preview = preview
        self.text = text
        self.chars = chars ?? text.count
        self.files = files
        self.project = project
        self.contextTokens = contextTokens
        self.ruleLabel = ruleLabel
        self.created = created
        self.deadline = deadline
        self.secrets = secrets
        self.parts = parts
        self.canJump = canJump
    }
}

/// 放行还是拦下（对应 `POST /api/queue/<id>` 的 action）
public enum QueueDecision: String, Sendable, Hashable, Codable {
    case release
    /// 打码后放行（契约里的 release_masked）
    case releaseMasked = "release_masked"
    case block
}

/// 在等你回答的 agent，比如 Claude Code 的权限确认。点了跳回那个对话。
public struct WaitingPrompt: Sendable, Hashable, Identifiable, Codable {
    public var id: String
    public var who: Endpoint
    public var title: String
    public var message: String
    public var since: Date
    public var canJump: Bool

    public init(id: String, who: Endpoint, title: String, message: String = "", since: Date, canJump: Bool = true) {
        self.id = id
        self.who = who
        self.title = title
        self.message = message
        self.since = since
        self.canJump = canJump
    }
}

// MARK: - 在路上的任务和回信

/// 任务的状态里刘海关心的几种
public enum NoteState: String, Sendable, Hashable, Codable {
    case asking, queued, flying, delivered, home
}

/// 在路上的一件任务。新出现的、或者变成 home 的，刘海光带上会飞一只鸽子。
public struct NoteInFlight: Sendable, Hashable, Identifiable, Codable {
    public var band: String
    public var from: Endpoint
    public var to: Endpoint
    public var state: NoteState
    public var title: String
    public var since: Date

    public var id: String { band }

    public init(band: String, from: Endpoint, to: Endpoint, state: NoteState, title: String, since: Date) {
        self.band = band
        self.from = from
        self.to = to
        self.state = state
        self.title = title
        self.since = since
    }
}

/// 一封回信。from 是答话的一方，to 是当初派活的一方。
public struct Reply: Sendable, Hashable, Identifiable, Codable {
    public var band: String
    public var from: Endpoint
    public var to: Endpoint
    public var title: String
    public var answer: String
    public var at: Date
    public var unread: Bool
    /// 能不能“转给指挥”（指挥是 agent、回信不是本来就送到指挥那里时才有）
    public var canForward: Bool
    /// 能不能跳回答话的那个对话
    public var canJump: Bool
    /// 用时，比如 "0:52"；没有就空串
    public var duration: String

    public var id: String { band }

    public init(band: String, from: Endpoint, to: Endpoint, title: String, answer: String, at: Date,
                unread: Bool = true, canForward: Bool = false, canJump: Bool = true, duration: String = "") {
        self.band = band
        self.from = from
        self.to = to
        self.title = title
        self.answer = answer
        self.at = at
        self.unread = unread
        self.canForward = canForward
        self.canJump = canJump
        self.duration = duration
    }
}

// MARK: - 快速派活

/// 一个能选的模型。routedByMagpie 是 magpie 的路由组（`group/…`），思考强度由它决定。
public struct ModelOption: Sendable, Hashable, Identifiable, Codable {
    public var id: String
    public var efforts: [Effort]
    public var routedByMagpie: Bool
    /// 悬停说明
    public var note: String

    public init(id: String, efforts: [Effort] = [], routedByMagpie: Bool = false, note: String = "") {
        self.id = id
        self.efforts = efforts
        self.routedByMagpie = routedByMagpie
        self.note = note
    }
}

/// 一个能发消息进去的已有对话
public struct SessionRef: Sendable, Hashable, Identifiable, Codable {
    public var id: String
    public var title: String

    public init(id: String, title: String) {
        self.id = id
        self.title = title
    }
}

/// 派活对象里的一家 agent
public struct ComposeAgent: Sendable, Hashable, Codable {
    public var agent: AgentKind
    public var enabled: Bool
    /// 不能选时的原因，悬停看（比如“还没接上”）
    public var disabledReason: String
    public var models: [ModelOption]
    /// 它在接入里配的默认模型和思考强度
    public var defaultModel: String
    public var defaultEffort: Effort?
    public var sessions: [SessionRef]

    public init(agent: AgentKind, enabled: Bool = true, disabledReason: String = "", models: [ModelOption] = [],
                defaultModel: String = "", defaultEffort: Effort? = nil, sessions: [SessionRef] = []) {
        self.agent = agent
        self.enabled = enabled
        self.disabledReason = disabledReason
        self.models = models
        self.defaultModel = defaultModel
        self.defaultEffort = defaultEffort
        self.sessions = sessions
    }
}

/// 派活对象按设备分行
public struct ComposeDevice: Sendable, Hashable, Identifiable, Codable {
    public var id: String
    public var name: String
    public var isLocal: Bool
    public var online: Bool
    public var agents: [ComposeAgent]

    public init(id: String, name: String, isLocal: Bool, online: Bool = true, agents: [ComposeAgent]) {
        self.id = id
        self.name = name
        self.isLocal = isLocal
        self.online = online
        self.agents = agents
    }
}

public struct ComposeData: Sendable, Hashable, Codable {
    public var devices: [ComposeDevice]
    /// 没指定对象时先选它；为 nil 时选第一个能选的
    public var defaultTarget: TargetKey?
    /// 跨设备发送要不要再确认一次（契约 post.confirmRemote），只影响底下那句说明
    public var crossNeedsConfirm: Bool

    public init(devices: [ComposeDevice] = [], defaultTarget: TargetKey? = nil, crossNeedsConfirm: Bool = true) {
        self.devices = devices
        self.defaultTarget = defaultTarget
        self.crossNeedsConfirm = crossNeedsConfirm
    }
}

/// 快速派活发出去的那一件（对应 `POST /api/send`）
public struct SendRequest: Sendable, Hashable, Codable {
    public var to: TargetKey
    /// 为空是新开对话
    public var session: String
    public var text: String
    /// 空串表示用它自己的默认
    public var model: String
    public var effort: Effort?

    public init(to: TargetKey, session: String, text: String, model: String, effort: Effort?) {
        self.to = to
        self.session = session
        self.text = text
        self.model = model
        self.effort = effort
    }
}

/// 发出的结果：成功给脚环，失败给一句能直接显示的话
public enum SendOutcome: Sendable, Hashable {
    case sent(band: String)
    case failed(String)
}

// MARK: - 指挥和设置

public enum Lead: Sendable, Hashable, Codable {
    case agent(AgentKind, device: String)
    case you
}

public enum SecretsMode: String, Sendable, Hashable, CaseIterable, Codable {
    /// 标红，放行时可以选原样或打码
    case warn
    /// 自动打码
    case mask
    case off
}

public struct NotchSettings: Sendable, Hashable, Codable {
    public var secrets: SecretsMode
    public var crossTimeoutSec: Int

    public init(secrets: SecretsMode = .warn, crossTimeoutSec: Int = 90) {
        self.secrets = secrets
        self.crossTimeoutSec = crossTimeoutSec
    }
}

/// 主窗口的哪一页（openMainWindow 用）
public enum MainPage: String, Sendable, Hashable, CaseIterable, Codable {
    case stage, tasks, rules, devices, settings
}

// MARK: - 整份

public struct NotchModel: Sendable, Hashable, Codable {
    /// 全部暂停
    public var paused: Bool
    public var lead: Lead
    /// 本机的 agent，两侧和光带用
    public var agents: [LocalAgent]
    /// 对话，总览里列不是空闲的顶层对话
    public var sessions: [SessionInfo]
    public var queue: [QueueItem]
    public var prompts: [WaitingPrompt]
    public var notes: [NoteInFlight]
    /// 从新到旧
    public var replies: [Reply]
    public var compose: ComposeData
    public var settings: NotchSettings

    public init(paused: Bool = false, lead: Lead = .agent(.claude, device: "local"), agents: [LocalAgent] = [],
                sessions: [SessionInfo] = [], queue: [QueueItem] = [], prompts: [WaitingPrompt] = [],
                notes: [NoteInFlight] = [], replies: [Reply] = [], compose: ComposeData = ComposeData(),
                settings: NotchSettings = NotchSettings()) {
        self.paused = paused
        self.lead = lead
        self.agents = agents
        self.sessions = sessions
        self.queue = queue
        self.prompts = prompts
        self.notes = notes
        self.replies = replies
        self.compose = compose
        self.settings = settings
    }

    public static let empty = NotchModel()

    /// 等你的件数：队列加上在等你回答的 agent。菜单栏图标的红色数字就是它。
    public var waitingCount: Int { queue.count + prompts.count }
    public var unreadReplies: Int { replies.filter(\.unread).count }
    /// 在干活的本机 agent（去重，按光带顺序）
    public var runningAgents: [AgentKind] { agents.filter { $0.state == .run }.map(\.agent) }
    /// 总览里列的：不是空闲、不是子对话
    public var liveSessions: [SessionInfo] { sessions.filter { $0.parent.isEmpty && $0.state != .idle && $0.state != .off } }
}
