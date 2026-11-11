// 鸽舍主题的像素美术：鸽子、鸽舍、栖木、天空和屋顶全用代码一格一格画。
// 每格 1 个逻辑像素，场景整体按整数倍放大，所以放大不糊。
(function () {
  const M = (window.Pigeon = window.Pigeon || {});

  /* ---------- 调色板：黄昏到入夜，鸽子灰蓝，重点用一种红 ---------- */
  const C = {
    ink: '#16142a',
    sky: ['#14142e', '#1a1a3a', '#222149', '#2d2955', '#3b3160', '#4f3866', '#683f6b', '#854769', '#a35267', '#c26264', '#dc7c62'],
    sun: '#f4ad66', sunHi: '#ffd593',
    star: '#d8d2f4', starDim: '#6a65a0',
    cloud: '#4a3666', cloudHi: '#7c4e74', cloudLo: '#33284f',
    far: '#2a2343', farHi: '#352b50', farRim: '#7c4866',
    win: '#f2c46b', winDim: '#8f6248',
    mid: '#211a34', midHi: '#2c2342', midRim: '#a3546a',
    roof: '#261e32', roofTile: '#2f253c', roofHi: '#3d3049', roofRim: '#d0675f',
    wood: '#555c78', woodDk: '#434962', woodLt: '#6b7390', trim: '#d9cfc2', trimDk: '#9e9390',
    loftRoof: '#3a2b43', loftRoofHi: '#4e3a56', hole: '#120f24', glow: '#f2c46b', glowDk: '#a8743c',
    perch: '#76574f', perchDk: '#4a3640', perchRim: '#de8a72',
    red: '#d8402f', redDk: '#952a26', redHi: '#ff7d66',
    cream: '#f3e6cf', creamDk: '#c9b796',
    mint: '#8fd9bf', gold: '#f2c46b', mute: '#8a84a8', dim: '#4c4670',
  };

  /* ---------- 品种：每个 agent 一种配色，加一点小特征 ---------- */
  const COMMON = { e: '#f0a14a', c: '#ece5da', k: '#3a3246', f: '#d0666a', z: '#2a2638' };
  const BREEDS = {
    // Claude Code：铜翅鸽，胸口和翅斑带锈橙
    claude: { H: '#b3a4a0', B: '#a4908b', D: '#76615f', L: '#d6c3b8', N: '#c96e47', n: '#e38c5b', W: '#977c76', w: '#c45a37', X: '#553d46', T: '#86716e', t: '#46333e' },
    // Codex：白鸽，颈羽薄荷绿
    codex: { H: '#e6e9ee', B: '#dce1e7', D: '#a2a9b8', L: '#ffffff', N: '#7fe0c0', n: '#58bfa5', W: '#cdd4dd', w: '#96a2b3', X: '#737d8f', T: '#c4cad5', t: '#656e80' },
    // Cursor：炭灰鸽，银色翅斑
    cursor: { H: '#575c6c', B: '#4d5263', D: '#353848', L: '#6e748a', N: '#8f9bc0', n: '#6a7aa2', W: '#4a4f61', w: '#c3cad8', X: '#25273a', T: '#424657', t: '#1d1f2f' },
    // DeepSeek：蓝鸽，头顶一撮冠羽
    deepseek: { H: '#7d93d8', B: '#6e85cf', D: '#4a5ea8', L: '#a9b9ee', N: '#9fd4ff', n: '#5fa8e8', W: '#687ec6', w: '#394b97', X: '#2d3977', T: '#5b6fb7', t: '#27316a' },
    // 信鸽：经典的蓝灰岩鸽，两道黑翅斑
    post: { H: '#7d889e', B: '#8c99ae', D: '#5d6981', L: '#b7c1cf', N: '#5b9a89', n: '#8a69a0', W: '#98a4b8', w: '#3c4457', X: '#383d51', T: '#78839a', t: '#2c3041' },
  };
  const CREST = { deepseek: true };

  /* ---------- 造型：朝右站着、睡着、张翅、飞行四帧，小鸽和远处的小点 ---------- */
  const STAND = [
    '............HHH...',
    '...........HHHHH..',
    '...........HHHeHck',
    '...........HHHHH..',
    '............NNNn..',
    '...........nNNNNL.',
    '.......BBBBnNNNLL.',
    '....WWWWWWWBBBLLL.',
    '..XXWwwWWWwwWBBLL.',
    '.TXXWWWWWWWWBBBLD.',
    'TTtXXWWWWWBBBBDD..',
    'tt...DDDDDDDDD....',
    '........DDDDD.....',
    '.........f..f.....',
    '........ff.ff.....',
  ];
  // 低头点一下（走路时鸽子特有的点头）
  const PECK = [
    '..................',
    '.............HHH..',
    '............HHHHH.',
    '............HHHeHck',
    '............HHHHH.',
    '...........nNNNn..',
    '.......BBBBnNNNLL.',
    ...STAND.slice(7),
  ];
  const BLINK = STAND.map(r => r.replace('e', 'z'));
  // 缩着脖子睡觉，身子蓬起来
  const SLEEP = [
    '..................',
    '..................',
    '..................',
    '..................',
    '..................',
    '..........HHHH....',
    '.........HHHHHH...',
    '.........HHHzHHck.',
    '.......BBNNNNnnL..',
    '....WWWWWBBNNnLLL.',
    '..XXWwwWWWwwWBBLL.',
    '.TXXWWWWWWWWBBBLD.',
    'TTtXXWWWWWBBBBDDD.',
    'tt..DDDDDDDDDDD...',
    '......DDDDDDDD....',
  ];
  // 张开翅膀：起飞前一刻和落地那一刻
  const FLARE = [
    '..XX........HHH...',
    '..XWW......HHHHH..',
    '...XWWW....HHHeHck',
    '....XWwWW..HHHHH..',
    '.....XWwWW..NNNn..',
    '......XWWWWnNNNNL.',
    '.......WWWWnNNNLL.',
    '....TTBBBBBBBBLLL.',
    '...TTBBBBBBBBBLLB.',
    '..TTtBBBBBBBBBBLD.',
    '..tt..DDDDDDDDDD..',
    '......DDDDDDDDD...',
    '.......DDDDDD.....',
    '........f...f.....',
    '.......ff..ff.....',
  ];
  // 飞行：身子一份，翅膀四帧叠上去
  const FLY_BODY = {
    5: '................HHH...',
    6: '...............HHHeHck',
    7: '..............NNHHHH..',
    8: '......BBBBBBBBNNNNL...',
    9: '..TTTTBBBBBBBBLLLLL...',
    10: 'TtTTDDDDDDDDDDLL......',
    11: '.......DDDDDDDD.......',
  };
  const WINGS = [
    { // 翅膀举到最高
      0: '.....XX...............',
      1: '.....XWW..............',
      2: '....XXWWW.............',
      3: '....XWWwWW............',
      4: '.....XWWwWW...........',
      5: '......XWWwWW..........',
      6: '.......XWWWWW.........',
      7: '........WWWWW.........',
    },
    { // 往后平展
      6: '...XXXWWW.............',
      7: '..XXWWWWwWWW..........',
      8: '....XXWWwwWWWW........',
    },
    { // 压到最低
      9: '........WWWWW.........',
      10: '.......WWwWWW.........',
      11: '......XWWwWW..........',
      12: '.....XWWwWW...........',
      13: '....XXWWW.............',
      14: '....XWW...............',
      15: '.....X................',
    },
    { // 收回来滑翔
      8: '.......WWWWWW.........',
      9: '.....XWWwwWWW.........',
      10: '...XXWWWWW............',
    },
  ];
  function flyFrame(wing) {
    const rows = [];
    for (let y = 0; y < 16; y++) {
      const body = FLY_BODY[y] || '......................';
      const w = wing[y];
      rows.push(w ? [...body].map((ch, i) => (w[i] && w[i] !== '.' ? w[i] : ch)).join('') : body);
    }
    return rows;
  }
  const FLY = WINGS.map(flyFrame);

  // 子代理：小一号的雏鸽
  const SQUAB = [
    '......HHH..',
    '.....HHeHck',
    '.....HHHH..',
    '.....NNNL..',
    '..WWWWBBLL.',
    '.TWwwWBBBL.',
    'TtXWWWDDDD.',
    '...DDDDDD..',
    '....f..f...',
  ];
  const SQUAB_FLY = [
    [
      '...XX........',
      '...XWW.......',
      '....XWW..HH..',
      '.....XWWHHeck',
      '..TTBBBBNNL..',
      'TtTDDDDDDLL..',
      '....DDDDD....',
      '.............',
    ],
    [
      '.............',
      '.............',
      '.........HH..',
      '........HHeck',
      '..TTBBWWWNL..',
      'TtTDDXWwWLL..',
      '....XWWD.....',
      '....XW.......',
    ],
  ];
  // 远处屋顶上的小鸽子：飞两帧、站一帧
  const TINY_FLY = [
    ['.X.....', '.XW..Hk', 'TBBBBH.', '..DD...'],
    ['.......', '.....Hk', 'TBBBBH.', '.XWD...'],
  ];
  const TINY_STAND = ['....H.', '...HHk', '.BBBN.', 'TBBBD.', '..f...'];

  /* ---------- 画网格 ---------- */
  function hex(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function toHex([r, g, b]) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
  function greyOf(h) {
    const [r, g, b] = hex(h);
    const l = (r * 0.3 + g * 0.59 + b * 0.11) * 0.55 + 26;
    return toHex([l, l + 3, l + 14]);
  }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function grid(rows, pal) {
    const w = Math.max(...rows.map(r => r.length));
    const c = canvas(w, rows.length);
    const x = c.getContext('2d');
    rows.forEach((row, y) => [...row].forEach((ch, i) => {
      const col = pal[ch];
      if (ch === '.' || !col) return;
      x.fillStyle = col; x.fillRect(i, y, 1, 1);
    }));
    return c;
  }
  // 只在透明的一侧描 1 像素深色边，和天空分得开
  function outline(src, col = C.ink) {
    const w = src.width, h = src.height;
    const c = canvas(w + 2, h + 2);
    const x = c.getContext('2d');
    const a = src.getContext('2d').getImageData(0, 0, w, h).data;
    const on = (i, j) => i >= 0 && j >= 0 && i < w && j < h && a[(j * w + i) * 4 + 3] > 0;
    x.fillStyle = col;
    for (let j = -1; j <= h; j++) for (let i = -1; i <= w; i++) {
      if (on(i, j)) continue;
      if (on(i - 1, j) || on(i + 1, j) || on(i, j - 1) || on(i, j + 1)) x.fillRect(i + 1, j + 1, 1, 1);
    }
    x.drawImage(src, 1, 1);
    return c;
  }
  function flip(src) {
    const c = canvas(src.width, src.height);
    const x = c.getContext('2d');
    x.translate(src.width, 0); x.scale(-1, 1); x.drawImage(src, 0, 0);
    return c;
  }
  // 最近邻缩小，给半远处的飞行用
  function shrink(src, k) {
    const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
    const c = canvas(w, h);
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    x.drawImage(src, 0, 0, w, h);
    return c;
  }
  // 精灵：画布 + 锚点（站立是脚底中点，飞行是身体中心），以及朝左的镜像
  function sprite(rows, pal, ax, ay, scale) {
    let c = grid(rows, pal);
    if (scale) c = shrink(c, scale);
    c = outline(c);
    const s = scale || 1;
    const AX = 1 + Math.round(ax * s), AY = 1 + Math.round(ay * s);
    return { c, f: flip(c), ax: AX, ay: AY, w: c.width, h: c.height };
  }

  const cache = new Map();
  function breed(id, grey = false) {
    const key = id + (grey ? ':g' : '');
    if (cache.has(key)) return cache.get(key);
    const base = { ...COMMON, ...(BREEDS[id] || BREEDS.post) };
    const pal = grey ? Object.fromEntries(Object.entries(base).map(([k, v]) => [k, greyOf(v)])) : base;
    const crest = CREST[id];
    const withCrest = rows => {
      if (!crest) return rows;
      // 冠羽：头顶往后翘两格
      const out = rows.slice();
      const top = out.findIndex(r => r.includes('H'));
      if (top < 1) return out;
      const i = out[top].indexOf('H');
      const put = (r, col, ch) => { const a = [...out[r].padEnd(col + 1, '.')]; a[col] = ch; out[r] = a.join(''); };
      put(top - 1, i, 'w'); put(top - 1, i + 1, 'w');
      if (top >= 2) put(top - 2, i - 1, 'w');
      return out;
    };
    const st = rows => sprite(withCrest(rows), pal, 10, rows.length);
    const fly = FLY.map(r => sprite(withCrest(r), pal, 11, 9));
    const out = {
      stand: st(STAND), peck: st(PECK), blink: st(BLINK), sleep: st(SLEEP), flare: st(FLARE),
      fly,
      flyMid: FLY.map(r => sprite(withCrest(r), pal, 11, 9, 0.6)),
      squab: sprite(SQUAB, pal, 5, SQUAB.length),
      squabFly: SQUAB_FLY.map(r => sprite(r, pal, 6, 4)),
      tiny: TINY_FLY.map(r => sprite(r, pal, 3, 2)),
      tinyStand: sprite(TINY_STAND, pal, 3, TINY_STAND.length),
    };
    cache.set(key, out);
    return out;
  }

  /* ---------- 场景 ---------- */
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const R = x => (px, py, w, h, col) => { if (w <= 0 || h <= 0) return; x.fillStyle = col; x.fillRect(Math.round(px), Math.round(py), Math.round(w), Math.round(h)); };

  // 天空：一条条色带，用 4×4 有序抖动过渡，保持硬边
  function sky(x, W, H) {
    const cols = C.sky.map(hex);
    const img = x.createImageData(W, H);
    const n = cols.length - 1;
    for (let y = 0; y < H; y++) {
      const t = Math.pow(y / Math.max(1, H - 1), 1.25) * n;
      const i = Math.floor(t), f = t - i;
      for (let px = 0; px < W; px++) {
        const th = (BAYER[(y & 3) * 4 + (px & 3)] + 0.5) / 16;
        const c = cols[Math.min(n, f > th ? i + 1 : i)];
        const o = (y * W + px) * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
  }
  // 一半落在远处楼后面的太阳，下半截切几道横纹
  function sun(x, cx, cy, r) {
    const rr = R(x);
    for (let dy = -r; dy <= r; dy++) {
      const hw = Math.round(Math.sqrt(r * r - dy * dy));
      const cut = dy > 0 && [2, 5, 7, 9, 11].includes(dy % 12);
      if (cut) continue;
      rr(cx - hw, cy + dy, hw * 2 + 1, 1, dy < -r * 0.35 ? C.sunHi : C.sun);
    }
  }
  function stars(W, H, seed = 7) {
    const r = rng(seed), out = [];
    const n = Math.round(W * H / 900);
    for (let i = 0; i < n; i++) out.push({ x: Math.floor(r() * W), y: Math.floor(Math.pow(r(), 1.7) * H), tw: r() < 0.25, ph: Math.floor(r() * 8) });
    return out;
  }
  // 远处的城市：一排楼顶，偶尔有天线、水塔、亮着的窗。spots 是远程鸽舍要站的楼
  function farCity(x, W, hy, spots, seed = 3) {
    const rr = R(x), r = rng(seed);
    rr(0, hy - 2, W, 3, C.farHi);
    let px = -6;
    const blocks = [];
    while (px < W + 6) {
      const w = 7 + Math.floor(r() * 16), h = 4 + Math.floor(r() * 20);
      blocks.push({ x: px, w, top: hy - h, far: true });
      px += w + (r() < 0.3 ? 2 : 0);
    }
    for (const s of spots) blocks.push({ x: s.x - 17, w: 34, top: s.y, spot: true });
    for (const b of blocks) {
      rr(b.x, b.top, b.w, hy + 14 - b.top, b.spot ? C.farHi : C.far);
      rr(b.x, b.top, b.w, 1, C.farRim);
      if (!b.spot) {
        if (r() < 0.18) { rr(b.x + 2, b.top - 5, 1, 5, C.far); rr(b.x + 2, b.top - 6, 1, 1, C.red); }
        else if (r() < 0.15 && b.w > 9) { rr(b.x + 3, b.top - 5, 6, 4, C.far); rr(b.x + 3, b.top - 5, 6, 1, C.farRim); rr(b.x + 4, b.top - 1, 1, 1, C.far); rr(b.x + 7, b.top - 1, 1, 1, C.far); }
      }
      for (let wy = b.top + 3; wy < hy + 10; wy += 3) for (let wx = b.x + 2; wx < b.x + b.w - 1; wx += 3) {
        const q = r();
        if (q < 0.07) rr(wx, wy, 1, 1, C.win); else if (q < 0.13) rr(wx, wy, 1, 1, C.winDim);
      }
    }
  }
  // 近一点的屋顶：人字顶、烟囱，顶边被夕阳描一道亮边
  function midCity(x, W, top, H, seed = 11) {
    const rr = R(x), r = rng(seed);
    let px = -4;
    while (px < W + 4) {
      const w = 18 + Math.floor(r() * 26), h = Math.floor(r() * 10);
      const y = top + h;
      const gable = r() < 0.5;
      if (gable) {
        const peak = Math.min(8, Math.floor(w / 3));
        for (let i = 0; i < peak; i++) { rr(px + peak - i, y - i, w - (peak - i) * 2, 1, C.mid); rr(px + peak - i, y - i, 1, 1, C.midRim); }
        rr(px + 1, y - peak, w - 2, 1, C.midRim);
      } else rr(px, y, w, 1, C.midRim);
      rr(px, y + 1, w, H - y, C.mid);
      if (r() < 0.5) { const cx = px + 4 + Math.floor(r() * (w - 10)); rr(cx, y - 7, 4, 7, C.midHi); rr(cx - 1, y - 8, 6, 1, C.midRim); }
      for (let wy = y + 4; wy < y + 22; wy += 5) for (let wx = px + 3; wx < px + w - 3; wx += 5) { const q = r(); if (q < 0.03) rr(wx, wy, 1, 2, C.win); else if (q < 0.08) rr(wx, wy, 1, 2, C.winDim); }
      rr(px + w - 1, y + 1, 1, H - y, C.midHi);
      px += w;
    }
  }
  // 本机所在的近处平顶：女儿墙、沥青面
  function nearRoof(x, W, y, H) {
    const rr = R(x);
    rr(0, y, W, H - y, C.roof);
    rr(0, y, W, 1, C.roofRim);
    rr(0, y + 1, W, 2, C.roofHi);
    for (let yy = y + 5; yy < H; yy += 3) for (let px = (yy % 2) * 4; px < W; px += 9) rr(px, yy, 3, 1, C.roofTile);
  }
  function cloud(w, seed) {
    const c = canvas(w, 10), x = c.getContext('2d'), rr = R(x), r = rng(seed);
    const bumps = [];
    for (let i = 0; i < Math.max(3, w / 9); i++) bumps.push([Math.floor(r() * (w - 12)) + 6, 2 + Math.floor(r() * 4), 4 + Math.floor(r() * 4)]);
    for (let y = 0; y < 10; y++) for (let px = 0; px < w; px++) {
      let inside = y >= 6 && y < 9 && px > 2 && px < w - 3;
      for (const [bx, by, br] of bumps) if (Math.hypot(px - bx, (y - by - br) * 1.4) < br) inside = true;
      if (!inside) continue;
      rr(px, y, 1, 1, y < 4 ? C.cloudHi : y > 7 ? C.cloudLo : C.cloud);
    }
    return c;
  }

  // 本机鸽舍：架在腿上的木箱，前面两排鸽洞，左下一扇小门，底下一块起降板
  function loft(x, L) {
    const rr = R(x);
    const { lx, lw: w, top, bottom, roofH, holes, door, board } = L;
    // 腿
    rr(lx + 4, bottom, 3, L.legs, C.woodDk); rr(lx + w - 7, bottom, 3, L.legs, C.woodDk);
    rr(lx + 4, bottom + 3, w - 8, 1, C.woodDk);
    // 箱体和竖板
    rr(lx, top, w, bottom - top, C.wood);
    for (let px = lx + 3; px < lx + w; px += 5) rr(px, top + 1, 1, bottom - top - 1, C.woodDk);
    rr(lx, top, 2, bottom - top, C.trim); rr(lx + w - 2, top, 2, bottom - top, C.trimDk);
    rr(lx, bottom - 2, w, 2, C.trimDk);
    rr(lx, top, w, 2, C.trim);
    // 屋顶（人字，右坡被夕阳照亮）
    const ov = 5, peakX = lx + Math.round(w / 2);
    for (let i = 0; i < roofH; i++) {
      const half = Math.round(((i + 1) / roofH) * (w / 2 + ov));
      const y = top - roofH + i;
      rr(peakX - half, y, half, 1, C.loftRoof);
      rr(peakX, y, half, 1, C.loftRoofHi);
      rr(peakX + half - 1, y, 1, 1, C.roofRim);
      if (i % 3 === 2) { rr(peakX - half + 2, y, half - 2, 1, C.ink + '55'); rr(peakX, y, half - 2, 1, C.loftRoof); }
    }
    rr(lx - ov, top - 1, w + ov * 2, 1, C.ink);
    // 鸽洞：拱顶小门洞，下沿一根小横木
    for (const h of holes) {
      rr(h.x, h.y + 2, h.w, h.h - 2, C.hole); rr(h.x + 1, h.y + 1, h.w - 2, 1, C.hole); rr(h.x + 2, h.y, h.w - 4, 1, C.hole);
      rr(h.x - 1, h.y + h.h, h.w + 2, 2, C.trim); rr(h.x - 1, h.y + h.h + 1, h.w + 2, 1, C.trimDk);
    }
    // 门：给"你"用的
    rr(door.x - 1, door.y - 1, door.w + 2, door.h + 1, C.trimDk);
    rr(door.x, door.y, door.w, door.h, C.perchDk);
    rr(door.x + 2, door.y + 2, door.w - 4, 4, C.glowDk);
    rr(door.x + door.w - 3, door.y + 9, 1, 2, C.gold);
    // 起降板，伸出箱体右边，有一根斜撑
    rr(board.x0, board.y, board.x1 - board.x0, 2, C.perch);
    rr(board.x0, board.y, board.x1 - board.x0, 1, C.perchRim);
    rr(board.x0, board.y + 2, board.x1 - board.x0, 1, C.perchDk);
    for (let i = 0; i < 9; i++) rr(lx + w + 1 + i, board.y + 3 + i, 2, 1, C.perchDk);
    // 屋檐下挂一盏灯（光在动态层画）
    rr(lx + 6, top - 1, 1, 4, C.ink);
  }
  // T 形栖木
  function perch(x, cx, topY, baseY, half) {
    const rr = R(x);
    rr(cx - 1, topY + 2, 3, baseY - topY - 2, C.perchDk);
    rr(cx, topY + 2, 1, baseY - topY - 2, C.perch);
    rr(cx - 4, baseY - 2, 9, 2, C.perchDk); rr(cx - 4, baseY - 2, 9, 1, C.perch);
    rr(cx - half, topY, half * 2 + 1, 3, C.perch);
    rr(cx - half, topY, half * 2 + 1, 1, C.perchRim);
    rr(cx - half, topY + 2, half * 2 + 1, 1, C.perchDk);
    rr(cx - half - 1, topY, 1, 3, C.perchDk); rr(cx + half + 1, topY, 1, 3, C.perchDk);
  }
  // 远处的小鸽舍，立在楼顶
  function remoteLoft(x, cx, y, online) {
    const rr = R(x);
    const body = online ? C.wood : C.dim, dark = online ? C.woodDk : '#3a3558', roof = online ? C.loftRoof : '#2c2744';
    rr(cx - 9, y - 4, 2, 4, dark); rr(cx + 7, y - 4, 2, 4, dark);
    rr(cx - 10, y - 15, 20, 11, body);
    rr(cx - 10, y - 15, 1, 11, online ? C.trim : C.mute);
    for (let i = 0; i < 6; i++) {
      const half = 2 + i * 2;
      rr(cx - half, y - 21 + i, half * 2, 1, roof);
      if (online) rr(cx + half - 1, y - 21 + i, 1, 1, C.roofRim);
    }
    const hole = online ? C.hole : '#24203c';
    rr(cx - 6, y - 12, 4, 5, hole); rr(cx + 2, y - 12, 4, 5, hole);
    rr(cx - 12, y - 6, 24, 2, online ? C.perch : '#3a3558');
    if (online) rr(cx - 12, y - 6, 24, 1, C.perchRim);
  }

  M.LoftArt = { C, breed, sky, sun, stars, farCity, midCity, nearRoof, cloud, loft, perch, remoteLoft, rng, greyOf };
})();
