// 小说明都放在悬停提示里：带 data-tip 的元素悬停时出一个小气泡。文字用 textContent 放，不当标记解析。
let tip, cur = null;

export function showTip(t) {
  cur = t;
  if (!t) return tip.classList.remove('on');
  tip.textContent = t.dataset.tip; tip.classList.add('on');
  const r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  let y = r.top - h - 8; if (y < 4) y = r.bottom + 8;
  tip.style.left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + 'px'; tip.style.top = y + 'px';
}

export function mountTooltip() {
  tip = document.createElement('div'); tip.className = 'gtip'; tip.setAttribute('role', 'tooltip'); document.body.append(tip);
  document.addEventListener('mouseover', e => { const t = e.target.closest('[data-tip]'); if (t !== cur) showTip(t); });
  document.addEventListener('scroll', () => showTip(null), true);
  // 键盘聚焦到带小说明的元素上时也出来
  document.addEventListener('focusin', e => { if (e.target.dataset?.tip && e.target.matches(':focus-visible')) showTip(e.target); });
  document.addEventListener('focusout', e => { if (e.target === cur) showTip(null); });
}
