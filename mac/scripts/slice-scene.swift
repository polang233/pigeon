// 把 Codex 画的角色表、道具表、房间图切成场景用的小像素图，放到 web/assets/scene/。
// 用法：swift mac/scripts/slice-scene.swift assets/scene-src web/assets/scene
//
// 表格按透明区域切：先按行（纵向空白）分带，再在每一带里按横向空白分格，每格裁到不透明内容的边界。
// 然后按比例缩小到场景的像素尺寸，并把半透明边缘二值化，保持像素画的硬边。
import AppKit

let args = CommandLine.arguments
guard args.count == 3 else {
    FileHandle.standardError.write("用法：slice-scene.swift <生成图目录> <输出目录>\n".data(using: .utf8)!)
    exit(64)
}
let src = URL(fileURLWithPath: args[1]), out = URL(fileURLWithPath: args[2])
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

struct Bitmap {
    let w: Int, h: Int
    var px: [UInt8]  // RGBA，非预乘
    init(_ img: CGImage) {
        w = img.width; h = img.height
        px = [UInt8](repeating: 0, count: w * h * 4)
        let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    }
    // 位图内存的第 0 行就是图像顶部
    func alpha(_ x: Int, _ y: Int) -> UInt8 { px[(y * w + x) * 4 + 3] }
}

func load(_ name: String) -> CGImage {
    let url = src.appendingPathComponent(name)
    guard let img = NSImage(contentsOf: url)?.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        FileHandle.standardError.write("读不到 \(url.path)\n".data(using: .utf8)!); exit(1)
    }
    return img
}

/// 一维投影上找连续的非空区间，间隔小于 gap 的合并
func runs(_ filled: [Bool], gap: Int) -> [Range<Int>] {
    var out: [Range<Int>] = []
    var start: Int? = nil, lastFilled = -1_000_000
    for (i, f) in filled.enumerated() where f {
        if let s = start, i - lastFilled > gap { out.append(s..<(lastFilled + 1)); start = i }
        if start == nil { start = i }
        lastFilled = i
    }
    if let s = start { out.append(s..<(lastFilled + 1)) }
    return out
}

/// 返回每一带里的各格（图像坐标，从上往下）
func cells(_ bm: Bitmap, threshold: UInt8 = 60, gap: Int = 24) -> [[CGRect]] {
    var rowFilled = [Bool](repeating: false, count: bm.h)
    for y in 0..<bm.h { for x in stride(from: 0, to: bm.w, by: 2) where bm.alpha(x, y) > threshold { rowFilled[y] = true; break } }
    return runs(rowFilled, gap: gap).map { band in
        var colFilled = [Bool](repeating: false, count: bm.w)
        for x in 0..<bm.w { for y in band where bm.alpha(x, y) > threshold { colFilled[x] = true; break } }
        return runs(colFilled, gap: gap).map { col in
            // 这一格里再收紧上下边界
            var top = band.upperBound, bottom = band.lowerBound
            for y in band { for x in col where bm.alpha(x, y) > threshold { top = min(top, y); bottom = max(bottom, y); break } }
            return CGRect(x: col.lowerBound, y: top, width: col.count, height: bottom - top + 1)
        }
    }
}

/// 裁一格、缩放、二值化 alpha，写成 PNG
func emit(_ img: CGImage, _ rect: CGRect, scale: CGFloat, name: String, hardAlpha: Bool = true) {
    guard let crop = img.cropping(to: rect) else { return }
    let w = max(1, Int((rect.width * scale).rounded())), h = max(1, Int((rect.height * scale).rounded()))
    var px = [UInt8](repeating: 0, count: w * h * 4)
    let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    ctx.draw(crop, in: CGRect(x: 0, y: 0, width: w, height: h))
    if hardAlpha {
        for i in stride(from: 0, to: px.count, by: 4) {
            let a = Int(px[i + 3])
            if a < 110 { px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 0; continue }
            // 预乘还原后改成完全不透明
            for k in 0..<3 { px[i + k] = UInt8(min(255, Int(px[i + k]) * 255 / max(a, 1))) }
            px[i + 3] = 255
        }
    }
    let outCtx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                           space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let rep = NSBitmapImageRep(cgImage: outCtx.makeImage()!)
    try! rep.representation(using: .png, properties: [:])!.write(to: out.appendingPathComponent(name + ".png"))
    print("\(name).png  \(w)×\(h)")
}

// 角色表：6 行 × 3 列
let chars = load("sheet-characters.png")
let charCells = cells(Bitmap(chars))
let charNames = [
    ["claude-idle", "claude-work", "claude-sleep"],
    ["codex-idle", "codex-work", "codex-sleep"],
    ["cursor-idle", "cursor-work", "cursor-sleep"],
    ["deepseek-idle", "deepseek-work", "deepseek-sleep"],
    ["mini-idle", "mini-work", "mini-done"],
    ["meerkat-idle", "meerkat-alert", "meerkat-look"],
]
guard charCells.count == 6, charCells.allSatisfy({ $0.count == 3 }) else {
    print("角色表切出来的格子数不对：\(charCells.map(\.count))"); exit(2)
}
for (r, row) in charCells.enumerated() {
    // 鲸鱼带尾巴和水花，看起来偏大；小帮手要比主角小一圈
    let scale: CGFloat = [3: 0.27, 4: 0.24, 5: 0.3][r] ?? 0.32
    for (c, rect) in row.enumerated() { emit(chars, rect, scale: scale, name: charNames[r][c]) }
}

// 道具表：4 带，每带 2 格
let props = load("sheet-props.png")
let propCells = cells(Bitmap(props))
let propNames = [["desk-main", "desk"], ["desk-side", "crate"], ["lamp", "plant"], ["inbox", "card"]]
let propScale: [String: CGFloat] = ["desk-main": 0.25, "desk": 0.25, "desk-side": 0.2, "crate": 0.16,
                                    "lamp": 0.22, "plant": 0.2, "inbox": 0.12, "card": 0.1]
guard propCells.count == 4, propCells.allSatisfy({ $0.count == 2 }) else {
    print("道具表切出来的格子数不对：\(propCells.map(\.count))"); exit(2)
}
for (r, row) in propCells.enumerated() {
    for (c, rect) in row.enumerated() { let n = propNames[r][c]; emit(props, rect, scale: propScale[n]!, name: n) }
}

// 房间：方图裁成 16:9，缩到 384×216，保持不透明
let room = load("room-bg.png")
let cropH = CGFloat(room.width) * 9 / 16
let top = CGFloat(room.height) * 0.07
emit(room, CGRect(x: 0, y: top, width: CGFloat(room.width), height: cropH), scale: 384 / CGFloat(room.width), name: "room", hardAlpha: false)
