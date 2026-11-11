// 主题：鸽舍。黄昏的屋顶，本机是近处的大鸽舍，每个 agent 是一只鸽子站在自己的栖木上；
// 远处的屋顶上是别的电脑的鸽舍。纸条是一只信鸽：从发件人飞向收件人，带着回信飞回来。
// 画面先画在一张低分辨率的画布上（每格 1 个逻辑像素），再按整数倍放大到屏幕，放大不糊。
(function () {
  const M = (window.Pigeon = window.Pigeon || {});
  const A = M.LoftArt, C = A.C;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ROSTER = {
    claude: { name: 'Claude Code', short: 'Claude', color: '#e38c5b' },
    codex: { name: 'Codex', short: 'Codex', color: '#7fe0c0' },
    cursor: { name: 'Cursor', short: 'Cursor', color: '#c3cad8' },
    deepseek: { name: 'DeepSeek', short: 'DeepSeek', color: '#9fb4ff' },
  };
  const ORDER = ['claude', 'codex', 'cursor', 'deepseek'];
  const FACE = { claude: 1, codex: -1, cursor: 1, deepseek: -1 };
  const PERCH_H = [31, 24, 35, 27];
  const ACT_LABEL = { code: '写代码', read: '读文件', search: '搜索', image: '生图', look: '看图', tool: '调用工具', run: '跑命令', think: '思考' };
  const WAIT_LABEL = { permission: '等你批准', question: '有问题问你', idle: '轮到你了', other: '等你回复' };
  const STATE_LABEL = { queued: '待飞', flying: '飞行中', delivered: '已送达', home: '已归巢', refused: '被拒收', lost: '迷路' };
  const WHO = { claude: 'Claude', you: '你', codex: 'Codex', cursor: 'Cursor', deepseek: 'DeepSeek' };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeIO = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const cubic = (p0, p1, p2, p3, t) => {
    const u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ];
  };

  class Loft {
    constructor(root, opts = {}) {
      this.root = root;
      root.classList.add('loft-stage');
      root.innerHTML = '<div class="loft-frame"><canvas role="img" aria-label="鸽舍：agent 之间送纸条和派活的动画"></canvas><div class="ov"></div></div>';
      this.frame = root.querySelector('.loft-frame');
      this.cv = root.querySelector('canvas');
      this.ctx = this.cv.getContext('2d');
      this.ov = root.querySelector('.ov');
      this.buf = document.createElement('canvas');
      this.b = this.buf.getContext('2d');
      this.now = performance.now();
      this.onPick = opts.onPick || (() => {});
      this.cardsOn = true;
      this.W = 0; this.H = 0; this.k = 1;

      this.agents = {};
      for (const id of ORDER) {
        this.agents[id] = {
          id, status: { installed: id === 'claude' || id === 'codex', running: id !== 'cursor' && id !== 'deepseek' },
          act: null, actUntil: 0, typingUntil: 0, pile: 0, realAct: false, badge: null, shakeUntil: 0,
          hopAt: -1e9, flapUntil: 0, peckUntil: 0, nextPeck: this.now + 1500 + Math.random() * 3000, blinkAt: this.now + 2000 + Math.random() * 2000,
        };
      }
      this.lofts = [{ id: 'local', name: '这台 Mac', online: true, sessions: [], projects: [] }];
      this.remotes = [];
      this.holes = Array.from({ length: 6 }, () => ({ task: null, arrivedAt: 0, act: null, badge: null, leaving: 0, shakeUntil: 0 }));
      this.notes = new Map();
      this.slots = { board: [], perch: {}, remote: {} };
      this.tasks = new Map();
      this.couriers = [];
      this.fx = [];
      this.rings = [];
      this.marks = [];
      this.waitingItems = [];
      this.usage = null;
      this.vane = { spinUntil: 0 };
      this.typeQueue = Promise.resolve();
      this.clouds = [];

      this.labels = {};
      for (const id of ORDER) this.labels[id] = this.label(ROSTER[id].name);
      this.loftLabel = this.label('这台 Mac', 'loft-name');
      this.remoteLabels = new Map();
      this.bubble = this.el('div', 'bubble');
      this.say$ = this.el('div', 'bubble mk');
      this.answer = this.el('div', 'bubble answer');
      this.card = this.el('div', 'agent-card');

      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(root);
      this.resize();
      this.bindPointer();
      this.loop = this.loop.bind(this);
      this.raf = requestAnimationFrame(this.loop);
    }
    destroy() {
      this.dead = true;
      cancelAnimationFrame(this.raf);
      this.ro.disconnect();
      this.root.classList.remove('loft-stage');
    }

    /* ---------- 尺寸：整数倍放大 ---------- */
    resize() {
      const r = this.root.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const devW = Math.round(r.width * dpr), devH = Math.round(r.height * dpr);
      if (devW < 40 || devH < 40) return;
      const k = Math.max(1, Math.round(devH / 200));
      const W = Math.ceil(devW / k), H = Math.ceil(devH / k);
      if (W === this.W && H === this.H && k === this.k) return;
      this.k = k; this.W = W; this.H = H; this.dpr = dpr;
      this.cv.width = W * k; this.cv.height = H * k;
      this.frame.style.width = (W * k) / dpr + 'px';
      this.frame.style.height = (H * k) / dpr + 'px';
      this.buf.width = W; this.buf.height = H;
      this.stars = A.stars(W, Math.round(H * 0.45));
      this.clouds = [0, 1, 2].map(i => ({ c: A.cloud(36 + i * 14, 5 + i), x: (W * (0.15 + i * 0.33)) | 0, y: Math.round(H * (0.1 + i * 0.09)), v: 0.6 + i * 0.35 }));
      this.relayout();
    }
    relayout() {
      if (!this.W) return;
      this.layout();
      this.paintStatic();
      this.placeLabels();
    }
    visible() { return ORDER.filter(id => id === 'claude' || id === 'codex' || this.agents[id].status.installed); }
    layout() {
      const { W, H } = this;
      const hy = Math.round(H * 0.55);
      const roofY = H - Math.max(18, Math.round(H * 0.13));
      const lw = clamp(Math.round(W * 0.26), 84, 124);
      const lx = Math.max(6, Math.round(W * 0.025));
      const legs = 7, bottom = roofY - legs;
      const bodyH = Math.max(44, Math.round(lw * 0.48));
      const top = bottom - bodyH;
      const roofH = Math.round(lw * 0.18);
      const hx0 = lx + Math.round(lw * 0.36), hx1 = lx + lw - 5;
      const step = (hx1 - hx0) / 3;
      const holes = [];
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) holes.push({ x: Math.round(hx0 + c * step + (step - 9) / 2), y: top + 5 + r * 15, w: 9, h: 10 });
      const door = { x: lx + 7, y: bottom - 20, w: 11, h: 18 };
      const board = { x0: lx + 3, x1: lx + lw + 16, y: bottom - 1 };
      const vis = this.visible();
      const px0 = lx + lw + 26;
      const px1 = Math.max(px0 + 42 * vis.length, Math.round(W * 0.56));
      const sp = Math.min(62, (px1 - px0) / vis.length);
      const perches = {};
      vis.forEach((id, i) => { perches[id] = { x: Math.round(px0 + sp * (i + 0.5)), top: roofY - PERCH_H[i % 4], half: 15 }; });
      const lastX = vis.length ? perches[vis[vis.length - 1]].x : px0;
      // 远处的鸽舍：均匀摆在右半边的楼顶上
      const rs = this.lofts.filter(l => l.id !== 'local').slice(0, 4);
      const rx0 = Math.round(W * 0.5), rx1 = W - 16;
      const dy = [11, 18, 8, 15];
      this.remotes = rs.map((l, i) => ({ ...l, x: Math.round(rx0 + ((rx1 - rx0) * (i + 0.5)) / rs.length), y: hy - dy[i] }));
      this.hiddenRemotes = Math.max(0, this.lofts.filter(l => l.id !== 'local').length - 4);
      this.L = { hy, roofY, lx, lw, legs, bottom, top, roofH, holes, door, board, perches, vent: lastX + 34 < W * 0.62 ? lastX + 30 : null };
    }
    paintStatic() {
      const { W, H, L } = this;
      const sky = document.createElement('canvas');
      sky.width = W; sky.height = H;
      const s = sky.getContext('2d');
      A.sky(s, W, L.hy + 14);
      s.fillStyle = C.sky[C.sky.length - 1]; s.fillRect(0, L.hy + 14, W, H);
      A.sun(s, Math.round(W * 0.7), L.hy - 3, Math.max(10, Math.round(H * 0.07)));
      this.skyLayer = sky;
      const front = document.createElement('canvas');
      front.width = W; front.height = H;
      const f = front.getContext('2d');
      A.farCity(f, W, L.hy, this.remotes.map(r => ({ x: r.x, y: r.y })));
      for (const r of this.remotes) A.remoteLoft(f, r.x, r.y, r.online !== false);
      A.midCity(f, W, L.hy + 8, H);
      A.nearRoof(f, W, L.roofY, H);
      if (L.vent) { f.fillStyle = C.roofHi; f.fillRect(L.vent, L.roofY - 9, 4, 9); f.fillStyle = C.roofRim; f.fillRect(L.vent - 1, L.roofY - 10, 6, 1); }
      A.loft(f, L);
      for (const [id, p] of Object.entries(L.perches)) A.perch(f, p.x, p.top, L.roofY + 1, p.half);
      this.frontLayer = front;
    }

    /* ---------- DOM 文字 ---------- */
    el(tag, cls) { const e = document.createElement(tag); e.className = cls; this.ov.appendChild(e); return e; }
    label(name, extra = '') {
      const e = this.el('div', 'lbl ' + extra);
      e.innerHTML = '<b></b><span></span>';
      e.querySelector('b').textContent = name;
      return e;
    }
    setLabel(e, name, status, tone = '') {
      if (name != null) e.querySelector('b').textContent = name;
      e.querySelector('span').textContent = status;
      e.dataset.tone = tone;
    }
    at(e, x, y) { e.style.left = (x / this.W) * 100 + '%'; e.style.top = (y / this.H) * 100 + '%'; }
    placeLabels() {
      const L = this.L;
      for (const id of ORDER) {
        const p = L.perches[id], l = this.labels[id];
        l.hidden = !p;
        if (p) this.at(l, p.x, L.roofY + 2);
      }
      this.at(this.loftLabel, L.lx + L.lw / 2, L.roofY + 2);
      const keep = new Set();
      for (const r of this.remotes) {
        keep.add(r.id);
        let l = this.remoteLabels.get(r.id);
        if (!l) { l = this.label(r.name, 'remote'); this.remoteLabels.set(r.id, l); }
        this.at(l, r.x, r.y + 2);
      }
      for (const [id, l] of this.remoteLabels) if (!keep.has(id)) { l.remove(); this.remoteLabels.delete(id); }
      this.refreshLabels();
    }
    waitingFor(id) { return this.waitingItems.filter(w => (w.agent || 'claude') === id); }
    busy(id) {
      const a = this.agents[id];
      return a.pile > 0 || (a.act && this.now < a.actUntil) || this.now < a.typingUntil;
    }
    statusOf(id) {
      const a = this.agents[id];
      const w = this.waitingFor(id);
      if (w.length) return [WAIT_LABEL[w[w.length - 1].kind] || '等你', 'busy'];
      if (!a.status.installed) return ['没装', 'off'];
      if (a.badge && a.badge.until > this.now) return a.badge.ok ? ['完成', 'ok'] : ['出错', 'bad'];
      if (this.now < a.typingUntil) return ['派活中', 'busy'];
      if (a.pile) return [(ACT_LABEL[a.act] || '干活中') + (a.pile > 1 ? ` · 排队 ${a.pile}` : ''), 'busy'];
      if (a.act && this.now < a.actUntil) return [ACT_LABEL[a.act] || '干活中', 'busy'];
      if (!a.status.running) return ['睡着了', 'off'];
      const n = this.visitorsOf(id);
      if (n) return [`收到 ${n} 张纸条`, 'busy'];
      return ['待命', ''];
    }
    visitorsOf(id) { let n = 0; for (const v of this.notes.values()) if (v.st === 'dst' && v.spot && v.spot.kind === 'perch' && v.spot.id === id) n++; return n; }
    refreshLabels() {
      if (!this.L) return;
      for (const id of ORDER) {
        if (!this.L.perches[id]) continue;
        const [s, tone] = this.statusOf(id);
        this.setLabel(this.labels[id], null, s, tone);
      }
      const local = this.lofts.find(l => l.id === 'local');
      const out = [...this.notes.values()].filter(v => v.st !== 'gone' && !M.NOTE_TERMINAL?.has(v.n.state)).length;
      this.setLabel(this.loftLabel, local ? local.name : '这台 Mac', out ? `${out} 张纸条在路上` : '本机', out ? 'busy' : '');
      for (const r of this.remotes) {
        const l = this.remoteLabels.get(r.id);
        if (!l) continue;
        const here = [...this.notes.values()].filter(v => v.st === 'dst' && v.spot?.kind === 'remote' && v.spot.id === r.id).length;
        const s = r.online === false ? '离线' : here ? `收下 ${here} 张` : `${(r.sessions || []).length} 个对话`;
        this.setLabel(l, r.name || r.id, s + (r.placeholder ? ' · 没在列表里' : ''), r.online === false ? 'off' : here ? 'busy' : '');
      }
      if (this.cardFor) this.fillCard(this.cardFor);
    }
    tagOf(v) {
      if (!v.tag) v.tag = this.el('div', 'ntag');
      return v.tag;
    }

    /* ---------- 来自 main.js 的数据 ---------- */
    setAgents(st) {
      const before = this.visible().join();
      for (const id of ORDER) if (st && st[id]) this.agents[id].status = st[id];
      if (this.visible().join() !== before) this.relayout();
      this.refreshLabels();
    }
    heard() { const c = this.agents.claude; c.status = { ...c.status, installed: true, running: true }; }
    setUsage(u) { this.usage = u; if (this.cardFor) this.fillCard(this.cardFor); }
    setScene(scene = {}) { this.cardsOn = scene.hoverCards !== false; if (!this.cardsOn) this.hideCard(); }
    setLofts(data) {
      const list = Array.isArray(data?.lofts) ? data.lofts.filter(l => l && l.id) : [];
      if (!list.some(l => l.id === 'local')) list.unshift({ id: 'local', name: '这台 Mac', online: true, sessions: [], projects: [] });
      // 纸条里出现过、列表里没有的远程鸽舍先留着，免得信鸽没处落脚
      for (const r of this.lofts) if (r.placeholder && !list.some(l => l.id === r.id)) list.push(r);
      this.lofts = list;
      this.relayout();
    }
    ensureLoft(ep) {
      if (!ep || !ep.loft || ep.loft === 'local' || this.lofts.some(l => l.id === ep.loft)) return;
      this.lofts.push({ id: ep.loft, name: ep.loft_name || ep.loft.replace(/^remote-control:/, ''), online: true, sessions: [], projects: [], placeholder: true });
      this.relayout();
    }
    setWaiting(items) {
      this.waitingItems = items || [];
      this.refreshLabels();
    }
    turnEnd() {
      const c = this.agents.claude;
      c.actUntil = 0; c.typingUntil = 0;
      c.badge = { ok: true, until: this.now + 1400 };
      this.refreshLabels();
    }

    /* ---------- 派活：本机鸽舍里的短途飞行 ---------- */
    perchPos(id) {
      const p = this.L.perches[id] || this.L.perches.claude;
      return p ? [p.x, p.top] : [this.L.board.x1 - 8, this.L.board.y];
    }
    typeBubble(id, text) {
      const a = this.agents[id];
      a.typingUntil = this.now + 99999;
      a.flapUntil = this.now + 260;
      this.refreshLabels();
      return (async () => {
        if (!this.waitingFor(id).length) {
          const [x, y] = this.perchPos(id);
          const b = this.bubble;
          this.at(b, x, y - 20);
          b.textContent = '';
          b.classList.add('on');
          const chars = [...String(text || '')];
          const step = reduced ? 0 : Math.max(18, Math.min(45, 520 / Math.max(1, chars.length)));
          for (const ch of chars) { b.textContent += ch; if (step) await sleep(step); }
          await sleep(reduced ? 150 : 240);
          b.classList.remove('on');
        }
        a.typingUntil = 0;
        a.flapUntil = this.now + 220;
      })();
    }
    taskStart(t) {
      const v = { t, arrived: false, pendingEnd: false, hole: -1 };
      this.tasks.set(t.id, v);
      if (t.kind === 'subagent') {
        let i = this.holes.findIndex(h => !h.task);
        if (i < 0) i = this.holes.reduce((b, h, k) => (h.arrivedAt < this.holes[b].arrivedAt ? k : b), 0);
        this.holes[i] = { task: t, arrivedAt: 0, act: null, badge: null, leaving: 0, shakeUntil: 0 };
        v.hole = i;
      }
      // 用户自己在 Codex 里开的对话：没人派活，直接开工
      if (t.kind === 'codex' && t.via === 'codex-app') { this.arrive(v); return; }
      this.typeQueue = this.typeQueue.then(() => this.typeBubble('claude', t.title)).then(() => {
        if (this.dead) return;
        const from = this.perchPos('claude');
        const to = t.kind === 'codex' ? this.perchPos('codex') : this.holeMouth(v.hole);
        this.courier(from, to, { breed: t.kind === 'subagent' ? 'claude' : 'post', carry: 'note' }).then(() => this.arrive(v));
      });
    }
    holeMouth(i) { const h = this.L.holes[i] || this.L.holes[0]; return [h.x + 4, h.y + h.h]; }
    arrive(v) {
      const t = v.t;
      v.arrived = true;
      if (t.kind === 'codex') {
        const a = this.agents.codex;
        a.pile++; a.act = t.activity; a.badge = null; a.hopAt = this.now;
        a.status = { ...a.status, installed: true, running: true };
      } else {
        const h = this.holes[v.hole];
        if (h && h.task === t) { h.arrivedAt = this.now; h.act = 'think'; }
      }
      this.refreshLabels();
      if (v.pendingEnd) this.end(v);
    }
    taskEnd(t) {
      const v = this.tasks.get(t.id);
      if (!v) return;
      v.t = t;
      if (!v.arrived) { v.pendingEnd = true; return; }
      this.end(v);
    }
    end(v) {
      const t = v.t, ok = t.status === 'done';
      let from;
      if (t.kind === 'codex') {
        const a = this.agents.codex;
        a.pile = Math.max(0, a.pile - 1);
        a.badge = { ok, until: this.now + 1600 };
        if (!ok) a.shakeUntil = this.now + 450;
        if (!a.pile) { a.act = null; a.realAct = false; }
        if (t.via === 'codex-app') { this.tasks.delete(t.id); this.refreshLabels(); return; }
        from = this.perchPos('codex');
      } else {
        const h = this.holes[v.hole];
        if (!h || h.task !== t) return;
        h.badge = { ok, until: this.now + 1800 }; h.act = null;
        if (!ok) h.shakeUntil = this.now + 450;
        from = this.holeMouth(v.hole);
        setTimeout(() => { if (h.task === t) h.leaving = this.now; }, 1400);
        setTimeout(() => { if (h.task === t) { h.task = null; h.badge = null; h.leaving = 0; } }, 1900);
      }
      this.refreshLabels();
      this.courier(from, this.perchPos('claude'), { breed: t.kind === 'subagent' ? 'claude' : 'post', carry: ok ? 'reply' : 'bad' }).then(() => {
        const c = this.agents.claude;
        c.hopAt = this.now;
        c.badge = { ok, until: this.now + 1300 };
        if (!ok) c.shakeUntil = this.now + 400;
        this.tasks.delete(t.id);
        this.refreshLabels();
      });
    }
    activity({ agent, activity }) {
      if (agent === 'claude') { const c = this.agents.claude; c.act = activity; c.actUntil = this.now + 2600; }
      else { const h = this.holes.find(x => x.task && x.task.id === agent); if (h && h.arrivedAt) h.act = activity; }
      this.refreshLabels();
    }
    taskActivity(t) {
      if (t.kind !== 'codex') return;
      const v = this.tasks.get(t.id);
      if (v && v.arrived) { const a = this.agents.codex; a.act = t.activity; a.realAct = true; this.refreshLabels(); }
    }
    activityEnd() { const c = this.agents.claude; c.actUntil = Math.min(c.actUntil, this.now + 500); }
    // 小雏鸽叼着纸条在本机鸽舍里飞一小段
    courier(from, to, { breed, carry }) {
      return new Promise(res => {
        const dur = reduced ? 380 : 900 + Math.min(500, Math.abs(to[0] - from[0]) * 4);
        this.couriers.push({ from, to, breed, carry, t0: this.now, dur, res, lift: 16 + Math.abs(to[0] - from[0]) * 0.15 });
      });
    }

    /* ---------- 纸条：信鸽的状态机 ---------- */
    setNotes(list) {
      for (const v of this.notes.values()) this.drop(v);
      this.notes.clear();
      this.slots = { board: [], perch: {}, remote: {} };
      for (const n of list || []) {
        if (M.NOTE_TERMINAL.has(n.state)) continue;
        if (this.notes.size >= 10) break;
        const v = this.noteEntity(n);
        // 恢复时直接摆到该在的位置，不补动画
        if (n.state === 'queued') this.toBoard(v);
        else if (n.state === 'flying') { v.spot = this.dstSpot(v); v.st = 'loiter'; v.loiterT0 = this.now; }
        else { v.spot = this.dstSpot(v); v.st = 'dst'; }
      }
      this.refreshLabels();
    }
    noteEntity(n) {
      this.ensureLoft(n.from); this.ensureLoft(n.to);
      const v = { band: n.band, n, st: 'none', spot: null, seg: null, alpha: 1, born: this.now };
      this.notes.set(n.band, v);
      return v;
    }
    noteUpdate(n) {
      let v = this.notes.get(n.band);
      if (!v) {
        if (M.NOTE_TERMINAL.has(n.state) && n.prevState == null && !n.answer_preview && !n.error) return;
        v = this.noteEntity(n);
      }
      v.n = n;
      this.ensureLoft(n.to);
      this.drive(v);
      this.refreshLabels();
    }
    drop(v) { this.freeSpot(v); if (v.tag) v.tag.remove(); v.st = 'gone'; }
    // 槽位：起降板、栖木两侧、远处鸽舍的落脚板
    take(list, n) { let i = 0; while (list[i]) i++; if (i >= n) i = Math.floor(Math.random() * n); list[i] = true; return i; }
    toBoard(v) { this.freeSpot(v); v.spot = { kind: 'board', i: this.take(this.slots.board, 6) }; v.st = 'board'; }
    freeSpot(v) {
      const s = v.spot;
      if (!s) return;
      if (s.kind === 'board') this.slots.board[s.i] = false;
      else if (s.kind === 'perch') (this.slots.perch[s.id] || [])[s.i] = false;
      else if (s.kind === 'remote') (this.slots.remote[s.id] || [])[s.i] = false;
      v.spot = null;
    }
    perchSpot(id) { const l = (this.slots.perch[id] = this.slots.perch[id] || []); return { kind: 'perch', id, i: this.take(l, 4) }; }
    dstSpot(v) {
      const to = v.n.to || {};
      this.freeSpot(v);
      if (to.loft && to.loft !== 'local') { const l = (this.slots.remote[to.loft] = this.slots.remote[to.loft] || []); return { kind: 'remote', id: to.loft, i: this.take(l, 5) }; }
      const id = this.L.perches[to.agent] ? to.agent : this.L.perches.codex ? 'codex' : 'claude';
      return this.perchSpot(id);
    }
    homeSpot(v) {
      const from = v.n.from || {};
      this.freeSpot(v);
      if (from.loft && from.loft !== 'local') { const l = (this.slots.remote[from.loft] = this.slots.remote[from.loft] || []); return { kind: 'remote', id: from.loft, i: this.take(l, 5) }; }
      if (from.agent === 'you' || !this.L.perches[from.agent]) return { kind: 'door' };
      return this.perchSpot(from.agent);
    }
    pos(s) {
      const L = this.L;
      if (!s) return { x: L.board.x1 - 8, y: L.board.y, d: 0, face: 1 };
      if (s.kind === 'board') return { x: L.board.x1 - 8 - (s.i % 6) * 13, y: L.board.y, d: 0, face: 1 };
      if (s.kind === 'door') return { x: L.door.x + L.door.w + 6, y: L.board.y, d: 0, face: 1 };
      if (s.kind === 'perch') {
        const p = L.perches[s.id] || L.perches.claude;
        const side = s.i % 2 ? 1 : -1;
        if (s.i < 2) return { x: p.x + side * 16, y: p.top, d: 0, face: -side };
        return { x: p.x + side * (8 + (s.i >> 1) * 6), y: L.roofY + 1, d: 0, face: -side };
      }
      const r = this.remotes.find(x => x.id === s.id);
      if (!r) return { x: this.W - 14, y: L.hy - 12, d: 1, face: -1 };
      const off = [-6, 6, -12, 12, 0][s.i % 5];
      return { x: r.x + off, y: r.y - 6, d: 1, face: off < 0 ? 1 : -1 };
    }
    // 根据纸条的目标状态，决定信鸽下一步做什么。动画进行中时，等这一段播完再来
    drive(v) {
      if (v.seg || v.st === 'gone' || v.st === 'retire') return;
      const goal = v.n.state;
      if (v.st === 'none') {
        if (goal === 'home') { v.spot = this.dstSpot(v); v.st = 'dst'; }
        else this.toBoard(v);
      }
      if (goal === 'queued') return;
      if (goal === 'flying' || goal === 'delivered') {
        if (v.st === 'board') return this.depart(v);
        if (v.st === 'loiter' && goal === 'delivered') return this.settle(v);
        return;
      }
      if (goal === 'home') {
        if (v.st === 'board') { this.freeSpot(v); v.spot = this.dstSpot(v); v.st = 'dst'; }
        return this.flyHome(v, 'reply');
      }
      if (goal === 'refused') {
        if (v.st === 'board') return this.stampAndRetire(v, 'x');
        return this.flyHome(v, 'bad');
      }
      if (goal === 'lost') {
        if (v.st === 'board') return this.stampAndRetire(v, '?');
        return this.wander(v);
      }
    }
    // 放飞：蹲一下、张翅、扑出去。整段动画里最用力的一下
    depart(v) {
      const from = this.pos(v.spot);
      this.freeSpot(v);
      v.spot = this.dstSpot(v);
      const to = this.pos(v.spot);
      v.st = 'air';
      if (!reduced) {
        this.puff(from.x, from.y, 8, C.creamDk);
        this.feathers(from.x, from.y - 8, 6, BREED_FEATHER);
      }
      this.fly(v, from, () => this.pos(v.spot), {
        takeoff: reduced ? 0 : 340, carry: 'note', big: true, dur: this.flightDur(from, to),
        done: () => {
          if (v.n.state === 'flying') { v.st = 'loiter'; v.loiterT0 = this.now; }
          else this.land(v);
          this.drive(v);
        },
      });
    }
    settle(v) {
      const p = this.pos(v.spot);
      const cur = this.loiterPos(v);
      v.st = 'air';
      this.fly(v, { x: cur[0], y: cur[1], d: p.d }, () => this.pos(v.spot), { dur: reduced ? 200 : 520, carry: 'note', lift: 2, done: () => { this.land(v); this.drive(v); } });
    }
    land(v) {
      v.st = 'dst';
      const p = this.pos(v.spot);
      if (!reduced && p.d < 0.5) this.puff(p.x, p.y, 4, C.creamDk);
      this.flash(v, STATE_LABEL.delivered);
      this.refreshLabels();
    }
    // 归巢（带回信）或者被拒后折返
    flyHome(v, carry) {
      const from = v.st === 'loiter' ? (([x, y]) => ({ x, y, d: this.pos(v.spot).d }))(this.loiterPos(v)) : this.pos(v.spot);
      const fromStanding = v.st === 'dst';
      v.spot = this.homeSpot(v);
      const to = this.pos(v.spot);
      v.st = 'air';
      const bad = carry === 'bad';
      this.fly(v, from, () => this.pos(v.spot), {
        takeoff: fromStanding && !reduced ? (bad ? 120 : 220) : 0, carry, dur: this.flightDur(from, to) * (bad ? 0.7 : 1), land: true, lift: bad ? 0.35 : 1,
        done: () => {
          v.st = 'home';
          const p = this.pos(v.spot);
          const who = v.spot.kind === 'perch' ? this.agents[v.spot.id] : null;
          if (bad) {
            this.stamp(p.x, p.y - 22, 'x');
            v.shakeUntil = this.now + 500;
            if (!reduced) this.puff(p.x, p.y, 4, C.mute);
            this.flash(v, STATE_LABEL.refused + (v.n.error ? '：' + M.oneLine(v.n.error, 18) : ''));
            this.retireLater(v, 3200);
          } else {
            // 归巢：落地一圈光、几片羽毛，主人跳一下，回信在头顶冒出来
            if (!reduced) {
              this.rings.push({ x: p.x, y: p.y - 7, t0: this.now, col: C.red, max: 22 });
              this.rings.push({ x: p.x, y: p.y - 7, t0: this.now + 120, col: C.cream, max: 15 });
              this.feathers(p.x, p.y - 10, 7, BREED_FEATHER);
              this.puff(p.x, p.y, 6, C.creamDk);
            }
            if (who) { who.hopAt = this.now + 120; who.flapUntil = this.now + 420; }
            v.bounceAt = this.now;
            this.showAnswer(p, v.n);
            this.flash(v, STATE_LABEL.home);
            this.retireLater(v, 4600);
          }
          this.refreshLabels();
        },
      });
    }
    stampAndRetire(v, kind) {
      const p = this.pos(v.spot);
      v.st = 'home';
      this.stamp(p.x, p.y - 22, kind);
      if (kind === 'x') v.shakeUntil = this.now + 500;
      else v.ghost = true;
      this.flash(v, kind === 'x' ? STATE_LABEL.refused : STATE_LABEL.lost);
      this.retireLater(v, kind === 'x' ? 3000 : 3800);
      this.refreshLabels();
    }
    // 迷路：飞偏，越飞越淡，钻进云里不见了，只留一个问号
    wander(v) {
      const from = v.st === 'loiter' ? (([x, y]) => ({ x, y, d: this.pos(v.spot).d }))(this.loiterPos(v)) : this.pos(v.spot);
      this.freeSpot(v);
      v.st = 'air';
      const cl = this.clouds[1] || { x: this.W * 0.5, y: this.H * 0.18 };
      const tx = clamp(cl.x + 18, 20, this.W - 20), ty = cl.y + 4;
      const to = { x: tx, y: ty, d: Math.min(1, from.d + 0.2) };
      this.fly(v, from, () => to, {
        takeoff: 0, carry: 'note', dur: reduced ? 400 : 2600, wobble: true, fade: true, lift: 0.4,
        done: () => {
          this.marks.push({ x: tx, y: ty - 4, t0: this.now, kind: '?', life: 6000 });
          v.st = 'gone';
          this.flash(v, STATE_LABEL.lost, true);
          setTimeout(() => this.remove(v), 2600);
          this.refreshLabels();
        },
      });
    }
    retireLater(v, ms) {
      v.retireAt = this.now + ms;
    }
    remove(v) { this.drop(v); if (this.notes.get(v.band) === v) this.notes.delete(v.band); this.refreshLabels(); }
    flightDur(a, b) {
      if (reduced) return 420;
      const far = Math.max(a.d, b.d) > 0.5;
      return far ? 2400 + Math.abs(b.x - a.x) * 2 : 900 + Math.abs(b.x - a.x) * 5;
    }
    fly(v, from, to, o) {
      v.seg = { from, to, t0: this.now, takeoff: o.takeoff || 0, dur: o.dur, carry: o.carry, big: !!o.big, land: !!o.land, wobble: !!o.wobble, fade: !!o.fade, lift: o.lift == null ? 1 : o.lift, done: o.done };
    }
    // 路径：从起点往上拱，跨鸽舍时飞得更高，穿过中间的天空
    segPos(seg, u) {
      const a = seg.from, b = seg.to();
      const far = Math.max(a.d, b.d) > 0.5;
      const top = Math.min(a.y, b.y) - (far ? Math.max(30, Math.min(a.y, b.y) - this.H * 0.14) : 18 + Math.abs(b.x - a.x) * 0.12) * seg.lift;
      const dx = b.x - a.x;
      let [x, y] = cubic([a.x, a.y - 6], [a.x + dx * 0.2, top], [a.x + dx * 0.75, top], [b.x, b.y - (b.d > 0.5 ? 4 : 8)], u);
      if (seg.wobble) { x += Math.sin(u * 14) * 7 * u; y += Math.cos(u * 11) * 4 * u; }
      return { x, y, d: lerp(a.d, b.d, easeIO(u)), dir: dx >= 0 ? 1 : -1 };
    }
    loiterPos(v) {
      const p = this.pos(v.spot);
      const t = (this.now - (v.loiterT0 || 0)) / 900;
      if (reduced) return [p.x, p.y - 12];
      const r = p.d > 0.5 ? 7 : 11;
      return [p.x + Math.cos(t) * r, p.y - 12 + Math.sin(t) * r * 0.4];
    }

    /* ---------- 小效果 ---------- */
    flash(v, text, keep) {
      const t = this.tagOf(v);
      t.textContent = text;
      t.dataset.state = v.n.state;
      v.flashUntil = this.now + (keep ? 2600 : 2200);
    }
    showAnswer(p, n) {
      const text = n.answer_preview ? M.oneLine(n.answer_preview, 34) : '回信到了';
      const b = this.answer;
      this.at(b, p.x, p.y - 22);
      b.textContent = text;
      b.title = n.answer_preview || '';
      b.classList.add('on');
      clearTimeout(this.answerT);
      this.answerT = setTimeout(() => b.classList.remove('on'), 4600);
    }
    say(text, ms = 2600) {
      const b = this.say$;
      this.at(b, this.L.lx + this.L.lw / 2, this.L.top - this.L.roofH - 12);
      b.textContent = text;
      b.classList.add('on');
      clearTimeout(this.sayT);
      this.sayT = setTimeout(() => b.classList.remove('on'), ms);
    }
    puff(x, y, n, col) {
      if (reduced) return;
      for (let i = 0; i < n; i++) this.fx.push({ x: x + (i - n / 2) * 2, y: y - 1, vx: (i - n / 2) * 0.012, vy: -0.006 - Math.random() * 0.008, g: 0, t0: this.now + i * 15, life: 520, col });
    }
    feathers(x, y, n, cols) {
      if (reduced) return;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        this.fx.push({ x, y, vx: Math.cos(a) * 0.03, vy: -0.03 + Math.sin(a) * 0.02, g: 0.00006, t0: this.now, life: 1300 + i * 60, col: cols[i % cols.length], feather: true, sway: Math.random() * 6 });
      }
    }
    stamp(x, y, kind) { this.marks.push({ x, y, t0: this.now, kind, life: 3000 }); }

    async detect(run) {
      this.vane.spinUntil = this.now + 99999;
      this.say('看看谁在家…', 1600);
      const L = this.L;
      const vx = L.lx + Math.round(L.lw / 2), vy = L.top - L.roofH - 8;
      const ringT = setInterval(() => this.rings.push({ x: vx, y: vy, t0: this.now, col: C.gold, max: 34 }), 340);
      let res;
      try { res = await Promise.all([run(), sleep(1100)]).then(r => r[0]); }
      finally { clearInterval(ringT); this.vane.spinUntil = this.now + 300; }
      if (!res) { this.say('检测失败，连不上 Pigeon 应用', 3200); return; }
      this.setAgents(res);
      const parts = [];
      for (const id of ORDER) {
        const s = res[id];
        if (!s) continue;
        const kind = !s.installed ? 'none' : s.running ? 'on' : 'off';
        const p = this.L.perches[id];
        if (p) this.marks.push({ x: p.x, y: p.top - 26, t0: this.now, kind, life: 2600 });
        parts.push(`${ROSTER[id].short}${kind === 'on' ? '在' : kind === 'off' ? '睡着' : '没装'}`);
      }
      this.say(parts.join('，'), 3600);
      return res;
    }

    /* ---------- 悬停卡片 ---------- */
    bindPointer() {
      const xy = ev => {
        const r = this.frame.getBoundingClientRect();
        return [((ev.clientX - r.left) / r.width) * this.W, ((ev.clientY - r.top) / r.height) * this.H];
      };
      this.frame.addEventListener('pointermove', ev => {
        const [x, y] = xy(ev);
        const hit = this.hit(x, y);
        this.frame.style.cursor = hit && hit.kind === 'note' ? 'pointer' : '';
        if (!hit || !this.cardsOn) { this.hideCard(); return; }
        this.showCard(hit);
      });
      this.frame.addEventListener('pointerleave', () => this.hideCard());
      this.frame.addEventListener('click', ev => {
        const hit = this.hit(...xy(ev));
        if (hit && hit.kind === 'note') this.onPick(hit.id);
      });
    }
    hit(x, y) {
      if (!this.L) return null;
      for (const v of this.notes.values()) {
        if (v.st === 'gone' || !v.at) continue;
        const r = v.at.d > 0.5 ? 5 : 9;
        if (Math.abs(x - v.at.x) <= r && y <= v.at.y + 2 && y >= v.at.y - r * 1.8) return { kind: 'note', id: v.band, x: v.at.x, y: v.at.y - 16 };
      }
      for (const [id, p] of Object.entries(this.L.perches)) if (Math.abs(x - p.x) <= 12 && y >= p.top - 20 && y <= this.L.roofY) return { kind: 'agent', id, x: p.x, y: p.top - 18 };
      for (let i = 0; i < this.L.holes.length; i++) {
        const h = this.L.holes[i];
        if (this.holes[i].task && x >= h.x - 1 && x <= h.x + h.w && y >= h.y && y <= h.y + h.h + 2) return { kind: 'hole', id: i, x: h.x + 4, y: h.y };
      }
      for (const r of this.remotes) if (Math.abs(x - r.x) <= 14 && y >= r.y - 24 && y <= r.y + 2) return { kind: 'remote', id: r.id, x: r.x, y: r.y - 22 };
      const L = this.L;
      if (x >= L.lx && x <= L.lx + L.lw && y >= L.top - L.roofH && y <= L.bottom) return { kind: 'loft', id: 'local', x: L.lx + L.lw / 2, y: L.top - L.roofH };
      return null;
    }
    showCard(hit) {
      this.cardFor = hit;
      this.fillCard(hit);
      const right = hit.x > this.W * 0.6;
      const color = hit.kind === 'agent' ? ROSTER[hit.id].color : hit.kind === 'note' ? C.red : C.gold;
      this.at(this.card, right ? hit.x - 8 : hit.x + 8, hit.y);
      this.card.style.setProperty('--c', color);
      this.card.classList.toggle('left', right);
      this.card.classList.add('on');
    }
    hideCard() { this.card.classList.remove('on'); this.cardFor = null; }
    fillCard(hit) {
      const rows = [];
      let title = '', sub = '', foot = '';
      const fmt = (M.Usage && M.Usage.format) || (n => String(n));
      if (hit.kind === 'agent') {
        const id = hit.id, a = this.agents[id], u = this.usage?.agents?.[id];
        title = ROSTER[id].name; sub = '本机';
        rows.push(['状态', this.statusOf(id)[0]]);
        if (a.status.detail) rows.push(['连接', a.status.detail]);
        rows.push(['模型', (u && u.model) || (id === 'cursor' || id === 'deepseek' ? '还没接入' : '还没用过')]);
        if (u && u.today) rows.push(['今天', `输出 ${fmt(u.today.output)} · 输入 ${fmt((u.today.input || 0) + (u.today.cacheRead || 0) + (u.today.cacheWrite || 0))}`]);
        if (u && u.week) rows.push(['近 7 天', `输出 ${fmt(u.week.output)} · ${u.week.messages || 0} 条消息`]);
        const subs = this.holes.filter(h => h.task).map(h => h.task.title);
        if (id === 'claude' && subs.length) rows.push(['子代理', subs.join('、')]);
      } else if (hit.kind === 'hole') {
        const h = this.holes[hit.id];
        if (!h || !h.task) return this.hideCard();
        title = h.task.title; sub = '子代理';
        rows.push(['类型', h.task.subagentType || '通用']);
        rows.push(['在做', h.badge ? (h.badge.ok ? '完成' : '出错') : ACT_LABEL[h.act] || '刚到']);
        if (h.task.model) rows.push(['模型', h.task.model]);
      } else if (hit.kind === 'remote' || hit.kind === 'loft') {
        const l = this.lofts.find(x => x.id === hit.id) || {};
        title = l.name || hit.id; sub = hit.kind === 'loft' ? '本机' : l.online === false ? '离线' : '远处的鸽舍';
        const ss = l.sessions || [];
        rows.push(['对话', ss.length ? ss.slice(0, 4).map(s => s.title || s.id.slice(0, 8)).join('、') + (ss.length > 4 ? ` 等 ${ss.length} 个` : '') : '还没读到']);
        if (l.projects && l.projects.length) rows.push(['项目', l.projects.map(p => p.name).join('、')]);
        const relay = ss.find(s => s.relay);
        if (relay) rows.push(['中继站', relay.title || relay.id]);
        if (l.placeholder) foot = '鸽舍列表里还没有它，是从纸条里认出来的';
        else if (hit.kind === 'remote') foot = '远程鸽舍经中继站送达，每次要跑一轮模型';
      } else if (hit.kind === 'note') {
        const v = this.notes.get(hit.id);
        if (!v) return this.hideCard();
        const n = v.n;
        title = STATE_LABEL[n.state] || n.state; sub = n.band;
        rows.push(['路线', routeText(n)]);
        if (n.preview) rows.push(['纸条', n.preview]);
        if (n.answer_preview) rows.push(['回信', n.answer_preview]);
        if (n.error) rows.push(['原因', n.error]);
        foot = '点一下在飞行记录里看';
      }
      this.card.innerHTML = '<header><b></b><small></small></header><dl></dl>' + (foot ? '<footer></footer>' : '');
      this.card.querySelector('b').textContent = title;
      this.card.querySelector('small').textContent = sub;
      if (foot) this.card.querySelector('footer').textContent = foot;
      const dl = this.card.querySelector('dl');
      for (const [k, v] of rows) {
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = v;
        dl.append(dt, dd);
      }
    }

    /* ---------- 每一帧 ---------- */
    loop(now) {
      if (this.dead) return;
      this.raf = requestAnimationFrame(this.loop);
      this.now = now;
      if (!this.W || !this.skyLayer) return;
      const c = this.b;
      c.imageSmoothingEnabled = false;
      c.globalAlpha = 1;
      c.drawImage(this.skyLayer, 0, 0);
      this.drawStars(c);
      this.drawClouds(c);
      c.drawImage(this.frontLayer, 0, 0);
      this.drawLoftLife(c);
      this.drawRemotes(c);
      for (const v of this.notes.values()) if (!v.seg && (v.st === 'dst' || v.st === 'home' || v.st === 'retire') && v.spot && v.spot.kind === 'perch') this.drawNote(c, v);
      for (const id of Object.keys(this.L.perches)) this.drawAgent(c, id);
      for (const v of this.notes.values()) if (!(!v.seg && (v.st === 'dst' || v.st === 'home' || v.st === 'retire') && v.spot && v.spot.kind === 'perch')) this.drawNote(c, v);
      this.drawCouriers(c);
      this.drawFx(c);
      this.drawMarks(c);
      const out = this.ctx;
      out.imageSmoothingEnabled = false;
      out.drawImage(this.buf, 0, 0, this.W * this.k, this.H * this.k);
      if (((now / 400) | 0) !== this.lastLbl) { this.lastLbl = (now / 400) | 0; this.refreshLabels(); }
    }
    f(ms) { return Math.floor(this.now / ms); }
    put(c, spr, x, y, face, alpha = 1) {
      const img = face < 0 ? spr.f : spr.c;
      const ax = face < 0 ? spr.w - spr.ax : spr.ax;
      if (alpha < 1) c.globalAlpha = Math.max(0, alpha);
      c.drawImage(img, Math.round(x - ax), Math.round(y - spr.ay));
      c.globalAlpha = 1;
    }
    drawStars(c) {
      for (const s of this.stars) {
        const on = !s.tw || reduced || (this.f(500) + s.ph) % 7 !== 0;
        c.fillStyle = s.tw ? (on ? C.star : C.starDim) : C.starDim;
        c.fillRect(s.x, s.y, 1, 1);
      }
    }
    drawClouds(c) {
      for (const cl of this.clouds) {
        const x = reduced ? cl.x : Math.round(((cl.x + (this.now / 1000) * cl.v) % (this.W + 80)) - 40);
        cl.cx = x + cl.c.width / 2;
        c.drawImage(cl.c, x, cl.y);
      }
    }
    drawLoftLife(c) {
      const L = this.L;
      // 屋檐下的灯
      const flick = reduced ? 0 : (this.f(130) * 7) % 11 === 0 ? 1 : 0;
      c.fillStyle = flick ? C.glowDk : C.glow; c.fillRect(L.lx + 5, L.top + 3, 3, 3);
      c.globalAlpha = 0.18; c.fillRect(L.lx + 2, L.top + 1, 9, 9); c.globalAlpha = 1;
      // 风向标：检测时转起来
      const vx = L.lx + Math.round(L.lw / 2), vy = L.top - L.roofH;
      c.fillStyle = C.ink; c.fillRect(vx, vy - 9, 1, 9);
      const spin = this.now < this.vane.spinUntil && !reduced ? this.f(110) % 4 : 0;
      if (spin % 2) { c.fillStyle = C.trimDk; c.fillRect(vx - 1, vy - 9, 3, 2); }
      else {
        const dir = spin === 2 ? -1 : 1;
        c.fillStyle = C.trimDk; c.fillRect(vx - 3, vy - 8, 7, 1); c.fillRect(vx - 3 * dir, vy - 9, 1, 3);
        c.fillStyle = C.red; c.fillRect(vx + 3 * dir, vy - 9, 1, 3); c.fillRect(vx + 4 * dir, vy - 8, 1, 1);
      }
      // 鸽洞里的子代理雏鸽
      this.holes.forEach((h, i) => {
        const g = L.holes[i];
        if (!g) return;
        if (!h.task || !h.arrivedAt) {
          if ((this.f(1800) + i * 3) % 9 === 0) { c.fillStyle = C.glowDk; c.fillRect(g.x + 3, g.y + g.h - 2, 3, 1); }
          return;
        }
        const age = this.now - h.arrivedAt;
        const rise = age < 220 ? Math.round(4 - (age / 220) * 4) : 0;
        const sink = h.leaving ? Math.round(((this.now - h.leaving) / 500) * 9) : 0;
        const bob = h.act && !reduced && this.f(300) % 2 ? -1 : 0;
        const shake = h.shakeUntil > this.now ? (this.f(50) % 2 ? 1 : -1) : 0;
        c.fillStyle = C.glowDk; c.globalAlpha = 0.5; c.fillRect(g.x + 1, g.y + 2, g.w - 2, g.h - 2); c.globalAlpha = 1;
        c.save(); c.beginPath(); c.rect(g.x - 2, g.y - 2, g.w + 4, g.h + 2); c.clip();
        const sp = A.breed('claude').squab;
        this.put(c, sp, g.x + 4 + shake, g.y + g.h + rise + sink + bob, 1);
        this.accessory(c, h.task.subagentType, g.x + 4 + shake, g.y + g.h - 9 + rise + sink + bob);
        c.restore();
        if (h.badge && h.badge.until > this.now) this.badge(c, h.badge, g.x + g.w - 1, g.y - 6);
        else if (h.act && i === this.lastHole()) this.actCard(c, h.act, g.x - 2, g.y - 17, '#e38c5b');
      });
    }
    lastHole() {
      let best = -1, t = -1;
      this.holes.forEach((h, i) => { if (h.task && h.arrivedAt > t && !h.badge) { t = h.arrivedAt; best = i; } });
      return best;
    }
    accessory(c, type, x, y) {
      const r = (dx, dy, w, h, col) => { c.fillStyle = col; c.fillRect(x + dx, y + dy, w, h); };
      const t = (type || '').toLowerCase();
      if (/review/.test(t)) { r(0, 1, 4, 1, C.ink); r(1, 2, 1, 1, C.ink); r(3, 2, 1, 1, C.ink); }
      else if (/explore|search/.test(t)) { r(-4, 2, 3, 3, C.cream); r(-3, 3, 1, 1, '#2d2955'); r(-2, 5, 1, 2, C.cream); }
      else if (/plan/.test(t)) { r(-4, 3, 3, 4, C.cream); r(-4, 4, 3, 1, C.creamDk); }
      else r(0, -1, 3, 1, C.gold);
    }
    drawRemotes(c) {
      for (const r of this.remotes) {
        const on = r.online !== false;
        // 洞里探出的小脑袋：对话越多，探头越多
        const n = on ? Math.min(2, (r.sessions || []).length) : 0;
        for (let i = 0; i < n; i++) {
          const hx = r.x + (i ? 3 : -5), hy = r.y - 10;
          c.fillStyle = (this.f(2200) + i) % 5 === 0 && !reduced ? '#8c99ae' : '#dce1e7';
          c.fillRect(hx, hy - 1, 2, 2); c.fillStyle = C.ink; c.fillRect(hx + (i ? -1 : 2), hy, 1, 1);
        }
        if (on) {
          c.fillStyle = C.glow; c.globalAlpha = 0.5;
          c.fillRect(r.x - 6, r.y - 8, 4, 1); c.fillRect(r.x + 2, r.y - 8, 4, 1);
          c.globalAlpha = 1;
        }
        // 对方在处理纸条：屋顶上三个点轮流亮
        const busy = [...this.notes.values()].some(v => v.st === 'dst' && v.spot?.kind === 'remote' && v.spot.id === r.id && v.n.state === 'delivered');
        if (busy) for (let i = 0; i < 3; i++) { c.fillStyle = (reduced ? 1 : this.f(260) % 3) === i ? C.cream : C.mute; c.fillRect(r.x - 3 + i * 3, r.y - 27, 2, 2); }
      }
    }
    drawAgent(c, id) {
      const a = this.agents[id], p = this.L.perches[id];
      if (!a.status.installed) { this.ghost(c, p.x, p.top, FACE[id]); return; }
      const waiting = this.waitingFor(id).length > 0;
      const busy = this.busy(id);
      const sleepy = !a.status.running && !waiting && !busy;
      const sp = A.breed(id, sleepy);
      let fr = sp.stand;
      if (sleepy) fr = sp.sleep;
      else if (this.now < a.flapUntil) fr = sp.flare;
      else if (busy && !reduced) fr = this.f(id === 'claude' ? 240 : 300) % 2 ? sp.peck : sp.stand;
      else if (this.now < a.peckUntil) fr = sp.peck;
      else if (this.now > a.blinkAt && this.now < a.blinkAt + 140) fr = sp.blink;
      if (this.now > a.blinkAt + 140) a.blinkAt = this.now + 2500 + Math.random() * 3500;
      if (!reduced && !busy && !sleepy && this.now > a.nextPeck) { a.peckUntil = this.now + 260; a.nextPeck = this.now + 2600 + Math.random() * 4200; }
      const hop = this.now - a.hopAt;
      const dy = hop >= 0 && hop < 300 && !reduced ? -[2, 3, 3, 2, 1, 0][Math.floor(hop / 50)] : 0;
      const shake = a.shakeUntil > this.now ? (this.f(50) % 2 ? 1 : -1) : 0;
      // 有访客落下时栖木轻轻一沉
      const dip = [...this.notes.values()].some(v => v.bounceAt && this.now - v.bounceAt < 160 && v.spot?.kind === 'perch' && v.spot.id === id) ? 1 : 0;
      this.put(c, fr, p.x + shake, p.top + dy + dip, FACE[id]);
      const head = [p.x + FACE[id] * 4, p.top - 18];
      if (sleepy) this.zzz(c, head[0] + 6, head[1] + 2);
      if (waiting) {
        // 举一面小旗：在等你
        const fy = head[1] - 9 + (reduced ? 0 : this.f(500) % 2);
        c.fillStyle = C.ink; c.fillRect(head[0] - 1, fy - 1, 9, 9);
        c.fillStyle = C.gold; c.fillRect(head[0], fy, 7, 7);
        c.fillStyle = C.ink; c.fillRect(head[0] + 3, fy + 1, 1, 3); c.fillRect(head[0] + 3, fy + 5, 1, 1);
      } else if (a.badge && a.badge.until > this.now) this.badge(c, a.badge, head[0] - 4, head[1] - 9);
      else if (busy && this.now >= a.typingUntil) {
        let act = id === 'claude' ? a.act : a.act || 'think';
        if (id !== 'claude' && act === 'image' && !a.realAct) act = ['image', 'image', 'look', 'tool'][this.f(1100) % 4];
        if (act) this.actCard(c, act, p.x - 7, p.top - 38, ROSTER[id].color);
      }
    }
    // 只描轮廓的虚线：这根栖木还空着（没装）
    ghost(c, x, y, face) {
      const sp = A.breed('post').stand;
      const key = face < 0 ? 'gf' : 'gc';
      if (!sp[key]) {
        const img = face < 0 ? sp.f : sp.c, w = img.width, h = img.height;
        const d = img.getContext('2d').getImageData(0, 0, w, h).data;
        const on = (i, j) => i >= 0 && j >= 0 && i < w && j < h && d[(j * w + i) * 4 + 3] > 0;
        sp[key] = [];
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (on(i, j) && (!on(i - 1, j) || !on(i + 1, j) || !on(i, j - 1) || !on(i, j + 1)) && (i + j) % 2 === 0) sp[key].push([i, j]);
      }
      const ax = face < 0 ? sp.w - sp.ax : sp.ax;
      c.fillStyle = C.dim;
      for (const [i, j] of sp[key]) c.fillRect(Math.round(x - ax + i), Math.round(y - sp.ay + j), 1, 1);
    }
    zzz(c, x, y) {
      const f = reduced ? 0.4 : (this.now / 1600) % 1;
      const zy = Math.round(y - f * 8), zx = Math.round(x + f * 4);
      c.globalAlpha = 1 - f;
      c.fillStyle = C.mute;
      c.fillRect(zx, zy, 4, 1); c.fillRect(zx + 2, zy + 1, 1, 1); c.fillRect(zx + 1, zy + 2, 1, 1); c.fillRect(zx, zy + 3, 4, 1);
      c.globalAlpha = 1;
    }
    badge(c, b, x, y) {
      const pop = !reduced && b.until - this.now > 1100 ? -1 : 0;
      y += pop;
      c.fillStyle = C.ink; c.fillRect(x - 1, y - 1, 11, 10);
      c.fillStyle = b.ok ? C.mint : C.red; c.fillRect(x, y, 9, 8);
      c.fillStyle = C.ink;
      const d = (dx, dy) => c.fillRect(x + dx, y + dy, 1, 1);
      if (b.ok) { d(2, 4); d(3, 5); d(4, 4); d(5, 3); d(6, 2); d(2, 3); d(3, 4); }
      else for (let i = 0; i < 5; i++) { d(2 + i, 1 + i); d(6 - i, 1 + i); }
    }
    actCard(c, act, x, y, col) {
      c.fillStyle = C.ink; c.fillRect(x - 1, y - 1, 17, 17);
      c.fillStyle = col; c.fillRect(x, y, 15, 15);
      c.fillStyle = '#1a1838'; c.fillRect(x + 1, y + 1, 13, 13);
      c.fillStyle = col; c.fillRect(x + 6, y + 15, 3, 1); c.fillRect(x + 7, y + 16, 1, 1);
      M.drawActIcon(c, act, x + 3, y + 3, col, this.f(150));
    }
    // 信筒：去程是红色的纸条，回程是带红封口的米色回信，被拒是红叉
    capsule(c, x, y, carry, tiny, face = 1) {
      if (!carry) return;
      if (tiny) { c.fillStyle = carry === 'reply' ? C.cream : C.red; c.fillRect(Math.round(x), Math.round(y), 1, 1); return; }
      x = Math.round(x); y = Math.round(y);
      c.fillStyle = C.ink; c.fillRect(x - 2, y - 1, 5, 4);
      c.fillStyle = carry === 'reply' ? C.cream : C.red; c.fillRect(x - 1, y, 3, 2);
      c.fillStyle = carry === 'reply' ? C.red : C.redHi; c.fillRect(face > 0 ? x : x, y, 1, carry === 'reply' ? 2 : 1);
    }
    drawNote(c, v) {
      if (v.st === 'gone' && !v.seg) { if (v.tag) v.tag.hidden = true; return; }
      const post = A.breed('post');
      let x, y, d, face = 1, spr, alpha = 1, flying = false, carry = 'note';
      if (v.retireAt && this.now > v.retireAt) {
        const t = (this.now - v.retireAt) / 500;
        if (t >= 1) { this.remove(v); return; }
        alpha = 1 - t;
      }
      if (v.seg) {
        const s = v.seg;
        const el = this.now - s.t0;
        carry = s.carry;
        if (el < s.takeoff) {
          // 起飞：先蹲一下，再张翅离开
          const p = s.from;
          x = p.x; d = p.d; face = s.to().x >= p.x ? 1 : -1;
          const crouch = el < s.takeoff * 0.35;
          y = p.y + (crouch ? 1 : -Math.round(((el - s.takeoff * 0.35) / (s.takeoff * 0.65)) * 4));
          spr = d > 0.5 ? post.tinyStand : crouch ? post.stand : post.flare;
          if (s.big && !crouch && !reduced && !s.whoosh) { s.whoosh = true; this.feathers(x, y - 6, 4, BREED_FEATHER); }
        } else {
          const u = clamp((el - s.takeoff) / s.dur, 0, 1);
          const q = this.segPos(s, easeIO(u));
          x = q.x; y = q.y; d = q.d; face = q.dir; flying = true;
          if (s.fade && u > 0.45) alpha = Math.max(0, 1 - (u - 0.45) / 0.5);
          const wing = reduced ? 3 : Math.floor((el - s.takeoff) / (d > 0.6 ? 120 : 85)) % 4;
          if (d > 0.68) spr = post.tiny[wing < 2 ? 0 : 1];
          else if (d > 0.3) spr = post.flyMid[wing];
          else if (s.land && u > 0.84) { spr = post.flare; y += 8; }
          else spr = post.fly[wing];
          // 放飞的一瞬：身后拖两道风线
          if (s.big && !reduced && el - s.takeoff < 380 && d < 0.3) {
            c.fillStyle = C.cream; c.globalAlpha = 0.6;
            c.fillRect(Math.round(x - face * 16), Math.round(y - 2), 6, 1); c.fillRect(Math.round(x - face * 20), Math.round(y + 2), 5, 1);
            c.globalAlpha = 1;
          }
          if (u >= 1) { v.seg = null; s.done && s.done(); }
        }
      } else if (v.st === 'loiter') {
        const [lx, ly] = this.loiterPos(v);
        const p = this.pos(v.spot);
        x = lx; y = ly; d = p.d; flying = true;
        face = reduced ? p.face : Math.sin((this.now - (v.loiterT0 || 0)) / 900) > 0 ? -1 : 1;
        const wing = reduced ? 3 : this.f(d > 0.5 ? 140 : 95) % 4;
        spr = d > 0.68 ? post.tiny[wing < 2 ? 0 : 1] : post.fly[wing];
      } else if (v.spot) {
        const p = this.pos(v.spot);
        x = p.x; y = p.y; d = p.d; face = p.face;
        if (v.st === 'home') carry = v.n.state === 'home' ? 'reply' : v.n.state === 'refused' ? 'bad' : 'note';
        if (d > 0.5) spr = post.tinyStand;
        else {
          const wait = v.st === 'board';
          const t = this.now - v.born;
          spr = wait && !reduced && (this.f(700) + v.band.length) % 5 === 0 ? post.peck : post.stand;
          if (v.st === 'board' && t < 300 && !reduced) { y += 0; alpha = Math.min(alpha, t / 300); }
        }
        if (v.shakeUntil > this.now) x += this.f(50) % 2 ? 1 : -1;
        if (v.ghost) alpha = Math.min(alpha, 0.35);
      } else return;
      v.at = { x, y, d };
      if (!spr) return;
      this.put(c, spr, x, y, face, alpha);
      if (alpha > 0.3) {
        const tiny = d > 0.5;
        if (flying) this.capsule(c, x - face * (tiny ? 0 : 1), y + (tiny ? 2 : 3), carry, tiny, face);
        else this.capsule(c, x + (tiny ? -1 : face), y - (tiny ? 1 : 3), carry, tiny, face);
      }
      this.placeTag(v, x, y, d, flying);
    }
    placeTag(v, x, y, d, flying) {
      const t = v.tag || this.tagOf(v);
      const n = v.n;
      const flash = v.flashUntil > this.now;
      let text = null;
      if (flash) text = t.textContent;
      else if (v.st === 'board') text = `${STATE_LABEL.queued} → ${shortTo(n)}`;
      else if (flying && d < 0.6 && v.st !== 'gone') text = (v.seg && v.seg.carry === 'reply' ? '带回信 ' : '→ ') + shortTo(n);
      const show = !!text && !(d > 0.6 && !flash);
      t.hidden = !show;
      if (!show) return;
      if (!flash) { t.textContent = text; t.dataset.state = n.state; }
      this.at(t, x, y - (d > 0.5 ? 8 : 19));
    }
    drawCouriers(c) {
      this.couriers = this.couriers.filter(k => {
        const u = clamp((this.now - k.t0) / k.dur, 0, 1);
        const e = easeIO(u);
        const [ax, ay] = k.from, [bx, by] = k.to;
        const top = Math.min(ay, by) - k.lift;
        const [x, y] = cubic([ax, ay - 6], [lerp(ax, bx, 0.25), top], [lerp(ax, bx, 0.75), top], [bx, by - 5], e);
        const face = bx >= ax ? 1 : -1;
        const sp = A.breed(k.breed);
        this.put(c, sp.squabFly[reduced ? 0 : this.f(90) % 2], x, y, face);
        this.capsule(c, x - face, y + 3, k.carry === 'bad' ? 'bad' : k.carry, false, face);
        if (u >= 1) { k.res(); return false; }
        return true;
      });
    }
    drawFx(c) {
      this.fx = this.fx.filter(p => {
        const a = this.now - p.t0;
        if (a < 0) return true;
        if (a > p.life) return false;
        let x = p.x + p.vx * a, y = p.y + p.vy * a + (p.g || 0) * a * a;
        if (p.feather) x += Math.sin(a / 160 + p.sway) * 2;
        c.globalAlpha = 1 - a / p.life;
        c.fillStyle = p.col;
        c.fillRect(Math.round(x), Math.round(y), p.feather ? 2 : 1, 1);
        c.globalAlpha = 1;
        return true;
      });
      this.rings = this.rings.filter(r => {
        const a = (this.now - r.t0) / 700;
        if (a < 0) return true;
        if (a > 1) return false;
        const rad = Math.round(3 + easeOut(a) * (r.max - 3));
        c.globalAlpha = 1 - a;
        c.fillStyle = r.col;
        const n = Math.max(16, rad * 5);
        for (let i = 0; i < n; i++) {
          const th = (i / n) * Math.PI * 2;
          c.fillRect(Math.round(r.x + Math.cos(th) * rad), Math.round(r.y + Math.sin(th) * rad * 0.55), 1, 1);
        }
        c.globalAlpha = 1;
        return true;
      });
    }
    // 印章和标记：红叉=被拒收，问号=迷路，检测结果的在/睡/没装
    drawMarks(c) {
      this.marks = this.marks.filter(m => {
        const a = this.now - m.t0;
        if (a > m.life) return false;
        c.globalAlpha = a > m.life - 500 ? (m.life - a) / 500 : 1;
        const x = Math.round(m.x), y = Math.round(m.y - (m.kind === '?' && !reduced ? Math.sin(a / 300) : 0));
        const big = !reduced && a < 110;
        const r = (dx, dy, w, h, col) => { c.fillStyle = col; c.fillRect(x + dx, y + dy, w, h); };
        if (m.kind === 'x') {
          const s = big ? 9 : 7, o = s >> 1;
          r(-o - 1, -o - 1, s + 2, s + 2, C.ink); r(-o, -o, s, s, C.red);
          for (let i = 1; i < s - 1; i++) { r(-o + i, -o + i, 1, 1, C.cream); r(-o + s - 1 - i, -o + i, 1, 1, C.cream); }
        } else if (m.kind === '?') {
          r(-3, -5, 7, 10, C.ink);
          [[-1, -4, 3, 1], [-2, -3, 1, 2], [2, -3, 1, 2], [1, -1, 1, 1], [0, 0, 1, 2], [0, 3, 1, 1]].forEach(([dx, dy, w, h]) => r(dx, dy, w, h, C.cream));
        } else {
          const col = m.kind === 'on' ? C.mint : m.kind === 'off' ? C.mute : C.gold;
          const yy = -Math.min(3, Math.floor(a / 80));
          if (m.kind === 'on') { r(-2, yy + 2, 1, 1, col); r(-1, yy + 3, 1, 1, col); r(0, yy + 2, 1, 1, col); r(1, yy + 1, 1, 1, col); r(2, yy, 1, 1, col); }
          else if (m.kind === 'off') { r(-2, yy, 4, 1, col); r(0, yy + 1, 1, 1, col); r(-1, yy + 2, 1, 1, col); r(-2, yy + 3, 4, 1, col); }
          else { r(0, yy, 1, 3, col); r(0, yy + 4, 1, 1, col); }
        }
        c.globalAlpha = 1;
        return true;
      });
      // 删掉的纸条留下的标签也清掉
      for (const v of this.notes.values()) if (v.st === 'gone' && !v.seg && v.tag && !(v.flashUntil > this.now)) v.tag.hidden = true;
    }
  }

  const BREED_FEATHER = ['#b7c1cf', '#8c99ae', '#f3e6cf'];
  function shortTo(n) {
    const to = n.to || {};
    const name = to.title || WHO[to.agent] || '对话';
    return M.oneLine(name, 8) + (to.loft && to.loft !== 'local' ? '@' + M.oneLine(to.loft_name || '远处', 10) : '');
  }
  function routeText(n) {
    const end = e => (WHO[e.agent] || e.agent || '?') + (e.title ? `「${e.title}」` : '') + (e.loft && e.loft !== 'local' ? ` @ ${e.loft_name || e.loft}` : '');
    return `${end(n.from || {})} → ${end(n.to || {})}`;
  }

  M.Loft = Loft;
  M.noteRoute = routeText;
  M.NOTE_LABEL = STATE_LABEL;
  M.NOTE_WHO = WHO;
})();
