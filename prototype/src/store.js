// 唯一的状态对象，和改它的方法。
// - 页面不直接改 state 里的数据，一律调这里的方法（或者 set() 改界面状态）；方法改完发一个“话题”，订阅了的部分自己重画。
// - on(话题们, fn) 订阅，返回取消订阅的函数。订阅 'settings' 能收到 'settings.theme' 这类子话题（前缀匹配）。
// - 同一轮事件里发的话题攒到微任务里一起通知，一个订阅者只被叫一次；要马上画出来（比如接着要聚焦新出来的输入框）就调 flush()。
// 不碰 DOM。本机是哪台读 state.home，指挥读 state.lead。
//
// 话题：
//   DEV        设备、在不在线、每台接了哪些 agent、设备名（也包括 FOUND、MP_FOUND 的“加过了”）
//   lead       指挥换了
//   S  T       对话、任务
//   RULES      分派规则和额度阈值；ruleText 只是规则的文字改了（输入框自己已经是新值，不用重画表格）
//   RULES2     协作的规矩
//   SUB        订阅额度和它从哪来（MPQ）
//   Q          刘海里等你的一队
//   paused     全部暂停、每台暂停
//   settings.* 设置的每一项
//   ui.*       界面状态：ui.view 当前页、ui.open 远程设备展开、ui.stage.page/sel、ui.tasks、ui.route.try/hit、
//              ui.conn.plan/mp/sheet/rm、ui.hud、ui.settingsOpen；
//              sheetText、draft 是输入框打字（不重画输入框本身），hudTarget 是打字时按规则自动换了派活对象
//   art        有图片加载失败，要退回像素标志
import { AGENTS, AG, SETTINGS0 } from './core/labels.js';
import { by, keyOf, agOf, dvOf, levelsOf, midLevel, qInfo, qDevs, nameOf, tById, leadSession, isYou, canLead, askOn, isPaused, online, endOf, removalImpact } from './core/names.js';
import { targets, routeOf, alive } from './core/route.js';
import { secretsIn, secretKind } from './core/secrets.js';

const matches = (sub, changed) => changed === sub || changed.startsWith(sub + '.');
// 设备名、规则文字里不留尖括号、引号和 &，最多 24 个字
const cleanName = v => String(v || '').replace(/[<>"&]/g, '').trim().slice(0, 24);
// 读进来的指挥还能不能用：你自己，或者还接着、能发出的那个 agent
const validLead = (st, l) => !!l && (l.kind === 'you' || (l.kind === 'agent' && canLead(st, l.agent, l.dev)));

// clock：现在几点（毫秒），测试里换成固定的
export function createStore(data, saved = {}, { clock = () => Date.now() } = {}) {
  const state = {
    ...data,
    NAMES: { ...(saved.names || {}) },
    MPQ: { state: 'demo', ver: '', at: '', cards: 0 }, // 额度从哪来：demo 全是示例，live 本机 magpie，off 连不上 magpie
    paused: { all: false, dev: {} },
    settings: { ...SETTINGS0, ...(saved.settings || {}) },
    ui: {
      view: 'stage',
      open: { ...(saved.open || {}) },
      stage: { page: 0, sel: null },
      tasks: { open: data.DEMO.openTask, filter: 'all' },
      route: { try: '', hit: -1, hitTo: '', hitFb: false },
      conn: { plan: false, mp: '', sheet: null, fresh: '', rm: '' },
      // 刘海：state 五种样子，pinned 鼠标移开也不收，target 派活对象，mode new 新开对话 / msg 发给 session 那个对话，
      // auto 打字时按规则自动选对象（手动点过对象就不自动了），suggest 规则建议的对象，pick 每个对象选过的模型，q 等你的一队选中第几件
      hud: { state: 'idle', pinned: false, target: data.DEMO.target, mode: 'new', session: '', auto: true, suggest: '', draft: '', pick: {}, q: 0 },
      settingsOpen: false,
      petBad: {},
    },
  };
  delete state.settings.face; // 上一版的“形象”设置已经去掉
  for (const d in state.NAMES) if (state.DEV[d]) state.DEV[d].name = state.NAMES[d];
  if (validLead(state, saved.lead)) state.lead = { ...saved.lead };

  /* ---------- 订阅和通知 ---------- */
  const subs = new Set();
  let dirty = new Set(), queued = false;
  function flush() {
    queued = false;
    if (!dirty.size) return;
    const changed = dirty; dirty = new Set();
    for (const s of [...subs]) if (subs.has(s) && s.topics.some(t => [...changed].some(c => matches(t, c)))) s.fn(changed);
  }
  function emit(...topics) {
    topics.forEach(t => dirty.add(t));
    if (!queued) { queued = true; queueMicrotask(flush); }
  }
  function on(topics, fn) {
    const s = { topics: [].concat(topics), fn };
    subs.add(s);
    return () => subs.delete(s);
  }
  // 改界面状态：path 是 state 里的路径（比如 'ui.stage.page'），话题就是这个路径；quiet 只改不通知
  function set(path, value, quiet) {
    const ks = path.split('.'), last = ks.pop();
    ks.reduce((o, k) => o[k], state)[last] = value;
    if (!quiet) emit(path);
  }
  // 在 changed 里有没有落在这些话题下的
  const touched = (changed, ...topics) => [...changed].some(c => topics.some(t => matches(t, c)));

  const st = state, ui = state.ui;
  let seq = 0;
  const newId = p => `${p}${(++seq).toString(36)}${clock().toString(36).slice(-3)}`;
  const end = s => ({ dev: s.dev, agent: s.agent, session: s.id === 'you' ? '' : s.id });
  // 指挥那台选中什么：指挥的对话，你当指挥就是“你”，指挥还没有对话就是那个 agent
  const defaultSel = () => { const L = leadSession(st); return L ? { t: 'session', id: L.id } : isYou(st) ? { t: 'you' } : { t: 'agent', a: st.lead.agent, d: st.lead.dev }; };
  ui.stage.sel = defaultSel();

  /* ---------- 任务怎么发出去 ---------- */
  // 送出去：对方开始干活
  function send(t) {
    const to = by(st, t.to);
    t.state = 'flying'; delete t.paused; t.dur = '0:01';
    if (to) { to.state = 'run'; to.activity = 'thinking'; to.note = '刚收到任务'; delete to.error; }
  }
  // 没发出：reason 见 labels.js 的 REASON。在等确认的那个对话回到空闲
  function refuse(t, reason) {
    if (!t) return;
    t.state = 'refused'; t.reason = reason; delete t.paused;
    const to = by(st, t.to);
    if (to && to.state === 'wait') { to.state = 'idle'; to.note = '空闲'; delete to.activity; }
  }
  // 一件新任务按规矩走：对方不在了、连不上就没发出；跨设备且规矩要问就排进等你的一队（asking）；暂停中先排着（queued + paused）；否则送出。
  // ask 为假表示已经问过了（放行转派、拆活时）。返回走到了哪一步
  function launch(t, { ask = true, fresh = false } = {}) {
    const to = by(st, t.to), from = by(st, t.from);
    if (!to || !st.DEV[to.dev]) { refuse(t, 'no_target'); return 'no_target'; }
    if (!online(st, to.dev)) { refuse(t, 'offline'); return 'offline'; }
    if (ask && from.dev !== to.dev && askOn(st, 'cross')) {
      t.state = 'asking';
      // 新开的、或者闲着的对话：标成等你（它在等这件确认）；正在干活的不动
      if (fresh || to.state === 'idle' || to.state === 'done') { to.state = 'wait'; to.activity = 'waiting'; to.note = '这个任务在等你确认才发过去'; }
      const found = [...new Set(secretsIn(t.body || t.title).map(secretKind))], now = clock();
      st.Q.push({ id: newId('q'), kind: 'cross', band: t.id, from: end(from), to: end(to), preview: t.title.slice(0, 80), ...(t.why?.rule ? { rule: t.why.rule } : {}),
        created: now, deadline: now + st.settings.crossTimeoutSec * 1000, ...(found.length ? { secrets: found } : {}) });
      return 'asking';
    }
    if (isPaused(st, to.dev)) { t.state = 'queued'; t.paused = true; if (fresh) to.note = '排着，暂停中'; return 'paused'; }
    send(t);
    return 'flying';
  }
  // 给 agent@设备 找一个能接活的对话（不是指挥、不是子对话），没有就新开一个
  function sessionFor(k, title, model) {
    const L = leadSession(st);
    const s = st.S.find(x => keyOf(x) === k && !x.parent && x !== L && x.state !== 'error');
    if (s) return [s, false];
    const [a, d] = [agOf(k), dvOf(k)], c = (st.CONN[d] || []).find(x => x.a === a), gate = (st.CONN[d] || []).find(x => x.role === 'gate');
    const n = { id: newId('n'), agent: a, dev: d, title: title.slice(0, 24), state: 'idle', model: model?.m || c?.model || '', think: model?.t ?? c?.think ?? '', note: '新开的对话', ...(c?.role === 'via' && gate ? { via: gate.a } : {}) };
    st.S.push(n);
    return [n, true];
  }
  function newTask(from, to, title, extra = {}) {
    const t = { id: newId('t-'), time: st.DEMO.clock, from: from.id, to: to.id, kind: '派活', title, state: 'queued', dur: '', ...extra };
    st.T.unshift(t);
    return t;
  }
  // 转派、拆活放行后，新出来的任务（已经问过了，不再排队问）
  function addTask(from, k, title, why) {
    const [s, fresh] = sessionFor(k, title);
    return launch(newTask(from, s, title, { kind: '转派', why, ctx: { tokens: 800, window: 200000, files: [] } }), { ask: false, fresh });
  }
  // 你派的活为什么给它：和规则的建议对照着打标签
  function whyFor(text, k) {
    const res = routeOf(st, text);
    if (!res.r) return { kind: 'lead', reason: '你在 Pigeon 里自己派的' };
    if (res.to === k) return res.fb ? { kind: 'quota', rule: res.r.id, suggested: endOf(res.r.to) } : { kind: 'rule', rule: res.r.id };
    return { kind: 'override', rule: res.r.id, suggested: endOf(res.to), reason: '你在 Pigeon 里自己选的' };
  }

  /* ---------- 等你处理的一队 ---------- */
  // 放行或拦下：真的去做
  function perform(q, ok, opt = {}) {
    const x = qInfo(st, q);
    if (q.kind === 'cross') {
      if (!ok) { refuse(x.t, 'blocked'); return { msg: '已拦下，没有发出，也不会重发' }; }
      const d = dvOf(x.to);
      if (!online(st, d)) { refuse(x.t, 'offline'); return { msg: `${st.DEV[d]?.name || '那台'} 连不上，没发出` }; }
      const masked = q.secrets?.length && (st.settings.secrets === 'mask' || opt.mask);
      if (x.t) send(x.t);
      return { msg: `已放飞，正在送往 ${st.DEV[d].name}${masked ? '，密钥打了码' : ''}`, fly: [x.from.agent, agOf(x.to)] };
    }
    if (q.kind === 'relay') {
      if (!ok) return { msg: `已拦下，${AG[x.from.agent].name} 会收到“你没同意转派”，它自己接着做` };
      const r = addTask(x.from, x.to, x.text, { kind: 'rule', rule: q.rule });
      return { msg: r === 'offline' ? `${nameOf(st, x.to)} 连不上，没发出` : `已转给 ${nameOf(st, x.to)}` };
    }
    if (!ok) return { msg: '已拦下，指挥会收到“你没同意拆活”，它自己接着做' };
    x.parts.forEach(([k, v]) => addTask(x.from, k, v, { kind: 'lead', reason: '拆活时指挥定的，你在刘海上放行了' }));
    return { msg: `已拆成 ${x.parts.length} 件派出去` };
  }
  const afterQueue = () => { ui.hud.q = Math.max(0, Math.min(ui.hud.q, st.Q.length - 1)); if (ui.hud.state === 'confirm' && !st.Q.length) methods.hud('idle'); };
  // 暂停解除后：放行过、排着的先送出去，暂停时直接派的也送出去
  function resume() {
    let n = 0;
    for (const q of [...st.Q]) if (q.paused && !qDevs(q).some(d => isPaused(st, d))) { st.Q.splice(st.Q.indexOf(q), 1); perform(q, true, q.opt || {}); n++; }
    for (const t of st.T) if (t.paused && t.state === 'queued' && !st.Q.some(q => q.band === t.id) && !isPaused(st, by(st, t.to)?.dev)) { send(t); n++; }
    if (n) { afterQueue(); emit('Q', 'T', 'S'); }
    return n;
  }

  /* ---------- 设置、页面 ---------- */
  const views = {
    setView(v) { ui.view = v; emit('ui.view'); },
    setSetting(k, v) {
      st.settings[k] = v; emit('settings.' + k);
      if (k === 'notch' || k === 'secrets') methods.hud('idle');
    },
    toggleSettings(open) { ui.settingsOpen = open ?? !ui.settingsOpen; emit('ui.settingsOpen'); },
  };

  /* ---------- 指挥台 ---------- */
  const stage = {
    setPage(i) { ui.stage.page = i; emit('ui.stage.page'); },
    select(sel) { ui.stage.sel = sel; emit('ui.stage.sel'); },
    // 远程设备在指挥那页上展开或收起
    setOpen(d, open) { ui.open[d] = open; emit('ui.open'); },
    // 全部暂停 / 继续。继续时把排着的送出去，返回 { paused, sent }
    togglePause() { st.paused.all = !st.paused.all; emit('paused'); return { paused: st.paused.all, sent: st.paused.all ? 0 : resume() }; },
    togglePauseDev(d) { st.paused.dev[d] = !st.paused.dev[d]; emit('paused'); return { paused: st.paused.dev[d], sent: st.paused.dev[d] ? 0 : resume() }; },
    // 换指挥：{ kind: 'agent', agent, dev } 或 { kind: 'you' }。不能发出的 agent 不行。在路上的任务不受影响
    setLead(l) {
      if (!validLead(st, l)) return false;
      st.lead = l.kind === 'you' ? { kind: 'you' } : { kind: 'agent', agent: l.agent, dev: l.dev };
      ui.stage.sel = defaultSel();
      emit('lead', 'ui.stage.sel');
      return true;
    },
    // 出错的对话重试：那台连不上就还是出错
    retrySession(id) {
      const s = by(st, id); if (!s) return false;
      if (!online(st, s.dev)) { s.error = `连不上：${st.DEV[s.dev].name} 现在连不上`; emit('S'); return false; }
      s.state = 'run'; s.activity = 'thinking'; s.note = '重试中'; delete s.error;
      emit('S');
      return true;
    },
    markPetBad(a) { ui.petBad[a] = true; emit('art'); },
  };

  /* ---------- 设备和接入 ---------- */
  const devices = {
    // v 为 null 是取消：不改，但要重画把输入框换回去。清空就恢复原来的名字
    renameDevice(d, v) {
      const D = st.DEV[d]; if (!D) return null;
      const old = D.name;
      if (v != null) {
        D.name = cleanName(v) || D.def;
        if (D.name !== D.def) st.NAMES[d] = D.name; else delete st.NAMES[d];
      }
      emit('DEV');
      return v != null && D.name !== old ? (cleanName(v) ? `改名为「${D.name}」` : `已恢复成「${D.def}」`) : null;
    },
    // 连不连得上（设置里“演示：断开”用；接入页的“重试”把它连回来）
    setOnline(d, on) { if (st.DEV[d]) { st.DEV[d].online = on; emit('DEV'); } },
    toggleConn(d, a) { const c = st.CONN[d].find(x => x.a === a); c.on = !c.on; emit('DEV'); },
    // 接入页里改一个 agent 的默认模型、思考强度。刘海派活那边记的选择跟着作废，下次按新的默认来
    setConnModel(d, a, m) {
      const c = (st.CONN[d] || []).find(x => x.a === a); if (!c) return null;
      c.model = m; const lv = levelsOf(st, a, m); if (!lv.includes(c.think)) c.think = midLevel(lv);
      delete ui.hud.pick[`${a}@${d}`]; emit('DEV');
      return c;
    },
    setConnThink(d, a, t) {
      const c = (st.CONN[d] || []).find(x => x.a === a); if (!c) return null;
      c.think = t; delete ui.hud.pick[`${a}@${d}`]; emit('DEV');
      return c;
    },
    togglePlan() { ui.conn.plan = !ui.conn.plan; emit('ui.conn.plan'); },
    // 一键接入本机全部。返回改之前的样子，撤回时交回来
    applyPlan() {
      const before = (st.CONN[st.home] || []).map(c => c.on);
      ui.conn.plan = false; (st.CONN[st.home] || []).forEach(c => (c.on = true)); emit('DEV', 'ui.conn.plan');
      return before;
    },
    undoPlan(before) { (st.CONN[st.home] || []).forEach((c, i) => (c.on = before[i] ?? c.on)); emit('DEV'); },
    toggleModelPanel(key) { ui.conn.mp = ui.conn.mp === key ? '' : key; emit('ui.conn.mp'); },
    // 移除设备先确认：rm 是等确认的那台
    askRemove(d) { ui.conn.rm = d; emit('ui.conn.rm'); },
    cancelRemove() { ui.conn.rm = ''; emit('ui.conn.rm'); },
    // 指挥在那台上时不让删，返回 null
    removeDevice(d) {
      const D = st.DEV[d]; if (!D) return null;
      const imp = removalImpact(st, d);
      if (imp.isLead) return null;
      const f = st.FOUND.find(x => x.name === D.host);
      for (let i = st.Q.length - 1; i >= 0; i--) {
        const q = st.Q[i], t = q.band && tById(st, q.band), sess = t && [by(st, t.from), by(st, t.to)];
        if (q.from.dev === d || qDevs(q).includes(d) || (sess && sess.some(s => s?.dev === d))) st.Q.splice(i, 1);
      }
      delete st.DEV[d]; delete st.CONN[d]; if (f) f.added = false;
      for (let i = st.S.length - 1; i >= 0; i--) if (st.S[i].dev === d) {
        const id = st.S[i].id; st.S.splice(i, 1);
        for (let j = st.T.length - 1; j >= 0; j--) if (st.T[j].from === id || st.T[j].to === id) st.T.splice(j, 1);
      }
      // 选中的对话跟着没了就退回指挥
      const sel = ui.stage.sel;
      if ((sel.t === 'session' && !by(st, sel.id)) || (sel.t === 'agent' && sel.d === d)) ui.stage.sel = defaultSel();
      ui.conn.rm = '';
      afterQueue();
      emit('DEV', 'S', 'T', 'Q', 'ui.stage.sel', 'ui.conn.rm');
      return D.name;
    },
    // 添加设备的面板
    openSheet() { ui.conn.sheet = { step: 1, link: 'codex', only: true, apps: ['claude', 'cursor'], name: '', host: '', alias: '', mp: '' }; emit('ui.conn.sheet'); },
    closeSheet() { ui.conn.sheet = null; emit('ui.conn.sheet'); },
    sheetSet(patch) { Object.assign(ui.conn.sheet, patch); emit('ui.conn.sheet'); },
    sheetToggleApp(a) { const sh = ui.conn.sheet; sh.apps = sh.apps.includes(a) ? sh.apps.filter(x => x !== a) : [...sh.apps, a]; emit('ui.conn.sheet'); },
    // 输入框打字：只记下来，不重画输入框
    sheetText(field, v) { if (ui.conn.sheet) { ui.conn.sheet[field] = v; emit('sheetText'); } },
    addDevice() {
      const sh = ui.conn.sheet, codex = sh.link === 'codex', viaMp = sh.link === 'magpie', id = 'd' + clock().toString(36);
      const f = st.FOUND.find(x => x.name === sh.name), mf = st.MP_FOUND.find(x => x.id === sh.mp);
      const host = viaMp ? mf.host : codex ? sh.name : sh.host.trim().split('@').pop();
      st.DEV[id] = { name: cleanName(sh.alias) || host, def: host, host, os: viaMp ? mf.os : codex ? f.os : 'linux', link: sh.link, online: true, mp: viaMp ? mf.id : undefined };
      if (viaMp) {
        mf.added = true;
        st.CONN[id] = AGENTS.filter(a => sh.apps.includes(a) && mf.apps.includes(a)).map(a => ({ a, how: ['viamagpie'], out: 'part', inn: 'yes', on: true }));
      } else {
        if (f) f.added = true;
        const apps = AGENTS.filter(a => sh.apps.includes(a));
        st.CONN[id] = codex && sh.only
          ? [{ a: 'codex', role: 'gate', how: ['inapp'], out: 'nope', inn: 'yes', on: true }, ...apps.filter(a => a !== 'codex').map(a => ({ a, role: 'via', how: ['viacodex'], out: 'nope', inn: 'part', on: true }))]
          : apps.map(a => ({ a, how: codex ? ['mcp', 'hook'] : ['ssh'], out: codex ? 'part' : 'nope', inn: 'part', on: true }));
      }
      st.CONN[id].forEach(c => ([c.model, c.think] = st.DEF_MODEL[c.a]));
      ui.conn.fresh = id; ui.conn.sheet = null;
      emit('DEV', 'ui.conn.sheet');
      return st.DEV[id].name;
    },
  };

  /* ---------- 分派规则 ---------- */
  const ruleAt = id => st.RULES.find(r => r.id === id);
  const rules = {
    toggleRule(id) { const r = ruleAt(id); r.on = !r.on; emit('RULES'); },
    // when、kw 是打字，只发 ruleText；交给谁、改派、问不问发 RULES
    setRule(id, f, v) {
      const r = ruleAt(id); if (!r) return;
      r[f] = f === 'ask' ? v === '1' || v === true : v;
      emit(f === 'when' || f === 'kw' ? 'ruleText' : 'RULES');
    },
    addRule(to) {
      const r = { id: 'r' + clock().toString(36) + (++seq), when: '', kw: '', to: to || targets(st)[0] || `claude@${st.home}`, fb: '', ask: false, on: true, n: 0, over: 0 };
      st.RULES.push(r); emit('RULES');
      return r;
    },
    delRule(id) { const i = st.RULES.findIndex(r => r.id === id); const [r] = st.RULES.splice(i, 1); ui.route.hit = -1; emit('RULES', 'ui.route.hit'); return r; },
    moveRule(from, to) { st.RULES.splice(to, 0, st.RULES.splice(from, 1)[0]); emit('RULES'); },
    setLow(v) { st.LOW = v; emit('RULES'); },
    setTry(v) { ui.route.try = v; emit('ui.route.try'); },
    // 流向图上亮哪条：i 是规则的序号（-1 不亮，-2 是“其他的”），to 亮哪家，fb 走的是不是改派那条线
    setHit(i, to = '', fb = false) { Object.assign(ui.route, { hit: i, hitTo: to, hitFb: fb }); emit('ui.route.hit'); },
    toggleRule2(id) { const r = st.RULES2.find(x => x.id === id); r.on = !r.on; emit('RULES2'); },
    setRule2(id, v) { const r = st.RULES2.find(x => x.id === id); r.v = v; emit('RULES2'); },
  };

  /* ---------- 任务 ---------- */
  const tasks = {
    openTask(id) { ui.tasks.open = id; emit('ui.tasks'); },
    setTaskFilter(f) { ui.tasks.filter = f; emit('ui.tasks'); },
    // 没回音、没人理、连不上的重发：新任务带 retry_of，照样按规矩走。返回走到了哪一步
    retryTask(id) {
      const o = tById(st, id); if (!o) return null;
      const to = by(st, o.to);
      if (to && to.state === 'error') { to.state = 'idle'; delete to.error; to.note = '空闲'; }
      const t = newTask(by(st, o.from) || by(st, 'you'), to || { id: o.to }, o.title, { kind: o.kind, body: o.body, why: o.why, ctx: o.ctx, retry_of: o.id });
      const r = launch(t);
      ui.tasks.open = t.id;
      if (r === 'asking') { ui.hud.q = st.Q.length - 1; }
      emit('T', 'S', 'Q', 'ui.tasks');
      return { result: r, task: t };
    },
  };

  /* ---------- 刘海 ---------- */
  const hud = {
    // 刘海面板：idle 收起、overview 悬停总览、confirm 等你处理、reply 回信到了、compose 快速派活。pin 为假时鼠标移开就收起
    hud(state, pin = true) { ui.hud.state = state; ui.hud.pinned = pin && state !== 'idle'; emit('ui.hud'); },
    hudSel(i) { ui.hud.q = i; emit('ui.hud'); },
    hudStep(d) { const n = st.Q.length; if (n) { ui.hud.q = (ui.hud.q + d + n) % n; emit('ui.hud'); } },
    // 打开快速派活。target 预先选好的对象，mode new 新开对话 / msg 发给 session 那个对话
    compose({ target, mode = 'new', session = '' } = {}) {
      Object.assign(ui.hud, { mode, session, auto: !target, suggest: '' });
      if (target) ui.hud.target = target;
      hud.hud('compose');
    },
    // 派活对象：不在了（设备移除或关了）就换回本机的 Codex
    target() {
      const k = ui.hud.target;
      if (!Object.keys(st.DEV).some(d => (st.CONN[d] || []).some(c => `${c.a}@${d}` === k && c.on))) ui.hud.target = `codex@${st.home}`;
      return ui.hud.target;
    },
    // 手动选了对象：不再按规则自动换；换到别的对象就不是发给原来那个对话了
    setTarget(k) {
      ui.hud.target = k; ui.hud.auto = false;
      if (ui.hud.mode === 'msg' && keyOf(by(st, ui.hud.session) || {}) !== k) ui.hud.mode = 'new';
      emit('ui.hud');
    },
    // 每个对象各记一份选过的模型和思考强度；没选过就用它在接入里配的
    pickOf(k) {
      return (ui.hud.pick[k] ??= (() => {
        const [a, d] = k.split('@'), c = (st.CONN[d] || []).find(x => x.a === a), list = st.MODELS[a];
        const m = c && (list.some(x => x[0] === c.model) || c.model?.startsWith('group/')) ? c.model : list[0][0], lv = levelsOf(st, a, m);
        return { m, t: lv.includes(c?.think) ? c.think : midLevel(lv) };
      })());
    },
    pickModel(m) { const k = hud.target(), p = hud.pickOf(k), lv = levelsOf(st, agOf(k), m); p.m = m; if (!lv.includes(p.t)) p.t = midLevel(lv); emit('ui.hud'); },
    pickThink(t) { hud.pickOf(hud.target()).t = t; emit('ui.hud'); },
    // 打字：记下来；按规则算出建议的对象，没手动选过对象（也不是发给某个对话）时直接换过去
    setDraft(v) {
      ui.hud.draft = v;
      const res = v.trim() ? routeOf(st, v) : { r: null }, k = res.r && alive(st, res.to) ? res.to : '';
      ui.hud.suggest = k;
      if (k && ui.hud.auto && ui.hud.mode === 'new' && k !== ui.hud.target) { ui.hud.target = k; emit('hudTarget'); }
      emit('draft');
    },
    // 发出：生成一件任务（发件人是你），按规矩走：跨设备且要问就排进等你的一队，暂停中先排着，否则送出。
    // 返回 { empty } 或 { result, task, fresh }，提示由调用的一方说
    send() {
      const v = ui.hud.draft.trim(), k = hud.target();
      if (!v) return { empty: true };
      const p = hud.pickOf(k), msgTo = ui.hud.mode === 'msg' && by(st, ui.hud.session);
      const [to, fresh] = msgTo && keyOf(msgTo) === k ? [msgTo, false] : sessionFor(k, v, p);
      if (fresh) { to.model = p.m; to.think = p.t; }
      const t = newTask(by(st, 'you'), to, v, { why: whyFor(v, k), ctx: { tokens: Math.max(200, v.length * 40), window: 200000, files: [] } });
      const result = launch(t, { fresh });
      ui.hud.draft = ''; ui.hud.suggest = '';
      if (result === 'asking') { ui.hud.q = st.Q.length - 1; hud.hud('confirm'); } else hud.hud('idle');
      emit('T', 'S', 'Q', 'draft');
      return { result, task: t, fresh };
    },
    // 放行或拦下等你的第 i 件。暂停中（全部或那台）点放行：留在队里标 paused，继续后再送出。
    // 返回 { msg 提示, fly [从谁, 到谁] 刘海上飞一只鸽子 }
    qDo(i, ok, opt = {}) {
      const q = st.Q[i]; if (!q) return null;
      if (ok && q.paused) return { msg: '这件已经放行了，暂停中，继续后送出' };
      if (ok && qDevs(q).some(d => isPaused(st, d))) {
        q.paused = true; q.opt = opt;
        const t = q.band && tById(st, q.band);
        if (t) { t.state = 'queued'; t.paused = true; }
        emit('Q', 'T');
        return { msg: '暂停中：这件先排着，继续后再送出' };
      }
      st.Q.splice(i, 1);
      const r = perform(q, ok, opt);
      afterQueue();
      emit('Q', 'T', 'S');
      return r;
    },
    // 转派以后不再问：关掉协作规矩里那一条，再放行这一件
    qAuto(i) { const r = st.RULES2.find(x => x.id === 'relay'); if (r) r.on = false; emit('RULES2'); return hud.qDo(i, true); },
    // 跨设备的到点没人理：不发，reason=timeout。返回超时的那几件任务
    expire(now = clock()) {
      const out = [];
      for (let i = st.Q.length - 1; i >= 0; i--) {
        const q = st.Q[i];
        if (q.kind !== 'cross' || q.paused || !q.deadline || q.deadline > now) continue;
        st.Q.splice(i, 1);
        const t = q.band && tById(st, q.band);
        refuse(t, 'timeout');
        out.push(t || { title: q.preview });
      }
      if (out.length) { afterQueue(); emit('Q', 'T', 'S'); }
      return out;
    },
    // 演示：来一件转派或拆活。规矩开着就排进等你的一队，关了直接做
    incoming(kind) {
      const ev = structuredClone(st.DEMO[kind]);
      const ask = kind === 'relay' ? askOn(st, 'relay') : askOn(st, 'split') && ev.parts.length >= 3;
      const q = { id: newId('q'), kind, ...ev, created: clock() };
      if (ask) { st.Q.push(q); ui.hud.q = st.Q.length - 1; hud.hud('confirm'); emit('Q'); return { asked: true }; }
      const r = perform(q, true);
      emit('Q', 'T', 'S');
      return { asked: false, msg: r.msg };
    },
  };

  /* ---------- 额度 ---------- */
  const quota = {
    // 换一整份额度。mpq 是 { state, ver, at, cards }；quiet 只换数据不通知（数字没变、只是读取时间变了）
    setQuota(sub, mpq, quiet) {
      for (const k in st.SUB) delete st.SUB[k];
      Object.assign(st.SUB, sub);
      Object.assign(st.MPQ, mpq);
      if (!quiet) emit('SUB');
    },
  };

  const methods = { ...views, ...stage, ...devices, ...rules, ...tasks, ...hud, ...quota };
  return { state, on, emit, set, flush, touched, clock, ...methods };
}
