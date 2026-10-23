import Foundation

enum StaticFiles {
    static let types: [String: String] = [
        "html": "text/html; charset=utf-8",
        "htm": "text/html; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "map": "application/json; charset=utf-8",
        "txt": "text/plain; charset=utf-8",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "ico": "image/x-icon",
        "woff2": "font/woff2",
        "woff": "font/woff",
        "ttf": "font/ttf",
        "otf": "font/otf",
        "wav": "audio/wav",
        "mp3": "audio/mpeg",
        "ogg": "audio/ogg",
        "wasm": "application/wasm",
    ]

    static func serve(path rawPath: String, root: URL, head: Bool, conn: HTTPConnection, keepAlive: Bool) {
        func reply(_ status: Int, _ text: String, type: String = "text/plain; charset=utf-8") {
            conn.respond(status: status, body: Data(text.utf8), contentType: type, keepAlive: keepAlive, headOnly: head)
        }
        guard let decoded = rawPath.removingPercentEncoding, decoded.hasPrefix("/"),
              !decoded.contains("\0"), !decoded.contains("\\") else {
            reply(400, "Bad Request"); return
        }
        let components = decoded.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        // 拒绝 . / .. 以及隐藏文件
        guard !components.contains(where: { $0.hasPrefix(".") }) else {
            reply(403, "Forbidden"); return
        }

        let rootPath = root.resolvingSymlinksInPath().standardizedFileURL.path
        var url = URL(fileURLWithPath: rootPath, isDirectory: true)
        for c in components { url.appendPathComponent(c) }
        if decoded.hasSuffix("/") || Paths.isDirectory(url) { url.appendPathComponent("index.html") }

        let resolved = url.resolvingSymlinksInPath().standardizedFileURL.path
        guard resolved == rootPath || resolved.hasPrefix(rootPath + "/") else {
            reply(403, "Forbidden"); return
        }
        guard !Paths.isDirectory(URL(fileURLWithPath: resolved)),
              let data = FileManager.default.contents(atPath: resolved) else {
            if components.isEmpty {
                let html = """
                <!doctype html><meta charset="utf-8"><title>Meerkat</title>
                <body style="background:#1d2b38;color:#f3e2c0;font:14px -apple-system,sans-serif;padding:40px">
                <h2>没有找到 index.html</h2><p>网页目录：<code>\(escape(rootPath))</code></p>
                <p>开发时可以用环境变量 <code>MEERKAT_WEB_ROOT</code> 指定网页目录。</p></body>
                """
                reply(404, html, type: "text/html; charset=utf-8")
            } else {
                reply(404, "Not Found")
            }
            return
        }
        let ext = (resolved as NSString).pathExtension.lowercased()
        conn.respond(status: 200, headers: [("Cache-Control", "no-cache")], body: data,
                     contentType: types[ext] ?? "application/octet-stream", keepAlive: keepAlive, headOnly: head)
    }

    private static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
    }
}
