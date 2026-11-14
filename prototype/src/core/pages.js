// 指挥台一台设备一页：页上有哪些节点、谁连谁、连线上在发生什么、头像该做什么动作。纯函数，不碰 DOM。
// 节点：kind 是 lead（指挥）、you（你自己当指挥）、agent、group（收起的设备卡片）；from 是它挂在哪个节点下（-1 是中心）；ids 是它的对话。
import { AG, LIVE } from './labels.js';
import { by, kids, worst, isYou, leadDev, leadSession } from './names.js';

// 一组对话连同它们拆出的子对话
export const family = (st, ss) => ss.flatMap(s => [s.id, ...kids(st, s).map(k => k.id)]);

// 一台设备那一页。st.ui.open[设备] 为真时，那台远程设备在指挥那页上是展开的
export function devicePage(st, d) {
  const L = leadSession(st), you = isYou(st), LD = leadDev(st), D = st.DEV[d], here = d === LD, nodes = [], at = {};
  const LA = you ? null : st.lead.agent;
  const add = n => nodes.push(n) - 1;
  const sess = (dv, a) => st.S.filter(s => s.dev === dv && s.agent === a && s !== L && !s.parent);
  const on = st.CONN[d].filter(c => c.on), gate = on.find(c => c.role === 'gate');
  // 指挥不在这台：指挥那台整台收成一张卡片放在最左边（和指挥那页上收起的远程设备一样），线从卡片出去
  const root = -1;
  for (const c of on.filter(c => c.role !== 'via')) {
    if (here && c.a === LA && !sess(d, c.a).length) continue; // 指挥自己就是这个 agent
    at[c.a] = add({ kind: 'agent', key: `a:${c.a}`, a: c.a, dev: d, label: AG[c.a].name, ids: family(st, sess(d, c.a)), from: root, gate: c.role === 'gate', link: here ? '' : D.link, sel: { t: 'agent', a: c.a, d } });
  }
  for (const c of on.filter(c => c.role === 'via'))
    add({ kind: 'agent', key: `v:${c.a}`, via: gate ? gate.a : '', a: c.a, dev: d, label: AG[c.a].name, ids: family(st, sess(d, c.a)), from: gate ? at[gate.a] : root, sel: { t: 'agent', a: c.a, d } });
  // 别的设备：经 Codex 连的，线从本机的 Codex 出去；SSH 从指挥直接出去。默认收成一张卡片
  if (here) for (const od of Object.keys(st.DEV)) if (od !== d) {
    const R = st.DEV[od], ron = st.CONN[od].filter(c => c.on), from = R.link === 'codex' && at.codex != null ? at.codex : -1;
    if (!st.ui.open[od]) { add({ kind: 'group', key: `g:${od}`, dev: od, label: R.name, link: R.link, from, ids: family(st, st.S.filter(s => s.dev === od && s !== L && !s.parent)), agents: ron.map(c => c.a), go: od }); continue; }
    const rg = ron.find(c => c.role === 'gate'), rat = {};
    for (const c of ron.filter(c => c.role !== 'via'))
      rat[c.a] = add({ kind: 'agent', key: `r:${od}:${c.a}`, a: c.a, dev: od, label: AG[c.a].name, ids: family(st, sess(od, c.a)), from, gate: c.role === 'gate', link: R.link, remoteOf: od, sel: { t: 'agent', a: c.a, d: od } });
    for (const c of ron.filter(c => c.role === 'via'))
      add({ kind: 'agent', key: `r:${od}:${c.a}`, via: rg ? rg.a : '', a: c.a, dev: od, label: AG[c.a].name, ids: family(st, sess(od, c.a)), from: rg ? rat[rg.a] : from, remoteOf: od, sel: { t: 'agent', a: c.a, d: od } });
  }
  const H = st.DEV[LD], hon = st.CONN[LD].filter(c => c.on).map(c => c.a);
  const center = !here
    ? { kind: 'group', host: true, key: 'host', dev: LD, label: H.name, link: H.link, go: LD, via: D.link === 'codex' && hon.includes('codex') ? 'codex' : '',
      ids: family(st, st.S.filter(s => s.dev === LD && !s.parent)), agents: LA ? [LA, ...hon.filter(a => a !== LA)] : hon }
    : you ? { kind: 'you', key: 'you', a: 'you', dev: LD, label: '你', ids: [], sel: { t: 'you' } }
    : { kind: 'lead', key: 'lead', a: LA, dev: LD, label: AG[LA].name, ids: L ? family(st, [L]) : [], sel: L ? { t: 'session', id: L.id } : { t: 'agent', a: LA, d: LD } };
  return { key: d, os: D.os, title: D.name, nodes, center };
}
export const pagesOf = st => Object.keys(st.DEV).map(d => devicePage(st, d));

// 一个节点的状态：等你 > 出错 > 在干活 > 刚完成 > 空闲
export const stateOf = (st, n) => n.kind === 'you' ? 'idle' : n.kind === 'lead' ? (n.ids.length ? by(st, n.ids[0]).state : 'idle') : worst(n.ids.map(id => by(st, id)));
// 第 k 个节点连同挂在它下面的全部节点的对话
export const deepIds = (p, k) => [...p.nodes[k].ids, ...p.nodes.flatMap((o, j) => o.from === k ? deepIds(p, j) : [])];
export const parentOf = (p, k) => p.nodes[k].from < 0 ? p.center : p.nodes[p.nodes[k].from];
// 连到第 k 个节点的那段线上在发生什么：wait 停在跨设备那一段等你确认，live 往外送，back 回信往回走；a 是鸽子的颜色跟谁
export function edgeOf(st, p, k) {
  const n = p.nodes[k], ids = deepIds(p, k), crossing = n.dev !== parentOf(p, k).dev;
  const t = st.T.find(t => t.state === 'asking' && ids.includes(t.to));
  if (t && crossing) return { st: 'wait', a: by(st, t.from).agent };
  const f = st.T.find(t => LIVE.includes(t.state) && ids.includes(t.to));
  if (f) return { st: 'live', a: by(st, f.from).agent };
  const done = ids.map(id => by(st, id)).find(s => s.state === 'done');
  if (done) return { st: 'back', a: done.agent };
  return { st: '' };
}

// 正在用的模型和思考强度：在干活的那个对话的，没有就第一个对话的，再没有就接入里配的默认
export function modelOf(st, n) {
  if (n.kind === 'group' || n.kind === 'you') return null;
  const ss = n.ids.map(id => by(st, id)), s = ss.find(x => x.state === 'run') || ss[0];
  if (s) return { m: s.model, t: s.think, run: s.state === 'run' };
  const c = (st.CONN[n.dev] || []).find(x => x.a === n.a);
  return c && c.model ? { m: c.model, t: c.think, run: false } : null;
}

// 在做什么（契约里的 activity）→ 头像的动作（照 clawd-tank 的十个动作）。reading 没有专门的动作，用最近的“在想”；testing 用“搭建”
const POSE = { thinking: 'working-thinking', reading: 'working-thinking', typing: 'working-typing', building: 'working-building', testing: 'working-building', delegating: 'working-conducting', waiting: 'notification' };
// 头像此刻该做什么动作：等你提醒、出错挠头、完成开心、空闲发呆、还没对话睡觉；在干活时按 activity 挑。
// delegating：指挥是指挥的动作，别的 agent 有子代理在跑时杂耍
export function poseOf(st, n, s) {
  const ss = n.ids.map(id => by(st, id));
  if (s === 'wait') return 'notification';
  if (s === 'error') return 'working-confused';
  if (s === 'done') return 'happy';
  if (s === 'idle') return ss.length ? 'idle-living' : 'sleeping';
  const r = ss.find(x => x.state === 'run');
  if (!r) return 'working-typing';
  if (r.activity === 'delegating' && n.kind !== 'lead' && kids(st, r).some(k => k.state === 'run')) return 'working-juggling';
  return POSE[r.activity] || 'working-typing';
}

// 这一页算谁的对话：指挥那台收成的卡片不算，所以别的设备那页的“等你”和轮播只算这台自己的
export const pageSessions = (st, p) => [...new Set([p.center, ...p.nodes].filter(n => !n.host).flatMap(n => n.ids))].map(id => by(st, id));
// 底部轮播：这一页上正在发生的事，at 是对应的节点（1 起，0 是中心）
export function events(st, p) {
  const where = id => p.nodes.findIndex(n => n.ids.includes(id)) + 1;
  return st.T.filter(t => ['asking', ...LIVE, 'home'].includes(t.state)).map(t => ({ t, at: where(t.to) > 0 ? where(t.to) : where(t.from) })).filter(e => e.at > 0);
}
