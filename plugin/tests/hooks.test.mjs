// Claude Code hook 脚本：route-codex.mjs 和 prompt-hint.mjs。HOME 指到临时目录，不读用户真实设置。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCRIPTS } from './helpers.mjs';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pigeon-hooks-'));
const runHook = (script, input, h = home) => {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, script)], { input: JSON.stringify(input), env: { ...process.env, HOME: h }, encoding: 'utf8' });
  return r.stdout;
};
const route = cmd => {
  const out = runHook('route-codex.mjs', { tool_name: 'Bash', tool_input: { command: cmd } });
  return out ? JSON.parse(out).hookSpecificOutput : null;
};

test('route-codex：拦下直接的 codex exec 和 codex queue', () => {
  const a = route('codex exec --json "hi"');
  assert.equal(a.permissionDecision, 'deny');
  assert.match(a.permissionDecisionReason, /pigeon\.mjs" run/);
  assert.match(a.permissionDecisionReason, /pigeon:codex-delegation/);
  assert.equal(route('/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex e hi').permissionDecision, 'deny');
  const q = route('codex queue --thread abc --message hi');
  assert.match(q.permissionDecisionReason, /pigeon\.mjs" send/);
});

test('route-codex：放行走 pigeon.mjs 的命令，以及无关命令', () => {
  assert.equal(route('node /x/plugin/scripts/pigeon.mjs run --kind image -- codex exec 画图'), null);
  assert.equal(route('codex --version'), null);
  assert.equal(route('codex login status'), null);
  assert.equal(route('echo executable'), null);
  assert.equal(runHook('route-codex.mjs', { tool_name: 'mcp__codex__codex-reply', tool_input: {} }), '');
  assert.match(runHook('route-codex.mjs', { tool_name: 'mcp__codex__codex', tool_input: {} }), /deny/);
});

test('route-codex：命令里想换掉确认程序的一律拦下，关掉统一走包装层也拦；只是提到名字不拦', () => {
  const swap = 'PIGEON_CONFIRM_BIN' + '=/usr/bin/true node /x/plugin/scripts/pigeon.mjs send --to a@b hi';
  const a = route(swap);
  assert.equal(a.permissionDecision, 'deny');
  assert.match(a.permissionDecisionReason, /确认框/);
  assert.equal(route('export PIGEON_CONFIRM_BIN' + ' =x'), null, '等号前有空格不是赋值，shell 里本来也不生效');
  assert.equal(route('grep -rn PIGEON_CONFIRM_BIN plugin/'), null);
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'pigeon-hooks-'));
  fs.mkdirSync(path.join(h, 'Library/Application Support/Pigeon'), { recursive: true });
  fs.writeFileSync(path.join(h, 'Library/Application Support/Pigeon/settings.json'), JSON.stringify({ codex: { routeAll: false } }));
  assert.match(runHook('route-codex.mjs', { tool_name: 'Bash', tool_input: { command: swap } }, h), /deny/);
});

test('route-codex：设置里关掉统一走包装层就不拦', () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'pigeon-hooks-'));
  fs.mkdirSync(path.join(h, 'Library/Application Support/Pigeon'), { recursive: true });
  fs.writeFileSync(path.join(h, 'Library/Application Support/Pigeon/settings.json'), JSON.stringify({ codex: { routeAll: false } }));
  assert.equal(runHook('route-codex.mjs', { tool_name: 'Bash', tool_input: { command: 'codex exec hi' } }, h), '');
});

test('prompt-hint：生图、Codex、传话分别提示对应的 skill', () => {
  const hint = prompt => runHook('prompt-hint.mjs', { prompt });
  assert.match(hint('帮我画一张登录页插图'), /pigeon:codex-delegation/);
  assert.match(hint('让 codex 看看这个函数'), /pigeon:codex-delegation/);
  assert.match(hint('告诉 Windows 那台电脑上的 Codex 跑一下构建'), /pigeon:pigeon-post/);
  assert.match(hint('给那边的对话发条消息'), /pigeon:pigeon-post/);
  assert.equal(hint('把这个函数改成 async'), '');
  assert.ok(!/Meerkat/.test(hint('帮我画一张图')));
});
