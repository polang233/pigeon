// Pigeon 网页的入口：先看是谁打开的页面，再建 store、注册各页、挂事件、第一次绘制。
// art/ 下的三个普通脚本（brand.js、loft-art.js、manor.js）在这之前加载，挂在 window.Pigeon 上。
//
// 两种模式，一套代码：
//   - 应用：页面由 Pigeon 应用的本机服务（127.0.0.1:47321）打开，GET /api/lofts 读得到。数据全是真的，后端是 backend/live.js。
//     没有假的菜单栏、刘海和窗口按钮，页面铺满应用的窗口（刘海是原生的）。
//   - 演示：用 tools/serve.py 或普通静态服务打开，/api/lofts 读不到。示例数据（data/mock.js），后端是 backend/demo.js，
//     网页里画一个假的菜单栏和刘海演示交互，侧栏底下写明是演示。
//
// 约定：
// - 本机 id：本机是哪台一律读 store.state.home，别处不写死；示例数据里本机叫 mac，应用里叫 local。
// - 转义：拼页面一律用 html``，插进去的值默认转义（包括属性），可信的标记用 raw()。
// - 动作注册：能点、能输入的元素写 data-action，处理函数用 actions.js 的 register 注册；处理函数调 store 的方法，不直接改数据。
// - 局部重画：每页分几块（data-part），按 store 的话题只重画受影响的那块；重画后焦点还给同一个元素（dom.js 的 patch）。
import { createMock } from './data/mock.js';
import { startMagpie } from './data/magpie.js';
import { probeLive, connectLive } from './backend/live.js';
import { createStore } from './store.js';
import { LOOKS } from './core/labels.js';
import { listen, setFallback, onKey } from './actions.js';
import { $ } from './dom.js';
import { toast } from './views/toast.js';
import { initShared } from './views/shared.js';
import { mountTooltip } from './views/tooltip.js';
import { mountNav, NAV } from './views/nav.js';
import { mountSettings } from './views/settings.js';
import { mountHud } from './views/hud.js';
import { initStage, mountStage } from './views/stage.js';
import { initTasks, mountTasks } from './views/tasks.js';
import { initRoute, mountRoute } from './views/route.js';
import { initConn, mountConn } from './views/conn.js';

/* ---------- 谁打开的页面 ---------- */
const lofts = await probeLive();
const live = !!lofts;
document.documentElement.dataset.mode = live ? 'live' : 'demo';
document.title = live ? 'Pigeon' : 'Pigeon 演示';
if (live) { $('.menubar')?.remove(); $('.traffic')?.remove(); }

/* ---------- 应用的窗口没有标题栏：标了 data-drag 的空白处和各页标题行，按住拖窗口、双击缩放 ---------- */
const chrome = window.webkit?.messageHandlers?.pigeonWindow;
if (chrome) {
  document.documentElement.dataset.chrome = 'native';
  const dragZone = t => t instanceof Element && t.closest('[data-drag], .head') && !t.closest('button, a, input, select, textarea, label, [data-action], [contenteditable], [role="switch"]');
  document.addEventListener('mousedown', e => { if (e.button === 0 && e.detail === 1 && dragZone(e.target)) chrome.postMessage('drag'); });
  document.addEventListener('dblclick', e => { if (dragZone(e.target)) chrome.postMessage('zoom'); });
}

/* ---------- 浏览器里记住的东西：读不到（隐私模式等）就用默认值 ---------- */
// 应用模式只记纯外观的设置和哪些远程设备展开着，别的都以应用里存的为准
const P = live ? 'pigeon' : 'pigeon-demo';
const KEY = { settings: `${P}-settings`, names: `${P}-names`, open: `${P}-open`, lead: `${P}-lead` };
const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* 存不了就只在这次有效 */ } };
const looks = s => Object.fromEntries(Object.entries(s || {}).filter(([k]) => LOOKS.includes(k)));

let data, backend;
if (live) {
  const hub = await connectLive(lofts, { notify: m => toast(m) });
  data = hub.data; backend = hub.backend;
} else data = createMock();
const saved = live ? { settings: looks(load(KEY.settings)), open: load(KEY.open) } : { settings: load(KEY.settings), names: load(KEY.names), open: load(KEY.open), lead: load(KEY.lead) };
const store = createStore(data, saved, backend ? { backend } : {});
const st = store.state;
if (live) st.MPQ.state = 'wait';

/* ---------- 设置：写到 <html> 上让样式表用，顺带存起来 ---------- */
function applySettings() {
  const r = document.documentElement, S = st.settings;
  if (S.theme === 'system') delete r.dataset.theme; else r.dataset.theme = S.theme;
  r.dataset.palette = S.palette;
  r.dataset.notch = S.notch;
  save(KEY.settings, live ? looks(S) : S);
}
applySettings();
// 先于各页订阅，各页重画时读到的已经是新配色
store.on(['settings'], applySettings);
if (!live) {
  store.on(['DEV'], () => save(KEY.names, st.NAMES));
  store.on(['lead'], () => save(KEY.lead, st.lead));
}
store.on(['ui.open'], () => save(KEY.open, st.ui.open));
// 跟随系统时，系统明暗变了也要重画指挥台（场景、连线颜色）
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (st.settings.theme === 'system') store.emit('settings.theme'); });

/* ---------- 动作和按键 ---------- */
listen(document);
setFallback(() => toast(live ? '这个按钮还没接上' : '演示里这个按钮还没接功能'));
initShared(store);
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
if (!live) mountHud(store); // 应用里的刘海是原生的

const main = $('#main');
let unmount = null, shown = null;
const ORDER = NAV.map(([v]) => v);
const quiet = matchMedia('(prefers-reduced-motion: reduce)');
// 换页：往下翻（侧栏里更靠下的一页）新页从下面滑进来，往上翻从上面；减少动态效果时直接换
function show() {
  const swap = () => { unmount?.(); unmount = PAGES[st.ui.view](main) || null; main.scrollTop = 0; };
  const from = shown; shown = st.ui.view;
  if (!from || from === shown || quiet.matches) return swap();
  document.documentElement.dataset.nav = ORDER.indexOf(shown) > ORDER.indexOf(from) ? 'down' : 'up';
  if (document.startViewTransition) { document.startViewTransition(swap); return; }
  swap();
  main.classList.remove('page-in'); void main.offsetWidth; main.classList.add('page-in');
}
store.on(['ui.view'], show);
show();
// 应用（原生刘海上的“在窗口里看”）让页面翻到某一页：stage 指挥台、tasks 任务、rules 分派规则、devices 接入、settings 设置
window.PigeonApp = {
  open(page) {
    const v = { stage: 'stage', tasks: 'tasks', rules: 'route', devices: 'conn' }[page];
    if (v) store.setView(v); else if (page === 'settings') store.toggleSettings(true);
  },
};
startMagpie(store);
