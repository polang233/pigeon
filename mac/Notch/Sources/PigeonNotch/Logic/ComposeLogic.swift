import Foundation

/// 一个对象选过的模型和思考强度
struct ComposePick: Equatable {
    var model: String
    /// nil：这个模型不分思考强度，或由 magpie 的路由组决定
    var effort: Effort?
}

/// 快速派活的草稿。对象、发给哪个对话、写了一半的话、每个对象各记一份的模型和思考强度。
struct ComposeState: Equatable {
    var target: TargetKey?
    /// 手动点过对象：之后不再按建议自动换
    var manualTarget = false
    /// 空串是新开对话；否则发到这个已有对话
    var session = ""
    /// 本机新开对话时选的工作目录；空串用默认
    var cwd = ""
    var draft = ""
    var picks: [TargetKey: ComposePick] = [:]
    /// 应用按分派规则建议的对象
    var suggestion: TargetKey?
    var sending = false
    var error: String?
    /// 刚发出的那件的脚环
    var sentBand: String?
}

/// 派活的规矩，照原型 store.js 的 hud 一节：换模型时原来那档没有就落到中间那档；没选过就用它在接入里配的。纯逻辑。
enum ComposeLogic {
    static func lookup(_ key: TargetKey, in data: ComposeData) -> (device: ComposeDevice, agent: ComposeAgent)? {
        guard let d = data.devices.first(where: { $0.id == key.device }),
              let a = d.agents.first(where: { $0.agent == key.agent }) else { return nil }
        return (d, a)
    }

    static func isSelectable(_ key: TargetKey, in data: ComposeData) -> Bool {
        lookup(key, in: data)?.agent.enabled ?? false
    }

    /// 中间那档：四档落到“中”，两档落到第一档，没有档为 nil
    static func midLevel(_ levels: [Effort]) -> Effort? {
        guard !levels.isEmpty else { return nil }
        return levels[(levels.count - 1) / 2]
    }

    static func levels(_ agent: ComposeAgent, model: String) -> [Effort] {
        guard let m = agent.models.first(where: { $0.id == model }), !m.routedByMagpie else { return [] }
        return m.efforts
    }

    static func isRouted(_ agent: ComposeAgent, model: String) -> Bool {
        agent.models.first(where: { $0.id == model })?.routedByMagpie ?? false
    }

    /// 没选过时：它在接入里配的模型（不在列表里就用第一个），思考强度不合这个模型就落到中间
    static func defaultPick(_ agent: ComposeAgent) -> ComposePick {
        let model = agent.models.contains(where: { $0.id == agent.defaultModel }) ? agent.defaultModel : (agent.models.first?.id ?? agent.defaultModel)
        let lv = levels(agent, model: model)
        let effort = agent.defaultEffort.flatMap { lv.contains($0) ? $0 : nil } ?? midLevel(lv)
        return ComposePick(model: model, effort: effort)
    }

    static func pick(_ s: ComposeState, for key: TargetKey, in data: ComposeData) -> ComposePick? {
        if let p = s.picks[key] { return p }
        return lookup(key, in: data).map { defaultPick($0.agent) }
    }

    /// 第一次打开时选谁：指定的、数据里的默认、第一个能选的
    static func initialTarget(preferred: TargetKey?, in data: ComposeData) -> TargetKey? {
        if let p = preferred, isSelectable(p, in: data) { return p }
        if let d = data.defaultTarget, isSelectable(d, in: data) { return d }
        for d in data.devices { for a in d.agents where a.enabled { return TargetKey(agent: a.agent, device: d.id) } }
        return nil
    }

    /// 打开派活：target、session 是应用指定的（比如“给它发消息”）。草稿和各对象选过的模型留着
    static func open(_ s: inout ComposeState, target: TargetKey?, session: String?, in data: ComposeData) {
        s.error = nil
        s.sentBand = nil
        s.sending = false
        if let t = target, isSelectable(t, in: data) {
            s.target = t
            s.manualTarget = true
        } else if s.target == nil || !isSelectable(s.target!, in: data) {
            s.target = initialTarget(preferred: nil, in: data)
            s.manualTarget = false
        }
        if let id = session, let t = s.target, let a = lookup(t, in: data)?.agent, a.sessions.contains(where: { $0.id == id }) {
            s.session = id
        } else if session != nil || !sessionValid(s, in: data) {
            s.session = ""
        }
    }

    static func sessionValid(_ s: ComposeState, in data: ComposeData) -> Bool {
        guard !s.session.isEmpty else { return true }
        guard let t = s.target, let a = lookup(t, in: data)?.agent else { return false }
        return a.sessions.contains { $0.id == s.session }
    }

    /// 手动选了对象：不再按建议自动换；换了对象就不是发给原来那个对话了
    static func selectTarget(_ s: inout ComposeState, _ key: TargetKey, in data: ComposeData) {
        guard isSelectable(key, in: data) else { return }
        if s.target != key { s.session = "" }
        s.target = key
        s.manualTarget = true
        s.error = nil
    }

    static func selectModel(_ s: inout ComposeState, _ model: String, in data: ComposeData) {
        guard let t = s.target, let a = lookup(t, in: data)?.agent, a.models.contains(where: { $0.id == model }) else { return }
        var p = pick(s, for: t, in: data) ?? defaultPick(a)
        p.model = model
        let lv = levels(a, model: model)
        if let e = p.effort, lv.contains(e) {} else { p.effort = midLevel(lv) }
        s.picks[t] = p
    }

    static func selectEffort(_ s: inout ComposeState, _ effort: Effort, in data: ComposeData) {
        guard let t = s.target, let a = lookup(t, in: data)?.agent, var p = pick(s, for: t, in: data) else { return }
        guard levels(a, model: p.model).contains(effort) else { return }
        p.effort = effort
        s.picks[t] = p
    }

    static func selectSession(_ s: inout ComposeState, _ id: String, in data: ComposeData) {
        guard id.isEmpty || (s.target.flatMap { lookup($0, in: data) }?.agent.sessions.contains { $0.id == id } ?? false) else { return }
        s.session = id
    }

    static func selectCwd(_ s: inout ComposeState, _ path: String, in data: ComposeData) {
        guard path.isEmpty || data.projects.contains(where: { $0.path == path }) else { return }
        s.cwd = path
    }

    /// 应用给了建议：记下来；没手动选过对象、也不是发给某个对话时，直接换过去
    static func applySuggestion(_ s: inout ComposeState, _ key: TargetKey?, in data: ComposeData) {
        let k = key.flatMap { isSelectable($0, in: data) ? $0 : nil }
        s.suggestion = k
        if let k, !s.manualTarget, s.session.isEmpty, s.target != k { s.target = k }
    }

    /// 发不出去的原因；能发返回 nil
    static func blockReason(_ s: ComposeState, in data: ComposeData) -> String? {
        guard let t = s.target, let (d, a) = lookup(t, in: data) else { return "先选一个对象" }
        if !a.enabled { return a.disabledReason.isEmpty ? "\(a.agent.displayName) 现在不能选" : a.disabledReason }
        if !d.online { return "\(d.name) 现在连不上，发不出去" }
        if s.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "先写一句要它做什么" }
        return nil
    }

    /// 底下那一句：发到哪、跨设备还要不要确认
    static func footer(_ s: ComposeState, in data: ComposeData) -> String {
        guard let t = s.target, let (d, _) = lookup(t, in: data) else { return "先选一个对象" }
        if !d.online { return "\(d.name) 现在连不上，发不出去" }
        let base = s.session.isEmpty ? (d.isLocal ? "本机，新开一个对话" : "跨设备，新开一个对话") : "发到这个对话里"
        return (!d.isLocal && data.crossNeedsConfirm) ? base + "，发之前还会让你确认一次" : base
    }

    /// 标题：快速派活、发给「某个对话」
    static func title(_ s: ComposeState, in data: ComposeData) -> String {
        if !s.session.isEmpty, let t = s.target, let a = lookup(t, in: data)?.agent,
           let ref = a.sessions.first(where: { $0.id == s.session }) {
            return "发给「\(ref.title)」"
        }
        return "快速派活"
    }

    static func request(_ s: ComposeState, in data: ComposeData) -> SendRequest? {
        guard blockReason(s, in: data) == nil, let t = s.target, let found = lookup(t, in: data), let p = pick(s, for: t, in: data) else { return nil }
        let cwd = (s.session.isEmpty && found.device.isLocal) ? s.cwd : ""
        return SendRequest(to: t, session: s.session, text: s.draft.trimmingCharacters(in: .whitespacesAndNewlines),
                           model: p.model, effort: p.effort, cwd: cwd)
    }

    /// 发出的对象在别的电脑上
    static func isCross(_ s: ComposeState, in data: ComposeData) -> Bool {
        guard let t = s.target, let d = lookup(t, in: data)?.device else { return false }
        return !d.isLocal
    }
}
