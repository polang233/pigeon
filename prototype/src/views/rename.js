// 设备就地改名：接入页点设备名、指挥台底下双击设备标签。回车或点别处保存，Esc 取消，清空就恢复原来的名字。
// 改完由 store 发 DEV，各处重画，输入框也就换回去了。
import { toast } from './toast.js';
import { showTip } from './tooltip.js';

export function startRename(store, d, el) {
  const D = store.state.DEV[d];
  if (!D || el.querySelector?.('input')) return;
  showTip(null);
  const inp = document.createElement('input');
  inp.className = 'rename'; inp.value = D.name; inp.maxLength = 24; inp.placeholder = D.def; inp.autocomplete = 'off'; inp.setAttribute('aria-label', '设备名字');
  const fit = () => { inp.style.width = Math.max(7, [...(inp.value || inp.placeholder)].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 1.9 : 1.05), 0) + 2.5) + 'ch'; };
  fit(); inp.addEventListener('input', fit);
  // 底部的设备标签本身是按钮，按钮里不能放输入框，就整个换掉
  let box = el;
  if (el.tagName === 'BUTTON') { box = document.createElement('span'); box.className = el.className + ' editing'; box.innerHTML = el.querySelector('.g')?.outerHTML || ''; el.replaceWith(box); }
  else el.replaceChildren();
  box.append(inp); inp.focus(); inp.select();
  let done = false;
  const finish = ok => {
    if (done) return; done = true;
    const msg = store.renameDevice(d, ok ? inp.value : null);
    if (msg) toast(msg);
  };
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
}
