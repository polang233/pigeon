// 洋馆样式：一座像素画的洋馆大厅，Claude 大小姐坐在写字台后面指挥，DeepSeek 鲸鱼娘女仆推着茶车干活。
// 人物都是自己画的 Q 版像素画，只借用社区里大家认得的特征（大小姐：橙色长直发、放射状的花饰；鲸鱼娘：蓝发、鲸鱼背鳍呆毛、女仆装、大尾巴、爱吃白饭）。
// Codex 和 Cursor 暂时挂成画架上的肖像画，里面放它们简洁样式里会动的头像。
// 坐标单位是像素格；一个工位是 48×46 格，画布按 scale 放大。n 是第几帧（每帧 160 毫秒）。
(function () {
  const M = (window.Pigeon = window.Pigeon || {});
  const W = 48, H = 46, OX = 8, OY = 3; // 工位大小；人物框（32×32）的左上角

  const SKIN = { skin: '#ffe3cf', skinSh: '#f1c3a4', blush: '#f7a8a2', white: '#ffffff', mouth: '#b8463c', mouthDk: '#7a2a26' };
  const LADY = Object.assign({}, SKIN, {
    hair: '#e8833a', hairHi: '#f8aa62', hairSh: '#b9561f',
    eye: '#c4561e', eyeDk: '#4a1d0e',
    bodice: '#2b2329', bodiceHi: '#43373f', dress: '#d9733a', dressSh: '#b25a2a', collar: '#f4e4c4', collarSh: '#d8c39c',
    petal: '#fff2dc', tip: '#ee7f45', heart: '#c2541f',
    book: '#7a3b2c', page: '#f7eedb', pageSh: '#d8cdb4', ink: '#c9bda2',
  });
  const MAID = Object.assign({}, SKIN, {
    hair: '#3f6fd8', hairHi: '#7ea6f4', hairSh: '#2a4fa6', hairTip: '#a9c6ff',
    eye: '#2e5bd0', eyeDk: '#14234f',
    dress: '#24365f', dressHi: '#33497a', apron: '#fbfbff', apronSh: '#d9e1f0', bow: '#4b74e8',
    fin: '#4b74e8', finSh: '#3352bd', belly: '#b9ccff',
    bowl: '#f4f1ea', rice: '#ffffff', stick: '#8a5a3a', basin: '#9aa3b1', basinHi: '#cdd3dc', basinDk: '#6f7888',
    lid: '#c9ced8', lidHi: '#e6e9ef',
  });
  const GOLD = '#d9b05c', GOLD_HI = '#f0d48a', GOLD_DK = '#9c7a35';

  // 眼睛的几种样子：open 睁眼，look 往下看，think 往旁边看，closed 闭眼，happy 眯眼笑，wide 瞪大
  function eyes(p, C, kind, dy) {
    for (const ex of [12, 18]) {
      const y = 13 + dy;
      if (kind === 'open') { p(ex, y, 2, 1, C.eyeDk); p(ex, y + 1, 2, 2, C.eye); p(ex, y + 1, 1, 1, C.white); }
      else if (kind === 'look') { p(ex, y + 1, 2, 1, C.eyeDk); p(ex, y + 2, 2, 1, C.eye); }
      else if (kind === 'think') { p(ex, y, 2, 1, C.eyeDk); p(ex + 1, y + 1, 1, 2, C.eye); p(ex, y + 1, 1, 1, C.white); }
      else if (kind === 'closed') p(ex - 1, y + 2, 3, 1, C.eyeDk);
      else if (kind === 'happy') { p(ex - 1, y + 2, 1, 1, C.eyeDk); p(ex, y + 1, 1, 1, C.eyeDk); p(ex + 1, y + 2, 1, 1, C.eyeDk); }
      else if (kind === 'wide') { p(ex, y, 2, 3, C.eye); p(ex, y, 2, 1, C.eyeDk); p(ex, y + 1, 1, 1, C.white); p(ex + 1, y + 2, 1, 1, C.white); }
    }
  }
  function mouth(p, C, kind, dy) {
    const y = 17 + dy;
    if (kind === 'open') p(15, y, 2, 2, C.mouthDk);
    else if (kind === 'smile') { p(14, y, 1, 1, C.mouth); p(15, y + 1, 2, 1, C.mouth); p(17, y, 1, 1, C.mouth); }
    else if (kind === 'chew') { p(15, y, 2, 1, C.mouth); p(15, y + 1, 1, 1, C.mouth); }
    else if (kind === 'flat') p(15, y, 2, 1, C.skinSh);
    else p(15, y, 2, 1, C.mouth);
  }

  // ---------- Claude 大小姐 ----------
  function lady(p, pose, n) {
    const C = LADY, dy = pose === 'sleep' ? 2 : 0;
    // 背后的长发
    p(6, 8, 20, 22, C.hairSh); p(7, 8, 18, 22, C.hair); p(8, 12, 1, 16, C.hairHi);
    // 身子：泡泡袖、黑色胸衣、米色领子和橙色蝴蝶结
    p(6, 21, 5, 5, C.dress); p(21, 21, 5, 5, C.dress); p(6, 25, 5, 1, C.dressSh); p(21, 25, 5, 1, C.dressSh);
    p(10, 21, 12, 11, C.bodice); p(11, 22, 1, 9, C.bodiceHi);
    p(11, 20, 10, 2, C.collar); p(12, 22, 8, 1, C.collarSh);
    p(14, 21, 4, 2, C.dress); p(15, 22, 2, 2, C.dressSh);
    for (const ly of [25, 27, 29]) p(15, ly, 2, 1, C.collarSh);
    p(14, 18 + dy, 4, 3, C.skinSh);
    // 脸
    p(10, 8 + dy, 12, 12, C.skin); p(9, 9 + dy, 14, 10, C.skin); p(10, 19 + dy, 12, 1, C.skinSh);
    // 头顶和刘海
    p(11, 3 + dy, 10, 1, C.hair); p(9, 4 + dy, 14, 1, C.hair); p(8, 5 + dy, 16, 4, C.hair);
    p(8, 5 + dy, 1, 4, C.hairSh); p(23, 5 + dy, 1, 4, C.hairSh); p(12, 4 + dy, 4, 1, C.hairHi); p(10, 5 + dy, 3, 1, C.hairHi);
    p(9, 9 + dy, 14, 1, C.hair);
    p(9, 10 + dy, 4, 1, C.hair); p(14, 10 + dy, 4, 1, C.hair); p(19, 10 + dy, 4, 1, C.hair);
    p(9, 11 + dy, 2, 1, C.hair); p(15, 11 + dy, 2, 1, C.hair); p(21, 11 + dy, 2, 1, C.hair);
    // 两侧垂下来的头发
    p(7, 9 + dy, 3, 18 - dy, C.hair); p(7, 9 + dy, 1, 18 - dy, C.hairSh); p(22, 9 + dy, 3, 18 - dy, C.hair); p(24, 9 + dy, 1, 18 - dy, C.hairSh);
    p(8, 26, 2, 1, C.hairHi); p(22, 26, 2, 1, C.hairHi);
    // 放射状的花饰（借 Claude 标志的意思）
    const fx = 7, fy = 4 + dy;
    p(fx + 1, fy + 1, 2, 2, C.heart);
    p(fx + 1, fy - 1, 2, 2, C.petal); p(fx + 1, fy + 3, 2, 2, C.petal); p(fx - 1, fy + 1, 2, 2, C.petal); p(fx + 3, fy + 1, 2, 2, C.petal);
    p(fx + 1, fy - 2, 2, 1, C.tip); p(fx + 1, fy + 5, 2, 1, C.tip); p(fx - 2, fy + 1, 1, 2, C.tip); p(fx + 5, fy + 1, 1, 2, C.tip);
    p(fx - 1, fy - 1, 1, 1, C.tip); p(fx + 4, fy - 1, 1, 1, C.tip); p(fx - 1, fy + 4, 1, 1, C.tip); p(fx + 4, fy + 4, 1, 1, C.tip);
    // 表情
    const ek = { conduct: 'open', work: 'look', think: 'think', wait: 'wide', done: 'happy', idle: n % 14 === 0 ? 'closed' : 'look', sleep: 'closed' }[pose];
    eyes(p, C, ek, dy);
    p(10, 16 + dy, 2, 1, C.blush); p(20, 16 + dy, 2, 1, C.blush);
    mouth(p, C, pose === 'conduct' ? (n % 2 ? 'open' : 'smile') : pose === 'wait' ? 'open' : pose === 'done' ? 'smile' : 'small', dy);
    // 手和道具
    if (pose === 'idle' || pose === 'sleep') { // 捧着书看；睡着时书摊在桌上
      if (pose === 'idle') {
        p(9, 24, 14, 7, C.book); p(10, 24, 12, 6, C.page); p(15, 24, 2, 6, C.pageSh);
        p(11, 26, 3, 1, C.ink); p(11, 28, 3, 1, C.ink); p(18, 26, 3, 1, C.ink); p(18, 28, 3, 1, C.ink);
        p(8, 26, 2, 2, C.skin); p(22, 26, 2, 2, C.skin);
        if (n % 12 < 2) { p(17, 21, 5, 4, C.page); p(17, 21, 5, 1, C.pageSh); } // 翻页
      } else { p(9, 27, 14, 3, C.page); p(15, 27, 2, 3, C.pageSh); p(10, 26, 3, 2, C.skin); p(19, 26, 3, 2, C.skin); }
    } else if (pose === 'conduct') { // 一手夹着书，一手举着折扇挥
      p(7, 23, 3, 7, C.book); p(8, 24, 1, 5, C.page);
      const up = n % 2;
      p(22, 18 - up, 3, 4, C.dress); p(24, 15 - up * 2, 2, 3, C.skin);
      const fx2 = 25 + up, fy2 = 10 - up * 2;
      p(fx2, fy2, 5, 4, GOLD); p(fx2, fy2, 5, 1, GOLD_HI); p(fx2 + 1, fy2 + 1, 1, 3, GOLD_DK); p(fx2 + 3, fy2 + 1, 1, 3, GOLD_DK);
      if (up) { p(fx2 + 6, fy2 - 1, 1, 1, GOLD_HI); p(fx2 + 7, fy2 + 2, 1, 1, GOLD_HI); }
    } else if (pose === 'work') { // 羽毛笔在纸上写
      const q = n % 4 < 2 ? n % 2 : 2 - n % 2;
      p(9, 27, 3, 2, C.skin); p(19 + q, 27, 3, 2, C.skin);
      p(21 + q, 22, 1, 5, '#f6f6f2'); p(22 + q, 22, 1, 3, '#d9d9d2'); p(20 + q, 21, 1, 2, '#f6f6f2');
    } else if (pose === 'think') { // 托着下巴
      p(12, 21, 3, 3, C.dress); p(13, 19, 3, 2, C.skin); p(20, 27, 3, 2, C.skin);
    } else if (pose === 'wait') { // 伸手去摇铃
      p(22, 23, 3, 3, C.dress); p(24, 26, 3, 2, C.skin); p(9, 27, 3, 2, C.skin);
    } else if (pose === 'done') { // 端起茶杯
      p(18, 15, 4, 3, '#fbfbf5'); p(18, 15, 4, 1, '#c8875a'); p(22, 16, 1, 1, '#fbfbf5'); p(19, 18, 3, 2, C.skin);
      p(9, 26, 6, 1, '#fbfbf5'); p(10, 25, 3, 1, C.skin);
      if (n % 2) { p(19, 12, 1, 2, '#ffffff'); p(21, 11, 1, 2, '#ffffff'); } else { p(20, 12, 1, 2, '#ffffff'); }
    }
  }
  // 写字台：书、墨水瓶、铃
  function desk(r, pose, n) {
    r(5, 25, 8, 2, '#3d6b8f'); r(6, 23, 7, 2, '#8e2f3a'); r(5, 27, 8, 4, '#c9a45c'); r(6, 28, 6, 1, '#a8843c');
    r(38, 27, 3, 4, '#22252e'); r(38, 27, 3, 1, '#4a4f5c'); if (pose !== 'work') r(40, 22, 1, 6, '#f6f6f2');
    const shake = pose === 'wait' ? (n % 2 ? 1 : -1) : 0;
    r(32 + shake, 27, 4, 3, GOLD); r(33 + shake, 26, 2, 1, GOLD); r(31, 30, 6, 1, GOLD_DK); r(33 + shake, 27, 1, 1, GOLD_HI);
    if (pose === 'wait') { r(29, 25, 1, 2, GOLD_HI); r(38, 25, 1, 2, GOLD_HI); r(30, 23, 1, 1, GOLD_HI); r(37, 23, 1, 1, GOLD_HI); }
    if (pose === 'work') { r(18, 30, 12, 1, '#fffaf0'); }
    r(3, 31, 42, 2, '#a8744c'); r(3, 31, 42, 1, '#c18b5e'); r(3, 33, 42, 1, '#5e3b28');
    r(4, 34, 40, 10, '#7d5238'); r(7, 36, 15, 6, '#6b4630'); r(26, 36, 15, 6, '#6b4630');
    r(14, 38, 2, 2, GOLD); r(33, 38, 2, 2, GOLD); r(4, 44, 3, 2, '#5a3826'); r(41, 44, 3, 2, '#5a3826');
  }

  // ---------- DeepSeek 鲸鱼娘女仆 ----------
  function maid(p, pose, n) {
    const C = MAID, dy = pose === 'sleep' ? 1 : 0;
    // 身后的大鲸鱼尾巴，会摆
    const sw = pose === 'work' ? (n % 2 ? 1 : -1) : pose === 'sleep' ? 0 : (n % 6 < 3 ? 0 : 1);
    p(23, 23, 5, 6, C.fin); p(26, 20, 5, 5, C.fin); p(29, 16, 4, 5, C.fin); p(24, 25, 3, 3, C.belly); p(27, 22, 2, 2, C.belly);
    const tx = 30 + sw, ty = 9 + sw;
    p(tx - 4, ty + 3, 5, 3, C.fin); p(tx + 3, ty, 5, 3, C.fin); p(tx, ty + 3, 4, 4, C.fin);
    p(tx - 4, ty + 3, 2, 1, C.finSh); p(tx + 6, ty, 2, 1, C.finSh); p(tx + 1, ty + 6, 2, 1, C.finSh);
    // 背后的长发，发梢浅一些
    p(6, 8, 20, 21, C.hairSh); p(7, 8, 18, 21, C.hair); p(7, 27, 18, 2, C.hairTip); p(8, 12, 1, 14, C.hairHi);
    // 圆滚滚的女仆装：泡泡袖、白袖口、白围裙、蓝色蝴蝶结
    p(5, 21, 6, 5, C.dress); p(21, 21, 6, 5, C.dress); p(5, 25, 6, 1, C.apron); p(21, 25, 6, 1, C.apron);
    p(9, 21, 14, 11, C.dress); p(10, 22, 1, 9, C.dressHi);
    p(12, 22, 8, 10, C.apron); p(12, 22, 8, 1, C.apronSh); p(11, 21, 1, 3, C.apron); p(20, 21, 1, 3, C.apron);
    p(13, 20, 6, 2, C.apron); p(15, 21, 2, 2, C.bow);
    p(14, 18 + dy, 4, 3, C.skinSh);
    // 圆脸，脸颊鼓一点
    p(9, 8 + dy, 14, 12, C.skin); p(8, 10 + dy, 16, 8, C.skin); p(10, 19 + dy, 12, 1, C.skinSh);
    if (pose === 'idle' && n % 2 === 0) { p(7, 14 + dy, 1, 3, C.skin); p(24, 14 + dy, 1, 3, C.skin); } // 嚼饭时腮帮子鼓起来
    // 头顶、刘海、两侧头发
    p(10, 3 + dy, 12, 1, C.hair); p(8, 4 + dy, 16, 1, C.hair); p(7, 5 + dy, 18, 4, C.hair);
    p(7, 5 + dy, 1, 4, C.hairSh); p(24, 5 + dy, 1, 4, C.hairSh); p(10, 5 + dy, 3, 1, C.hairHi);
    p(8, 9 + dy, 16, 1, C.hair);
    p(8, 10 + dy, 3, 1, C.hair); p(12, 10 + dy, 3, 1, C.hair); p(17, 10 + dy, 3, 1, C.hair); p(21, 10 + dy, 3, 1, C.hair);
    p(8, 11 + dy, 2, 1, C.hair); p(13, 11 + dy, 1, 1, C.hair); p(18, 11 + dy, 1, 1, C.hair); p(22, 11 + dy, 2, 1, C.hair);
    p(6, 9 + dy, 3, 18 - dy, C.hair); p(6, 9 + dy, 1, 18 - dy, C.hairSh); p(23, 9 + dy, 3, 18 - dy, C.hair); p(25, 9 + dy, 1, 18 - dy, C.hairSh);
    p(6, 25, 3, 2, C.hairTip); p(23, 25, 3, 2, C.hairTip);
    // 两侧的小鳍
    p(4, 7 + dy, 2, 3, C.fin); p(26, 7 + dy, 2, 3, C.fin);
    if (pose === 'sleep') { // 睡着时头上扣着个铁盆
      p(8, 1, 16, 4, C.basin); p(7, 4, 18, 1, C.basinDk); p(10, 2, 5, 1, C.basinHi); p(9, 1, 14, 1, C.basinHi);
    } else {
      // 女仆头饰，上面一片鲸鱼背鳍当呆毛
      p(9, 4 + dy, 14, 2, C.apron); p(9, 5 + dy, 14, 1, C.apronSh);
      for (const fx of [9, 12, 15, 18, 21]) p(fx, 3 + dy, 2, 1, C.apron);
      const tw = pose === 'think' && n % 4 < 2 ? 1 : 0;
      p(17 + tw, 0, 1, 1, C.fin); p(16 + tw, 1, 2, 1, C.fin); p(15, 2, 3, 1, C.fin); p(15, 2, 1, 1, C.finSh);
    }
    const ek = { conduct: 'look', work: 'look', think: 'think', wait: 'wide', done: 'happy', idle: pose === 'idle' && n % 10 === 5 ? 'closed' : 'happy', sleep: 'closed' }[pose];
    eyes(p, C, ek, dy);
    p(10, 16 + dy, 2, 1, C.blush); p(20, 16 + dy, 2, 1, C.blush);
    mouth(p, C, pose === 'wait' ? 'open' : pose === 'done' ? 'smile' : pose === 'idle' ? (n % 2 ? 'small' : 'chew') : 'small', dy);
    // 手和道具
    if (pose === 'work' || pose === 'conduct') { // 敲笔记本
      p(10, 22, 12, 8, C.lid); p(10, 22, 12, 1, C.lidHi); p(15, 25, 3, 2, C.fin); p(18, 24, 1, 1, C.fin);
      p(8, 27 + (n % 2), 2, 2, C.skin); p(22, 27 + ((n + 1) % 2), 2, 2, C.skin);
    } else if (pose === 'think') {
      p(21, 18, 2, 4, C.dress); p(20, 15, 2, 3, C.skin); p(9, 27, 3, 2, C.skin);
    } else if (pose === 'wait') { // 举手
      p(23, 12, 3, 9, C.dress); p(23, 9, 3, 3, C.skin); p(9, 27, 3, 2, C.skin);
    } else if (pose === 'done' || pose === 'idle') { // 捧着一碗白米饭；空闲时就在吃
      const by = pose === 'done' ? 21 : 24;
      p(11, by, 10, 4, C.bowl); p(11, by, 10, 1, C.rice); p(12, by + 2, 8, 1, '#7fa2e8');
      p(12, by - 2, 8, 2, C.rice); p(13, by - 3, 6, 1, C.rice);
      p(9, by + 1, 2, 2, C.skin); p(21, by + 1, 2, 2, C.skin);
      if (pose === 'idle') {
        if (n % 2) { p(19, 19, 1, 5, C.stick); p(20, 19, 1, 5, C.stick); p(18, 18, 2, 1, C.rice); }
        else { p(20, 17, 1, 6, C.stick); p(21, 17, 1, 6, C.stick); }
      }
    }
  }
  // 茶车：上层银色，金色栏杆，下层一把茶壶
  function trolley(r, pose, n) {
    if (pose === 'work' || pose === 'conduct') { r(36, 28, 5, 3, MAID.bowl); r(37, 27, 3, 1, MAID.rice); } // 边干活边惦记着饭
    r(5, 31, 38, 2, '#d7dce4'); r(5, 31, 38, 1, '#f1f3f7'); r(5, 33, 38, 1, GOLD);
    r(7, 34, 2, 10, '#9aa1ad'); r(39, 34, 2, 10, '#9aa1ad'); r(7, 40, 34, 2, '#c3c9d3'); r(7, 40, 34, 1, '#dde1e8');
    r(14, 36, 6, 4, '#f4f1ea'); r(20, 37, 2, 1, '#f4f1ea'); r(16, 35, 2, 1, '#f4f1ea'); r(15, 37, 4, 1, '#7fa2e8');
    r(27, 38, 3, 2, '#f4f1ea'); r(31, 38, 3, 2, '#f4f1ea');
    r(6, 44, 3, 2, '#3a3f4a'); r(39, 44, 3, 2, '#3a3f4a');
  }

  // ---------- 肖像画：Codex、Cursor 暂时用这个 ----------
  const off = document.createElement('canvas');
  function portrait(x, r, a, pose, n, cur, night) {
    r(14, 30, 2, 15, '#7d5238'); r(32, 30, 2, 15, '#7d5238'); r(23, 24, 2, 21, '#6b4630'); r(10, 30, 28, 2, '#8a5a3a');
    r(10, 2, 28, 28, GOLD_DK); r(11, 3, 26, 26, GOLD); r(12, 4, 24, 24, GOLD_DK);
    r(13, 5, 22, 22, night ? '#262a35' : '#efe6d2');
    for (const [cx, cy] of [[9, 1], [36, 1], [9, 28], [36, 28]]) { r(cx, cy, 3, 3, GOLD_HI); r(cx + 1, cy + 1, 1, 1, GOLD_DK); }
    r(19, 0, 10, 2, GOLD); r(22, -1, 4, 1, GOLD_HI);
    const st = { conduct: 'run', work: 'run', think: 'run', wait: 'wait', done: 'done', idle: 'idle', sleep: 'idle', error: 'wait' }[pose];
    if (M.Brand) { M.Brand.avatar(off, a, st, n, 1, cur); x.drawImage(off, 12, 5); }
    r(19, 27, 10, 2, GOLD); r(20, 27, 8, 1, GOLD_HI);
  }

  // 头顶的气泡：等你是“!”，在想是省略号，完成是勾，睡着是 z
  const GLY = { wait: ['.#.', '.#.', '.#.', '...', '.#.'], done: ['...', '..#', '#.#', '.#.', '...'], sleep: ['###', '..#', '.#.', '#..', '###'] };
  const BUBBLE_COL = { wait: '#e0543f', done: '#3f9a63', sleep: '#7d8799', think: '#7d8799' };
  function bubble(r, x, pose, n) {
    if (!GLY[pose] && pose !== 'think') return;
    if (pose === 'wait' && n % 2) return;
    r(39, 1, 9, 8, '#fffaf0'); r(40, 0, 7, 1, '#fffaf0'); r(39, 9, 2, 1, '#fffaf0'); r(38, 10, 1, 1, '#fffaf0');
    x.fillStyle = BUBBLE_COL[pose];
    if (pose === 'think') { for (let i = 0; i <= n % 3; i++) x.fillRect(40 + i * 3, 5, 2, 1); }
    else GLY[pose].forEach((row, y) => [...row].forEach((ch, i) => { if (ch === '#') x.fillRect(42 + i, 2 + y, 1, 1); }));
  }
  // 完成时旁边冒两颗小星星
  function sparkle(r, n) {
    const sp = (sx, sy, c) => { r(sx, sy - 1, 1, 3, c); r(sx - 1, sy, 3, 1, c); };
    sp(4, 6, n % 2 ? GOLD_HI : '#fff6d8'); if (n % 2) sp(44, 16, GOLD_HI);
  }

  // 一个工位。pose：conduct 指挥 / work 干活 / think 在想 / wait 等你 / done 完成 / idle 空闲 / sleep 睡着
  function station(c, a, pose, n, scale, opts = {}) {
    if (c.width !== W) { c.width = W; c.height = H; }
    c.style.width = W * scale + 'px'; c.style.height = H * scale + 'px';
    const x = c.getContext('2d'); x.clearRect(0, 0, W, H);
    const r = (px, py, w, h, col) => { x.fillStyle = col; x.fillRect(px, py, w, h); };
    const p = (px, py, w, h, col) => r(OX + px, OY + py, w, h, col);
    if (pose === 'error') pose = 'wait';
    if (a === 'claude') { lady(p, pose, n); desk(r, pose, n); }
    else if (a === 'dsh') { maid(p, pose, n); trolley(r, pose, n); }
    else { portrait(x, r, a, pose, n, opts.cur, opts.night); return; }
    bubble(r, x, pose, n);
    if (pose === 'done') sparkle(r, n);
  }

  // ---------- 洋馆大厅 ----------
  function bg(x, Wd, Hd, i, at, night) {
    const r = (px, py, w, h, c) => { x.fillStyle = c; x.fillRect(Math.round(px), Math.round(py), Math.round(w), Math.round(h)); };
    const fy = Math.round(Hd * .4), wy = fy - 16;
    const K = night
      ? { wall: '#3a3448', stripe: '#352f42', dot: '#4a4359', mold: '#5a4a3a', moldHi: '#6e5c46', wain: '#3b281f', wainHi: '#563a2b', panel: '#33231b', panelIn: '#3e2a20', floor: '#4a3122', floorLn: '#3e291d', rug: '#5a1f28', rugIn: '#6b2631', gold: '#9c8150', glass: '#18203f', curtain: '#5e1c27', curtainSh: '#481520' }
      : { wall: '#efe4cc', stripe: '#e6d8bb', dot: '#d8c59d', mold: '#b48a52', moldHi: '#d9b170', wain: '#6b4630', wainHi: '#8a5e40', panel: '#5c3c29', panelIn: '#6b4630', floor: '#8b5e3c', floorLn: '#7a5034', rug: '#8e2f3a', rugIn: '#a33a46', gold: '#d9b05c', glass: '#bfe0f6', curtain: '#9b2c3a', curtainSh: '#7a1f2c' };
    // 墙纸、顶上的线脚、下半截护墙板
    r(0, 0, Wd, fy, K.wall);
    for (let px = 0; px < Wd; px += 10) r(px, 0, 5, wy, K.stripe);
    for (let y = 12; y < wy - 6; y += 14) for (let px = (y / 14) % 2 ? 2 : 7; px < Wd; px += 10) { r(px, y, 1, 3, K.dot); r(px - 1, y + 1, 3, 1, K.dot); }
    r(0, 0, Wd, 4, K.mold); r(0, 4, Wd, 1, K.moldHi);
    r(0, wy, Wd, 16, K.wain); r(0, wy, Wd, 2, K.wainHi);
    for (let px = 5; px < Wd - 20; px += 30) { r(px, wy + 4, 24, 9, K.panel); r(px + 1, wy + 5, 22, 7, K.panelIn); }
    r(0, fy - 3, Wd, 3, K.panel);
    // 人字纹地板
    r(0, fy, Wd, Hd - fy, K.floor);
    for (let y = fy; y < Hd; y += 4) for (let px = ((y - fy) / 4) % 2 ? 0 : 6; px < Wd; px += 12) { r(px, y, 6, 1, K.floorLn); r(px + 6, y + 1, 1, 3, K.floorLn); }
    // 横穿地板的红地毯
    const cy = fy + Math.round((Hd - fy) * .5);
    r(0, cy, Wd, 14, K.rug); r(0, cy + 2, Wd, 10, K.rugIn); r(0, cy, Wd, 1, K.gold); r(0, cy + 13, Wd, 1, K.gold);
    for (let px = 4; px < Wd; px += 12) r(px, cy + 6, 2, 2, K.gold);
    // 两扇拱形窗：白天是蓝天和阳光，夜里是星星和月亮
    const wins = (i % 2 ? [.22, .78] : [.16, .84]).map(f => Math.round(Wd * f));
    wins.forEach((wx, k) => {
      const top = 9, ww = 22, wh = Math.max(18, wy - 12);
      r(wx - ww / 2 - 2, top - 2, ww + 4, wh + 4, K.panel);
      r(wx - ww / 2, top + 4, ww, wh - 4, K.glass); r(wx - ww / 2 + 3, top + 1, ww - 6, 3, K.glass); r(wx - ww / 2 + 1, top + 2, ww - 2, 2, K.glass);
      if (night) {
        for (let s = 0; s < 6; s++) r(wx - ww / 2 + 3 + ((s * 7 + k * 5) % (ww - 5)), top + 6 + ((s * 11) % (wh - 14)), 1, 1, '#e8e4ff');
        if (k === 1) { r(wx + 3, top + 8, 5, 5, '#f3e7c4'); r(wx + 5, top + 8, 3, 3, K.glass); }
      } else {
        r(wx - ww / 2 + 2, top + 12, 9, 2, '#ffffff'); r(wx - ww / 2 + 4, top + 11, 5, 1, '#ffffff'); r(wx - ww / 2 + 2, top + 4, ww - 4, 1, '#d8eefc');
      }
      r(wx - 1, top + 1, 2, wh - 1, K.panel); r(wx - ww / 2, top + Math.round(wh / 2), ww, 2, K.panel);
      r(wx - ww / 2 - 3, top + wh, ww + 6, 2, K.mold);
      // 窗帘和金色束带
      r(wx - ww / 2 - 6, top - 4, 7, wh + 10, K.curtain); r(wx + ww / 2 - 1, top - 4, 7, wh + 10, K.curtain);
      r(wx - ww / 2 - 6, top - 4, 2, wh + 10, K.curtainSh); r(wx + ww / 2 + 4, top - 4, 2, wh + 10, K.curtainSh);
      r(wx - ww / 2 - 7, top + Math.round(wh * .6), 8, 2, K.gold); r(wx + ww / 2 - 1, top + Math.round(wh * .6), 8, 2, K.gold);
      r(wx - ww / 2 - 8, top - 6, ww + 16, 3, K.curtainSh); r(wx - ww / 2 - 8, top - 6, ww + 16, 1, K.gold);
      if (!night) { // 阳光斜照到地板上
        x.fillStyle = 'rgba(255,248,220,.13)';
        x.beginPath(); x.moveTo(wx - ww / 2, fy); x.lineTo(wx + ww / 2, fy); x.lineTo(wx + ww / 2 + 46, Hd); x.lineTo(wx - ww / 2 + 30, Hd); x.closePath(); x.fill();
      }
    });
    // 墙上两幅小画
    for (const f of [.36, .64]) { const px = Math.round(Wd * f); if (wy < 34) continue; r(px - 8, 16, 16, 12, K.gold); r(px - 6, 18, 12, 8, night ? '#2d3a4a' : '#7fa7c9'); r(px - 6, 23, 12, 3, night ? '#2c3d2c' : '#6d9a5c'); }
    // 吊灯：夜里亮起来，地上照出一圈暖光
    const cx = Math.round(Wd / 2);
    r(cx, 0, 1, 9, K.gold); r(cx - 9, 9, 19, 2, K.gold); r(cx - 6, 11, 13, 2, K.gold); r(cx - 2, 13, 5, 2, K.gold);
    for (const dx of [-9, -4, 4, 9]) { r(cx + dx, 6, 1, 3, '#fff4d6'); r(cx + dx, 5, 1, 1, '#ffcf6b'); }
    if (night) {
      const g = x.createRadialGradient(cx, 12, 2, cx, 12, 90); g.addColorStop(0, 'rgba(255,207,120,.28)'); g.addColorStop(1, 'rgba(255,207,120,0)');
      x.fillStyle = g; x.fillRect(cx - 90, 0, 180, 110);
    }
    // 指挥脚下一块圆地毯
    const [lx, ly] = at, ry = Math.min(Hd - 8, Math.max(fy + 6, ly));
    r(lx - 30, ry - 6, 60, 12, K.rug); r(lx - 34, ry - 4, 68, 8, K.rug); r(lx - 28, ry - 4, 56, 8, K.rugIn);
    r(lx - 34, ry - 4, 68, 1, K.gold); r(lx - 34, ry + 3, 68, 1, K.gold); r(lx - 3, ry - 2, 6, 4, K.gold);
  }

  M.Manor = { station, bg, W, H };
})();
