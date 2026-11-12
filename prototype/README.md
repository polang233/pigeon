# Pigeon 新界面原型

用来确认新界面的结构和交互。全部是示例数据，不连任何服务，按钮大多只改页面上的状态。方案和进度见 [`docs/REDESIGN.md`](../docs/REDESIGN.md)。

## 怎么看

在仓库根目录起一个静态服务，然后打开 <http://127.0.0.1:5189>：

```bash
python3 -m http.server 5189 --bind 127.0.0.1 --directory prototype
```

## 文件

| 文件 | 内容 |
|---|---|
| `index.html` | 页面骨架：假的菜单栏和刘海、窗口、侧栏 |
| `app.css` | 全部样式。颜色只留给 agent 身份和状态，明暗两套 |
| `app.js` | 示例数据和五个页面的绘制：指挥台、任务、分派规则、接入、刘海与侧边条 |
| `art/` | 指向 `web/js/sprites.js` 和 `web/js/loft-art.js` 的软链接，办公室和鸽舍样式用它们画 |

## 示例数据怎么改

都在 `app.js` 开头：

- `S` 是对话。`lead: true` 是指挥；`via: 'codex'` 表示这个对话要经那台设备上的 Codex 带起；`parent: 's6'` 表示它是 `s6` 拆出来的子对话。
- `T` 是任务，`state` 取 `confirm`、`flying`、`home`、`refused`、`lost`。
- `RULES` 是分派规则，`CONN` 是接入页的内容。
