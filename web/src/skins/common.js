// 三种实验样式（洋馆、办公室、鸽舍）共用的一点东西。简洁样式不用这个目录里的任何文件。
// 一个样式模块默认导出 { face(节点, 状态, 动作) → 头像标记, paint(舞台, ctx) → 要逐帧画的列表, bg(舞台, ctx) → 画背景 }，
// ctx 是 { hex(变量名) 读当前配色, isDark() 是不是深色 }。逐帧画的每一项是 { every 隔几拍画一次（默认 3）, draw(第几帧) }。
import { html } from '../html.js';

export const $$ = (s, el) => [...el.querySelectorAll(s)];
// 背景一格几个屏幕像素
export const PXS = 3;
// 头像画在 canvas 里：data-a 哪家，data-s 状态，data-pose 洋馆的动作
export const canvasFace = (n, s, pose) => html`<canvas class="av" data-a="${n.a}" data-s="${s}" data-pose="${pose}"></canvas>`;
// 每一页的背景 canvas：按舞台大小铺满，at 是指挥的位置（地毯要对着它）
export function eachScene(view, draw) {
  const W = Math.ceil(view.clientWidth / PXS), H = Math.ceil(view.clientHeight / PXS);
  $$('canvas.scene', view).forEach((c, i) => {
    const orbit = c.parentNode.querySelector('.orbit'), lead = orbit.querySelector('.node[data-center]');
    const at = [(orbit.offsetLeft + lead.offsetLeft) / PXS, (orbit.offsetTop + lead.offsetTop + lead.offsetHeight / 2 - 4) / PXS];
    c.width = W; c.height = H;
    try { draw(c.getContext('2d'), W, H, i, at); } catch (e) { console.warn('背景没画出来', e); }
  });
}
// 换回不用插画背景的样子
export function clearHall(view) {
  view.classList.remove('has-hall');
  $$('.page', view).forEach(pg => { pg.style.backgroundImage = ''; pg.classList.remove('night-tint'); });
}
