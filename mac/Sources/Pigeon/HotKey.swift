import Carbon.HIToolbox
import Foundation

/// 可配置的全局快捷键规格（如 `opt+space`、`cmd+shift+p`）。纯值类型，主线程与测试均可直接校验。
struct HotKeySpec: Sendable, Equatable {
    var keyCode: UInt32
    var modifiers: UInt32
    var raw: String

    static let defaultSpec = HotKeySpec(keyCode: UInt32(kVK_Space), modifiers: UInt32(optionKey), raw: "opt+space")

    private static let keyTable: [String: (code: Int, canonical: String, label: String)] = [
        "space": (kVK_Space, "space", "空格"),
        "return": (kVK_Return, "return", "回车"),
        "enter": (kVK_Return, "return", "回车"),
        "tab": (kVK_Tab, "tab", "Tab"),
        "a": (kVK_ANSI_A, "a", "A"), "b": (kVK_ANSI_B, "b", "B"), "c": (kVK_ANSI_C, "c", "C"),
        "d": (kVK_ANSI_D, "d", "D"), "e": (kVK_ANSI_E, "e", "E"), "f": (kVK_ANSI_F, "f", "F"),
        "g": (kVK_ANSI_G, "g", "G"), "h": (kVK_ANSI_H, "h", "H"), "i": (kVK_ANSI_I, "i", "I"),
        "j": (kVK_ANSI_J, "j", "J"), "k": (kVK_ANSI_K, "k", "K"), "l": (kVK_ANSI_L, "l", "L"),
        "m": (kVK_ANSI_M, "m", "M"), "n": (kVK_ANSI_N, "n", "N"), "o": (kVK_ANSI_O, "o", "O"),
        "p": (kVK_ANSI_P, "p", "P"), "q": (kVK_ANSI_Q, "q", "Q"), "r": (kVK_ANSI_R, "r", "R"),
        "s": (kVK_ANSI_S, "s", "S"), "t": (kVK_ANSI_T, "t", "T"), "u": (kVK_ANSI_U, "u", "U"),
        "v": (kVK_ANSI_V, "v", "V"), "w": (kVK_ANSI_W, "w", "W"), "x": (kVK_ANSI_X, "x", "X"),
        "y": (kVK_ANSI_Y, "y", "Y"), "z": (kVK_ANSI_Z, "z", "Z"),
        "0": (kVK_ANSI_0, "0", "0"), "1": (kVK_ANSI_1, "1", "1"), "2": (kVK_ANSI_2, "2", "2"),
        "3": (kVK_ANSI_3, "3", "3"), "4": (kVK_ANSI_4, "4", "4"), "5": (kVK_ANSI_5, "5", "5"),
        "6": (kVK_ANSI_6, "6", "6"), "7": (kVK_ANSI_7, "7", "7"), "8": (kVK_ANSI_8, "8", "8"),
        "9": (kVK_ANSI_9, "9", "9"),
        "f1": (kVK_F1, "f1", "F1"), "f2": (kVK_F2, "f2", "F2"), "f3": (kVK_F3, "f3", "F3"),
        "f4": (kVK_F4, "f4", "F4"), "f5": (kVK_F5, "f5", "F5"), "f6": (kVK_F6, "f6", "F6"),
        "f7": (kVK_F7, "f7", "F7"), "f8": (kVK_F8, "f8", "F8"), "f9": (kVK_F9, "f9", "F9"),
        "f10": (kVK_F10, "f10", "F10"), "f11": (kVK_F11, "f11", "F11"), "f12": (kVK_F12, "f12", "F12"),
        "-": (kVK_ANSI_Minus, "-", "-"),
        "=": (kVK_ANSI_Equal, "=", "="),
        "[": (kVK_ANSI_LeftBracket, "[", "["),
        "]": (kVK_ANSI_RightBracket, "]", "]"),
        ";": (kVK_ANSI_Semicolon, ";", ";"),
        "'": (kVK_ANSI_Quote, "'", "'"),
        ",": (kVK_ANSI_Comma, ",", ","),
        ".": (kVK_ANSI_Period, ".", "."),
        "/": (kVK_ANSI_Slash, "/", "/"),
        "`": (kVK_ANSI_Grave, "`", "`"),
        "\\": (kVK_ANSI_Backslash, "\\", "\\"),
    ]

    static func parse(_ input: String) -> HotKeySpec? {
        let tokens = input.split(separator: "+", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        guard tokens.count >= 2, let keyTok = tokens.last, let keyInfo = keyTable[keyTok] else { return nil }
        var mods: UInt32 = 0
        for mod in tokens.dropLast() {
            switch mod {
            case "ctrl", "control": mods |= UInt32(controlKey)
            case "opt", "alt", "option": mods |= UInt32(optionKey)
            case "shift": mods |= UInt32(shiftKey)
            case "cmd", "command", "meta": mods |= UInt32(cmdKey)
            default: return nil
            }
        }
        // 至少带 ⌃、⌥、⌘ 里的一个：只按 ⇧ 加字母会把全系统的大写字母吃掉。F1–F12 例外
        let isFKey = keyInfo.canonical.count >= 2 && keyInfo.canonical.hasPrefix("f") && Int(keyInfo.canonical.dropFirst()) != nil
        guard mods != 0, mods != UInt32(shiftKey) || isFKey else { return nil }
        var ordered: [String] = []
        if (mods & UInt32(controlKey)) != 0 { ordered.append("ctrl") }
        if (mods & UInt32(optionKey)) != 0 { ordered.append("opt") }
        if (mods & UInt32(shiftKey)) != 0 { ordered.append("shift") }
        if (mods & UInt32(cmdKey)) != 0 { ordered.append("cmd") }
        ordered.append(keyInfo.canonical)
        return HotKeySpec(keyCode: UInt32(keyInfo.code), modifiers: mods, raw: ordered.joined(separator: "+"))
    }

    var displayLabel: String {
        var parts: [String] = []
        if (modifiers & UInt32(controlKey)) != 0 { parts.append("⌃") }
        if (modifiers & UInt32(optionKey)) != 0 { parts.append("⌥") }
        if (modifiers & UInt32(shiftKey)) != 0 { parts.append("⇧") }
        if (modifiers & UInt32(cmdKey)) != 0 { parts.append("⌘") }
        let keyTok = raw.split(separator: "+").last.map(String.init) ?? "space"
        let label = Self.keyTable[keyTok]?.label ?? keyTok.uppercased()
        parts.append(label)
        return parts.joined(separator: " ")
    }
}

/// 全局快捷键（默认 ⌥ 空格）：无论焦点在哪个应用里，按一下切换刘海（或菜单栏）里的快速派活面板。
@MainActor
final class GlobalHotKey {
    private var hotKeyRef: EventHotKeyRef?
    private var handlerRef: EventHandlerRef?
    private var activeSpec: HotKeySpec?
    private static var currentTrigger: (@MainActor () -> Void)?

    init(onTrigger: @escaping @MainActor () -> Void) {
        Self.currentTrigger = onTrigger
    }

    func setEnabled(_ enabled: Bool) {
        configure(enabled: enabled, spec: activeSpec ?? .defaultSpec)
    }

    func configure(enabled: Bool, spec: HotKeySpec) {
        guard enabled else {
            unregister()
            activeSpec = nil
            return
        }
        if hotKeyRef != nil && activeSpec == spec { return }
        unregister()
        register(spec)
    }

    private func register(_ spec: HotKeySpec) {
        var specType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let status = InstallEventHandler(
            GetApplicationEventTarget(),
            { _, _, _ in
                DispatchQueue.main.async {
                    Task { @MainActor in GlobalHotKey.fire() }
                }
                return noErr
            },
            1,
            &specType,
            nil,
            &handlerRef
        )
        guard status == noErr else { return }
        let hotKeyID = EventHotKeyID(signature: OSType(0x5049474E), id: 1) // 'PIGN'
        let reg = RegisterEventHotKey(
            spec.keyCode,
            spec.modifiers,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
        if reg == noErr {
            activeSpec = spec
        } else {
            unregister()
            activeSpec = nil
        }
    }

    private func unregister() {
        if let hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
            self.hotKeyRef = nil
        }
        if let handlerRef {
            RemoveEventHandler(handlerRef)
            self.handlerRef = nil
        }
    }

    private static func fire() {
        currentTrigger?()
    }
}
