import AppKit
import PigeonNotch
import SwiftUI

// 刘海面板的演示：用内置的示例数据把面板跑起来，再开一个小控制窗切状态、放在哪、暂停、来一件，
// 每个操作都打到标准输出。这里的“应用”是假的：放行、拦下只是把那件从示例里拿掉。
//
//   swift run PigeonNotchDemo                       平常用
//   swift run PigeonNotchDemo --state queue         一打开就展开某个样子
//   swift run PigeonNotchDemo --placement menuBar   放在菜单栏
//   swift run PigeonNotchDemo --tour <目录>         挨个展开五种样子并截图到目录里，然后退出
//   swift run PigeonNotchDemo --keytest             按键盘规矩自测一遍，然后退出

func log(_ s: String) {
    print("[操作] " + s)
    fflush(stdout)
}

@MainActor
final class DemoHost: NSObject {
    let notch: NotchController
    var data = NotchModel.sample()
    let status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    var control: NSWindow?

    override init() {
        notch = NotchController()
        super.init()
        notch.actions = NotchActions(
            resolve: { [weak self] id, d in log("resolve \(id) \(d.rawValue)"); self?.data.queue.removeAll { $0.id == id }; self?.push() },
            jump: { e in log("jump \(e.key) 对话=\(e.session)") },
            setPaused: { [weak self] on in log("setPaused \(on)"); self?.data.paused = on; self?.push() },
            send: { [weak self] req in
                log("send \(req.to) 对话=\(req.session.isEmpty ? "新开" : req.session) 模型=\(req.model) 思考=\(req.effort?.rawValue ?? "-") 正文=\(req.text)")
                try? await Task.sleep(for: .milliseconds(700))
                if req.text.contains("失败") { return .failed("那台没回应，没发出") }
                if req.to.device != "local", let self {
                    var q = NotchModel.sampleItem(.cross)
                    q.from = Endpoint(agent: .you); q.preview = req.text; q.text = req.text; q.chars = req.text.count
                    self.data.queue.append(q); self.push()
                }
                return .sent(band: "t-\(Int.random(in: 1000...9999))")
            },
            suggest: { text in
                log("suggest \(text)")
                return text.localizedCaseInsensitiveContains("windows") ? TargetKey("codex@remote-control:env_chen") : nil
            },
            autoRelay: { [weak self] id in log("autoRelay \(id)"); self?.data.queue.removeAll { $0.id == id }; self?.push() },
            markReplyRead: { [weak self] band in
                log("markReplyRead \(band)")
                if let i = self?.data.replies.firstIndex(where: { $0.band == band }) { self?.data.replies[i].unread = false; self?.push() }
            },
            forward: { band in log("forward \(band)") },
            openMainWindow: { page in log("openMainWindow \(page.rawValue)") }
        )
        notch.onDemoAction = { log("（演示）" + $0) }
        notch.onStateChange = { log("面板：\($0.rawValue)") }
        notch.onBadgeChange = { [weak self] n in self?.drawStatus(n) }
        notch.update(data)
        status.button?.title = "鸽"
        status.button?.target = self
        status.button?.action = #selector(statusClicked)
        status.isVisible = false
    }

    func push() { notch.update(data) }

    func drawStatus(_ n: Int) {
        status.button?.title = n > 0 ? "鸽 \(n)" : "鸽"
    }

    func anchor() -> NSRect? {
        guard let b = status.button, let w = b.window else { return nil }
        return w.convertToScreen(b.convert(b.bounds, to: nil))
    }

    @objc func statusClicked() { notch.toggleFromMenuBar(anchor: anchor()) }

    func setPlacement(_ p: NotchPlacement) {
        status.isVisible = p == .menuBar
        notch.placement = p
        DispatchQueue.main.async { self.notch.setMenuBarAnchor(self.anchor()) }
        log("放在：\(p.rawValue)")
    }

    func add(_ k: QueueKind) {
        data.queue.append(NotchModel.sampleItem(k))
        push()
    }

    func flyNote() {
        let band = "t-\(Int.random(in: 1000...9999))"
        data.notes.append(NoteInFlight(band: band, from: Endpoint(agent: .claude), to: Endpoint(agent: .deepseek),
                                       state: .flying, title: "演示：一件新任务", since: Date()))
        push()
    }

    func showControl() {
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 260), styleMask: [.titled, .closable],
                         backing: .buffered, defer: false)
        w.title = "Pigeon 刘海演示"
        w.contentView = NSHostingView(rootView: ControlView(host: self))
        w.center()
        w.isReleasedWhenClosed = false
        w.makeKeyAndOrderFront(nil)
        control = w
    }
}

struct ControlView: View {
    let host: DemoHost
    @State private var placement: NotchPlacement = .notch
    @State private var demo = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("展开").frame(width: 56, alignment: .leading)
                ForEach(NotchState.allCases, id: \.self) { s in
                    Button(name(s)) { host.notch.show(s, demo: demo) }
                }
            }
            Toggle("演示模式（用内置示例，不调操作）", isOn: $demo)
            HStack {
                Text("放在").frame(width: 56, alignment: .leading)
                Picker("", selection: $placement) {
                    Text("刘海").tag(NotchPlacement.notch)
                    Text("菜单栏").tag(NotchPlacement.menuBar)
                    Text("不显示").tag(NotchPlacement.hidden)
                }
                .pickerStyle(.segmented).labelsHidden()
                .onChange(of: placement) { _, p in host.setPlacement(p) }
            }
            HStack {
                Text("来一件").frame(width: 56, alignment: .leading)
                Button("跨设备") { host.add(.cross) }
                Button("转派") { host.add(.relay) }
                Button("拆活") { host.add(.split) }
            }
            HStack {
                Text("其他").frame(width: 56, alignment: .leading)
                Button(host.data.paused ? "继续" : "全部暂停") { host.data.paused.toggle(); host.push() }
                Button("派一件（飞鸽子）") { host.flyNote() }
                Button("清空队列") { host.data.queue = []; host.push() }
                Button("恢复示例") { host.data = NotchModel.sample(); host.push() }
            }
            Text("操作都打在终端里。").font(.caption).foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(width: 460)
    }

    func name(_ s: NotchState) -> String {
        switch s {
        case .idle: "收起"
        case .overview: "总览"
        case .queue: "等你"
        case .reply: "回信"
        case .compose: "派活"
        }
    }
}

// MARK: - 自动截图和键盘自测

@MainActor
func capture(_ host: DemoHost, to dir: String, name: String) {
    // 先试整块屏幕上那一片（看得到刘海和菜单栏），没有屏幕录制权限时退回只画面板自己
    if let f = host.notch.panelFrame, let screen = NSScreen.screens.first {
        let pad: CGFloat = 40
        let r = "\(Int(f.minX - pad)),\(Int(max(0, screen.frame.maxY - f.maxY))),\(Int(f.width + pad * 2)),\(Int(f.height + pad))"
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        p.arguments = ["-x", "-R", r, "\(dir)/\(name)-screen.png"]
        p.standardError = FileHandle.nullDevice
        try? p.run()
        p.waitUntilExit()
        if p.terminationStatus == 0 { log("截图 \(name)（屏幕）"); return }
    }
    guard let png = host.notch.snapshotPNG() else { log("截图 \(name)：面板没显示"); return }
    try? png.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
    log("截图 \(name)（只画面板） \(host.notch.panelFrame.map { "\(Int($0.width))×\(Int($0.height))" } ?? "")")
}

@MainActor
func tour(_ host: DemoHost, dir: String) async {
    func wait(_ s: Double) async { try? await Task.sleep(for: .milliseconds(Int(s * 1000))) }
    await wait(1.0)
    capture(host, to: dir, name: "1-idle")
    host.flyNote()
    await wait(0.6)
    capture(host, to: dir, name: "1b-flight")
    await wait(1.5)
    for s in [NotchState.overview, .queue, .reply, .compose] {
        host.notch.show(s, takeFocus: false)
        await wait(0.8)
        capture(host, to: dir, name: "2-\(s.rawValue)")
    }
    host.notch.show(.queue, band: "q2", takeFocus: false)
    await wait(0.6)
    capture(host, to: dir, name: "3-queue-relay")
    host.notch.show(.queue, band: "q3", takeFocus: false)
    await wait(0.6)
    capture(host, to: dir, name: "3-queue-split")
    host.data.paused = true; host.push()
    host.notch.collapse()
    await wait(0.6)
    capture(host, to: dir, name: "4-idle-paused")
    host.data.paused = false
    host.data.queue = []; host.push()
    host.notch.show(.queue, takeFocus: false)
    await wait(0.6)
    capture(host, to: dir, name: "4-queue-empty")
    host.data = NotchModel.sample(); host.push()
    host.notch.show(.compose, target: TargetKey("claude@remote-control:env_chen"), takeFocus: false)
    await wait(0.6)
    capture(host, to: dir, name: "5-compose-cross")
    host.notch.collapse()
    host.setPlacement(.menuBar)
    await wait(0.6)
    host.notch.toggleFromMenuBar(anchor: host.anchor())
    await wait(0.8)
    capture(host, to: dir, name: "6-menubar-queue")
    host.notch.collapse()
    host.setPlacement(.notch)
    host.data = NotchModel(agents: [], compose: NotchModel.sample().compose)
    host.push()
    await wait(0.6)
    capture(host, to: dir, name: "7-idle-quiet")
    // 什么事都没有时展开：只有底下一行按钮
    host.notch.show(.overview, takeFocus: false)
    await wait(0.6)
    capture(host, to: dir, name: "8-overview-empty")
    host.notch.collapse()
}

@MainActor
func keytest(_ host: DemoHost) async {
    func wait(_ s: Double) async { try? await Task.sleep(for: .milliseconds(Int(s * 1000))) }
    var fails = 0
    func check(_ ok: Bool, _ what: String) { log((ok ? "通过 " : "不通过 ") + what); if !ok { fails += 1 } }
    await wait(0.8)
    // 收起时按键不归面板
    check(!host.notch.simulateKey(keyCode: 125, pointerInside: true), "收起时方向键不接")
    // 悬停打开（应用没要焦点）：不是焦点窗口，鼠标也不在面板上 → 不接
    host.notch.show(.queue, takeFocus: false)
    await wait(0.4)
    check(!host.notch.isKey, "不拿焦点打开时面板不是焦点窗口")
    check(!host.notch.simulateKey(keyCode: 125, pointerInside: false), "鼠标和焦点都不在面板里时方向键不接")
    // 鼠标在面板上：方向键选
    let first = host.notch.selectedQueueID
    check(host.notch.simulateKey(keyCode: 125, pointerInside: true), "鼠标在面板上时方向键接")
    check(host.notch.selectedQueueID != first, "下移后选中换了一件（\(first ?? "-") → \(host.notch.selectedQueueID ?? "-")）")
    // ⌫ 拦下选中的那件
    let before = host.data.queue.count, sel = host.notch.selectedQueueID
    host.notch.simulateKey(keyCode: 51)
    await wait(0.2)
    check(host.data.queue.count == before - 1 && !host.data.queue.contains { $0.id == sel }, "⌫ 拦下了选中的 \(sel ?? "-")")
    // 回车放行
    let sel2 = host.notch.selectedQueueID
    host.notch.simulateKey(keyCode: 36)
    await wait(0.2)
    check(!host.data.queue.contains { $0.id == sel2 }, "回车放行了 \(sel2 ?? "-")")
    // 应用主动打开并要焦点：面板变成焦点窗口，但应用没被切到前台
    host.data = NotchModel.sample(); host.push()
    // 从终端启动时应用可能本来就在前台：先让出去，再看拿焦点会不会把它切回来
    NSApp.deactivate()
    await wait(0.4)
    let front = NSWorkspace.shared.frontmostApplication
    log("拿焦点之前：前台应用是 \(front?.localizedName ?? "-")，本程序 isActive=\(NSApp.isActive)")
    host.notch.show(.queue, takeFocus: true)
    await wait(0.4)
    check(host.notch.isKey, "要焦点打开时面板是焦点窗口")
    let after = NSWorkspace.shared.frontmostApplication
    check(after?.processIdentifier == front?.processIdentifier, "前台应用没变（\(after?.localizedName ?? "-")）")
    check(host.notch.simulateKey(keyCode: 126, pointerInside: false), "焦点在面板里、鼠标不在时方向键也接")
    // Esc 收起
    host.notch.simulateKey(keyCode: 53)
    await wait(0.3)
    check(host.notch.state == .idle, "Esc 收起")
    check(!host.notch.isKey, "收起后不再是焦点窗口")
    log(fails == 0 ? "键盘自测全部通过" : "键盘自测有 \(fails) 项不通过")
}

// MARK: - 启动

let args = CommandLine.arguments
func arg(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
MainActor.assumeIsolated {
    let host = DemoHost()
    if let p = arg("--placement").flatMap(NotchPlacement.init(rawValue:)) { host.setPlacement(p) }
    if let dir = arg("--tour") {
        Task { await tour(host, dir: dir); exit(0) }
    } else if args.contains("--keytest") {
        Task { await keytest(host); exit(0) }
    } else {
        host.showControl()
        if let s = arg("--state").flatMap(NotchState.init(rawValue:)) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { host.notch.show(s, takeFocus: false) }
        }
    }
    objc_setAssociatedObject(app, "host", host, .OBJC_ASSOCIATION_RETAIN)
}
app.run()
