// 全局快捷键规格的解析、格式化和按键录制转换（和 mac/Sources/Pigeon/HotKey.swift 的 HotKeySpec 保持一致）。
export const DEFAULT_HOTKEY = 'opt+space';

const KEY_INFO = {
  space: { canonical: 'space', label: '空格' },
  return: { canonical: 'return', label: '回车' },
  enter: { canonical: 'return', label: '回车' },
  tab: { canonical: 'tab', label: 'Tab' },
  '-': { canonical: '-', label: '-' },
  '=': { canonical: '=', label: '=' },
  '[': { canonical: '[', label: '[' },
  ']': { canonical: ']', label: ']' },
  ';': { canonical: ';', label: ';' },
  "'": { canonical: "'", label: "'" },
  ',': { canonical: ',', label: ',' },
  '.': { canonical: '.', label: '.' },
  '/': { canonical: '/', label: '/' },
  '`': { canonical: '`', label: '`' },
  '\\': { canonical: '\\', label: '\\' },
};
for (const c of 'abcdefghijklmnopqrstuvwxyz0123456789') {
  KEY_INFO[c] = { canonical: c, label: c.toUpperCase() };
}
for (let i = 1; i <= 12; i++) {
  KEY_INFO[`f${i}`] = { canonical: `f${i}`, label: `F${i}` };
}

const MOD_ORDER = ['ctrl', 'opt', 'shift', 'cmd'];
const MOD_SYM = { ctrl: '⌃', opt: '⌥', shift: '⇧', cmd: '⌘' };
const MOD_ALIAS = {
  ctrl: 'ctrl', control: 'ctrl',
  opt: 'opt', alt: 'opt', option: 'opt',
  shift: 'shift',
  cmd: 'cmd', command: 'cmd', meta: 'cmd',
};

// 全局快捷键至少要带 ⌃、⌥、⌘ 里的一个：只按 ⇧ 加字母会把全系统的大写字母吃掉。F1–F12 例外
const strongEnough = (mods, key) => mods.some(m => m !== 'shift') || /^f([1-9]|1[0-2])$/.test(key);

export function normalizeHotkey(raw) {
  const parts = String(raw || '').split('+').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (parts.length < 2) return '';
  const keyTok = parts.at(-1);
  const key = KEY_INFO[keyTok];
  if (!key) return '';
  const mods = new Set();
  for (const m of parts.slice(0, -1)) {
    const k = MOD_ALIAS[m];
    if (!k) return '';
    mods.add(k);
  }
  if (!mods.size || !strongEnough([...mods], key.canonical)) return '';
  return [...MOD_ORDER.filter(m => mods.has(m)), key.canonical].join('+');
}

export function formatHotkey(raw) {
  const norm = normalizeHotkey(raw) || DEFAULT_HOTKEY;
  const parts = norm.split('+');
  const keyTok = parts.pop();
  const syms = parts.map(m => MOD_SYM[m]).filter(Boolean);
  return [...syms, KEY_INFO[keyTok]?.label || keyTok.toUpperCase()].join(' ');
}

const CODE_KEY = {
  Space: 'space',
  Enter: 'return',
  NumpadEnter: 'return',
  Tab: 'tab',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Backslash: '\\',
};
const MOD_CODES = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);
const MOD_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

export function keyEventToSpec(e) {
  if (!e) return { status: 'unsupported' };
  const code = String(e.code || '');
  const rawKey = String(e.key || '');
  if (code === 'Escape' || rawKey === 'Escape') return { status: 'cancel' };
  if (MOD_CODES.has(code) || MOD_KEYS.has(rawKey)) return { status: 'modifier' };

  const mods = [];
  if (e.ctrlKey) mods.push('ctrl');
  if (e.altKey) mods.push('opt');
  if (e.shiftKey) mods.push('shift');
  if (e.metaKey) mods.push('cmd');
  if (!mods.length) return { status: 'no_mod' };

  let keyTok = CODE_KEY[code] || '';
  if (!keyTok && /^Key([A-Z])$/.test(code)) keyTok = RegExp.$1.toLowerCase();
  if (!keyTok && /^Digit([0-9])$/.test(code)) keyTok = RegExp.$1;
  if (!keyTok && /^F([1-9]|1[0-2])$/.test(code)) keyTok = `f${RegExp.$1}`;
  if (!keyTok) {
    const lk = rawKey.toLowerCase();
    if (lk === ' ') keyTok = 'space';
    else if (KEY_INFO[lk]) keyTok = KEY_INFO[lk].canonical;
  }
  if (!keyTok || !KEY_INFO[keyTok]) return { status: 'unsupported' };
  if (!strongEnough(mods, KEY_INFO[keyTok].canonical)) return { status: 'no_mod' };
  return { status: 'ok', spec: [...mods, KEY_INFO[keyTok].canonical].join('+') };
}
