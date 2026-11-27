import Carbon.HIToolbox
import Foundation

/// 全局快捷键（⌥ 空格）：无论焦点在哪个应用里，按一下切换刘海（或菜单栏）里的快速派活面板。
@MainActor
final class GlobalHotKey {
    private var hotKeyRef: EventHotKeyRef?
    private var handlerRef: EventHandlerRef?
    private static var currentTrigger: (@MainActor () -> Void)?

    init(onTrigger: @escaping @MainActor () -> Void) {
        Self.currentTrigger = onTrigger
    }

    func setEnabled(_ enabled: Bool) {
        if enabled { register() } else { unregister() }
    }

    private func register() {
        guard hotKeyRef == nil else { return }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let status = InstallEventHandler(
            GetApplicationEventTarget(),
            { _, _, _ in
                DispatchQueue.main.async {
                    Task { @MainActor in GlobalHotKey.fire() }
                }
                return noErr
            },
            1,
            &spec,
            nil,
            &handlerRef
        )
        guard status == noErr else { return }
        let hotKeyID = EventHotKeyID(signature: OSType(0x5049474E), id: 1) // 'PIGN'
        let reg = RegisterEventHotKey(
            UInt32(kVK_Space),
            UInt32(optionKey),
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
        if reg != noErr { unregister() }
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
