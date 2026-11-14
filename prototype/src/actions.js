// 动作注册表。页面里能点、能输入的东西都写成 data-action="名字"，参数放在别的 data-* 上（data-id、data-dev……）。
// document 上只挂一个 click / dblclick / input / change / keydown 监听，按 data-action 找到处理函数再调它。
//   register('名字', ({ el, d, e, type, value }) => …)            只响应点击
//   register('名字', fn, 'input')、register('名字', fn, 'click', 'dblclick')   指定响应哪些事件
// 表单控件（输入框、下拉框）上的动作不响应点击，只响应注册的 input / change / keydown。
// 点到没注册的动作会走 setFallback 的处理（原型里说“还没接功能”）。
// 不跟某个元素绑定的全局按键（Esc、方向键）用 onKey(fn) 注册，fn 返回 true 表示处理过了。

const REG = new Map();
const KEYS = [];
let fallback = null;

export function register(name, fn, ...types) {
  if (REG.has(name)) console.warn('动作重名了：' + name);
  REG.set(name, { fn, types: types.length ? types : ['click'] });
}
export const registerAll = map => Object.entries(map).forEach(([name, v]) => (Array.isArray(v) ? register(name, ...v) : register(name, v)));
export const setFallback = fn => { fallback = fn; };
export const onKey = fn => { KEYS.push(fn); };
export const has = name => REG.has(name);
export const names = () => [...REG.keys()];

const FORM = /^(INPUT|SELECT|TEXTAREA)$/;
function run(type, e) {
  const el = e.target.closest?.('[data-action]');
  if (!el) return false;
  const name = el.dataset.action, h = REG.get(name);
  if (!h) {
    if (type === 'click' && fallback) { fallback(name, el, e); return true; }
    return false;
  }
  if (!h.types.includes(type)) return false;
  h.fn({ el, d: el.dataset, e, type, value: el.value });
  return true;
}

export function listen(root = document) {
  for (const type of ['click', 'dblclick', 'input', 'change']) {
    root.addEventListener(type, e => {
      // 点在输入框、下拉框上不算点了外面那层的按钮
      if (type === 'click' && FORM.test(e.target.tagName) && !e.target.dataset.action) return;
      run(type, e);
    });
  }
  root.addEventListener('keydown', e => {
    // 不是 <button> 却当按钮用的（role="button"，比如收起的设备卡片）：回车、空格也算点了它
    const rb = (e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"][data-action]') && e.target.tagName !== 'BUTTON';
    if (rb && REG.get(e.target.dataset.action)?.types.includes('click')) { e.preventDefault(); run('click', e); return; }
    if (run('keydown', e)) return;
    for (const fn of KEYS) if (fn(e)) return;
  });
}
