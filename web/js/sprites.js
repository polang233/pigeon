// 像素精灵：每个角色是一张字符网格，字符对应调色板里的颜色，'.' 是透明。
(function () {
  const M = (window.Meerkat = window.Meerkat || {});

  const PAL = {
    // Claude Code：橙色小生物
    O: '#e8784d', h: '#f6a37f', o: '#c25a33', K: '#2a1d18',
    // Codex：终端显示器机器人
    W: '#e9f2ee', w: '#b9c6c1', S: '#14202b', G: '#7ff0c8',
    // Cursor：箭头小家伙
    C: '#a3adbd', c: '#7d8799', k: '#1f2430',
    // 狐獴
    T: '#d9b382', D: '#a87b4f', M: '#4a3423', E: '#120c08', N: '#2a1a12', B: '#f3e2c0', P: '#b88a5a',
  };

  const SPRITES = {
    claude: [
      '..hhhhhhhhhhOO..',
      '..hOOOOOOOOOOO..',
      '..OOOKOOOOKOOO..',
      '..OOOKOOOOKOOO..',
      '..OOOOOOOOOOOO..',
      '..OOOOOOOOOOOO..',
      '..oooooooooooo..',
      '...o.o....o.o...',
      '...o.o....o.o...',
    ],
    codex: [
      '.WWWWWWWWWWWW.',
      'WWSSSSSSSSSSWW',
      'WWSSSSSSSSSSWW',
      'WWSSSSSSSSSSWW',
      'WWSSSSSSSSSSWW',
      'WWSSSSSSSSSSWW',
      '.wWWWWWWWWWWw.',
      '....wwwwww....',
      '..wwwwwwwwww..',
    ],
    cursor: [
      'C.........',
      'CC........',
      'CCC.......',
      'CCCC......',
      'CCCCC.....',
      'CkCkCC....',
      'CCCCCCC...',
      'CCCCCCCC..',
      'CCCCc.....',
      'cC.cC.....',
      'c...cC....',
    ],
    mini: [
      '.hhhhhhhO.',
      '.OOKOOKOO.',
      '.OOKOOKOO.',
      '.OOOOOOOO.',
      '.oooooooo.',
      '..o.o.o.o.',
    ],
    meerkat: [
      '....DTTD....',
      '...TTTTTT...',
      '..DTTTTTTD..',
      '..TMMTTMMT..',
      '..TMMTTMMT..',
      '...TTNNTT...',
      '....TTTT....',
      '.....TT.....',
      '....TTTT....',
      '...TTBBTT...',
      '..PTTBBTTP..',
      '...PTBBTP...',
      '...TTBBTT...',
      '...TTBBTT...',
      '...TTTTTTD..',
      '...TT..TT.D.',
      '..TTT..TTTD.',
      '..........DD',
    ],
  };

  function grey(hex) {
    const n = parseInt(hex.slice(1), 16);
    const l = Math.round(((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) * 0.55 + 30);
    return `rgb(${l},${l + 4},${l + 12})`;
  }
  const GREY = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, grey(v)]));

  // 画一张网格。opts.grey 用灰色版，opts.skip 是要跳过的字符，opts.only 只画某些字符，opts.scale 是每格几个像素。
  function draw(ctx, grid, x, y, opts = {}) {
    const pal = opts.grey ? GREY : PAL;
    const s = opts.scale || 1;
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.') continue;
        if (opts.skip && opts.skip.includes(ch)) continue;
        if (opts.only && !opts.only.includes(ch)) continue;
        ctx.fillStyle = (opts.recolor && opts.recolor[ch]) || pal[ch];
        ctx.fillRect(x + (opts.flip ? row.length - 1 - c : c) * s, y + r * s, s, s);
      }
    }
  }

  M.PAL = PAL;
  M.SPRITES = SPRITES;
  M.drawGrid = draw;
  M.greyOf = grey;

  // 活动小图标（9×9），两个主题共用。f 是动画帧号。
  M.drawActIcon = function (c, act, x, y, col, f) {
    const r = (dx, dy, w = 1, h = 1, cc = col) => { c.fillStyle = cc; c.fillRect(x + dx, y + dy, w, h); };
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
  };
})();
