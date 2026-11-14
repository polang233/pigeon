// 各家 agent 的像素形象：照着它们真实的标志画成 16×16 的像素画。
// 同一张网格既当界面里的小 logo（转成 SVG，任意大小都清楚），也当办公室里的角色（画进 canvas，配上动作帧）。
// 字符对应调色板，'.' 是透明。
(function () {
  const M = (window.Pigeon = window.Pigeon || {});

  const ART = {
    // Claude Code：橙色的小螃蟹 Clawd
    claude: {
      pal: { O: '#d97757', K: '#1f1410' },
      grid: [
        '................',
        '................',
        '................',
        '...OOOOOOOOOO...',
        '...OOOOOOOOOO...',
        '...OOKOOOOKOO...',
        '...OOKOOOOKOO...',
        '.OOOOOOOOOOOOOO.',
        '.OOOOOOOOOOOOOO.',
        '...OOOOOOOOOO...',
        '...OOOOOOOOOO...',
        '...O.O....O.O...',
        '...O.O....O.O...',
        '................',
        '................',
        '................',
      ],
    },
    // Codex：蓝紫色的圆团，中间一个终端提示符 >_
    codex: {
      pal: { a: '#9cc0ff', b: '#7b93ff', v: '#8c6cf6', W: '#ffffff' },
      grid: [
        '................',
        '.....aaaaaa.....',
        '...aaaaaaaaaa...',
        '..aaaaaaaaaaaa..',
        '.abbbbbbbbbbbba.',
        '.bbWWbbbbbbbbbb.',
        'bbbbWWbbbbbbbbbb',
        'bbbbbWWbbbbbbbbb',
        'bbbbWWbbbbbbbbbb',
        'vbbWWbbbWWWWbbbv',
        '.vvvvvvvvvvvvvv.',
        '.vvvvvvvvvvvvvv.',
        '..vvvvvvvvvvvv..',
        '...vvvvvvvvvv...',
        '.....vvvvvv.....',
        '................',
      ],
    },
    // Cursor：实心的六边形立方体，中间挖空一块向下的三角。单色，颜色跟着明暗走
    cursor: {
      pal: { K: 'currentColor', W: '#ffffff' },
      grid: [
        '.......KK.......',
        '.....KKKKKK.....',
        '...KKKKKKKKKK...',
        '.KKKKKKKKKKKKKK.',
        '.KK..........KK.',
        '.KKKK........KK.',
        '.KKKKKK......KK.',
        '.KKKKKKK....KKK.',
        '.KKKKKKK....KKK.',
        '.KKKKKKK...KKKK.',
        '.KKKKKKK...KKKK.',
        '.KKKKKKK..KKKKK.',
        '.KKKKKKK.KKKKKK.',
        '...KKKKK.KKKK...',
        '.....KKKKKK.....',
        '.......KK.......',
      ],
    },
    // DeepSeek：蓝色的鲸鱼，尾巴往上翘
    dsh: {
      pal: { B: '#4d6bfe', L: '#a9b8ff', W: '#ffffff', S: '#9fd4ff' },
      grid: [
        '................',
        '................',
        '...........B..B.',
        '...........BBBB.',
        '............BB..',
        '....BBBBBB..BB..',
        '..BBBBBBBBBBBB..',
        '.BBBBBBBBBBBBB..',
        '.BWBBBBBBBBBBB..',
        '.BBBBBBBBBBBB...',
        '.LLLLLBBBBBBB...',
        '..LLLLLLBBBB....',
        '....LLLLL.......',
        '................',
        '................',
        '................',
      ],
    },
  };

  // 角色的动作帧：在原图上改几个像素
  const set = (g, pts, ch) => { const r = g.map(s => s.split('')); for (const [y, x] of pts) if (r[y]) r[y][x] = ch; return r.map(s => s.join('')); };
  const FRAMES = {
    // 闭眼：眼睛只剩一行
    claude: { blink: g => set(g, [[5, 5], [5, 10]], 'O'), alt: g => set(set(g, [[7, 1], [7, 14]], '.'), [[6, 1], [6, 2], [6, 13], [6, 14]], 'O') },
    // 光标闪：下划线消失
    codex: { blink: g => set(g, [[9, 8], [9, 9], [9, 10], [9, 11]], 'b'), alt: g => set(g, [[9, 8], [9, 9], [9, 10], [9, 11]], 'b') },
    // 立方体侧面加一双眼睛
    cursor: { base: g => set(g, [[9, 3], [9, 5]], 'W'), blink: g => g, alt: g => set(g, [[10, 3], [10, 5]], 'W') },
    // 鲸鱼喷水
    dsh: { blink: g => set(g, [[8, 2]], 'B'), alt: g => set(g, [[4, 5], [3, 5], [2, 4], [2, 6]], 'S') },
  };
  function frame(a, kind) {
    const A = ART[a]; if (!A) return null;
    if (kind === 'logo') return A.grid;
    const F = FRAMES[a] || {}, base = F.base ? F.base(A.grid) : A.grid;
    return kind === 'blink' && F.blink ? F.blink(base) : kind === 'alt' && F.alt ? F.alt(base) : base;
  }

  // 网格转成 SVG：同色的横向像素合并成一个矩形
  const cache = {};
  function svg(a, cls = '') {
    const key = a + '|' + cls;
    if (cache[key]) return cache[key];
    const A = ART[a]; if (!A) return '';
    const g = frame(a, 'logo'), w = g[0].length;
    let out = '';
    g.forEach((row, y) => {
      for (let x = 0; x < row.length;) {
        const ch = row[x];
        if (ch === '.' || !A.pal[ch]) { x++; continue; }
        let e = x; while (e < row.length && row[e] === ch) e++;
        out += `<rect x="${x}" y="${y}" width="${e - x}" height="1" fill="${A.pal[ch]}"/>`;
        x = e;
      }
    });
    return (cache[key] = `<svg class="px ${cls}" viewBox="0 0 ${w} ${g.length}" shape-rendering="crispEdges" aria-hidden="true">${out}</svg>`);
  }

  function grey(hex) {
    if (hex[0] !== '#') return hex;
    const n = parseInt(hex.slice(1), 16);
    const l = Math.round(((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) * 0.5 + 34);
    return `rgb(${l},${l + 3},${l + 10})`;
  }
  function draw(x, a, grid, ox, oy, opts = {}) {
    const pal = ART[a].pal;
    grid.forEach((row, y) => { for (let i = 0; i < row.length; i++) { const ch = row[i]; if (ch === '.' || !pal[ch]) continue; const col = pal[ch] === 'currentColor' ? '#e9e6df' : pal[ch]; x.fillStyle = opts.grey ? grey(col) : col; x.fillRect(ox + i, oy + y, 1, 1); } });
  }

  // 气泡里的小字
  const GLY = {
    wait: ['.#.', '.#.', '.#.', '...', '.#.'],
    done: ['...', '..#', '#.#', '.#.', '...'],
    idle: ['###', '..#', '.#.', '#..', '###'],
  };
  const THEME = { run: '#ffcf6b', wait: '#ff7b6e', done: '#6fdc9c', idle: '#8b90a0' };

  // 办公室里的一个工位：显示器、桌子、坐在桌后的角色、头顶的气泡。n 是动画的第几帧。
  const STATION = { w: 40, h: 34 };
  function station(c, a, state, n, scale) {
    const { w: W, h: H } = STATION;
    if (c.width !== W) { c.width = W; c.height = H; }
    c.style.width = W * scale + 'px'; c.style.height = H * scale + 'px';
    const x = c.getContext('2d'); x.clearRect(0, 0, W, H);
    const r = (px, py, w, h, col) => { x.fillStyle = col; x.fillRect(px, py, w, h); };
    // 椅背
    r(20, 15, 12, 9, '#2b3040'); r(21, 16, 10, 7, '#363c50');
    // 角色
    const kind = state === 'idle' ? 'blink' : state === 'run' ? (n % 2 ? 'alt' : 'base') : state === 'done' && n % 4 === 0 ? 'blink' : 'base';
    const bob = state === 'run' && n % 2 ? -1 : 0;
    if (ART[a]) draw(x, a, frame(a, kind), 18, 12 + bob, { grey: state === 'idle' });
    // 显示器
    r(2, 13, 14, 10, '#161a24'); r(8, 23, 3, 1, '#161a24');
    const scr = state === 'idle' ? '#1d2230' : state === 'wait' ? (n % 2 ? '#5a2a26' : '#2a1d22') : '#1d2a3a';
    r(3, 14, 12, 8, scr);
    if (state === 'run') for (let i = 0; i < 4; i++) r(4, 15 + i * 2, 2 + ((n * 3 + i * 5) % 8), 1, i % 2 ? '#7ff0c8' : '#9cc0ff');
    if (state === 'done') { r(5, 18, 2, 1, '#6fdc9c'); r(7, 19, 2, 1, '#6fdc9c'); r(9, 17, 2, 1, '#6fdc9c'); r(11, 16, 2, 1, '#6fdc9c'); }
    if (state === 'wait') r(8, 15, 2, 4, '#ff7b6e'), r(8, 20, 2, 1, '#ff7b6e');
    // 桌子
    r(0, 24, 40, 3, '#b98a5e'); r(0, 24, 40, 1, '#d4a674'); r(0, 27, 40, 1, '#7d5537');
    r(2, 28, 3, 6, '#6e4a30'); r(35, 28, 3, 6, '#6e4a30');
    r(34, 21, 3, 3, '#e8e2d6'); r(37, 22, 1, 1, '#e8e2d6'); // 杯子
    // 气泡
    // 等你的时候气泡一闪一闪，其他状态一直亮着
    if (state !== 'wait' || n % 2 === 0) {
      r(30, 2, 9, 8, '#f4f1ea'); r(31, 1, 7, 1, '#f4f1ea'); r(30, 10, 2, 1, '#f4f1ea'); r(29, 11, 1, 1, '#f4f1ea');
      x.fillStyle = THEME[state];
      if (state === 'run') { for (let i = 0; i <= n % 3; i++) x.fillRect(31 + i * 3, 6, 2, 1); }
      else GLY[state].forEach((row, y) => [...row].forEach((ch, i) => { if (ch === '#') x.fillRect(33 + i, 3 + y, 1, 1); }));
    }
  }

  // 简洁样式里的形象：logo 本身动起来，加上表情和小道具。n 是第几帧（每帧 160 毫秒）。
  //   在干活：Claude 敲键盘，Codex 往外冒代码，Cursor 旁边一个小指针在点，DeepSeek 一边游一边喷水；眼睛往下看
  //   等你：瞪大眼睛，一跳一跳，头顶一个感叹号
  //   空闲：闭眼，冒 z
  //   刚完成：眯眼笑，两颗小星星一闪一闪
  const FACE = {
    claude: { eyes: [[5, 4], [5, 11]], ink: '#1f1410', strip: g => set(g, [[5, 4], [6, 4], [5, 11], [6, 11]], 'O') },
    codex: { eyes: [[6, 4], [6, 10]], ink: '#ffffff', strip: g => g.map(r => r.replace(/W/g, 'b')) },
    cursor: { eyes: [[9, 3], [9, 5]], ink: 'hole', strip: g => g },
    dsh: { eyes: [[8, 2]], ink: '#ffffff', strip: g => set(g, [[8, 2]], 'B') },
  };
  const AV = { w: 24, h: 22, ox: 4, oy: 2 };
  const ARROW = ['#....', '##...', '#w#..', '#ww#.', '#www#', '#w##.', '##...'];
  const ZED = ['###', '.#.', '###'];
  function avatar(c, a, state, n, scale, cur) {
    const A = ART[a], F = FACE[a]; if (!A || !F) return;
    if (c.width !== AV.w) { c.width = AV.w; c.height = AV.h; }
    c.style.width = AV.w * scale + 'px'; c.style.height = AV.h * scale + 'px';
    const x = c.getContext('2d'); x.clearRect(0, 0, AV.w, AV.h); x.globalAlpha = 1;
    const r = (px, py, w, h, col) => { x.fillStyle = col; x.fillRect(px, py, w, h); };
    const pal = Object.assign({}, A.pal); if (pal.K === 'currentColor') pal.K = cur || '#e9e6df';
    let g = F.strip(A.grid);
    let ox = AV.ox, oy = AV.oy;
    if (state === 'wait' && n % 4 < 2) oy -= 1;
    if (a === 'dsh' && state === 'run' && n % 4 < 2) oy -= 1;
    // Claude 打字：两只手轮流按下去
    if (a === 'claude' && state === 'run') g = n % 2 ? set(set(g, [[7, 13], [7, 14]], '.'), [[9, 13], [9, 14], [10, 14]], 'O') : set(set(g, [[7, 1], [7, 2]], '.'), [[9, 1], [9, 2], [10, 1]], 'O');
    g.forEach((row, y) => { for (let i = 0; i < row.length; i++) { const col = pal[row[i]]; if (row[i] !== '.' && col) r(ox + i, oy + y, 1, 1, col); } });
    // 表情
    const px = (y, i) => F.ink === 'hole' ? x.clearRect(ox + i, oy + y, 1, 1) : r(ox + i, oy + y, 1, 1, F.ink);
    const kind = state === 'run' ? 'look' : state === 'idle' ? 'closed' : state === 'wait' ? 'wide' : state === 'done' ? 'happy' : 'open';
    if (a === 'codex' && state === 'run') {
      [[5, 3], [5, 4], [6, 4], [6, 5], [7, 5], [7, 6], [8, 4], [8, 5], [9, 3], [9, 4]].forEach(([y, i]) => px(y, i));
      if (n % 2 === 0) [8, 9, 10, 11].forEach(i => px(9, i));
    } else for (const [y, i] of F.eyes) {
      if (kind === 'open') { px(y, i); px(y + 1, i); }
      else if (kind === 'look') px(y + 1, i);
      else if (kind === 'closed') { px(y + 1, i - 1); px(y + 1, i); }
      else if (kind === 'wide') { px(y, i); px(y + 1, i); px(y, i + 1); px(y + 1, i + 1); }
      else if (kind === 'happy') { px(y + 1, i - 1); px(y, i); px(y + 1, i + 1); }
    }
    // 小道具
    if (state === 'run') {
      if (a === 'claude') { // 一块键盘，按下去的键亮一下
        r(2, 15, 20, 1, '#6b7282'); r(2, 16, 20, 3, '#2f333d'); r(2, 19, 20, 1, '#1d2027');
        for (let k = 0; k < 9; k++) { r(3 + k * 2, 16, 1, 1, '#7c8394'); r(4 + k * 2, 17, 1, 1, '#7c8394'); }
        const hit = (n * 5) % 9; r(3 + hit * 2, 16, 1, 1, '#ffffff'); r(4 + ((hit + 4) % 9) * 2, 17, 1, 1, '#ffd27a');
      } else if (a === 'codex') { // 右边一行行往上冒的代码
        for (let j = 0; j < 3; j++) { const y = 14 - ((n + j * 3) % 10); if (y < 1) continue; x.globalAlpha = Math.min(1, y / 6); r(20, y, 2 + (j % 2), 1, j % 2 ? '#7ff0c8' : '#9cc0ff'); }
        x.globalAlpha = 1;
      } else if (a === 'cursor') { // 一个小指针在旁边点来点去
        const spot = [[16, 12], [18, 15], [13, 15]][Math.floor(n / 2) % 3];
        if (n % 2) { r(spot[0] - 2, spot[1], 1, 1, '#ffd27a'); r(spot[0], spot[1] - 2, 1, 1, '#ffd27a'); r(spot[0] - 2, spot[1] - 2, 1, 1, '#ffd27a'); }
        ARROW.forEach((row, y) => [...row].forEach((ch, i) => { if (ch !== '.') r(spot[0] + i, spot[1] + y, 1, 1, ch === '#' ? '#1d1d1f' : '#ffffff'); }));
      } else if (a === 'dsh') { // 头顶喷水
        const h = n % 3, top = oy + 3 - h;
        r(ox + 5, top, 1, 3 + h, '#9fd4ff');
        if (h) { r(ox + 3, top - 1, 1, 1, '#9fd4ff'); r(ox + 7, top - 1, 1, 1, '#9fd4ff'); }
        if (h === 2) { r(ox + 2, top + 1, 1, 1, '#cfeaff'); r(ox + 8, top + 1, 1, 1, '#cfeaff'); }
      }
    } else if (state === 'idle') { // 冒 z
      const p = n % 8; x.globalAlpha = Math.max(0, 1 - p / 8);
      ZED.forEach((row, y) => [...row].forEach((ch, i) => { if (ch === '#') r(18 + i + (p > 4 ? 1 : 0), 6 - p + y, 1, 1, '#9aa3b8'); }));
      x.globalAlpha = 1;
    } else if (state === 'wait') { // 感叹号
      if (n % 2 === 0) { r(20, 0, 2, 4, '#ff7a68'); r(20, 5, 2, 1, '#ff7a68'); }
    } else if (state === 'done') { // 小星星
      const sp = (sx, sy, col) => { r(sx, sy - 1, 1, 3, col); r(sx - 1, sy, 3, 1, col); };
      sp(20, 3, n % 2 ? '#ffd27a' : '#fff3c4'); if (n % 2) sp(2, 5, '#ffd27a');
    }
  }

  // 送信的鸽子：朝右飞，两帧扇翅膀，脚下挂一封信。颜色跟着发信的那个 agent。
  const PIGEON_FLY = [[
    '...WW.......',
    '...WWW......',
    '....WWW..DD.',
    'DD..BBBBBDkY',
    '.DDBBBBBBBD.',
    '...BBBBBB...',
    '.....EEE....',
    '.....eee....',
  ], [
    '............',
    '............',
    '.........DD.',
    'DD..BBBBBDkY',
    '.DDBWWWBBBD.',
    '...WWWWBB...',
    '...WWEEE....',
    '.....eee....',
  ]];
  // 停着的鸽子：指挥头上那只
  const PIGEON_REST = [[
    '......DD..',
    '.....DDkY.',
    '.....nn...',
    '..BBBBBB..',
    'DBBWWWBBB.',
    'DDBWWWBB..',
    '..BBBBB...',
    '...Y..Y...',
  ], [
    '..........',
    '......DD..',
    '.....DDkY.',
    '..BBBnnB..',
    'DBBWWWBBB.',
    'DDBWWWBB..',
    '..BBBBB...',
    '...Y..Y...',
  ]];
  const mix = (hex, to, k) => { const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16); const c = i => Math.round(((a >> i) & 255) * (1 - k) + ((b >> i) & 255) * k); return '#' + [16, 8, 0].map(i => c(i).toString(16).padStart(2, '0')).join(''); };
  const sheets = {};
  // 返回一张横排的精灵图（每帧一格），用来做 CSS 背景动画
  function sheet(kind, color) {
    const key = kind + color;
    if (sheets[key]) return sheets[key];
    const frames = kind === 'rest' ? PIGEON_REST : PIGEON_FLY, w = frames[0][0].length, h = frames[0].length;
    const pal = { B: color, W: mix(color, '#ffffff', .45), D: mix(color, '#1a1714', .35), k: '#17140f', Y: '#f2b84b', E: '#fffaf0', e: '#c9b796', n: '#4fc3b0' };
    const c = document.createElement('canvas'); c.width = w * frames.length; c.height = h;
    const x = c.getContext('2d');
    frames.forEach((g, f) => g.forEach((row, y) => [...row].forEach((ch, i) => { if (pal[ch]) { x.fillStyle = pal[ch]; x.fillRect(f * w + i, y, 1, 1); } })));
    return (sheets[key] = { url: c.toDataURL(), w, h, n: frames.length });
  }

  // 送信的鸽子，画成会自己动的 SVG。画法照 clawd-tank：一格一个方块拼出身子，翅膀整块绕着肩膀转着扇。
  // 朝右飞，脖子一圈绿紫的光泽，嘴上一点白，脚下挂一封封了红蜡的信。身子用发信那个 agent 的颜色。
  // 四种：fly 沿线飞，hover 停在半路扑腾（等你确认），rest 停着、偶尔低头啄一下（指挥头上那只），far 远处飞过的鸽群（不挂信）。
  const PG_BODY = [
    '......................',
    '..............BBB.....',
    '.............BBBBBc...',
    '.............BBBkBYY..',
    '.............NNPBB....',
    'TT.........BBNPNBB....',
    'TTTT..BBBBBBBBBBBB....',
    'DTTTBBBBBBBBBBBBB.....',
    'DDTTBBBBBBBBBBBBB.....',
    '...DBBBBBBBBBBBB......',
    '.....LLLLLLLLLL.......',
    '......LLLLLLLL........',
  ];
  const PG_WING = [
    '......................',
    '......................',
    '......................',
    '......................',
    '......WWWWWW..........',
    '...WWWWWWWWWW.........',
    '.DDWbbbWbbbWW.........',
    'DDDWWWWWWWWW..........',
    '.DDDDWWWW.............',
  ];
  const PG_LETTER = [
    '.........F..F.........',
    '.......EEEEEEEE.......',
    '.......EeEEEEeE.......',
    '.......EEeSSeEe.......',
    '.......eeeeeeee.......',
  ];
  const PG_LEGS = [
    '.........F..F.........',
    '........FF.FF.........',
  ];
  // 一行里连着的同色格子并成一个方块
  const runs = (rows, pal, oy = 0) => rows.map((row, y) => {
    let out = '', i = 0;
    while (i < row.length) {
      const ch = row[i]; let j = i;
      while (j < row.length && row[j] === ch) j++;
      if (pal[ch]) out += `<rect x="${i}" y="${y + oy}" width="${j - i}" height="1" fill="${pal[ch]}"/>`;
      i = j;
    }
    return out;
  }).join('');
  const pigeons = {};
  function pigeon(color, kind = 'fly') {
    const key = kind + color;
    if (pigeons[key]) return pigeons[key];
    const dark = mix(color, '#1a1714', .42);
    const pal = { B: color, L: mix(color, '#ffffff', .5), W: mix(color, '#ffffff', .28), b: dark, D: dark, T: mix(color, '#1a1714', .18),
      N: '#4fc3b0', P: '#9a7bd0', k: '#17140f', Y: '#f2b84b', c: '#f6f1e7', F: '#e8918f', E: '#fffaf0', e: '#cbb894', S: '#d94a3d' };
    const rest = kind === 'rest', far = kind === 'far', beat = kind === 'hover' ? .18 : far ? .34 : .3;
    const head = runs(PG_BODY.slice(0, 5), pal), body = runs(PG_BODY.slice(5), pal, 5);
    const wing = runs(PG_WING, pal);
    const css = rest
      ? `.hd{transform-origin:13px 5px;animation:peck 4.2s infinite}@keyframes peck{0%,80%,100%{transform:none}84%,90%{transform:rotate(28deg) translate(.6px,.8px)}}`
      : `.bd{animation:bob ${beat}s ease-in-out infinite alternate}.wg{transform-origin:12px 6.5px;animation:flap ${beat}s ease-in-out infinite alternate}.lt{transform-origin:11px 12px;animation:swing ${beat * 2}s ease-in-out infinite alternate}
        @keyframes bob{to{transform:translateY(.7px)}}@keyframes flap{from{transform:rotate(44deg)}to{transform:rotate(-26deg)}}@keyframes swing{from{transform:rotate(-7deg)}to{transform:rotate(7deg)}}`;
    const [vx, vy, vw, vh] = rest ? [-1, 0, 23, 15] : far ? [-1, -5, 23, 17] : [-1, -5, 23, 22];
    const inner = rest
      ? `<g shape-rendering="crispEdges"><g class="hd">${head}</g>${body}${wing}${runs(PG_LEGS, pal, 12)}</g>`
      : `<g class="bd"><g shape-rendering="crispEdges">${far ? '' : `<g class="lt">${runs(PG_LETTER, pal, 12)}</g>`}${head}${body}</g><g class="wg">${wing}</g></g>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}"><style>${css}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>${inner}</svg>`;
    // 用单引号：这串会被写进 HTML 的 style="..." 里；SVG 本身不含单引号
    return (pigeons[key] = { url: `url('data:image/svg+xml,${encodeURIComponent(svg)}')`, w: vw, h: vh });
  }

  M.Brand = { ART, svg, frame, draw, station, STATION, sheet, pigeon, mix, avatar, AV };
})();
