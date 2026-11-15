// 界面里的线条小图标，和各家 agent 的像素标志（画法在 art/brand.js，它是普通脚本，挂在 window.Pigeon 上）。
// 返回的都是 raw()，可以直接插进 html``。
import { raw } from './html.js';

export const svg = d => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`);

// 键是图标名。mac、win、linux 是操作系统的图标，跟设备 id 无关
export const IC = {
  mac: 'M5 6h14v9H5zM3 18h18',
  win: 'M4 5h16v10H4zM9 19h6M12 15v4',
  linux: 'M4 5h16v11H4zM8 20h8M12 16v4M8 9l2 2-2 2M12 13h3',
  stage: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 2v3M12 19v3M2 12h3M19 12h3',
  tasks: 'M5 6h14M5 12h14M5 18h9',
  route: 'M4 12h5c3 0 3-6 6-6h5M9 12c3 0 3 6 6 6h5',
  conn: 'M9 7V3M15 7V3M7 7h10v5a5 5 0 01-10 0zM12 17v4',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  door: 'M6 21V4a1 1 0 011-1h10a1 1 0 011 1v17M3 21h18M14 12h.01',
  hook: 'M14 3v10a5 5 0 01-10 0v-2M4 11l3 3',
  plug: 'M9 7V3M15 7V3M7 7h10v5a5 5 0 01-10 0zM12 17v4',
  puzzle: 'M10 4a2 2 0 114 0v2h4v4h-2a2 2 0 100 4h2v4h-4v-2a2 2 0 10-4 0v2H6v-4h2a2 2 0 100-4H6V6h4z',
  pointer: 'M5 3l13 7-6 1.5L9.5 18zM14 14l5 5',
  term: 'M4 5h16v14H4zM8 10l2 2-2 2M12 14h4',
  bird: 'M3 15c4 0 6-2 8-6l3 2 4-3-1 4 4 2h-6c-2 3-5 4-9 4zM14 9h.01',
  via: 'M6 4v8a4 4 0 004 4h8M15 13l3 3-3 3',
  out: 'M7 17L17 7M9 7h8v8',
  in: 'M17 7L7 17M15 17H7V9',
  plus: 'M12 5v14M5 12h14',
  wand: 'M4 20L14 10M15 4v3M19 6l-2 2M20 10h-3M12 8l4 4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  send: 'M4 12l16-8-6 16-3-7z',
  check: 'M5 12l5 5L20 7',
  unfold: 'M4 10V4h6M20 14v6h-6M4 4l6 6M20 20l-6-6',
  fold: 'M14 4v6h6M10 20v-6H4M20 4l-6 6M4 20l6-6',
  pen: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  pause: 'M9 5v14M15 5v14',
  play: 'M8 5l11 7-11 7z',
  jump: 'M14 4h6v6M20 4l-9 9M19 14v5H5V5h5',
  key: 'M14.5 4a5.5 5.5 0 00-5.2 7.3L3 17.6V21h3.4v-2h2v-2h2l1.3-1.3A5.5 5.5 0 1014.5 4zM16 8h.01',
  x: 'M6 6l12 12M18 6L6 18',
  gear: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
};

export const icon = name => svg(IC[name]);

// 各家 agent 的像素标志；you（你自己）用信鸽的线条图标
export const Brand = () => window.Pigeon.Brand;
export const brand = a => (a === 'you' ? icon('bird') : raw(Brand().svg(a)));
