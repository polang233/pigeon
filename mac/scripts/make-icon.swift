#!/usr/bin/env swift
// 生成 mac/Resources/AppIcon.icns：白底黑鸽（灰翅、红信筒）。
// 底图是方形满版的 SVG 或位图（默认 assets/brand/pigeon-app-icon.svg，由 make-brand.swift 生成），这里裁成标准 Mac 图标的样子：
// 1024 画布，中间 824 的圆角方块，四角透明，加一圈很淡的内描边。SVG 在每个尺寸按矢量重画，位图则各尺寸从原图重新缩放。
// 用法：swift mac/scripts/make-icon.swift [底图.svg|.png] [输出.icns]
// 环境变量 PIGEON_ICON_PREVIEW=<路径.png> 时顺便输出一张 1024 的预览。
import AppKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let scriptDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let args = CommandLine.arguments
let source = args.count > 1
    ? URL(fileURLWithPath: args[1])
    : scriptDir.appendingPathComponent("../../assets/brand/pigeon-app-icon.svg").standardizedFileURL
let output = args.count > 2
    ? URL(fileURLWithPath: args[2])
    : scriptDir.appendingPathComponent("../Resources/AppIcon.icns").standardizedFileURL

let isVector = source.pathExtension.lowercased() == "svg"
guard let src = NSImage(contentsOf: source),
      let art = src.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("读不了底图：\(source.path)\n".data(using: .utf8)!)
    exit(66)
}

/// 生成 size×size 的图标。比例按 1024 的标准模板：边距 100，圆角 185。
func render(size: Int) -> CGImage {
    let s = CGFloat(size)
    let k = s / 1024
    let inset = 100 * k, body = s - inset * 2, radius = 185 * k
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.clear(CGRect(x: 0, y: 0, width: s, height: s))
    let rect = CGRect(x: inset, y: inset, width: body, height: body)
    let path = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)

    // 生成的位图四边有痕迹，稍微放大一点裁掉边缘；SVG 没有这个问题
    let bleed = isVector ? 0 : body * 0.03
    let target = rect.insetBy(dx: -bleed, dy: -bleed)
    ctx.saveGState()
    ctx.addPath(path)
    ctx.clip()
    ctx.interpolationQuality = .high
    if isVector {
        // 直接按目标尺寸画矢量，16 px 也是清楚的边
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
        src.draw(in: target)
        NSGraphicsContext.restoreGraphicsState()
    } else {
        ctx.draw(art, in: target)
    }
    ctx.restoreGState()

    // 很淡的内描边，让白底在浅色背景上也有边
    if size >= 64 {
        ctx.addPath(path)
        ctx.setStrokeColor(CGColor(gray: 0, alpha: 0.12))
        ctx.setLineWidth(max(1, 4 * k))
        ctx.strokePath()
    }
    return ctx.makeImage()!
}

func writePNG(_ image: CGImage, to url: URL) {
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { fatalError("写入失败：\(url.path)") }
}

let fm = FileManager.default
let iconset = fm.temporaryDirectory.appendingPathComponent("Pigeon-\(UUID().uuidString).iconset")
try fm.createDirectory(at: iconset, withIntermediateDirectories: true)
defer { try? fm.removeItem(at: iconset) }

for base in [16, 32, 128, 256, 512] {
    writePNG(render(size: base), to: iconset.appendingPathComponent("icon_\(base)x\(base).png"))
    writePNG(render(size: base * 2), to: iconset.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
}
if let preview = ProcessInfo.processInfo.environment["PIGEON_ICON_PREVIEW"] {
    writePNG(render(size: 1024), to: URL(fileURLWithPath: preview))
}

try fm.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["-c", "icns", iconset.path, "-o", output.path]
try task.run()
task.waitUntilExit()
guard task.terminationStatus == 0 else { fatalError("iconutil 失败") }
print("已生成 \(output.path)")
