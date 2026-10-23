#!/usr/bin/env node
// UserPromptSubmit hook：用户这条消息涉及画图或 Codex 时，提醒 Claude 用 codex-delegation skill。
// 技能很多时，技能列表里后面的技能只剩名字、没有说明，光靠说明触发不可靠，所以在这里按关键词补一句。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch {}
let prompt = '';
try { prompt = String(JSON.parse(input).prompt || ''); } catch {}

let prefer = true;
try {
  const s = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'Library/Application Support/Meerkat/settings.json'), 'utf8'));
  if (s && s.codex && s.codex.preferForImages === false) prefer = false;
} catch {}

const mentionsCodex = /codex/i.test(prompt);
const wantsImage = /(画|生成|做|出|来|设计|绘制).{0,12}(图|插画|插图|配图|头图|海报|图标|头像|背景|贴图|素材|logo|壁纸|封面)|(插画|插图|配图|头图|像素图|像素画|贴图|抠图|去背景|透明背景)|\b(image|illustration|icon|sprite|logo|wallpaper|banner)s?\b/i.test(prompt);

const lines = [];
if (wantsImage && prefer) {
  lines.push('Meerkat 提醒：这条消息需要生成或编辑图片。用户设置了“生图优先交给 Codex”，请先调用 meerkat:codex-delegation skill，按它的流程交给 Codex 生成，不要自己写脚本逐像素画，也不要用 SVG 凑。用户明确要矢量图、SVG 或 CSS 图形时除外。');
} else if (mentionsCodex) {
  lines.push('Meerkat 提醒：用户提到了 Codex。需要把活交给 Codex 时，请先调用 meerkat:codex-delegation skill，按它的流程调用。');
}
if (lines.length) process.stdout.write(lines.join('\n') + '\n');
process.exit(0);
