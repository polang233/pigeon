(function () {
  const M = window.Pigeon;
  const $ = s => document.querySelector(s);
  const store = new M.Store();
  const sim = new M.Simulator(store);

  /* ---------- 主题 ---------- */
  const THEMES = {
    loft: root => new M.Loft(root, { onPick: band => openNote(band) }),
    'pixel-studio': root => new M.PixelStudio(root),
  };
  const LEGACY = { studio: 'loft', illustrated: 'loft' };
  const pick = id => (THEMES[id] ? id : LEGACY[id] || null);
  const read = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  let themeId = pick(read('pigeon-theme')) || pick(read('meerkat-theme')) || 'loft';
  let scene = {};
  let lastAgents = null;
  let lofts = null;
  let mode = 'connecting';
  let simOn = false;
  let everHeard = false;
  let theme = makeTheme(themeId);

  function makeTheme(id) {
    const root = $('#stage');
    root.className = 'stage';
    root.removeAttribute('style');
    return THEMES[id](root);
  }
  // 换主题后把当前状态补给新主题
  function switchTheme(id) {
    theme.destroy?.();
    themeId = id;
    $('#theme').value = id;
    theme = makeTheme(id);
    if (lastAgents) theme.setAgents(lastAgents);
    theme.setWaiting(store.waiting());
    theme.setUsage?.(M.Usage?.get());
    theme.setScene?.(scene);
    if (lofts) theme.setLofts?.(lofts);
    theme.setNotes?.(store.noteList());
  }

  store.on((type, d) => {
    if (type === 'taskStart') theme.taskStart(d);
    else if (type === 'taskEnd') theme.taskEnd(d);
    else if (type === 'activity') theme.activity(d);
    else if (type === 'activityEnd') theme.activityEnd(d);
    else if (type === 'taskActivity') theme.taskActivity(d);
    else if (type === 'waiting' || type === 'waitingEnd' || type === 'reset') {
      theme.setWaiting(store.waiting());
      renderWaiting();
      if (type === 'reset') theme.setNotes?.([]);
    }
    else if (type === 'turnEnd') theme.turnEnd(d);
    else if (type === 'heard') { theme.heard(); if (!simOn) { everHeard = true; hint(false); } }
    else if (type === 'noteUpdate') theme.noteUpdate?.(d);
    else if (type === 'notesLoaded') theme.setNotes?.(d);
    if (/^(note|notes|reset)/.test(type)) renderNotes();
    if (/^(task|reset)/.test(type) && type !== 'taskActivity') renderTasks();
  });

  /* ---------- 飞行记录 ---------- */
  const WHO = M.NOTE_WHO, STATE = M.NOTE_LABEL;
  const ACTIVE = new Set(['queued', 'flying', 'delivered']);
  const KIND = { codex: 'Codex', subagent: '子代理' };
  const STATUS = { running: '进行中', done: '完成', failed: '出错' };
  const seen = new Set();
  const open = new Set();
  let tab = 'notes';
  const fmt = ms => (ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} 秒` : ms < 3600e3 ? `${Math.floor(ms / 60000)} 分 ${Math.round((ms % 60000) / 1000)} 秒` : `${Math.floor(ms / 3600e3)} 小时 ${Math.round((ms % 3600e3) / 60000)} 分`);
  const when = ts => {
    const d = new Date(ts), now = new Date();
    const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hm}`;
  };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const who = e => WHO[e.agent] || e.agent || '？';
  const place = e => (e.loft && e.loft !== 'local' ? (e.loft_name || '远处') : '');

  function renderWaiting() {
    const box = $('#waiting');
    const items = store.waiting();
    box.replaceChildren();
    box.hidden = !items.length;
    for (const item of items) {
      const row = el('p');
      const fallback = { permission: '等你批准', question: '有问题问你', idle: '轮到你了', other: '等你回复' }[item.kind];
      const project = (item.cwd || '').split(/[\\/]/).filter(Boolean).pop() || '未知项目';
      // Claude Code 的提示是英文固定句，常见的翻成中文
      const tool = /^Claude needs your permission to use (.+)$/.exec(item.message || '');
      const text = item.kind === 'idle' ? fallback : tool ? `要用 ${tool[1]}` : M.oneLine(item.message, 64) || fallback;
      row.append(el('b', null, (item.agent === 'codex' ? 'Codex' : 'Claude') + ' 在等你'), ` · ${text} · ${project}`);
      row.title = item.message || fallback;
      box.appendChild(row);
    }
  }
  function setCounts(a, b, c, labels) {
    $('#count-a').textContent = a; $('#count-b').textContent = b; $('#count-c').textContent = c;
    ['a', 'b', 'c'].forEach((k, i) => { $(`#count-${k}-l`).textContent = labels[i]; });
  }
  function renderNotes() {
    const list = store.noteList();
    const flying = list.filter(n => ACTIVE.has(n.state)).length;
    $('#tab-notes-n').textContent = flying || list.length;
    $('#tab-notes-n').dataset.live = flying ? '1' : '';
    if (tab !== 'notes') return;
    setCounts(flying, list.filter(n => n.state === 'home').length, list.filter(n => n.state === 'refused' || n.state === 'lost').length, ['在飞', '归巢', '被拒或迷路']);
    const ol = $('#notes');
    const focus = document.activeElement && ol.contains(document.activeElement) ? document.activeElement.closest('[data-band]')?.dataset.band : null;
    ol.replaceChildren();
    if (!list.length) { ol.append(el('li', 'empty', '还没有纸条。agent 之间送信时会出现在这里：谁送给谁、飞到哪了、回信说了什么。')); return; }
    for (const n of list) ol.appendChild(noteRow(n));
    if (focus) ol.querySelector(`[data-band="${focus}"] .nrow`)?.focus();
  }
  function noteRow(n) {
    const li = el('li', `note${seen.has(n.band) ? '' : ' fresh'}`);
    seen.add(n.band);
    li.dataset.band = n.band;
    li.dataset.state = n.state;
    const isOpen = open.has(n.band);
    const btn = el('button', 'nrow');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', isOpen);
    const from = n.from || {}, to = n.to || {};
    const toName = to.title || (n.kind === 'new' ? '新对话' : who(to));
    const route = el('b');
    route.append(who(from), el('span', 'arrow', ' → '), toName);
    if (place(to)) route.append(el('span', 'at', ' @' + place(to)));
    const head = el('div', 'row');
    head.append(route, el('em', null, STATE[n.state] || n.state));
    const dur = fmt((ACTIVE.has(n.state) ? Date.now() : n.updated) - n.created);
    const meta = el('div', 'meta');
    meta.append(el('code', null, n.band), ` · ${n.via === 'relay' ? '经中继站' : n.via === 'queue' ? '本机直送' : '送信'} · ${dur}`);
    const text = n.state === 'home' && n.answer_preview ? '回信：' + n.answer_preview : (n.state === 'refused' || n.state === 'lost') && n.error ? n.error : n.preview;
    const body = el('div', 'body');
    body.append(head, meta);
    if (text) body.append(el('p', null, text));
    btn.append(el('i', 'dot'), body);
    li.append(btn);
    btn.onclick = () => { open.has(n.band) ? open.delete(n.band) : open.add(n.band); renderNotes(); };
    if (isOpen) li.append(noteDetail(n));
    return li;
  }
  function noteDetail(n) {
    const box = el('div', 'detail');
    const dl = el('dl');
    const add = (k, v) => { if (!v) return; dl.append(el('dt', null, k)); const dd = el('dd'); typeof v === 'string' ? (dd.textContent = v) : dd.append(v); dl.append(dd); };
    add('路线', M.noteRoute(n));
    if (n.preview) add('纸条', n.preview);
    if (n.answer_preview) add('回信', n.answer_preview);
    else if (n.state === 'home') add('回信', '回信已取回，用 pigeon read 看全文');
    if (n.error) add(n.state === 'refused' ? '拒收原因' : n.state === 'lost' ? '迷路原因' : '问题', n.error);
    add('链', n.count > 1 || n.chain !== n.band ? `第 ${n.count} 程 · 链首 ${n.chain}` : '第 1 程');
    add('时间', `${when(n.created)} 发出${n.updated !== n.created ? ` · ${when(n.updated)} 更新` : ''}`);
    box.append(dl);
    const links = el('div', 'links');
    const thread = (n.to || {}).agent === 'codex' ? n.to.session : '';
    if (thread) { const a = el('a', null, '在 Codex 里打开对方的对话'); a.href = `codex://threads/${thread}`; links.append(a); }
    const fromThread = (n.from || {}).agent === 'codex' ? n.from.session : '';
    if (fromThread) { const a = el('a', null, '打开发件的对话'); a.href = `codex://threads/${fromThread}`; links.append(a); }
    const copy = el('button', 'btn small', '复制脚环');
    copy.type = 'button';
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(n.band); copy.textContent = '已复制'; }
      catch (e) { copy.textContent = n.band; }
      setTimeout(() => { copy.textContent = '复制脚环'; }, 1600);
    };
    links.append(copy);
    box.append(links);
    if (n.state === 'lost' || n.state === 'refused') box.append(el('p', 'note-hint', '不会自动重发。要再送，用 pigeon send 重新发一张。'));
    return box;
  }
  function openNote(band) {
    showTab('notes');
    setCollapsed(false);
    open.add(band);
    renderNotes();
    const li = $('#notes').querySelector(`[data-band="${band}"]`);
    if (li) { li.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); li.classList.add('pulse'); setTimeout(() => li.classList.remove('pulse'), 900); }
  }
  function renderTasks() {
    const list = store.list().slice().reverse();
    const n = { running: 0, done: 0, failed: 0 };
    list.forEach(t => n[t.status]++);
    $('#tab-tasks-n').textContent = n.running || list.length;
    $('#tab-tasks-n').dataset.live = n.running ? '1' : '';
    if (tab !== 'tasks') return;
    setCounts(n.running, n.done, n.failed, ['进行中', '完成', '出错']);
    const ol = $('#tasks');
    ol.replaceChildren();
    if (!list.length) { ol.append(el('li', 'empty', '还没有派活。Claude Code 派出子代理或交给 Codex 时，会出现在这里。')); return; }
    for (const t of list) {
      const li = el('li', `task ${t.kind} ${t.status}${seen.has(t.id) ? '' : ' fresh'}`);
      seen.add(t.id);
      const dur = fmt((t.endedAt || Date.now()) - t.startedAt);
      const by = (t.kind === 'subagent' ? `子代理 · ${t.subagentType}` : t.via === 'codex-app' ? 'Codex 应用' : KIND[t.kind] || 'Codex') + (t.model ? ` · ${t.model}` : '');
      const head = el('div', 'row');
      head.append(el('b', null, t.title), el('em', null, STATUS[t.status]));
      const p = el('p', null, t.status === 'running' && t.realActivity && t.detail ? `正在：${t.detail}` : t.status === 'running' ? t.prompt : t.summary);
      const links = el('div', 'links');
      (t.files || []).forEach(f => { const s = el('code', null, f.split('/').slice(-2).join('/')); s.title = f; links.appendChild(s); });
      if (t.threadId) { const a = el('a', null, '在 Codex 里打开'); a.href = `codex://threads/${t.threadId}`; links.appendChild(a); }
      const body = el('div', 'body');
      body.append(head, el('div', 'meta', `${by}　${dur}`), p, links);
      li.append(el('i', 'dot'), body);
      li.title = t.prompt;
      ol.appendChild(li);
    }
  }
  function showTab(id) {
    tab = id;
    document.querySelectorAll('.log-tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === id));
    $('#notes').hidden = id !== 'notes';
    $('#tasks').hidden = id !== 'tasks';
    renderNotes(); renderTasks();
  }
  function setCollapsed(on) {
    $('#log').classList.toggle('collapsed', on);
    $('#log-toggle').setAttribute('aria-expanded', !on);
    $('#log-toggle').textContent = on ? '展开' : '收起';
    write('pigeon-log-collapsed', on ? '1' : '');
  }
  document.querySelectorAll('.log-tabs [data-tab]').forEach(b => { b.onclick = () => { showTab(b.dataset.tab); setCollapsed(false); }; });
  $('#log-toggle').onclick = () => setCollapsed(!$('#log').classList.contains('collapsed'));
  setCollapsed(read('pigeon-log-collapsed') === '1');

  setInterval(() => {
    if (tab === 'tasks' && store.running().length) renderTasks();
    if (tab === 'notes' && store.flyingNotes().length) renderNotes();
  }, 1000);
  setInterval(() => { theme.setWaiting(store.waiting()); renderWaiting(); }, 60000); // 过期的等待项按时消失

  /* ---------- 鸽舍和纸条的初始数据 ---------- */
  function applyLofts(data) {
    if (!data || !Array.isArray(data.lofts)) return;
    lofts = data;
    theme.setLofts?.(data);
    M.settings.setLofts?.(data);
  }
  async function getJSON(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
  // 模拟模式，或者连上了但接口取不到时，用内置的示例数据兜底
  async function loadLofts() {
    if (simOn || mode !== 'live') { applyLofts(M.simLofts()); return; }
    try { applyLofts(await getJSON('/api/lofts')); }
    catch (e) { if (!lofts) applyLofts({ version: 1, updated: 0, lofts: [{ id: 'local', name: '这台 Mac', online: true, sessions: [], projects: [] }] }); }
  }
  async function loadNotes() {
    if (simOn || mode !== 'live') { store.loadNotes(M.simNotes()); return; }
    try { const r = await getJSON('/api/notes'); store.loadNotes(Array.isArray(r.notes) ? r.notes : []); }
    catch (e) {}
  }
  setInterval(() => { if (mode === 'live' && !simOn) loadLofts(); }, 60000);

  /* ---------- 连接和模拟 ---------- */
  function setMode(m) {
    mode = m;
    const pill = $('#mode');
    pill.dataset.mode = simOn ? 'sim' : m;
    pill.textContent = simOn ? '模拟演示' : m === 'live' ? '已连接' : m === 'offline' ? '未连接应用' : '连接中…';
  }
  function setSim(on) {
    simOn = on;
    $('#sim').setAttribute('aria-pressed', on);
    store.reset();
    setMode(mode);
    if (on) { lastAgents = M.SIM_AGENTS; theme.setAgents(M.SIM_AGENTS); sim.start(); hint(false); }
    else { sim.stop(); if (mode === 'live') detect(); if (!everHeard) hint(true); }
    loadLofts();
    loadNotes();
    renderNotes(); renderTasks();
  }
  function connect() {
    if (!/^https?:$/.test(location.protocol)) { setMode('offline'); setSim(true); return; }
    let opened = false;
    const es = new EventSource('/events');
    es.onopen = () => {
      const first = !opened;
      opened = true; M.settings.setLive(true); setMode('live');
      if (!everHeard && !simOn) hint(true);
      // 启动时读一次设置；鸽舍和飞行记录从接口恢复
      fetch('/api/settings').then(r => r.json()).then(s => M.settings.applyRemote(s)).catch(() => {});
      if (!simOn) { loadLofts(); if (first) loadNotes(); }
    };
    es.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.type === 'detect' && m.agents && !simOn) { lastAgents = m.agents; theme.setAgents(m.agents); }
      if (m.type === 'usage') { M.Usage?.apply(m.usage); theme.setUsage?.(m.usage); }
      if (m.type === 'hook' && !simOn) store.ingest(m.payload, m.ts);
      if (m.type === 'settings') M.settings.applyRemote(m.settings);
    };
    es.onerror = () => {
      if (!opened) { es.close(); setMode('offline'); M.settings.setLive(false); setSim(true); }
      else { setMode('connecting'); M.settings.setLive(false); }
    };
  }
  function hint(show) { $('#hint').hidden = !show; }

  async function detect() {
    const btn = $('#detect');
    btn.disabled = true;
    try {
      await theme.detect(async () => {
        if (simOn || mode !== 'live') return sim.detect();
        try { const r = await fetch('/api/detect', { method: 'POST' }); return r.ok ? r.json() : null; } catch (e) { return null; }
      });
    } finally { btn.disabled = false; }
  }

  // 主题记在 scene.theme 里；连上应用时以应用存的为准
  M.settings.onScene = s => {
    scene = { ...s };
    theme.setScene?.(scene);
    const want = pick(s.theme);
    if (want && want !== themeId && !simOn) switchTheme(want);
  };
  M.Usage?.on?.(u => theme.setUsage?.(u));
  $('#usage-open').onclick = () => M.Usage?.open();
  $('#sim').onclick = () => setSim(!simOn);
  $('#detect').onclick = detect;
  $('#hint-sim').onclick = () => setSim(true);
  $('#theme').value = themeId;
  $('#theme').onchange = e => {
    const id = e.target.value;
    write('pigeon-theme', id);
    switchTheme(id);
    scene = { ...scene, theme: id };
    if (mode === 'live') M.settings.saveScene({ theme: id }).catch(() => {});
  };

  renderNotes(); renderTasks();
  connect();
  setTimeout(detect, 1400);
})();
