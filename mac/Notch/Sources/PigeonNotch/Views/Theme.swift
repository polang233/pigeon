import SwiftUI

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255,
                  blue: Double(hex & 0xff) / 255, opacity: opacity)
    }
}

/// 刘海永远是黑底，颜色照原型 app.css 的 .hud 一节（深色配色）
enum Theme {
    static let bg = Color.black
    static let text = Color(hex: 0xf2f2f4)
    static let soft = Color(hex: 0xdcdde2)
    static let mut = Color(hex: 0xc9cbd2)
    static let dim = Color(hex: 0x9b9da6)
    static let faint = Color(hex: 0x8b8d96)
    static let arrow = Color(hex: 0x6f717a)
    static let well = Color(hex: 0x15161a)
    static let line = Color.white.opacity(0.14)
    static let chipOn = Color.white.opacity(0.14)
    static let red = Color(hex: 0xff8a7e)
    static let redBg = Color(hex: 0xff6b5e, opacity: 0.18)
    static let go = Color(hex: 0x5fcb8b)
    static let goInk = Color(hex: 0x06250f)
    static let amber = Color(hex: 0xf0b44a)
    static let maskedFg = Color(hex: 0x8fdcae)
    static let maskedBg = Color(hex: 0x5fcb8b, opacity: 0.18)

    static func identity(_ a: AgentKind) -> Color { Color(hex: a.identityHex) }

    static func state(_ s: RunState) -> Color {
        switch s {
        case .run: Color(hex: 0xe9b44c)
        case .wait, .error: Color(hex: 0xff6b5e)
        case .done: Color(hex: 0x5fcb8b)
        case .idle, .off: Color(hex: 0x6f717a)
        }
    }
}

/// 面板里的按钮样式：普通、绿色放行、红字拦下、只有字的链接
struct HudButtonStyle: ButtonStyle {
    enum Kind { case plain, go, no, link }
    var kind: Kind = .plain
    @State private var hover = false

    func makeBody(configuration: Configuration) -> some View {
        Inner(configuration: configuration, kind: kind)
    }

    private struct Inner: View {
        let configuration: Configuration
        let kind: Kind
        @State private var hover = false
        @Environment(\.isEnabled) private var enabled
        @Environment(\.isFocused) private var focused

        var body: some View {
            configuration.label
                .font(.system(size: 12.5, weight: kind == .go ? .semibold : .regular))
                .lineLimit(1)
                .padding(.horizontal, kind == .link ? 6 : 11)
                .padding(.vertical, 4)
                .foregroundStyle(fg)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(bg))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(border, lineWidth: 1))
                .opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
                .contentShape(Rectangle())
                .onHover { hover = $0 }
        }

        private var fg: Color {
            switch kind {
            case .go: Theme.goInk
            case .no: Theme.red
            case .link: hover ? Theme.text : Theme.dim
            case .plain: Theme.text
            }
        }
        private var bg: Color {
            switch kind {
            case .go: Theme.go.opacity(hover ? 0.9 : 1)
            case .link: hover ? .white.opacity(0.08) : .clear
            default: .white.opacity(hover ? 0.12 : 0.06)
            }
        }
        private var border: Color {
            switch kind {
            case .go, .link: .clear
            case .no: Color(hex: 0xff6b5e, opacity: 0.4)
            case .plain: .white.opacity(0.16)
            }
        }
    }
}

extension ButtonStyle where Self == HudButtonStyle {
    static func hud(_ k: HudButtonStyle.Kind = .plain) -> HudButtonStyle { HudButtonStyle(kind: k) }
}

/// 标题行：左边一句，右边小字
struct HudHeader<Trailing: View>: View {
    var title: String
    /// 是面板里的第一行时，给右上角的关闭按钮让地方
    var reserveClose = true
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack {
            Text(title).accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            trailing
        }
        .font(.system(size: 11.5, weight: .medium))
        .foregroundStyle(Theme.dim)
        .padding(.trailing, reserveClose ? 28 : 0)
        .padding(.top, 2)
        .padding(.bottom, 6)
    }
}

/// 灰底的引文块
struct Quote: View {
    var text: Text
    var body: some View {
        text.font(.system(size: 12.5))
            .foregroundStyle(Theme.soft)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 11).padding(.vertical, 9)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.well))
    }
}

/// 谁 → 谁
struct RouteLine: View {
    var from: AgentKind
    var to: AgentKind
    var device: String?

    var body: some View {
        HStack(spacing: 7) {
            AgentLogo(agent: from, size: 16)
            Text(from.displayName).fontWeight(.semibold)
            Text("→").foregroundStyle(Theme.arrow)
            AgentLogo(agent: to, size: 16)
            Text(to.displayName).fontWeight(.semibold)
            if let device {
                Text(device).font(.system(size: 11)).foregroundStyle(Theme.mut)
                    .padding(.horizontal, 5)
                    .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(.white.opacity(0.2)))
            }
        }
        .font(.system(size: 12.5))
        .foregroundStyle(Theme.text)
        .lineLimit(1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(from.displayName) 发给 \(to.displayName)\(device.map { "，在 \($0)" } ?? "")")
    }
}

/// 原文：按设置把像密钥的字符串标红或打码
enum SecretText {
    static func render(_ text: String, mode: SecretsMode) -> Text {
        guard mode != .off else { return Text(text) }
        var out = AttributedString()
        for seg in Secrets.split(text) {
            if let kind = seg.kind {
                var a = AttributedString(mode == .mask ? "‹\(kind) 已打码›" : Secrets.peek(seg.text))
                a.foregroundColor = mode == .mask ? Theme.maskedFg : Theme.red
                a.backgroundColor = mode == .mask ? Theme.maskedBg : Theme.redBg
                out += a
            } else {
                out += AttributedString(seg.text)
            }
        }
        return Text(out)
    }
}
