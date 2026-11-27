// 侧栏底部的“设置”面板。改了马上生效。
// 纯外观的（明暗、配色、场景、连线、场景样式）记在浏览器里（main.js 负责存）；
// 应用模式下其余几项存进应用的设置（刘海 perch.notch、额度显示 quota.show、查密钥 secrets.mode、通知 notify.*）。
import { html, bool } from '../html.js';
import { $, patch } from '../dom.js';
import { PALETTES, SKINS } from '../core/labels.js';
import { online, shortDev } from '../core/names.js';
import { DEFAULT_HOTKEY, normalizeHotkey, formatHotkey, keyEventToSpec } from '../core/hotkey.js';
import { registerAll } from '../actions.js';
import { toast, after } from './toast.js';

// 刘海那一节的演示按钮：看刘海的五种状态（应用里是原生刘海用内置的示例内容演示，不动真数据）
const HUD_DEMO = [['idle', '收起'], ['overview', '悬停总览'], ['confirm', '等你处理'], ['reply', '回信到了'], ['compose', '快速派活']];
// 系统通知（设置里的 notify.*，由应用发）。默认值照契约
export const NOTIFY0 = { done: true, failed: true, waiting: true, turnEnd: true, turnMinSec: 60, noteHome: true, noteLost: true };
const NOTIFY = [
  ['noteHome', '回信到了', '对方回信取回来时提醒你'],
  ['noteLost', '没发出或没回音', '不会自动重发，要不要再发由你决定'],
  ['done', '交给 Codex 的活做完了', 'Claude Code 经 pigeon run 交出去的活交回结果时'],
  ['failed', '交给 Codex 的活出错了', ''],
  ['waiting', 'Claude Code 等你时', '它要你批准工具或回答问题时'],
  ['turnEnd', 'Claude Code 说完一轮时', '只在这一轮比较长时提醒'],
];
// 应用设置里某一项的值：path 是一串键，没有就用默认值
export const srv = (st, path, def) => { let v = st.SRV; for (const k of path) v = v && typeof v === 'object' ? v[k] : undefined; return v === undefined ? def : v; };

export function mountSettings(store) {
  const pop = $('#setpop'), btn = $('#settings'), st = store.state, S = st.settings, live = st.mode === 'live';
  let recording = false;
  const seg = (key, opts) => html`<div class="seg" role="group">${opts.map(([v, l]) => html`<button type="button" data-action="set" data-k="${key}" data-v="${v}" aria-pressed="${bool(S[key] === v)}">${l}</button>`)}</div>`;
  const notifyHTML = () => html`<h3><span data-tip="Pigeon 应用发的系统通知">通知</span></h3><div class="srows">${NOTIFY.map(([k, l, tip]) => html`<div class="srow"><span ${tip ? html`data-tip="${tip}"` : ''}>${l}</span><button class="sw" type="button" role="switch" aria-checked="${bool(srv(st, ['notify', k], NOTIFY0[k]) !== false)}" data-action="srv-sw" data-path="notify.${k}" aria-label="${l}"></button></div>`)}
    <div class="srow"><span data-tip="说完一轮的通知只在超过这么久时才发，10–3600 秒">较长一轮</span><span><input class="numin" type="number" min="10" max="3600" step="1" data-action="srv-num" data-path="notify.turnMinSec" data-min="10" data-max="3600" value="${srv(st, ['notify', 'turnMinSec'], NOTIFY0.turnMinSec)}" aria-label="较长一轮是多少秒"> 秒</span></div></div>`;
  const systemHTML = () => {
    const auto = st.AUTOSTART;
    const autoTip = !auto?.supported
      ? '安装为 Pigeon.app 后可开启登录自启'
      : auto?.requiresApproval
        ? '请在“系统设置 → 通用 → 登录项与扩展”里允许 Pigeon'
        : '登录 Mac 后自动在后台运行 Pigeon';
    const hkOn = srv(st, ['perch', 'hotkey'], true) !== false;
    const hkSpec = normalizeHotkey(srv(st, ['perch', 'hotkeySpec'], DEFAULT_HOTKEY)) || DEFAULT_HOTKEY;
    const hkLabel = formatHotkey(hkSpec);
    return html`<h3><span>桌面与快捷方式</span></h3><div class="srows">
      <div class="srow"><span data-tip="在任何应用里按快捷键，直接弹出或收起刘海快速派活">全局快捷派活</span><button class="sw" type="button" role="switch" aria-checked="${bool(hkOn)}" data-action="srv-sw" data-path="perch.hotkey" aria-label="全局快捷派活"></button></div>
      <div class="srow"><span data-tip="点一下右侧按钮后直接按组合键（如 ⌥ 空格 或 ⌘ ⇧ P）即可改键，按 Esc 取消">呼出快捷键</span><span class="hk-wrap"><button type="button" class="hk-btn ${recording ? 'rec' : ''}" data-action="hk-rec" aria-pressed="${bool(recording)}">${recording ? '请按组合键…' : hkLabel}</button>${hkSpec !== DEFAULT_HOTKEY ? html`<button type="button" class="ghost sm" data-action="hk-reset" title="恢复默认 ⌥ 空格">恢复默认</button>` : ''}</span></div>
      ${auto ? html`<div class="srow"><span data-tip="${autoTip}">${auto.requiresApproval ? '登录时自动启动（需系统允许）' : '登录时自动启动'}</span><button class="sw" type="button" role="switch" aria-checked="${bool(!!auto.enabled)}" data-action="autostart-sw" aria-label="登录时自动启动" ${auto.supported ? '' : 'disabled'}></button></div>` : ''}
    </div>`;
  };
  const draw = () => { const remote = Object.keys(st.DEV).find(d => d !== st.home); patch(pop, html`<h3>外观</h3>${seg('theme', [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']])}
    <h3>配色</h3><div class="pals">${PALETTES.map(([v, l]) => html`<button type="button" class="pal ${S.palette === v ? 'on' : ''}" data-action="set" data-k="palette" data-v="${v}"><span class="sw4 sw-${v}"><i></i><i></i><i></i><i></i></span><b>${l}</b></button>`)}</div>
    <h3><span data-tip="浅色时是白天：太阳、云和路过的鸽群；深色时是夜晚：星星、月亮和偶尔的流星">场景</span></h3>${seg('scene', [['on', '白天黑夜'], ['off', '关']])}
    <h3>连线</h3>${seg('lines', [['pixel', '像素折线'], ['arc', '弧线']])}
    <h3><span data-tip="关掉后屏幕顶上不再有刘海面板，等你的事改在菜单栏的鸽子图标里，点一下展开同样的面板">刘海</span></h3>${seg('notch', [['on', '开'], ['off', '关']])}
    <div class="demo" role="group" aria-label="演示刘海的五种状态"><span data-tip="${live ? '刘海用内置的示例内容演示这个样子，不动真数据' : '看屏幕顶上刘海的五种样子'}">演示</span>${HUD_DEMO.map(([k, l]) => html`<button class="ghost" type="button" data-action="hud-demo" data-state="${k}">${l}</button>`)}</div>
    ${live ? systemHTML() : ''}
    ${live ? '' : html`<div class="demo" role="group" aria-label="演示：来一件要问你的事"><span>演示</span><button class="ghost" type="button" data-action="demo-in" data-kind="relay">来一件转派</button><button class="ghost" type="button" data-action="demo-in" data-kind="split">来一件拆活</button></div>
    ${remote ? html`<div class="demo"><span>演示</span><button class="ghost" type="button" role="switch" aria-checked="${bool(!online(st, remote))}" data-action="demo-offline" data-dev="${remote}">${shortDev(st, remote)} 断开</button></div>` : ''}`}
    <h3><span data-tip="指挥台头像右下角的小圆盘。默认不显示，鼠标移到 agent 上时在提示里看">订阅额度</span></h3>${seg('quota', [['hover', '悬停时看'], ['always', '一直显示']])}
    <h3><span data-tip="跨设备发送前，检查消息里有没有像密钥、token 的字符串。提醒：标红，放行时可以选打码；自动打码：对方收到的是占位符">跨设备发送前查密钥</span></h3>${seg('secrets', [['warn', '提醒'], ['mask', '自动打码'], ['off', '关']])}
    ${live ? notifyHTML() : ''}
    <h3>场景样式（实验）</h3><p class="hint">第一版只做简洁</p>${seg('skin', SKINS)}
    <p class="credit">Claude Code 的动画来自 <a href="https://github.com/marciogranzotto/clawd-tank" target="_blank" rel="noopener">clawd-tank</a>，MIT 许可；DeepSeek 的鲸鱼是照它的动作换了身子；Codex 的宠物是 Codex 应用自带的，没有授权，只在本机放了那个文件时才用</p>`); };

  const sync = () => {
    const on = st.ui.settingsOpen;
    if (!on) recording = false;
    if (on) draw();
    pop.classList.toggle('on', on); btn.setAttribute('aria-expanded', on);
  };
  store.on(['ui.settingsOpen'], sync);
  store.on(['settings', 'DEV', 'SRV', 'AUTOSTART'], () => { if (st.ui.settingsOpen) draw(); });

  registerAll({
    settings: () => store.toggleSettings(),
    set: ({ d }) => after(store.setSetting(d.k, d.v)),
    'hud-demo': ({ d }) => after(store.notchDemo(d.state), msg => { if (msg) toast(msg); }),
    'autostart-sw': ({ el }) => after(store.setAutostart(el.getAttribute('aria-checked') !== 'true'), msg => { if (msg) toast(msg); }),
    'hk-rec': () => { recording = !recording; draw(); },
    'hk-reset': () => {
      recording = false;
      after(store.setServer(['perch', 'hotkeySpec'], DEFAULT_HOTKEY), () => toast('已恢复默认快捷键 ⌥ 空格'));
      draw();
    },
    // 演示：那台断开 / 连上
    'demo-offline': ({ d }) => store.setOnline(d.dev, !online(st, d.dev)),
    // 应用设置里的开关、数字、下拉（通知、交给 Codex 的活、中继对话……）：data-path 是“notify.done”这样的路径
    'srv-sw': ({ d, el }) => after(store.setServer(d.path.split('.'), el.getAttribute('aria-checked') !== 'true')),
    'srv-num': [({ d, el }) => {
      const n = Math.round(Number(el.value)), v = Number.isFinite(n) ? Math.max(+d.min, Math.min(+d.max, n)) : null;
      if (v == null) { toast('要填一个数字'); return; }
      el.value = v; after(store.setServer(d.path.split('.'), v));
    }, 'change'],
    'srv-text': [({ d, el }) => after(store.setServer(d.path.split('.'), el.value.trim() || d.def || '')), 'change'],
    'srv-pick': [({ d, value }) => after(store.setServer(d.path.split('.'), d.num ? Number(value) : value)), 'change'],
  });
  // 点在面板外面就收起。点面板里的按钮会重画面板，被点的按钮已经不在页面上了，所以按事件经过的路径判断
  document.addEventListener('click', e => {
    if (st.ui.settingsOpen && !e.composedPath().some(n => n.id === 'setpop' || n.id === 'settings')) store.toggleSettings(false);
  });
  document.addEventListener('keydown', e => {
    if (!recording || !st.ui.settingsOpen) return;
    e.preventDefault();
    e.stopPropagation();
    const res = keyEventToSpec(e);
    if (res.status === 'modifier') return;
    if (res.status === 'cancel') { recording = false; draw(); return; }
    if (res.status === 'no_mod') { toast('请至少按住一个修饰键（⌥ / ⌘ / ⌃ / ⇧）'); return; }
    if (res.status === 'unsupported') { toast('不支持这个按键，试试字母、数字、空格或 F1–F12'); return; }
    recording = false;
    after(store.setServer(['perch', 'hotkeySpec'], res.spec), () => toast(`快捷键已改为 ${formatHotkey(res.spec)}`));
    draw();
  }, { capture: true });
}
