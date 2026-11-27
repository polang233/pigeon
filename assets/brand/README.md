# 标志

源文件只有一份：`pigeon-logo.svg`，白底满版，各部分按 id 分开（`tail`、`body`、`wing`、`cere`、`eye`、`tube`），翅膀和尾巴标了转动的支点，方便以后做动画。

其他版本都由 `swift mac/scripts/make-brand.swift` 从它生成，改了源文件以后跑一遍，别手改生成的文件。

| 文件 | 什么时候用 |
| --- | --- |
| `pigeon-logo.svg` | 源文件，鸽子占满画布的八成 |
| `pigeon-app-icon.svg` | 白底满版，鸽子缩到约七成、按重心往右上挪了一点，应用图标、头像用 |
| `pigeon-app-icon-rounded.png` | 512×512 圆角矩形应用图标预览图（含透明圆角与极淡内描边，由 `make-icon.swift` 矢量渲染），README 等暗/浅混合页面使用 |
| `pigeon-logo-dark.svg` | 深色满版，摆法同上 |
| `pigeon-glyph.svg` | 透明底，放在浅色背景上 |
| `pigeon-glyph-dark.svg` | 透明底，放在深色背景上，鸽子换成浅色 |
| `pigeon-mono.svg` | 单色（`currentColor`）：只能用一种颜色的地方，比如印章、刻字、贴纸。翅膀的缝、翅斑、眼睛、信筒边上的缝是挖空的，底色会透出来 |

透明底和单色的版本只框住鸽子本身，不留边距，边距由用的地方自己定。翅膀外面那圈缝是真的空，不是白边，放在任何颜色上都不会露出一圈白。

图标里鸽子为什么缩小、挪位：源文件里鸽子的外框占画布八成，放进图标方块显得挤；它的重心偏左下（头和身子在左，右上空着），外框居中时看着偏左下。参数在 `make-brand.swift` 的 `iconScale`、`iconShift`。

应用里用到的：

- 应用图标：`mac/Resources/Pigeon.icon`（macOS 26 起，分层，深色、着色、透明外观由系统生成）和 `mac/Resources/AppIcon.icns`（macOS 14、15，`swift mac/scripts/make-icon.swift` 生成）；
- 菜单栏：`mac/Resources/MenuBarIcon.svg`，小尺寸专用的单色模板图。照原样缩到 18 点，翅膀的缝只有半个像素宽，看着发虚，所以整体描粗、缝加宽、眼睛放大，去掉翅斑、鼻瘤和信筒；
- 网页：`web/assets/mark.png`（侧栏标志的遮罩）、`web/assets/favicon.png`。

`pigeon-mark.png`、`pigeon-stamp.png` 是 0.2 之前的旧标志，留着对照。
