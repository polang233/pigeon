"""把 Codex 画的 3×3 九宫格动作表切成九张图，给原型的洋馆样式用。

用法（在仓库根目录）：python3 tools/slice_sheet.py <动作表.png> <输出目录>

- 背景如果不是透明的，从图的四边和格子之间的空白开始，把连在一起的近白色像素变成透明。
- 每格按内容裁到最小，再统一放到同样大小的画布上，水平居中、脚底对齐，切换状态时人物不会跳。
- 九格的顺序固定：stand 立绘、conduct 指挥/收到吩咐、work 干活、think 在想、wait 等你、done 完成、idle 空闲、sleep 睡着、error 出错。
"""
import sys
from collections import deque
from pathlib import Path

from PIL import Image

NAMES = ['stand', 'conduct', 'work', 'think', 'wait', 'done', 'idle', 'sleep', 'error']
WHITE = 238      # 三个通道都不低于这个值，算背景白
FRINGE = 205     # 紧挨着背景、比这个值还亮的边缘像素，按亮度给一点透明


def has_alpha(im):
    a = im.getchannel('A')
    w, h = im.size
    corners = [a.getpixel((0, 0)), a.getpixel((w - 1, 0)), a.getpixel((0, h - 1)), a.getpixel((w - 1, h - 1))]
    return min(corners) < 250


def knock_out_white(im):
    w, h = im.size
    px = im.load()
    bg = bytearray(w * h)
    q = deque()

    def is_white(x, y):
        r, g, b, a = px[x, y]
        return a < 10 or (r >= WHITE and g >= WHITE and b >= WHITE)

    # 种子：四条边，加上九宫格之间的两条横线、两条竖线附近
    seeds = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    for k in (1, 2):
        seeds += [(x, h * k // 3) for x in range(w)] + [(w * k // 3, y) for y in range(h)]
    for x, y in seeds:
        if not bg[y * w + x] and is_white(x, y):
            bg[y * w + x] = 1
            q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not bg[ny * w + nx] and is_white(nx, ny):
                bg[ny * w + nx] = 1
                q.append((nx, ny))
    for y in range(h):
        for x in range(w):
            if bg[y * w + x]:
                px[x, y] = (255, 255, 255, 0)
    # 边缘柔化：紧挨透明区域的很亮的像素，越亮越透明
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if bg[y * w + x]:
                continue
            if bg[y * w + x - 1] or bg[y * w + x + 1] or bg[(y - 1) * w + x] or bg[(y + 1) * w + x]:
                r, g, b, a = px[x, y]
                m = min(r, g, b)
                if m >= FRINGE:
                    px[x, y] = (r, g, b, int(a * (255 - m) / (255 - FRINGE)))
    return im


def main(src, out):
    im = Image.open(src).convert('RGBA')
    if not has_alpha(im):
        im = knock_out_white(im)
    w, h = im.size
    crops = []
    for k in range(9):
        cx, cy = k % 3, k // 3
        cell = im.crop((w * cx // 3, h * cy // 3, w * (cx + 1) // 3, h * (cy + 1) // 3))
        box = cell.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
        crops.append(cell.crop(box) if box else cell)
    cw = max(c.width for c in crops) + 8
    ch = max(c.height for c in crops) + 8
    Path(out).mkdir(parents=True, exist_ok=True)
    for name, c in zip(NAMES, crops):
        canvas = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
        canvas.paste(c, ((cw - c.width) // 2, ch - c.height - 4), c)
        canvas.save(Path(out) / f'{name}.png', optimize=True)
    print(f'{src} -> {out}: 9 张，每张 {cw}×{ch}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
