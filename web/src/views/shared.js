// 几个页面都用的动作：切页、全部暂停、跳回对话、派活、给它发消息、放行和拦下等你的那件。
// 方法来自 store 的后端（演示马上有结果，应用返回 Promise），用 after() 一样处理，出错就提示。
import { registerAll } from '../actions.js';
import { by, keyOf, secsLeft } from '../core/names.js';
import { $$ } from '../dom.js';
import { toast, after } from './toast.js';

let fly = null;
// 演示里放行时刘海上飞一只鸽子：hud.js 挂上来
export const setFly = fn => { fly = fn; };

// 放行或拦下等你的第 i 件，顺带提示
export function doQ(store, i, ok, opt) {
  return after(store.qDo(i, ok, opt), r => {
    if (!r) return;
    if (r.fly && fly) setTimeout(() => fly(...r.fly), 380);
    toast(r.msg);
  });
}

export function initShared(store) {
  const st = store.state;
  // 倒计时：每秒改一下“剩几秒”；演示里到点的跨设备那件不发（应用里由应用判，结果经推送回来）
  setInterval(() => {
    const now = store.clock();
    $$('[data-deadline]').forEach(el => { const s = secsLeft({ deadline: +el.dataset.deadline }, now); el.textContent = el.dataset.long ? `还剩 ${s} 秒，不点就不发` : `剩 ${s} 秒`; });
    after(store.expire(now), gone => { if (gone?.length) toast(`没人理，没发出：${gone.map(t => t.title).join('、').slice(0, 40)}`); });
  }, 1000);
  const say = v => after(v, msg => { if (msg) toast(msg); });
  registerAll({
    // 切页。从刘海、详情里跳过去的顺手收起刘海；点侧栏的不动刘海
    nav: ({ d }) => { if (!d.side) store.hud('idle'); store.setView(d.v); },
    pause: () => after(store.togglePause(), r => toast(r.paused ? '已全部暂停：不再送出任何消息，正在干活的做完这一轮就停' : `继续了，停下的消息接着送${r.sent ? `（送出 ${r.sent} 件）` : ''}`)),
    // 跳回发起的对话：回到它自己的应用里
    jump: ({ d }) => say(store.openSession(d.s)),
    // 派活：指挥台的“派活”、总览里的“派活”。应用模式打开原生刘海
    compose: () => say(store.compose()),
    // 详情里的“给它发消息”（发给这个对话）和“新开对话派活”（对象选好，新开一个对话）
    msg: ({ d }) => { const s2 = by(st, d.s); if (s2) say(store.compose({ target: keyOf(s2), mode: 'msg', session: s2.id })); },
    new: ({ d }) => say(store.compose({ target: `${d.a}@${d.dev}`, mode: 'new' })),
    // 任务页里放行、拦下一件跨设备的任务：找到它在队里的那一件。打码后放行带 data-mask
    release: ({ d }) => { const i = st.Q.findIndex(q => q.band === d.id); if (i >= 0) doQ(store, i, true, { mask: !!d.mask }); },
    block: ({ d }) => { const i = st.Q.findIndex(q => q.band === d.id); if (i >= 0) doQ(store, i, false); },
  });
}
