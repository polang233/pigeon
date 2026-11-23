// 唯一的状态对象，和改它的方法。
// - 页面不直接改 state 里的数据，一律调这里的方法（或者 set() 改界面状态）；方法改完发一个“话题”，订阅了的部分自己重画。
// - on(话题们, fn) 订阅，返回取消订阅的函数。订阅 'settings' 能收到 'settings.theme' 这类子话题（前缀匹配）。
// - 同一轮事件里发的话题攒到微任务里一起通知，一个订阅者只被叫一次；要马上画出来（比如接着要聚焦新出来的输入框）就调 flush()。
// 不碰 DOM。本机是哪台读 state.home，指挥读 state.lead。
//
// 这里只管界面状态（选中、展开、刘海、输入框里的字）。“真的去做”的方法（放行、暂停、改名、改规则、派活……）
// 来自注入的后端：createStore(data, saved, { backend })。
//   - 演示：backend/demo.js，在内存里模拟，方法马上返回结果。不传 backend 时用它（测试也用它）。
//   - 应用：backend/live.js，经应用的本机服务去做，方法返回 Promise；数据变化经 SSE 回来，由它换掉 state 里的数据再发话题。
// 两个后端的方法名和返回的样子一样，页面不用分；只有演示里才有的按钮（演示断开、来一件转派……）由页面按 state.mode 决定画不画。
//
// 话题：
//   DEV        设备、在不在线、每台接了哪些 agent、设备名（也包括 FOUND、MP_FOUND 的“加过了”、应用里移除过的设备）
//   lead       指挥换了
//   S  T       对话、任务
//   RULES      分派规则和额度阈值；ruleText 只是规则的文字改了（输入框自己已经是新值，不用重画表格）
//   RULES2     协作的规矩
//   SUB        订阅额度和它从哪来（MPQ）
//   Q          等你处理的一队
//   paused     全部暂停、每台暂停
//   settings.* 设置的每一项
//   SRV        应用里的完整设置变了（只有应用模式：通知、交给 Codex 的活、中继对话这些）
//   USAGE      用量统计（只有应用模式）
//   HOOKS      Codex 回调的开关状态（只有应用模式）
//   link       和应用的连接断了或者连上了（只有应用模式）
//   NOTES      频道里的留言
//   ui.*       界面状态：ui.view 当前页、ui.open 远程设备展开、ui.stage.page/sel、ui.tasks、ui.chan、ui.route.try/hit、
//              ui.conn.plan/mp/cx/sheet/rm、ui.hud、ui.settingsOpen；
//              sheetText、draft 是输入框打字（不重画输入框本身），hudTarget 是打字时按规则自动换了派活对象；
//              ui.chan.picks 是频道输入框里 @ 了谁（chanPicks），打字本身不发话题
//   art        有图片加载失败，要退回像素标志
import { SETTINGS0 } from './core/labels.js';
import { by, keyOf, agOf, levelsOf, midLevel, leadSession, isYou, validLead } from './core/names.js';
import { routeOf, alive } from './core/route.js';
import { taskChan, seqNow } from './core/channels.js';
import { createDemo } from './backend/demo.js';

const matches = (sub, changed) => changed === sub || changed.startsWith(sub + '.');

// clock：现在几点（毫秒），测试里换成固定的。backend：见文件开头
export function createStore(data, saved = {}, { clock = () => Date.now(), backend = createDemo } = {}) {
  const state = {
    mode: 'demo',
    ...data,
    NAMES: { ...(data.NAMES || {}), ...(saved.names || {}) },
    NOTES: data.NOTES || {},
    MPQ: { state: 'demo', ver: '', at: '', cards: 0 }, // 额度从哪来：demo 全是示例，live 本机 magpie，off 连不上 magpie，wait 还没读
    paused: data.paused || { all: false, dev: {} },
    settings: { ...SETTINGS0, ...(data.settings || {}), ...(saved.settings || {}) },
    ui: {
      view: 'stage',
      open: { ...(saved.open || {}) },
      stage: { page: 0, sel: null },
      tasks: { open: data.DEMO.openTask, filter: 'all' },
      // 频道：id 选中的频道（空串是还没选，'all' 是全部任务），focus 要滚到并亮一下的那件任务，
      // picks 输入框里 @ 了谁，mode task 派活 / note 留言，draft 输入框里的字，seen 每个频道看过几封回信，extra 手动拉进来的对话，people 右栏开没开
      chan: { id: '', focus: '', picks: [], mode: 'task', draft: '', seen: {}, extra: {}, people: true },
      route: { try: '', hit: -1, hitTo: '', hitFb: false },
      conn: { plan: false, mp: '', cx: false, sheet: null, fresh: '', rm: '' },
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
  // 指挥那台选中什么：指挥的对话，你当指挥就是“你”，指挥还没有对话就是那个 agent
  const defaultSel = () => { const L = leadSession(st); return L ? { t: 'session', id: L.id } : isYou(st) ? { t: 'you' } : { t: 'agent', a: st.lead.agent, d: st.lead.dev }; };
  ui.stage.sel = defaultSel();

  /* ---------- 设置、页面 ---------- */
  const views = {
    setView(v) { ui.view = v; emit('ui.view'); },
    // 改一项设置：界面马上换；应用模式下非外观的那几项（刘海、额度显示、查密钥）由后端存进应用的设置，返回它的 Promise
    setSetting(k, v) {
      st.settings[k] = v; emit('settings.' + k);
      if (k === 'notch' || k === 'secrets') methods.hud('idle');
      return be.persistSetting?.(k, v);
    },
    toggleSettings(open) { ui.settingsOpen = open ?? !ui.settingsOpen; emit('ui.settingsOpen'); },
    // 数据整份换过之后（应用推来的新数据）：选中的东西没了就退回默认
    afterData() {
      const sel = ui.stage.sel;
      if ((sel.t === 'session' && !by(st, sel.id)) || (sel.t === 'agent' && !st.DEV[sel.d]) || (sel.t === 'you' && !isYou(st))) { ui.stage.sel = defaultSel(); emit('ui.stage.sel'); }
      methods.clampQueue();
    },
    // 等你的一队变短了：选中的那件别越界；刘海停在“等你处理”而队空了就收起
    clampQueue() { ui.hud.q = Math.max(0, Math.min(ui.hud.q, st.Q.length - 1)); if (ui.hud.state === 'confirm' && !st.Q.length) methods.hud('idle'); },
  };

  /* ---------- 指挥台 ---------- */
  const stage = {
    setPage(i) { ui.stage.page = i; emit('ui.stage.page'); },
    select(sel) { ui.stage.sel = sel; emit('ui.stage.sel'); },
    // 远程设备在指挥那页上展开或收起
    setOpen(d, open) { ui.open[d] = open; emit('ui.open'); },
    markPetBad(a) { ui.petBad[a] = true; emit('art'); },
  };

  /* ---------- 接入页的界面状态 ---------- */
  const conn = {
    togglePlan() { ui.conn.plan = !ui.conn.plan; emit('ui.conn.plan'); },
    toggleModelPanel(key) { ui.conn.mp = ui.conn.mp === key ? '' : key; emit('ui.conn.mp'); },
    // 本机 Codex 那一行下面的“Codex 的设置”（只有应用模式）
    toggleCodexPanel() { ui.conn.cx = !ui.conn.cx; emit('ui.conn.mp'); },
    // 移除设备先确认：rm 是等确认的那台
    askRemove(d) { ui.conn.rm = d; emit('ui.conn.rm'); },
    cancelRemove() { ui.conn.rm = ''; emit('ui.conn.rm'); },
    // 添加设备的面板
    openSheet() { ui.conn.sheet = { step: 1, link: 'codex', only: true, apps: ['claude', 'cursor'], name: '', host: '', alias: '', mp: '' }; emit('ui.conn.sheet'); },
    closeSheet() { ui.conn.sheet = null; emit('ui.conn.sheet'); },
    sheetSet(patch) { Object.assign(ui.conn.sheet, patch); emit('ui.conn.sheet'); },
    sheetToggleApp(a) { const sh = ui.conn.sheet; sh.apps = sh.apps.includes(a) ? sh.apps.filter(x => x !== a) : [...sh.apps, a]; emit('ui.conn.sheet'); },
    // 输入框打字：只记下来，不重画输入框
    sheetText(field, v) { if (ui.conn.sheet) { ui.conn.sheet[field] = v; emit('sheetText'); } },
  };

  /* ---------- 分派规则、任务的界面状态 ---------- */
  const pages = {
    setTry(v) { ui.route.try = v; emit('ui.route.try'); },
    // 流向图上亮哪条：i 是规则的序号（-1 不亮，-2 是“其他的”），to 亮哪家，fb 走的是不是改派那条线
    setHit(i, to = '', fb = false) { Object.assign(ui.route, { hit: i, hitTo: to, hitFb: fb }); emit('ui.route.hit'); },
    openTask(id) { ui.tasks.open = id; emit('ui.tasks'); },
    /* ---------- 频道 ---------- */
    setChan(id) { if (ui.chan.id !== id) { ui.chan.id = id; ui.chan.focus = ''; ui.chan.picks = []; } emit('ui.chan'); },
    // 从别处点开一件任务：没在看“全部”就翻到它所在的频道，滚过去亮一下
    chanFocus(taskId) {
      const t = st.T.find(x => x.id === taskId); if (!t) return;
      if (ui.chan.id !== 'all') { const id = taskChan(st, t); if (ui.chan.id !== id) { ui.chan.id = id; ui.chan.picks = []; } }
      ui.chan.focus = taskId; emit('ui.chan');
    },
    chanPick(m) { if (!ui.chan.picks.some(x => x.k === m.k && x.session === m.session)) ui.chan.picks.push(m); ui.chan.mode = 'task'; emit('ui.chan.picks'); },
    chanUnpick(i) { ui.chan.picks.splice(i, 1); emit('ui.chan.picks'); },
    chanMode(mode) { ui.chan.mode = mode; emit('ui.chan.picks'); },
    chanDraft(v) { ui.chan.draft = v; },
    chanSeen(id, n) { if ((ui.chan.seen[id] || 0) !== n) { ui.chan.seen[id] = n; emit('ui.chan.seen'); } },
    togglePeople() { ui.chan.people = !ui.chan.people; emit('ui.chan'); },
    // 把一个对话拉进频道（0.3a 只记在这个页面里，刷新就没了）
    chanPull(id, sid) { const xs = (ui.chan.extra[id] ??= []); if (!xs.includes(sid)) xs.push(sid); emit('ui.chan'); },
    // 留言：只记在频道里，不送给任何 agent
    chanNote(id, text) {
      const now = clock(), d = new Date(now), time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      (st.NOTES[id] ??= []).push({ id: newId('n-'), seq: seqNow(st, now) + (st.NOTES[id].length * 1e-3), time: st.mode === 'live' ? time : st.DEMO.clock, text });
      emit('NOTES');
    },
    setTaskFilter(f) { ui.tasks.filter = f; emit('ui.tasks'); },
  };

  /* ---------- 刘海（演示里用网页画；应用里刘海是原生的，这几样只给派活前选对象用） ---------- */
  const hud = {
    // 刘海面板：idle 收起、overview 悬停总览、confirm 等你处理、reply 回信到了、compose 快速派活。pin 为假时鼠标移开就收起
    hud(state, pin = true) { ui.hud.state = state; ui.hud.pinned = pin && state !== 'idle'; emit('ui.hud'); },
    hudSel(i) { ui.hud.q = i; emit('ui.hud'); },
    hudStep(d) { const n = st.Q.length; if (n) { ui.hud.q = (ui.hud.q + d + n) % n; emit('ui.hud'); } },
    // 打开快速派活。target 预先选好的对象，mode new 新开对话 / msg 发给 session 那个对话。应用模式由后端换成打开原生刘海
    compose({ target, mode = 'new', session = '' } = {}) {
      Object.assign(ui.hud, { mode, session, auto: !target, suggest: '' });
      if (target) ui.hud.target = target;
      hud.hud('compose');
    },
    // 派活对象：不在了（设备移除或关了）就换回本机的 Codex
    target() {
      const k = ui.hud.target;
      if (!alive(st, k)) ui.hud.target = `codex@${st.home}`;
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
        const [a, d] = k.split('@'), c = (st.CONN[d] || []).find(x => x.a === a), list = st.MODELS[a] || [];
        const m = c && (list.some(x => x[0] === c.model) || c.model?.startsWith('group/')) ? c.model : list[0]?.[0] || '', lv = levelsOf(st, a, m);
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
  };

  /* ---------- 额度（magpie 的读数，两种模式都由 data/magpie.js 换） ---------- */
  const quota = {
    // 换一整份额度。mpq 是 { state, ver, at, cards }；quiet 只换数据不通知（数字没变、只是读取时间变了）
    setQuota(sub, mpq, quiet) {
      for (const k in st.SUB) delete st.SUB[k];
      Object.assign(st.SUB, sub);
      Object.assign(st.MPQ, mpq);
      if (!quiet) emit('SUB');
    },
  };

  const methods = { ...views, ...stage, ...conn, ...pages, ...hud, ...quota };
  // 后端：拿到状态、发话题、时钟、起 id、默认选中和上面这些界面方法，返回“真的去做”的那些方法
  const be = backend({ state, ui, emit, on, clock, newId, defaultSel, m: methods });
  Object.assign(methods, be);
  return { state, on, emit, set, flush, touched, clock, ...methods };
}
