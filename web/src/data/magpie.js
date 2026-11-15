// 本机 magpie 的订阅额度，两种模式都经同样的地址读：
//   应用模式：应用代读（契约“magpie”一节），/api/magpie/quotas、/api/magpie/hello
//   演示模式：tools/serve.py 转同样的两个地址
// 都是 magpie 上次读到的额度（不去问厂商），账号邮箱已经换成占位符。卡怎么对上 agent 见 core/quota.js 的 fromCards。
// 读不到时：502 是连不上 magpie（页头写“magpie 没开”）。
//   演示模式：别的错误（比如用普通静态服务打开）就全用示例数字；读到了也只换掉本机那几家，别的电脑上的还是示例。
//   应用模式：没有示例数字。读不到就写读不到；别的电脑上的额度还没有地方读。
import { fromCards, quotaSig } from '../core/quota.js';
import { hm } from '../core/time.js';
import { typing } from '../dom.js';

const none = why => ({ none: true, why });

export function startMagpie(store) {
  const st = store.state, live = st.mode === 'live';
  const demo = live ? {} : structuredClone(st.SUB); // 示例数字，读到真数据时只换掉本机那几家
  let sig = '', pending = null;

  // 应用模式下没读到的那几家怎么说
  function liveSub(state, data) {
    const out = {};
    for (const d of Object.keys(st.DEV)) for (const c of st.CONN[d] || []) {
      const k = `${c.a}@${d}`;
      out[k] = d !== st.home ? none('别的电脑上的额度还读不到') : none(state === 'off' ? 'magpie 没开，读不到额度' : '还没读到额度');
    }
    return state === 'live' ? { ...out, ...fromCards(data, st.home) } : out;
  }

  async function read() {
    let state = live ? 'off' : 'demo', data = null, ver = st.MPQ.ver;
    try {
      const r = await fetch('/api/magpie/quotas', { cache: 'no-store' });
      if (r.ok) { data = (await r.json()).data || []; state = 'live'; } else if (r.status === 502) state = 'off';
    } catch (e) { /* 连不上就按上面的默认 */ }
    if (state === 'live' && !ver) { try { ver = (await (await fetch('/api/magpie/hello', { cache: 'no-store' })).json()).version || ''; } catch (e) { /* 版本号可有可无 */ } }
    const sub = live ? liveSub(state, data) : { ...structuredClone(demo), ...(state === 'live' ? fromCards(data, st.home) : {}) };
    const mpq = { state, ver, cards: data ? data.length : 0, at: data && data.length ? hm(Math.max(...data.map(c => Date.parse(c.readAt || c.asOf || 0) || 0))) : '' };
    // 数字变了才通知（没变就只悄悄换上新的读取时间）；正在输入时先攒着，离开输入框再画，免得打断输入
    const s = quotaSig(state, sub);
    if (s === sig) { if (!pending) store.setQuota(sub, mpq, true); return; }
    sig = s;
    if (typing()) { pending = [sub, mpq]; return; }
    store.setQuota(sub, mpq);
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (pending && !typing()) { const [sub, mpq] = pending; pending = null; store.setQuota(sub, mpq); } }));

  read(); setInterval(read, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) read(); });
  // 应用模式：设备、接了哪些 agent 变了，没读到额度的那几家也要跟着补上
  if (live) store.on(['DEV'], () => { sig = ''; read(); });
}
