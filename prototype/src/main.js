// Pigeon 原型的入口：读浏览器里存的设置、建 store、注册各页、挂事件、第一次绘制。
// art/ 下的三个普通脚本（brand.js、loft-art.js、manor.js）在这之前加载，挂在 window.Pigeon 上。
//
// 约定（正式重构时照着做）：
// - 本机 id：本机是哪台一律读 store.state.home，别处不写死；示例数据里本机叫 mac。
// - 转义：拼页面一律用 html``，插进去的值默认转义（包括属性），可信的标记用 raw()。
// - 动作注册：能点、能输入的元素写 data-action，处理函数用 actions.js 的 register 注册；处理函数调 store 的方法，不直接改数据。
// - 局部重画：每页分几块（data-part），按 store 的话题只重画受影响的那块；重画后焦点还给同一个元素（dom.js 的 patch）。
// 正式重构时把 data/mock.js 换成读应用接口的适配层，其余照搬。
import { createMock } from './data/mock.js';
import { startMagpie } from './data/magpie.js';
import { createStore } from './store.js';
import { listen, registerAll, setFallback, onKey } from './actions.js';
import { $ } from './dom.js';
import { by, jumpLabel } from './core/names.js';
import { toast } from './views/toast.js';
import { mountTooltip } from './views/tooltip.js';
import { mountNav } from './views/nav.js';
import { mountSettings } from './views/settings.js';
import { mountHud } from './views/hud.js';
import { initStage, mountStage } from './views/stage.js';
import { initTasks, mountTasks } from './views/tasks.js';
import { initRoute, mountRoute } from './views/route.js';
import { initConn, mountConn } from './views/conn.js';

/* ---------- 浏览器里记住的东西：读不到（隐私模式等）就用默认值 ---------- */
const KEY = { settings: 'pigeon-proto-settings', names: 'pigeon-proto-names', open: 'pigeon-proto-open', lead: 'pigeon-proto-lead' };
const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* 存不了就只在这次有效 */ } };

const store = createStore(createMock(), { settings: load(KEY.settings), names: load(KEY.names), open: load(KEY.open), lead: load(KEY.lead) });
const st = store.state;

/* ---------- 设置：写到 <html> 上让样式表用，顺带存起来 ---------- */
function applySettings() {
  const r = document.documentElement, S = st.settings;
  if (S.theme === 'system') delete r.dataset.theme; else r.dataset.theme = S.theme;
  r.dataset.palette = S.palette;
  r.dataset.notch = S.notch;
  save(KEY.settings, S);
}
applySettings();
// 先于各页订阅，各页重画时读到的已经是新配色
store.on(['settings'], applySettings);
store.on(['DEV'], () => save(KEY.names, st.NAMES));
store.on(['ui.open'], () => save(KEY.open, st.ui.open));
store.on(['lead'], () => save(KEY.lead, st.lead));
// 跟随系统时，系统明暗变了也要重画指挥台（场景、连线颜色）
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (st.settings.theme === 'system') store.emit('settings.theme'); });

/* ---------- 动作和按键 ---------- */
listen(document);
setFallback(() => toast('原型里这个按钮还没接功能'));
registerAll({
  // 切页。从刘海、详情里跳过去的顺手收起刘海；点侧栏的不动刘海
  nav: ({ d }) => { if (!d.side) store.hud('idle'); store.setView(d.v); },
  pause: () => { const r = store.togglePause(); toast(r.paused ? '已全部暂停：不再送出任何消息，正在干活的做完这一轮就停' : `继续了，停下的消息接着送${r.sent ? `（送出 ${r.sent} 件）` : ''}`); },
  // 跳回发起的对话：回到它自己的应用里（原型里不跳）
  jump: ({ d }) => { const s = by(st, d.s); if (s) toast(`会${jumpLabel(st, s)}「${s.title}」（原型里不跳转）`); },
});
// Esc：收起设置、添加设备的面板和刘海
onKey(e => {
  if (e.key !== 'Escape') return false;
  store.toggleSettings(false);
  if (st.ui.conn.sheet) store.closeSheet();
  if (st.ui.conn.rm) store.cancelRemove();
  store.hud('idle');
  return true;
});

/* ---------- 各页 ---------- */
const PAGES = { stage: mountStage, tasks: mountTasks, route: mountRoute, conn: mountConn };
[initStage, initTasks, initRoute, initConn].forEach(f => f(store));
mountTooltip();
mountNav(store);
mountSettings(store);
mountHud(store);

const main = $('#main');
let unmount = null;
function show() {
  unmount?.();
  unmount = PAGES[st.ui.view](main) || null;
  main.scrollTop = 0;
}
store.on(['ui.view'], show);
show();
startMagpie(store);
