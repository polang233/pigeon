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
