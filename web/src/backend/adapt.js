// 应用模式的适配层：把应用接口给的数据（docs/CONTRACT.md）换成界面用的形状（和 data/mock.js 一样），
// 以及界面改了以后要写回设置里的样子。纯函数，不碰 DOM，不发请求（测试见 test/adapt.test.mjs）。
//
// 接口上和界面里叫法不同的两处，只在这里换：
//   - 设备：接口里是 loft（本机固定是 local），界面里是 dev
//   - DeepSeek Harness：接口里是 deepseek，界面里是 dsh（图片文件名也用 dsh）
import { AG, ST, ACT, TH } from '../core/labels.js';
import { cleanName } from '../core/names.js';
import { whenZh, durZh } from '../core/time.js';

export const HOME = 'local';
export const fromWire = a => (a === 'deepseek' ? 'dsh' : a || '');
export const toWire = a => (a === 'dsh' ? 'deepseek' : a || '');
// “agent@设备”：设备 id 里可能有冒号，没有 @
const splitKey = k => { const i = String(k || '').indexOf('@'); return i < 0 ? [String(k || ''), ''] : [k.slice(0, i), k.slice(i + 1)]; };
export const keyFromWire = k => { if (!k) return ''; const [a, d] = splitKey(k); return `${fromWire(a)}@${d}`; };
export const keyToWire = k => { if (!k) return ''; const [a, d] = splitKey(k); return `${toWire(a)}@${d}`; };
export const endFromWire = e => ({ dev: e?.loft || HOME, agent: fromWire(e?.agent), session: e?.session || '' });
export const endToWire = e => ({ loft: e.dev, agent: toWire(e.agent), session: e.session || '' });

const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const oneLine = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const baseName = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
const STALE = 2 * 3600e3; // 契约：超过 2 小时没有新消息的纸条算过期
const WEEK = 7 * 86400e3;
const DONE_FOR = 10 * 60e3; // 刚完成：一轮结束后 10 分钟内

/* ---------- 纸条：GET /api/notes 和 SSE 的 PigeonNote 合成一份 ---------- */
const NOTE_STATES = ['asking', 'queued', 'flying', 'delivered', 'home', 'refused', 'lost'];
const TERMINAL = new Set(['home', 'refused', 'lost']);
const endpoint = (o, old = {}) => {
  const v = obj(o), out = { ...old };
  for (const k of ['loft', 'loft_name', 'agent', 'session', 'title']) if (v[k] != null && v[k] !== '') out[k] = String(v[k]);
  out.loft = out.loft || HOME; out.agent = out.agent || ''; out.session = out.session || ''; out.title = out.title || '';
  return out;
};
// 一条纸条的新消息合进已有的那条。已经回信、没发出、没回音的不会再回到路上；迟到的旧消息只补字段
export function mergeNote(prev, p, ts = Date.now()) {
  const n = prev ? { ...prev } : { band: p.band, chain: p.band, count: 1, kind: 'send', via: '', state: 'queued', from: endpoint(), to: endpoint(), preview: '', answer_preview: '', error: '', created: ts, updated: ts };
  for (const k of ['chain', 'kind', 'via', 'reply_to', 'retry_of', 'reason']) if (p[k]) n[k] = String(p[k]);
  if (Number(p.count) > 0) n.count = Number(p.count);
  if (p.from) n.from = endpoint(p.from, n.from);
  if (p.to) n.to = endpoint(p.to, n.to);
  if (p.preview) n.preview = oneLine(p.preview, 80);
  if (p.answer_preview) n.answer_preview = oneLine(p.answer_preview, 160);
  if (p.error != null && p.state) n.error = String(p.error || '');
  if (p.why && typeof p.why === 'object') n.why = p.why;
  if (p.ctx && typeof p.ctx === 'object') n.ctx = p.ctx;
  if ('paused' in p) n.paused = !!p.paused;
  if ('retryable' in p) n.retryable = !!p.retryable;
  if (p.created) n.created = Number(p.created);
  if (!prev && !p.created) n.created = Number(p.ts) || ts;
  n.updated = Math.max(Number(p.updated || p.ts) || ts, prev ? prev.updated : 0);
  const s = NOTE_STATES.includes(p.state) ? p.state : null;
  if (s && !(prev && TERMINAL.has(prev.state) && !TERMINAL.has(s))) n.state = s;
  // 暂停只叠在排队和等你确认上
  if (!['queued', 'asking'].includes(n.state)) delete n.paused;
  return n;
}

/* ---------- pigeon run：Claude Code 经包装层交给 Codex 的活（SSE 的 PigeonRun，旧名 MeerkatCodex） ---------- */
export function mergeRun(prev, p, ts = Date.now()) {
  if (p.phase === 'start') return { id: p.task_id, title: oneLine(p.title, 40) || 'Codex 任务', kind: p.kind || '', model: p.model || '', cwd: p.cwd || '', session: p.session_id || '', status: 'running', started: Number(p.ts) || ts, updated: ts, thread: '', detail: '', summary: '', files: [] };
  if (!prev) return null;
  const r = { ...prev, updated: ts };
  if (p.phase === 'thread') r.thread = p.thread_id || r.thread;
  if (p.phase === 'activity') r.detail = oneLine(p.detail, 80);
  if (p.phase === 'end') { r.status = p.status === 'done' ? 'done' : 'failed'; r.summary = oneLine(p.summary, 160); r.files = Array.isArray(p.files) ? p.files : []; r.thread = p.thread_id || r.thread; r.ended = ts; }
  return r;
}
const RUN_KIND = { image: '生图', review: '审查', code: '写代码' };

/* ---------- 分派规则的命中次数：近 7 天的纸条里，why.rule 是它的算一次；why.kind 是 override 的算“没照做” ---------- */
export function ruleHits(notes, now = Date.now()) {
  const out = {};
  for (const n of notes || []) {
    const w = n && n.why, at = Number(n?.created) || 0;
    if (!w || !w.rule || now - at > WEEK) continue;
    const h = (out[w.rule] ??= { n: 0, over: 0 });
    h.n++; if (w.kind === 'override') h.over++;
  }
  return out;
}

/* ---------- 规则在设置里的样子（dispatch.rules）和界面里的样子互换 ---------- */
export const rulesFromWire = (list, hits = {}) => (Array.isArray(list) ? list : []).filter(r => r && r.id).map(r => ({
  id: String(r.id), when: String(r.when || ''), kw: String(r.kw || ''), to: keyFromWire(r.to), fb: keyFromWire(r.fb || ''), ask: !!r.ask, on: r.on !== false,
  n: hits[r.id]?.n || 0, over: hits[r.id]?.over || 0,
}));
export const rulesToWire = list => list.map(r => ({ id: r.id, when: r.when, kw: r.kw, to: keyToWire(r.to), fb: keyToWire(r.fb), ask: !!r.ask, on: !!r.on }));

/* ---------- 协作的规矩：设置里的 post.* ---------- */
const withV = (opts, v) => (opts.includes(v) ? opts : [...opts, v].sort((x, y) => x - y));
export function rules2Of(settings) {
  const p = obj(settings.post), xto = Number(p.crossTimeoutSec) || 90, hops = Number(p.maxHops) || 10, wait = Number(p.waitTimeoutMin) || 10;
  return [
    { id: 'cross', t: '跨设备发送前先问我', tip: `往别的电脑发消息或新开对话前，排进刘海里等你的一队，点“放行”才发。关掉后 agent 可以不经你同意往别的电脑发`, kind: 'sw', on: p.confirmRemote !== false },
    { id: 'xto', t: '跨设备发送等多久没人点就不发', tip: '到点没人点，就记成“没人理，没发出”，和你点“拦下”分开记。最多 100 秒：Claude Code 跑一条命令默认只等 120 秒', kind: 'pick', v: xto, opts: withV([30, 60, 90, 100], xto), unit: '秒' },
    { id: 'relay', t: '接活的 agent 往下转派前问我', tip: '接活的 agent 想把活再交给别人时，先排进刘海里等你放行。第一版里接活的 agent 还不能往下转派，这条先记着', kind: 'sw', on: p.askRelay !== false },
    { id: 'split', t: '指挥一次拆给 3 件以上时问我', tip: '指挥想同时派出好几件时，先排进刘海里等你看一眼。第一版里还不会这样问，这条先记着', kind: 'sw', on: p.askSplit !== false },
    { id: 'hops', t: '连续来回上限', tip: '同一件事在 agent 之间最多传几次，到了就不再发，免得来回没完', kind: 'pick', v: hops, opts: withV([3, 5, 10, 20, 50], hops), unit: '次' },
    { id: 'wait', t: '等回信多久算没回音', tip: '发出去这么久还没有结果，就记成“没回音”，不会自动重发', kind: 'pick', v: wait, opts: withV([5, 10, 20, 30, 60, 120], wait), unit: '分钟' },
  ];
}
// 协作的规矩里每一条写在设置的哪里
export const RULE2_PATH = { cross: ['post', 'confirmRemote'], xto: ['post', 'crossTimeoutSec'], relay: ['post', 'askRelay'], split: ['post', 'askSplit'], hops: ['post', 'maxHops'], wait: ['post', 'waitTimeoutMin'] };

// 在设置对象里找到（没有就建出）这一层：at(s, ['devices', 'names'])
export const at = (o, path) => path.reduce((x, k) => (x[k] && typeof x[k] === 'object' && !Array.isArray(x[k]) ? x[k] : (x[k] = {})), o);
export const setAt = (o, path, v) => { at(o, path.slice(0, -1))[path.at(-1)] = v; return o; };

/* ---------- 设备和每台接了哪些 agent ---------- */
// 设备的系统图标：按对话、项目的路径猜，猜不出用一个普通的显示器
function osOf(l) {
  if (l.id === HOME) return 'mac';
  const paths = [...(l.sessions || []).map(s => s.cwd), ...(l.projects || []).map(p => p.path)].filter(Boolean).map(String);
  if (paths.some(p => /^[A-Za-z]:[\\/]/.test(p))) return 'win';
  if (paths.some(p => p.startsWith('/Users/'))) return 'mac';
  if (paths.some(p => p.startsWith('/home/'))) return 'linux';
  return 'win';
}
const effortOk = e => (TH[e] ? e : '');
const modelOf = (models, k) => { const m = obj(obj(models)[keyToWire(k)]); return { model: String(m.model || ''), think: m.model && String(m.model).startsWith('group/') ? '' : effortOk(m.effort) }; };

// 本机：检测到装了的才列。第一版里 Claude Code 能发出、还不能接收；Codex 能接收、只能回信；Cursor 和 DeepSeek Harness 还没接上
function localConn(detect, off, models) {
  const d = detect ? obj(detect) : null, has = a => !d || !!obj(d[toWire(a)]).installed, out = [];
  const det = a => (d ? obj(d[toWire(a)]) : {});
  const isOff = a => (Array.isArray(off) ? off : []).includes(toWire(a));
  if (has('claude')) out.push({ a: 'claude', how: ['plugin', 'hook'], out: 'yes', inn: 'nope', on: !isOff('claude'), model: '', think: '', det: det('claude') });
  if (has('codex')) out.push({ a: 'codex', how: ['codexapp'], out: 'nope', inn: 'yes', on: !isOff('codex'), ...modelOf(models, `codex@${HOME}`), det: det('codex') });
  for (const a of ['cursor', 'dsh']) if (d && det(a).installed) out.push({ a, how: [], out: 'nope', inn: 'nope', on: false, na: true, det: det(a) });
  return out;
}
// 远程：第一版只经 Codex 应用内连，Codex 是入口
const remoteConn = (id, off, models) => [{ a: 'codex', role: 'gate', how: ['inapp'], out: 'nope', inn: 'yes', on: !(Array.isArray(off) ? off : []).includes('codex'), ...modelOf(models, `codex@${id}`) }];

/* ---------- 对话 ---------- */
function sessionOf(s, dev) {
  const state = ST[s.state] ? s.state : 'idle', agent = fromWire(s.agent || 'codex');
  const note = state === 'error' ? (s.error || '出错了') : s.detail ? oneLine(s.detail, 80) : state === 'run' && ACT[s.activity] ? ACT[s.activity] : ST[state][0];
  return {
    id: String(s.id), agent, dev, title: oneLine(s.title, 40) || baseName(s.cwd) || '对话', state, ...(state === 'run' || state === 'wait' ? { activity: s.activity || (state === 'wait' ? 'waiting' : '') } : {}),
    ...(s.error ? { error: String(s.error) } : {}), model: String(s.model || ''), think: effortOk(s.effort), ...(s.parent ? { parent: String(s.parent) } : {}),
    note: s.relay ? `中继对话：往别的电脑发消息都经过它${note ? ' · ' + note : ''}` : note, cwd: s.cwd || '', ...(s.relay ? { relay: true } : {}), updated: Number(s.updated) || 0,
  };
}

/* ---------- 全部换一遍 ---------- */
// raw：{ lofts, detect, settings, notes: [...], runs: [...], queue: [...], codexModels: [...], mpModels: [...] }，都是接口原样给的
export function mapLive(raw, now = Date.now()) {
  const S0 = obj(raw.settings), dv = obj(S0.devices), names = obj(dv.names), hidden = new Set(Array.isArray(dv.hidden) ? dv.hidden : []), off = obj(dv.off), models = obj(dv.models);
  const lofts = (Array.isArray(raw.lofts?.lofts) ? raw.lofts.lofts : []).filter(l => l && l.id);
  if (!lofts.some(l => l.id === HOME)) lofts.unshift({ id: HOME, name: '这台 Mac', online: true, sessions: [] });

  const DEV = {}, CONN = {}, S = [], HIDDEN = [], NAMES = {};
  const addDev = (id, name, l) => {
    const def = name || (id === HOME ? '这台 Mac' : id), nm = cleanName(names[id]);
    DEV[id] = { name: nm || def, def, host: name || id, os: osOf(l || { id }), link: id === HOME ? 'local' : 'codex', online: (l ? l.online : true) !== false };
    if (nm && nm !== def) NAMES[id] = nm;
    CONN[id] = id === HOME ? localConn(raw.detect, off[HOME], models) : remoteConn(id, off[id], models);
  };
  for (const l of lofts) {
    if (l.id !== HOME && hidden.has(l.id)) { HIDDEN.push({ id: l.id, name: cleanName(names[l.id]) || l.name || l.id }); continue; }
    addDev(l.id, l.name, l);
    for (const s of l.sessions || []) if (s && s.id) S.push(sessionOf(s, l.id));
  }
  // 子对话的父对话不在列表里就当成普通对话
  const ids = new Set(S.map(s => s.id));
  S.forEach(s => { if (s.parent && !ids.has(s.parent)) delete s.parent; });

  // 纸条、队列里提到、但对话列表里没有的对话：补一个占位的。设备被移除了就不显示这件；设备不认识（列表里没有）就补一台
  const find = (dev, sid) => S.find(s => s.dev === dev && s.id === sid);
  function party(e, tag, { title = '', state = 'idle' } = {}) {
    const a = fromWire(e.agent);
    if (a === 'you') return 'you';
    if (!AG[a]) return null;
    const dev = e.loft || HOME;
    if (dev !== HOME && hidden.has(dev)) return null;
    if (!DEV[dev]) addDev(dev, e.loft_name || '', null);
    if (e.session) { const s = find(dev, e.session); if (s) return s.id; }
    const id = e.session || `${a}@${dev}#${tag}`;
    if (!S.some(s => s.id === id)) S.push({ id, agent: a, dev, title: oneLine(e.title || title, 40) || (e.session ? '没列出的对话' : '新开的对话'), state, model: '', think: '', note: e.session ? '这个对话不在最近的对话列表里' : '还没建好的对话', stub: true });
    return id;
  }

  const notes = (Array.isArray(raw.notes) ? raw.notes : []).filter(n => n && n.band);
  const queue = (Array.isArray(raw.queue) ? raw.queue : []).filter(q => q && q.id && ['cross', 'relay', 'split'].includes(q.kind));
  const qByBand = new Map(queue.filter(q => q.band).map(q => [q.band, q]));
  const T = [];
  const live = s => ['queued', 'flying', 'delivered', 'asking'].includes(s);
  for (const n of notes) {
    const from = party(endpoint(n.from), `${n.band}:from`), to = party(endpoint(n.to), n.band, { title: n.kind === 'new' ? n.preview : '' });
    if (!from || !to) continue;
    let state = NOTE_STATES.includes(n.state) ? n.state : 'queued';
    const stale = live(state) && state !== 'asking' && now - (Number(n.updated) || 0) > STALE;
    if (stale) state = 'lost';
    const q = qByBand.get(n.band), w = n.why && typeof n.why === 'object' ? n.why : null, c = n.ctx && typeof n.ctx === 'object' ? n.ctx : null;
    const created = Number(n.created) || now, ended = live(state) ? now : Number(n.updated) || created;
    T.push({
      id: n.band, time: whenZh(created, now), created, from, to, kind: n.reply_to ? '回信' : n.kind === 'new' ? '新开对话' : '发消息',
      // 任务记录里不存正文，预览只在应用开着时经事件送到；应用重启后只剩对话标题，再没有就照实说
      title: n.preview || n.to?.title || '（内容没保存）', state, dur: durZh(ended - created),
      ...(state === 'refused' && n.reason ? { reason: n.reason } : {}),
      ...(w && !n.reply_to ? { why: { kind: w.kind || 'lead', ...(w.rule ? { rule: String(w.rule) } : {}), ...(w.suggested ? { suggested: { agent: fromWire(w.suggested.agent), dev: w.suggested.loft || HOME } } : {}), ...(w.reason ? { reason: String(w.reason) } : {}) } } : {}),
      ...(c && Number(c.tokens) >= 0 ? { ctx: { tokens: Number(c.tokens) || 0, window: Number(c.window) || 0, files: Array.isArray(c.files) ? c.files.map(String) : [] } } : {}),
      ...(n.retry_of ? { retry_of: n.retry_of } : {}), ...(n.paused && ['queued', 'asking'].includes(state) ? { paused: true } : {}),
      ...(n.answer_preview ? { reply: n.answer_preview } : {}), ...(n.retryable ? { retryable: true } : {}), ...(n.error ? { error: String(n.error) } : {}),
      ...(stale ? { stale: true } : {}), ...(q?.text ? { body: String(q.text) } : {}), via: n.via || '',
    });
  }
  // 队列里有、纸条还没到的：先按队列里的样子记一件“等你确认”
  const seen = new Set(T.map(t => t.id));
  for (const q of queue) if (q.kind === 'cross' && !seen.has(q.band || q.id)) {
    const from = party(endpoint(q.from), `${q.id}:from`), to = party(endpoint(q.to), q.id);
    if (!from || !to) continue;
    const created = Number(q.created) || now;
    T.push({ id: q.band || q.id, time: whenZh(created, now), created, from, to, kind: '发消息', title: q.preview || '（没有内容预览）', state: 'asking', dur: durZh(now - created), ...(q.text ? { body: String(q.text) } : {}), via: '' });
  }
  // pigeon run：只在应用开着时从 SSE 收到的
  for (const r of Array.isArray(raw.runs) ? raw.runs : []) {
    if (!r || !r.id) continue;
    const recent = r.ended && now - r.ended < DONE_FOR, sstate = r.status === 'running' ? 'run' : recent ? 'done' : 'idle';
    const from = r.session && find(HOME, r.session) ? r.session : party({ loft: HOME, agent: 'claude', session: '' }, 'run-lead', { title: 'Claude Code 的对话' });
    const to = r.thread && find(HOME, r.thread) ? r.thread : party({ loft: HOME, agent: 'codex', session: '' }, `run:${r.id}`, { title: r.title, state: sstate });
    if (!from || !to) continue;
    const ss = S.find(s => s.id === to); if (ss?.stub) { ss.state = sstate; ss.note = r.status === 'running' ? (r.detail || '经 pigeon run 在跑') : r.summary || '跑完了'; if (r.model) ss.model = r.model; }
    T.push({ id: r.id, time: whenZh(r.started, now), created: r.started, from, to, kind: RUN_KIND[r.kind] || '派活', title: r.title, dur: durZh((r.ended || now) - r.started),
      state: r.status === 'running' ? (r.thread ? 'delivered' : 'flying') : r.status === 'done' ? 'home' : 'failed', ...(r.summary ? { reply: r.summary } : {}), via: 'run', files: r.files || [] });
  }
  T.sort((a, b) => b.created - a.created);

  const Q = [];
  for (const q of queue) {
    const from = party(endpoint(q.from), `${q.id}:from`);
    const parts = Array.isArray(q.parts) ? q.parts.map(p => ({ to: endFromWire(p.to), preview: String(p.preview || '') })) : undefined;
    if (!from || (q.kind !== 'split' && !party(endpoint(q.to), q.band || q.id))) continue;
    Q.push({ id: String(q.id), kind: q.kind, ...(q.band ? { band: q.band } : {}), from: { ...endFromWire(q.from), session: from === 'you' ? '' : from }, ...(q.to ? { to: endFromWire(q.to) } : {}), ...(parts ? { parts } : {}),
      preview: String(q.preview || ''), ...(q.rule ? { rule: String(q.rule) } : {}), created: Number(q.created) || now, ...(q.deadline ? { deadline: Number(q.deadline) } : {}),
      ...(Array.isArray(q.secrets) && q.secrets.length ? { secrets: q.secrets.map(String) } : {}), ...(q.text ? { text: String(q.text) } : {}),
      ...(q.chars ? { chars: Number(q.chars) } : {}), ...(Array.isArray(q.files) ? { files: q.files.map(String) } : {}), ...(q.paused ? { paused: true } : {}) });
  }

  const L = obj(S0.lead), lead = L.kind === 'you' ? { kind: 'you' } : { kind: 'agent', agent: fromWire(L.agent || 'claude'), dev: L.loft || HOME };
  const P = obj(S0.paused), q0 = obj(S0.quota), mpModels = Array.isArray(raw.mpModels) ? raw.mpModels : [];
  const efforts = m => (Array.isArray(m.efforts) ? m.efforts : []).filter(e => TH[e]).join(' ');
  const groups = mpModels.filter(m => String(m.id || '').startsWith('group/'));
  return {
    mode: 'live', home: HOME, DEV, CONN, NAMES, HIDDEN, S, T, Q, lead,
    RULES: rulesFromWire(obj(S0.dispatch).rules, ruleHits(notes, now)), LOW: Number(q0.low) || 20, RULES2: rules2Of(S0),
    paused: { all: !!P.all, dev: { ...obj(P.lofts) } },
    settings: { notch: obj(S0.perch).notch === false ? 'off' : 'on', quota: q0.show === 'always' ? 'always' : 'hover', secrets: ['warn', 'mask', 'off'].includes(obj(S0.secrets).mode) ? S0.secrets.mode : 'warn', crossTimeoutSec: Number(obj(S0.post).crossTimeoutSec) || 90 },
    MODELS: { claude: [], codex: (Array.isArray(raw.codexModels) ? raw.codexModels : []).filter(m => m && m.slug).map(m => [String(m.slug), efforts(m), String(m.name || m.slug)]), cursor: [], dsh: [] },
    DEF_MODEL: { claude: ['', ''], codex: ['', ''], cursor: ['', ''], dsh: ['', ''] },
    CODEXM: (Array.isArray(raw.codexModels) ? raw.codexModels : []).filter(m => m && m.slug).map(m => ({ slug: String(m.slug), name: String(m.name || m.slug), efforts: (Array.isArray(m.efforts) ? m.efforts : []).map(String) })),
    MAGPIE: { on: groups.length > 0, groups: groups.map(m => [String(m.id), m.context_window ? `magpie 的路由组 · 上下文 ${Math.round(m.context_window / 1000)}k` : 'magpie 的路由组']) },
    CTXW: Object.fromEntries(mpModels.filter(m => m.id && m.context_window).map(m => [String(m.id), Number(m.context_window)])),
    FOUND: [], MP_FOUND: [], PLAN: [], DEMO: { openTask: '', reply: '', target: `codex@${HOME}`, clock: '' },
  };
}

// PUT /api/dispatch 的请求体：写进指挥提示的原文（指挥是你时为空串）、阈值、各家额度、能接活的对象
export const dispatchBody = (text, st, alive) => ({
  text: text || '', low: st.LOW,
  quota: Object.fromEntries(Object.entries(st.SUB).filter(([, q]) => q && q.left != null).map(([k, q]) => [keyToWire(k), q.left])),
  alive: alive.map(keyToWire),
});
