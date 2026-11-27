#!/usr/bin/env node
// UserPromptSubmit hook：用户这条消息涉及画图、Codex 或给别的 agent 传话时，提醒 Claude 用对应的 skill。
// 技能很多时，技能列表里后面的技能只剩名字、没有说明，光靠说明触发不可靠，所以在这里按关键词补一句。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ruleHits, hitLine, leadKeyOf } from './lib/hint.mjs';

let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch {}
let prompt = '';
try { prompt = String(JSON.parse(input).prompt || ''); } catch {}

const support = path.join(os.homedir(), 'Library/Application Support');
// 设置文件：PIGEON_SETTINGS_FILE 优先（和 lib/common.mjs 一致），否则读应用的设置文件
const settingsFiles = process.env.PIGEON_SETTINGS_FILE
  ? [process.env.PIGEON_SETTINGS_FILE]
  : [path.join(support, 'Pigeon/settings.json')];
let settings = {};
for (const f of settingsFiles) {
  try { settings = JSON.parse(fs.readFileSync(f, 'utf8')) || {}; break; } catch {}
}
const prefer = !(settings.codex && settings.codex.preferForImages === false);
const dset = settings.dispatch && typeof settings.dispatch === 'object' ? settings.dispatch : {};
// 加过默认规则以后，生图交给谁由规则管（“生图、改图”那条），不再看 codex.preferForImages
const seeded = !!dset.seeded;
// Antigravity 经命令行 agy 跑（装了、设置里也没改成走应用）
const agyVia = (settings.agents && settings.agents.antigravity && settings.agents.antigravity.via) || 'auto';
const agyBin = process.env.PIGEON_AGY_BIN !== undefined ? process.env.PIGEON_AGY_BIN : path.join(os.homedir(), '.local/bin/agy');
const agyCli = agyVia !== 'app' && !!agyBin && fs.existsSync(agyBin);
const claudeLeads = () => { const lead = settings.lead; return !lead || (lead.kind === 'agent' && lead.agent === 'claude'); };

// 应用写下的 dispatch.json：text 是分派规则整理成的那段提示，alive 是现在能交出去的对象
function dispatchFile() {
  try {
    const dir = process.env.PIGEON_HOME || path.join(os.homedir(), '.pigeon');
    return JSON.parse(fs.readFileSync(path.join(dir, 'dispatch.json'), 'utf8')) || {};
  } catch { return {}; }
}
const dfile = dispatchFile();
// 分派规则的提示：指挥是 Claude Code（没写 lead，或者写的就是 claude）时，每一轮都带上应用写下的那段文字。
// 只读本地文件，不联网；读不到、不是文字、是空的，就什么都不写。
function dispatchText() {
  if (!claudeLeads()) return '';
  return typeof dfile.text === 'string' ? dfile.text.trim() : '';
}

const lines = [];
// 很长的输入多半是粘贴的报告或日志，不是一句请求，这时不提醒，免得误触发（只管下面的关键词提醒，分派规则照写）
if (prompt.length <= 1200) keywordHints();
const dispatch = dispatchText();
if (dispatch) lines.push(dispatch);
if (lines.length) process.stdout.write(lines.join('\n') + '\n');
process.exit(0);

function keywordHints() {
  const mentionsCodex = /codex/i.test(prompt);
  // 分派规则的关键词命中了：这一轮点名交给谁（最多两条）
  let ruleHit = false;
  if (seeded && claudeLeads()) {
    const alive = Array.isArray(dfile.alive) ? dfile.alive : null;
    const names = (settings.devices && settings.devices.names) || {};
    // 同一个对象只点名一次（比如“做个提示音”做声音、听音频两条都命中，取排在前面的那条）
    const seen = new Set();
    for (const h of ruleHits(dset.rules, prompt, { alive, self: leadKeyOf(settings.lead) }).filter(h => !seen.has(h.r.to) && seen.add(h.r.to)).slice(0, 2)) { lines.push(hitLine(h, { names, text: prompt, agyCli })); ruleHit = true; }
  }
  const wantsImage = /(画|生成|做|出|来|设计|绘制).{0,12}(图|插画|插图|配图|头图|海报|图标|头像|背景|贴图|素材|logo|壁纸|封面)|(插画|插图|配图|头图|像素图|像素画|贴图|抠图|去背景|透明背景)|\b(image|illustration|icon|sprite|logo|wallpaper|banner)s?\b/i.test(prompt);
  const wantsPost = /(发|送|传|捎|带)(个|一?[条句张段])?(话|消息|纸条|信)|(告诉|转告|通知|问问|问一下)(一下)?.{0,8}(codex|那边|另一台|远程|那台|对话)|(让|叫|请|给).{0,6}(另一台|那台|远程)(电脑|机器|设备|windows|mac)/i.test(prompt);

  if (wantsImage && prefer && !seeded) {
    lines.push('Pigeon 提醒：这条消息需要生成或编辑图片。用户设置了“生图优先交给 Codex”，请先调用 pigeon:codex-delegation skill，按它的流程交给 Codex 生成，不要自己写脚本逐像素画，也不要用 SVG 凑。用户明确要矢量图、SVG 或 CSS 图形时除外。');
  }
  if (wantsPost) {
    lines.push('Pigeon 提醒：用户可能想给别的 agent（Codex 的某个对话，或另一台电脑上的对话）传话。确实要传话时，请先调用 pigeon:pigeon-post skill，按它的流程用 pigeon send / new 发消息、等回信，不要直接跑 codex queue。');
  } else if (mentionsCodex && !ruleHit && !(wantsImage && prefer && !seeded)) {
    lines.push('Pigeon 提醒：用户提到了 Codex。需要把活交给 Codex 时，请先调用 pigeon:codex-delegation skill；要给已有的 Codex 对话传话时，用 pigeon:pigeon-post skill。');
  }
}
