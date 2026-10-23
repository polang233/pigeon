#!/usr/bin/env swift
// 生成 mac/Resources/AppIcon.icns：像素风站立的狐獴。
// 用法：swift mac/scripts/make-icon.swift [输出路径.icns]
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// 每个字符是一个像素格；改这里就能调形象。
// . 透明  D 深棕(背/耳)  T 沙色身体  C 奶油肚子  M 眼罩  K 黑(眼/鼻)  W 眼睛高光
let meerkat = """
....DDDDD........
..DDTTTTTDD......
.DTTTTTTTTTD.....
DDTTTTTTTTTDD....
DDMMMTTTMMMDD....
.DMKMTTTMKMD.....
.DMMMTTTMMMD.....
..DTTTTTTTD......
...DTTCTTD.......
....DCCCD........
.....DKD.........
....DTCTD........
...DTTCTTD.......
..DTTCCCTTD......
.DTTCCCCCTTD.....
.DTDCCCCCDTD.....
.DTDCCCCCDTD.....
.DDTCCCCCTDD.....
.DTTCCCCCTTD.....
.DTTCCCCCTTD.....
.DTTTCCCTTTD...MM
..DTTTTTTTD...DTD
..DTTDDDTTD..DTD.
..DTD...DTD.DTTD.
.DDDD...DDDDDD...
"""

// 背景：32×32 格，meerkat 叠加在上面
let scene = """
.................s..............
..........s.....................
.............................s..
...s...................fffff....
.......................fyfyf....
.......................fffff....
.......................fyfyf....
.......................fffff....
................................
................................
..s.............................
............................s...
................................
................................
................................
................................
.....s..........................
................................
..............................s.
................................
................................
................................
......s.........................
................................
................................
................................
................................
................................
gggggggggggggggggggggggggggggggg
GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG
GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG
GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG
"""

func rgb(_ hex: UInt32) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255, alpha: 1)
}

let palette: [Character: CGColor] = [
    "D": rgb(0xa87b4f), "T": rgb(0xd9b382), "C": rgb(0xf3e2c0), "M": rgb(0x3b2a1e),
    "K": rgb(0x111111), "W": rgb(0xffffff),
    "s": rgb(0x4a6680), "f": rgb(0x8a5a2b), "y": rgb(0xffcf6b),
    "g": rgb(0x3a5268), "G": rgb(0x283a4b),
]
let background = rgb(0x1d2b38)
let gridSize = 32

func rows(_ s: String) -> [[Character]] { s.split(separator: "\n").map { Array($0) } }

func render(size: Int) -> CGImage {
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let s = CGFloat(size)
    let margin = (s * 100 / 1024).rounded()
    let body = s - margin * 2
    let rect = CGRect(x: margin, y: margin, width: body, height: body)
    let path = CGPath(roundedRect: rect, cornerWidth: body * 0.2237, cornerHeight: body * 0.2237, transform: nil)

    ctx.addPath(path)
    ctx.setFillColor(background)
    ctx.fillPath()
    ctx.addPath(path)
    ctx.clip()
    ctx.setShouldAntialias(false)
    ctx.interpolationQuality = .none

    let cell = body / CGFloat(gridSize)
    // 网格坐标 (列, 行) → 像素，行从上往下；四舍五入让边缘对齐像素
    func fill(_ col: Int, _ row: Int, _ color: CGColor) {
        let x0 = (margin + CGFloat(col) * cell).rounded(), x1 = (margin + CGFloat(col + 1) * cell).rounded()
        let yTop0 = (margin + CGFloat(row) * cell).rounded(), yTop1 = (margin + CGFloat(row + 1) * cell).rounded()
        ctx.setFillColor(color)
        ctx.fill(CGRect(x: x0, y: s - yTop1, width: x1 - x0, height: yTop1 - yTop0))
    }

    for (r, line) in rows(scene).enumerated() {
        for (c, ch) in line.enumerated() { if let color = palette[ch] { fill(c, r, color) } }
    }
    let art = rows(meerkat)
    let offsetX = 9  // 身体（前 13 列）水平居中，尾巴伸到右边
    let offsetY = 28 - art.count + 1  // 脚踩在地面那一行
    for (r, line) in art.enumerated() {
        for (c, ch) in line.enumerated() { if let color = palette[ch] { fill(c + offsetX, r + offsetY, color) } }
    }
    return ctx.makeImage()!
}

func writePNG(_ image: CGImage, to url: URL) {
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { fatalError("写入失败：\(url.path)") }
}

let scriptDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let output = CommandLine.arguments.count > 1
    ? URL(fileURLWithPath: CommandLine.arguments[1])
    : scriptDir.appendingPathComponent("../Resources/AppIcon.icns").standardizedFileURL

let fm = FileManager.default
let iconset = fm.temporaryDirectory.appendingPathComponent("Meerkat-\(UUID().uuidString).iconset")
try fm.createDirectory(at: iconset, withIntermediateDirectories: true)
defer { try? fm.removeItem(at: iconset) }

for base in [16, 32, 128, 256, 512] {
    writePNG(render(size: base), to: iconset.appendingPathComponent("icon_\(base)x\(base).png"))
    writePNG(render(size: base * 2), to: iconset.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
}
if let preview = ProcessInfo.processInfo.environment["MEERKAT_ICON_PREVIEW"] {
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
