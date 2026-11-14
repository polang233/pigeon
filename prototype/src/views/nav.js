// 侧栏：四个页面的导航（任务旁边挂等你的数量），底下一行说数据从哪来
import { html } from '../html.js';
import { icon } from '../icons.js';
import { $, patch } from '../dom.js';

export const NAV = [['stage', '指挥台'], ['tasks', '任务'], ['route', '分派规则'], ['conn', '接入']];

export function mountNav(store) {
  const st = store.state;
  const draw = () => patch($('#nav'), html`${NAV.map(([v, l]) => html`<button type="button" data-action="nav" data-v="${v}" data-side="1" aria-label="${l}${v === 'tasks' && st.Q.length ? `，${st.Q.length} 件等你` : ''}" ${st.ui.view === v ? html`aria-current="page"` : ''}>${icon(v)}<span>${l}</span>${v === 'tasks' && st.Q.length ? html`<i class="count num">${st.Q.length}</i>` : ''}</button>`)}`);
  const foot = () => { $('.side-foot p').textContent = st.MPQ.state === 'live' ? '原型 · 额度来自 magpie，其余是示例' : '原型 · 全部是示例数据'; };
  store.on(['ui.view', 'Q'], draw);
  store.on(['SUB'], foot);
  draw(); foot();
}
