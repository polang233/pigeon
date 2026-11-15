// 办公室样式：每个 agent 一个工位，显示器、桌子、坐在桌后的角色，头顶气泡表示状态。还是早先的画法，没有跟着新功能改。
import { $$, canvasFace, eachScene, clearHall } from './common.js';

function officeBg(x, W, H, i, at) {
  const r = (px, py, w, h, c) => { x.fillStyle = c; x.fillRect(Math.round(px), Math.round(py), Math.round(w), Math.round(h)); };
  const wy = Math.round(H * .34);
  r(0, 0, W, wy, '#1d2b38');
  for (let y = 6; y < wy - 4; y += 12) for (let px = (y / 12) % 2 ? 4 : 10; px < W; px += 12) r(px, y, 1, 1, '#24364a');
  r(0, wy - 4, W, 4, '#16202b');
  r(0, wy, W, H - wy, '#3a2a22');
  for (let y = wy + 6; y < H; y += 8) r(0, y, W, 1, '#2f221b');
  for (let y = wy, k = 0; y < H; y += 8, k++) for (let px = (k % 2) * 24; px < W; px += 48) r(px, y, 1, 8, '#2f221b');
  const wx = i % 2 ? 14 : W - 62; // 窗户
  r(wx, 18, 44, 34, '#0e151d'); r(wx + 2, 20, 40, 30, '#24405a'); r(wx + 21, 20, 2, 30, '#0e151d'); r(wx + 2, 34, 40, 2, '#0e151d'); r(wx + 30, 24, 5, 5, '#ffe9a8');
  const cx = at[0], cy = Math.min(H - 20, Math.max(wy + 20, at[1]));
  r(cx - 46, cy - 18, 92, 36, '#4a3550'); r(cx - 44, cy - 16, 88, 32, '#5a4060');
  for (let px = cx - 42; px < cx + 42; px += 6) r(px, cy - 14, 2, 1, '#6c4f72'), r(px + 3, cy + 13, 2, 1, '#6c4f72');
  const plant = px => { r(px, wy - 14, 8, 8, '#2f6b48'); r(px + 2, wy - 18, 4, 5, '#3f8a5c'); r(px + 1, wy - 6, 6, 6, '#8a5a3a'); };
  plant(i % 2 ? W - 30 : 22);
}

export default {
  face: (n, s, pose) => canvasFace(n, s, pose),
  paint(view) {
    const Brand = window.Pigeon.Brand, scale = view.clientWidth < 700 ? 2 : 3;
    return $$('canvas.av', view).map(c => {
      const big = c.closest('[data-center]') ? 1 : 0;
      return { draw: n => Brand.station(c, c.dataset.a, c.dataset.s, n, scale + big) };
    });
  },
  bg(view) { clearHall(view); eachScene(view, officeBg); },
};
