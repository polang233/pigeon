#!/usr/bin/env node
// PreToolUse hook：Claude 绕过 Pigeon 直接调 Codex 时拦下来，让它改用 pigeon.mjs。
// 包装层会关 stdin、计时、限并发、按设置决定临时任务、记任务记录，还会把进度报给 Pigeon 应用；直接跑就都没有了。
// 只拦"派活"和"送信"：Bash 里的 codex exec / codex e / codex queue，以及 Codex 的 MCP 派活工具。
// codex --version、codex login 之类照常放行；命令本身就是走 pigeon.mjs 或旧入口 meerkat-codex.mjs 的也放行。
// 设置里关掉"统一走包装层"（codex.routeAll = false）就不拦。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let p = {};
try { p = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

// 跨电脑发送前的确认框只能由人来点。命令里给这个变量赋值、想换掉确认程序的，一律拦下（不受下面“统一走包装层”开关影响）。
// 只认赋值（后面跟 =），单纯提到这个名字（比如 grep）不拦。
if ((p.tool_name || '') === 'Bash' && /PIGEON_CONFIRM_BIN=/.test(String(p.tool_input?.command || ''))) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: 'Pigeon：PIGEON_CONFIRM_BIN 只给测试用，不能用它跳过跨电脑发送前的确认。往另一台电脑发消息要用户自己在确认框里点“发出”。' },
  }));
  process.exit(0);
}

const support = path.join(os.homedir(), 'Library/Application Support');
let s = null;
for (const f of [path.join(support, 'Pigeon/settings.json'), path.join(support, 'Meerkat/settings.json')]) {
  try { s = JSON.parse(fs.readFileSync(f, 'utf8')); break; } catch {}
}
if (s && s.codex && s.codex.routeAll === false) process.exit(0);

const wrapper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pigeon.mjs');
const name = p.tool_name || '';
const cmd = String(p.tool_input?.command || '');
const viaPigeon = cmd.includes('pigeon.mjs') || cmd.includes('meerkat-codex.mjs');

let hit = '';
if (name === 'Bash' && !viaPigeon) {
  // 命令里出现独立的 codex 再跟 exec/e（派活）或 queue（送信）
  const m = /(^|[\s;&|(`])(\S*\/)?codex\s+(exec|e|queue)(\s|$)/.exec(cmd);
  if (m) hit = m[3] === 'queue' ? 'queue' : 'exec';
} else if (/^mcp__codex/i.test(name)) {
  // 只拦开新任务的工具；继续已有对话（codex-reply）放行
  if (!/reply/i.test(name)) hit = 'exec';
}
if (!hit) process.exit(0);

const reason = hit === 'queue'
  ? [
    'Pigeon：请不要直接用 codex queue 给 Codex 对话发消息，改用 pigeon send（用户在设置里开了"统一走包装层"）。',
    `node "${wrapper}" send --to <对话id或标题> "<要说的话>"（远程对话写成 <对话>@<设备>；先用 node "${wrapper}" lofts 看有哪些对话）`,
    'pigeon send 会记任务记录、在后台等回信、防止 agent 之间无限传话。详细流程见 pigeon:pigeon-post skill。',
  ]
  : [
    'Pigeon：请不要直接调用 Codex，改用包装层（用户在设置里开了"统一走包装层"）。',
    `把任务说明写进一个临时文件，然后用 Bash 在后台运行：node "${wrapper}" run --kind <image|code|review|general> --title "<短标题>" --cwd <项目目录> --brief-file <说明文件>`,
    '需要临时任务（不在 Codex 应用里留记录）时加 --temp。详细流程见 pigeon:codex-delegation skill。',
  ];

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason.join('\n') },
}));
process.exit(0);
