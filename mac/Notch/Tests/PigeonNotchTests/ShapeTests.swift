import AppKit
import SwiftUI
import Testing
@testable import PigeonNotch

// 刘海形状：从收起长到展开的每一帧都要是一个贴着顶边、不超出边界、两角圆的形状。
// 设了 NOTCH_SHAPE_DIR 时，把收起、动画中间（0.3、0.6）、展开四帧画成 PNG，人眼看过渡是否连贯。

private struct Frame { var w: CGFloat; var h: CGFloat; var bottom: CGFloat }
private let idle = Frame(w: 343, h: 32, bottom: NotchGeometry.idleRadius)
private let open = Frame(w: 456, h: 300, bottom: NotchGeometry.openRadius)
private func lerp(_ t: CGFloat) -> Frame {
    Frame(w: idle.w + (open.w - idle.w) * t, h: idle.h + (open.h - idle.h) * t, bottom: idle.bottom + (open.bottom - idle.bottom) * t)
}

@Test func notchShapeStaysInsideAndTouchesTop() {
    for i in 0...10 {
        let f = lerp(CGFloat(i) / 10)
        let r = CGRect(x: 0, y: 0, width: f.w, height: f.h)
        let p = NotchShape(flare: NotchGeometry.flare, bottomRadius: f.bottom).path(in: r)
        let b = p.boundingRect
        #expect(abs(b.minX - r.minX) < 0.5 && abs(b.maxX - r.maxX) < 0.5, "第 \(i) 帧左右要贴边")
        #expect(abs(b.minY - r.minY) < 0.5 && abs(b.maxY - r.maxY) < 0.5, "第 \(i) 帧上下要贴边")
        // 顶边正中是实心的，下沿四角是空的（圆角）
        #expect(p.contains(CGPoint(x: r.midX, y: 1)))
        #expect(!p.contains(CGPoint(x: NotchGeometry.flare + 1, y: r.maxY - 1)))
        #expect(!p.contains(CGPoint(x: r.maxX - NotchGeometry.flare - 1, y: r.maxY - 1)))
        // 顶上反弯：最外侧靠下一点是空的
        #expect(!p.contains(CGPoint(x: 1, y: NotchGeometry.flare)))
    }
}

@Test func menuShapeHasFourRoundCorners() {
    let r = CGRect(x: 0, y: 0, width: 400, height: 300)
    let p = NotchShape(flare: 0, bottomRadius: NotchGeometry.menuRadius, topRadius: NotchGeometry.menuRadius).path(in: r)
    for c in [CGPoint(x: 1, y: 1), CGPoint(x: 399, y: 1), CGPoint(x: 1, y: 299), CGPoint(x: 399, y: 299)] {
        #expect(!p.contains(c))
    }
    #expect(p.contains(CGPoint(x: 200, y: 150)))
}

@MainActor @Test func renderShapeFramesWhenAsked() throws {
    guard let dir = ProcessInfo.processInfo.environment["NOTCH_SHAPE_DIR"] else { return }
    for t in [0, 0.3, 0.6, 1.0] as [CGFloat] {
        let f = lerp(t)
        let view = ZStack(alignment: .top) {
            Color(white: 0.85)
            NotchShape(flare: NotchGeometry.flare, bottomRadius: f.bottom).fill(Color.black).frame(width: f.w, height: f.h)
        }
        .frame(width: open.w + 40, height: open.h + 20)
        let r = ImageRenderer(content: view)
        r.scale = 2
        guard let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else { continue }
        try png.write(to: URL(fileURLWithPath: "\(dir)/shape-\(Int(t * 100)).png"))
    }
}
