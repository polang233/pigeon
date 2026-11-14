// 本机 magpie 的订阅额度。tools/serve.py 把 /magpie/quotas 转到 magpie 的 /v1/magpie/quotas?kept=1，
// 只给上次读到的，不去问厂商；转之前去掉了账号邮箱。卡怎么对上 agent 见 core/quota.js 的 fromCards。
// 读不到时：502 是 serve.py 连不上 magpie（页头写“magpie 没开”），别的错误（比如用普通静态服务打开）就全用示例数字。
import { fromCards, quotaSig } from '../core/quota.js';
import { hm } from '../core/time.js';
import { typing } from '../dom.js';

export function startMagpie(store) {
  const st = store.state;
  const demo = structuredClone(st.SUB); // 示例数字，读到真数据时只换掉本机那几家
  let sig = '', pending = null;

  async function read() {
    let state = 'demo', data = null, ver = st.MPQ.ver;
    try {
      const r = await fetch('/magpie/quotas', { cache: 'no-store' });
      if (r.ok) { data = (await r.json()).data || []; state = 'live'; } else if (r.status === 502) state = 'off';
    } catch (e) { state = 'demo'; }
    if (state === 'live' && !ver) { try { ver = (await (await fetch('/magpie/hello', { cache: 'no-store' })).json()).version || ''; } catch (e) { /* 版本号可有可无 */ } }
    const sub = { ...structuredClone(demo), ...(state === 'live' ? fromCards(data, st.home) : {}) };
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
}
