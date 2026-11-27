import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HOTKEY, normalizeHotkey, formatHotkey, keyEventToSpec } from '../src/core/hotkey.js';

test('快捷键规格：标准化与 macOS 符号展示', () => {
  assert.equal(DEFAULT_HOTKEY, 'opt+space');
  assert.equal(normalizeHotkey('Option+Space'), 'opt+space');
  assert.equal(normalizeHotkey('Cmd+Shift+P'), 'shift+cmd+p');
  assert.equal(normalizeHotkey('shift+a'), '', '只按 Shift 不行');
  assert.equal(normalizeHotkey('shift+f5'), 'shift+f5', 'F 键可以只配 Shift');
  assert.deepEqual(keyEventToSpec({ code: 'KeyA', key: 'A', shiftKey: true }), { status: 'no_mod' });
  assert.equal(normalizeHotkey('alt + control + F5'), 'ctrl+opt+f5');
  assert.equal(normalizeHotkey('space'), '');
  assert.equal(normalizeHotkey('opt+unknown'), '');
  assert.equal(formatHotkey('opt+space'), '⌥ 空格');
  assert.equal(formatHotkey('cmd+shift+p'), '⇧ ⌘ P');
  assert.equal(formatHotkey('ctrl+opt+return'), '⌃ ⌥ 回车');
  assert.equal(formatHotkey('invalid'), '⌥ 空格');
});

test('快捷键录制：处理取消、纯修饰键、无修饰键与 Option 字母码', () => {
  assert.equal(keyEventToSpec({ code: 'Escape', key: 'Escape' }).status, 'cancel');
  assert.equal(keyEventToSpec({ code: 'AltLeft', key: 'Alt', altKey: true }).status, 'modifier');
  assert.equal(keyEventToSpec({ code: 'KeyP', key: 'p' }).status, 'no_mod');
  assert.deepEqual(keyEventToSpec({ code: 'Space', key: ' ', altKey: true }), { status: 'ok', spec: 'opt+space' });
  // macOS 按住 Option+P 时 e.key 会是 'π'，必须优先按 e.code 识别
  assert.deepEqual(keyEventToSpec({ code: 'KeyP', key: 'π', altKey: true, shiftKey: true }), { status: 'ok', spec: 'opt+shift+p' });
  assert.deepEqual(keyEventToSpec({ code: 'F8', key: 'F8', metaKey: true }), { status: 'ok', spec: 'cmd+f8' });
});
