// 用透明背景的狐獴图合成标准 Mac 图标：1024 画布，中间 824 的圆角夜蓝底，四角透明。
// 用法：swift mac/scripts/compose-icon.swift <透明狐獴.png> <输出 1024.png>
import AppKit

let args = CommandLine.arguments
guard args.count == 3, let src = NSImage(contentsOfFile: args[1]),
      let cg = src.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("用法：compose-icon.swift <透明狐獴.png> <输出.png>\n".data(using: .utf8)!)
    exit(64)
}

// 按透明通道裁掉四周空白，让角色真正居中
func opaqueBounds(_ img: CGImage) -> CGRect {
    let w = img.width, h = img.height
    var data = [UInt8](repeating: 0, count: w * h * 4)
    let ctx = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    var minX = w, minY = h, maxX = 0, maxY = 0
    for y in 0..<h { for x in 0..<w where data[(y * w + x) * 4 + 3] > 24 {
        minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
    } }
    // CGContext 的行从下往上，换回图像坐标（从上往下）
    return CGRect(x: minX, y: h - 1 - maxY, width: maxX - minX + 1, height: maxY - minY + 1)
}
let crop = cg.cropping(to: opaqueBounds(cg))!

let S: CGFloat = 1024, inset: CGFloat = 100, body = S - inset * 2, radius: CGFloat = 185
let ctx = CGContext(data: nil, width: Int(S), height: Int(S), bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.clear(CGRect(x: 0, y: 0, width: S, height: S))

let bodyRect = CGRect(x: inset, y: inset, width: body, height: body)
let path = CGPath(roundedRect: bodyRect, cornerWidth: radius, cornerHeight: radius, transform: nil)
ctx.saveGState()
ctx.addPath(path); ctx.clip()
let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!, colors: [
    CGColor(srgbRed: 0x24 / 255, green: 0x36 / 255, blue: 0x4a / 255, alpha: 1),
    CGColor(srgbRed: 0x16 / 255, green: 0x20 / 255, blue: 0x2b / 255, alpha: 1),
] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: S - inset), end: CGPoint(x: 0, y: inset), options: [])

// 像素星星（坐标按从上往下写，再换算）
let stars: [(CGFloat, CGFloat, CGFloat)] = [(205, 215, 14), (790, 190, 18), (840, 330, 10), (250, 380, 10), (725, 300, 8)]
ctx.setFillColor(CGColor(srgbRed: 1, green: 0.91, blue: 0.66, alpha: 1))
for (x, y, s) in stars {
    let fy = S - y
    ctx.fill(CGRect(x: x - s / 2, y: fy - s / 2, width: s, height: s))
    if s >= 14 {
        ctx.fill(CGRect(x: x - s * 1.5, y: fy - s / 4, width: s * 3, height: s / 2))
        ctx.fill(CGRect(x: x - s / 4, y: fy - s * 1.5, width: s / 2, height: s * 3))
    }
}
// 底部一条暖色地面，让狐獴站得住
ctx.setFillColor(CGColor(srgbRed: 0x3a / 255, green: 0x2a / 255, blue: 0x22 / 255, alpha: 1))
ctx.fill(CGRect(x: inset, y: inset, width: body, height: 92))
ctx.setFillColor(CGColor(srgbRed: 0x5a / 255, green: 0x3d / 255, blue: 0x2b / 255, alpha: 1))
ctx.fill(CGRect(x: inset, y: inset + 92, width: body, height: 12))

// 狐獴：高度占底板 76%，水平居中，脚踩在地面线上
let h = body * 0.76, w = h * CGFloat(crop.width) / CGFloat(crop.height)
let rect = CGRect(x: (S - w) / 2, y: inset + 70, width: w, height: h)
ctx.interpolationQuality = .high
ctx.draw(crop, in: rect)
ctx.restoreGState()

let out = ctx.makeImage()!
let rep = NSBitmapImageRep(cgImage: out)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
print("已生成 \(args[2])")
