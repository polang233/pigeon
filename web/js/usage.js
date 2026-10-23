// 用量只读本机统计；SSE 的 usage 消息由 main.js 转给 apply。
(function () {
  const M = (window.Meerkat = window.Meerkat || {});
  const dlg = document.querySelector('#usage');
  const cards = document.querySelector('#usage-cards');
  const state = document.querySelector('#usage-state');
  const NAMES = { claude: 'Claude Code', subagent: '子代理', codex: 'Codex', cursor: 'Cursor', deepseek: 'DeepSeek' };
  const METRICS = [['output', '输出'], ['input', '输入'], ['cacheRead', '缓存读'], ['cacheWrite', '缓存写'], ['messages', '消息数']];
  const listeners = new Set();
  let latest = null;
  let pending = null;
  let connected = false;

  function format(n) {
    const value = Math.max(0, Number(n) || 0);
    if (!Number.isFinite(value)) return '0';
    const unit = value >= 1e8 ? 1e8 : value >= 1e4 ? 1e4 : 1;
    return unit === 1 ? String(Math.round(value)) : String(Number((value / unit).toFixed(1))) + (unit === 1e8 ? ' 亿' : ' 万');
  }
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function render() {
    cards.replaceChildren();
    if (!connected) { state.textContent = pending ? '正在读取用量…' : '没连上 Meerkat 应用'; return; }
    const agents = Object.entries(latest.agents || {}).filter(([, data]) => data && typeof data === 'object');
    // 已知 agent 保持固定顺序，新增的 agent 也能直接显示。
    const order = Object.keys(NAMES);
    agents.sort(([a], [b]) => (order.includes(a) ? order.indexOf(a) : order.length) - (order.includes(b) ? order.indexOf(b) : order.length));
    state.textContent = agents.length ? `${latest.day || '今天'} · token 用量` : '还没有用量记录';
    for (const [agent, data] of agents) {
      const card = el('section', null, 'usage-card');
      const heading = el('div', null, 'usage-heading');
      heading.append(el('h3', NAMES[agent] || agent), el('span', data.model || '模型未记录', 'usage-model'));
      const table = el('table');
      const caption = el('caption', `${NAMES[agent] || agent} 的 token 用量和消息数`, 'sr');
      const head = el('thead'), row = el('tr');
      for (const name of ['统计项', '今天', '近 7 天']) { const th = el('th', name); th.scope = 'col'; row.append(th); }
      head.append(row);
      const body = el('tbody');
      for (const [key, label] of METRICS) {
        const tr = el('tr'), th = el('th', label); th.scope = 'row'; tr.append(th);
        for (const period of ['today', 'week']) {
          const n = data[period]?.[key];
          const td = el('td', n == null ? '—' : key === 'messages' ? Number(n).toLocaleString('zh-CN') : format(n));
          if (n != null) td.title = Number(n).toLocaleString('zh-CN') + (key === 'messages' ? ' 条消息' : ' token');
          tr.append(td);
        }
        body.append(tr);
      }
      table.append(caption, head, body); card.append(heading, table); cards.append(card);
    }
  }
  function apply(summary) {
    if (!summary || typeof summary !== 'object' || !summary.agents || typeof summary.agents !== 'object') return;
    latest = summary; connected = true;
    render();
    for (const fn of listeners) fn(latest);
  }
  function start() {
    if (pending) return pending;
    const before = latest;
    pending = (async () => {
      try {
        const r = await fetch('/api/usage', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const summary = await r.json();
        if (!summary || typeof summary.agents !== 'object' || !summary.agents) throw new Error('用量格式错误');
        // 请求期间若收到更新的 SSE，不用旧快照盖掉它。
        if (latest === before) apply(summary);
      } catch (e) { if (latest === before) connected = false; }
      finally { pending = null; render(); }
    })();
    render();
    return pending;
  }
  M.Usage = {
    start, apply, format,
    get() { return latest; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    open() { if (!dlg.open) dlg.showModal(); start(); },
  };
  start();
})();
