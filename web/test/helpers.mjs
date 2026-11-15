// 测试用的状态：示例数据加上 store 会补的几样（不建 store，core 里的纯函数只读这些）
import { createMock } from '../src/data/mock.js';

export const NOW = Date.parse('2026-11-13T10:43:00+08:00');

export function freshState() {
  return { ...createMock(NOW), paused: { all: false, dev: {} }, settings: { secrets: 'warn', crossTimeoutSec: 90 }, ui: { open: {} } };
}

// 把本机的设备 id 从 mac 换成别的，用来确认没有哪里把本机写死成 mac
export function rehome(st, id) {
  const old = st.home, sw = k => (k && k.endsWith('@' + old) ? k.slice(0, -old.length) + id : k), ep = e => { if (e && e.dev === old) e.dev = id; };
  st.DEV = Object.fromEntries(Object.entries(st.DEV).map(([k, v]) => [k === old ? id : k, v]));
  st.CONN = Object.fromEntries(Object.entries(st.CONN).map(([k, v]) => [k === old ? id : k, v]));
  st.SUB = Object.fromEntries(Object.entries(st.SUB).map(([k, v]) => [sw(k), v]));
  st.S.forEach(s => { if (s.dev === old) s.dev = id; });
  st.RULES.forEach(r => { r.to = sw(r.to); r.fb = sw(r.fb); });
  st.Q.forEach(q => { ep(q.from); ep(q.to); q.parts?.forEach(p => ep(p.to)); });
  ep(st.lead);
  st.home = id;
  return st;
}
