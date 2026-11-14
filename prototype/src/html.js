// html`` 标签模板：拼页面用。约定：
// - 插进去的值一律转义，包括写在属性里的（data-tip、value、placeholder……），所以数据里来的字符串直接插就行。
// - 已经是可信标记的（图标 SVG、另一个 html`` 的结果）用 raw() 包一下，或者本来就是 html`` 返回的，原样放进去。
// - 数组按顺序拼起来，每一项照同样的规则处理。null、undefined、false 什么都不输出；true 输出 "true"。
// - 属性里要写 "true"/"false" 的（aria-pressed、aria-checked）用 bool()，免得 false 被当成空。
// 不碰 DOM，node 里也能跑（见 test/html.test.mjs）。

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v).replace(/[&<>"']/g, c => ESC[c]);

// 可信的标记，原样输出
export const raw = s => (s instanceof Raw ? s : new Raw(s == null ? '' : String(s)));
export const isRaw = v => v instanceof Raw;

// 属性里的布尔值
export const bool = v => (v ? 'true' : 'false');

function part(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Raw(out);
}

// 把一组值拼成一段标记（每项照 html`` 的规则转义）
export const join = (list, sep = '') => new Raw(list.map(part).join(part(sep)));
