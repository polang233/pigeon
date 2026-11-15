// 订阅额度：magpie 的额度卡怎么对上 agent，界面上怎么说。纯函数，不碰 DOM（测试见 test/quota.test.mjs）。
// 一条额度（SUB 里的一项）：left 剩百分之几，win 哪个时间窗，reset 或 resetAt 多久后重置，more 补一句；
// bal 是按量付费的余额，none 是读不到、why 说为什么；src 有值就是读来的。
import { rst } from './time.js';

// 颜色：低于 20% 红，低于一半黄，其余绿
export const qc = left => left < 20 ? 'var(--wait)' : left < 50 ? 'var(--run)' : 'var(--ok)';
// 悬停时的一句话
export const qTip = (q, now) => q.none ? q.why
  : q.bal != null ? `按量付费 · ${q.plan} 余额 ${q.bal}${q.more ? ' · ' + q.more : ''}`
  : `${q.plan} · ${q.win}剩 ${q.left}% · ${rst(q, now)}${q.more ? ' · ' + q.more : ''}`;

// 按 agent 用的那家订阅对上 magpie 的额度卡：[magpie 里的 provider, 显示的名字]
export const PROV = { claude: ['claude', 'Claude'], codex: ['codex', 'ChatGPT'], cursor: ['cursor', 'Cursor'], dsh: ['deepseek', 'DeepSeek'] };
const PLAN = { prolite: 'Pro Lite', pro: 'Pro', plus: 'Plus', max: 'Max', team: 'Team', premium: 'Premium', business: 'Business' };
const WIN = { '5 hours': '5 小时额度', '7 days': '7 天额度', weekly: '本周额度', month: '本月额度', monthly: '本月额度', daily: '今天的额度', day: '今天的额度' };
const winZh = n => WIN[String(n).toLowerCase()];

// magpie 的 /v1/magpie/quotas 给的卡 → 本机（home）几家 agent 的额度，键是“agent@home”。
// 同一家有几个账号时用最近答话的那个（last，没有就看 lastServedAt）；时间窗取用得最多的那个，别的时间窗补在后面。
// 带 from 的卡是别的电脑上的 magpie，这里不管。
export function fromCards(cards, home) {
  const out = {};
  for (const a in PROV) {
    const [pv, label] = PROV[a], k = `${a}@${home}`, cs = cards.filter(c => c.provider === pv && !c.from);
    if (!cs.length) { out[k] = { none: true, why: `magpie 里没有 ${label} 的额度`, src: 'magpie' }; continue; }
    const c = cs.find(x => x.last) || [...cs].sort((x, y) => Date.parse(y.lastServedAt || 0) - Date.parse(x.lastServedAt || 0))[0];
    const many = cs.length > 1 ? `共 ${cs.length} 个${c.kind === 'balance' ? '' : '账号'}，这是最近用的` : '';
    const plan = `${label}${c.plan ? ' ' + (PLAN[c.plan.toLowerCase()] || c.plan) : ''}`;
    if (c.kind === 'balance') {
      const bal = String(c.balance || '?').replace('-0.00', '0.00');
      out[k] = { plan: `magpie 里的 ${label} key`, bal, warn: !/[1-9]/.test(bal), more: many, src: 'magpie' };
      continue;
    }
    const ws = (c.windows || []).filter(w => !w.lane && !w.text && !w.unlimited && w.resetsAt && winZh(w.name));
    if (!ws.length) { out[k] = { none: true, why: c.error ? `magpie 这次没读到 ${label} 的额度` : `${plan} 没有按时间窗算的额度`, src: 'magpie' }; continue; }
    const w = ws.reduce((x, y) => (y.used > x.used ? y : x)), o = ws.find(x => x !== w);
    out[k] = { plan, left: Math.max(0, Math.round(100 - w.used)), win: winZh(w.name), resetAt: Date.parse(w.resetsAt),
      more: [o && `${winZh(o.name).replace(/的?额度$/, '')}剩 ${Math.max(0, Math.round(100 - o.used))}%`, many].filter(Boolean).join(' · '), src: 'magpie' };
  }
  return out;
}

// 额度有没有变：resetAt 每次读都可能差几秒，不算
export const quotaSig = (state, SUB) => state + JSON.stringify(SUB, (key, v) => (key === 'resetAt' ? undefined : v));
