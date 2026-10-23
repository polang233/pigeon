// 主题：像素工作室。画布是 288×162 的低分辨率像素，放大显示；文字用 DOM 叠在上面。
(function () {
  const M = (window.Meerkat = window.Meerkat || {});
  const W = 288, H = 162;
  const SP = M.SPRITES, draw = M.drawGrid;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const BACK_DESK_Y = 100, FRONT_DESK_Y = 142;
  const SLOTS = [32, 78, 124];
  const S = 2; // 角色每格 2 像素
  const MEERKAT = { x: 134, y: 42, cx: 146, cy: 54 };
  const AGENT_POS = {
    claude: { sx: 50, sy: 86, head: [66, 84], hand: [80, 93], inbox: [62, 90], label: [66, 114] },
    codex: { sx: 208, sy: 86, head: [222, 84], inbox: [245, 94], label: [222, 114] },
    cursor: { sx: 230, sy: 126, head: [236, 124], inbox: [236, 128], label: [240, 155] },
  };
  const COLORS = {
    out: ['#e8784d', '#ffcf6b', '#f6a37f'],
    codexBack: ['#7ff0c8', '#e9f2ee', '#7ff0c8'],
    subBack: ['#f6a37f', '#ffcf6b', '#e8784d'],
    fail: ['#ff6b5a', '#ff9a8c', '#ff6b5a'],
    ping: ['#d9b382'],
  };
  const ACT_LABEL = { code: '写代码', read: '读文件', search: '搜索', image: '生图', look: '看图', tool: '调用工具', run: '跑命令', think: '思考', wait: '等你批准' };
  const ACCENT = { claude: '#e8784d', codex: '#7ff0c8', cursor: '#a3adbd', sub: '#ffcf6b' };

  const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const bez = (p, t) => {
    const u = 1 - t;
    return [u * u * p[0][0] + 2 * u * t * p[1][0] + t * t * p[2][0], u * u * p[0][1] + 2 * u * t * p[1][1] + t * t * p[2][1]];
  };
  const pct = (x, y) => `left:${(x / W) * 100}%;top:${(y / H) * 100}%`;

  class PixelStudio {
    constructor(root) {
      this.root = root;
      root.classList.add('studio');
      root.innerHTML = `<canvas width="${W}" height="${H}" aria-label="像素工作室：agent 之间的任务传递动画"></canvas><div class="ov"></div>`;
      this.cv = root.querySelector('canvas');
      this.ctx = this.cv.getContext('2d');
      this.ov = root.querySelector('.ov');
      this.now = performance.now();

      this.agents = {
        claude: { state: 'idle', status: { installed: true, running: true }, act: null, actUntil: 0, typingUntil: 0, recvAt: -1e9, badge: null, shakeUntil: 0 },
        codex: { state: 'idle', status: { installed: true, running: true }, act: null, recvAt: -1e9, badge: null, shakeUntil: 0, pile: 0, face: 'idle', faceUntil: 0 },
        cursor: { state: 'idle', status: { installed: true, running: false }, act: null, recvAt: -1e9, badge: null, shakeUntil: 0 },
      };
      this.slots = SLOTS.map(x => ({ x, task: null, act: null, arrivedAt: 0, leaving: 0, badge: null, shakeUntil: 0 }));
      this.vis = new Map();
      this.packets = [];
      this.sparks = [];
      this.rings = [];
      this.markers = [];
      this.meerkat = { look: 0, lookUntil: 0, alert: false, blinkAt: this.now + 3000, shout: 0 };
      this.typeQueue = Promise.resolve();

      this.labels = {};
      for (const [id, p] of Object.entries(AGENT_POS)) this.labels[id] = this.label(p.label, id === 'claude' ? 'Claude Code' : id === 'codex' ? 'Codex' : 'Cursor');
      this.slotLabels = SLOTS.map(x => this.label([x, 155], '', 'small'));
      this.bubble = this.el('div', 'bubble', pct(66, 80));
      this.mkBubble = this.el('div', 'bubble mk', pct(MEERKAT.cx, 36));

      this.bg = this.layer(c => this.paintBack(c));
      this.fgBack = this.layer(c => this.paintDesks(c, 'back'));
      this.fgFront = this.layer(c => this.paintDesks(c, 'front'));
      this.refreshLabels();
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    /* ---------- DOM ---------- */
    el(tag, cls, style) {
      const e = document.createElement(tag);
      e.className = cls;
      if (style) e.setAttribute('style', style);
      this.ov.appendChild(e);
      return e;
    }
    label([x, y], name, extra = '') {
      const e = this.el('div', 'lbl ' + extra, pct(x, y));
      e.innerHTML = `<b></b><span></span>`;
      e.querySelector('b').textContent = name;
      return e;
    }
    setLabel(e, name, status, tone = '') {
      if (name != null) e.querySelector('b').textContent = name;
      e.querySelector('span').textContent = status;
      e.dataset.tone = tone;
    }
    refreshLabels() {
      const st = (id) => {
        const a = this.agents[id];
        if (!a.status.installed) return ['未安装', 'off'];
        if (a.badge && a.badge.until > this.now) return a.badge.ok ? ['完成', 'ok'] : ['出错', 'bad'];
        if (id === 'claude' && this.now < a.typingUntil) return ['派活中', 'busy'];
        if (a.act && (id !== 'claude' || this.now < a.actUntil)) return [ACT_LABEL[a.act] || '工作中', 'busy'];
        if (!a.status.running) return ['挂机中', 'off'];
        return ['待命', ''];
      };
      for (const id of ['claude', 'codex', 'cursor']) {
        const [s, tone] = st(id);
        const extra = id === 'codex' && this.agents.codex.pile > 1 ? ` · 排队 ${this.agents.codex.pile}` : '';
        this.setLabel(this.labels[id], null, s + extra, tone);
      }
      this.slots.forEach((s, i) => {
        const l = this.slotLabels[i];
        if (!s.task) { l.classList.remove('on'); return; }
        l.classList.add('on');
        const st = s.badge ? (s.badge.ok ? '完成' : '出错') : ACT_LABEL[s.act] || '赶路中';
        this.setLabel(l, M.oneLine(s.task.title, 9), st, s.badge ? (s.badge.ok ? 'ok' : 'bad') : 'busy');
        l.title = `${s.task.subagentType}：${s.task.title}`;
      });
    }
    pkLabel(text, color) {
      const e = this.el('div', 'pkt');
      e.textContent = text;
      e.style.setProperty('--c', color);
      return e;
    }
    async typeBubble(text) {
      const b = this.bubble;
      b.textContent = '';
      b.classList.add('on');
      const chars = [...text];
      const step = reduced ? 0 : Math.max(28, Math.min(70, 700 / chars.length));
      for (const ch of chars) { b.textContent += ch; if (step) await sleep(step); }
      await sleep(reduced ? 200 : 260);
      b.classList.remove('on');
    }
    say(text, ms = 2600) {
      const b = this.mkBubble;
      b.textContent = text;
      b.classList.add('on');
      clearTimeout(this.sayT);
      this.sayT = setTimeout(() => b.classList.remove('on'), ms);
    }

    /* ---------- static layers ---------- */
    layer(paint) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      paint(c.getContext('2d'));
      return c;
    }
    paintBack(c) {
      const r = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
      r(0, 0, W, 112, '#1d2b38');
      for (let y = 6; y < 108; y += 12) for (let x = (y / 12) % 2 ? 4 : 10; x < W; x += 12) r(x, y, 1, 1, '#24364a');
      r(0, 108, W, 4, '#16202b');
      r(0, 112, W, 50, '#3a2a22');
      for (let y = 118; y < H; y += 8) r(0, y, W, 1, '#2f221b');
      for (let y = 112, i = 0; y < H; y += 8, i++) for (let x = (i % 2) * 24; x < W; x += 48) r(x, y, 1, 8, '#2f221b');
      // 窗户
      r(10, 10, 40, 32, '#0e151d'); r(12, 12, 36, 28, '#24405a');
      r(29, 12, 2, 28, '#0e151d'); r(12, 25, 36, 2, '#0e151d');
      r(38, 15, 5, 5, '#ffe9a8'); r(37, 16, 1, 3, '#ffe9a8'); r(40, 15, 3, 2, '#24405a'); r(41, 17, 2, 2, '#24405a');
      r(10, 42, 40, 2, '#2b3c4f');
      // 墙上的海报
      r(178, 18, 22, 28, '#2b3c4f'); r(180, 20, 18, 24, '#e9d8b4');
      for (let i = 0; i < 4; i++) r(182, 24 + i * 4, 6 + (i * 5) % 9, 1, '#a87b4f');
      r(190, 36, 5, 5, '#e8784d');
      // 时钟
      r(250, 16, 14, 14, '#2b3c4f'); r(251, 17, 12, 12, '#e9f2ee'); r(256, 19, 1, 5, '#14202b'); r(257, 23, 3, 1, '#14202b');
      // 木箱瞭望台
      const crate = (x, y, w, h) => {
        r(x, y, w, h, '#8a5a3c'); r(x, y, w, 1, '#a8724e'); r(x, y + h - 1, w, 1, '#5a3a26');
        r(x, y, 1, h, '#5a3a26'); r(x + w - 1, y, 1, h, '#5a3a26');
        for (let i = 2; i < w - 2; i++) { const yy = y + 1 + Math.round(((i - 2) / (w - 4)) * (h - 3)); r(x + i, yy, 1, 1, '#6b432c'); }
      };
      crate(128, 92, 34, 20); crate(134, 78, 22, 14);
      // 盆栽
      r(268, 98, 12, 12, '#7a4a35'); r(267, 97, 14, 2, '#8f5a40');
      r(273, 78, 2, 19, '#3d6b4f'); r(266, 82, 7, 4, '#4f8a63'); r(275, 86, 7, 4, '#4f8a63'); r(268, 90, 5, 3, '#3d6b4f'); r(274, 76, 4, 3, '#4f8a63');
      // 落地灯
      r(108, 30, 14, 8, '#ffcf6b'); r(110, 28, 10, 2, '#e0a94a'); r(114, 38, 2, 72, '#3a4a5a'); r(110, 110, 10, 2, '#3a4a5a');
      const g = c.createRadialGradient(115, 40, 2, 115, 40, 60);
      g.addColorStop(0, 'rgba(255,207,107,.18)'); g.addColorStop(1, 'rgba(255,207,107,0)');
      c.fillStyle = g; c.fillRect(55, 0, 120, 112);
    }
    paintDesks(c, which) {
      const r = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
      const desk = (x, y, w, legTo) => {
        r(x, y, w, 1, '#c08a5e'); r(x, y + 1, w, 2, '#a8724e'); r(x + 1, y + 3, w - 2, 7, '#6b432c'); r(x + 1, y + 3, w - 2, 1, '#5a3a26');
        r(x + 3, y + 10, 2, legTo - y - 10, '#4a3020'); r(x + w - 5, y + 10, 2, legTo - y - 10, '#4a3020');
      };
      if (which === 'back') {
        desk(34, BACK_DESK_Y, 64, 112);
        r(84, 88, 13, 10, '#2b3a4a'); r(85, 89, 11, 7, '#1b2836'); r(89, 98, 3, 2, '#2b3a4a');
        r(38, 97, 6, 3, '#e9f2ee'); r(44, 98, 1, 1, '#e9f2ee'); // 杯子
        desk(190, BACK_DESK_Y, 64, 112);
        r(236, 98, 14, 2, '#3a4a5a'); // 收件盘
        r(194, 96, 8, 4, '#4f8a63'); r(196, 94, 4, 2, '#7fc29a'); // 小仙人掌
      } else {
        desk(214, FRONT_DESK_Y, 52, H);
        for (const x of SLOTS) desk(x - 20, FRONT_DESK_Y, 40, H);
      }
    }

    /* ---------- events from the store ---------- */
    setAgents(st) {
      for (const id of ['claude', 'codex', 'cursor']) if (st[id]) this.agents[id].status = st[id];
      this.refreshLabels();
    }
    heard() { this.agents.claude.status = { ...this.agents.claude.status, installed: true, running: true }; }

    taskStart(t) {
      const v = { t, arrived: false, pendingEnd: false, slot: -1 };
      this.vis.set(t.id, v);
      if (t.kind === 'subagent') {
        let i = this.slots.findIndex(s => !s.task);
        if (i < 0) i = this.slots.reduce((b, s, k) => (s.arrivedAt < this.slots[b].arrivedAt ? k : b), 0);
        v.slot = i;
        this.slots[i] = { ...this.slots[i], task: t, act: null, arrivedAt: 0, leaving: 0, badge: null };
      }
      this.typeQueue = this.typeQueue.then(async () => {
        this.agents.claude.typingUntil = this.now + 99999;
        this.refreshLabels();
        await this.typeBubble(t.title);
        this.agents.claude.typingUntil = 0;
        this.launch(v);
      });
    }
    launch(v) {
      const t = v.t, from = AGENT_POS.claude.hand;
      let to, route;
      if (t.kind === 'codex') {
        to = AGENT_POS.codex.inbox;
        route = [from, [(from[0] + to[0]) / 2, 8], to];
      } else {
        const x = this.slots[v.slot].x;
        to = [x, 134];
        route = [[58, 100], [(58 + x) / 2, 96], to];
      }
      this.packet(route, { colors: COLORS.out, label: t.title, n: Math.min(7, 4 + Math.floor((t.prompt || '').length / 40)), dur: 1500 }).then(() => {
        v.arrived = true;
        if (t.kind === 'codex') {
          const a = this.agents.codex;
          a.recvAt = this.now; a.pile++; a.act = t.activity; a.face = 'recv'; a.faceUntil = this.now + 500;
          a.status = { ...a.status, running: true };
          a.badge = null;
        } else {
          const s = this.slots[v.slot];
          if (s.task === t) { s.arrivedAt = this.now; s.act = 'think'; }
        }
        this.refreshLabels();
        if (v.pendingEnd) this.end(v);
      });
    }
    taskEnd(t) {
      const v = this.vis.get(t.id);
      if (!v) return;
      if (!v.arrived) { v.pendingEnd = true; return; }
      this.end(v);
    }
    end(v) {
      const t = v.t, ok = t.status === 'done';
      let route, colors;
      if (t.kind === 'codex') {
        const a = this.agents.codex;
        a.pile = Math.max(0, a.pile - 1);
        a.face = ok ? 'done' : 'fail'; a.faceUntil = this.now + 1400;
        a.badge = { ok, until: this.now + 1600 };
        if (!ok) a.shakeUntil = this.now + 450;
        if (!a.pile) a.act = null;
        const from = AGENT_POS.codex.inbox, to = AGENT_POS.claude.inbox;
        route = [from, [(from[0] + to[0]) / 2, 30], to];
        colors = ok ? COLORS.codexBack : COLORS.fail;
      } else {
        const s = this.slots[v.slot];
        if (s.task !== t) return;
        s.badge = { ok, until: this.now + 1800 }; s.act = null;
        if (!ok) { s.shakeUntil = this.now + 450; this.smoke(s.x, 130); this.meerkat.shout = this.now + 1500; }
        route = [[s.x, 132], [(58 + s.x) / 2, 92], [58, 98]];
        colors = ok ? COLORS.subBack : COLORS.fail;
        setTimeout(() => { if (s.task === t) s.leaving = this.now; }, 1500);
        setTimeout(() => { if (s.task === t) { s.task = null; s.badge = null; s.leaving = 0; this.refreshLabels(); } }, 2100);
      }
      if (!ok && t.kind === 'codex') this.meerkat.shout = this.now + 1500;
      this.refreshLabels();
      this.packet(route, { colors, label: M.oneLine(t.summary, 14), n: 4, dur: 1300, back: true }).then(() => {
        const c = this.agents.claude;
        c.recvAt = this.now;
        c.badge = { ok, until: this.now + 1200 };
        if (!ok) c.shakeUntil = this.now + 400;
        this.vis.delete(t.id);
        this.refreshLabels();
      });
    }
    activity({ agent, activity }) {
      if (agent === 'claude') {
        const c = this.agents.claude;
        c.act = activity; c.actUntil = this.now + 2600;
      } else {
        const s = this.slots.find(x => x.task && x.task.id === agent);
        if (s && s.arrivedAt) s.act = activity;
      }
      this.refreshLabels();
    }
    activityEnd() {
      const c = this.agents.claude;
      c.actUntil = Math.min(c.actUntil, this.now + 500);
    }

    async detect(run) {
      const mk = this.meerkat;
      mk.alert = true;
      this.say('我看看谁在…', 1600);
      const ringT = setInterval(() => this.rings.push({ x: MEERKAT.cx, y: MEERKAT.cy - 6, t0: this.now }), 320);
      for (const id of ['claude', 'codex', 'cursor']) {
        const to = AGENT_POS[id].head;
        this.packet([[MEERKAT.cx, MEERKAT.cy - 6], [(MEERKAT.cx + to[0]) / 2, Math.min(MEERKAT.cy, to[1]) - 24], to], { colors: COLORS.ping, n: 1, dur: 800, size: 2, hop: false });
      }
      let res;
      try { res = await Promise.all([run(), sleep(1100)]).then(r => r[0]); }
      finally { clearInterval(ringT); mk.alert = false; }
      if (!res) { this.say('检测失败，连不上 Meerkat 应用', 3200); return; }
      this.setAgents(res);
      const names = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor' };
      const parts = [];
      for (const id of ['claude', 'codex', 'cursor']) {
        const s = res[id];
        if (!s) continue;
        const kind = !s.installed ? 'none' : s.running ? 'on' : 'off';
        const [hx, hy] = AGENT_POS[id].head;
        this.markers.push({ x: hx, y: hy - 14, kind, t0: this.now });
        parts.push(`${names[id]}${kind === 'on' ? '在线' : kind === 'off' ? '没打开' : '没装'}`);
      }
      this.say(parts.join('，'), 3600);
      return res;
    }

    /* ---------- effects ---------- */
    packet(route, { colors, label, n = 5, dur = 1400, size = 2, hop = true, back = false }) {
      if (reduced) dur = 350;
      return new Promise(res => {
        const p = { route, colors, n, dur, size, hop, t0: this.now, lag: 0.07, res, frame: 0 };
        if (label) p.label = this.pkLabel(label, colors[0]);
        this.packets.push(p);
      });
    }
    smoke(x, y) { for (let i = 0; i < 6; i++) this.sparks.push({ x: x + (i % 3) - 1, y, vx: (Math.random() - 0.5) * 0.02, vy: -0.012 - Math.random() * 0.01, t0: this.now + i * 60, life: 900, col: '#8193a5' }); }

    /* ---------- render ---------- */
    loop(now) {
      this.now = now;
      const c = this.ctx;
      c.imageSmoothingEnabled = false;
      c.clearRect(0, 0, W, H);
      c.drawImage(this.bg, 0, 0);
      this.drawWindowStars(c);
      this.drawClaude(c);
      this.drawCodex(c);
      c.drawImage(this.fgBack, 0, 0);
      this.drawClaudeScreen(c);
      this.drawPile(c);
      this.drawMeerkat(c);
      this.drawCursor(c);
      this.drawSubs(c);
      c.drawImage(this.fgFront, 0, 0);
      this.drawCursorLaptop(c);
      this.drawPackets(c);
      this.drawSparks(c);
      this.drawRings(c);
      this.drawMarkers(c);
      this.drawCards(c);
      if (((now / 400) | 0) !== this.lastLbl) { this.lastLbl = (now / 400) | 0; this.refreshLabels(); }
      requestAnimationFrame(this.loop);
    }
    f(ms) { return Math.floor(this.now / ms); }

    drawWindowStars(c) {
      const stars = [[16, 15], [22, 30], [44, 34], [34, 20], [18, 36]];
      stars.forEach(([x, y], i) => {
        c.fillStyle = (this.f(700) + i) % 4 === 0 ? '#ffffff' : '#7f9ab5';
        c.fillRect(x, y, 1, 1);
      });
    }
    shakeX(a) { return a.shakeUntil > this.now ? (this.f(50) % 2 ? 1 : -1) : 0; }

    drawClaude(c) {
      const a = this.agents.claude, p = AGENT_POS.claude;
      const sleepy = !a.status.running;
      const typing = this.now < a.typingUntil || (a.act && this.now < a.actUntil);
      const pop = this.now - a.recvAt < 220 ? -2 : 0;
      const bob = !typing && !sleepy && this.f(900) % 2 ? 1 : 0;
      const x = p.sx + this.shakeX(a), y = p.sy + bob + pop;
      draw(c, SP.claude, x, y, { grey: sleepy, scale: S });
      if (!sleepy && this.f(80) % 45 === 0) { c.fillStyle = '#e8784d'; c.fillRect(x + 5 * S, y + 2 * S, S, 2 * S); c.fillRect(x + 10 * S, y + 2 * S, S, 2 * S); }
      c.fillStyle = sleepy ? M.greyOf('#e8784d') : '#e8784d';
      const f = this.f(110) % 2;
      const ly = typing ? (f ? 2 : 3) : 3, ry = typing ? (f ? 3 : 2) : 3;
      c.fillRect(x, y + ly * S, 2 * S, 2 * S);
      c.fillRect(x + 14 * S, y + ry * S, 2 * S, 2 * S);
      if (sleepy) this.drawZ(c, x + 30, y - 4);
      this.drawBadge(c, a.badge, x + 28, y - 10);
    }
    drawClaudeScreen(c) {
      const a = this.agents.claude;
      const busy = this.now < a.typingUntil || (a.act && this.now < a.actUntil);
      if (!busy) { if (a.status.running) { c.fillStyle = '#2a4a58'; c.fillRect(86, 90, 3, 1); } return; }
      const f = this.f(90);
      c.fillStyle = '#7ff0c8';
      for (let i = 0; i < 3; i++) c.fillRect(86, 90 + i * 2, 2 + ((f + i * 3) * 7) % 7, 1);
    }
    drawCodex(c) {
      const a = this.agents.codex, p = AGENT_POS.codex;
      const sleepy = !a.status.running && !a.pile;
      const working = a.pile > 0;
      const pop = this.now - a.recvAt < 220 ? -2 : 0;
      const x = p.sx + this.shakeX(a), y = p.sy + pop + (working && this.f(260) % 2 ? -1 : 0);
      draw(c, SP.codex, x, y, { grey: sleepy, scale: S });
      const face = this.now < a.faceUntil ? a.face : working ? 'work' : 'idle';
      const g = (dx, dy, w = 1, h = 1, col = '#7ff0c8') => { c.fillStyle = sleepy ? '#3a4a55' : col; c.fillRect(x + dx * S, y + dy * S, w * S, h * S); };
      if (sleepy) { g(4, 3, 2, 1); g(8, 3, 2, 1); this.drawZ(c, x + 26, y - 4); }
      else if (face === 'recv') { g(6, 1, 2, 3); g(6, 5, 2, 1); }
      else if (face === 'done') { g(3, 3); g(4, 2); g(5, 3); g(8, 3); g(9, 2); g(10, 3); }
      else if (face === 'fail') { g(3, 2); g(5, 2); g(4, 3); g(3, 4); g(5, 4); g(8, 2); g(10, 2); g(9, 3); g(8, 4); g(10, 4); }
      else if (face === 'work') {
        const f = this.f(120);
        for (let i = 0; i < 4; i++) g(3, 1 + i, 2 + ((f + i * 5) * 3) % 7, 1, i % 2 ? '#7ff0c8' : '#b8f7e2');
      } else {
        g(3, 2); g(4, 3); g(3, 4);
        if (this.f(500) % 2) g(6, 4, 3, 1);
      }
      this.drawBadge(c, a.badge, x + 26, y - 10);
    }
    drawPile(c) {
      const n = Math.min(this.agents.codex.pile, 5);
      for (let i = 0; i < n; i++) { c.fillStyle = i % 2 ? '#ffcf6b' : '#e8784d'; c.fillRect(240 + (i % 2) * 5, 95 - Math.floor(i / 2) * 3, 4, 3); }
    }
    drawCursor(c) {
      const a = this.agents.cursor, p = AGENT_POS.cursor;
      if (!a.status.installed) { this.drawAbsent(c, p.sx - 2, p.sy - 2, 22, 16); return; }
      const sleepy = !a.status.running;
      const x = p.sx, y = p.sy + (sleepy ? 2 : this.f(900) % 2 ? 1 : 0);
      draw(c, SP.cursor, x, y, { grey: sleepy, skip: sleepy ? 'k' : '', scale: S });
      if (sleepy) { c.fillStyle = '#4a5260'; c.fillRect(x + S, y + 5 * S + 1, S, 1); c.fillRect(x + 3 * S, y + 5 * S + 1, S, 1); this.drawZ(c, x + 16, y - 4); }
    }
    drawCursorLaptop(c) {
      const on = this.agents.cursor.status.running;
      c.fillStyle = '#5d6a7a'; c.fillRect(250, 140, 14, 2);
      if (on) { c.fillStyle = '#2b3a4a'; c.fillRect(252, 132, 10, 8); c.fillStyle = '#7fb8ff'; c.fillRect(253, 133, 8, 6); }
    }
    drawSubs(c) {
      this.slots.forEach(s => {
        if (!s.task || !s.arrivedAt) return;
        const age = this.now - s.arrivedAt;
        if (s.leaving && this.now - s.leaving > 500) return;
        const rise = age < 240 ? Math.round(8 - (age / 240) * 8) : 0;
        const sink = s.leaving ? Math.round(((this.now - s.leaving) / 500) * 12) : 0;
        const x = s.x - 10 + this.shakeX(s), y = FRONT_DESK_Y - 10 + rise + sink + (s.act && this.f(300) % 2 ? -1 : 0);
        c.save(); c.beginPath(); c.rect(0, 0, W, FRONT_DESK_Y); c.clip();
        draw(c, SP.mini, x, y, { scale: S });
        this.drawAccessory(c, s.task.subagentType, x, y);
        c.restore();
        this.drawBadge(c, s.badge, x + 18, y - 10);
      });
    }
    drawAccessory(c, type, x, y) {
      const r = (dx, dy, w, h, col) => { c.fillStyle = col; c.fillRect(x + dx * S, y + dy * S, w * S, h * S); };
      const t = (type || '').toLowerCase();
      if (/review/.test(t)) { r(1, 1, 8, 1, '#14202b'); r(2, 2, 2, 1, '#14202b'); r(6, 2, 2, 1, '#14202b'); }
      else if (/explore|search/.test(t)) { r(10, 0, 3, 3, '#e9f2ee'); r(11, 1, 1, 1, '#24405a'); r(12, 3, 1, 2, '#e9f2ee'); }
      else if (/plan/.test(t)) { r(10, 0, 3, 4, '#e9d8b4'); r(10, 1, 3, 1, '#a87b4f'); }
      else { r(3, -1, 4, 1, '#ffcf6b'); }
    }
    drawAbsent(c, x, y, w, h) {
      c.fillStyle = '#3a5068';
      for (let i = 0; i < w; i += 2) { c.fillRect(x + i, y, 1, 1); c.fillRect(x + i, y + h, 1, 1); }
      for (let i = 0; i < h; i += 2) { c.fillRect(x, y + i, 1, 1); c.fillRect(x + w, y + i, 1, 1); }
    }
    drawZ(c, x, y) {
      const f = (this.now / 1600) % 1;
      const zy = Math.round(y - f * 8), zx = Math.round(x + f * 4);
      c.globalAlpha = 1 - f;
      c.fillStyle = '#8193a5';
      c.fillRect(zx, zy, 4, 1); c.fillRect(zx + 2, zy + 1, 1, 1); c.fillRect(zx + 1, zy + 2, 1, 1); c.fillRect(zx, zy + 3, 4, 1);
      c.globalAlpha = 1;
    }
    drawBadge(c, b, x, y) {
      if (!b || b.until < this.now) return;
      const pop = b.until - this.now > 1100 ? -1 : 0;
      c.fillStyle = '#0e151d'; c.fillRect(x - 1, y - 1 + pop, 11, 10);
      c.fillStyle = b.ok ? '#7ff0c8' : '#ff6b5a';
      c.fillRect(x, y + pop, 9, 8);
      c.fillStyle = '#14202b';
      const d = (dx, dy) => c.fillRect(x + dx, y + dy + pop, 1, 1);
      if (b.ok) { d(2, 4); d(3, 5); d(4, 4); d(5, 3); d(6, 2); d(2, 3); d(3, 4); d(4, 5); }
      else { for (let i = 0; i < 5; i++) { d(2 + i, 1 + i + (i > 4 ? 0 : 0)); d(6 - i, 1 + i); } }
    }

    drawMeerkat(c) {
      const mk = this.meerkat;
      let look = mk.look;
      const live = this.packets.filter(p => p.n > 1);
      if (live.length) {
        const p = live[live.length - 1];
        const [px] = bez(p.route, ease(Math.min(1, (this.now - p.t0) / p.dur)));
        look = px < MEERKAT.cx - 14 ? -1 : px > MEERKAT.cx + 14 ? 1 : 0;
      } else if (this.now > mk.lookUntil) {
        mk.look = [0, 0, -1, 0, 1][Math.floor(Math.random() * 5)];
        mk.lookUntil = this.now + 1200 + Math.random() * 2200;
        look = mk.look;
      }
      if (mk.alert) look = [-1, 0, 1, 0][this.f(260) % 4];
      const up = mk.alert ? 2 : 0; // 站高几格
      const x = MEERKAT.x, y = MEERKAT.y;
      const g = SP.meerkat;
      draw(c, g.slice(7), x, y + 7 * S, { scale: S });
      for (let i = 0; i < up; i++) draw(c, [g[7]], x, y + (6 - i) * S, { scale: S });
      draw(c, g.slice(0, 7), x, y - up * S, { scale: S });
      const hy = y - up * S;
      if (this.now > mk.blinkAt) {
        if (this.now > mk.blinkAt + 130) mk.blinkAt = this.now + 2500 + Math.random() * 3000;
        c.fillStyle = '#2a1a12'; c.fillRect(x + 3 * S, hy + 4 * S, 2 * S, 1); c.fillRect(x + 7 * S, hy + 4 * S, 2 * S, 1);
      } else {
        const ex = look < 0 ? [3, 7] : look > 0 ? [4, 8] : [4, 7];
        c.fillStyle = '#120c08';
        c.fillRect(x + ex[0] * S, hy + 3 * S + 1, S, S + 1); c.fillRect(x + ex[1] * S, hy + 3 * S + 1, S, S + 1);
        c.fillStyle = '#fff5d6';
        c.fillRect(x + ex[0] * S, hy + 3 * S + 1, 1, 1); c.fillRect(x + ex[1] * S, hy + 3 * S + 1, 1, 1);
      }
      if (mk.shout > this.now) {
        const yy = hy - 12 + (this.f(120) % 2);
        c.fillStyle = '#ff6b5a'; c.fillRect(x + 11, yy, 2, 6); c.fillRect(x + 11, yy + 8, 2, 2);
      }
    }

    drawPackets(c) {
      this.packets = this.packets.filter(p => {
        const el = this.now - p.t0;
        const total = p.dur * (1 + p.lag * (p.n - 1));
        p.frame++;
        for (let i = 0; i < p.n; i++) {
          const raw = el / p.dur - i * p.lag;
          if (raw <= 0 || raw >= 1) continue;
          const t = ease(raw);
          let [x, y] = bez(p.route, t);
          if (p.hop) y -= Math.abs(Math.sin(t * Math.PI * 4)) * 5;
          x = Math.round(x); y = Math.round(y);
          const s = i === 0 ? p.size + 1 : p.size;
          c.fillStyle = p.colors[i % p.colors.length];
          c.fillRect(x - (s >> 1), y - (s >> 1), s, s);
          if (i === 0 && p.frame % 3 === 0 && !reduced) this.sparks.push({ x, y, vx: 0, vy: 0.004, t0: this.now, life: 320, col: p.colors[0] });
          if (i === 0 && p.label) p.label.setAttribute('style', `${pct(x, y)};--c:${p.colors[0]}`);
        }
        if (el >= total) { if (p.label) p.label.remove(); p.res(); return false; }
        return true;
      });
    }
    drawSparks(c) {
      this.sparks = this.sparks.filter(s => {
        const a = this.now - s.t0;
        if (a < 0) return true;
        if (a > s.life) return false;
        c.globalAlpha = 1 - a / s.life;
        c.fillStyle = s.col;
        c.fillRect(Math.round(s.x + s.vx * a), Math.round(s.y + s.vy * a), 1, 1);
        c.globalAlpha = 1;
        return true;
      });
    }
    drawRings(c) {
      this.rings = this.rings.filter(r => {
        const a = (this.now - r.t0) / 900;
        if (a > 1) return false;
        const rad = Math.round(6 + a * 34);
        c.globalAlpha = 1 - a;
        c.fillStyle = '#d9b382';
        for (let k = 0; k < 48; k++) {
          const th = (k / 48) * Math.PI * 2;
          c.fillRect(Math.round(r.x + Math.cos(th) * rad), Math.round(r.y + Math.sin(th) * rad * 0.8), 1, 1);
        }
        c.globalAlpha = 1;
        return true;
      });
    }
    drawMarkers(c) {
      this.markers = this.markers.filter(m => {
        const a = this.now - m.t0;
        if (a > 2600) return false;
        const y = m.y - Math.min(3, Math.floor(a / 80));
        c.globalAlpha = a > 2000 ? 1 - (a - 2000) / 600 : 1;
        const col = m.kind === 'on' ? '#7ff0c8' : m.kind === 'off' ? '#8193a5' : '#ffcf6b';
        c.fillStyle = col;
        if (m.kind === 'on') { c.fillRect(m.x, y, 2, 5); c.fillRect(m.x, y + 6, 2, 2); }
        else if (m.kind === 'off') { c.fillRect(m.x - 1, y, 4, 1); c.fillRect(m.x + 1, y + 1, 1, 1); c.fillRect(m.x, y + 2, 1, 1); c.fillRect(m.x - 1, y + 3, 4, 1); }
        else { c.fillRect(m.x - 1, y, 3, 1); c.fillRect(m.x + 2, y + 1, 1, 2); c.fillRect(m.x, y + 3, 2, 1); c.fillRect(m.x, y + 6, 2, 2); }
        c.globalAlpha = 1;
        return true;
      });
    }

    drawCards(c) {
      const a = this.agents;
      if (a.claude.act && this.now < a.claude.actUntil) this.card(c, a.claude.act, 86, 66, ACCENT.claude);
      if (a.codex.pile) {
        let act = a.codex.act;
        if (act === 'image') act = ['image', 'image', 'look', 'tool'][this.f(1100) % 4];
        this.card(c, act, 240, 66, ACCENT.codex);
      }
      this.slots.forEach(s => { if (s.task && s.arrivedAt && s.act && !s.badge) this.card(c, s.act, s.x + 10, 114, ACCENT.sub); });
    }
    card(c, act, x, y, col) {
      c.fillStyle = col; c.fillRect(x, y, 15, 15);
      c.fillStyle = '#14202b'; c.fillRect(x + 1, y + 1, 13, 13);
      c.fillRect(x + 3, y + 15, 3, 1); c.fillStyle = col; c.fillRect(x + 3, y + 15, 1, 2);
      this.icon(c, act, x + 3, y + 3, col);
    }
    icon(c, act, x, y, col) {
      const r = (dx, dy, w = 1, h = 1, cc = col) => { c.fillStyle = cc; c.fillRect(x + dx, y + dy, w, h); };
      const f = this.f(150);
      const ink = '#e9f2ee', dim = '#4a5f73';
      switch (act) {
        case 'code': for (let i = 0; i < 3; i++) r(0 + (i === 1 ? 2 : 0), 1 + i * 3, Math.min(9 - (i === 1 ? 2 : 0), Math.max(0, (f % 12) - i * 2)), 1, i === 1 ? ink : col); break;
        case 'read': r(1, 0, 7, 9, dim); r(2, 1, 5, 7, '#14202b'); for (let i = 0; i < 3; i++) r(3, 2 + i * 2, 3 - (i % 2), 1, ink); r(2, 1 + (f % 6), 5, 1, col); break;
        case 'search': { for (let i = 0; i < 3; i++) r(0, 1 + i * 3, 9 - i * 2, 1, dim); const pos = [[0, 0], [5, 2], [2, 5]][Math.floor(f / 3) % 3]; r(pos[0], pos[1], 3, 1, ink); r(pos[0], pos[1] + 2, 3, 1, ink); r(pos[0], pos[1] + 1, 1, 1, ink); r(pos[0] + 2, pos[1] + 1, 1, 1, ink); r(pos[0] + 3, pos[1] + 3, 1, 1, ink); break; }
        case 'image': { const order = [4, 0, 8, 2, 6, 1, 7, 3, 5]; const n = f % 12; order.forEach((k, i) => { if (i < n) r((k % 3) * 3, Math.floor(k / 3) * 3, 2, 2, [col, '#ffcf6b', '#e8784d', ink][k % 4]); }); break; }
        case 'look': r(0, 1, 9, 7, dim); r(1, 2, 7, 5, '#14202b'); r(2, 5, 2, 1, col); r(3, 4, 2, 1, col); r(5, 5, 2, 1, col); r(6, 3, 1, 1, '#ffcf6b'); r(1 + (f % 7), 1, 1, 7, ink); break;
        case 'tool': { r(3, 3, 3, 3, ink); r(4, 4, 1, 1, '#14202b'); const o = f % 2; if (o) { r(4, 0, 1, 2); r(4, 7, 1, 2); r(0, 4, 2, 1); r(7, 4, 2, 1); } else { r(1, 1, 2, 2); r(6, 1, 2, 2); r(1, 6, 2, 2); r(6, 6, 2, 2); } break; }
        case 'run': { const n = f % 14; r(0, 3, 9, 3, dim); r(1, 4, Math.min(7, n), 1, col); if (n > 9) { r(3, 0, 1, 1, ink); r(4, 1, 1, 1, ink); r(5, 0, 1, 1, ink); } break; }
        case 'wait': { const sw = [0, 1, 0, -1][f % 4]; r(3 + sw, 1, 3, 1, '#ffcf6b'); r(2 + sw, 2, 5, 4, '#ffcf6b'); r(1 + sw, 6, 7, 1, '#ffcf6b'); r(4, 7, 1, 1, ink); r(4, 0, 1, 1, ink); break; }
        default: for (let i = 0; i < 3; i++) r(1 + i * 3, 4, 2, 2, (f % 3) === i ? ink : dim);
      }
    }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  M.PixelStudio = PixelStudio;
})();
