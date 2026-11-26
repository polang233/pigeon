// 指挥台一台设备一页：页上有哪些节点、谁连谁、连线上在发生什么、头像该做什么动作。纯函数，不碰 DOM。
// 节点：kind 是 lead（指挥）、you（你自己当指挥）、agent、group（收起的设备卡片）；from 是它挂在哪个节点下（-1 是中心）；ids 是它的对话。
import { AG, LIVE } from './labels.js';
import { by, kids, worst, isYou, leadDev, leadSession } from './names.js';

// 一组对话连同它们拆出的子对话
export const family = (st, ss) => ss.flatMap(s => [s.id, ...kids(st, s).map(k => k.id)]);

// 指挥在它那台上的全部对话（不含子对话）：指挥是“某台上的某个 agent”，那台上它的每个对话都能派活，都算指挥。
// 最近派过活的那个排第一，其余照原来的顺序
export function leadSessions(st) {
  const L = leadSession(st);
  if (!L) return [];
  return [L, ...st.S.filter(s => s !== L && s.agent === L.agent && s.dev === L.dev && !s.parent)];
}

// 一台设备那一页。st.ui.open[设备] 为真时，那台远程设备在指挥那页上是展开的
export function devicePage(st, d) {
  const L = leadSession(st), you = isYou(st), LD = leadDev(st), D = st.DEV[d], here = d === LD, nodes = [], at = {};
  const LA = you ? null : st.lead.agent;
  const add = n => nodes.push(n) - 1;
  const sess = (dv, a) => st.S.filter(s => s.dev === dv && s.agent === a && !s.parent);
  const on = st.CONN[d].filter(c => c.on), gate = on.find(c => c.role === 'gate');
  // 指挥不在这台：指挥那台整台收成一张卡片放在最左边（和指挥那页上收起的远程设备一样），线从卡片出去
  const root = -1;
  for (const c of on.filter(c => c.role !== 'via')) {
    if (here && c.a === LA) continue; // 指挥自己就是这个 agent，它的对话都画在中心，不再另画一个
    at[c.a] = add({ kind: 'agent', key: `a:${c.a}`, a: c.a, dev: d, label: AG[c.a].name, ids: family(st, sess(d, c.a)), from: root, gate: c.role === 'gate', link: here ? '' : D.link, sel: { t: 'agent', a: c.a, d } });
  }
  for (const c of on.filter(c => c.role === 'via'))
    add({ kind: 'agent', key: `v:${c.a}`, via: gate ? gate.a : '', a: c.a, dev: d, label: AG[c.a].name, ids: family(st, sess(d, c.a)), from: gate ? at[gate.a] : root, sel: { t: 'agent', a: c.a, d } });
  // 别的设备：经 Codex 连的，线从本机的 Codex 出去；SSH 从指挥直接出去。默认收成一张卡片
  if (here) for (const od of Object.keys(st.DEV)) if (od !== d) {
    const R = st.DEV[od], ron = st.CONN[od].filter(c => c.on), from = R.link === 'codex' && at.codex != null ? at.codex : -1;
    if (!st.ui.open[od]) { add({ kind: 'group', key: `g:${od}`, dev: od, label: R.name, link: R.link, from, ids: family(st, st.S.filter(s => s.dev === od && !s.parent)), agents: ron.map(c => c.a), go: od }); continue; }
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
    : { kind: 'lead', key: 'lead', a: LA, dev: LD, label: AG[LA].name, ids: family(st, leadSessions(st)), sel: L ? { t: 'session', id: L.id } : { t: 'agent', a: LA, d: LD } };
  return { key: d, os: D.os, title: D.name, nodes, center };
}
export const pagesOf = st => Object.keys(st.DEV).map(d => devicePage(st, d));

// 一个节点的状态：等你 > 出错 > 在干活 > 刚完成 > 空闲
// 指挥也一样，它的几个对话里有一个在等你，它就是在等你
export const stateOf = (st, n) => n.kind === 'you' ? 'idle' : worst(n.ids.map(id => by(st, id)));
// 第 k 个节点连同挂在它下面的全部节点的对话
export const deepIds = (p, k) => [...p.nodes[k].ids, ...p.nodes.flatMap((o, j) => o.from === k ? deepIds(p, j) : [])];
export const parentOf = (p, k) => p.nodes[k].from < 0 ? p.center : p.nodes[p.nodes[k].from];
// 一个对话画在这一页的哪个节点上：0 是中心，k + 1 是第 k 个节点，-1 是不在这一页
export function nodeOf(p, id) {
  if ((p.center.ids || []).includes(id)) return 0;
  const k = p.nodes.findIndex(n => n.ids.includes(id));
  return k >= 0 ? k + 1 : -1;
}
// 从节点 j 往上一直走到中心：[j, 它挂在谁下面, …, 0]
const upTo0 = (p, j) => { const out = [j]; while (j > 0) { j = p.nodes[j - 1].from + 1; out.push(j); } return out; };
// 一件任务在这一页上走的路线。发信的是中心（指挥，或者你自己派的活）时照旧画在收信那段线上，返回 null。
// 别的 agent 发的：你自己当指挥时，Pigeon 在中间转一手，路线是“发信方 → 你 → 收信方”，画成一整条；
// 有指挥时，两个 agent 之间直接传，不经指挥：两边各自走到挂在中心下面的那一层，中间那一跳（peer）直接连过去。
// hops 是依次经过的节点编号，peer 是直连那一跳在 hops 里的起点（没有是 -1）
export function routeOf(st, p, t) {
  const a = nodeOf(p, t.from), b = nodeOf(p, t.to);
  if (a < 1 || b < 0 || a === b) return null;
  const ua = upTo0(p, a), ub = upTo0(p, b), top = ua.find(x => ub.includes(x));
  const up = ua.slice(0, ua.indexOf(top) + 1), down = ub.slice(0, ub.indexOf(top)).reverse();
  if (top === 0 && p.center.kind !== 'you') {
    const hops = [...up.slice(0, -1), ...down];
    return { hops, peer: up.length - 2 };
  }
  return { hops: [...up, ...down], peer: -1 };
}
// 这一页上要整条画出来的路线：在送的（live）和停在半路等你确认的（wait）。a 是发信方，鸽子跟它的颜色
export function routesOf(st, p) {
  const out = [];
  for (const t of st.T) {
    const s = t.state === 'asking' ? 'wait' : LIVE.includes(t.state) ? 'live' : '';
    if (!s) continue;
    const r = routeOf(st, p, t);
    if (r) out.push({ ...r, t: t.id, st: s, a: by(st, t.from).agent, b: by(st, t.to).agent });
  }
  return out;
}
// 连到第 k 个节点的那段线上在发生什么：wait 停在跨设备那一段等你确认，live 往外送，back 回信往回走；a 是鸽子的颜色跟谁。
// 整条画成路线的任务（routesOf）不算在这里，鸽子沿着路线飞
export function edgeOf(st, p, k) {
  const n = p.nodes[k], ids = deepIds(p, k), crossing = n.dev !== parentOf(p, k).dev;
  const own = t => !routeOf(st, p, t);
  const t = st.T.find(t => t.state === 'asking' && ids.includes(t.to) && own(t));
  if (t && crossing) return { st: 'wait', a: by(st, t.from).agent };
  const f = st.T.find(t => LIVE.includes(t.state) && ids.includes(t.to) && own(t));
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
