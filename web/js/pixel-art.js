// 像素美术包：房间、家具、角色全用代码一格一格画，每格固定 2×2 像素，放大显示时边缘始终锐利。
// build() 返回一组画好的小画布，名字和插画美术包（assets/scene/*.png）一致，场景引擎不用区分。
(function () {
  const M = (window.Meerkat = window.Meerkat || {});
  const S = 2; // 角色每格 2 像素

  const PAL = {
    // Claude Code：橙色小生物
    O: '#e8784d', h: '#f6a37f', o: '#c25a33', K: '#2a1d18',
    // Codex：终端显示器机器人
    W: '#e9f2ee', w: '#b9c6c1', S: '#14202b', G: '#7ff0c8', g: '#3a5a55',
    // Cursor：银灰立方体
    C: '#dfe5ee', c: '#a9b3c3', b: '#79849a', k: '#1f2430', A: '#f4f7fb', Q: '#7fb8ff',
    // DeepSeek：蓝色小鲸鱼
    B: '#4d6bfe', d: '#3550d8', V: '#f1f4ff', q: '#9fd4ff', E: '#0e1430', e: '#ffffff',
    // 子代理小帮手（浅灰，场景里按主人颜色染色）
    L: '#e6e9ee', l: '#b3b9c4', P: '#f3e2c0', p: '#a8946c',
    // 狐獴
    T: '#d9b382', D: '#a87b4f', m: '#4a3423', x: '#120c08', N: '#2a1a12', n: '#f3e2c0', t: '#b88a5a',
  };

  const SPR = {
    'claude-idle': [
      '..hhhhhhhhhhOO..',
      '..hOOOOOOOOOOO..',
      '..OOOKOOOOKOOO..',
      'OOOOOKOOOOKOOOOO',
      'OOOOOOOOOOOOOOOO',
      '..OOOOOOOOOOOO..',
      '..oooooooooooo..',
      '...o.o....o.o...',
    ],
    'claude-work': [
      '..hhhhhhhhhhOO..',
      '..hOOOOOOOOOOO..',
      'OOOOOKOOOOKOOO..',
      'OOOOOKOOOOKOOOOO',
      '..OOOOOOOOOOOOOO',
      '..OOOOOOOOOOOO..',
      '..oooooooooooo..',
      '...o.o....o.o...',
    ],
    'claude-work2': [
      '..hhhhhhhhhhOO..',
      '..hOOOOOOOOOOO..',
      '..OOOKOOOOKOOOOO',
      'OOOOOKOOOOKOOOOO',
      'OOOOOOOOOOOOOO..',
      '..OOOOOOOOOOOO..',
      '..oooooooooooo..',
      '...o.o....o.o...',
    ],
    'claude-sleep': [
      '..hhhhhhhhhhOO..',
      '..hOOOOOOOOOOO..',
      '..OOOOOOOOOOOO..',
      '..OOKKOOOOKKOO..',
      'OOOOOOOOOOOOOOOO',
      'OOOOOOOOOOOOOOOO',
      '..oooooooooooo..',
      '...o.o....o.o...',
    ],

    'codex-idle': [
      '.WWWWWWWWWWWW.',
      'WWSSSSSSSSSSWW',
      'WWSGSSSSSSSSWW',
      'WWSSGSSSSSSSWW',
      'WWSGSSGGGSSSWW',
      'WWSSSSSSSSSSWW',
      'wwWWWWWWWWWWww',
      '....wwwwww....',
      '..wwwwwwwwww..',
    ],
    'codex-work': [
      '.WWWWWWWWWWWW.',
      'WWSGGGGGSSSSWW',
      'WWSSSGGGGSSSWW',
      'WWSGGGSSSSSSWW',
      'WWSSSGGGGGGSWW',
      'WWSSSSSSSSSSWW',
      '.wWWWWWWWWWWww',
      'ww..wwwwww....',
      '..wwwwwwwwww..',
    ],
    'codex-work2': [
      '.WWWWWWWWWWWW.',
      'WWSGGGSSSSSSWW',
      'WWSSSGGGGGGSWW',
      'WWSGGGGGSSSSWW',
      'WWSSSGGGSSSSWW',
      'WWSSSSSSSSSSWW',
      'wwWWWWWWWWWWw.',
      '....wwwwww..ww',
      '..wwwwwwwwww..',
    ],
    'codex-sleep': [
      '.WWWWWWWWWWWW.',
      'WWSSSSSSSSSSWW',
      'WWSSSSSSSSSSWW',
      'WWSSggSSggSSWW',
      'WWSSSSSSSSSSWW',
      'WWSSSSSSSSSSWW',
      'wwWWWWWWWWWWww',
      '....wwwwww....',
      '..wwwwwwwwww..',
    ],

    // 重画的 Cursor：带立体感的小方块，正面有鼠标箭头徽记
    'cursor-idle': [
      '...kkkkkkkkkk.',
      '..kCCCCCCCCCkk',
      '.kCCCCCCCCCkbk',
      'kkkkkkkkkkkbbk',
      'kcccccccccckbk',
      'kcAkcccAkcckbk',
      'kckkccckkcckbk',
      'kccccAccccckbk',
      'kccccAAcccckbk',
      'kccccAAAccckk.',
      'kkkkkkkkkkkk..',
    ],
    'cursor-work': [
      '...kkkkkkkkkk.',
      '..kCCCCCCCCCkk',
      '.kCCCCCCCCCkbk',
      'kkkkkkkkkkkbbk',
      'kcccccccccckbk',
      'kcccccccccckbk',
      'kcAkcccAkcckbk',
      'kckkccckkcckbk',
      'kccccQccccckbk',
      'kccccQQQcccbk.',
      'kkkkkkkkkkkk..',
    ],
    'cursor-work2': [
      '...kkkkkkkkkk.',
      '..kCCCCCCCCCkk',
      '.kCCCCCCCCCkbk',
      'kkkkkkkkkkkbbk',
      'kcccccccccckbk',
      'kcccccccccckbk',
      'kcAkcccAkcckbk',
      'kckkccckkcckbk',
      'kccccAccccckbk',
      'kccccAAAccckk.',
      'kkkkkkkkkkkk..',
    ],
    'cursor-sleep': [
      '...kkkkkkkkkk.',
      '..kCCCCCCCCCkk',
      '.kCCCCCCCCCkbk',
      'kkkkkkkkkkkbbk',
      'kcccccccccckbk',
      'kcccccccccckbk',
      'kckkccckkcckbk',
      'kcccccccccckbk',
      'kccccbbcccckbk',
      'kccccbbbccckk.',
      'kkkkkkkkkkkk..',
    ],

    // DeepSeek：头顶喷水的蓝色小鲸鱼
    'deepseek-idle': [
      '.......q.q......',
      '........q.......',
      '....EEEEEEE.....',
      '...EBBBBBBBE....',
      '..EBBBBBBBBBE...',
      '..EBeEBBBeEBE.EE',
      '.EBBEEBBBEEBBEBE',
      '.EBBBBBBBBBBBBE.',
      '.EBVVVVVVVVBBBE.',
      '.EdVVVVVVVVVdE..',
      '..EEEEEEEEEEE...',
    ],
    'deepseek-work': [
      '......q.q.q.....',
      '.......qqq......',
      '....EEEEEEE.....',
      '...EBBBBBBBE....',
      '..EBBBBBBBBBE...',
      '..EBeEBBBeEBE.EE',
      '.EBBEEBBBEEBBEBE',
      'EEBBBBBBBBBBBBE.',
      'EBBVVVVVVVVBBBE.',
      '.EdVVVVVVVVVdE..',
      '..EEEEEEEEEEE...',
    ],
    'deepseek-work2': [
      '.....q..q..q....',
      '......q.q.q.....',
      '....EEEEEEE.....',
      '...EBBBBBBBE....',
      '..EBBBBBBBBBE...',
      '..EBeEBBBeEBE.EE',
      '.EBBEEBBBEEBBEBE',
      '.EBBBBBBBBBBBBEE',
      '.EBVVVVVVVVBBBBE',
      '.EdVVVVVVVVVdE..',
      '..EEEEEEEEEEE...',
    ],
    'deepseek-sleep': [
      '................',
      '................',
      '....EEEEEEE.....',
      '...EBBBBBBBE....',
      '..EBBBBBBBBBE...',
      '..EBBBBBBBBBE.EE',
      '.EBBEEBBBEEBBEBE',
      '.EBBBBBBBBBBBBE.',
      '.EBVVVVVVVVBBBE.',
      '.EdVVVVVVVVVdE..',
      '..EEEEEEEEEEE...',
    ],

    'mini-idle': [
      '..LLLLLL..',
      '.LLLLLLLL.',
      '.LkLLLLkL.',
      '.LkLLLLkL.',
      '.LLLLLLLL.',
      '.llllllll.',
      '..l....l..',
    ],
    'mini-work': [
      '..LLLLLL..',
      '.LLLLLLLL.',
      '.LkLLLLkL.',
      'LLPPPPPPLL',
      '.LPppppPL.',
      '.lPPPPPPl.',
      '..l....l..',
    ],
    'mini-done': [
      'L.LLLLLL.L',
      'LLLLLLLLLL',
      '.LkLLLLkL.',
      '.LLLLLLLL.',
      '.LLkkkkLL.',
      '.llllllll.',
      '..l....l..',
    ],

    'meerkat-idle': [
      '....DTTD....',
      '...TTTTTT...',
      '..DTTTTTTD..',
      '..TmxTTxmT..',
      '..TmmTTmmT..',
      '...TTNNTT...',
      '....TTTT....',
      '.....TT.....',
      '....TTTT....',
      '...TTnnTT...',
      '..tTTnnTTt..',
      '...tTnnTt...',
      '...TTnnTT...',
      '...TTnnTT...',
      '...TTTTTTD..',
      '...TT..TT.D.',
      '..TTT..TTTD.',
      '..........DD',
    ],
    'meerkat-look': [
      '....DTTD....',
      '...TTTTTT...',
      '..DTTTTTTD..',
      '..TxmTTxmT..',
      '..TmmTTmmT..',
      '...TNNTTT...',
      '....TTTT....',
      '.....TT.....',
      '....TTTT....',
      '...TTnnTT...',
      '..tTTnnTTt..',
      '...tTnnTt...',
      '...TTnnTT...',
      '...TTnnTT...',
      '...TTTTTTD..',
      '...TT..TT.D.',
      '..TTT..TTTD.',
      '..........DD',
    ],
    // 警觉：站高一格、举爪招手、张嘴喊
    'meerkat-alert': [
      '....DTTD..t.',
      '...TTTTTT.t.',
      '..DTTTTTTDt.',
      '..TmxTTxmTt.',
      '..TmmTTmmTt.',
      '...TTxxTTt..',
      '....TTTTt...',
      '.....TT.....',
      '.....TT.....',
      '....TTTT....',
      '...TTnnTT...',
      '..tTTnnTT...',
      '...tTnnTT...',
      '...TTnnTT...',
      '...TTnnTT...',
      '...TTTTTTD..',
      '...TT..TT.D.',
      '..TTT..TTTD.',
      '..........DD',
    ],
  };

  function grid(rows, s = S) {
    const w = Math.max(...rows.map(r => r.length));
    const c = document.createElement('canvas');
    c.width = w * s; c.height = rows.length * s;
    const x = c.getContext('2d');
    rows.forEach((row, y) => [...row].forEach((ch, i) => {
      if (ch === '.' || !PAL[ch]) return;
      x.fillStyle = PAL[ch];
      x.fillRect(i * s, y * s, s, s);
    }));
    return c;
  }
  // 给画好的东西加一圈 1 像素深色描边（只描在透明的一侧），和背景分得开
  function outline(src, col = '#0b1117') {
    const w = src.width, h = src.height;
    const c = document.createElement('canvas');
    c.width = w + 2; c.height = h + 2;
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
  function canvas(w, h, paint) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    const r = (px, py, pw, ph, col) => { x.fillStyle = col; x.fillRect(px, py, pw, ph); };
    paint(r, x);
    return c;
  }

  /* ---------- 家具 ---------- */
  const WOOD = { top: '#b98252', topHi: '#d39c66', edge: '#e0ad78', front: '#7a4c30', frontDk: '#633d26', side: '#55351f', leg: '#3e2818', grain: '#a6714a' };

  // 3/4 视角的桌子：上面是桌面（能看到顶面和正面），右侧一条暗面，底下四条腿
  function desk(w, { monitors = 1, main = false } = {}) {
    const mon = 18, top = 9, front = 9, leg = 8, side = 3;
    const H = mon + top + front + leg;
    return canvas(w + side, H, (r) => {
      const y0 = mon;
      // 桌面顶面：后边略窄（透视），木纹横线
      for (let i = 0; i < top; i++) {
        const inset = Math.round((top - i) * 0.4);
        r(inset, y0 + i, w - inset, 1, i === 0 ? WOOD.topHi : WOOD.top);
      }
      for (let i = 3; i < w - 6; i += 11) r(i + 2, y0 + 3 + (i % 3), 6, 1, WOOD.grain);
      r(0, y0 + top - 1, w, 1, WOOD.edge);
      // 正面和右侧暗面
      r(0, y0 + top, w, front, WOOD.front);
      r(0, y0 + top, w, 1, WOOD.frontDk);
      r(w, y0 + 2, side, top + front - 2, WOOD.side);
      for (let i = 0; i < side; i++) r(w + i, y0 + 1 + (side - i), 1, 1, WOOD.side);
      // 抽屉
      const dw = main ? 26 : 16;
      r(Math.round(w / 2 - dw / 2), y0 + top + 3, dw, 4, WOOD.frontDk);
      r(Math.round(w / 2 - 2), y0 + top + 4, 4, 1, WOOD.edge);
      // 桌腿（前两条亮、后两条暗）
      const ly = y0 + top + front;
      r(2, ly, 3, leg, WOOD.leg); r(w - 5, ly, 3, leg, WOOD.leg);
      r(w + 1, ly - 2, 2, leg, '#2e1d12');
      if (main) { r(Math.round(w / 2) - 1, ly, 2, leg - 2, WOOD.leg); }
      // 显示器（屏幕朝外，放在桌子一侧，角色坐在旁边）
      const screen = (mx, mw) => {
        r(mx, 2, mw, 14, '#2b3a4a'); r(mx + 1, 3, mw - 2, 11, '#16232f');
        for (let i = 0; i < 3; i++) r(mx + 3, 5 + i * 3, Math.round((mw - 6) * [0.7, 0.45, 0.6][i]), 1, ['#7ff0c8', '#4fb89a', '#7ff0c8'][i]);
        r(mx + Math.round(mw / 2) - 1, 16, 3, 2, '#2b3a4a'); r(mx + Math.round(mw / 2) - 4, y0, 9, 1, '#3a4a5a');
      };
      if (main) { screen(w - 52, 24); screen(w - 27, 24); }
      else screen(Math.round(w * 0.1), 22);
      // 键盘
      const kx = main ? Math.round(w * 0.2) : Math.round(w * 0.52);
      r(kx, y0 + 4, 18, 3, '#2b3a4a'); for (let i = 0; i < 8; i++) r(kx + 1 + i * 2, y0 + 5, 1, 1, '#5d6a7a');
      // 小摆件
      if (main) { r(4, y0 + 1, 6, 5, '#e9f2ee'); r(10, y0 + 2, 1, 2, '#e9f2ee'); r(5, y0 + 2, 4, 1, '#a87b4f'); r(13, y0 + 3, 9, 4, '#e9d8b4'); r(14, y0 + 4, 6, 1, '#a87b4f'); }
      else { r(w - 9, y0 - 1, 6, 5, '#7a4a35'); r(w - 8, y0 - 6, 4, 5, '#4f8a63'); r(w - 10, y0 - 4, 3, 2, '#7fc29a'); r(w - 5, y0 - 5, 3, 2, '#7fc29a'); }
    });
  }

  function sideDesk() {
    const w = 26, top = 6, front = 6, leg = 6, side = 2, mon = 10;
    return canvas(w + side, mon + top + front + leg, (r) => {
      const y0 = mon;
      for (let i = 0; i < top; i++) r(Math.round((top - i) * 0.4), y0 + i, w - Math.round((top - i) * 0.4), 1, i === 0 ? WOOD.topHi : WOOD.top);
      r(0, y0 + top - 1, w, 1, WOOD.edge);
      r(0, y0 + top, w, front, WOOD.front);
      r(w, y0 + 2, side, top + front - 2, WOOD.side);
      r(2, y0 + top + front, 2, leg, WOOD.leg); r(w - 4, y0 + top + front, 2, leg, WOOD.leg);
      // 小屏幕和一叠纸
      r(2, 1, 11, 8, '#2b3a4a'); r(3, 2, 9, 6, '#16232f'); r(4, 3, 5, 1, '#ffcf6b'); r(4, 5, 3, 1, '#ffcf6b');
      r(6, 9, 3, 1, '#2b3a4a');
      r(16, y0 - 1, 8, 3, '#e9d8b4'); r(17, y0 - 2, 6, 1, '#f3ead8');
    });
  }

  function crate() {
    return canvas(30, 34, (r) => {
      const box = (x, y, w, h, t) => {
        // 顶面
        for (let i = 0; i < t; i++) r(x + Math.round((t - i) * 0.5), y + i, w - Math.round((t - i) * 0.5), 1, i === 0 ? '#c08a5e' : '#a8724e');
        // 正面
        r(x, y + t, w, h, '#8a5a3c'); r(x, y + t, w, 1, '#6b432c'); r(x, y + t + h - 1, w, 1, '#5a3a26');
        r(x, y + t, 1, h, '#5a3a26'); r(x + w - 1, y + t, 1, h, '#5a3a26');
        for (let i = 2; i < w - 2; i++) r(x + i, y + t + 1 + Math.round(((i - 2) / (w - 4)) * (h - 3)), 1, 1, '#6b432c');
        r(x + w, y + 1, 2, t + h - 1, '#4f321f');
      };
      box(0, 14, 28, 15, 5);
      box(4, 0, 20, 10, 4);
    });
  }

  function lamp() {
    return canvas(18, 66, (r) => {
      r(1, 2, 16, 9, '#ffcf6b'); r(3, 0, 12, 2, '#e0a94a'); r(1, 10, 16, 1, '#e0a94a'); r(12, 3, 3, 6, '#ffe3a0');
      r(8, 11, 2, 50, '#3a4a5a'); r(9, 11, 1, 50, '#4d5f72');
      r(4, 61, 10, 3, '#3a4a5a'); r(3, 64, 12, 2, '#2b3a4a');
    });
  }

  function plant() {
    return canvas(26, 40, (r) => {
      r(6, 28, 14, 11, '#7a4a35'); r(5, 27, 16, 2, '#8f5a40'); r(17, 29, 2, 9, '#5f3a2a');
      r(12, 8, 2, 20, '#3d6b4f');
      const leaf = (x, y, w, h, c) => r(x, y, w, h, c);
      leaf(3, 12, 9, 4, '#4f8a63'); leaf(1, 13, 3, 2, '#3d6b4f'); leaf(14, 16, 9, 4, '#4f8a63'); leaf(22, 17, 3, 2, '#3d6b4f');
      leaf(5, 20, 7, 3, '#3d6b4f'); leaf(14, 6, 6, 4, '#4f8a63'); leaf(8, 2, 5, 5, '#7fc29a'); leaf(15, 22, 6, 3, '#7fc29a');
    });
  }

  /* ---------- 房间 ---------- */
  const W = 384, H = 216, FLOOR = 104;
  function room() {
    return canvas(W, H, (r, x) => {
      // 后墙
      r(0, 0, W, FLOOR, '#1d2b38');
      for (let y = 6; y < FLOOR - 8; y += 12) for (let i = (y / 12) % 2 ? 4 : 10; i < W; i += 12) r(i, y, 1, 1, '#24364a');
      for (let y = 14; y < FLOOR - 10; y += 22) for (let i = ((y / 22) | 0) % 2 ? 30 : 70; i < W; i += 92) { r(i, y, 14, 1, '#223244'); r(i + 3, y + 5, 10, 1, '#223244'); }
      // 踢脚线
      r(0, FLOOR - 6, W, 4, '#16202b'); r(0, FLOOR - 7, W, 1, '#2b3c4f'); r(0, FLOOR - 2, W, 2, '#0e151d');

      // 窗户：月亮和星星
      const wx = 22, wy = 12, ww = 58, wh = 42;
      r(wx - 3, wy - 3, ww + 6, wh + 6, '#5a3d2b'); r(wx - 2, wy - 2, ww + 4, wh + 4, '#7a5238');
      r(wx, wy, ww, wh, '#16283a');
      for (let i = 0; i < wh; i += 2) r(wx, wy + i, ww, 1, i < wh / 2 ? '#1b3048' : '#203a55');
      r(wx + ww / 2 - 1, wy, 2, wh, '#7a5238'); r(wx, wy + wh / 2 - 1, ww, 2, '#7a5238');
      // 月牙
      [[2, 0, 4], [1, 1, 3], [0, 2, 2], [0, 3, 2], [0, 4, 2], [1, 5, 3], [2, 6, 4]].forEach(([dx, dy, w]) => r(wx + 8 + dx, wy + 5 + dy, w, 1, '#ffe9a8'));
      r(wx + 7, wy + 7, 1, 3, '#ffe9a8');
      [[40, 8], [6, 14], [46, 30], [20, 32], [52, 6], [36, 26]].forEach(([sx, sy]) => r(wx + sx, wy + sy, 1, 1, '#cfe0f0'));
      // 窗外树影
      for (let i = 0; i < ww; i += 3) r(wx + i, wy + wh - 4 - ((i * 7) % 5), 3, 4 + ((i * 7) % 5), '#0f1d2a');
      r(wx - 4, wy + wh + 3, ww + 8, 3, '#7a5238'); r(wx - 4, wy + wh + 6, ww + 8, 1, '#3a2a22');

      // 软木板和便签
      const bx = 124, by = 16;
      r(bx - 2, by - 2, 56, 36, '#5a3d2b'); r(bx, by, 52, 32, '#a8764a');
      for (let i = 0; i < 52; i += 4) for (let j = (i / 4) % 2 ? 1 : 3; j < 32; j += 4) r(bx + i, by + j, 1, 1, '#96683f');
      const note = (nx, ny, c) => { r(nx, ny, 12, 11, c); r(nx + 2, ny + 3, 8, 1, '#00000033'); r(nx + 2, ny + 6, 6, 1, '#00000033'); r(nx + 5, ny - 1, 2, 2, '#e8784d'); };
      note(bx + 5, by + 5, '#f3ead8'); note(bx + 21, by + 8, '#bfe3c7'); note(bx + 36, by + 4, '#ffe08a'); note(bx + 28, by + 19, '#a9c8f0');

      // 挂钟
      const cx = 214, cy = 26;
      r(cx - 9, cy - 9, 18, 18, '#5a3d2b'); r(cx - 8, cy - 8, 16, 16, '#e9f2ee');
      r(cx - 8, cy - 8, 16, 1, '#5a3d2b'); r(cx - 8, cy + 7, 16, 1, '#5a3d2b'); r(cx - 8, cy - 8, 1, 16, '#5a3d2b'); r(cx + 7, cy - 8, 1, 16, '#5a3d2b');
      r(cx, cy - 6, 1, 6, '#14202b'); r(cx, cy, 4, 1, '#14202b'); r(cx - 1, cy - 1, 2, 2, '#e8784d');

      // 书架
      const sx = 270, sy = 44;
      r(sx, sy, 92, 4, '#7a5238'); r(sx, sy + 4, 92, 1, '#3a2a22'); r(sx + 4, sy + 5, 3, 6, '#5a3d2b'); r(sx + 85, sy + 5, 3, 6, '#5a3d2b');
      const books = ['#4f8a63', '#e8784d', '#a9c8f0', '#ffcf6b', '#7a5aa8', '#e9d8b4', '#3d6b8f', '#c25a33'];
      let bxp = sx + 6;
      books.forEach((c, i) => { const bh = 14 + ((i * 5) % 6); r(bxp, sy - bh, 5, bh, c); r(bxp + 1, sy - bh + 3, 3, 1, '#00000033'); bxp += 6; });
      r(bxp + 4, sy - 8, 10, 8, '#7a4a35'); r(bxp + 6, sy - 14, 6, 6, '#4f8a63');
      for (let i = 0; i < 4; i++) r(bxp + 10 + i, sy + 2 + i * 4, 2, 4, i % 2 ? '#3d6b4f' : '#4f8a63');

      // 地板：木板缝朝远处的消失点汇聚，横缝越近越疏
      r(0, FLOOR, W, H - FLOOR, '#33261f');
      const vx = W / 2, vy = -260;
      for (let x0 = -520; x0 <= W + 520; x0 += 34) {
        for (let y = FLOOR; y < H; y++) {
          const px = Math.round(vx + (x0 - vx) * (y - vy) / (H - vy));
          if (px >= 0 && px < W) r(px, y, 1, 1, '#261b15');
        }
      }
      let yy = FLOOR + 6, gap = 7, k = 0;
      while (yy < H) {
        // 每块木板的横缝错开
        for (let x0 = -520 + (k % 2) * 17; x0 <= W + 520; x0 += 34) {
          const px = Math.round(vx + (x0 - vx) * (yy - vy) / (H - vy));
          const nx = Math.round(vx + (x0 + 34 - vx) * (yy - vy) / (H - vy));
          if (nx > 0 && px < W && (k + x0 / 34) % 3 === 0) r(Math.max(0, px), yy, Math.min(W, nx) - Math.max(0, px), 1, '#261b15');
        }
        yy += gap; gap = Math.round(gap * 1.18) + 1; k++;
      }
      // 木板上偶尔的亮纹
      for (let i = 0; i < 70; i++) {
        const fx = (i * 97) % W, fy = FLOOR + 3 + ((i * 53) % (H - FLOOR - 4));
        r(fx, fy, 3 + (i % 4), 1, '#45322a');
      }
      // 窗外月光投在地板上（棋盘格抖动，保持硬边）
      for (let y = FLOOR; y < FLOOR + 40; y++) {
        const x1 = Math.round(14 + (y - FLOOR) * 0.9), x2 = Math.round(96 + (y - FLOOR) * 1.5);
        for (let px = x1; px < x2; px++) if ((px + y) % 4 === 0 && y % 2 === 0) r(px, y, 1, 1, '#463630');
      }
      // 台灯的暖光圈
      for (let y = FLOOR; y < FLOOR + 30; y++) for (let px = 0; px < 70; px++) {
        const d = Math.hypot((px - 26) / 1.8, y - FLOOR - 8);
        if (d < 18 && (px + y) % 2 === 0) r(px, y, 1, 1, '#5a4030');
        else if (d < 10) r(px, y, 1, 1, '#5a4030');
      }
      // 墙顶一条暗边
      r(0, 0, W, 2, '#121c26');
    });
  }

  M.PixelArt = {
    // 角色坐在显示器旁边：主桌显示器在右，角色坐左；工位显示器在左，角色坐右
    fit: { main: { dx: -0.24, sit: 0.53 }, seat: { dx: 0.2, sit: 0.53 }, side: { dx: 0.18, sit: 0.55 } },
    build() {
      const out = { room: room() };
      const props = { 'desk-main': desk(108, { monitors: 2, main: true }), desk: desk(70), 'desk-side': sideDesk(), crate: crate(), lamp: lamp(), plant: plant() };
      for (const [name, c] of Object.entries(props)) out[name] = outline(c);
      // 主角色每格 3 像素，子代理小帮手和狐獴每格 2 像素
      for (const [name, rows] of Object.entries(SPR)) out[name] = outline(grid(rows, /^(claude|codex|cursor|deepseek)-/.test(name) ? 3 : 2));
      return out;
    },
  };
})();
