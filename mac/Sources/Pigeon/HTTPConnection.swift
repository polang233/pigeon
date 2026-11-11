import Foundation
import Network

struct HTTPRequest: Sendable {
    var method: String
    var target: String
    var version: String
    var headers: [String: String]
    var body: Data

    var path: String {
        String(target.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first ?? "")
    }
    func header(_ name: String) -> String? { headers[name.lowercased()] }
}

/// 单个 TCP 连接：增量解析 HTTP/1.1，支持 keep-alive、Content-Length、chunked、Expect: 100-continue。
/// 所有状态只在 hub.queue 上访问。
final class HTTPConnection: @unchecked Sendable {
    static let maxHeaderBytes = 64 * 1024
    static let maxBodyBytes = 32 * 1024 * 1024
    static let maxPendingSSEBytes = 16 * 1024 * 1024

    let nw: NWConnection
    private unowned let hub: Hub
    private var buffer = Data()
    private var sentContinue = false
    private var closed = false
    private(set) var isSSE = false
    private var pendingBytes = 0
    private var draining = false

    var id: ObjectIdentifier { ObjectIdentifier(self) }

    init(_ nw: NWConnection, hub: Hub) {
        self.nw = nw
        self.hub = hub
    }

    func start() {
        nw.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled: self?.close()
            default: break
            }
        }
        nw.start(queue: hub.queue)
        receive()
    }

    private func receive() {
        nw.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, isComplete, error in
            guard let self, !self.closed else { return }
            if let data, !data.isEmpty, !self.isSSE, !self.draining {
                self.buffer.append(data)
                self.process()
            }
            if isComplete || error != nil {
                self.close()
            } else if !self.closed {
                self.receive()
            }
        }
    }

    private func process() {
        while !closed && !draining && !isSSE {
            guard let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) else {
                if buffer.count > Self.maxHeaderBytes { fail(431) }
                return
            }
            guard headerEnd.lowerBound <= Self.maxHeaderBytes else { fail(431); return }
            let head = String(decoding: buffer[..<headerEnd.lowerBound], as: UTF8.self)
            var lines = head.components(separatedBy: "\r\n")
            let requestLine = lines.removeFirst().split(separator: " ", omittingEmptySubsequences: true)
            guard requestLine.count == 3 else { fail(400); return }
            var headers: [String: String] = [:]
            for line in lines {
                guard let colon = line.firstIndex(of: ":") else { continue }
                let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
                let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                headers[name] = headers[name].map { "\($0), \(value)" } ?? value
            }

            let bodyStart = headerEnd.upperBound
            let body: Data
            let end: Int
            if let te = headers["transfer-encoding"]?.lowercased(), te.contains("chunked") {
                switch Self.decodeChunked(buffer, from: bodyStart) {
                case .incomplete: sendContinueIfNeeded(headers); return
                case .invalid: fail(400); return
                case .tooLarge: fail(413); return
                case let .done(decoded, consumed): body = decoded; end = consumed
                }
            } else {
                let lengthText = headers["content-length"] ?? "0"
                guard let length = Int(lengthText), length >= 0 else { fail(400); return }
                guard length <= Self.maxBodyBytes else { fail(413); return }
                guard buffer.count - bodyStart >= length else { sendContinueIfNeeded(headers); return }
                body = buffer.subdata(in: bodyStart..<(bodyStart + length))
                end = bodyStart + length
            }
            buffer = Data(buffer[end...])
            sentContinue = false

            let version = String(requestLine[2])
            let connHeader = headers["connection"]?.lowercased() ?? ""
            let keepAlive = version == "HTTP/1.1" ? !connHeader.contains("close") : connHeader.contains("keep-alive")
            let request = HTTPRequest(method: String(requestLine[0]).uppercased(), target: String(requestLine[1]),
                                      version: version, headers: headers, body: body)
            hub.handle(request, on: self, keepAlive: keepAlive)
        }
    }

    private func sendContinueIfNeeded(_ headers: [String: String]) {
        guard !sentContinue, headers["expect"]?.lowercased() == "100-continue" else { return }
        sentContinue = true
        nw.send(content: Data("HTTP/1.1 100 Continue\r\n\r\n".utf8), completion: .contentProcessed { _ in })
    }

    private func fail(_ status: Int) {
        respond(status: status, body: Data(HTTPStatus.reason(status).utf8),
                contentType: "text/plain; charset=utf-8", keepAlive: false)
    }

    func respond(status: Int, headers: [(String, String)] = [], body: Data = Data(),
                 contentType: String? = nil, keepAlive: Bool, headOnly: Bool = false) {
        guard !closed else { return }
        var head = "HTTP/1.1 \(status) \(HTTPStatus.reason(status))\r\n"
        if let contentType { head += "Content-Type: \(contentType)\r\n" }
        for (k, v) in headers { head += "\(k): \(v)\r\n" }
        if status != 204 && status != 304 { head += "Content-Length: \(body.count)\r\n" }
        head += keepAlive ? "Connection: keep-alive\r\n\r\n" : "Connection: close\r\n\r\n"
        var data = Data(head.utf8)
        if !headOnly { data.append(body) }
        if keepAlive {
            nw.send(content: data, completion: .contentProcessed { [weak self] error in
                if error != nil { self?.close() }
            })
        } else {
            draining = true
            buffer.removeAll()
            nw.send(content: data, contentContext: .finalMessage, isComplete: true,
                    completion: .contentProcessed { [weak self] _ in self?.close() })
        }
    }

    // MARK: SSE

    func upgradeToSSE() {
        isSSE = true
        buffer.removeAll()
        let head = "HTTP/1.1 200 OK\r\n"
            + "Content-Type: text/event-stream; charset=utf-8\r\n"
            + "Cache-Control: no-cache\r\n"
            + "Connection: keep-alive\r\n"
            + "Access-Control-Allow-Origin: *\r\n"
            + "X-Accel-Buffering: no\r\n\r\n"
            + "retry: 2000\n\n"
        write(Data(head.utf8))
    }

    func write(_ data: Data) {
        guard !closed else { return }
        pendingBytes += data.count
        if pendingBytes > Self.maxPendingSSEBytes { close(); return }
        let size = data.count
        nw.send(content: data, completion: .contentProcessed { [weak self] error in
            guard let self else { return }
            self.pendingBytes -= size
            if error != nil { self.close() }
        })
    }

    func close() {
        guard !closed else { return }
        closed = true
        nw.cancel()
        hub.connectionClosed(self)
    }

    // MARK: chunked

    enum ChunkResult { case incomplete, invalid, tooLarge, done(Data, Int) }

    static func decodeChunked(_ buf: Data, from start: Int) -> ChunkResult {
        let crlf = Data("\r\n".utf8)
        var i = start
        var out = Data()
        while true {
            guard let lineEnd = buf.range(of: crlf, in: i..<buf.endIndex) else { return .incomplete }
            let line = String(decoding: buf[i..<lineEnd.lowerBound], as: UTF8.self)
            let sizeText = line.split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
            guard let size = Int(sizeText, radix: 16), size >= 0 else { return .invalid }
            i = lineEnd.upperBound
            if size == 0 {
                while true {
                    guard let e = buf.range(of: crlf, in: i..<buf.endIndex) else { return .incomplete }
                    if e.lowerBound == i { return .done(out, e.upperBound) }
                    i = e.upperBound
                }
            }
            guard out.count + size <= maxBodyBytes else { return .tooLarge }
            guard buf.count >= i + size + 2 else { return .incomplete }
            out.append(buf[i..<(i + size)])
            i += size
            guard buf[i] == 13, buf[i + 1] == 10 else { return .invalid }
            i += 2
        }
    }
}

enum HTTPStatus {
    static func reason(_ code: Int) -> String {
        switch code {
        case 100: "Continue"
        case 200: "OK"
        case 204: "No Content"
        case 301: "Moved Permanently"
        case 304: "Not Modified"
        case 400: "Bad Request"
        case 403: "Forbidden"
        case 404: "Not Found"
        case 405: "Method Not Allowed"
        case 413: "Payload Too Large"
        case 431: "Request Header Fields Too Large"
        case 500: "Internal Server Error"
        default: "Unknown"
        }
    }
}
