// 设置面板：读写 Pigeon 应用的 /api/settings，包含提醒、送信、栖木和 Codex 的设置。
// 保存时只覆盖面板里有的字段，别的模块写的、这里不认识的字段原样保留。
(function () {
  const M = (window.Pigeon = window.Pigeon || {});
  const $ = s => document.querySelector(s);

  const DEFAULTS = {
    preferForImages: true, imageMode: 'builtin', imageModel: 'gpt-image-2', imageQuality: 'medium',
    imageAspect: 'square', imageTransparent: false, imageDir: 'assets/generated',
    sessionMode: 'keep', autoOpen: false, routeAll: true, model: '', effort: '', sandbox: 'auto',
    timeoutMin: 10, maxConcurrent: 2, summaryChars: 300,
  };
  const NOTIFY_DEFAULTS = { done: true, failed: true, waiting: true, turnEnd: true, turnMinSec: 60, noteHome: true, noteLost: true };
  const SCENE_DEFAULTS = { theme: 'loft', hoverCards: true };
  const POST_DEFAULTS = { relayThread: '', maxHops: 10, waitTimeoutMin: 10 };
  const POST_CONFIRM_DEFAULT = true; // 跨电脑发送前弹框确认，单独处理（它是开关，不是输入框）
  const POST_LIMITS = { maxHops: [1, 50], waitTimeoutMin: [1, 120] };
  const PERCH_DEFAULTS = { enabled: true };
  const postField = k => 'post' + k[0].toUpperCase() + k.slice(1);
  const notifyField = k => 'notify' + k[0].toUpperCase() + k.slice(1);
  const EFFORT = { none: '不推理', minimal: '极少', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高', ultra: '超高' };

  let all = { version: 1 };
  let models = [];
  let live = false;
  let loaded = false;
  let writes = Promise.resolve();
  let hookInstalled = false;
  let hookReady = false;
  let hookBusy = false;
  const dlg = $('#settings'), form = $('#settings-form');
  const field = n => form.elements[n];

  function fill(c, notify) {
    for (const [k, v] of Object.entries(c)) {
      const f = field(k);
      if (!f) continue;
      if (f instanceof RadioNodeList) f.value = v;
      else if (f.type === 'checkbox') f.checked = !!v;
      else f.value = v;
    }
    for (const [k, v] of Object.entries(notify)) {
      const f = field(notifyField(k));
      if (!f) continue;
      if (f.type === 'checkbox') f.checked = !!v;
      else f.value = v;
    }
    fillEfforts(c.effort);
    sync();
  }
  function read() {
    const c = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      const f = field(k);
      if (!f) continue;
      if (f instanceof RadioNodeList) c[k] = f.value || DEFAULTS[k];
      else if (f.type === 'checkbox') c[k] = f.checked;
      else if (f.type === 'number') c[k] = Math.max(Number(f.min) || 0, Math.min(Number(f.max) || 1e9, Number(f.value) || DEFAULTS[k]));
      else c[k] = f.value.trim();
    }
    if (!c.imageDir) c.imageDir = DEFAULTS.imageDir;
    return c;
  }
  function readNotify() {
    const n = { ...NOTIFY_DEFAULTS };
    for (const k of Object.keys(n)) {
      const f = field(notifyField(k));
      if (f.type === 'checkbox') n[k] = f.checked;
      else {
        const value = f.value.trim() ? Number(f.value) : NaN;
        n[k] = Number.isFinite(value) ? Math.max(10, Math.min(3600, Math.round(value))) : NOTIFY_DEFAULTS[k];
      }
    }
    return n;
  }
  function codexOf(c = {}) {
    // 老版本只存了 showInCodex，换算成对话记录模式
    const out = { ...DEFAULTS, ...c };
    if (!c.sessionMode && c.showInCodex === false) out.sessionMode = 'temp';
    return out;
  }
  function scene() { return { ...SCENE_DEFAULTS, ...(all.scene || {}) }; }
  function post() { return { ...POST_DEFAULTS, ...(all.post || {}) }; }
  function perch() { return { ...PERCH_DEFAULTS, ...(all.perch || {}) }; }
  function sceneChanged() { M.settings.onScene?.(scene()); }
  function fillAll() {
    fill(codexOf(all.codex), { ...NOTIFY_DEFAULTS, ...(all.notify || {}) });
    field('sceneHoverCards').checked = scene().hoverCards !== false;
    const p = post();
    for (const k of Object.keys(POST_DEFAULTS)) field(postField(k)).value = p[k];
    field('postConfirmRemote').checked = (all.post || {}).confirmRemote !== false && POST_CONFIRM_DEFAULT;
    field('perchEnabled').checked = perch().enabled !== false;
  }
  function readScene() { return { hoverCards: field('sceneHoverCards').checked }; }
  function readPost() {
    const out = { relayThread: field('postRelayThread').value.trim(), confirmRemote: field('postConfirmRemote').checked };
    for (const [k, [lo, hi]] of Object.entries(POST_LIMITS)) {
      const raw = field(postField(k)).value.trim();
      const n = raw ? Math.round(Number(raw)) : NaN;
      out[k] = Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : POST_DEFAULTS[k];
    }
    return out;
  }
  // 中继站候选：本机鸽舍里的 Codex 对话
  function fillRelayOptions(lofts) {
    const list = $('#relay-options');
    const local = (lofts && Array.isArray(lofts.lofts) ? lofts.lofts : []).find(l => l.id === 'local');
    list.replaceChildren();
    for (const s of (local && local.sessions) || []) {
      if (s.agent && s.agent !== 'codex') continue;
      const o = document.createElement('option');
      o.value = s.id; o.label = (s.relay ? '★ ' : '') + (s.title || s.id);
      list.appendChild(o);
    }
  }
  function fillModels() {
    const sel = field('model');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Codex 默认</option>' + models.map(m => `<option value="${m.slug}">${m.name}</option>`).join('');
    sel.value = models.some(m => m.slug === cur) ? cur : '';
  }
  function fillEfforts(want) {
    const sel = field('effort');
    const m = models.find(x => x.slug === field('model').value);
    const list = m && m.efforts.length ? m.efforts : ['low', 'medium', 'high', 'xhigh', 'max'];
    sel.innerHTML = '<option value="">Codex 默认</option>' + list.map(e => `<option value="${e}">${EFFORT[e] || e}（${e}）</option>`).join('');
    sel.value = list.includes(want) ? want : '';
  }
  function sync() {
    const api = field('imageMode').value === 'api';
    form.querySelectorAll('.api-only').forEach(el => { el.hidden = !api; });
    field('autoOpen').disabled = field('sessionMode').value === 'temp';
  }
  function state(text, tone = '') { const s = $('#save-state'); s.textContent = text; s.dataset.tone = tone; }
  async function json(url, options) {
    const r = await fetch(url, options);
    if (!r.ok) throw new Error(await r.text() || `HTTP ${r.status}`);
    return r.json();
  }
  function hookState(text, tone = '') {
    const s = $('#codex-hooks-state'); s.textContent = text; s.dataset.tone = tone;
    field('codexHooks').disabled = !live || !hookReady || hookBusy;
  }
  function applyHooks(s) {
    hookInstalled = !!s.installed; hookReady = true;
    field('codexHooks').checked = hookInstalled;
    hookState(s.detail || (s.working ? '已收到 Codex 事件' : '还没收到 Codex 事件'));
  }
  async function loadHooks() {
    if (hookBusy) return;
    hookReady = false;
    hookState(live ? '读取中…' : '没连上 Pigeon 应用');
    if (!live) return;
    try { applyHooks(await json('/api/codex/hooks')); }
    catch (e) { hookState('读取失败：' + (e.message || e) + '，请重新打开设置重试', 'bad'); }
  }
  async function toggleHooks() {
    const enable = field('codexHooks').checked;
    if (!live || !hookReady || hookBusy) { field('codexHooks').checked = hookInstalled; return; }
    hookBusy = true; hookState('更新中…');
    try {
      applyHooks(await json('/api/codex/hooks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enable }) }));
    } catch (e) {
      field('codexHooks').checked = hookInstalled;
      hookState('更新失败：' + (e.message || e) + '，请重试', 'bad');
    } finally { hookBusy = false; field('codexHooks').disabled = !live || !hookReady; }
  }

  // 串行写完整设置，拖拽保存和面板保存不会互相覆盖。
  function persist(update) {
    const write = writes.catch(() => {}).then(async () => {
      if (!live) throw new Error('没连上 Pigeon 应用');
      if (!loaded) { all = await json('/api/settings'); loaded = true; }
      all = await json('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update(all)) });
      loaded = true;
      sceneChanged();
      return scene();
    });
    writes = write;
    return write;
  }

  async function load() {
    if (!live) { fillAll(); state('没连上 Pigeon 应用，只能看，保存不了', 'warn'); return; }
    try {
      const [s, m] = await Promise.all([json('/api/settings'), json('/api/codex/models').catch(() => [])]);
      all = s && typeof s === 'object' ? s : {};
      loaded = true;
      models = Array.isArray(m) ? m : [];
      fillModels();
      fillAll();
      sceneChanged();
      state('');
    } catch (e) { state('读取设置失败', 'bad'); }
  }
  async function save() {
    if (!live) return;
    const codex = read(), notify = readNotify(), s = readScene(), p = readPost(), pc = { enabled: field('perchEnabled').checked };
    state('保存中…');
    try {
      await persist(current => ({ ...current, version: 1,
        codex: (({ showInCodex, ...rest }) => rest)({ ...(current.codex || {}), ...codex }),
        notify: { ...(current.notify || {}), ...notify },
        scene: { ...(current.scene || {}), ...s },
        post: { ...(current.post || {}), ...p },
        perch: { ...(current.perch || {}), ...pc },
      }));
      fillAll();
      state('设置已保存', 'ok');
    } catch (e) { state('保存失败：' + (e.message || e), 'bad'); }
  }

  form.addEventListener('change', e => {
    if (e.target.name === 'codexHooks') { toggleHooks(); return; }
    if (e.target.name === 'model') fillEfforts(field('effort').value);
    sync();
    state('有改动，还没保存');
  });
  $('#save-settings').onclick = save;
  $('#open-settings').onclick = () => { dlg.showModal(); load(); loadHooks(); };
  // 分页：通用 / 各个 agent
  form.querySelectorAll('.agent-tabs [data-pane]').forEach(tab => {
    tab.onclick = () => {
      form.querySelectorAll('.agent-tabs [data-pane]').forEach(t => { t.classList.toggle('on', t === tab); t.setAttribute('aria-selected', t === tab); });
      form.querySelectorAll('.pane').forEach(p => { p.hidden = p.dataset.pane !== tab.dataset.pane; });
    };
  });

  M.settings = {
    setLive(v) { live = v; field('codexHooks').disabled = !live || !hookReady || hookBusy; },
    scene, post, perch,
    setLofts: fillRelayOptions,
    saveScene(patch) {
      return persist(current => ({ ...current, scene: { ...(current.scene || {}), ...patch } }));
    },
    applyRemote(s) {
      if (s && typeof s === 'object') {
        all = s; loaded = true;
        if (dlg.open && !/还没保存/.test($('#save-state').textContent)) fillAll();
        sceneChanged();
      }
    },
  };
})();
