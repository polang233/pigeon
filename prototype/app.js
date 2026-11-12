// Pigeon 原型：只有示例数据，不连任何服务。用来看页面结构和交互，不是成品。
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 图形 ---------- */
  const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const IC = {
    claude: 'M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4',
    codex: 'M6 8l4 4-4 4M13 16h5',
    cursor: 'M5 4l14 8-6 2-2 6z',
    dsh: 'M3 14c3-7 6 7 9 0s6-7 9 0',
    mac: 'M5 6h14v9H5zM3 18h18',
    win: 'M4 5h16v10H4zM9 19h6M12 15v4',
    stage: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 2v3M12 19v3M2 12h3M19 12h3',
    tasks: 'M5 6h14M5 12h14M5 18h9',
    route: 'M4 12h5c3 0 3-6 6-6h5M9 12c3 0 3 6 6 6h5',
    conn: 'M9 7V3M15 7V3M7 7h10v5a5 5 0 01-10 0zM12 17v4',
    notch: 'M3 5h18v14H3zM9 5v2a1 1 0 001 1h4a1 1 0 001-1V5',
    grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  };
  const AG = {
    claude: { name: 'Claude Code', c: 'var(--claude)' },
    codex: { name: 'Codex', c: 'var(--codex)' },
    cursor: { name: 'Cursor', c: 'var(--cursor)' },
    dsh: { name: 'DeepSeek Harness', c: 'var(--dsh)' },
  };
  const DEV = {
    mac: { name: '这台 Mac', sub: 'MacBook Air · 本机' },
    win: { name: 'CHEN-Y9000P2023', sub: 'Windows · 只连了 Codex，别的 agent 经它带起' },
  };
  const ST = { run: ['在干活', 'var(--run)'], wait: ['等你', 'var(--wait)'], idle: ['空闲', 'var(--idle)'], done: ['刚完成', 'var(--ok)'] };

  /* ---------- 示例数据 ---------- */
  const S = [
    { id: 's1', agent: 'claude', dev: 'mac', title: 'Pigeon 重构', state: 'run', lead: true, note: '正在把活分给 3 个 agent' },
    { id: 's2', agent: 'codex', dev: 'mac', title: '画应用图标', state: 'run', note: '生图中，已跑 2 分 10 秒' },
    { id: 's3', agent: 'codex', dev: 'mac', title: '审查确认框改动', state: 'done', note: '回信：两处建议' },
    { id: 's4', agent: 'cursor', dev: 'mac', title: '设置页表单', state: 'run', note: '正在改 settings.js' },
    { id: 's5', agent: 'dsh', dev: 'mac', title: '批量改文案', state: 'idle', note: '空闲 12 分钟' },
    { id: 's6', agent: 'codex', dev: 'win', title: 'Windows 构建', state: 'run', note: 'cargo build，已跑 4 分钟' },
    { id: 's7', agent: 'codex', dev: 'win', title: '问候', state: 'idle', note: '空闲' },
    // via：那台电脑上只连了 Codex，别的 agent 要靠 Codex 在那边带起来
    { id: 's8', agent: 'claude', dev: 'win', via: 'codex', title: '跑测试集', state: 'wait', note: '这个任务在等你确认才发过去' },
    { id: 's9', agent: 'cursor', dev: 'win', via: 'codex', title: '改安装脚本', state: 'idle', note: '空闲' },
    // parent：某个对话自己往下拆出来的子对话
    { id: 's1a', agent: 'claude', dev: 'mac', parent: 's1', title: '子代理：查回调文档', state: 'run', note: '读文档中' },
    { id: 's6a', agent: 'codex', dev: 'win', parent: 's6', title: '跑单元测试', state: 'run', note: '子对话，已跑 1 分钟' },
    { id: 's6b', agent: 'codex', dev: 'win', parent: 's6', title: '查链接报错', state: 'done', note: '子对话，已回报' },
  ];
  const T = [
    { id: 't-8f2c', time: '10:41', from: 's1', to: 's2', kind: '生图', title: '画应用图标：信鸽侧影，深色底，不要文字', state: 'flying', dur: '2:10' },
    { id: 't-71ab', time: '10:39', from: 's1', to: 's6', kind: '构建', title: '在 Windows 上跑一遍构建，把报错贴回来', state: 'flying', dur: '4:02' },
    { id: 't-66d0', time: '10:36', from: 's1', to: 's4', kind: '实现', title: '设置页加“跨设备发送前先问我”开关', state: 'flying', dur: '6:48' },
    { id: 't-3a07', time: '10:35', from: 's1', to: 's8', kind: '测试', title: '在 Windows 上跑测试集，失败的贴回来', state: 'confirm', dur: '' },
    { id: 't-5c11', time: '10:30', from: 's1', to: 's3', kind: '审查', title: '审一下确认框的改动，重点看超时处理', state: 'home', dur: '0:52', reply: '两处建议：\n1. 超时和用户点“拦下”现在是同一个退出码，建议分开。\n2. 正文超过 600 字被截断时，确认框里应当写明总字数。' },
    { id: 't-4b90', time: '10:22', from: 's2', to: 's1', kind: '回信', title: '图标初稿好了，放在 assets/generated', state: 'home', dur: '0:04', reply: '初稿两张，都在 assets/generated/ 下。第二张留白更多，更适合做小尺寸。' },
    { id: 't-29e4', time: '09:58', from: 's1', to: 's5', kind: '批量', title: '把 12 处“鸽舍”改成“设备”', state: 'refused', dur: '', reply: '你在确认框里拦下了，没有发出。' },
  ];
  const TS = { confirm: ['等你确认', 'var(--wait)'], flying: ['进行中', 'var(--run)'], home: ['已回信', 'var(--ok)'], refused: ['已拦下', 'var(--idle)'], lost: ['没回音', 'var(--wait)'] };
  const by = id => S.find(s => s.id === id);
  const lead = () => S.find(s => s.lead);
  const cross = t => by(t.from).dev !== by(t.to).dev;
  const flyingTo = s => T.some(t => t.state === 'flying' && t.to === s.id);

  const g = (a, cls = '', state) => `<span class="g ${cls} ${state ? 'ring ' + state : ''}" style="--c:${AG[a].c}${state ? `;--s:${ST[state][1]}` : ''}">${svg(IC[a])}</span>`;
  const st = state => `<span class="st"><i class="dot ${state}" style="--s:${ST[state][1]}"></i>${ST[state][0]}</span>`;
  const devBadge = (d, short) => `<span class="badge" title="${DEV[d].name}">${svg(IC[d])}${d === 'mac' ? '本机' : short ? DEV[d].name.split('-')[0] : DEV[d].name}</span>`;
  const worst = ss => ['wait', 'run', 'done', 'idle'].find(x => ss.some(s => s.state === x)) || 'idle';
  const toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); };

  /* ---------- 导航 ---------- */
  const NAV = [['stage', '指挥台'], ['tasks', '任务'], ['route', '分派规则'], ['conn', '接入'], null, ['notch', '刘海与侧边条']];
  let view = 'stage';
  function drawNav() {
    const need = T.filter(t => t.state === 'confirm').length;
    $('#nav').innerHTML = NAV.map(n => n
      ? `<button type="button" data-v="${n[0]}" ${view === n[0] ? 'aria-current="page"' : ''}>${svg(IC[n[0]])}<span>${n[1]}</span>${n[0] === 'tasks' && need ? `<i class="count num">${need}</i>` : ''}</button>`
      : '<div class="sep"></div>').join('');
  }
  $('#nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.v); });
  function go(v) { view = v; drawNav(); ({ stage: drawStage, tasks: drawTasks, route: drawRoute, conn: drawConn, notch: drawNotch })[v](); $('#main').scrollTop = 0; }

  /* ---------- 指挥台 ---------- */
  let mode = 'device', skin = 'plain', pageIdx = 0, sel = { t: 'session', id: 's1' }, PAGES = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const kids = s => S.filter(x => x.parent === s.id);
  const tops = ss => ss.filter(s => !s.parent);
  const edgeOf = ss => ss.some(s => s.state === 'wait') ? 'wait' : ss.some(flyingTo) ? 'live' : '';
  // 对话一行一个，它拆出的子对话缩进排在下面
  const rows = (ss, max = 4) => tops(ss).flatMap(s => [[s, 0], ...kids(s).map(k => [k, 1])]).slice(0, max)
    .map(([s, lv]) => `<li class="${lv ? 'kid' : ''}"><i class="dot ${s.state}" style="--s:${ST[s.state][1]}"></i><span>${s.title}</span></li>`).join('');

  const leadNode = (s, remote) => ({ sel: { t: 'session', id: s.id }, av: [s.agent, s.state], cls: 'lead' + (remote ? ' remote' : ''), html: `
    <div class="role"><span>指挥</span>${remote ? devBadge(s.dev) : ''}</div>
    <div class="top">${g(s.agent, '', s.state)}<b>${AG[s.agent].name}</b></div>
    <div class="sub">${s.title} · ${s.note}</div>
    ${kids(s).length ? `<ul>${kids(s).map(k => `<li class="kid"><i class="dot ${k.state}" style="--s:${ST[k.state][1]}"></i><span>${k.title}</span></li>`).join('')}</ul>` : ''}` });
  const agentNode = (a, ss, d, tag, sub) => ({ sel: { t: 'agent', a, d }, av: [a, worst(ss)], html: `
    <div class="top">${g(a, '', worst(ss))}<b>${AG[a].name}</b><span class="sp"></span>${tag ? `<span class="badge">${tag}</span>` : `<span class="st num">${tops(ss).length}</span>`}</div>
    ${sub ? `<div class="sub">${sub}</div>` : ''}<ul>${rows(ss)}</ul>` });
  const sessionNode = s => ({ sel: { t: 'session', id: s.id }, av: [s.agent, s.state], html: `
    <div class="top">${g(s.agent, 'sm')}<b>${s.title}</b></div>
    <div class="sub">${s.via ? `经 ${AG[s.via].name} 带起 · ` : ''}${s.note}</div>
    <ul><li>${st(s.state)}<span class="sp" style="flex:1"></span>${devBadge(s.dev, true)}</li>${rows(kids(s).map(k => ({ ...k, parent: '' })), 2).replaceAll('<li class="">', '<li class="kid">')}</ul>` });

  function devicePage(d) {
    const L = lead(), here = S.filter(s => s.dev === d && !s.lead);
    const direct = here.filter(s => !s.via), viaS = here.filter(s => s.via);
    const by2 = list => Object.keys(AG).map(a => ({ a, ss: list.filter(s => s.agent === a) })).filter(x => x.ss.length);
    const gates = new Set(viaS.map(s => s.via));
    const around = by2(direct).map(({ a, ss }) => ({ ...agentNode(a, ss, d, gates.has(a) ? '入口' : ''), edge: edgeOf(ss), gate: gates.has(a) ? a : '' }));
    for (const od of Object.keys(DEV)) if (od !== d) {
      const there = S.filter(s => s.dev === od && !s.lead);
      around.push({ go: od, av: ['post', 'idle'], cls: 'portal', edge: there.some(flyingTo) ? 'live' : '', html: `
        <div class="top"><span class="g" style="--c:var(--mut)">${svg(IC[od])}</span><b>${DEV[od].name}</b></div>
        <div class="sub">${there.filter(s => s.state === 'run').length} 个在干活 · 点一下翻过去</div>` });
    }
    // 只能经某个 agent 才够得着的，挂在那个 agent 下面
    for (const ga of gates) {
      const from = around.findIndex(o => o.gate === ga);
      for (const { a, ss } of by2(viaS.filter(s => s.via === ga))) around.push({ ...agentNode(a, ss, d, '', `经 ${AG[ga].name} 带起`), edge: edgeOf(ss), from, cls: 'via' });
    }
    // 有“入口”的页面用固定的位置，让下一层有地方放
    if (gates.size) {
      const slot = { gate: [[73, 16]], via: [[86, 56], [64, 88], [38, 90]], portal: [[16, 24]], other: [[16, 78], [40, 10]] }, used = {};
      for (const o of around) { const k = o.gate ? 'gate' : o.from != null ? 'via' : o.go ? 'portal' : 'other'; used[k] = (used[k] || 0) + 1; o.pos = slot[k][(used[k] - 1) % slot[k].length]; }
    }
    const all = tops(S.filter(s => s.dev === d));
    return { key: d, icon: IC[d], title: DEV[d].name, sub: DEV[d].sub,
      stats: [[new Set(all.map(s => s.agent)).size, '个 agent'], [all.length, '个对话'], [all.filter(s => s.state === 'run').length, '个在干活'], [all.filter(s => s.state === 'wait').length, '个等你']],
      center: leadNode(L, L.dev !== d), around };
  }
  function agentPage(a) {
    const L = lead(), ss = tops(S.filter(s => s.agent === a));
    const around = ss.map(s => ({ ...sessionNode(s), edge: s.state === 'wait' ? 'wait' : flyingTo(s) ? 'live' : '' }));
    if (a !== L.agent) around.push({ sel: { t: 'session', id: L.id }, av: [L.agent, L.state], cls: 'portal', edge: '', html: `
      <div class="top">${g(L.agent, 'sm')}<b>由 ${AG[L.agent].name} 指挥</b></div><div class="sub">${L.title}</div>` });
    const devs = new Set(ss.map(s => s.dev));
    return { key: a, agent: a, title: AG[a].name, sub: `${ss.length} 个对话，在 ${devs.size} 台设备上`,
      stats: [[ss.length, '个对话'], [devs.size, '台设备'], [ss.filter(s => s.state === 'run').length, '个在干活'], [ss.filter(s => s.state === 'wait').length, '个等你']],
      center: { sel: { t: 'agent', a, d: null }, av: [a, worst(ss)], cls: 'lead', html: `
        <div class="role"><span>agent</span></div>
        <div class="top">${g(a, '', worst(ss))}<b>${AG[a].name}</b></div>
        <div class="sub">${[...devs].map(d => DEV[d].name).join('、')}</div>` }, around };
  }
  function place(n, i) {
    const off = n === 4 ? 45 : n === 2 ? 90 : 0, rx = n === 4 ? 38 : 33, ry = n === 4 ? 43 : 37;
    const ang = (-90 + off + 360 / n * i) * Math.PI / 180;
    return [50 + rx * Math.cos(ang), 50 + ry * Math.sin(ang)];
  }
  function pageHTML(p, i) {
    const n = p.around.length;
    const pts = p.around.map((o, k) => o.pos || place(n, k));
    const src = o => o.from != null ? pts[o.from] : [50, 50];
    const node = (o, x, y, k) => `<button type="button" class="node ${o.cls || ''}" ${k == null ? 'data-center' : `data-k="${k}" data-from="${o.from ?? -1}"`} style="left:${x}%;top:${y}%" ${o.go ? `data-go="${o.go}"` : `data-sel='${JSON.stringify(o.sel)}'`}>${skin !== 'plain' && o.av ? `<canvas class="av" data-a="${o.av[0]}" data-s="${o.av[1]}"></canvas>` : ''}${o.html}</button>`;
    return `<section class="page ${i === pageIdx ? 'on' : ''}" aria-label="${p.title}">
      <canvas class="scene" aria-hidden="true"></canvas>
      <div class="page-title"><h2>${p.title}</h2><p>${p.sub}</p></div>
      <div class="stats num">${p.stats.map(([v, l]) => `<span><b>${v}</b>${l}</span>`).join('')}</div>
      <div class="orbit">
        <div class="orbit-ring"></div>
        <svg class="wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${pts.map(([x, y], k) => { const [sx, sy] = src(p.around[k]); return `<line data-k="${k}" x1="${sx}" y1="${sy}" x2="${x}" y2="${y}" class="${p.around[k].edge || ''} ${p.around[k].from != null ? 'via' : ''}"/>`; }).join('')}</svg>
        ${pts.map(([x, y], k) => { const [sx, sy] = src(p.around[k]); return p.around[k].edge === 'live' ? `<i class="pkt" data-k="${k}" style="--x1:${sx}%;--y1:${sy}%;--x2:${x}%;--y2:${y}%;animation-delay:${k * .5}s"></i>` : ''; }).join('')}
        ${node(p.center, 50, 50)}
        ${p.around.map((o, k) => node(o, pts[k][0], pts[k][1], k)).join('')}
      </div></section>`;
  }
  // 地方不够时换紧凑卡片、把舞台加高，然后再避让
  function fit() {
    const v = $('.pager-view'); if (!v) return;
    const most = Math.max(...PAGES.map(p => p.around.length));
    v.toggleAttribute('data-dense', v.clientWidth < 760 || most >= 5);
    v.style.minHeight = 540 + Math.max(0, most - 4) * 50 + (v.clientWidth < 620 ? 120 : 0) + 'px';
    relax();
  }
  // 卡片互相避让：按实际大小量一遍，重叠的往两边推开，再把连线和飞行路线接回去。指挥留在正中不动。
  function relax() {
    $$('.orbit').forEach(orbit => {
      const W = orbit.clientWidth, H = orbit.clientHeight, gap = 12, gapY = skin === 'plain' ? 12 : 36;
      if (!W || !H) return;
      const els = [$('.node[data-center]', orbit), ...$$('.node[data-k]', orbit)];
      const b = els.map(el => ({ el, fixed: el.hasAttribute('data-center'), w: el.offsetWidth, h: el.offsetHeight, x: parseFloat(el.dataset.ox ??= el.style.left) / 100 * W, y: parseFloat(el.dataset.oy ??= el.style.top) / 100 * H }));
      for (let it = 0; it < 80; it++) {
        let moved = false;
        for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
          const p = b[i], q = b[j];
          const ox = (p.w + q.w) / 2 + gap - Math.abs(p.x - q.x), oy = (p.h + q.h) / 2 + gapY - Math.abs(p.y - q.y);
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          const horiz = ox < oy, d = (horiz ? ox : oy), sp = p.fixed ? 0 : q.fixed ? 1 : .5, sq = 1 - sp;
          const dir = horiz ? Math.sign(q.x - p.x) || 1 : Math.sign(q.y - p.y) || 1;
          if (horiz) { p.x -= dir * d * sp; q.x += dir * d * sq; } else { p.y -= dir * d * sp; q.y += dir * d * sq; }
        }
        for (const p of b) if (!p.fixed) { p.x = Math.min(W - p.w / 2, Math.max(p.w / 2, p.x)); p.y = Math.min(H - p.h / 2, Math.max(p.h / 2 + gapY - 8, p.y)); }
        if (!moved) break;
      }
      const pc = p => [(p.x / W * 100).toFixed(2), (p.y / H * 100).toFixed(2)];
      b.forEach(p => { if (!p.fixed) { const [x, y] = pc(p); p.el.style.left = x + '%'; p.el.style.top = y + '%'; } });
      b.slice(1).forEach(p => {
        const k = p.el.dataset.k, from = +p.el.dataset.from, [x, y] = pc(p), [sx, sy] = from >= 0 ? pc(b[from + 1]) : [50, 50];
        const ln = $(`line[data-k="${k}"]`, orbit); if (ln) { ln.setAttribute('x1', sx); ln.setAttribute('y1', sy); ln.setAttribute('x2', x); ln.setAttribute('y2', y); }
        const pk = $(`.pkt[data-k="${k}"]`, orbit); if (pk) { pk.style.setProperty('--x1', sx + '%'); pk.style.setProperty('--y1', sy + '%'); pk.style.setProperty('--x2', x + '%'); pk.style.setProperty('--y2', y + '%'); }
      });
    });
  }
  function drawStage() {
    PAGES = mode === 'device' ? Object.keys(DEV).map(devicePage) : Object.keys(AG).map(agentPage);
    pageIdx = Math.min(pageIdx, PAGES.length - 1);
    const seg = (label, key, cur, opts) => `<div class="seg" role="group" aria-label="${label}">${opts.map(([k, l]) => `<button type="button" data-${key}="${k}" aria-pressed="${cur === k}">${l}</button>`).join('')}</div>`;
    $('#main').innerHTML = `
      <div class="head"><h1>指挥台</h1><p>${AG[lead().agent].name} 在指挥，围着它的是接活的 agent</p><span class="sp"></span>
        ${seg('样式', 'skin', skin, [['plain', '简洁'], ['office', '办公室'], ['loft', '鸽舍']])}
        ${seg('按什么分页', 'mode', mode, [['device', '按设备'], ['agent', '按 agent']])}
        <button class="btn" type="button" data-act="compose">派活</button></div>
      <div class="stage-wrap"><div class="stage-col">
        <div class="pager-view" data-skin="${skin}"><div class="track" id="track">${PAGES.map(pageHTML).join('')}</div></div>
        <div class="pagerbar"><button class="arrow" type="button" data-step="-1" aria-label="上一页">‹</button>
          ${PAGES.map((p, i) => `<button class="ptab" type="button" data-page="${i}" aria-pressed="${i === pageIdx}">${p.agent ? g(p.agent) : `<span class="dev">${svg(p.icon)}</span>`}<span>${p.title}<small>${p.stats[2][0]} 个在干活${p.stats[3][0] ? ` · ${p.stats[3][0]} 个等你` : ''}</small></span></button>`).join('')}
          <button class="arrow" type="button" data-step="1" aria-label="下一页">›</button><span class="hint">← → 翻页</span></div>
      </div><aside class="insp" id="insp" aria-label="选中的对象"></aside></div>`;
    slide(); mark(); drawInsp(); fit(); paintScene();
  }

  /* ---------- 样式：办公室和鸽舍，美术沿用 web/js 里原来的像素画 ---------- */
  let anim = [];
  const PXS = 3; // 背景一格几个屏幕像素
  function loftBg(x, W, H, i) {
    const A = window.Pigeon.LoftArt, hy = Math.round(H * .46);
    A.sky(x, W, hy + 14);
    A.sun(x, Math.round(W * (i % 2 ? .28 : .72)), hy - 3, Math.max(10, Math.round(H * .07)));
    A.farCity(x, W, hy, []);
    A.midCity(x, W, hy + 8, H);
    A.nearRoof(x, W, Math.round(H * .72), H);
  }
  function officeBg(x, W, H, i) {
    const r = (px, py, w, h, c) => { x.fillStyle = c; x.fillRect(Math.round(px), Math.round(py), Math.round(w), Math.round(h)); };
    const wy = Math.round(H * .42);
    r(0, 0, W, wy, '#1d2b38');
    for (let y = 6; y < wy - 4; y += 12) for (let px = (y / 12) % 2 ? 4 : 10; px < W; px += 12) r(px, y, 1, 1, '#24364a');
    r(0, wy - 4, W, 4, '#16202b');
    r(0, wy, W, H - wy, '#3a2a22');
    for (let y = wy + 6; y < H; y += 8) r(0, y, W, 1, '#2f221b');
    for (let y = wy, k = 0; y < H; y += 8, k++) for (let px = (k % 2) * 24; px < W; px += 48) r(px, y, 1, 8, '#2f221b');
    const wx = i % 2 ? W - 62 : 14; // 窗户
    r(wx, 30, 44, 34, '#0e151d'); r(wx + 2, 32, 40, 30, '#24405a'); r(wx + 21, 32, 2, 30, '#0e151d'); r(wx + 2, 46, 40, 2, '#0e151d'); r(wx + 30, 36, 5, 5, '#ffe9a8');
    const lx = Math.round(W * (i % 2 ? .2 : .78)); // 落地灯
    r(lx - 7, wy - 62, 14, 8, '#ffcf6b'); r(lx - 1, wy - 54, 2, 54, '#3a4a5a'); r(lx - 5, wy, 10, 2, '#3a4a5a');
    const gr = x.createRadialGradient(lx, wy - 52, 2, lx, wy - 52, 70); gr.addColorStop(0, 'rgba(255,207,107,.2)'); gr.addColorStop(1, 'rgba(255,207,107,0)');
    x.fillStyle = gr; x.fillRect(lx - 70, wy - 122, 140, 140);
  }
  function put(c, w, h, scale) { c.width = w; c.height = h; c.style.width = w * scale + 'px'; const x = c.getContext('2d'); x.clearRect(0, 0, w, h); return x; }
  function paintScene() {
    anim = [];
    const view = $('.pager-view'), P = window.Pigeon || {};
    if (!view || skin === 'plain') return;
    const W = Math.ceil(view.clientWidth / PXS), H = Math.ceil(view.clientHeight / PXS);
    $$('canvas.scene', view).forEach((c, i) => { c.width = W; c.height = H; try { (skin === 'loft' ? loftBg : officeBg)(c.getContext('2d'), W, H, i); } catch (e) { console.warn('背景没画出来', e); } });
    $$('canvas.av', view).forEach(c => {
      const a = c.dataset.a, s = c.dataset.s;
      if (skin === 'loft' && P.LoftArt) {
        const b = P.LoftArt.breed(a === 'dsh' ? 'deepseek' : a);
        const fr = s === 'run' ? [b.stand, b.peck] : s === 'wait' ? [b.flare, b.stand] : s === 'idle' ? [b.sleep] : [b.stand, b.blink];
        anim.push({ every: s === 'done' ? 6 : 1, draw: n => { const sp = fr[n % fr.length]; put(c, sp.w, sp.h, 2).drawImage(sp.c, 0, 0); } });
      } else if (skin === 'office' && P.SPRITES) {
        const grid = P.SPRITES[{ dsh: 'mini', post: 'meerkat' }[a] || a] || P.SPRITES.mini, w = Math.max(...grid.map(r => r.length));
        anim.push({ every: 1, draw: n => { const up = s === 'run' && n % 2 ? 1 : 0; const x = put(c, w, grid.length + 1, 3); P.drawGrid(x, grid, 0, 1 - up, { grey: s === 'idle' }); } });
      }
    });
    if (skin === 'loft' && P.LoftArt) $$('.pkt', view).forEach(p => {
      const fr = P.LoftArt.breed('post').tiny, c = document.createElement('canvas'); p.textContent = ''; p.append(c);
      anim.push({ every: 1, fast: true, draw: n => { const sp = fr[n % fr.length]; put(c, sp.w, sp.h, 3).drawImage(sp.c, 0, 0); } });
    });
    anim.forEach(a => a.draw(0));
  }
  let tickN = 0;
  if (!reduce) setInterval(() => { tickN++; anim.forEach(a => { if (a.fast || tickN % (3 * a.every) === 0) a.draw(a.fast ? tickN : tickN / 3); }); }, 160);
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (view === 'stage') { fit(); paintScene(); } }, 150); });
  function slide() {
    $('#track').style.transform = `translateX(${-pageIdx * 100}%)`;
    $$('.page').forEach((p, i) => p.classList.toggle('on', i === pageIdx));
    $$('.ptab').forEach((b, i) => b.setAttribute('aria-pressed', i === pageIdx));
  }
  function mark() { $$('.node[data-sel]').forEach(n => n.setAttribute('aria-pressed', same(JSON.parse(n.dataset.sel), sel))); }
  function taskRow(t) {
    const a = by(t.from), b = by(t.to);
    return `<button type="button" class="item" data-task="${t.id}">${g(b.agent, 'sm')}<div><b>${t.title}</b><small>${AG[a.agent].name} → ${AG[b.agent].name}${cross(t) ? ' @ ' + DEV[b.dev].name : ''}</small></div><span class="st"><i class="dot ${t.state === 'flying' ? 'run' : ''}" style="--s:${TS[t.state][1]}"></i>${TS[t.state][0]}</span></button>`;
  }
  function drawInsp() {
    let h = '';
    if (sel.t === 'session') {
      const s = by(sel.id), ts = T.filter(t => t.from === s.id || t.to === s.id);
      h = `<div class="who">${g(s.agent, '', s.state)}<div><b>${s.title}</b><small>${AG[s.agent].name} · ${DEV[s.dev].name}</small></div></div>
        <div class="acts">${st(s.state)}${s.lead ? '<span class="badge">指挥</span>' : ''}</div>
        <p class="note">${s.note}${s.via ? `。这台设备只连了 ${AG[s.via].name}，它是由 ${AG[s.via].name} 在那边带起来的` : ''}${s.parent ? `。由「${by(s.parent).title}」拆出来` : ''}</p>
        ${kids(s).length ? `<h3>它拆出的子对话 · ${kids(s).length}</h3><div class="list">${kids(s).map(k => `<button type="button" class="item" data-sel='${JSON.stringify({ t: 'session', id: k.id })}'>${g(k.agent, 'sm')}<div><b>${k.title}</b><small>${k.note}</small></div>${st(k.state)}</button>`).join('')}</div>` : ''}
        <div class="acts"><button class="ghost" type="button" data-act="msg">给它发消息</button><button class="ghost" type="button" data-act="open">打开对话</button>${s.lead ? '' : '<button class="ghost" type="button" data-act="lead">设为指挥</button>'}</div>
        <h3>它的往来 · ${ts.length}</h3><div class="list">${ts.map(taskRow).join('') || '<p class="note">还没有往来</p>'}</div>`;
    } else {
      const ss = S.filter(s => s.agent === sel.a && (!sel.d || s.dev === sel.d));
      h = `<div class="who">${g(sel.a, '', worst(ss))}<div><b>${AG[sel.a].name}</b><small>${sel.d ? DEV[sel.d].name : '全部设备'} · ${ss.length} 个对话</small></div></div>
        <div class="acts"><button class="ghost" type="button" data-act="new">新开对话派活</button><button class="ghost" type="button" data-v="conn">接入情况</button></div>
        <h3>它的对话</h3><div class="list">${ss.map(s => `<button type="button" class="item" data-sel='${JSON.stringify({ t: 'session', id: s.id })}'>${g(s.agent, 'sm')}<div><b>${s.title}</b><small>${s.note}</small></div>${sel.d ? st(s.state) : devBadge(s.dev)}</button>`).join('')}</div>`;
    }
    const live = T.filter(t => t.state === 'flying' || t.state === 'confirm');
    $('#insp').innerHTML = h + `<h3>正在进行 · ${live.length}</h3><div class="list">${live.map(taskRow).join('')}</div>`;
  }

  /* ---------- 任务 ---------- */
  let openTask = 't-3a07';
  function drawTasks() {
    const row = t => { const a = by(t.from), b = by(t.to);
      return `<button type="button" class="trow ${t.id === openTask ? 'hl' : ''}" data-task="${t.id}"><span class="num" style="color:var(--mut)">${t.time}</span>
        <span class="who2">${g(a.agent, 'sm')}<span class="arrowto">→</span>${g(b.agent, 'sm')}<span class="ell"><b>${AG[b.agent].name}</b>${cross(t) ? ` <small style="display:inline">@ ${DEV[b.dev].name}</small>` : ''}</span></span>
        <span class="ell">${t.title}</span><span class="st"><i class="dot ${t.state === 'flying' ? 'run' : ''}" style="--s:${TS[t.state][1]}"></i>${TS[t.state][0]}</span><span class="num" style="color:var(--mut)">${t.dur}</span></button>`; };
    const t = T.find(x => x.id === openTask), a = by(t.from), b = by(t.to), x = cross(t);
    const order = ['queued', ...(x ? ['confirm'] : []), 'sent', 'flying', 'home'];
    const names = { queued: ['排队', '等对方空闲，不打断'], confirm: ['你确认', '跨设备才需要'], sent: ['送达', ''], flying: ['对方在做', ''], home: ['回信', ''] };
    const at = t.state === 'refused' ? (x ? 1 : 0) : order.indexOf(t.state);
    $('#main').innerHTML = `
      <div class="head"><h1>任务</h1><p>agent 之间发出的每一件事，正文不落盘，只记谁给谁、什么状态</p><span class="sp"></span>
        <div class="seg"><button type="button" aria-pressed="true">全部</button><button type="button" aria-pressed="false">等我</button><button type="button" aria-pressed="false">跨设备</button></div></div>
      <div class="body"><div class="panel t-tasks"><div class="trow head-row"><span>时间</span><span>谁给谁</span><span>内容</span><span>状态</span><span>用时</span></div>${T.map(row).join('')}</div>
      <div class="panel drawer"><h3>${t.title}</h3><p class="meta"><span class="mono">${t.id}</span> · ${AG[a.agent].name}（${a.title}）→ ${AG[b.agent].name}（${b.title}）${x ? ' · 跨设备到 ' + DEV[b.dev].name : ''}</p>
        <div class="steps">${order.map((k, i) => `<div class="${t.state === 'refused' && i === at ? 'bad' : i < at || t.state === 'home' ? 'done' : i === at ? 'now' : ''}"><b>${names[k][0]}</b>${t.state === 'refused' && i === at ? '被你拦下' : names[k][1]}</div>`).join('')}</div>
        ${t.reply ? `<div class="reply">${t.reply}</div>` : ''}
        <div class="insp" style="border:0;padding:0"><div class="acts">${t.state === 'confirm' ? '<button class="btn" type="button" data-act="release">放飞</button><button class="ghost" type="button" data-act="block">拦下</button>' : ''}<button class="ghost" type="button" data-act="open">打开对方的对话</button>${t.state === 'home' ? '<button class="ghost" type="button" data-act="fwd">把回信转给指挥</button>' : ''}</div></div>
      </div></div>`;
  }

  /* ---------- 分派规则 ---------- */
  const RULES = [
    { when: '生图、改图', kw: /图|画|icon|logo/i, a: 'codex', d: 'mac', ask: false, n: 14 },
    { when: '代码审查、要第二意见', kw: /审|review|看看对不对/i, a: 'codex', d: 'mac', ask: false, n: 9 },
    { when: '要在 Windows 上跑的构建和测试', kw: /windows|win|exe|构建|msvc/i, a: 'codex', d: 'win', ask: true, n: 5 },
    { when: '边界清楚的界面改动', kw: /界面|页面|css|表单|样式/i, a: 'cursor', d: 'mac', ask: false, n: 3 },
    { when: '大批量、重复的便宜活', kw: /批量|全部替换|翻译|重命名/i, a: 'dsh', d: 'mac', ask: false, n: 2 },
  ];
  let hitRule = -1;
  function drawRoute() {
    const ys = RULES.map((_, i) => (i + .5) * 100 / RULES.length);
    $('#main').innerHTML = `
      <div class="head"><h1>分派规则</h1><p>哪类活交给谁。规则是给指挥看的建议，最后由它判断，你随时能改</p><span class="sp"></span><button class="btn" type="button" data-act="addrule">加一条</button></div>
      <div class="body"><div class="panel">
        <div class="flow"><div class="src"><div class="box hit">${g(lead().agent)}<div><b>${AG[lead().agent].name}</b><br><small style="color:var(--mut)">指挥 · ${lead().title}</small></div></div></div>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${ys.map((y, i) => `<path data-r="${i}" d="M0,50 C55,50 45,${y} 100,${y}" vector-effect="non-scaling-stroke"/>`).join('')}</svg>
          <div class="dst">${RULES.map((r, i) => `<div class="box" data-r="${i}">${g(r.a, 'sm')}<span class="ell" style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis"><b>${AG[r.a].name}</b> ${devBadge(r.d)}</span></div>`).join('')}</div></div>
        <div class="try"><label for="try">试一句</label><input id="try" placeholder="比如：帮我画一张深色底的图标" autocomplete="off"><output id="try-out">输入一句任务，看它会被建议交给谁</output></div>
      </div>
      <h2>规则 · 从上到下匹配</h2>
      <div class="panel t-rules"><div class="trow head-row"><span></span><span>当任务是</span><span></span><span>交给</span><span>发之前</span><span>本周</span></div>
        ${RULES.map((r, i) => `<div class="trow" data-r="${i}"><span style="color:var(--faint)">${svg(IC.grip)}</span><b class="ell" style="font-weight:550">${r.when}</b><span class="arrowto">→</span>
          <span class="who2">${g(r.a, 'sm')}<span class="ell"><b>${AG[r.a].name}</b></span>${devBadge(r.d)}</span>
          <select class="pick" aria-label="发之前要不要问我"><option ${r.ask ? '' : 'selected'}>直接发</option><option ${r.ask ? 'selected' : ''}>每次问我</option></select><span class="num" style="color:var(--mut)">${r.n} 次</span></div>`).join('')}
        <div class="trow"><span></span><span style="color:var(--mut)">其他的</span><span class="arrowto">→</span><span style="color:var(--mut)">留给指挥自己做</span><span></span><span></span></div></div>
      <p class="note">跨设备的任务不管规则怎么写，默认都要你点一次确认；这条可以在“接入”里关掉。</p></div>`;
    paintRoute();
  }
  function paintRoute() {
    $$('.flow > svg path, .flow .dst .box, .t-rules .trow[data-r]').forEach(el => {
      const on = +el.dataset.r === hitRule;
      el.classList.toggle('hit', on); el.classList.toggle('hl', on && el.classList.contains('trow')); el.classList.toggle('dim', hitRule >= 0 && !on && !el.classList.contains('trow'));
    });
  }

  /* ---------- 接入 ---------- */
  const CONN = {
    mac: [
      { a: 'claude', ver: '插件 0.2.0', out: ['yes', '能派活、能发消息'], inn: ['part', '等它空闲时送进去'], how: 'Claude Code 插件', on: true },
      { a: 'codex', ver: '桌面版', out: ['yes', '能派活、能发消息'], inn: ['yes', '排队，不打断当前一轮'], how: '加一个 MCP 和两条回调', on: true },
      { a: 'cursor', ver: '已检测到', out: ['part', '能派活、能发消息'], inn: ['part', '只在它一轮结束时收'], how: '加一个 MCP 和一条回调', on: false },
      { a: 'dsh', ver: '已检测到', out: ['part', '能派活、能发消息'], inn: ['part', '排进它自己的队列'], how: 'Harness 插件', on: false },
    ],
    win: [
      { a: 'codex', ver: '经这台 Mac 中转', out: ['nope', '暂时只能回信'], inn: ['yes', '发消息、新开对话'], how: '那台电脑上什么都不用装', on: true },
      { a: 'claude', ver: '经 Codex 带起', out: ['nope', '暂时只能回信'], inn: ['part', '由 Codex 在那边启动并转交'], how: '不用另外装，走 Codex 这条连接', on: true },
      { a: 'cursor', ver: '经 Codex 带起', out: ['nope', '暂时只能回信'], inn: ['part', '由 Codex 在那边启动并转交'], how: '不用另外装，走 Codex 这条连接', on: false },
    ],
  };
  let showPlan = false;
  function drawConn() {
    const mk = { yes: '●', part: '◐', nope: '○' };
    const cell = ([k, text]) => `<span class="ell"><span class="${k}">${mk[k]}</span> ${text}</span>`;
    const row = r => `<div class="trow"><span class="who2">${g(r.a)}<span class="ell"><b>${AG[r.a].name}</b><small>${r.ver}</small></span></span>${cell(r.out)}${cell(r.inn)}<span class="ell" style="color:var(--mut)">${r.how}</span>
      <span style="display:flex;justify-content:flex-end">${r.off ? '<span class="st">未接入</span>' : `<button class="sw" type="button" role="switch" aria-checked="${r.on}" aria-label="接入 ${AG[r.a].name}"></button>`}</span></div>`;
    $('#main').innerHTML = `
      <div class="head"><h1>接入</h1><p>让每个 agent 能派活、能接活。只改它们各自配置里的那几行</p><span class="sp"></span><button class="btn" type="button" data-act="plan">一键接入本机全部</button></div>
      <div class="body">
        ${showPlan ? `<div class="panel drawer"><h3>会改这 5 处，其他内容原样保留</h3><p class="meta">每一处都可以单独撤回。改之前会先备份。</p>
          <div class="files mono"><span><code>~/.claude/settings.json</code>　启用 pigeon 插件（已有）</span><span><code>~/.codex/config.toml</code>　加 [mcp_servers.pigeon]</span><span><code>~/.codex/hooks.json</code>　加 2 条回调</span><span><code>~/.cursor/mcp.json</code>　加 pigeon</span><span><code>~/.cursor/hooks.json</code>　加 1 条 stop 回调</span></div>
          <div class="insp" style="border:0;padding:0"><div class="acts"><button class="btn" type="button" data-act="apply">确认修改</button><button class="ghost" type="button" data-act="plan">先不改</button></div></div></div>` : ''}
        ${Object.keys(CONN).map(d => `<h2>${svg(IC[d]).replace('<svg', '<svg width="14" height="14"')}${DEV[d].name} <span style="color:var(--faint)">${DEV[d].sub}</span></h2>
          <div class="panel t-conn"><div class="trow head-row"><span>agent</span><span>它能发出</span><span>它能接收</span><span>怎么接的</span><span></span></div>${CONN[d].map(row).join('')}</div>`).join('')}
        <p class="note"><span class="yes">●</span> 已经实测能用　<span class="part">◐</span> 有成熟做法可参考，还没在 Pigeon 里验证　<span class="nope">○</span> 现在做不到</p>
        <h2>协作的规矩</h2>
        <div class="panel"><div class="trow" style="grid-template-columns:1fr auto"><span><b style="font-weight:550">允许 agent 之间互相派活和发消息</b><br><small style="color:var(--mut)">关掉后它们只能看，不能发</small></span><button class="sw" type="button" role="switch" aria-checked="true" aria-label="允许互相派活"></button></div>
          <div class="trow" style="grid-template-columns:1fr auto"><span><b style="font-weight:550">跨设备发送前先问我</b><br><small style="color:var(--mut)">在刘海上弹出确认，点“放飞”才发。90 秒不点就当拦下</small></span><button class="sw" type="button" role="switch" aria-checked="true" aria-label="跨设备发送前先问我"></button></div>
          <div class="trow" style="grid-template-columns:1fr auto"><span><b style="font-weight:550">连续来回上限</b><br><small style="color:var(--mut)">没有你插话时，agent 之间最多连着传几次，到了就停下等你</small></span><select class="pick" aria-label="连续来回上限"><option>3</option><option>5</option><option selected>10</option><option>20</option></select></div>
          <div class="trow" style="grid-template-columns:1fr auto"><span><b style="font-weight:550">每条消息都标明是谁发的</b><br><small style="color:var(--mut)">对方看得到来自哪个 agent、哪个对话。不能关</small></span><span class="st">一直开着</span></div></div>
      </div>`;
  }

  /* ---------- 刘海与侧边条 ---------- */
  function drawNotch() {
    const can = [
      ['yes', '一眼看状态', '刘海两侧：左边是在干活的 agent，右边是等你处理的数量；下沿一条光带，每个 agent 一段'],
      ['yes', '悬停展开总览', '不抢焦点，鼠标移开就收起。这一步现在的栖木已经有'],
      ['yes', '就地确认跨设备发送', '代替现在的系统对话框：看得到谁发给谁、发什么，点“放飞”或“拦下”'],
      ['yes', '回信到了，直接看摘要', '可以回到对话，也可以一键把回信转给指挥'],
      ['yes', '快速派活', '点一下才拿键盘焦点，选对象、写一句、发出；也可以用全局快捷键呼出'],
      ['part', '批准 Claude Code 的工具权限', 'Claude Code 的回调支持返回允许或拒绝，agent-hud-open 已经这样做，我们还没验证'],
      ['part', '把文件或一段文字拖到刘海上派活', '系统支持往面板上拖放，交互需要新做'],
    ];
    const cant = [
      ['nope', '画进物理刘海里面', '那块没有像素，只能画在它两侧和下方'],
      ['part', '批准 Codex 自己的审批', '只有明确交给用户审阅的那一轮才能代答，其余只能提醒并带你过去'],
      ['nope', '批准 Cursor 的操作', '它的回调只在一轮结束时触发，中途的审批接不到'],
      ['part', '全屏时常驻', '看视频、打游戏时默认隐藏，可以设成只在有事等你时才冒出来'],
      ['part', '菜单栏图标很多时', '刘海两侧的位置会被挤占，这时自动改用侧边条'],
    ];
    const mk = { yes: '●', part: '◐', nope: '○' };
    const list = a => a.map(([k, t, d]) => `<div class="trow"><span class="${k}">${mk[k]}</span><span><b style="font-weight:550">${t}</b><small>${d}</small></span></div>`).join('');
    const surf = $('.desk').dataset.surface || 'notch';
    $('#main').innerHTML = `
      <div class="head"><h1>刘海与侧边条</h1><p>不开窗口也能处理的事。点下面的按钮，看屏幕顶上的变化</p><span class="sp"></span>
        <div class="seg" role="group" aria-label="贴在哪"><button type="button" data-surf="notch" aria-pressed="${surf === 'notch'}">刘海</button><button type="button" data-surf="dock" aria-pressed="${surf === 'dock'}">侧边条</button></div></div>
      <div class="body"><div class="panel"><div class="demo-btns">
        ${[['idle', '收起'], ['overview', '悬停总览'], ['confirm', '等你确认'], ['reply', '回信到了'], ['compose', '快速派活']].map(([k, l]) => `<button class="ghost" type="button" data-hud="${k}">${l}</button>`).join('')}</div></div>
        <div class="cols" style="margin-top:14px"><div><h2>能做到</h2><div class="panel cap">${list(can)}</div></div><div><h2>做不到，或者有条件</h2><div class="panel cap">${list(cant)}</div></div></div>
        <p class="note"><span class="yes">●</span> 技术上确定可行　<span class="part">◐</span> 有条件，或者还没验证　<span class="nope">○</span> 做不到。没有刘海的屏幕（外接显示器）用侧边条：图标外一圈是状态，消息从一个图标飞到另一个。</p></div>`;
  }

  /* ---------- 刘海面板 ---------- */
  const hud = $('#hud');
  let pinned = false, target = 'codex@win';
  function drawEars() {
    const running = [...new Set(S.filter(s => s.state === 'run').map(s => s.agent))];
    const need = T.filter(t => t.state === 'confirm').length;
    $('#ear-l').innerHTML = running.map(a => `<i class="pip run" style="--c:${AG[a].c}" title="${AG[a].name} 在干活"></i>`).join('');
    $('#ear-r').innerHTML = need ? `<span class="need num">${need} 件等你</span>` : '<span>都在忙</span>';
    $('#hud-glow').innerHTML = Object.keys(AG).map(a => { const s = worst(S.filter(x => x.agent === a)); return `<i class="${s === 'run' ? 'run' : ''}" style="--c:${s === 'idle' ? '#3a3b42' : s === 'wait' ? 'var(--wait)' : AG[a].c}"></i>`; }).join('');
  }
  function setHud(state, pin = true) {
    pinned = pin && state !== 'idle';
    hud.dataset.state = state;
    const t = T.find(x => x.state === 'confirm'), r = T.find(x => x.id === 't-5c11');
    const route = (x, y, d) => `<div class="route">${g(x, 'sm')}<b>${AG[x].name}</b><span style="color:#8b8d96">→</span>${g(y, 'sm')}<b>${AG[y].name}</b>${d ? `<span class="badge" style="color:#c9cbd2;border-color:rgba(255,255,255,.2)">${svg(IC[d])}${DEV[d].name}</span>` : ''}</div>`;
    const body = {
      idle: '',
      overview: `<h3><span>正在进行</span><span>${S.filter(s => s.state !== 'idle' && !s.parent).length}</span></h3>${S.filter(s => s.state !== 'idle' && !s.parent).map(s => `<div class="row">${g(s.agent, 'sm', s.state)}<div style="min-width:0"><b>${s.title}</b><small>${AG[s.agent].name}${s.dev === 'mac' ? '' : ' @ ' + DEV[s.dev].name} · ${s.note}</small></div><span class="tag" style="color:${ST[s.state][1]}">${ST[s.state][0]}</span></div>`).join('')}
        <div class="acts" style="margin-top:10px"><span>移开鼠标就收起</span><span><button class="hbtn" type="button" data-hud="compose">派活</button> <button class="hbtn" type="button" data-v="stage">打开 Pigeon</button></span></div>`,
      confirm: t ? `<h3><span>等你确认</span><span class="mono">${t.id}</span></h3>${route(by(t.from).agent, by(t.to).agent, by(t.to).dev)}<div class="quote">${t.title}</div>
        <div class="acts"><span>跨设备 · 90 秒不点就当拦下</span><span><button class="hbtn no" type="button" data-act="block">拦下</button> <button class="hbtn go" type="button" data-act="release">放飞</button></span></div>` : '<h3>没有等你确认的事</h3>',
      reply: `<h3><span>回信到了</span><span>刚刚</span></h3>${route(by(r.to).agent, by(r.from).agent)}<div class="quote">${r.reply.replace(/\n/g, '<br>')}</div>
        <div class="acts"><span>审查 · 用时 ${r.dur}</span><span><button class="hbtn" type="button" data-act="dismiss">知道了</button> <button class="hbtn go" type="button" data-act="fwd">转给指挥</button></span></div>`,
      compose: `<h3><span>快速派活</span><span>⌥ 空格 呼出</span></h3><div class="chips">${[['codex@mac', 'codex', 'Codex'], ['codex@win', 'codex', 'Codex @ CHEN'], ['cursor@mac', 'cursor', 'Cursor'], ['dsh@mac', 'dsh', 'DSH']].map(([k, a, l]) => `<button class="chip" type="button" data-target="${k}" aria-pressed="${k === target}">${g(a, 'sm')}${l}</button>`).join('')}</div>
        <input class="field" id="hud-input" placeholder="让它做什么…" autocomplete="off"><div class="acts"><span>${target.endsWith('@win') ? '跨设备，发之前还会让你确认一次' : '本机，直接发'}</span><span><button class="hbtn" type="button" data-hud="idle">取消</button> <button class="hbtn go" type="button" data-act="send">发出</button></span></div>`,
    }[state];
    $('#hud-body').innerHTML = `<div>${body ? `<div class="hud-pad">${body}</div>` : ''}</div>`;
  }
  $('.hud-top').addEventListener('mouseenter', () => { if (hud.dataset.state === 'idle') setHud('overview', false); });
  hud.addEventListener('mouseleave', () => { if (!pinned) setHud('idle'); });

  /* ---------- 侧边条 ---------- */
  const dock = document.createElement('div');
  dock.className = 'dock'; dock.setAttribute('aria-label', '侧边条（演示）');
  dock.innerHTML = Object.keys(AG).map(a => g(a, '', worst(S.filter(s => s.agent === a)))).join('') + '<i class="fly" aria-hidden="true"></i>';
  $('.desk').append(dock);

  /* ---------- 事件 ---------- */
  function settle(id, state, msg) {
    const t = T.find(x => x.id === id); if (t) { t.state = state; if (state === 'flying') { t.dur = '0:01'; by(t.to).state = 'run'; by(t.to).note = '刚收到任务'; } else { by(t.to).state = 'idle'; by(t.to).note = '空闲'; t.reply = '你在确认框里拦下了，没有发出。'; } }
    setHud('idle'); drawEars(); drawNav(); go(view); toast(msg);
  }
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-skin],[data-mode],[data-page],[data-step],[data-go],[data-sel],[data-task],[data-act],[data-hud],[data-v],[data-surf],[data-target],.sw,.seg button');
    if (!el || el.closest('#nav')) return;
    const d = el.dataset;
    if (d.skin) { skin = d.skin; drawStage(); }
    else if (d.mode) { mode = d.mode; pageIdx = 0; sel = mode === 'device' ? { t: 'session', id: lead().id } : { t: 'agent', a: lead().agent, d: null }; drawStage(); }
    else if (d.page) { pageIdx = +d.page; slide(); }
    else if (d.step) { pageIdx = (pageIdx + +d.step + PAGES.length) % PAGES.length; slide(); }
    else if (d.go) { pageIdx = PAGES.findIndex(p => p.key === d.go); slide(); }
    else if (d.sel) { sel = JSON.parse(d.sel); mark(); drawInsp(); }
    else if (d.task) { openTask = d.task; if (view !== 'tasks') go('tasks'); else drawTasks(); }
    else if (d.hud) setHud(d.hud);
    else if (d.v) { setHud('idle'); go(d.v); }
    else if (d.surf) { $('.desk').dataset.surface = d.surf; drawNotch(); }
    else if (d.target) { target = d.target; setHud('compose'); }
    else if (el.classList.contains('sw')) el.setAttribute('aria-checked', el.getAttribute('aria-checked') !== 'true');
    else if (d.act) ({
      compose: () => setHud('compose'),
      release: () => settle('t-3a07', 'flying', '已放飞，任务正在送往 CHEN-Y9000P2023'),
      block: () => settle('t-3a07', 'refused', '已拦下，没有发出，也不会重发'),
      dismiss: () => setHud('idle'),
      fwd: () => { setHud('idle'); toast('回信已排进指挥的队列，等它空闲时送达'); },
      send: () => { const v = ($('#hud-input') || {}).value || ''; if (!v.trim()) return toast('先写一句要它做什么'); if (target.endsWith('@win')) { setHud('confirm'); toast('跨设备任务，先确认一次'); } else { setHud('idle'); toast('已发出：' + v.trim().slice(0, 24)); } },
      plan: () => { showPlan = !showPlan; drawConn(); },
      apply: () => { showPlan = false; CONN.mac.forEach(r => r.on = true); drawConn(); toast('示例：已接入本机 4 个 agent'); },
      lead: () => { const s = by(sel.id); S.forEach(x => x.lead = x === s); drawStage(); toast(`${AG[s.agent].name}「${s.title}」现在是指挥`); },
    }[d.act] || (() => toast('原型里这个按钮还没接功能')))();
    else if (el.closest('.seg')) { $$('button', el.closest('.seg')).forEach(b => b.setAttribute('aria-pressed', b === el)); }
  });
  document.addEventListener('input', e => {
    if (e.target.id !== 'try') return;
    const v = e.target.value.trim(); hitRule = v ? RULES.findIndex(r => r.kw.test(v)) : -1;
    $('#try-out').textContent = !v ? '输入一句任务，看它会被建议交给谁' : hitRule < 0 ? '没有规则匹配，留给指挥自己做' : `建议交给 ${AG[RULES[hitRule].a].name}（${DEV[RULES[hitRule].d].name}）${RULES[hitRule].ask ? '，发之前问你' : ''}`;
    paintRoute();
  });
  document.addEventListener('mouseover', e => { if (view !== 'route' || $('#try')?.value) return; const r = e.target.closest('.t-rules .trow[data-r], .flow .box[data-r]'); const n = r ? +r.dataset.r : -1; if (n !== hitRule) { hitRule = n; paintRoute(); } });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') return setHud('idle');
    if (view !== 'stage' || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { pageIdx = (pageIdx + (e.key === 'ArrowRight' ? 1 : -1) + PAGES.length) % PAGES.length; slide(); }
  });
  $('#theme').addEventListener('click', () => {
    const r = document.documentElement, cur = r.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    r.dataset.theme = cur === 'dark' ? 'light' : 'dark';
  });

  drawEars(); setHud('idle'); go('stage');
  if (reduce) $$('.pkt').forEach(p => p.style.animation = 'none');
})();
