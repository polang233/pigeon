#!/usr/bin/env swift
// 从标志源文件 assets/brand/pigeon-logo.svg 生成各个场景要用的版本。改了标志以后跑一遍：
//   swift mac/scripts/make-brand.swift
//
// 源文件是白底满版、翅膀外面描一圈白边当缝。透明底时这圈白边会露出来，深色底上黑鸽子又看不见，
// 所以这里把各部分拆出来重新拼：缝用遮罩挖成真的空，深色底换一套颜色，单色只留一个颜色加挖空。
//
// 生成：
//   assets/brand/pigeon-glyph.svg        透明底，浅色背景上用
//   assets/brand/pigeon-glyph-dark.svg   透明底，深色背景上用（浅色鸽子）
//   assets/brand/pigeon-mono.svg         单色（currentColor），翅膀、眼睛、翅斑挖空；印章、刻字、菜单栏这类只有一种颜色的地方用
//   assets/brand/pigeon-logo-dark.svg    深色满版（鸽子按图标的大小摆）
//   assets/brand/pigeon-app-icon.svg     白底满版，鸽子按图标的大小摆（make-icon.swift 读它画 .icns）
//   mac/Resources/MenuBarIcon.svg        菜单栏模板图（小尺寸专用的单色：描粗、缝加宽、眼睛放大）
//   mac/Resources/Pigeon.icon/           macOS 26 起的分层应用图标（浅色、深色、着色、透明几种外观由系统按层生成）
//   web/assets/mark.png                  侧栏标志的遮罩（单色）
//   web/assets/favicon.png               网页图标
import AppKit
import Foundation

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../..").standardizedFileURL
func path(_ p: String) -> URL { root.appendingPathComponent(p) }
let source = try String(contentsOf: path("assets/brand/pigeon-logo.svg"), encoding: .utf8)

// MARK: 拆出各部分的路径

func d(id: String) -> String {
    let pattern = id == "tail"
        ? #"<g id="tail"[^>]*>\s*<path[^>]*\sd="([^"]+)""#
        : #"<path id="\#(id)"[^>]*\sd="([^"]+)""#
    let re = try! NSRegularExpression(pattern: pattern)
    guard let m = re.firstMatch(in: source, range: NSRange(source.startIndex..., in: source)),
          let r = Range(m.range(at: 1), in: source) else { fatalError("标志里找不到 \(id)") }
    return String(source[r])
}
let tail = d(id: "tail"), body = d(id: "body"), wing = d(id: "wing-shape"), bars = d(id: "wing-bars")
let cere = d(id: "cere"), eye = d(id: "eye"), tube = d(id: "tube")
/// 翅膀外面那圈缝的宽度（源文件里白边的描边宽）
let gap = "29.3"

// MARK: 配色

struct Palette { var body, wing, bars, cere, eye, tube: String }
let light = Palette(body: "#242426", wing: "#d2d4d6", bars: "#242426", cere: "#c9cbcd", eye: "#ffffff", tube: "#e3262a")
/// 深色底：鸽子换成浅色，翅膀压暗一档，眼睛反过来用深色
let dark = Palette(body: "#ececee", wing: "#77797e", bars: "#ececee", cere: "#9a9ca1", eye: "#1c1c1e", tube: "#ff453a")
let darkBg = "#1c1c1e"

// MARK: 拼 SVG

func head(_ box: String = "0 0 1024 1024") -> String { #"<svg xmlns="http://www.w3.org/2000/svg" viewBox="\#(box)">"# }
/// 只框住鸽子本身（透明、单色版本用；边距由用的地方自己定）
let tightBox = "97 103 830 830"

/// 放进图标方块时：源文件里鸽子占满画布的八成，放进图标显得挤，缩到 0.88（鸽子约占七成）。
/// 它的重心偏左下（头和身子在左，右上空着），整体往右上挪一点，看起来才居中
let iconScale = 0.88, iconShift = (x: 28.0, y: -10.0)
let fitIcon = "translate(\(512 + iconShift.x) \(512 + iconShift.y)) scale(\(iconScale)) translate(-512 -512)"
let note = "<!-- 由 mac/scripts/make-brand.swift 从 pigeon-logo.svg 生成，别手改 -->"

/// 把翅膀外面一圈缝挖空的遮罩
func gapMask(_ id: String) -> String {
    """
      <mask id="\(id)" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
        <rect width="1024" height="1024" fill="#fff"/>
        <path fill="#000" stroke="#000" stroke-width="\(gap)" stroke-linejoin="round" d="\(wing)"/>
      </mask>
    """
}

/// 彩色。有底色时是图标用的满版（鸽子按图标的大小摆），没有底色时是透明底、紧框
func colorGlyph(_ p: Palette, background: String? = nil) -> String {
    """
    \(head(background == nil ? tightBox : "0 0 1024 1024"))
      \(note)
      <defs>
    \(gapMask("gap"))
      </defs>
    \(background.map { "  <rect width=\"1024\" height=\"1024\" fill=\"\($0)\"/>\n" } ?? "")  <g\(background == nil ? "" : " transform=\"\(fitIcon)\"")>
      <g fill="\(p.body)" mask="url(#gap)">
        <path d="\(tail)"/>
        <path d="\(body)"/>
      </g>
      <path fill="\(p.wing)" d="\(wing)"/>
      <path fill="\(p.bars)" d="\(bars)"/>
      <path fill="\(p.cere)" d="\(cere)"/>
      <path fill="\(p.eye)" d="\(eye)"/>
      <path fill="\(p.tube)" d="\(tube)"/>
      </g>
    </svg>

    """
}

/// 单色：身体和翅膀同一个颜色，中间的缝、翅斑、眼睛、鼻瘤挖空，信筒四周留一道细缝和腿分开
func mono(fill: String) -> String {
    """
    \(head(tightBox))
      \(note)
      <defs>
        <mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
          <rect width="1024" height="1024" fill="#fff"/>
          <path fill="#000" stroke="#000" stroke-width="\(gap)" stroke-linejoin="round" d="\(wing)"/>
          <path fill="#fff" d="\(wing)"/>
          <path fill="#000" d="\(bars)"/>
          <path fill="#000" d="\(cere)"/>
          <path fill="#000" d="\(eye)"/>
          <path fill="#000" stroke="#000" stroke-width="16" stroke-linejoin="round" d="\(tube)"/>
          <path fill="#fff" d="\(tube)"/>
        </mask>
      </defs>
      <g fill="\(fill)" mask="url(#cut)">
        <path d="\(tail)"/>
        <path d="\(body)"/>
        <path d="\(wing)"/>
        <path d="\(tube)"/>
      </g>
    </svg>

    """
}

/// 小尺寸单色（菜单栏、侧栏 18 点左右）。照原样缩小时，翅膀的缝只有半个像素宽、眼睛两个像素，
/// 边缘全是半透明的灰，看着发虚。这里专门改粗：整体描粗一圈，缝加宽到一个多像素，眼睛放大，
/// 去掉翅斑、鼻瘤和信筒（信筒和两条腿会糊成一团）这些到这个尺寸只剩一两个像素的细节
func monoSmall(fill: String) -> String {
    let eyeCenter = "271.6 199.5"
    return """
    \(head(tightBox))
      \(note)
      <defs>
        <mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
          <rect width="1024" height="1024" fill="#fff"/>
          <path fill="#000" stroke="#000" stroke-width="92" stroke-linejoin="round" d="\(wing)"/>
          <path fill="#fff" d="\(wing)"/>
          <path fill="#000" transform="translate(\(eyeCenter)) scale(1.7) translate(-\(eyeCenter.replacingOccurrences(of: " ", with: " -")))" d="\(eye)"/>
        </mask>
      </defs>
      <g fill="\(fill)" stroke="\(fill)" stroke-width="18" stroke-linejoin="round" mask="url(#cut)">
        <path d="\(tail)"/>
        <path d="\(body)"/>
        <path d="\(wing)"/>
      </g>
    </svg>

    """
}

/// 只有一块的图层（分层图标用）：身体要挖掉翅膀外面的缝
func layer(_ dPath: String, fill: String, cutGap: Bool = false) -> String {
    """
    \(head())
      <defs>
    \(gapMask("gap"))
      </defs>
      <g transform="\(fitIcon)"><path fill="\(fill)"\(cutGap ? " mask=\"url(#gap)\"" : "") d="\(dPath)"/></g>
    </svg>

    """
}

func write(_ text: String, _ rel: String) throws {
    let url = path(rel)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try text.write(to: url, atomically: true, encoding: .utf8)
    print("  \(rel)")
}

// MARK: 画成 PNG

func png(svg: String, side: Int, tile: Bool = false) -> Data {
    guard let image = NSImage(data: Data(svg.utf8)) else { fatalError("SVG 读不了") }
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8, samplesPerPixel: 4,
                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: side, height: side)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high
    var rect = NSRect(x: 0, y: 0, width: side, height: side)
    if tile {
        // 网页图标：白色圆角方块，比例跟应用图标一样（1024 里边距 100、圆角 185）
        let k = CGFloat(side) / 1024
        rect = rect.insetBy(dx: 100 * k, dy: 100 * k)
        let shape = NSBezierPath(roundedRect: rect, xRadius: 185 * k, yRadius: 185 * k)
        NSColor.white.setFill()
        shape.fill()
        shape.addClip()
    }
    image.draw(in: rect)
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

func write(_ data: Data, _ rel: String) throws {
    let url = path(rel)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: url)
    print("  \(rel)")
}

// MARK: 分层应用图标（Icon Composer 的 .icon）

func hex(_ s: String) -> String {
    let v = Int(s.dropFirst(), radix: 16)!
    let c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map { String(format: "%.5f", Double($0) / 255) }
    return "srgb:\(c.joined(separator: ",")),1.00000"
}

/// 一层：浅色外观用 light 的颜色，深色外观换成 dark 的颜色。着色、透明外观由系统按明暗自己算
func iconLayer(_ name: String, _ keyPath: KeyPath<Palette, String>) -> [String: Any] {
    [
        "name": name,
        "image-name": "\(name).svg",
        "fill-specializations": [
            ["value": ["solid": hex(light[keyPath: keyPath])]],
            ["appearance": "dark", "value": ["solid": hex(dark[keyPath: keyPath])]],
            // 着色外观按明暗换成单一色调：用深色那套（浅鸽子），不然深色身体在深色底上看不见
            ["appearance": "tinted", "value": ["solid": hex(dark[keyPath: keyPath])]],
        ],
    ]
}

func writeIcon() throws {
    let dir = "mac/Resources/Pigeon.icon"
    try? FileManager.default.removeItem(at: path(dir))
    // 图层的颜色由 icon.json 定，SVG 里只要形状
    try write(layer(body + " " + tail, fill: "#000", cutGap: true), "\(dir)/Assets/body.svg")
    try write(layer(wing, fill: "#000"), "\(dir)/Assets/wing.svg")
    try write(layer(bars, fill: "#000"), "\(dir)/Assets/bars.svg")
    try write(layer(cere, fill: "#000"), "\(dir)/Assets/cere.svg")
    try write(layer(eye, fill: "#000"), "\(dir)/Assets/eye.svg")
    try write(layer(tube, fill: "#000"), "\(dir)/Assets/tube.svg")
    // 列表里靠前的在上面
    let json: [String: Any] = [
        "fill-specializations": [
            ["value": ["solid": hex("#ffffff")]],
            ["appearance": "dark", "value": ["solid": hex(darkBg)]],
        ],
        "groups": [
            [
                "name": "鸽子",
                "layers": [
                    iconLayer("tube", \.tube), iconLayer("eye", \.eye), iconLayer("cere", \.cere),
                    iconLayer("bars", \.bars), iconLayer("wing", \.wing), iconLayer("body", \.body),
                ],
                "shadow": ["kind": "neutral", "opacity": 0.35],
                "translucency": ["enabled": false, "value": 0.5],
            ],
        ],
        "supported-platforms": ["squares": ["macOS"]],
    ]
    let data = try JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys])
    try write(data, "\(dir)/icon.json")
}

print("生成：")
try write(colorGlyph(light), "assets/brand/pigeon-glyph.svg")
try write(colorGlyph(dark), "assets/brand/pigeon-glyph-dark.svg")
try write(colorGlyph(dark, background: darkBg), "assets/brand/pigeon-logo-dark.svg")
try write(mono(fill: "currentColor"), "assets/brand/pigeon-mono.svg")
try write(colorGlyph(light, background: "#ffffff"), "assets/brand/pigeon-app-icon.svg")
try write(monoSmall(fill: "#000"), "mac/Resources/MenuBarIcon.svg")
try writeIcon()
try write(png(svg: monoSmall(fill: "#fff"), side: 72), "web/assets/mark.png")
try write(png(svg: colorGlyph(light, background: "#ffffff"), side: 64, tile: true), "web/assets/favicon.png")

// 旧系统用的 .icns 由 make-icon.swift 从 pigeon-app-icon.svg 画
let icns = Process()
icns.executableURL = URL(fileURLWithPath: "/usr/bin/env")
icns.arguments = ["swift", path("mac/scripts/make-icon.swift").path]
try icns.run()
icns.waitUntilExit()
