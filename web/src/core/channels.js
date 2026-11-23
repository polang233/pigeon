// 项目频道（设计见 docs/CHANNELS.md）。纯逻辑，不碰 DOM（测试见 test/channels.test.mjs）。
// 0.3a 不存新数据：频道从对话的项目目录推出来。目录名相同的算同一个项目（本机的 ~/Code/pigeon 和 Windows 上的
// F:\Code\pigeon 是一个频道），任务归进干活那一方所在的频道。手动拉进来的成员按频道记在 extra 里。
import { AG } from './labels.js';
import { by, leadSession, keyOf, isYou, canTake } from './names.js';

// 目录的最后一段，Windows 路径也认
export const baseName = p => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
export const projectKey = p => baseName(p).toLowerCase();
export const chanIdOf = key => `p:${key}`;
// 没有项目目录的任务放在这个频道里
export const LOOSE = chanIdOf('');

// 对话的目录：子对话跟着父对话
export function cwdOf(st, s) {
  let x = s;
  for (let i = 0; x && !x.cwd && x.parent && i < 6; i++) x = by(st, x.parent);
  return x?.cwd || '';
}
// 顶层对话：子对话算在父对话头上
export function topOf(st, s) {
  let x = s;
  for (let i = 0; x?.parent && i < 6; i++) x = by(st, x.parent) || x;
  return x;
}

// 一件任务归哪个频道：看干活的那一方。发件的是你或指挥，就看收件的；收件的是你或指挥（比如回信），就看发件的
export function workerOf(st, t) {
  const L = leadSession(st), f = by(st, t.from), to = by(st, t.to);
  const boss = s => !s || s.id === 'you' || (L && topOf(st, s) === L);
  if (boss(f)) return to;
  if (boss(to)) return f;
  return to;
}
// 一件任务在哪个目录：干活那一方的目录；它没有目录（比如经 pigeon run 新开、对话列表里没有的占位对话），就用另一头的
export function taskCwd(st, t) {
  const w = workerOf(st, t), f = by(st, t.from), to = by(st, t.to);
  const other = w === f ? to : f;
  return (w && cwdOf(st, w)) || (other && other.id !== 'you' ? cwdOf(st, other) : '');
}
export const taskChan = (st, t) => chanIdOf(projectKey(taskCwd(st, t)));

// 排先后用的数：应用模式下任务有毫秒时间戳，演示模式按 T 里的位置（T 从新到旧）
export const seqOf = (st, t, i) => t.created || st.T.length - i;
// 现在发一条留言该排在哪：比所有已有的都靠后
export const seqNow = (st, now) => (st.mode === 'live' ? now : st.T.length + 0.5);

// 全部频道，最近有动静的在前。extra：{ 频道 id: [手动拉进来的对话 id] }
// 每个：{ id, key, name, paths: [{ dev, path }], lead（指挥那个对话的 id，你当指挥是 'you'）, members（不含指挥）, tasks, waiting, running, last }
export function channelsOf(st, extra = {}) {
  const map = new Map(), L = leadSession(st);
  const get = (key, path) => {
    const id = chanIdOf(key);
    if (!map.has(id)) map.set(id, { id, key, name: key ? baseName(path) : '没有项目目录', paths: [], lead: isYou(st) ? 'you' : L?.id || '', members: [], tasks: [], waiting: 0, running: 0, last: 0 });
    return map.get(id);
  };
  const join = (c, s) => {
    if (!s || s.id === 'you' || s.relay) return;
    s = topOf(st, s);
    if (s === L || c.members.includes(s.id)) return;
    c.members.push(s.id);
  };
  const addPath = (c, s) => { const p = cwdOf(st, s); if (p && !c.paths.some(x => x.dev === s.dev && x.path === p)) c.paths.push({ dev: s.dev, path: p }); };
  for (const s of st.S) {
    if (s.parent || s.relay || !s.cwd) continue;
    const c = get(projectKey(s.cwd), s.cwd);
    addPath(c, s);
    if (s !== L) join(c, s);
  }
  st.T.forEach((t, i) => {
    const w = workerOf(st, t), cwd = taskCwd(st, t), key = projectKey(cwd);
    const c = get(key, cwd);
    c.tasks.push(t.id);
    c.last = Math.max(c.last, seqOf(st, t, i));
    join(c, w);
    if (t.state === 'asking') c.waiting++;
  });
  for (const [id, ids] of Object.entries(extra)) {
    const c = map.get(id);
    if (c) ids.forEach(sid => join(c, by(st, sid)));
  }
  // 转派等你点头的那几件，算在发起转派的那个对话所在的频道
  for (const q of st.Q) {
    if (q.kind === 'cross') continue;
    const s = by(st, q.from.session), c = s && map.get(chanIdOf(projectKey(cwdOf(st, s))));
    if (c) c.waiting++;
  }
  const out = [...map.values()].filter(c => c.key || c.tasks.length);
  out.forEach(c => { c.running = c.members.filter(id => by(st, id)?.state === 'run').length + (c.lead && by(st, c.lead)?.state === 'run' ? 1 : 0); });
  return out.sort((a, b) => b.last - a.last || a.name.localeCompare(b.name));
}

export const chanById = (st, id, extra) => channelsOf(st, extra).find(c => c.id === id) || null;

// 一个频道里的消息，从旧到新。kind：task 派活、reply 回信、note 留言。
// 派活取回了回信的，回信紧跟在它后面（thread 指回那件派活）；本来就是回信的任务（kind 回信、没有 why）单独算一条回信
export function streamOf(st, ch, notes = []) {
  const ids = new Set(ch.tasks), out = [];
  st.T.forEach((t, i) => {
    if (!ids.has(t.id)) return;
    const seq = seqOf(st, t, i);
    if (t.kind === '回信' && !t.why) { out.push({ kind: 'reply', id: t.id, t, seq, from: t.from, own: true }); return; }
    out.push({ kind: 'task', id: t.id, t, seq });
    if (t.reply) out.push({ kind: 'reply', id: `${t.id}:r`, t, seq: seq + 0.01, from: t.to, thread: t.id });
  });
  for (const n of notes) out.push({ kind: 'note', id: n.id, seq: n.seq, text: n.text, time: n.time });
  return out.sort((a, b) => a.seq - b.seq);
}

// 未读：回信算，派活和留言不算（是你或指挥自己发的）
export const replyCount = msgs => msgs.filter(m => m.kind === 'reply').length;

// @ 的候选：先是频道里的对话（发给它），再是能接活、还不在频道里的 agent（新开一个对话）。q 是 @ 后面打的字
export function mentionsOf(st, ch, q = '') {
  const L = leadSession(st), out = [];
  const ok = s => s && !s.relay && canTake((st.CONN[s.dev] || []).find(c => c.a === s.agent));
  for (const id of [ch.lead, ...ch.members]) {
    const s = by(st, id);
    if (!ok(s)) continue;
    out.push({ k: keyOf(s), session: s.id, agent: s.agent, dev: s.dev, label: AG[s.agent].name, sub: s.title, lead: s === L, fresh: false });
  }
  for (const d of Object.keys(st.DEV)) for (const c of st.CONN[d] || []) {
    if (!canTake(c) || !st.DEV[d]) continue;
    out.push({ k: `${c.a}@${d}`, session: '', agent: c.a, dev: d, label: AG[c.a].name, sub: '新开对话', lead: false, fresh: true });
  }
  const w = q.trim().toLowerCase();
  if (!w) return out;
  return out.filter(m => [m.label, m.sub, AG[m.agent].name, st.DEV[m.dev]?.name || ''].some(x => String(x).toLowerCase().includes(w)));
}

// 输入框里光标前面是不是正在打一个 @：返回 { at: @ 的位置, q: 后面打的字 }，不是返回 null
export function mentionAt(text, caret) {
  const before = text.slice(0, caret), i = before.lastIndexOf('@');
  if (i < 0) return null;
  if (i > 0 && /[\w@]/.test(before[i - 1])) return null; // 邮箱这种不算
  const q = before.slice(i + 1);
  if (/\s/.test(q) || q.length > 16) return null;
  return { at: i, q };
}

// 发出去交给谁：选了 @ 的就是那几个；一个都没选就交给指挥（你当指挥、或者指挥没有能接活的对话时，返回空，要你 @ 一个）
export function targetsOf(st, ch, picks) {
  if (picks.length) return picks;
  const s = ch.lead && ch.lead !== 'you' ? by(st, ch.lead) : null;
  return s ? [{ k: keyOf(s), session: s.id, agent: s.agent, dev: s.dev, label: AG[s.agent].name, sub: s.title, lead: true, fresh: false }] : [];
}
