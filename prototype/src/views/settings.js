// 侧栏底部的“设置”面板。改了马上生效，记在浏览器里（main.js 负责存）。
import { html, bool } from '../html.js';
import { $, patch } from '../dom.js';
import { PALETTES, SKINS } from '../core/labels.js';
import { online, shortDev } from '../core/names.js';
import { registerAll } from '../actions.js';

// 刘海那一节的演示按钮：看屏幕顶上刘海的五种状态
const HUD_DEMO = [['idle', '收起'], ['overview', '悬停总览'], ['confirm', '等你处理'], ['reply', '回信到了'], ['compose', '快速派活']];

export function mountSettings(store) {
  const pop = $('#setpop'), btn = $('#settings'), S = store.state.settings;
  const seg = (key, opts) => html`<div class="seg" role="group">${opts.map(([v, l]) => html`<button type="button" data-action="set" data-k="${key}" data-v="${v}" aria-pressed="${bool(S[key] === v)}">${l}</button>`)}</div>`;
  const draw = () => { const remote = Object.keys(store.state.DEV).find(d => d !== store.state.home); patch(pop, html`<h3>外观</h3>${seg('theme', [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']])}
    <h3>配色</h3><div class="pals">${PALETTES.map(([v, l]) => html`<button type="button" class="pal ${S.palette === v ? 'on' : ''}" data-action="set" data-k="palette" data-v="${v}"><span class="sw4 sw-${v}"><i></i><i></i><i></i><i></i></span><b>${l}</b></button>`)}</div>
    <h3><span data-tip="浅色时是白天：太阳、云和路过的鸽群；深色时是夜晚：星星、月亮和偶尔的流星">场景</span></h3>${seg('scene', [['on', '白天黑夜'], ['off', '关']])}
    <h3>连线</h3>${seg('lines', [['pixel', '像素折线'], ['arc', '弧线']])}
    <h3><span data-tip="关掉后屏幕顶上不再有刘海面板，等你的事改在菜单栏的鸽子图标里，点一下展开同样的面板">刘海</span></h3>${seg('notch', [['on', '开'], ['off', '关']])}
    <div class="demo" role="group" aria-label="演示刘海的五种状态"><span>演示</span>${HUD_DEMO.map(([k, l]) => html`<button class="ghost" type="button" data-action="hud" data-state="${k}">${l}</button>`)}</div>
    <div class="demo" role="group" aria-label="演示：来一件要问你的事"><span>演示</span><button class="ghost" type="button" data-action="demo-in" data-kind="relay">来一件转派</button><button class="ghost" type="button" data-action="demo-in" data-kind="split">来一件拆活</button></div>
    ${remote ? html`<div class="demo"><span>演示</span><button class="ghost" type="button" role="switch" aria-checked="${bool(!online(store.state, remote))}" data-action="demo-offline" data-dev="${remote}">${shortDev(store.state, remote)} 断开</button></div>` : ''}
    <h3><span data-tip="指挥台头像右下角的小圆盘。默认不显示，鼠标移到 agent 上时在提示里看">订阅额度</span></h3>${seg('quota', [['hover', '悬停时看'], ['always', '一直显示']])}
    <h3><span data-tip="跨设备发送前，检查消息里有没有像密钥、token 的字符串。提醒：标红，放飞时可以选打码；自动打码：对方收到的是占位符">跨设备发送前查密钥</span></h3>${seg('secrets', [['warn', '提醒'], ['mask', '自动打码'], ['off', '关']])}
    <h3>场景样式（实验）</h3><p class="hint">第一版只做简洁</p>${seg('skin', SKINS)}
    <p class="credit">Claude Code 的动画来自 <a href="https://github.com/marciogranzotto/clawd-tank" target="_blank" rel="noopener">clawd-tank</a>，MIT 许可；DeepSeek 的鲸鱼是照它的动作换了身子；Codex 的宠物是 Codex 应用自带的，只在原型里先用，没有授权</p>`); };

  const sync = () => {
    const on = store.state.ui.settingsOpen;
    if (on) draw();
    pop.classList.toggle('on', on); btn.setAttribute('aria-expanded', on);
  };
  store.on(['ui.settingsOpen'], sync);
  store.on(['settings', 'DEV'], () => { if (store.state.ui.settingsOpen) draw(); });

  registerAll({
    settings: () => store.toggleSettings(),
    set: ({ d }) => store.setSetting(d.k, d.v),
    // 演示：那台断开 / 连上
    'demo-offline': ({ d }) => store.setOnline(d.dev, !online(store.state, d.dev)),
  });
  // 点在面板外面就收起。点面板里的按钮会重画面板，被点的按钮已经不在页面上了，所以按事件经过的路径判断
  document.addEventListener('click', e => {
    if (store.state.ui.settingsOpen && !e.composedPath().some(n => n.id === 'setpop' || n.id === 'settings')) store.toggleSettings(false);
  });
}
