// 应用后端：页面由 Pigeon 应用的本机服务打开时用。所有数据都是真的，经 HTTP 读写、经 SSE（/events）收更新。
// 和 backend/demo.js 的方法名一样，返回 Promise（规则表这类打字的除外：马上改界面，后台存，存失败再提示）。
// 收到的数据原样存在 raw 里，每次变了用 adapt.js 的 mapLive 整份换一遍，只发真的变了的话题。
// 不假装成功：接口回错就把它的错误交给页面去提示（返回被拒绝的 Promise，或者调 notify）。
//
// 用到的接口见 docs/CONTRACT.md；具体哪几个字段，写在每个函数旁边。
import { mapLive, mergeNote, mergeRun, rulesToWire, RULE2_PATH, at, setAt, keyToWire, toWire, dispatchBody } from './adapt.js';
import { settingsWriter } from './settings.js';
import { by, tById, isPaused, validLead, cleanName, levelsOf, midLevel, removalImpact, jumpLabel } from '../core/names.js';
import { promptText, targets } from '../core/route.js';
import { createDemo } from './demo.js';

/* ---------- 发请求 ---------- */
// 回 JSON；状态码不是 2xx、或者回的是 { ok: false } 就当失败，错误文字用接口给的 error
export async function api(path, { method = 'GET', body } = {}) {
  let r;
  try {
    r = await fetch(path, { method, cache: 'no-store', ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  } catch (_) { throw new Error('连不上 Pigeon 应用'); }
  let j = null;
  try { j = await r.json(); } catch (_) { /* 有的接口只回状态码 */ }
  if (!r.ok || (j && j.ok === false)) {
    const e = new Error((j && j.error) || (r.status === 501 ? '应用还不支持这个' : `应用回了 ${r.status}`));
    e.status = r.status; throw e;
  }
  return j;
}

// 页面由应用打开的吗：GET /api/lofts 回的是 { lofts: [...] } 就是
export async function probeLive() {
  try {
    const r = await fetch('/api/lofts', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && Array.isArray(j.lofts) ? j : null;
  } catch (_) { return null; }
}

const MAX_NOTES = 100, MAX_RUNS = 30;
const get = path => api(path);

// 读一遍全部，建好后端。notify(文字) 用来说后台出的错（底部提示）
export async function connectLive(lofts0, { notify = () => {} } = {}) {
  const raw = { lofts: lofts0, detect: null, settings: {}, queue: [], codexModels: [], mpModels: [], usage: null, hooks: null };
  const notes = new Map(), runs = new Map();
  const view = () => ({ ...raw, notes: [...notes.values()], runs: [...runs.values()] });

  function takeNotes(list) {
    for (const n of Array.isArray(list) ? list : []) if (n && n.band) notes.set(n.band, mergeNote(notes.get(n.band) || null, { ...n, ts: n.updated }, Number(n.updated) || Date.now()));
    trim();
  }
  function trim() {
    if (notes.size > MAX_NOTES) [...notes.values()].sort((a, b) => b.updated - a.updated).slice(MAX_NOTES).forEach(n => notes.delete(n.band));
    if (runs.size > MAX_RUNS) [...runs.values()].sort((a, b) => b.updated - a.updated).slice(MAX_RUNS).forEach(r => runs.delete(r.id));
  }
  // 全部读一遍：一开始、SSE 断了又连上时。读不到的那项留着上次的
  async function loadAll() {
    const want = {
      lofts: get('/api/lofts'), detect: get('/api/detect'), settings: get('/api/settings'), notes: get('/api/notes'), queue: get('/api/queue'),
      usage: get('/api/usage'), codexModels: get('/api/codex/models'), mpModels: get('/api/magpie/models'),
    };
    const keys = Object.keys(want), got = await Promise.allSettled(Object.values(want)), bad = [];
    got.forEach((g, i) => {
      const k = keys[i];
      if (g.status !== 'fulfilled') { if (!['mpModels', 'usage', 'codexModels'].includes(k)) bad.push(k); return; }
      const v = g.value;
      if (k === 'lofts' && v && Array.isArray(v.lofts)) raw.lofts = v;
      else if (k === 'detect' && v && typeof v === 'object') raw.detect = v;
      else if (k === 'settings') raw.settings = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      else if (k === 'notes') takeNotes(v?.notes);
      else if (k === 'queue') raw.queue = Array.isArray(v?.items) ? v.items : [];
      else if (k === 'usage') raw.usage = v && v.agents ? v : null;
      else if (k === 'codexModels') raw.codexModels = Array.isArray(v) ? v : [];
      else if (k === 'mpModels') raw.mpModels = Array.isArray(v?.data) ? v.data : [];
    });
    if (bad.length) notify(`有几样没读到（${bad.join('、')}），先按上次的显示`);
  }
  await loadAll();

  return {
    data: { ...mapLive(view()), SUB: {}, SRV: raw.settings, USAGE: raw.usage, HOOKS: null, link: true },
    backend: ctx => createLive(ctx, { raw, notes, runs, view, loadAll, takeNotes, trim, notify }),
  };
}

function createLive(ctx, { raw, notes, runs, view, loadAll, trim, notify }) {
  const { state: st, ui, emit, on, m } = ctx;
  const demo = createDemo(ctx); // 只借它改规则表的那几个方法：打字时先改界面，再由这里存
  const writer = settingsWriter(api);

  /* ---------- 整份换一遍：只发真的变了的话题；正在打字的地方先不重画 ---------- */
  const sigs = {};
  const GROUPS = { DEV: ['DEV', 'CONN', 'NAMES', 'HIDDEN', 'MODELS', 'CODEXM', 'MAGPIE', 'CTXW', 'DEF_MODEL'], S: ['S'], T: ['T'], Q: ['Q'], RULES: ['RULES', 'LOW'], RULES2: ['RULES2'], lead: ['lead'], paused: ['paused'] };
  const noDur = (k, v) => (k === 'dur' || k === 'time' ? undefined : v);
  let held = new Set();
  const holdNow = () => { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && (a.classList.contains('rename') || !!a.closest('.cpanel, .setpop, [data-part="rules"]')); };
  const out = topics => { if (!topics.length) return; if (holdNow()) topics.forEach(t => held.add(t)); else emit(...topics); };
  document.addEventListener('focusout', () => setTimeout(() => { if (held.size && !holdNow()) { const t = [...held]; held = new Set(); emit(...t); } }));
  function rebuild() {
    const d = mapLive(view(), Date.now()), changed = [];
    for (const [topic, keys] of Object.entries(GROUPS)) {
      const sig = JSON.stringify(keys.map(k => d[k]), topic === 'T' ? noDur : undefined);
      keys.forEach(k => { st[k] = d[k]; });
      if (sigs[topic] !== sig) { sigs[topic] = sig; changed.push(topic); }
    }
    for (const k of Object.keys(d.settings)) if (st.settings[k] !== d.settings[k]) { st.settings[k] = d.settings[k]; changed.push('settings.' + k); }
    const srv = JSON.stringify(raw.settings);
    if (sigs.SRV !== srv) { sigs.SRV = srv; st.SRV = raw.settings; changed.push('SRV'); }
    m.afterData();
    out(changed);
  }
  let soon = 0;
  const rebuildSoon = () => { if (!soon) soon = setTimeout(() => { soon = 0; rebuild(); }, 40); };
  // 第一遍：记下现在的样子，免得开头就重画一次
  for (const [topic, keys] of Object.entries(GROUPS)) sigs[topic] = JSON.stringify(keys.map(k => st[k]), topic === 'T' ? noDur : undefined);
  sigs.SRV = JSON.stringify(raw.settings);

  /* ---------- 改设置：本机先改（界面马上换），再 GET 完整设置、改、PUT 回去 ---------- */
  let lastWritten = '';
  const local = new Set(); // 本机已经改了、还没写进应用的
  const timers = new Map();
  function settle(saved) {
    lastWritten = JSON.stringify(saved);
    if (!local.size && !timers.size) { raw.settings = saved; rebuild(); }
  }
  async function refetchSettings() {
    try { raw.settings = (await get('/api/settings')) || {}; } catch (_) { /* 还是读不到就留着 */ }
    local.forEach(f => f(raw.settings)); rebuild();
  }
  function write(fn) {
    return writer.update(fn).then(saved => { local.delete(fn); settle(saved); return saved; },
      e => { local.delete(fn); refetchSettings(); throw new Error(`没存上：${e.message}`); });
  }
  // fn(设置) 就地改。返回写好后的 Promise
  function patch(fn) { fn(raw.settings); local.add(fn); rebuild(); return write(fn); }
  // 打字这类：本机马上改，停 600 毫秒再写；同一个 key 只写最后那次。存失败由 notify 说
  function patchSoon(key, fn) {
    const old = timers.get(key); if (old) { clearTimeout(old.t); local.delete(old.fn); }
    fn(raw.settings); local.add(fn);
    timers.set(key, { fn, t: setTimeout(() => { timers.delete(key); write(fn).catch(e => notify(e.message)); }, 600) });
  }
  const bg = p => { p.catch(e => notify(e.message)); };

  /* ---------- SSE：/events ---------- */
  let es = null, down = false, retry = 0;
  const setLink = v => { if (st.link !== v) { st.link = v; emit('link'); } };
  function connect() {
    es = new EventSource('/events');
    es.onopen = () => { retry = 0; if (down) { down = false; setLink(true); loadAll().then(rebuild); } };
    es.onerror = () => {
      down = true; setLink(false);
      // 浏览器会自己重连；连接被关掉了（比如服务回了错误）才由这里过几秒再连
      if (es.readyState === 2) { es.close(); setTimeout(connect, Math.min(15000, 2000 * ++retry)); }
    };
    es.onmessage = e => {
      let msg; try { msg = JSON.parse(e.data); } catch (_) { return; }
      handle(msg);
    };
  }
  // 推来的消息：detect、hook（PigeonNote、PigeonRun）、usage、settings、queue、lofts
  function handle(msg) {
    switch (msg.type) {
      case 'detect': if (msg.agents) { raw.detect = msg.agents; rebuildSoon(); } break;
      case 'lofts': if (msg.lofts && Array.isArray(msg.lofts.lofts)) { raw.lofts = msg.lofts; rebuildSoon(); } break;
      case 'queue': raw.queue = Array.isArray(msg.items) ? msg.items : []; rebuildSoon(); break;
      case 'usage': if (msg.usage && msg.usage.agents) { st.USAGE = msg.usage; emit('USAGE'); } break;
      case 'settings': {
        const s = msg.settings;
        if (!s || typeof s !== 'object' || JSON.stringify(s) === lastWritten) break;
        raw.settings = s; local.forEach(f => f(raw.settings)); rebuildSoon();
        break;
      }
      case 'hook': {
        const p = msg.payload || {}, ev = p.hook_event_name, ts = Number(msg.ts) || Date.now();
        if (p.source === 'codex') break; // Codex 自己的事件：对话的状态由应用算好放进 lofts 里
        if (ev === 'PigeonNote' && p.band) { notes.set(p.band, mergeNote(notes.get(p.band) || null, p, ts)); trim(); rebuildSoon(); }
        else if ((ev === 'PigeonRun' || ev === 'MeerkatCodex') && p.task_id) { const r = mergeRun(runs.get(p.task_id) || null, p, ts); if (r) { runs.set(r.id, r); trim(); rebuildSoon(); } }
        break;
      }
    }
  }
  connect();
  // 对话列表一分钟再读一次（远程电脑上的变化不一定有推送）
  setInterval(() => { if (!down) get('/api/lofts').then(v => { if (v && Array.isArray(v.lofts)) { raw.lofts = v; rebuildSoon(); } }, () => {}); }, 60000);
  // 时间说法（几分钟前、用了多久）跟着走
  setInterval(() => { if (!document.hidden) rebuild(); }, 30000);

  /* ---------- 分派规则写进指挥提示：PUT /api/dispatch { text, low, quota, alive } ---------- */
  let dTimer = 0, lastD = '', lastDErr = '';
  function putDispatch() {
    const body = dispatchBody(promptText(st) || '', st, targets(st)), sig = JSON.stringify(body);
    if (sig === lastD) return;
    api('/api/dispatch', { method: 'PUT', body }).then(() => { lastD = sig; lastDErr = ''; }, e => { if (e.message !== lastDErr) { lastDErr = e.message; notify(`分派规则没交给 Pigeon 应用：${e.message}`); } });
  }
  on(['RULES', 'ruleText', 'RULES2', 'SUB', 'DEV', 'lead', 'settings.crossTimeoutSec'], () => { clearTimeout(dTimer); dTimer = setTimeout(putDispatch, 800); });
  setTimeout(putDispatch, 1500);

  /* ---------- 小工具 ---------- */
  const sid = s => (s && !String(s.id).includes('#') ? s.id : ''); // 占位的对话没有真的会话 id
  const wireEnd = s => ({ loft: s.dev, agent: toWire(s.agent), session: sid(s) });
  const devName = d => st.DEV[d]?.name || '那台';
  const rulesFn = () => s => { at(s, ['dispatch']).rules = rulesToWire(st.RULES); };
  const no = msg => Promise.reject(new Error(msg));
  const NOTCH = { confirm: 'queue' }; // 界面里叫 confirm，接口里叫 queue

  const be = {
    /* ---------- 暂停：POST /api/pause { on } 或 { loft, on } ---------- */
    togglePause() {
      const on1 = !st.paused.all;
      at(raw.settings, ['paused']).all = on1; rebuild();
      return api('/api/pause', { method: 'POST', body: { on: on1 } }).then(() => ({ paused: on1, sent: 0 }), e => { refetchSettings(); throw e; });
    },
    togglePauseDev(d) {
      const on1 = !st.paused.dev[d];
      at(raw.settings, ['paused', 'lofts'])[d] = on1; rebuild();
      return api('/api/pause', { method: 'POST', body: { loft: d, on: on1 } }).then(() => ({ paused: on1, sent: 0 }), e => { refetchSettings(); throw e; });
    },
    // 指挥：设置里的 lead
    setLead(l) {
      if (!validLead(st, l)) return Promise.resolve(false);
      const v = l.kind === 'you' ? { kind: 'you' } : { kind: 'agent', agent: toWire(l.agent), loft: l.dev };
      const p = patch(s => { s.lead = v; });
      ui.stage.sel = ctx.defaultSel(); emit('ui.stage.sel');
      return p.then(() => true);
    },
    retrySession() { return no('还不能在 Pigeon 里重试这个对话，到它自己的应用里看看'); },
    // 跳回对话：POST /api/open { loft, agent, session }
    openSession(id) {
      const s = by(st, id); if (!s) return no('这个对话已经不在了');
      return api('/api/open', { method: 'POST', body: wireEnd(s) }).then(() => `已${jumpLabel(st, s)}「${s.title}」`);
    },
    // 设置里刘海的演示：POST /api/notch { state, demo: true }，刘海用内置的示例内容演示，不动真数据
    notchDemo(state) {
      return api('/api/notch', { method: 'POST', body: { state: NOTCH[state] || state, target: '', session: '', band: '', demo: true } }).then(() => '刘海上在演示了');
    },
    // 派活：打开原生刘海的快速派活。POST /api/notch { state: 'compose', target, session }
    compose({ target, mode = 'new', session = '' } = {}) {
      const s = mode === 'msg' && by(st, session);
      return api('/api/notch', { method: 'POST', body: { state: 'compose', target: target ? keyToWire(target) : '', session: s ? sid(s) : '', band: '', demo: false } })
        .then(() => (s ? `在刘海上给「${s.title}」写消息` : '在刘海上派活'));
    },

    /* ---------- 设备和接入：设置里的 devices.* ---------- */
    renameDevice(d, v) {
      const D = st.DEV[d];
      if (!D || v == null) { emit('DEV'); return null; }
      const name = cleanName(v), old = D.name;
      const p = patch(s => { const n = at(s, ['devices', 'names']); if (name && name !== D.def) n[d] = name; else delete n[d]; });
      emit('DEV');
      const now = name || D.def;
      return p.then(() => (now === old ? null : name ? `改名为「${now}」` : `已恢复成「${D.def}」`));
    },
    setOnline() {},
    // 重新读一次远程电脑：POST /api/lofts/refresh（经中继对话，要花 token）
    refreshRemote() { return api('/api/lofts/refresh', { method: 'POST', body: {} }).then(() => '重新读了一次，远程电脑有变化会自己更新'); },
    reconnect() { return be.refreshRemote(); },
    toggleConn(d, a) {
      const c = (st.CONN[d] || []).find(x => x.a === a); if (!c || c.na) return no('它还没接上，开不了');
      const w = toWire(a), turnOn = !c.on;
      return patch(s => { const o = at(s, ['devices', 'off']), list = new Set(Array.isArray(o[d]) ? o[d] : []); if (turnOn) list.delete(w); else list.add(w); o[d] = [...list]; });
    },
    setConnModel(d, a, mdl) {
      const c = (st.CONN[d] || []).find(x => x.a === a); if (!c) return null;
      const lv = levelsOf(st, a, mdl), think = mdl.startsWith('group/') ? '' : lv.includes(c.think) ? c.think : midLevel(lv);
      delete ui.hud.pick[`${a}@${d}`];
      const k = keyToWire(`${a}@${d}`);
      return patch(s => { const ms = at(s, ['devices', 'models']); if (mdl) ms[k] = { model: mdl, effort: think }; else delete ms[k]; }).then(() => (st.CONN[d] || []).find(x => x.a === a));
    },
    setConnThink(d, a, t) {
      const c = (st.CONN[d] || []).find(x => x.a === a); if (!c) return null;
      delete ui.hud.pick[`${a}@${d}`];
      return patch(s => { at(s, ['devices', 'models'])[keyToWire(`${a}@${d}`)] = { model: c.model, effort: t }; }).then(() => (st.CONN[d] || []).find(x => x.a === a));
    },
    applyPlan() { return no('第一版还不能一键接入'); },
    undoPlan() {},
    // 移除设备：只是不在界面上显示（devices.hidden），不影响那台电脑；在添加设备里能恢复
    removeDevice(d) {
      const D = st.DEV[d]; if (!D || removalImpact(st, d).isLead) return null;
      ui.conn.rm = ''; emit('ui.conn.rm');
      return patch(s => { const dv = at(s, ['devices']); dv.hidden = [...new Set([...(Array.isArray(dv.hidden) ? dv.hidden : []), d])]; }).then(() => D.name);
    },
    restoreDevice(d) {
      const x = (st.HIDDEN || []).find(h => h.id === d);
      return patch(s => { const dv = at(s, ['devices']); dv.hidden = (Array.isArray(dv.hidden) ? dv.hidden : []).filter(v => v !== d); }).then(() => x?.name || d);
    },
    addDevice() { return no('第一版只能经 Codex 应用内添加：重新读一次远程电脑'); },

    /* ---------- 分派规则（dispatch.rules、quota.low）和协作的规矩（post.*）：马上改界面，后台存 ---------- */
    toggleRule(id) { demo.toggleRule(id); bg(patch(rulesFn())); },
    setRule(id, f, v) { demo.setRule(id, f, v); if (f === 'when' || f === 'kw') patchSoon('rules', rulesFn()); else bg(patch(rulesFn())); },
    addRule(to) { const r = demo.addRule(to); bg(patch(rulesFn())); return r; },
    delRule(id) { const r = demo.delRule(id); bg(patch(rulesFn())); return r; },
    moveRule(a, b) { demo.moveRule(a, b); bg(patch(rulesFn())); },
    setLow(v) { demo.setLow(v); bg(patch(s => { at(s, ['quota']).low = v; })); },
    toggleRule2(id) { const r = st.RULES2.find(x => x.id === id), p = RULE2_PATH[id]; if (r && p) bg(patch(s => setAt(s, p, !r.on))); },
    setRule2(id, v) { const p = RULE2_PATH[id]; if (p) bg(patch(s => setAt(s, p, v))); },
    // 设置面板里非外观的几项：刘海 perch.notch、额度显示 quota.show、查密钥 secrets.mode、跨设备等几秒 post.crossTimeoutSec
    persistSetting(k, v) {
      const P = { notch: [['perch', 'notch'], v === 'on'], quota: [['quota', 'show'], v], secrets: [['secrets', 'mode'], v], crossTimeoutSec: [['post', 'crossTimeoutSec'], v] }[k];
      return P ? patch(s => setAt(s, P[0], P[1])) : undefined;
    },
    // 别的设置（通知 notify.*、交给 Codex 的活 codex.*、中继对话 post.relayThread、等回信 post.waitTimeoutMin）：path 是一串键
    setServer(path, v) { return patch(s => setAt(s, path, v)); },

    /* ---------- 任务 ---------- */
    // 重发：只有应用自己发的（retryable）才有原文。POST /api/send { to, text, title, retry_of }，原文由应用按 retry_of 从内存里取
    retryTask(id) {
      const t = tById(st, id); if (!t) return null;
      if (!t.retryable) return no('这件不是在 Pigeon 里发的，Pigeon 没留原文，不能重发');
      const to = by(st, t.to);
      return api('/api/send', { method: 'POST', body: { to: wireEnd(to), text: '', title: t.title, project: '', model: '', effort: '', retry_of: id } })
        .then(r => { if (r?.band) { ui.tasks.open = r.band; emit('ui.tasks'); } return { result: 'sent', task: { id: r?.band || '' } }; });
    },
    send() { return no('在刘海上派活'); },

    /* ---------- 等你的一队：POST /api/queue/<id> { action: release | block | release_masked } ---------- */
    qDo(i, ok, opt = {}) {
      const q = st.Q[i]; if (!q) return null;
      const masked = ok && q.secrets?.length && (st.settings.secrets === 'mask' || opt.mask);
      const action = !ok ? 'block' : masked ? 'release_masked' : 'release';
      return api(`/api/queue/${encodeURIComponent(q.id)}`, { method: 'POST', body: { action } }).then(() => {
        raw.queue = (raw.queue || []).filter(x => x.id !== q.id); rebuild();
        if (!ok) return { msg: '已拦下，没有发出，也不会重发' };
        const d = q.to?.dev;
        if (d && isPaused(st, d)) return { msg: '已放行：暂停中，继续后再送出' };
        return { msg: `已放行，正在送往 ${devName(d)}${masked ? '，密钥打了码' : ''}` };
      });
    },
    qAuto() { return no('第一版还没有转派'); },
    expire() { return []; }, // 到点没人理由应用判，结果经 SSE 回来
    incoming() { return no('第一版还没有转派和拆活'); },

    /* ---------- Codex 回调的开关：GET/POST /api/codex/hooks，马上生效，不进设置文件 ---------- */
    loadCodexHooks() {
      st.HOOKS = { ...(st.HOOKS || {}), busy: true }; emit('HOOKS');
      return get('/api/codex/hooks').then(h => { st.HOOKS = { ...h, busy: false }; emit('HOOKS'); }, e => { st.HOOKS = { busy: false, err: `读不到：${e.message}` }; emit('HOOKS'); });
    },
    setCodexHooks(enable) {
      const before = st.HOOKS;
      st.HOOKS = { ...(before || {}), busy: true }; emit('HOOKS');
      return api('/api/codex/hooks', { method: 'POST', body: { enable } }).then(h => { st.HOOKS = { ...h, busy: false }; emit('HOOKS'); return h; },
        e => { st.HOOKS = { ...(before || {}), busy: false, err: `没改成：${e.message}` }; emit('HOOKS'); throw e; });
    },
  };
  return be;
}

