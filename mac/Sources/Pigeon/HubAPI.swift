import Foundation

/// 新界面要的接口：对话状态、等你处理的一队、暂停、分派建议、magpie、刘海。
extension Hub {
    // MARK: 对话

    func composeLofts(now: Date = Date()) -> Data {
        let file = try? Data(contentsOf: Paths.loftsFile)
        return Self.singleLine(LoftsComposer.compose(file: file, tracker: sessions, now: now))
    }

    private func loftsFileMTime() -> Date? {
        (try? FileManager.default.attributesOfItem(atPath: Paths.loftsFile.path))?[.modificationDate] as? Date
    }

    /// 每 2 秒一次
    func loftsTickFired() {
        let now = Date()
        var changed = false
        let m = loftsFileMTime()
        if m != loftsMTime { loftsMTime = m; changed = true }
        if sessions.hasTransition(from: lastLoftsTick, to: now) { changed = true }
        lastLoftsTick = now
        if sessions.prune(now: now) { changed = true }
        if changed { scheduleLoftsPush() }
    }

    /// 变了就推，合并成最多每 500 毫秒一次；内容没变不推。
    func scheduleLoftsPush() {
        guard !loftsPending else { return }
        loftsPending = true
        let wait = max(0, 0.5 - Date().timeIntervalSince(lastLoftsPush))
        queue.asyncAfter(deadline: .now() + wait) { [weak self] in
            guard let self else { return }
            self.loftsPending = false
            let body = self.composeLofts()
            guard body != self.lastLoftsJSON else { return }
            self.lastLoftsJSON = body
            self.lastLoftsPush = Date()
            self.broadcast(Self.envelope(type: "lofts", key: "lofts", json: body))
            self.onLofts?(body)
        }
    }

    // MARK: 等你处理的一队

    func queueChanged() {
        broadcast(Self.envelope(type: "queue", key: "items", json: asks.itemsArray()))
        onQueue?(asks.snapshot())
    }

    func handleAsk(_ req: HTTPRequest, conn: HTTPConnection, keepAlive: Bool) {
        guard let body = (try? JSONSerialization.jsonObject(with: req.body)) as? [String: Any] else {
            return respondStatus(conn, 400, Self.jsonData(["error": "请求体必须是 JSON 对象"]), keepAlive: keepAlive)
        }
        let post = Settings.object()["post"] as? [String: Any]
        let def = (post?["crossTimeoutSec"] as? NSNumber)?.intValue ?? 90
        if let err = asks.ask(body, conn: conn, keepAlive: keepAlive, defaultTimeoutSec: def > 0 ? def : 90) {
            respondStatus(conn, 400, Self.jsonData(["error": err]), keepAlive: keepAlive)
            return
        }
        // 成功时连接一直挂着，等 resolve 回话
        if let sendID = body["send_id"] as? String, !sendID.isEmpty {
            sendAsked(sendID: sendID, band: body["band"] as? String ?? "")
        }
    }

    func handleResolve(id: String, _ req: HTTPRequest, conn: HTTPConnection, keepAlive: Bool) {
        let action = ((try? JSONSerialization.jsonObject(with: req.body)) as? [String: Any])?["action"] as? String ?? ""
        guard AskQueue.actions.contains(action) else {
            return respondStatus(conn, 400, Self.jsonData(["error": "action 只能是 release、release_masked、block"]), keepAlive: keepAlive)
        }
        if asks.resolve(id: id, action: action) {
            respondStatus(conn, 200, Self.jsonData(["ok": true, "action": action]), keepAlive: keepAlive)
        } else {
            respondStatus(conn, 404, Self.jsonData(["error": "没有这一条，可能已经处理过了"]), keepAlive: keepAlive)
        }
    }

    func currentQueue(_ completion: @escaping @Sendable (Data) -> Void) {
        queue.async { [weak self] in
            guard let self else { return }
            completion(self.asks.snapshot())
        }
    }

    func currentLofts(_ completion: @escaping @Sendable (Data) -> Void) {
        queue.async { [weak self] in
            guard let self else { return }
            completion(self.composeLofts())
        }
    }

    /// action：`release`、`release_masked`、`block`
    func resolveQueue(id: String, action: String) {
        guard AskQueue.actions.contains(action) else { return }
        queue.async { [weak self] in _ = self?.asks.resolve(id: id, action: action) }
    }

    // MARK: 暂停

    /// 改 `paused`，保留其余设置，返回存下的设置原文；失败返回 nil。在 queue 上调用。
    @discardableResult
    func applyPause(loft: String?, on: Bool) -> Data? {
        do {
            let body = try Settings.update { root in
                var paused = root["paused"] as? [String: Any] ?? [:]
                var lofts = paused["lofts"] as? [String: Any] ?? [:]
                if let loft, !loft.isEmpty {
                    lofts[loft] = on ? true : nil
                } else {
                    paused["all"] = on
                }
                paused["lofts"] = lofts
                if paused["all"] == nil { paused["all"] = false }
                root["paused"] = paused
            }
            settingsChanged(body)
            return body
        } catch {
            FileHandle.standardError.write(Data("保存暂停状态失败：\(error)\n".utf8))
            return nil
        }
    }

    /// 从应用里（菜单、刘海）改一处设置：其余字段原样保留，存好后广播给页面。
    func updateSettings(_ change: @escaping @Sendable (inout [String: Any]) -> Void) {
        queue.async { [weak self] in
            guard let self else { return }
            do {
                self.settingsChanged(try Settings.update(change))
            } catch {
                FileHandle.standardError.write(Data("保存设置失败：\(error)\n".utf8))
            }
        }
    }

    /// `loft` 为 nil 表示全部
    func setPaused(loft: String?, on: Bool) {
        queue.async { [weak self] in self?.applyPause(loft: loft, on: on) }
    }

    func handlePause(_ req: HTTPRequest, conn: HTTPConnection, keepAlive: Bool) {
        guard let obj = (try? JSONSerialization.jsonObject(with: req.body)) as? [String: Any], let on = obj["on"] as? Bool else {
            return respondStatus(conn, 400, Self.jsonData(["error": "需要 {\"on\": true 或 false}"]), keepAlive: keepAlive)
        }
        guard let saved = applyPause(loft: obj["loft"] as? String, on: on) else {
            return respondStatus(conn, 500, Self.jsonData(["error": "保存设置失败"]), keepAlive: keepAlive)
        }
        let paused = ((try? JSONSerialization.jsonObject(with: saved)) as? [String: Any])?["paused"] ?? [String: Any]()
        respondStatus(conn, 200, Self.jsonData(["ok": true, "paused": paused]), keepAlive: keepAlive)
    }

    // MARK: 对外的发送、打开、建议

    func send(_ body: Data, completion: @escaping @Sendable (Data) -> Void) {
        queue.async { [weak self] in self?.performSend(body) { _, data in completion(data) } }
    }

    func open(_ body: Data, completion: @escaping @Sendable (Data) -> Void) {
        queue.async { [weak self] in self?.performOpen(body) { _, data in completion(data) } }
    }

    func suggest(_ body: Data, completion: @escaping @Sendable (Data) -> Void) {
        queue.async { [weak self] in
            guard let self else { return }
            completion(self.suggestNow(body).1)
        }
    }

    // MARK: 分派建议

    func suggestNow(_ body: Data) -> (Int, Data) {
        guard let obj = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else {
            return (400, Self.jsonData(["error": "请求体必须是 JSON 对象"]))
        }
        let ctx = Dispatch.context(settings: Settings.object(), input: dispatchInput)
        let s = Dispatch.suggest(text: obj["text"] as? String ?? "", to: obj["to"] as? String, ctx)
        return (200, Self.jsonData(s.json))
    }

    func handleDispatchPut(_ req: HTTPRequest, conn: HTTPConnection, keepAlive: Bool) {
        guard let obj = (try? JSONSerialization.jsonObject(with: req.body)) as? [String: Any], let input = Dispatch.Input(obj) else {
            return respondStatus(conn, 400, Self.jsonData(["error": "请求体必须是 JSON 对象"]), keepAlive: keepAlive)
        }
        dispatchInput = input
        var out: [String: Any] = ["text": input.text, "quota": input.quota,
                                  "updated": Int64(Date().timeIntervalSince1970 * 1000),
                                  "lead": Settings.object()["lead"] ?? ["kind": "agent", "agent": "claude", "loft": "local"]]
        if let low = input.low { out["low"] = low }
        if let alive = input.alive { out["alive"] = alive.sorted() }
        let data = Self.jsonData(out)
        do {
            try FileManager.default.createDirectory(at: Paths.dataDir, withIntermediateDirectories: true)
            try data.write(to: Paths.dispatchFile, options: .atomic)
        } catch {
            return respondStatus(conn, 500, Self.jsonData(["error": "写 dispatch.json 失败：\(error.localizedDescription)"]), keepAlive: keepAlive)
        }
        respondStatus(conn, 200, data, keepAlive: keepAlive)
    }

    // MARK: magpie

    func handleMagpie(_ route: Magpie.Route, conn: HTTPConnection, keepAlive: Bool) {
        let fetch = magpieFetch
        let queue = self.queue
        Task { [weak self] in
            let status: Int
            let body: Data
            do {
                let raw = try await fetch(route.upstream)
                let json = try JSONSerialization.jsonObject(with: raw)
                body = Self.jsonData(Magpie.slim(route, json))
                status = 200
            } catch {
                body = Self.jsonData(["error": "连不上本机 magpie"])
                status = 502
            }
            queue.async { [weak self] in self?.respondStatus(conn, status, body, keepAlive: keepAlive) }
        }
    }

    // MARK: 刘海

    static let notchStates: Set<String> = ["idle", "overview", "queue", "reply", "compose"]

    func handleNotch(_ req: HTTPRequest, conn: HTTPConnection, keepAlive: Bool) {
        guard let obj = (try? JSONSerialization.jsonObject(with: req.body)) as? [String: Any],
              let state = obj["state"] as? String, Self.notchStates.contains(state) else {
            return respondStatus(conn, 400, Self.jsonData(["error": "state 只能是 idle、overview、queue、reply、compose"]), keepAlive: keepAlive)
        }
        let clean: [String: Any] = ["state": state, "target": obj["target"] as? String ?? "", "session": obj["session"] as? String ?? "",
                                    "band": obj["band"] as? String ?? "", "demo": obj["demo"] as? Bool ?? false]
        respondStatus(conn, 200, Self.jsonData(["ok": true]), keepAlive: keepAlive)
        onNotch?(Self.jsonData(clean))
    }
}
