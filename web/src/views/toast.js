// 窗口底部一行提示，2.6 秒后自己消失。带 action（{ label, run }）时多一个按钮（比如“撤回”），留 6 秒
import { $ } from '../dom.js';

let timer;
export function toast(msg, action) {
  const t = $('#toast');
  t.replaceChildren(Object.assign(document.createElement('span'), { textContent: msg }));
  if (action) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'toast-act', textContent: action.label });
    b.addEventListener('click', () => { t.classList.remove('on', 'act'); action.run(); });
    t.append(b);
  }
  t.classList.toggle('act', !!action); t.classList.add('on');
  clearTimeout(timer); timer = setTimeout(() => t.classList.remove('on', 'act'), action ? 6000 : 2600);
}

// 方法的结果可能马上就有（演示），也可能是 Promise（应用）：拿到了再做 fn；失败就把错误说出来
export const after = (v, fn = () => {}) => (v && typeof v.then === 'function' ? v.then(fn, e => toast(e?.message || String(e))) : fn(v));
