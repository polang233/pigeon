// 设置面板：读写 Meerkat 应用的 /api/settings，包含系统提醒和 Codex 的设置。
(function () {
  const M = (window.Meerkat = window.Meerkat || {});
  const $ = s => document.querySelector(s);

  const DEFAULTS = {
    preferForImages: true, imageMode: 'builtin', imageModel: 'gpt-image-2', imageQuality: 'medium',
    imageAspect: 'square', imageTransparent: false, imageDir: 'assets/generated',
    showInCodex: true, autoOpen: false, model: '', effort: '', sandbox: 'auto',
    timeoutMin: 10, maxConcurrent: 2, summaryChars: 300,
  };
  const NOTIFY_DEFAULTS = { done: true, failed: true, waiting: true, turnEnd: true, turnMinSec: 60 };
  const notifyField = k => 'notify' + k[0].toUpperCase() + k.slice(1);
  const EFFORT = { none: '不推理', minimal: '极少', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高', ultra: '超高' };

  let all = { version: 1 };
  let models = [];
  let live = false;
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
  function fillAll() { fill({ ...DEFAULTS, ...(all.codex || {}) }, { ...NOTIFY_DEFAULTS, ...(all.notify || {}) }); }
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
    field('autoOpen').disabled = !field('showInCodex').checked;
  }
  function state(text, tone = '') { const s = $('#save-state'); s.textContent = text; s.dataset.tone = tone; }

  async function load() {
    if (!live) { fillAll(); state('没连上 Meerkat 应用，只能看，保存不了', 'warn'); return; }
    try {
      const [s, m] = await Promise.all([fetch('/api/settings').then(r => r.json()), fetch('/api/codex/models').then(r => r.json()).catch(() => [])]);
      all = s && typeof s === 'object' ? s : {};
      models = Array.isArray(m) ? m : [];
      fillModels();
      fillAll();
      state('');
    } catch (e) { state('读取设置失败', 'bad'); }
  }
  async function save() {
    if (!live) return;
    const next = { ...all, version: 1, codex: { ...(all.codex || {}), ...read() }, notify: { ...(all.notify || {}), ...readNotify() } };
    state('保存中…');
    try {
      const r = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
      if (!r.ok) throw new Error(await r.text());
      all = await r.json();
      fillAll();
      state('设置已保存', 'ok');
    } catch (e) { state('保存失败：' + (e.message || e), 'bad'); }
  }

  form.addEventListener('change', e => {
    if (e.target.name === 'model') fillEfforts(field('effort').value);
    sync();
    state('有改动，还没保存');
  });
  $('#save-settings').onclick = save;
  $('#open-settings').onclick = () => { dlg.showModal(); load(); };

  M.settings = {
    setLive(v) { live = v; },
    applyRemote(s) { if (s && typeof s === 'object') { all = s; if (dlg.open && !/还没保存/.test($('#save-state').textContent)) fillAll(); } },
  };
})();
