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
})();
