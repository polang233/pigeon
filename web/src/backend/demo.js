// 演示后端：在内存里模拟“真的去做”。数据来自 data/mock.js，方法马上返回结果。
// 应用模式换成 backend/live.js，方法名和返回的样子一样（那边返回 Promise）。
// ctx 是 store 给的：state、ui、emit、clock、newId、defaultSel，m 是 store 的界面方法（hud、target、pickOf……）。
import { AGENTS, AG } from '../core/labels.js';
import { by, keyOf, agOf, dvOf, levelsOf, midLevel, qInfo, qDevs, nameOf, tById, leadSession, askOn, isPaused, online, endOf, removalImpact, validLead, cleanName, customModelsOf } from '../core/names.js';
import { targets, routeOf } from '../core/route.js';
import { kindsIn } from '../core/secrets.js';
import { APP } from '../core/labels.js';

export function createDemo({ state: st, ui, emit, clock, newId, defaultSel, m }) {
  let seq = 0;
  const end = s => ({ dev: s.dev, agent: s.agent, session: s.id === 'you' ? '' : s.id });

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
      const found = kindsIn(t.body || t.title), now = clock();
      st.Q.push({ id: newId('q'), kind: 'cross', band: t.id, from: end(from), to: end(to), preview: t.title.slice(0, 80), ...(t.why?.rule ? { rule: t.why.rule } : {}),
        created: now, deadline: now + st.settings.crossTimeoutSec * 1000, ...(found.length ? { secrets: found } : {}) });
      return 'asking';
    }
    if (isPaused(st, to.dev)) { t.state = 'queued'; t.paused = true; if (fresh) to.note = '排着，暂停中'; return 'paused'; }
    send(t);
    return 'flying';
  }
  // 给 agent@设备 找一个能接活的对话（不是指挥、不是子对话），没有就新开一个；fresh 为真时一定新开
  function sessionFor(k, title, model, fresh = false) {
    const L = leadSession(st);
    const s = !fresh && st.S.find(x => keyOf(x) === k && !x.parent && x !== L && x.state !== 'error');
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
      return { msg: `已放行，正在送往 ${st.DEV[d].name}${masked ? '，密钥打了码' : ''}`, fly: [x.from.agent, agOf(x.to)] };
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
  // 暂停解除后：放行过、排着的先送出去，暂停时直接派的也送出去
  function resume() {
    let n = 0;
    for (const q of [...st.Q]) if (q.paused && !qDevs(q).some(d => isPaused(st, d))) { st.Q.splice(st.Q.indexOf(q), 1); perform(q, true, q.opt || {}); n++; }
    for (const t of st.T) if (t.paused && t.state === 'queued' && !st.Q.some(q => q.band === t.id) && !isPaused(st, by(st, t.to)?.dev)) { send(t); n++; }
    if (n) { m.clampQueue(); emit('Q', 'T', 'S'); }
    return n;
  }

  const ruleAt = id => st.RULES.find(r => r.id === id);

  const be = {
    /* ---------- 暂停、指挥 ---------- */
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
    // 跳回发起的对话：演示里不跳，返回一句提示
    openSession(id) { const s = by(st, id); return s ? `会${s.dev === st.home ? `在 ${APP[s.agent]} 里打开` : '在本机 Codex 里打开'}「${s.title}」（演示里不跳转）` : ''; },
    // 设置里刘海的演示按钮：演示里就是网页画的刘海
    notchDemo(state) { m.hud(state); },

    /* ---------- 设备和接入 ---------- */
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
    // 连不连得上（设置里“演示：断开”用）
    setOnline(d, on) { if (st.DEV[d]) { st.DEV[d].online = on; emit('DEV'); } },
    // 接入页、指挥台的“重试”：把那台连回来
    reconnect(d) { be.setOnline(d, true); return `${st.DEV[d].name} 重新连上了（示例）`; },
    toggleConn(d, a) { const c = st.CONN[d].find(x => x.a === a); c.on = !c.on; emit('DEV'); },
    // 接入页里改一个 agent 的默认模型、思考强度。刘海派活那边记的选择跟着作废，下次按新的默认来
    setConnModel(d, a, mdl) {
      const c = (st.CONN[d] || []).find(x => x.a === a); if (!c) return null;
      c.model = mdl; const lv = levelsOf(st, a, mdl); if (!lv.includes(c.think)) c.think = midLevel(lv);
      delete ui.hud.pick[`${a}@${d}`]; emit('DEV');
      return c;
    },
    setConnThink(d, a, t) {
      const c = (st.CONN[d] || []).find(x => x.a === a); if (!c) return null;
      c.think = t; delete ui.hud.pick[`${a}@${d}`]; emit('DEV');
      return c;
    },
    // 自己填的模型名（演示里只记在页面上）
    addCustomModel(d, a, name) {
      const m = String(name || '').trim().slice(0, 80); if (!m) return null;
      const k = `${a}@${d}`, cur = customModelsOf(st, a, d);
      if ((st.MODELS[a] || []).some(x => x[0] === m) || cur.includes(m)) return `已经有 ${m} 了`;
      st.CUSTOMM = { ...(st.CUSTOMM || {}), [k]: [...cur, m] }; emit('DEV');
      return `加上了 ${m}（示例）`;
    },
    removeCustomModel(d, a, m) {
      const k = `${a}@${d}`; st.CUSTOMM = { ...(st.CUSTOMM || {}), [k]: customModelsOf(st, a, d).filter(x => x !== m) };
      const c = (st.CONN[d] || []).find(x => x.a === a); if (c && c.model === m) c.model = '';
      emit('DEV'); return `去掉了 ${m}（示例）`;
    },
    openRelay() { return '演示里打不开 Codex'; },
    // 中继站（演示）：示例数据在 mock 里，换、归档、删除只改页面上的
    loadRelay() { emit('RELAY'); },
    // 一件任务的全文：演示里正文就是要发的内容或标题，回信就是 reply
    loadFull(band) {
      st.FULL ??= {};
      const t = st.T.find(x => x.id === band);
      if (t) st.FULL[band] = { body: t.body || t.title, answer: t.reply || '', busy: false, err: '', state: t.state };
      emit('FULL');
    },
    relayDo(action, id, host = '') {
      const R = st.RELAY, row = R.relays.find(r => r.id === id);
      if (action === 'use') {
        if (host) { if (id) R.byHost = { ...R.byHost, [host]: id }; else { const b = { ...R.byHost }; delete b[host]; R.byHost = b; } } else R.shared = id;
        R.relays.forEach(r => { r.shared = r.id === R.shared; r.hosts = Object.keys(R.byHost).filter(h => R.byHost[h] === r.id); });
      } else if (row) {
        if (row.shared || row.hosts.length) return Promise.reject(new Error('这条还在当中继站用，先换一条'));
        if (action === 'delete') R.relays = R.relays.filter(r => r !== row); else row.archived = action === 'archive';
      }
      emit('RELAY');
      return (action === 'use' ? (id ? `中继站换成「${(row || {}).title || id}」` : '这台跟着共用的中继站') : { archive: '归档了', unarchive: '恢复了', delete: '删掉了' }[action]) + '（示例）';
    },
    // 一键接入本机全部。返回改之前的样子，撤回时交回来
    applyPlan() {
      const before = (st.CONN[st.home] || []).map(c => c.on);
      ui.conn.plan = false; (st.CONN[st.home] || []).forEach(c => (c.on = true)); emit('DEV', 'ui.conn.plan');
      return before;
    },
    undoPlan(before) { (st.CONN[st.home] || []).forEach((c, i) => (c.on = before[i] ?? c.on)); emit('DEV'); },
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
      m.clampQueue();
      emit('DEV', 'S', 'T', 'Q', 'ui.stage.sel', 'ui.conn.rm');
      return D.name;
    },
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

    /* ---------- 分派规则 ---------- */
    toggleRule(id) { const r = ruleAt(id); r.on = !r.on; emit('RULES'); },
    // when、kw 是打字，只发 ruleText；交给谁、改派、问不问发 RULES
    setRule(id, f, v) {
      const r = ruleAt(id); if (!r) return;
      r[f] = f === 'ask' || f === 'must' ? v === '1' || v === true : v;
      emit(f === 'when' || f === 'kw' ? 'ruleText' : 'RULES');
    },
    addRule(to) {
      const r = { id: 'r' + clock().toString(36) + (++seq), when: '', kw: '', to: to || targets(st)[0] || `claude@${st.home}`, fb: '', ask: false, on: true, must: false, n: 0, over: 0 };
      st.RULES.push(r); emit('RULES');
      return r;
    },
    delRule(id) { const i = st.RULES.findIndex(r => r.id === id); const [r] = st.RULES.splice(i, 1); ui.route.hit = -1; emit('RULES', 'ui.route.hit'); return r; },
    moveRule(from, to) { st.RULES.splice(to, 0, st.RULES.splice(from, 1)[0]); emit('RULES'); },
    setLow(v) { st.LOW = v; emit('RULES'); },
    toggleRule2(id) { const r = st.RULES2.find(x => x.id === id); r.on = !r.on; emit('RULES2'); },
    // 下拉的那几条。跨设备等几秒（xto）也是设置里的 crossTimeoutSec，写进提示的原文要跟着变
    setRule2(id, v) {
      const r = st.RULES2.find(x => x.id === id); r.v = v; emit('RULES2');
      if (id === 'xto') { st.settings.crossTimeoutSec = v; emit('settings.crossTimeoutSec'); }
    },

    /* ---------- 任务 ---------- */
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

    /* ---------- 刘海上派活、等你的一队 ---------- */
    // 发出：生成一件任务（发件人是你），按规矩走：跨设备且要问就排进等你的一队，暂停中先排着，否则送出。
    // 返回 { empty } 或 { result, task, fresh }，提示由调用的一方说
    send() {
      const v = ui.hud.draft.trim(), k = m.target();
      if (!v) return { empty: true };
      const p = m.pickOf(k), msgTo = ui.hud.mode === 'msg' && by(st, ui.hud.session);
      const [to, fresh] = msgTo && keyOf(msgTo) === k ? [msgTo, false] : sessionFor(k, v, p);
      if (fresh) { to.model = p.m; to.think = p.t; }
      const t = newTask(by(st, 'you'), to, v, { why: whyFor(v, k), ctx: { tokens: Math.max(200, v.length * 40), window: 200000, files: [] } });
      const result = launch(t, { fresh });
      ui.hud.draft = ''; ui.hud.suggest = '';
      if (result === 'asking') { ui.hud.q = st.Q.length - 1; m.hud('confirm'); } else m.hud('idle');
      emit('T', 'S', 'Q', 'draft');
      return { result, task: t, fresh };
    },
    // 频道里发出去：targets 是 @ 了谁（没 @ 时页面已经换成指挥），每个各派一件，发件人是你。
    // 0.3a 正文就是你写的这句；以后（0.3b）会附上频道背景：成员名单和最近几条的摘要
    chanSend({ targets, text, chan }) {
      const v = text.trim();
      if (!v || !targets.length) return { empty: true };
      const results = targets.map(x => {
        const k = x.k, p = m.pickOf(k), given = x.session && by(st, x.session);
        const [to, fresh] = given ? [given, false] : sessionFor(k, v, p, !!x.fresh);
        if (fresh) { to.model = p.m; to.think = p.t; const at = chan?.paths?.find(x => x.dev === to.dev) || chan?.paths?.[0]; if (at && !to.cwd) to.cwd = at.path; } // 新开的对话放进这个频道的项目目录
        const why = x.lead && !x.picked ? { kind: 'lead', reason: '在频道里没 @ 谁，交给指挥分派' } : whyFor(v, k);
        const t = newTask(by(st, 'you'), to, v, { why, ctx: { tokens: Math.max(200, v.length * 40) + 900, window: 200000, files: [] } });
        return { result: launch(t, { fresh }), task: t, fresh };
      });
      emit('T', 'S', 'Q');
      return { results };
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
      m.clampQueue();
      emit('Q', 'T', 'S');
      return r;
    },
    // 转派以后不再问：关掉协作规矩里那一条，再放行这一件
    qAuto(i) { const r = st.RULES2.find(x => x.id === 'relay'); if (r) r.on = false; emit('RULES2'); return be.qDo(i, true); },
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
      if (out.length) { m.clampQueue(); emit('Q', 'T', 'S'); }
      return out;
    },
    // 演示：来一件转派或拆活。规矩开着就排进等你的一队，关了直接做
    incoming(kind) {
      const ev = structuredClone(st.DEMO[kind]);
      const ask = kind === 'relay' ? askOn(st, 'relay') : askOn(st, 'split') && ev.parts.length >= 3;
      const q = { id: newId('q'), kind, ...ev, created: clock() };
      if (ask) { st.Q.push(q); ui.hud.q = st.Q.length - 1; m.hud('confirm'); emit('Q'); return { asked: true }; }
      const r = perform(q, true);
      emit('Q', 'T', 'S');
      return { asked: false, msg: r.msg };
    },
  };
  return be;
}
