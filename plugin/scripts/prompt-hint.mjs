#!/usr/bin/env node
// UserPromptSubmit hook：用户这条消息涉及画图、Codex 或给别的 agent 传话时，提醒 Claude 用对应的 skill。
// 技能很多时，技能列表里后面的技能只剩名字、没有说明，光靠说明触发不可靠，所以在这里按关键词补一句。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch {}
let prompt = '';
try { prompt = String(JSON.parse(input).prompt || ''); } catch {}

const support = path.join(os.homedir(), 'Library/Application Support');
let prefer = true;
for (const f of [path.join(support, 'Pigeon/settings.json'), path.join(support, 'Meerkat/settings.json')]) {
  try {
    const s = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (s && s.codex && s.codex.preferForImages === false) prefer = false;
    break;
  } catch {}
}

// 很长的输入多半是粘贴的报告或日志，不是一句请求，这时不提醒，免得误触发
if (prompt.length > 1200) process.exit(0);

const mentionsCodex = /codex/i.test(prompt);
const wantsImage = /(画|生成|做|出|来|设计|绘制).{0,12}(图|插画|插图|配图|头图|海报|图标|头像|背景|贴图|素材|logo|壁纸|封面)|(插画|插图|配图|头图|像素图|像素画|贴图|抠图|去背景|透明背景)|\b(image|illustration|icon|sprite|logo|wallpaper|banner)s?\b/i.test(prompt);
const wantsPost = /(发|送|传|捎|带)(个|一?[条句张段])?(话|消息|纸条|信)|(告诉|转告|通知|问问|问一下)(一下)?.{0,8}(codex|那边|另一台|远程|那台|对话)|(让|叫|请|给).{0,6}(另一台|那台|远程)(电脑|机器|设备|windows|mac)/i.test(prompt);

const lines = [];
if (wantsImage && prefer) {
  lines.push('Pigeon 提醒：这条消息需要生成或编辑图片。用户设置了“生图优先交给 Codex”，请先调用 pigeon:codex-delegation skill，按它的流程交给 Codex 生成，不要自己写脚本逐像素画，也不要用 SVG 凑。用户明确要矢量图、SVG 或 CSS 图形时除外。');
}
if (wantsPost) {
  lines.push('Pigeon 提醒：用户可能想给别的 agent（Codex 的某个对话，或另一台电脑上的对话）传话。确实要传话时，请先调用 pigeon:pigeon-post skill，按它的流程用 pigeon send / new 送纸条、等回信，不要直接跑 codex queue。');
} else if (mentionsCodex && !(wantsImage && prefer)) {
  lines.push('Pigeon 提醒：用户提到了 Codex。需要把活交给 Codex 时，请先调用 pigeon:codex-delegation skill；要给已有的 Codex 对话传话时，用 pigeon:pigeon-post skill。');
}
if (lines.length) process.stdout.write(lines.join('\n') + '\n');
process.exit(0);
