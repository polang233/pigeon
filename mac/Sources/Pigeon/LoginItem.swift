import Foundation
import ServiceManagement

/// 登录时自动启动（macOS 13+ `SMAppService.mainApp`）。未打包成 `.app` 运行（例如 `swift run` / `swift test`）时不可用。
enum LoginItem {
    static func snapshot() -> [String: Any] {
        let supported = Bundle.main.bundleIdentifier != nil
        let status = SMAppService.mainApp.status
        return [
            "supported": supported,
            "enabled": supported && (status == .enabled || status == .requiresApproval),
            "requiresApproval": supported && status == .requiresApproval,
        ]
    }

    static func body() -> Data {
        (try? JSONSerialization.data(withJSONObject: snapshot(), options: [.sortedKeys, .withoutEscapingSlashes]))
            ?? Data(#"{"enabled":false,"requiresApproval":false,"supported":false}"#.utf8)
    }

    static func setEnabled(_ enabled: Bool) -> (status: Int, body: Data) {
        guard Bundle.main.bundleIdentifier != nil else {
            return (400, Data(#"{"error":"需要先安装为 Pigeon.app 后再开启登录自启","supported":false,"enabled":false,"requiresApproval":false}"#.utf8))
        }
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
            return (200, body())
        } catch {
            var out = snapshot()
            out["error"] = error.localizedDescription
            let data = (try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .withoutEscapingSlashes]))
                ?? Data(#"{"error":"设置登录自启失败"}"#.utf8)
            return (500, data)
        }
    }
}
