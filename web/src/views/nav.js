// 侧栏：四个页面的导航（任务旁边挂等你的数量），底下一行说数据从哪来：应用模式写连没连上，演示模式写明是示例。
// 选中的那一项底下是一块会滑的底（.nav-pill），换页时从上一项滑过去；按钮本身不画选中底色
import { html } from '../html.js';
import { icon } from '../icons.js';
import { $, patch } from '../dom.js';

export const NAV = [['stage', '指挥台'], ['tasks', '任务'], ['route', '分派规则'], ['conn', '接入']];

export function mountNav(store) {
  const st = store.state;
  const pill = $('#nav .nav-pill');
  // 把滑块挪到选中的那一项上。第一次不带动画，免得一打开就从顶上滑下来
  let placed = false;
  const move = () => {
    const b = $('#nav .nav-items [aria-current="page"]');
    if (!b) { pill.style.opacity = '0'; return; }
    if (!placed) pill.style.transition = 'none';
    pill.style.cssText += `;opacity:1;width:${b.offsetWidth}px;height:${b.offsetHeight}px;transform:translate(${b.offsetLeft}px,${b.offsetTop}px)`;
    if (!placed) { void pill.offsetWidth; pill.style.transition = ''; placed = true; }
  };
  const draw = () => { patch($('#nav .nav-items'), html`${NAV.map(([v, l]) => html`<button type="button" data-action="nav" data-v="${v}" data-side="1" aria-label="${l}${v === 'tasks' && st.Q.length ? `，${st.Q.length} 件等你` : ''}" ${st.ui.view === v ? html`aria-current="page"` : ''}>${icon(v)}<span>${l}</span>${v === 'tasks' && st.Q.length ? html`<i class="count num">${st.Q.length}</i>` : ''}</button>`)}`); move(); };
  const foot = () => {
    const p = $('#side-note');
    p.textContent = st.mode === 'live' ? (st.link === false ? '连不上 Pigeon 应用，正在重连…' : '已连上 Pigeon 应用')
      : st.MPQ.state === 'live' ? '演示 · 额度来自 magpie，其余是示例' : '演示 · 全部是示例数据';
    p.classList.toggle('warn', st.mode === 'live' && st.link === false);
  };
  store.on(['ui.view', 'Q'], draw);
  // 窗口变窄时侧栏只剩图标，按钮大小变了，滑块跟着重新量
  addEventListener('resize', move);
  store.on(['SUB', 'link'], foot);
  draw(); foot();
}
