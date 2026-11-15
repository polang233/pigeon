// 从状态里查东西、起名字。纯函数，第一个参数都是状态对象 st（见 store.js），不碰 DOM。
// 约定：本机是哪台一律读 st.home，不写死；指挥读 st.lead（{ kind: 'agent', agent, dev } 或 { kind: 'you' }）。
import { AG, APP } from './labels.js';

// “agent@设备”这种写法：规则、额度、派活对象都用它
export const agOf = k => k.split('@')[0];
export const dvOf = k => k.split('@')[1];
export const keyOf = s => `${s.agent}@${s.dev}`;
// 契约里的 { dev, agent } 和 “agent@设备” 互换
export const keyOfEnd = e => `${e.agent}@${e.dev}`;
export const endOf = k => ({ agent: agOf(k), dev: dvOf(k) });

// 你自己：你在 Pigeon 里派的活，发件人是这个（契约里 from.agent 是 you）
export const youOf = st => ({ id: 'you', agent: 'you', dev: st.home, title: '你在 Pigeon 里派的', state: 'idle', note: '' });
export const by = (st, id) => (id === 'you' ? youOf(st) : st.S.find(s => s.id === id));
export const kids = (st, s) => st.S.filter(x => x.parent === s.id);
export const tById = (st, id) => st.T.find(t => t.id === id);
export const ruleById = (st, id) => st.RULES.find(r => r.id === id);
export const cross = (st, t) => by(st, t.from).dev !== by(st, t.to).dev;

/* ---------- 指挥 ---------- */
export const isYou = st => st.lead.kind === 'you';
// 指挥在哪台：你自己当指挥时算本机
export const leadDev = st => (isYou(st) ? st.home : st.lead.dev);
export const leadKey = st => (isYou(st) ? 'you' : `${st.lead.agent}@${st.lead.dev}`);
// 指挥的那个对话：这个 agent 在那台上最近一次派活的对话；没派过活就是它在那台上的第一个对话；你当指挥时没有
export function leadSession(st) {
  if (isYou(st)) return null;
  const mine = st.S.filter(s => s.agent === st.lead.agent && s.dev === st.lead.dev && !s.parent);
  const t = st.T.find(t => mine.some(s => s.id === t.from)); // T 从新到旧
  return t ? by(st, t.from) : mine[0] || null;
}
// 能不能当指挥：接入页里能发出（out 不是 nope）、开着的 agent
export const canLead = (st, a, d) => (st.CONN[d] || []).some(c => c.a === a && c.on && c.out !== 'nope');
export const leadOptions = st => Object.keys(st.DEV).flatMap(d => (st.CONN[d] || []).filter(c => c.on && c.out !== 'nope').map(c => `${c.a}@${d}`));
// 能不能把活交给它：开着、并且能接收（inn 不是 nope）。第一版里本机的 Claude Code 还不能接收
export const canTake = c => !!c && c.on && c.inn !== 'nope';
// 读进来的指挥还能不能用：你自己，或者还接着、能发出的那个 agent
export const validLead = (st, l) => !!l && (l.kind === 'you' || (l.kind === 'agent' && canLead(st, l.agent, l.dev)));
// 设备名、规则文字里不留尖括号、引号和 &，最多 24 个字
export const cleanName = v => String(v || '').replace(/[<>"&]/g, '').trim().slice(0, 24);

// 一组对话合起来算什么状态：等你 > 出错 > 在干活 > 刚完成 > 空闲
export const worst = ss => ['wait', 'error', 'run', 'done', 'idle'].find(x => ss.some(s => s.state === x)) || 'idle';

// 设备改过名没有
export const named = (st, d) => st.DEV[d].name !== st.DEV[d].def;
// 没改过名时，本机叫“本机”，别的电脑取电脑名“-”前那一段；改过名就用新名字
export const shortDev = (st, d, full) => {
  const D = st.DEV[d];
  if (named(st, d)) return D.name;
  if (d === st.home) return '本机';
  return full ? D.name : D.name.split('-')[0];
};
export const nameOf = (st, k) => (k === 'you' ? '你' : `${AG[agOf(k)]?.name || agOf(k)}（${st.DEV[dvOf(k)] ? shortDev(st, dvOf(k), true) : '已移除的设备'}）`);
export const online = (st, d) => !!st.DEV[d] && st.DEV[d].online !== false;

// 回到它自己的应用里看这个对话。本机的在它自己的应用里打开，别的电脑上的经本机 Codex 的远程打开
export const jumpLabel = (st, s) => s.dev === st.home ? `在 ${APP[s.agent] || '它的应用'} 里打开` : st.DEV[s.dev]?.link === 'codex' ? '在本机 Codex 里打开' : '打开对话';

// 全部暂停，或者只停这一台
export const isPaused = (st, d) => st.paused.all || !!st.paused.dev[d];
// 协作的规矩里那一条开没开（cross 跨设备先问、relay 转派先问、split 拆 3 件以上先问）
export const askOn = (st, id) => st.RULES2.find(r => r.id === id)?.on !== false;

// 一个模型分哪几档思考强度（空的不分）；换模型时原来那档没有，就落到中间那档
export const levelsOf = (st, a, m) => (((st.MODELS[a] || []).find(x => x[0] === m) || [, ''])[1] || '').split(' ').filter(Boolean);
export const midLevel = lv => lv[Math.floor((lv.length - 1) / 2)] || '';

// 某台设备上开着的 agent
export const onAgents = (st, d) => (st.CONN[d] || []).filter(c => c.on);

// 刘海里等你的一件事，展开成界面要用的样子：from 发起的对话，to 发给谁（agent@设备），text 原文，title 一句话，t 对应的任务，parts 拆活的几件
export function qInfo(st, q) {
  const from = by(st, q.from.session) || youOf(st);
  if (q.kind === 'cross') {
    const t = q.band && tById(st, q.band);
    return { from, to: keyOfEnd(q.to), text: t ? (t.body || t.title) : q.preview, title: t ? t.title : q.preview, t };
  }
  if (q.kind === 'relay') return { from, to: keyOfEnd(q.to), text: q.preview, title: q.preview };
  return { from, parts: q.parts.map(p => [keyOfEnd(p.to), p.preview]), title: `把「${from.title}」拆成 ${q.parts.length} 件` };
}
// 这件事要送到的几台设备
export const qDevs = q => (q.kind === 'split' ? q.parts.map(p => p.to.dev) : [q.to.dev]);
// 跨设备那件还剩几秒
export const secsLeft = (q, now) => Math.max(0, Math.ceil((q.deadline - now) / 1000));
// 几分钟前
export const agoZh = (t, now) => { const m = Math.floor((now - t) / 60000); return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : `${Math.floor(m / 60)} 小时前`; };

// 移除一台设备会一起去掉多少：对话、任务、等你的一队里几件
export function removalImpact(st, d) {
  const ids = new Set(st.S.filter(s => s.dev === d).map(s => s.id));
  const tasks = st.T.filter(t => ids.has(t.from) || ids.has(t.to));
  const tids = new Set(tasks.map(t => t.id));
  const q = st.Q.filter(x => (x.band && tids.has(x.band)) || x.from.dev === d || qDevs(x).includes(d));
  return { sessions: ids.size, tasks: tasks.length, queue: q.length, isLead: !isYou(st) && st.lead.dev === d };
}
