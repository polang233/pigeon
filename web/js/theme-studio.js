// 主题：立体工作室。画布是 384×216 的低分辨率像素，放大显示；房间、家具、角色用 assets/scene 里的像素图，文字用 DOM 叠在上面。
// 一张主桌（指挥位）加 1–3 张工位，角色可以拖来拖去换位置；子代理坐在主人桌旁的小边桌上。
(function () {
  const M = (window.Meerkat = window.Meerkat || {});
  const W = 384, H = 216;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DIR = 'assets/scene/';

  const ROSTER = {
    claude: { name: 'Claude Code', color: '#e8784d' },
    codex: { name: 'Codex', color: '#7ff0c8' },
    cursor: { name: 'Cursor', color: '#a3adbd' },
    deepseek: { name: 'DeepSeek', color: '#4d6bfe' },
  };
  const ORDER = ['claude', 'codex', 'cursor', 'deepseek'];

  // 每种工位数下各张桌子的位置：桌子底边中点（地板上的点）。y 越大越靠前。
  const SPOTS = {
    2: { main: [150, 190], seats: [[284, 150]], meerkat: [160, 118], tray: [22, H - 12] },
    3: { main: [192, 196], seats: [[84, 150], [300, 150]], meerkat: [192, 118], tray: [22, H - 12] },
    4: { main: [192, 200], seats: [[70, 158], [314, 158], [244, 128]], meerkat: [128, 122], tray: [22, H - 12] },
  };
  // 角色坐在显示器旁边，不然脸会被正对观众的显示器挡住：dx 是相对桌子中心的偏移（按桌宽比例），sit 是屁股离桌子底边多高（按桌高比例）
  const IMAGE_FIT = { main: { dx: -0.3, sit: 0.62 }, seat: { dx: 0.27, sit: 0.62 }, side: { dx: 0.2, sit: 0.58 } };
  const WALK_AHEAD = 9; // 走路时在桌子前面多少像素
  // 子代理边桌相对主人桌子的位置（按桌宽的比例 + 像素偏移）
  const SIDE = [[-0.5, -22, 4], [0.5, 22, 4], [-0.5, -22, 22]];

  const COLORS = {
    out: ['#e8784d', '#ffcf6b', '#f6a37f'],
    back: ['#7ff0c8', '#e9f2ee', '#7ff0c8'],
    subBack: ['#f6a37f', '#ffcf6b', '#e8784d'],
    fail: ['#ff6b5a', '#ff9a8c', '#ff6b5a'],
    ping: ['#d9b382'],
  };
  const ACT_LABEL = { code: '写代码', read: '读文件', search: '搜索', image: '生图', look: '看图', tool: '调用工具', run: '跑命令', think: '思考' };
  const WAIT_LABEL = { permission: '等你批准', question: '有问题问你', idle: '轮到你了', other: '等你回复' };

  const FILES = ['room', 'desk-main', 'desk', 'desk-side', 'crate', 'lamp', 'plant', 'inbox',
    ...ORDER.flatMap(id => ['idle', 'work', 'sleep'].map(f => `${id}-${f}`)),
    'mini-idle', 'mini-work', 'mini-done', 'meerkat-idle', 'meerkat-alert', 'meerkat-look'];

  const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const bez = (p, t) => {
    const u = 1 - t;
    return [u * u * p[0][0] + 2 * u * t * p[1][0] + t * t * p[2][0], u * u * p[0][1] + 2 * u * t * p[1][1] + t * t * p[2][1]];
  };
  const pct = (x, y) => `left:${(x / W) * 100}%;top:${(y / H) * 100}%`;
  const lerp = (a, b, t) => a + (b - a) * t;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ---------- 图片 ---------- */
  function load(name) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = DIR + name + '.png';
    });
  }
  function canvasOf(img, fn) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    if (fn) {
      // 直接用 file:// 打开时读不了像素（算跨域），就不灰化、不染色
      try {
        const d = x.getImageData(0, 0, c.width, c.height);
        fn(d.data);
        x.putImageData(d, 0, 0);
      } catch (e) { return img; }
    }
    return c;
  }
  // 灰掉：挂机、没打开时用
  const grey = img => canvasOf(img, p => {
    for (let i = 0; i < p.length; i += 4) {
      const g = (p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11) * 0.62 + 18;
      p[i] = g; p[i + 1] = g + 3; p[i + 2] = g + 10;
    }
  });
  // 染色：子代理小帮手是浅灰的，按主人颜色乘上去
  const tint = (img, hex) => {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return canvasOf(img, p => {
      for (let i = 0; i < p.length; i += 4) {
        const l = (p[i] + p[i + 1] + p[i + 2]) / 765;
        const hi = l > 0.96; // 高光留白
        const k = hi ? 1 : 0.35 + l * 0.75;
        p[i] = Math.min(255, lerp(r, 255, hi ? 0.7 : 0) * k);
        p[i + 1] = Math.min(255, lerp(g, 255, hi ? 0.7 : 0) * k);
        p[i + 2] = Math.min(255, lerp(b, 255, hi ? 0.7 : 0) * k);
      }
    });
  };

  class Studio {
    constructor(root, opts = {}) {
      this.root = root;
      root.classList.add('studio', 'studio-3d');
      root.innerHTML = `<canvas width="${W}" height="${H}" aria-label="立体工作室：agent 之间的任务传递动画"></canvas><div class="ov"></div>`;
      this.cv = root.querySelector('canvas');
      this.ctx = this.cv.getContext('2d');
      this.ov = root.querySelector('.ov');
      this.now = performance.now();
      this.onLayout = opts.onLayout || (() => {});
      // 美术包：不给就读 assets/scene 里的插画；给了 M.PixelArt 就用代码画的像素图
      this.art = opts.art || null;
      this.fit = (this.art && this.art.fit) || IMAGE_FIT;
      this.cardsOn = true;
      this.subLabelsOn = true;

      this.count = 3;
      this.layout = { main: 'claude', seats: ['codex', 'cursor', 'deepseek'] };
      this.actors = {};
      for (const id of ORDER) {
        this.actors[id] = {
          id, status: { installed: true, running: id === 'claude' }, act: null, actUntil: 0, typingUntil: 0,
          recvAt: -1e9, badge: null, shakeUntil: 0, pile: 0, realAct: false,
          x: 0, y: 0, from: null, moveT0: 0, moveDur: 0, onStage: false, enterAt: 0,
        };
      }
      this.desks = {}; // 'main' / 'seat0'.. → {x, y, appearAt, leaveAt}
      this.subs = {};  // owner → [{task, act, arrivedAt, leaving, badge, shakeUntil}] 最多 3 个
      this.vis = new Map();
      this.packets = []; this.sparks = []; this.rings = []; this.markers = []; this.dust = [];
      this.meerkat = { look: 0, lookUntil: 0, alert: false, shout: 0, badge: null, x: 192, y: 118 };
      this.waitingItems = [];
      this.usage = null;
      this.typeQueue = Promise.resolve();
      this.parallax = [0, 0];

      this.labels = {};
      for (const id of ORDER) this.labels[id] = this.label(ROSTER[id].name);
      this.subLabels = {};
      this.bubble = this.el('div', 'bubble');
      this.mkBubble = this.el('div', 'bubble mk');
      this.hoverCard = this.el('div', 'agent-card');
      this.bench = this.el('div', 'bench');
      this.loading = this.el('div', 'stage-loading');
      this.loading.textContent = '正在搬桌子…';

      this.place(true);
      this.bindPointer();
      this.ready = this.loadImages().then(() => { this.loading.remove(); });
      this.loop = this.loop.bind(this);
      this.raf = requestAnimationFrame(this.loop);
    }

    destroy() { cancelAnimationFrame(this.raf); this.dead = true; this.root.classList.remove('studio-3d'); }

    async loadImages() {
      if (this.art) this.img = this.art.build();
      else {
        const imgs = await Promise.all(FILES.map(load));
        this.img = {};
        FILES.forEach((f, i) => { this.img[f] = imgs[i]; });
      }
      this.greyImg = {};
      for (const id of ORDER) for (const f of ['idle', 'sleep']) {
        const im = this.img[`${id}-${f}`];
        if (im) this.greyImg[`${id}-${f}`] = grey(im);
      }
      this.tinted = {};
      for (const id of ORDER) for (const f of ['idle', 'work', 'done']) {
        const im = this.img[`mini-${f}`];
        if (im) this.tinted[`${id}-${f}`] = tint(im, ROSTER[id].color);
      }
    }

    /* ---------- DOM ---------- */
    el(tag, cls, style) {
      const e = document.createElement(tag);
      e.className = cls;
      if (style) e.setAttribute('style', style);
      this.ov.appendChild(e);
      return e;
    }
    label(name, extra = '') {
      const e = this.el('div', 'lbl ' + extra);
      e.innerHTML = `<b></b><span></span>`;
      e.querySelector('b').textContent = name;
      return e;
    }
    setLabel(e, name, status, tone = '') {
      if (name != null) e.querySelector('b').textContent = name;
      e.querySelector('span').textContent = status;
      e.dataset.tone = tone;
    }

    /* ---------- 布局 ---------- */
    spots() { return SPOTS[this.count]; }
    seatKeys() { return ['main', ...this.spots().seats.map((_, i) => 'seat' + i)]; }
    spotOf(key) { const s = this.spots(); return key === 'main' ? s.main : s.seats[+key.slice(4)]; }
    // 谁坐在哪：主桌 + 前 count-1 个工位；其余候场
    occupants() {
      const out = { main: this.layout.main };
      this.layout.seats.slice(0, this.count - 1).forEach((id, i) => { out['seat' + i] = id; });
      return out;
    }
    keyOf(id) { const o = this.occupants(); return Object.keys(o).find(k => o[k] === id) || null; }
    deskW(key) { const im = this.img && this.img[key === 'main' ? 'desk-main' : 'desk']; return im ? im.width : key === 'main' ? 96 : 60; }

    /** 按当前 layout / count 把角色和桌子放到位；first 为真时不播动画 */
    place(first = false) {
      const occ = this.occupants();
      const keys = this.seatKeys();
      // 桌子：新出现的从地板升起，多余的沉下去
      for (const k of keys) {
        const [x, y] = this.spotOf(k);
        if (!this.desks[k] || this.desks[k].leaveAt) this.desks[k] = { x, y, appearAt: first ? -1e9 : this.now, leaveAt: 0 };
        else Object.assign(this.desks[k], { x, y });
        if (!first && this.desks[k].appearAt === this.now) this.puff(x, y);
      }
      for (const k of Object.keys(this.desks)) if (!keys.includes(k) && !this.desks[k].leaveAt) { this.desks[k].leaveAt = this.now; this.puff(this.desks[k].x, this.desks[k].y); }
      // 角色：走到自己的桌子；离场的走到右边出口
      for (const id of ORDER) {
        const a = this.actors[id];
        const key = Object.keys(occ).find(k => occ[k] === id);
        if (key) {
          const [x, y] = this.spotOf(key);
          if (first) { Object.assign(a, { x, y, onStage: true }); continue; }
          // 从左下角的候场区走进来
          if (!a.onStage) { a.x = -30; a.y = Math.max(y, H - 30); a.onStage = true; a.enterAt = this.now; }
          this.walk(a, x, y);
        } else if (a.onStage) {
          if (first) { a.onStage = false; continue; }
          this.walk(a, -40, Math.max(a.y, H - 30), () => { a.onStage = false; this.renderBench(); });
        }
      }
      const mk = this.spots().meerkat;
      this.meerkat.x = mk[0]; this.meerkat.y = mk[1];
      this.renderBench();
    }
    walk(a, x, y, done) {
      if (Math.abs(a.x - x) < 1 && Math.abs(a.y - y) < 1) { done && done(); return; }
      a.from = [a.x, a.y]; a.to = [x, y]; a.moveT0 = this.now;
      a.moveDur = reduced ? 1 : Math.min(1100, 380 + Math.hypot(x - a.x, y - a.y) * 3);
      a.moveDone = done || null;
    }
    stepMove(a) {
      if (!a.from) return;
      const t = Math.min(1, (this.now - a.moveT0) / a.moveDur);
      const e = ease(t);
      a.x = lerp(a.from[0], a.to[0], e);
      a.y = lerp(a.from[1], a.to[1], e);
      a.hop = t < 1 && !reduced ? Math.abs(Math.sin(t * Math.PI * Math.max(2, Math.round(a.moveDur / 180)))) * 4 : 0;
      if (t >= 1) { a.from = null; a.hop = 0; const d = a.moveDone; a.moveDone = null; d && d(); }
    }

    setScene(scene = {}) {
      if (scene.layout && scene.layout.main) {
        const seats = (scene.layout.seats || []).filter(id => ROSTER[id] && id !== scene.layout.main);
        for (const id of ORDER) if (id !== scene.layout.main && !seats.includes(id)) seats.push(id);
        this.layout = { main: ROSTER[scene.layout.main] ? scene.layout.main : 'claude', seats };
      }
      const n = Math.max(2, Math.min(4, Number(scene.seats) || 3));
      const changed = n !== this.count;
      this.count = n;
      this.cardsOn = scene.hoverCards !== false;
      this.subLabelsOn = scene.showSubLabels !== false;
      this.place(!this.placedOnce);
      this.placedOnce = true;
      if (changed) this.say(n === 4 ? '人齐了，开工！' : `换成 ${n} 人小组`, 1800);
    }

    /** 拖放：把 id 放到 key（'main' / 'seatN' / 'bench'） */
    moveTo(id, key) {
      const occ = this.occupants();
      const fromKey = this.keyOf(id);
      if (fromKey === key) { this.place(); return; }
      const order = [this.layout.main, ...this.layout.seats];
      const idx = k => (k === 'main' ? 0 : k === 'bench' ? -1 : 1 + +k.slice(4));
      const a = order.indexOf(id);
      if (key === 'bench') {
        if (!fromKey) return;
        // 和第一个候场的人交换
        const benchIds = order.slice(this.count);
        if (!benchIds.length) { this.place(); return; }
        const b = order.indexOf(benchIds[0]);
        [order[a], order[b]] = [order[b], order[a]];
      } else {
        const b = idx(key);
        const other = occ[key];
        if (other) { const j = order.indexOf(other); [order[a], order[j]] = [order[j], order[a]]; }
        else { order.splice(a, 1); order.splice(b, 0, id); }
      }
      this.layout = { main: order[0], seats: order.slice(1) };
      if (key === 'main') this.say(`${ROSTER[id].name} 来当指挥`, 1800);
      this.place();
      this.onLayout({ ...this.layout });
    }

    renderBench() {
      const occ = Object.values(this.occupants());
      const off = ORDER.filter(id => !occ.includes(id));
      this.bench.replaceChildren();
      this.bench.hidden = !off.length;
      if (!off.length) return;
      const t = document.createElement('span');
      t.textContent = '候场';
      this.bench.appendChild(t);
      for (const id of off) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'bench-chip';
        b.dataset.agent = id;
        b.style.setProperty('--c', ROSTER[id].color);
        const a = this.actors[id];
        b.textContent = ROSTER[id].name + (a.pile ? ` · ${a.pile}` : '');
        b.title = `拖到桌子上让 ${ROSTER[id].name} 上场`;
        this.bench.appendChild(b);
      }
    }

    /* ---------- 拖拽和悬停 ---------- */
    toLogical(ev) {
      const r = this.cv.getBoundingClientRect();
      return [((ev.clientX - r.left) / r.width) * W, ((ev.clientY - r.top) / r.height) * H];
    }
    hit(x, y) {
      for (const id of ORDER) {
        const a = this.actors[id];
        if (!a.onStage || a.from) continue;
        const key = this.keyOf(id);
        const w = key ? this.deskW(key) : 50;
        if (x > a.x - w / 2 && x < a.x + w / 2 && y > a.y - 70 && y < a.y) return id;
      }
      return null;
    }
    nearestSeat(x, y) {
      let best = null, bd = 48;
      for (const k of this.seatKeys()) {
        const [sx, sy] = this.spotOf(k);
        const d = Math.hypot(sx - x, sy - 20 - y);
        if (d < bd) { bd = d; best = k; }
      }
      const r = this.root.getBoundingClientRect();
      return best;
    }
    bindPointer() {
      const root = this.root;
      root.addEventListener('pointerdown', ev => {
        const chip = ev.target.closest && ev.target.closest('.bench-chip');
        const [x, y] = this.toLogical(ev);
        const id = chip ? chip.dataset.agent : this.hit(x, y);
        if (!id) return;
        this.drag = { id, x0: ev.clientX, y0: ev.clientY, x, y, live: false, fromBench: !!chip };
        root.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      });
      root.addEventListener('pointermove', ev => {
        const [x, y] = this.toLogical(ev);
        const r = this.cv.getBoundingClientRect();
        this.parallax = [((ev.clientX - r.left) / r.width - 0.5), ((ev.clientY - r.top) / r.height - 0.5)];
        if (this.drag) {
          const d = this.drag;
          if (!d.live && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) > 5) {
            d.live = true;
            this.hideCard();
            root.classList.add('dragging');
          }
          d.x = x; d.y = y;
          if (d.live) d.target = this.nearestSeat(x, y + 20) || (y > H - 24 ? 'bench' : null);
          return;
        }
        this.hover(this.hit(x, y), ev);
      });
      const up = ev => {
        const d = this.drag;
        if (!d) return;
        this.drag = null;
        root.classList.remove('dragging');
        if (d.live) { this.moveTo(d.id, d.target || this.keyOf(d.id) || 'bench'); return; }
        // 没拖动算点击：固定显示卡片
        if (!d.fromBench) this.hover(d.id, ev, true);
      };
      root.addEventListener('pointerup', up);
      root.addEventListener('pointercancel', up);
      root.addEventListener('pointerleave', () => { this.parallax = [0, 0]; if (!this.pinned) this.hideCard(); });
    }
    hover(id, ev, pin = false) {
      if (pin) this.pinned = this.pinned === id ? null : id;
      const show = this.pinned || id;
      if (!show || !this.cardsOn) { this.hideCard(); return; }
      this.cardFor = show;
      this.fillCard(show);
      const a = this.actors[show];
      const right = a.x > W * 0.6;
      this.hoverCard.setAttribute('style', `${pct(right ? a.x - 56 : a.x + 56, a.y - 64)};--c:${ROSTER[show].color}`);
      this.hoverCard.classList.toggle('left', right);
      this.hoverCard.classList.add('on');
    }
    hideCard() { this.hoverCard.classList.remove('on'); this.cardFor = null; this.pinned = null; }
    fillCard(id) {
      const a = this.actors[id], u = this.usage && this.usage.agents && this.usage.agents[id];
      const fmt = (M.Usage && M.Usage.format) || (n => String(n));
      const rows = [];
      const status = this.statusOf(id)[0];
      rows.push(['状态', status]);
      if (a.status.detail) rows.push(['连接', a.status.detail]);
      rows.push(['模型', (u && u.model) || (id === 'cursor' || id === 'deepseek' ? '还没接入' : '还没用过')]);
      if (u) {
        rows.push(['今天', `输出 ${fmt(u.today.output)} · 输入 ${fmt(u.today.input + u.today.cacheRead + u.today.cacheWrite)}`]);
        rows.push(['近 7 天', `输出 ${fmt(u.week.output)} · ${u.week.messages} 条消息`]);
      }
      if (id === 'claude') {
        const sub = this.usage && this.usage.agents && this.usage.agents.subagent;
        if (sub) rows.push(['子代理今天', `输出 ${fmt(sub.today.output)}`]);
      }
      const subs = (this.subs[id] || []).filter(s => s.task);
      if (subs.length) rows.push(['子代理', subs.map(s => s.task.title).join('、')]);
      const key = this.keyOf(id);
      this.hoverCard.innerHTML = `<header><b></b><small></small></header><dl></dl><footer>拖动换位置${key === 'main' ? '' : ' · 拖到主桌当指挥'}</footer>`;
      this.hoverCard.querySelector('b').textContent = ROSTER[id].name;
      this.hoverCard.querySelector('small').textContent = key === 'main' ? '指挥位' : key ? '工位' : '候场';
      const dl = this.hoverCard.querySelector('dl');
      for (const [k, v] of rows) {
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = v;
        dl.append(dt, dd);
      }
    }

    /* ---------- 状态文字 ---------- */
    waitingFor(id) {
      return this.waitingItems.filter(w => (w.agent || 'claude') === id);
    }
    statusOf(id) {
      const a = this.actors[id];
      const w = this.waitingFor(id);
      if (w.length) return [WAIT_LABEL[w[w.length - 1].kind] || '等你', 'busy'];
      if (!a.status.installed) return ['未安装', 'off'];
      if (a.badge && a.badge.until > this.now) return a.badge.ok ? ['完成', 'ok'] : ['出错', 'bad'];
      if (this.now < a.typingUntil) return ['派活中', 'busy'];
      if (a.pile) return [(ACT_LABEL[a.act] || '工作中') + (a.pile > 1 ? ` · 排队 ${a.pile}` : ''), 'busy'];
      if (a.act && this.now < a.actUntil) return [ACT_LABEL[a.act] || '工作中', 'busy'];
      if (!a.status.running) return ['挂机中', 'off'];
      return ['待命', ''];
    }
    refreshLabels() {
      for (const id of ORDER) {
        const a = this.actors[id], l = this.labels[id];
        const key = this.keyOf(id);
        if (!a.onStage) { l.style.display = 'none'; continue; }
        l.style.display = '';
        const [s, tone] = this.statusOf(id);
        this.setLabel(l, (key === 'main' ? '★ ' : '') + ROSTER[id].name, s, tone);
        l.setAttribute('style', pct(a.x, a.y + 3));
      }
      // 子代理标签
      const keep = new Set();
      for (const [owner, list] of Object.entries(this.subs)) {
        list.forEach((s, i) => {
          if (!s.task) return;
          const k = s.task.id;
          keep.add(k);
          let l = this.subLabels[k];
          if (!l) l = this.subLabels[k] = this.label('', 'small');
          const [x, y] = this.sidePos(owner, i);
          l.setAttribute('style', pct(x, y + 2));
          l.classList.toggle('on', this.subLabelsOn && !!s.arrivedAt);
          const st = s.badge ? (s.badge.ok ? '完成' : '出错') : ACT_LABEL[s.act] || '赶路中';
          this.setLabel(l, M.oneLine(s.task.title, 8), st, s.badge ? (s.badge.ok ? 'ok' : 'bad') : 'busy');
          l.title = `${s.task.subagentType}：${s.task.title}`;
        });
      }
      for (const k of Object.keys(this.subLabels)) if (!keep.has(k)) { this.subLabels[k].remove(); delete this.subLabels[k]; }
      if (this.cardFor && this.hoverCard.classList.contains('on')) this.fillCard(this.cardFor);
    }

    /* ---------- 气泡 ---------- */
    // 角色的手（发出粒子的地方）和收件处（粒子落下的地方）
    seatX(id) { const a = this.actors[id], k = this.keyOf(id); return a.x + this.fit[k === 'main' ? 'main' : 'seat'].dx * this.deskW(k || 'seat0'); }
    handPos(id) { const a = this.actors[id]; return a.onStage ? [this.seatX(id) + 6, a.y - 40] : this.spots().tray; }
    inboxPos(id) { const a = this.actors[id]; return a.onStage ? [this.seatX(id) - 8, a.y - 36] : this.spots().tray; }
    async typeBubble(id, text) {
      if (this.waitingFor(id).length) return;
      const a = this.actors[id];
      const b = this.bubble;
      // 不在场时气泡冒在候场区上方
      const [bx, by] = a.onStage && a.x > 0 ? [this.seatX(id), a.y - 58] : [60, H - 26];
      b.setAttribute('style', pct(bx, by));
      b.textContent = '';
      b.classList.add('on');
      const chars = [...text];
      const step = reduced ? 0 : Math.max(28, Math.min(70, 700 / chars.length));
      for (const ch of chars) { if (this.waitingFor(id).length) break; b.textContent += ch; if (step) await sleep(step); }
      await sleep(reduced ? 200 : 260);
      b.classList.remove('on');
    }
    say(text, ms = 2600) {
      if (this.waitingItems.length) return;
      const b = this.mkBubble;
      b.setAttribute('style', pct(this.meerkat.x, this.meerkat.y - 52));
      b.textContent = text;
      b.classList.add('on');
      clearTimeout(this.sayT);
      this.sayT = setTimeout(() => b.classList.remove('on'), ms);
    }

    /* ---------- 来自 store 的事件 ---------- */
    setAgents(st) {
      for (const id of ORDER) if (st[id]) this.actors[id].status = st[id];
      this.refreshLabels();
    }
    heard() { const c = this.actors.claude; c.status = { ...c.status, installed: true, running: true }; }
    setUsage(u) { this.usage = u; if (this.cardFor) this.fillCard(this.cardFor); }

    setWaiting(items) {
      const was = this.waitingItems.length > 0;
      this.waitingItems = items;
      if (items.length) {
        clearTimeout(this.sayT);
        const last = items[items.length - 1];
        const who = (last.agent || 'claude') === 'codex' ? 'Codex ' : '';
        this.mkBubble.setAttribute('style', pct(this.meerkat.x, this.meerkat.y - 52));
        this.mkBubble.textContent = who + (WAIT_LABEL[last.kind] || '在等你');
        this.mkBubble.classList.add('on');
        this.bubble.classList.remove('on');
      } else if (was) this.mkBubble.classList.remove('on');
      this.refreshLabels();
    }
    turnEnd() {
      const c = this.actors.claude;
      c.actUntil = 0; c.typingUntil = 0;
      this.meerkat.badge = { ok: true, until: this.now + 1400 };
      this.refreshLabels();
    }

    ownerOf(t) { return t.owner && ROSTER[t.owner] ? t.owner : 'claude'; }
    taskStart(t) {
      const v = { t, arrived: false, pendingEnd: false };
      this.vis.set(t.id, v);
      if (t.kind === 'subagent') {
        const owner = this.ownerOf(t);
        const list = (this.subs[owner] = this.subs[owner] || []);
        let i = list.findIndex(s => !s || !s.task);
        if (i < 0) i = list.length < SIDE.length ? list.length : list.reduce((b, s, k) => (s.arrivedAt < list[b].arrivedAt ? k : b), 0);
        list[i] = { task: t, act: null, arrivedAt: 0, leaving: 0, badge: null, shakeUntil: 0 };
        v.owner = owner; v.slot = i;
      }
      // 用户自己在 Codex 里开的对话：没人派活，直接开工
      if (t.kind === 'codex' && t.via === 'codex-app') { this.arrive(v); return; }
      const sender = t.kind === 'subagent' ? v.owner : 'claude';
      this.typeQueue = this.typeQueue.then(async () => {
        const s = this.actors[sender];
        s.typingUntil = this.now + 99999;
        this.refreshLabels();
        await this.typeBubble(sender, t.title);
        s.typingUntil = 0;
        this.launch(v, sender);
      });
    }
    launch(v, sender) {
      const t = v.t, from = this.handPos(sender);
      const to = t.kind === 'codex' ? this.inboxPos('codex') : this.sidePos(v.owner, v.slot, true);
      const route = [from, [(from[0] + to[0]) / 2, Math.min(from[1], to[1]) - 40], to];
      this.packet(route, { colors: COLORS.out, label: t.title, n: Math.min(7, 4 + Math.floor((t.prompt || '').length / 40)), dur: 1500 }).then(() => this.arrive(v));
    }
    arrive(v) {
      const t = v.t;
      v.arrived = true;
      if (t.kind === 'codex') {
        const a = this.actors.codex;
        a.recvAt = this.now; a.pile++; a.act = t.activity; a.badge = null;
        a.status = { ...a.status, running: true };
        if (!a.onStage) this.renderBench();
      } else {
        const s = this.subs[v.owner][v.slot];
        if (s && s.task === t) { s.arrivedAt = this.now; s.act = 'think'; }
      }
      this.refreshLabels();
      if (v.pendingEnd) this.end(v);
    }
    taskEnd(t) {
      const v = this.vis.get(t.id);
      if (!v) return;
      if (!v.arrived) { v.pendingEnd = true; return; }
      this.end(v);
    }
    end(v) {
      const t = v.t, ok = t.status === 'done';
      let route, colors, back = 'claude';
      if (t.kind === 'codex') {
        const a = this.actors.codex;
        a.pile = Math.max(0, a.pile - 1);
        a.badge = { ok, until: this.now + 1600 };
        if (!ok) { a.shakeUntil = this.now + 450; this.meerkat.shout = this.now + 1500; }
        if (!a.pile) { a.act = null; a.realAct = false; }
        if (!a.onStage) this.renderBench();
        if (t.via === 'codex-app') { this.vis.delete(t.id); this.refreshLabels(); return; }
        const from = this.inboxPos('codex'), to = this.inboxPos('claude');
        route = [from, [(from[0] + to[0]) / 2, Math.min(from[1], to[1]) - 30], to];
        colors = ok ? COLORS.back : COLORS.fail;
      } else {
        const list = this.subs[v.owner] || [];
        const s = list[v.slot];
        if (!s || s.task !== t) return;
        back = v.owner;
        s.badge = { ok, until: this.now + 1800 }; s.act = null;
        const from = this.sidePos(v.owner, v.slot, true);
        if (!ok) { s.shakeUntil = this.now + 450; this.smoke(from[0], from[1]); this.meerkat.shout = this.now + 1500; }
        const to = this.inboxPos(v.owner);
        route = [from, [(from[0] + to[0]) / 2, Math.min(from[1], to[1]) - 26], to];
        colors = ok ? COLORS.subBack : COLORS.fail;
        setTimeout(() => { if (s.task === t) s.leaving = this.now; }, 1500);
        setTimeout(() => { if (s.task === t) { s.task = null; s.badge = null; s.leaving = 0; this.refreshLabels(); } }, 2100);
      }
      this.refreshLabels();
      this.packet(route, { colors, label: M.oneLine(t.summary, 14), n: 4, dur: 1300, back: true }).then(() => {
        const c = this.actors[back];
        c.recvAt = this.now;
        c.badge = { ok, until: this.now + 1200 };
        if (!ok) c.shakeUntil = this.now + 400;
        this.vis.delete(t.id);
        this.refreshLabels();
      });
    }
    activity({ agent, activity }) {
      if (agent === 'claude') {
        const c = this.actors.claude;
        c.act = activity; c.actUntil = this.now + 2600;
      } else {
        for (const list of Object.values(this.subs)) {
          const s = list.find(x => x && x.task && x.task.id === agent);
          if (s && s.arrivedAt) s.act = activity;
        }
      }
      this.refreshLabels();
    }
    taskActivity(t) {
      if (t.kind !== 'codex') return;
      const v = this.vis.get(t.id);
      if (v && v.arrived) { const a = this.actors.codex; a.act = t.activity; a.realAct = true; this.refreshLabels(); }
    }
    activityEnd() { const c = this.actors.claude; c.actUntil = Math.min(c.actUntil, this.now + 500); }

    async detect(run) {
      const mk = this.meerkat;
      mk.alert = true;
      this.say('我看看谁在…', 1600);
      const ringT = setInterval(() => this.rings.push({ x: mk.x, y: mk.y - 30, t0: this.now }), 320);
      for (const id of ORDER) {
        if (!this.actors[id].onStage) continue;
        const to = [this.actors[id].x, this.actors[id].y - 52];
        this.packet([[mk.x, mk.y - 30], [(mk.x + to[0]) / 2, Math.min(mk.y, to[1]) - 30], to], { colors: COLORS.ping, n: 1, dur: 800, size: 2, hop: false });
      }
      let res;
      try { res = await Promise.all([run(), sleep(1100)]).then(r => r[0]); }
      finally { clearInterval(ringT); mk.alert = false; }
      if (!res) { this.say('检测失败，连不上 Meerkat 应用', 3200); return; }
      this.setAgents(res);
      const parts = [];
      for (const id of ORDER) {
        const s = res[id];
        if (!s) continue;
        const kind = !s.installed ? 'none' : s.running ? 'on' : 'off';
        const a = this.actors[id];
        if (a.onStage) this.markers.push({ x: Math.round(a.x), y: Math.round(a.y - 70), kind, t0: this.now });
        parts.push(`${ROSTER[id].name.replace(' Code', '')}${kind === 'on' ? '在线' : kind === 'off' ? '没打开' : '没装'}`);
      }
      this.say(parts.join('，'), 3600);
      return res;
    }

    /* ---------- 效果 ---------- */
    packet(route, { colors, label, n = 5, dur = 1400, size = 2, hop = true }) {
      if (reduced) dur = 350;
      return new Promise(res => {
        const p = { route, colors, n, dur, size, hop, t0: this.now, lag: 0.07, res, frame: 0 };
        if (label) { p.label = this.el('div', 'pkt'); p.label.textContent = label; }
        this.packets.push(p);
      });
    }
    smoke(x, y) { for (let i = 0; i < 6; i++) this.sparks.push({ x: x + (i % 3) - 1, y, vx: (Math.random() - 0.5) * 0.02, vy: -0.012 - Math.random() * 0.01, t0: this.now + i * 60, life: 900, col: '#8193a5' }); }
    puff(x, y) {
      if (reduced) return;
      for (let i = 0; i < 10; i++) this.sparks.push({ x: x + (i - 5) * 4, y: y - 1, vx: (i - 5) * 0.006, vy: -0.01 - Math.random() * 0.01, t0: this.now + i * 20, life: 700, col: '#8a7360' });
    }

    sidePos(owner, i, top = false) {
      const a = this.actors[owner];
      const key = this.keyOf(owner);
      const w = this.deskW(key || 'seat0');
      // 靠左的桌子先往右边摆，靠右的先往左边摆，免得小桌跑出画面
      const order = a.x < W * 0.3 ? [1, 2, 0] : a.x > W * 0.7 ? [0, 2, 1] : [0, 1, 2];
      let [fx, px, py] = SIDE[order[i]] || SIDE[0];
      if (order[i] === 2 && a.x < W * 0.3) { fx = -fx; px = -px; }
      const x = Math.max(16, Math.min(W - 16, a.x + fx * w + px));
      const y = Math.min(H - 4, a.y + py);
      return top ? [x, y - 22] : [x, y];
    }

    /* ---------- 绘制 ---------- */
    loop(now) {
      if (this.dead) return;
      this.now = now;
      const c = this.ctx;
      c.imageSmoothingEnabled = false;
      c.clearRect(0, 0, W, H);
      if (this.img) {
        for (const a of Object.values(this.actors)) this.stepMove(a);
        this.drawRoom(c);
        this.drawScene(c);
        this.drawPackets(c);
        this.drawSparks(c);
        this.drawRings(c);
        this.drawMarkers(c);
        this.drawDrag(c);
      }
      if (((now / 300) | 0) !== this.lastLbl) { this.lastLbl = (now / 300) | 0; this.refreshLabels(); }
      this.raf = requestAnimationFrame(this.loop);
    }
    f(ms) { return Math.floor(this.now / ms); }
    shakeX(a) { return a.shakeUntil > this.now ? (this.f(50) % 2 ? 1 : -1) : 0; }

    drawRoom(c) {
      const room = this.img.room;
      // 鼠标视差：背景最多挪 3 像素，前景不动，看起来更有纵深
      const px = reduced ? 0 : Math.round(this.parallax[0] * -3), py = reduced ? 0 : Math.round(this.parallax[1] * -2);
      if (room) c.drawImage(room, -4 + px, -3 + py, W + 8, H + 6);
      else { c.fillStyle = '#1d2b38'; c.fillRect(0, 0, W, H); }
      // 窗外星星闪
      c.fillStyle = 'rgba(255,255,255,.0)';
    }

    shadow(c, x, y, w) {
      c.fillStyle = 'rgba(8,12,17,.45)';
      const h = Math.max(2, Math.round(w / 9));
      c.fillRect(Math.round(x - w / 2 + 2), Math.round(y - h / 2), Math.round(w - 4), h);
      c.fillRect(Math.round(x - w / 2 + 5), Math.round(y - h / 2 - 1), Math.round(w - 10), h + 2);
    }

    // 所有有纵深的东西放进一个列表，按地板 y 从远到近画
    drawScene(c) {
      const items = [];
      for (const [k, d] of Object.entries(this.desks)) items.push({ y: d.y, draw: () => this.drawDesk(c, k, d) });
      // 坐着的角色排在自己桌子前面画（桌子挡住下半身），走路的排在桌子后面画
      for (const a of Object.values(this.actors)) if (a.onStage) items.push({ y: a.y + (a.from ? WALK_AHEAD + 1 : -0.5), draw: () => this.drawActor(c, a) });
      for (const [owner, list] of Object.entries(this.subs)) list.forEach((s, i) => {
        if (!s || !s.task) return;
        const [x, y] = this.sidePos(owner, i);
        items.push({ y, draw: () => this.drawSub(c, owner, s, x, y) });
      });
      const mk = this.meerkat;
      items.push({ y: mk.y, draw: () => this.drawMeerkat(c) });
      const lamp = this.img.lamp, plant = this.img.plant;
      if (lamp) items.push({ y: 112, draw: () => { this.shadow(c, 26, 112, 18); c.drawImage(lamp, 26 - (lamp.width >> 1), 112 - lamp.height); } });
      if (plant) items.push({ y: 110, draw: () => { this.shadow(c, W - 22, 110, 16); c.drawImage(plant, W - 22 - (plant.width >> 1), 110 - plant.height); } });
      items.sort((a, b) => a.y - b.y).forEach(i => i.draw());
    }

    deskRise(d) {
      if (d.leaveAt) { const t = Math.min(1, (this.now - d.leaveAt) / 450); return { off: Math.round(t * 18), alpha: 1 - t, gone: t >= 1 }; }
      const t = Math.min(1, (this.now - d.appearAt) / 500);
      return { off: Math.round((1 - ease(t)) * 18), alpha: Math.min(1, t * 2), gone: false };
    }
    drawDesk(c, key, d) {
      const r = this.deskRise(d);
      if (r.gone) { delete this.desks[key]; return; }
      const im = this.img[key === 'main' ? 'desk-main' : 'desk'];
      if (!im) return;
      c.globalAlpha = r.alpha;
      this.shadow(c, d.x, d.y, im.width);
      c.save(); c.beginPath(); c.rect(0, 0, W, d.y + 1); c.clip();
      c.drawImage(im, Math.round(d.x - im.width / 2), Math.round(d.y - im.height + r.off));
      c.restore();
      // 拖拽时高亮目标桌子
      if (this.drag && this.drag.live && this.drag.target === key) {
        c.fillStyle = '#ffcf6b';
        const w = im.width, x0 = Math.round(d.x - w / 2), y0 = Math.round(d.y + 2);
        for (let i = 0; i < w; i += 3) c.fillRect(x0 + i, y0, 2, 1);
      }
      c.globalAlpha = 1;
    }

    frameOf(a) {
      const waiting = this.waitingFor(a.id).length > 0;
      const working = a.pile > 0 || this.now < a.typingUntil || (a.act && this.now < a.actUntil);
      if (!a.status.running && !waiting && !working) return 'sleep';
      if (working && !waiting) return 'work';
      return 'idle';
    }
    // 角色坐在桌子后面：画在桌子之前，下半身被桌子挡住
    drawActor(c, a) {
      if (this.drag && this.drag.live && this.drag.id === a.id) return;
      const frame = this.frameOf(a);
      const off = !a.status.running && frame !== 'work';
      // 干活时有第二帧就来回切，像在打字
      const name = frame === 'work' && this.img[`${a.id}-work2`] && this.f(160) % 2 ? `${a.id}-work2` : `${a.id}-${frame}`;
      const im = (off && this.greyImg[name]) || this.img[name] || this.img[`${a.id}-idle`];
      if (!im) return;
      const key = this.keyOf(a.id);
      const desk = this.img[key === 'main' ? 'desk-main' : 'desk'];
      const deskH = desk ? desk.height : 30;
      const waiting = this.waitingFor(a.id).length > 0;
      const pop = this.now - a.recvAt < 220 ? -2 : 0;
      const bob = frame === 'work' ? (this.img[`${a.id}-work2`] ? 0 : this.f(140) % 2 ? -1 : 0) : frame === 'idle' && this.f(900) % 2 ? 1 : 0;
      const wave = waiting && !reduced ? -Math.abs(Math.round(Math.sin(this.now / 160) * 3)) : 0;
      const walking = !!a.from;
      const fit = this.fit[key === 'main' ? 'main' : 'seat'];
      const deskW = desk ? desk.width : 60;
      // 走路时走在桌子前面、整个人露出来；到位后再坐回桌子后面
      const sitY = walking ? a.y + WALK_AHEAD : a.y - deskH * fit.sit;
      const cx = walking ? a.x : a.x + fit.dx * deskW;
      const x = Math.round(cx - im.width / 2 + this.shakeX(a));
      const y = Math.round(sitY - im.height + bob + pop + wave - (a.hop || 0));
      if (walking) this.shadow(c, a.x, a.y + WALK_AHEAD + 1, im.width * 0.8);
      c.drawImage(im, x, y);
      if (frame === 'sleep') this.drawZ(c, x + im.width - 4, y + 2);
      if (waiting) this.drawBang(c, x + im.width + 2, y - 2);
      this.drawBadge(c, a.badge, x + im.width - 6, y - 10);
      if (a.pile && !walking) this.drawCard(c, a.act, a.realAct, x - 14, y - 6, ROSTER[a.id].color);
      else if (a.act && this.now < a.actUntil && !walking) this.drawCard(c, a.act, true, x - 14, y - 6, ROSTER[a.id].color);
    }
    drawSub(c, owner, s, x, y) {
      const age = s.arrivedAt ? this.now - s.arrivedAt : 0;
      if (s.leaving && this.now - s.leaving > 500) return;
      const side = this.img['desk-side'];
      const frame = s.badge && s.badge.ok ? 'done' : s.act ? 'work' : 'idle';
      const im = this.tinted[`${owner}-${frame}`] || this.tinted[`${owner}-idle`];
      if (side) this.shadow(c, x, y, side.width);
      if (im && s.arrivedAt) {
        const rise = age < 240 ? Math.round(8 - (age / 240) * 8) : 0;
        const sink = s.leaving ? Math.round(((this.now - s.leaving) / 500) * 12) : 0;
        const deskH = side ? side.height : 14;
        const ix = Math.round(x + this.fit.side.dx * (side ? side.width : 30) - im.width / 2 + this.shakeX(s));
        const iy = Math.round(y - deskH * this.fit.side.sit - im.height + rise + sink + (s.act && this.f(300) % 2 ? -1 : 0));
        c.drawImage(im, ix, iy);
        this.drawBadge(c, s.badge, ix + im.width - 2, iy - 8);
        if (s.act && !s.badge) this.drawCard(c, s.act, true, ix - 12, iy - 4, '#ffcf6b');
      }
      if (side) c.drawImage(side, Math.round(x - side.width / 2), Math.round(y - side.height));
    }
    drawMeerkat(c) {
      const mk = this.meerkat;
      const crate = this.img.crate;
      const waiting = this.waitingItems.length > 0;
      let look = 0;
      const live = this.packets.filter(p => p.n > 1);
      if (live.length) {
        const p = live[live.length - 1];
        const [px] = bez(p.route, ease(Math.min(1, (this.now - p.t0) / p.dur)));
        look = px < mk.x - 18 ? -1 : px > mk.x + 18 ? 1 : 0;
      } else if (this.now > mk.lookUntil) {
        mk.look = [0, 0, -1, 0, 1][Math.floor(Math.random() * 5)];
        mk.lookUntil = this.now + 1400 + Math.random() * 2400;
      } else look = mk.look;
      if (mk.alert) look = [-1, 0, 1, 0][this.f(260) % 4];
      const frame = waiting || mk.alert || mk.shout > this.now ? 'alert' : look ? 'look' : 'idle';
      const im = this.img[`meerkat-${frame}`] || this.img['meerkat-idle'];
      let top = mk.y;
      if (crate) {
        this.shadow(c, mk.x, mk.y, crate.width);
        c.drawImage(crate, Math.round(mk.x - crate.width / 2), Math.round(mk.y - crate.height));
        top = mk.y - crate.height + 3;
      }
      if (!im) return;
      const hop = waiting && !reduced ? -(this.f(500) % 2) : mk.alert ? -1 : 0;
      const x = Math.round(mk.x - im.width / 2), y = Math.round(top - im.height + hop);
      // look 图是朝左的；朝右时镜像
      if (frame === 'look' && look > 0) {
        c.save(); c.translate(x + im.width, y); c.scale(-1, 1); c.drawImage(im, 0, 0); c.restore();
      } else c.drawImage(im, x, y);
      if (waiting) this.drawSign(c, x + im.width + 2, y + 2);
      else if (mk.shout > this.now) this.drawBang(c, x + im.width - 2, y - 6);
      this.drawBadge(c, mk.badge, x - 12, y + 4);
    }
    drawDrag(c) {
      const d = this.drag;
      if (!d || !d.live) return;
      const a = this.actors[d.id];
      const im = this.img[`${d.id}-idle`];
      if (!im) return;
      const x = Math.round(d.x - im.width / 2), y = Math.round(d.y - im.height - 6 + (this.f(200) % 2));
      this.shadow(c, d.x, d.y + 4, im.width);
      c.globalAlpha = 0.95;
      c.drawImage(im, x, y);
      c.globalAlpha = 1;
      void a;
    }

    /* ---------- 小部件 ---------- */
    drawZ(c, x, y) {
      const f = (this.now / 1600) % 1;
      const zy = Math.round(y - f * 8), zx = Math.round(x + f * 4);
      c.globalAlpha = 1 - f;
      c.fillStyle = '#8193a5';
      c.fillRect(zx, zy, 4, 1); c.fillRect(zx + 2, zy + 1, 1, 1); c.fillRect(zx + 1, zy + 2, 1, 1); c.fillRect(zx, zy + 3, 4, 1);
      c.globalAlpha = 1;
    }
    drawBang(c, x, y) {
      const yy = y + (reduced ? 0 : this.f(240) % 2);
      c.fillStyle = '#14202b'; c.fillRect(x - 1, yy - 1, 4, 11);
      c.fillStyle = '#ff6b5a'; c.fillRect(x, yy, 2, 6); c.fillRect(x, yy + 7, 2, 2);
    }
    drawSign(c, sx, y) {
      const sy = y + (reduced ? 0 : this.f(800) % 2);
      c.fillStyle = '#a8724e'; c.fillRect(sx + 4, sy + 10, 2, 10);
      c.fillStyle = '#14202b'; c.fillRect(sx - 1, sy - 1, 12, 14);
      c.fillStyle = '#ffcf6b'; c.fillRect(sx, sy, 10, 12);
      c.fillStyle = '#302c22'; c.fillRect(sx + 4, sy + 2, 2, 5); c.fillRect(sx + 4, sy + 9, 2, 2);
    }
    drawBadge(c, b, x, y) {
      if (!b || b.until < this.now) return;
      const pop = !reduced && b.until - this.now > 1100 ? -1 : 0;
      c.fillStyle = '#0e151d'; c.fillRect(x - 1, y - 1 + pop, 11, 10);
      c.fillStyle = b.ok ? '#7ff0c8' : '#ff6b5a';
      c.fillRect(x, y + pop, 9, 8);
      c.fillStyle = '#14202b';
      const d = (dx, dy) => c.fillRect(x + dx, y + dy + pop, 1, 1);
      if (b.ok) { d(2, 4); d(3, 5); d(4, 4); d(5, 3); d(6, 2); d(2, 3); d(3, 4); d(4, 5); }
      else for (let i = 0; i < 5; i++) { d(2 + i, 1 + i); d(6 - i, 1 + i); }
    }
    drawCard(c, act, real, x, y, col) {
      if (act === 'image' && !real) act = ['image', 'image', 'look', 'tool'][this.f(1100) % 4];
      x = Math.round(x); y = Math.round(y);
      c.fillStyle = col; c.fillRect(x, y, 15, 15);
      c.fillStyle = '#14202b'; c.fillRect(x + 1, y + 1, 13, 13);
      c.fillRect(x + 10, y + 15, 3, 1); c.fillStyle = col; c.fillRect(x + 12, y + 15, 1, 2);
      M.drawActIcon(c, act, x + 3, y + 3, col, this.f(150));
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
          // 粒子下面一个小影子，飞得越高影子越淡
          if (i === 0) { c.globalAlpha = 0.25; c.fillStyle = '#05080b'; c.fillRect(x - 1, Math.round(bez(p.route, t)[1]) + 10, 3, 1); c.globalAlpha = 1; }
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
        const rad = Math.round(6 + a * 44);
        c.globalAlpha = 1 - a;
        c.fillStyle = '#d9b382';
        for (let k = 0; k < 56; k++) {
          const th = (k / 56) * Math.PI * 2;
          c.fillRect(Math.round(r.x + Math.cos(th) * rad), Math.round(r.y + Math.sin(th) * rad * 0.6), 1, 1);
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
        c.fillStyle = m.kind === 'on' ? '#7ff0c8' : m.kind === 'off' ? '#8193a5' : '#ffcf6b';
        if (m.kind === 'on') { c.fillRect(m.x, y, 2, 5); c.fillRect(m.x, y + 6, 2, 2); }
        else if (m.kind === 'off') { c.fillRect(m.x - 1, y, 4, 1); c.fillRect(m.x + 1, y + 1, 1, 1); c.fillRect(m.x, y + 2, 1, 1); c.fillRect(m.x - 1, y + 3, 4, 1); }
        else { c.fillRect(m.x - 1, y, 3, 1); c.fillRect(m.x + 2, y + 1, 1, 2); c.fillRect(m.x, y + 3, 2, 1); c.fillRect(m.x, y + 6, 2, 2); }
        c.globalAlpha = 1;
        return true;
      });
    }
  }

  M.Studio = Studio;
  M.STUDIO_ROSTER = ROSTER;
})();
