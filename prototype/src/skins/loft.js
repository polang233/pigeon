// 鸽舍样式：沿用 web/js/loft-art.js 里原来的屋顶和鸽子（art/loft-art.js 是指过去的软链接），每只鸽子右下角挂它家的小标志。
// 还是早先的画法，没有跟着新功能改。
import { html } from '../html.js';
import { brand } from '../icons.js';
import { $$, canvasFace, eachScene, clearHall } from './common.js';

function loftBg(x, W, H, i) {
  const A = window.Pigeon.LoftArt, hy = Math.round(H * .46);
  A.sky(x, W, hy + 14);
  A.sun(x, Math.round(W * (i % 2 ? .28 : .72)), hy - 3, Math.max(10, Math.round(H * .07)));
  A.farCity(x, W, hy, []);
  A.midCity(x, W, hy + 8, H);
  A.nearRoof(x, W, Math.round(H * .72), H);
}

export default {
  face: (n, s, pose) => html`${canvasFace(n, s, pose)}<span class="badge-logo">${brand(n.a)}</span>`,
  paint(view) {
    const A = window.Pigeon?.LoftArt;
    if (!A) return [];
    const scale = view.clientWidth < 700 ? 2 : 3;
    return $$('canvas.av', view).map(c => {
      const a = c.dataset.a, s = c.dataset.s, big = c.closest('[data-center]') ? 1 : 0;
      const b = A.breed(a === 'dsh' ? 'deepseek' : a);
      const fr = s === 'run' ? [b.stand, b.peck] : s === 'wait' ? [b.flare, b.stand] : s === 'idle' ? [b.sleep] : [b.stand, b.blink];
      return { draw: n => {
        const sp = fr[n % fr.length], w = Math.max(sp.w + 4, 22), h = sp.h + 4;
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        c.style.width = w * (scale + big) + 'px'; c.style.height = h * (scale + big) + 'px';
        const x = c.getContext('2d'); x.clearRect(0, 0, w, h);
        x.drawImage(sp.c, Math.round((w - sp.w) / 2), 0);
        x.fillStyle = '#76574f'; x.fillRect(0, sp.h - 1, w, 2); x.fillStyle = '#4a3640'; x.fillRect(0, sp.h + 1, w, 1); x.fillStyle = '#de8a72'; x.fillRect(0, sp.h - 1, w, 1);
      } };
    });
  },
  bg(view) { clearHall(view); eachScene(view, loftBg); },
};
