(function () {
  const M = window.Meerkat;
  const $ = s => document.querySelector(s);

  const store = new M.Store();
  const sim = new M.Simulator(store);

  /* ---------- 主题 ---------- */
  // 场景设置（工位数、谁坐哪）：连上应用时存在 settings.json；没连上时只记在本机浏览器里
  let scene = null;
  let lastAgents = null;
  const localScene = () => { try { return JSON.parse(localStorage.getItem('meerkat-scene') || 'null'); } catch (e) { return null; } };
  const keepLocal = patch => { try { localStorage.setItem('meerkat-scene', JSON.stringify({ ...(scene || {}), ...patch })); } catch (e) {} };
  // 模拟演示里的换位不保存，免得带进真实画面
  function saveScene(patch) {
    scene = { ...(scene || {}), ...patch };
    if (simOn && mode === 'live') return;
    keepLocal(patch);
    if (mode === 'live') M.settings.saveScene(patch).catch(() => {});
  }
  const THEMES = {
    studio: root => new M.Studio(root, { onLayout: layout => saveScene({ layout }) }),
    'pixel-studio': root => new M.PixelStudio(root),
  };
  let themeId = 'studio';
  try { const t = localStorage.getItem('meerkat-theme'); if (THEMES[t]) themeId = t; } catch (e) {}
  let theme = makeTheme(themeId);
  function makeTheme(id) {
    const root = $('#stage');
    root.className = 'stage';
    const t = THEMES[id](root);
    $('#seat-switch').hidden = !t.setScene;
    return t;
  }
  // 换主题后把当前状态补给新主题
  function switchTheme(id) {
    theme.destroy?.();
    themeId = id;
    theme = makeTheme(id);
    if (lastAgents) theme.setAgents(lastAgents);
    theme.setWaiting(store.waiting());
    theme.setUsage?.(M.Usage?.get());
    applyScene(scene || localScene() || {});
  }
  function applyScene(s) {
    scene = { ...s };
    theme.setScene?.(scene);
    const n = String(scene.seats || 3);
    document.querySelectorAll('#seat-switch button').forEach(b => b.setAttribute('aria-pressed', b.dataset.seats === n));
  }
  let mode = 'connecting';
  let simOn = false;
  let everHeard = false;

  store.on((type, d) => {
    if (type === 'taskStart') theme.taskStart(d);
    else if (type === 'taskUpdate') {}
    else if (type === 'taskEnd') theme.taskEnd(d);
    else if (type === 'activity') theme.activity(d);
    else if (type === 'activityEnd') theme.activityEnd(d);
    else if (type === 'taskActivity') theme.taskActivity(d);
    else if (type === 'waiting' || type === 'waitingEnd' || type === 'reset') {
      theme.setWaiting(store.waiting());
      renderWaiting();
    }
    else if (type === 'turnEnd') theme.turnEnd(d);
    else if (type === 'heard') { theme.heard(); if (!simOn) { everHeard = true; hint(false); } }
    if (type !== 'activity' && type !== 'activityEnd' && type !== 'heard' && type !== 'taskActivity') renderTasks();
  });

  /* ---------- 任务列表 ---------- */
  const KIND = { codex: 'Codex', subagent: '子代理' };
  const STATUS = { running: '进行中', done: '完成', failed: '出错' };
  const seen = new Set();
  const fmt = ms => (ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} 秒` : `${Math.floor(ms / 60000)} 分 ${Math.round((ms % 60000) / 1000)} 秒`);
  function renderWaiting() {
    const box = $('#waiting');
    const items = store.waiting();
    box.replaceChildren();
    box.hidden = !items.length;
    for (const item of items) {
      const row = document.createElement('p');
      const title = document.createElement('b');
      title.textContent = 'Claude 在等你';
      const fallback = { permission: '等你批准', question: '有问题问你', idle: '轮到你了', other: '等你回复' }[item.kind];
      const project = item.cwd.split(/[\\/]/).filter(Boolean).pop() || '未知项目';
      // Claude Code 的提示是英文固定句，常见的翻成中文
      const tool = /^Claude needs your permission to use (.+)$/.exec(item.message || '');
      const text = item.kind === 'idle' ? fallback : tool ? `要用 ${tool[1]}` : M.oneLine(item.message, 64) || fallback;
      row.append(title, ` · ${text} · ${project}`);
      row.title = item.message || fallback;
      box.appendChild(row);
    }
  }
  function renderTasks() {
    const list = store.list().slice().reverse();
    const n = { running: 0, done: 0, failed: 0 };
    list.forEach(t => n[t.status]++);
    $('#count-running').textContent = n.running;
    $('#count-done').textContent = n.done;
    $('#count-failed').textContent = n.failed;
    const ol = $('#tasks');
    if (!list.length) { ol.innerHTML = `<li class="empty">还没有任务。Claude Code 派出子代理或调用 Codex 时，会出现在这里。</li>`; return; }
    ol.innerHTML = '';
    for (const t of list) {
      const li = document.createElement('li');
      li.className = `task ${t.kind} ${t.status}${seen.has(t.id) ? '' : ' fresh'}`;
      seen.add(t.id);
      const dur = fmt((t.endedAt || Date.now()) - t.startedAt);
      const who = (t.kind === 'subagent' ? `子代理 · ${t.subagentType}` : t.via === 'codex-app' ? 'Codex 应用' : 'Codex') + (t.model ? ` · ${t.model}` : '');
      li.innerHTML = `<i class="dot" aria-hidden="true"></i><div class="body"><div class="row"><b></b><em></em></div><div class="meta"></div><p></p><div class="links"></div></div>`;
      li.querySelector('b').textContent = t.title;
      li.querySelector('em').textContent = STATUS[t.status];
      li.querySelector('.meta').textContent = `${who}　${dur}`;
      li.querySelector('p').textContent = t.status === 'running' ? t.prompt : t.summary;
      li.title = t.prompt;
      const links = li.querySelector('.links');
      (t.files || []).forEach(f => { const s = document.createElement('code'); s.textContent = f.split('/').slice(-2).join('/'); s.title = f; links.appendChild(s); });
      if (t.threadId) { const a = document.createElement('a'); a.href = `codex://threads/${t.threadId}`; a.textContent = '在 Codex 里打开'; links.appendChild(a); }
      if (t.status === 'running' && t.realActivity && t.detail) li.querySelector('p').textContent = `正在：${t.detail}`;
      ol.appendChild(li);
    }
  }
  setInterval(() => { if (store.running().length) renderTasks(); }, 1000);
  setInterval(() => { theme.setWaiting(store.waiting()); renderWaiting(); }, 60000); // 过期的等待项按时消失

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
    if (on) { lastAgents = M.SIM_AGENTS; theme.setAgents(M.SIM_AGENTS); sim.start(); hint(false); }
    else { sim.stop(); if (mode === 'live') detect(); if (!everHeard) hint(true); }
    setMode(mode);
    renderTasks();
  }
  function connect() {
    if (!/^https?:$/.test(location.protocol)) { setMode('offline'); setSim(true); return; }
    let opened = false;
    const es = new EventSource('/events');
    es.onopen = () => {
      opened = true; M.settings.setLive(true); setMode('live');
      if (!everHeard && !simOn) hint(true);
      // 启动时读一次设置，场景按存下的布局摆
      fetch('/api/settings').then(r => r.json()).then(s => M.settings.applyRemote(s)).catch(() => {});
    };
    es.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.type === 'detect' && m.agents && !simOn) { lastAgents = m.agents; theme.setAgents(m.agents); }
      if (m.type === 'usage') { M.Usage?.apply(m.usage); theme.setUsage?.(m.usage); }
      if (m.type === 'hook' && !simOn) store.ingest(m.payload, m.ts);
      if (m.type === 'settings') M.settings.applyRemote(m.settings);
    };
    es.onerror = () => {
      if (!opened) { es.close(); setMode('offline'); setSim(true); }
      else setMode('connecting');
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

  M.settings.onScene = s => { if (!simOn) applyScene(s); };
  M.Usage?.on?.(u => theme.setUsage?.(u));
  $('#usage-open').onclick = () => M.Usage?.open();
  document.querySelectorAll('#seat-switch button').forEach(b => {
    b.onclick = () => { const seats = Number(b.dataset.seats); applyScene({ ...(scene || {}), seats }); saveScene({ seats }); };
  });
  $('#sim').onclick = () => setSim(!simOn);
  $('#detect').onclick = detect;
  $('#hint-sim').onclick = () => setSim(true);
  $('#theme').value = themeId;
  $('#theme').onchange = e => {
    try { localStorage.setItem('meerkat-theme', e.target.value); } catch (err) {}
    switchTheme(e.target.value);
  };
  applyScene(localScene() || {});

  renderTasks();
  connect();
  setTimeout(detect, 1400);
})();
