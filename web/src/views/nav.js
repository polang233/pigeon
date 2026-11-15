// 侧栏：四个页面的导航（任务旁边挂等你的数量），底下一行说数据从哪来：应用模式写连没连上，演示模式写明是示例
import { html } from '../html.js';
import { icon } from '../icons.js';
import { $, patch } from '../dom.js';

export const NAV = [['stage', '指挥台'], ['tasks', '任务'], ['route', '分派规则'], ['conn', '接入']];

export function mountNav(store) {
  const st = store.state;
  const draw = () => patch($('#nav'), html`${NAV.map(([v, l]) => html`<button type="button" data-action="nav" data-v="${v}" data-side="1" aria-label="${l}${v === 'tasks' && st.Q.length ? `，${st.Q.length} 件等你` : ''}" ${st.ui.view === v ? html`aria-current="page"` : ''}>${icon(v)}<span>${l}</span>${v === 'tasks' && st.Q.length ? html`<i class="count num">${st.Q.length}</i>` : ''}</button>`)}`);
  const foot = () => {
    const p = $('#side-note');
    p.textContent = st.mode === 'live' ? (st.link === false ? '连不上 Pigeon 应用，正在重连…' : '已连上 Pigeon 应用')
      : st.MPQ.state === 'live' ? '演示 · 额度来自 magpie，其余是示例' : '演示 · 全部是示例数据';
    p.classList.toggle('warn', st.mode === 'live' && st.link === false);
  };
  store.on(['ui.view', 'Q'], draw);
  store.on(['SUB', 'link'], foot);
  draw(); foot();
}
