import AppKit
import SwiftUI

/// 光带下面飞的那只鸽子：单独一个点不着的透明小窗，飞完就关
@MainActor
final class FlightOverlay {
    private let window: NSPanel
    private let path: FlightPath
    private let origin: CGPoint
    var onLand: (() -> Void)?

    /// from、to：光带上两段的中点（屏幕坐标，y 向上）
    init(from: CGPoint, to: CGPoint, color: UInt32) {
        path = FlightPath(x0: 0, x1: to.x - from.x)
        let pad: CGFloat = 24
        let minX = min(0, path.dx) - pad, maxX = max(0, path.dx) + pad
        let height = path.depth + pad * 2
        // 窗口左上角在 (from.x + minX, from.y + pad)
        origin = CGPoint(x: -minX, y: pad)
        let frame = NSRect(x: from.x + minX, y: from.y + pad - height, width: maxX - minX, height: height)
        window = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.level = .statusBar + 1
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        window.isReleasedWhenClosed = false
        window.animationBehavior = .none
        let start = Date()
        window.contentView = NSHostingView(rootView: FlightView(path: path, origin: origin, color: color, start: start))
    }

    func start() {
        window.orderFrontRegardless()
        DispatchQueue.main.asyncAfter(deadline: .now() + path.duration) { [weak self] in
            self?.close()
            self?.onLand?()
            self?.onLand = nil
        }
    }

    func close() { window.orderOut(nil) }
}

struct FlightView: View {
    var path: FlightPath
    var origin: CGPoint
    var color: UInt32
    var start: Date

    var body: some View {
        TimelineView(.animation) { ctx in
            let el = ctx.date.timeIntervalSince(start)
            let t = min(1, el / path.duration)
            let p = path.point(t)
            ZStack(alignment: .topLeading) {
                ForEach(Array(path.trail(at: el).enumerated()), id: \.offset) { _, d in
                    Rectangle().fill(Color(hex: color)).frame(width: 3, height: 3)
                        .opacity(d.1)
                        .position(x: origin.x + d.0.x, y: origin.y + d.0.y)
                }
                PigeonSprite(color: color, phase: (el / 0.6).truncatingRemainder(dividingBy: 1))
                    .frame(width: 18, height: 17)
                    .scaleEffect(x: path.facesLeft ? -1 : 1, y: 1)
                    .rotationEffect(.degrees(path.facesLeft ? -path.tilt(t) : path.tilt(t)))
                    .shadow(color: .white.opacity(0.25), radius: 3)
                    .position(x: origin.x + p.x, y: origin.y + p.y)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}
