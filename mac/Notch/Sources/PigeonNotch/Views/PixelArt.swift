import SwiftUI

// 各家 agent 的像素标志和信鸽，照网页 web/art/brand.js 的网格原样搬过来。字符对应调色板，'.' 是透明。

enum PixelArt {
    struct Sprite {
        var grid: [String]
        var palette: [Character: UInt32]
    }

    static let logos: [AgentKind: Sprite] = [
        // Claude Code：橙色的小螃蟹 Clawd
        .claude: Sprite(grid: [
            "................", "................", "................",
            "...OOOOOOOOOO...", "...OOOOOOOOOO...", "...OOKOOOOKOO...", "...OOKOOOOKOO...",
            ".OOOOOOOOOOOOOO.", ".OOOOOOOOOOOOOO.", "...OOOOOOOOOO...", "...OOOOOOOOOO...",
            "...O.O....O.O...", "...O.O....O.O...", "................", "................", "................",
        ], palette: ["O": 0xd97757, "K": 0x1f1410]),
        // Codex：蓝紫色圆团，中间一个终端提示符 >_
        .codex: Sprite(grid: [
            "................", ".....aaaaaa.....", "...aaaaaaaaaa...", "..aaaaaaaaaaaa..",
            ".abbbbbbbbbbbba.", ".bbWWbbbbbbbbbb.", "bbbbWWbbbbbbbbbb", "bbbbbWWbbbbbbbbb",
            "bbbbWWbbbbbbbbbb", "vbbWWbbbWWWWbbbv", ".vvvvvvvvvvvvvv.", ".vvvvvvvvvvvvvv.",
            "..vvvvvvvvvvvv..", "...vvvvvvvvvv...", ".....vvvvvv.....", "................",
        ], palette: ["a": 0x9cc0ff, "b": 0x7b93ff, "v": 0x8c6cf6, "W": 0xffffff]),
        // Cursor：实心的六边形立方体，中间挖空一块向下的三角。刘海是黑底，用白色
        .cursor: Sprite(grid: [
            ".......KK.......", ".....KKKKKK.....", "...KKKKKKKKKK...", ".KKKKKKKKKKKKKK.",
            ".KK..........KK.", ".KKKK........KK.", ".KKKKKK......KK.", ".KKKKKKK....KKK.",
            ".KKKKKKK....KKK.", ".KKKKKKK...KKKK.", ".KKKKKKK...KKKK.", ".KKKKKKK..KKKKK.",
            ".KKKKKKK.KKKKKK.", "...KKKKK.KKKK...", ".....KKKKKK.....", ".......KK.......",
        ], palette: ["K": 0xe9e6df]),
        // DeepSeek：往上翘尾巴的蓝鲸鱼
        .deepseek: Sprite(grid: [
            "................", "................", "...........B..B.", "...........BBBB.",
            "............BB..", "....BBBBBB..BB..", "..BBBBBBBBBBBB..", ".BBBBBBBBBBBBB..",
            ".BWBBBBBBBBBBB..", ".BBBBBBBBBBBB...", ".LLLLLBBBBBBB...", "..LLLLLLBBBB....",
            "....LLLLL.......", "................", "................", "................",
        ], palette: ["B": 0x4d6bfe, "L": 0xa9b8ff, "W": 0xffffff, "S": 0x9fd4ff]),
        // Antigravity：往上拱起的一道弧，左下黄绿、顶上蓝、右下紫红
        .antigravity: Sprite(grid: [
            "................", "................", "......BBBB......", ".....BBBBBB.....",
            "....BBB..BBB....", "....CB....BP....", "...CCB....BPP...", "...CC......PP...",
            "..GCC......PPR..", "..GG........RR..", "..GG........RR..", ".YGG........RRO.",
            ".YY..........OO.", ".YY..........OO.", "................", "................",
        ], palette: ["B": 0x4285f4, "C": 0x3fb0e8, "G": 0x34a853, "Y": 0xfbbc05, "P": 0xa142f4, "R": 0xea4335, "O": 0xff8a3d]),
    ]

    // 信鸽：朝右飞，脖子一圈绿紫的光泽，嘴上一点白，脚下挂一封封了红蜡的信。身子用发信那个 agent 的颜色
    static let pigeonBody = [
        "......................", "..............BBB.....", ".............BBBBBc...", ".............BBBkBYY..",
        ".............NNPBB....", "TT.........BBNPNBB....", "TTTT..BBBBBBBBBBBB....", "DTTTBBBBBBBBBBBBB.....",
        "DDTTBBBBBBBBBBBBB.....", "...DBBBBBBBBBBBB......", ".....LLLLLLLLLL.......", "......LLLLLLLL........",
    ]
    static let pigeonWing = [
        "......................", "......................", "......................", "......................",
        "......WWWWWW..........", "...WWWWWWWWWW.........", ".DDWbbbWbbbWW.........", "DDDWWWWWWWWW..........",
        ".DDDDWWWW.............",
    ]
    static let pigeonLetter = [
        ".........F..F.........", ".......EEEEEEEE.......", ".......EeEEEEeE.......", ".......EEeSSeEe.......",
        ".......eeeeeeee.......",
    ]

    static func pigeonPalette(_ base: UInt32) -> [Character: UInt32] {
        let dark = mix(base, 0x1a1714, 0.42)
        return ["B": base, "L": mix(base, 0xffffff, 0.5), "W": mix(base, 0xffffff, 0.28), "b": dark, "D": dark,
                "T": mix(base, 0x1a1714, 0.18), "N": 0x4fc3b0, "P": 0x9a7bd0, "k": 0x17140f, "Y": 0xf2b84b,
                "c": 0xf6f1e7, "F": 0xe8918f, "E": 0xfffaf0, "e": 0xcbb894, "S": 0xd94a3d]
    }

    static func mix(_ a: UInt32, _ b: UInt32, _ t: Double) -> UInt32 {
        func ch(_ v: UInt32, _ s: UInt32) -> Double { Double((v >> s) & 0xff) }
        func m(_ s: UInt32) -> UInt32 { UInt32((ch(a, s) * (1 - t) + ch(b, s) * t).rounded()) << s }
        return m(16) | m(8) | m(0)
    }

    /// 把网格画进 ctx，原点在 (ox, oy)，一格 cell 大
    static func draw(_ grid: [String], palette: [Character: UInt32], in ctx: inout GraphicsContext, ox: CGFloat = 0, oy: CGFloat = 0, cell: CGFloat) {
        for (y, row) in grid.enumerated() {
            let chars = Array(row)
            var x = 0
            while x < chars.count {
                let c = chars[x]
                var e = x
                while e < chars.count && chars[e] == c { e += 1 }
                if let hex = palette[c] {
                    let r = CGRect(x: ox + CGFloat(x) * cell, y: oy + CGFloat(y) * cell, width: CGFloat(e - x) * cell, height: cell)
                    ctx.fill(Path(r), with: .color(Color(hex: hex)))
                }
                x = e
            }
        }
    }
}

/// 一家 agent 的像素标志。you 画一个带“你”字的小圆
struct AgentLogo: View {
    var agent: AgentKind
    var size: CGFloat = 16

    var body: some View {
        Group {
            if let s = PixelArt.logos[agent] {
                Canvas { ctx, sz in
                    PixelArt.draw(s.grid, palette: s.palette, in: &ctx, cell: sz.width / 16)
                }
            } else {
                Circle().fill(Theme.chipOn)
                    .overlay(Text("你").font(.system(size: size * 0.55, weight: .semibold)).foregroundStyle(Theme.text))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// 飞着的信鸽。phase 0…1 是扇翅膀的进度（翅膀绕肩膀上下转，身子跟着一起一伏）
struct PigeonSprite: View {
    var color: UInt32
    var phase: Double
    var letter = true

    var body: some View {
        Canvas { ctx, size in
            let cell = size.width / 23
            let pal = PixelArt.pigeonPalette(color)
            let bob = (0.5 - 0.5 * cos(phase * 2 * .pi)) * 0.7 * cell
            var body = ctx
            body.translateBy(x: cell, y: 5 * cell + bob)
            if letter { PixelArt.draw(PixelArt.pigeonLetter, palette: pal, in: &body, oy: 12 * cell, cell: cell) }
            PixelArt.draw(PixelArt.pigeonBody, palette: pal, in: &body, cell: cell)
            // 翅膀：从 44° 扇到 -26°，绕肩膀 (12, 6.5)
            let angle = 44 - 70 * (0.5 - 0.5 * cos(phase * 2 * .pi))
            var wing = body
            wing.translateBy(x: 12 * cell, y: 6.5 * cell)
            wing.rotate(by: .degrees(angle))
            wing.translateBy(x: -12 * cell, y: -6.5 * cell)
            PixelArt.draw(PixelArt.pigeonWing, palette: pal, in: &wing, cell: cell)
        }
        .aspectRatio(23.0 / 22.0, contentMode: .fit)
        .accessibilityHidden(true)
    }
}
