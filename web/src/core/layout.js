// 指挥台的排布和连线的形状。纯几何，不碰 DOM（测试见 test/layout.test.mjs）。
// 一张看不见的网格：指挥在最左边，往右一列一层，像往右边发任务；一层里从上往下排，父节点放在它的孩子中间。
// 收起的远程设备占横着两格。节点不能拖，一律按这里算出来的格子放。

// 网格多大：舞台宽高 W×H，普通节点最大 nw×nh（已乘过 z），leaves 是叶子节点数
export const zoomOf = (W, H) => Math.max(1, Math.min(1.3, W / 880, H / 500));
export function gridOf(W, H, nw, nh, z, leaves) {
  const cw = nw + 26 * z;
  // 一列里要排的节点比放得下的多时，行距收一收，允许稍微挨得近一点
  const ch = Math.min(nh + 12 * z, Math.max(H / Math.max(1, leaves), nh * .9));
  const cols = Math.max(3, Math.floor(W / cw)), rows = Math.max(2, Math.floor(H / ch));
  return { W, H, z, cw, ch, cols, rows, ox: (W - cols * cw) / 2 + cw / 2, oy: (H - rows * ch) / 2 + ch / 2 };
}
// 叶子：没有别的节点挂在它下面
export const leavesOf = p => p.nodes.filter((_, j) => !p.nodes.some(n => n.from === j)).length;

// 每个节点默认放在哪一格：[[列, 行], …]，第一个是中心（指挥或指挥那台的卡片），后面按 p.nodes 的顺序
export function defaultCells(p, cols, rows) {
  const N = p.nodes, kidsOf = i => N.map((n, j) => n.from === i ? j : -1).filter(j => j >= 0);
  const depth = i => i < 0 ? 0 : depth(N[i].from) + 1;
  const maxD = Math.max(1, ...N.map((_, i) => depth(i)));
  // 列：够宽时隔一列放，铺得开一点；不够宽时挤一挤
  const wide = N.some(n => n.kind === 'group') ? 1 : 0, lw = p.center.kind === 'group' ? 1 : 0;
  const step = Math.max(1, Math.min(2, Math.floor((cols - 1 - wide - lw) / maxD))), used = maxD * step + 1 + wide + lw;
  const left = Math.max(0, Math.floor((cols - used) / 2));
  const col = d => used <= cols ? left + (d ? lw : 0) + d * step : d ? lw + Math.round(d * (cols - 1 - wide - lw) / maxD) : 0;
  // 行：叶子从上往下排，父节点放在它的孩子中间
  const rowF = {}; let next = 0;
  const visit = i => { const k = kidsOf(i); if (!k.length) return (rowF[i] = next++); const rs = k.map(visit); return (rowF[i] = (Math.min(...rs) + Math.max(...rs)) / 2); };
  visit(-1);
  const span = Math.max(1, next), s = span > rows ? (rows - 1) / Math.max(1, span - 1) : 1, top = Math.floor((rows - Math.min(span, rows)) / 2);
  const row = f => top + Math.round(f * s);
  return [[col(0), row(rowF[-1])], ...N.map((_, i) => [col(depth(i)), row(rowF[i])])];
}

export const cellsOf = ([c, r], span) => Array.from({ length: span }, (_, j) => `${c + j},${r}`);
export const clampCell = (G, [c, r], span = 1) => [Math.max(0, Math.min(G.cols - span, c)), Math.max(0, Math.min(G.rows - 1, r))];
// 这个格子被占了，就找离它最近的空格子（占两格的要两格都空）；一个空的都没有返回 null
export function freeCell(G, c, taken, span = 1) {
  c = clampCell(G, c, span);
  if (!cellsOf(c, span).some(x => taken.has(x))) return c;
  let best = null, bd = Infinity;
  for (let x = 0; x <= G.cols - span; x++) for (let y = 0; y < G.rows; y++) {
    if (cellsOf([x, y], span).some(q => taken.has(q))) continue;
    const d = Math.hypot(x - c[0], (y - c[1]) * 1.2);
    if (d < bd) { bd = d; best = [x, y]; }
  }
  return best;
}
// 格子中心的像素坐标
export const cellXY = (G, [c, r], span = 1) => [G.ox + (c + (span - 1) / 2) * G.cw, G.oy + r * G.ch];

// 按默认格子逐个放下去，撞了就找最近的空格。spans 是每个节点占几格（和 defaultCells 的顺序一样）。
// 地方不够放两格的卡片缩成一格（compact），里面的 logo 变小
export function placeCells(G, p, spans) {
  const def = defaultCells(p, G.cols, G.rows), taken = new Set();
  return def.map((want, k) => {
    let span = spans[k], compact = false, c = freeCell(G, want, taken, span);
    if (!c && span === 2) { span = 1; compact = true; c = freeCell(G, want, taken, 1); }
    c ||= clampCell(G, want, span);
    cellsOf(c, span).forEach(q => taken.add(q));
    return { c, span, compact };
  });
}

// 一条连线的路径。a、c 是两头头像的中心和半径 {cx, cy, rx, ry}，z 是缩放。
// 像素折线：从头像右边出发，拐一个圆角的弯进到下一个头像的左边；上下排着时从下边出发进到上边。arc 是上一版的弧线。
// 返回 { d: SVG 路径, left: 是不是往左走, g: 渐变的起止点 }
export function edgePath(a, c, z, arc) {
  if (arc) {
    const [x1, y1, x2, y2] = [a.cx, a.cy, c.cx, c.cy], mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, k = Math.min(36, L * .16);
    let qx = mx + dy / L * k, qy = my - dx / L * k;
    if (qy > my) { qx = mx - dy / L * k; qy = my + dx / L * k; }
    return { d: `M${x1},${y1} Q${qx},${qy} ${x2},${y2}`, left: x2 < x1, g: [x1, y1, x2, y2] };
  }
  const vert = Math.abs(c.cx - a.cx) < a.rx + c.rx + 16 * z;
  if (vert) {
    const sy = Math.sign(c.cy - a.cy) || 1, x1 = a.cx, y1 = a.cy + sy * (a.ry + 4), x2 = c.cx, y2 = c.cy - sy * (c.ry + 4);
    const my = (y1 + y2) / 2, sx = Math.sign(x2 - x1), rr = Math.min(12 * z, Math.abs(x2 - x1) / 2, Math.abs(my - y1));
    const d = Math.abs(x2 - x1) < 2 ? `M${x1},${y1} V${y2}` : `M${x1},${y1} V${my - sy * rr} Q${x1},${my} ${x1 + sx * rr},${my} H${x2 - sx * rr} Q${x2},${my} ${x2},${my + sy * rr} V${y2}`;
    return { d, left: false, g: [x1, y1, x2, y2] };
  }
  const sx = Math.sign(c.cx - a.cx), x1 = a.cx + sx * (a.rx + 5), y1 = a.cy, x2 = c.cx - sx * (c.rx + 5), y2 = c.cy;
  const mx = (x1 + x2) / 2, sy = Math.sign(y2 - y1), rr = Math.min(14 * z, Math.abs(y2 - y1) / 2, Math.abs(mx - x1));
  const d = Math.abs(y2 - y1) < 2 ? `M${x1},${y1} H${x2}` : `M${x1},${y1} H${mx - sx * rr} Q${mx},${y1} ${mx},${y1 + sy * rr} V${y2 - sy * rr} Q${mx},${y2} ${mx + sx * rr},${y2} H${x2}`;
  return { d, left: sx < 0, g: [x1, y1, x2, y2] };
}
