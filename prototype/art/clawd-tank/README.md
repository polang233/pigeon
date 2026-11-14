# Clawd 动画（来自 clawd-tank）

这一目录里的 SVG 动画原样取自 [marciogranzotto/clawd-tank](https://github.com/marciogranzotto/clawd-tank) 的 `assets/svg-animations/`（提交 `ee5c079c45a3`，2026-10-27），按 MIT 许可证使用，许可证全文见同目录的 `LICENSE`。只改过一处：每个 SVG 的 `<style>` 末尾加了一段 `@media (prefers-reduced-motion: reduce)`，系统设了“减少动态效果”时停下动画（2026-11-14，段落前有注释“Pigeon 加的”）。别的没动，裁切和缩放都在原型的 CSS 里做。

DeepSeek 的像素鲸鱼是照这些动画改的：动作和道具原样，只换了身子，放在 `../crew/`，由 `../../tools/crew_svg.py` 生成，每个文件开头都注明了出处。

Clawd 这个形象属于 Anthropic，MIT 许可证只涵盖 clawd-tank 作者画的这些动画，不涉及形象本身的权利。

| 文件 | 原型里什么时候用 |
|---|---|
| `clawd-working-conducting.svg` | 指挥在派活（activity 是 delegating） |
| `clawd-working-juggling.svg` | 不是指挥的在派活，同时有子代理在跑 |
| `clawd-working-typing.svg` | 在干活，activity 是 typing（或没写） |
| `clawd-working-thinking.svg` | 在干活，activity 是 thinking 或 reading |
| `clawd-working-building.svg` | 在干活，activity 是 building 或 testing |
| `clawd-notification.svg` | 有事等你确认（state 是 wait） |
| `clawd-happy.svg` | 刚完成 |
| `clawd-idle-living.svg` | 空闲 |
| `clawd-sleeping.svg` | 空闲，而且还没有任何对话 |
| `clawd-working-confused.svg` | 出错（对话的 state 是 error） |
