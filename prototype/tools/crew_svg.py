"""照着 clawd-tank 的 Clawd 动画，给 DeepSeek 生成同一套动作的像素鲸鱼 SVG。

用法：python3 prototype/tools/crew_svg.py

做法：读 art/clawd-tank/ 里的十个 SVG，动作、道具、关键帧全部保留，只换身体：
身体的橙色换成 DeepSeek 的蓝；躯干换成翘尾巴的胖鲸鱼，没有腿，身子一直到地面，最底下一块浅蓝的肚皮。
结果写到 art/crew/dsh-<动作>.svg。系统设了“减少动态效果”时动画停下。
重新生成后把 src/views/faces.js 里的 CREW_V 加一。clawd-tank 是 MIT 许可，改过的文件开头都注明了出处。
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'art' / 'clawd-tank'
OUT = ROOT / 'art' / 'crew'
CLAWD = '#DE886D'


def rects(rs):
    out = []
    for r in rs:
        x, y, w, h = r[:4]
        fill = f' fill="{r[4]}"' if len(r) > 4 and r[4] else ''
        out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}"{fill}/>')
    return ''.join(out)


# 坐标和 Clawd 一样：Clawd 的躯干占 x 2–13、y 6–13，腿在 y 13–15，两只手在 y 9–11
WHALE = dict(
    color='#4D6BFE',
    # 胖鲸鱼：身子一直到地面，最底下一块浅蓝的肚皮，右上翘起尾巴，右边一道暗边
    torso=[(3, 6, 9, 9), (2, 7, 11, 7), (12, 4, 1, 2), (11, 3, 3, 1), (10, 2, 2, 1), (13, 2, 2, 1),
           (12, 7, 1, 5, '#3550D8'),
           (3, 12, 9, 2, '#8EA1FF'), (4, 14, 7, 1, '#8EA1FF'),
           (4, 6, 3, 1, '#8197FF'), (10, 2, 1, 1, '#8197FF')],
    # 睡着时趴平的样子
    sploot=[(1, 11, 13, 4), (2, 10, 11, 1), (12, 8, 1, 2), (11, 7, 3, 1), (10, 6, 2, 1), (13, 6, 2, 1),
            (2, 13, 10, 2, '#8EA1FF'), (3, 10, 3, 1, '#8197FF')],
)
CREW = {'dsh': WHALE}

TORSO = re.compile(r'<rect (?:id="torso" )?x="2" y="6" width="11" height="7"(?: fill="#DE886D")?/>')
SPLOOT = re.compile(r'<rect id="torso-sploot" x="1" y="10" width="13" height="5"/>')
LEG = re.compile(r'(<rect id="[a-z-]*leg[a-z-]*"[^>]*?)(/>)')


def build(agent, spec, src):
    s = src.read_text()
    # 躯干自己带颜色：有的文件里躯干是靠外层分组上色的，有的是自己写 fill
    s, n = TORSO.subn(f'<g class="crew-torso" fill="{spec["color"]}">{rects(spec["torso"])}</g>', s)
    s, n2 = SPLOOT.subn(f'<g class="crew-torso" fill="{spec["color"]}">{rects(spec["sploot"])}</g>', s)
    assert n + n2 == 1, (agent, src.name, n, n2)
    s = s.replace(CLAWD, spec['color']).replace(CLAWD.lower(), spec['color'])
    # 鲸鱼没有腿
    s = LEG.sub(r'\1 opacity="0"\2', s)
    # 系统设了“减少动态效果”时停下动画（clawd-tank 的副本里已经加了这一段；没有就补上）
    if 'prefers-reduced-motion' not in s:
        s = s.replace('</style>', '@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; } }\n    </style>', 1)
    s = s.replace('<g id="legs" fill', '<g id="legs" opacity="0" fill')
    head = (f'<!-- {agent} 的形象：由 clawd-tank 的 {src.name} 改成（MIT，Copyright (c) Marcio Granzotto Rodrigues，'
            f'见 ../clawd-tank/LICENSE）。动作和道具原样保留，只换了身体。由 tools/crew_svg.py 生成，不要手改。 -->\n')
    return s.replace('<svg ', head + '<svg ', 1)


def main():
    OUT.mkdir(exist_ok=True)
    srcs = sorted(SRC.glob('clawd-*.svg'))
    for agent, spec in CREW.items():
        for src in srcs:
            (OUT / src.name.replace('clawd-', f'{agent}-')).write_text(build(agent, spec, src))
    print(f'{len(CREW) * len(srcs)} 个 SVG 写到 {OUT}')


if __name__ == '__main__':
    main()
