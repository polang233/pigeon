// 和 DOM 打交道的小工具：查元素、局部重画（不丢焦点）、减少动态效果。
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const typing = () => /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '');

// 一个元素的“焦点键”：重画后靠它找回同一个元素。优先 data-focus，其次 id，再其次动作名加全部参数（悬停说明不算，它会跟着状态变）
const keyOf = el => el.dataset?.focus || el.id || (el.dataset?.action ? JSON.stringify(Object.entries(el.dataset).filter(([k]) => k !== 'tip').sort()) : '');

// 把 el 的内容换成 markup（html`` 的结果或字符串）。outer 为真时连 el 自己一起换，新的标记的根要带同样的 data-part。
// 换之前焦点在里面的话，换完把焦点还给有同一个焦点键的元素，输入框的光标位置也还原。返回换上去的元素。
export function patch(el, markup, outer = false) {
  if (!el) return null;
  const a = document.activeElement, inside = a && a !== document.body && el.contains(a);
  const key = inside ? keyOf(a) : '';
  let sel = null;
  if (key && typeof a.selectionStart === 'number') { try { sel = [a.selectionStart, a.selectionEnd]; } catch (_) { /* 有的输入框不支持选区 */ } }
  let root = el;
  if (outer) {
    const tpl = document.createElement('template'); tpl.innerHTML = String(markup).trim();
    root = tpl.content.firstElementChild || document.createElement('div');
    el.replaceWith(tpl.content);
  } else el.innerHTML = String(markup);
  if (key) {
    const n = [root, ...root.querySelectorAll('[data-focus],[id],[data-action]')].find(x => keyOf(x) === key);
    if (n) {
      n.focus({ preventScroll: true });
      if (sel && n.setSelectionRange) { try { n.setSelectionRange(...sel); } catch (_) { /* 同上 */ } }
    }
  }
  return root;
}
// 换掉 root 里 data-part="name" 的那块（新标记的根也要带 data-part="name"）
export const part = (root, name, markup) => patch(root.querySelector(`[data-part="${name}"]`), markup, true);
