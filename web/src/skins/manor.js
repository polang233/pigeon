// 洋馆样式：Claude 大小姐指挥大家干活的一座洋馆大厅。人物和背景是 Codex 画的动漫插画（art/manor/），
// 没有立绘的 agent、或者大厅图缺失时，用 art/manor.js 里自己画的像素人物和像素大厅顶上。
import { html } from '../html.js';
import { $$, canvasFace, eachScene } from './common.js';

// clawd-tank 的动作名 → 洋馆的九个状态
const MANOR_POSE = { 'working-conducting': 'conduct', 'working-juggling': 'work', 'working-typing': 'work', 'working-building': 'work', 'working-thinking': 'think', notification: 'wait', happy: 'done', 'idle-living': 'idle', sleeping: 'sleep', 'working-confused': 'error' };
// 大厅的背景插画，浅色用白天版、深色用夜晚版。没有夜晚版时，夜里用白天版压暗、偏蓝
const MANOR_HALL = { day: 'art/manor/hall-day.jpg', night: 'art/manor/hall-night.jpg' };
// 已经有 Q 版立绘的 agent（art/manor/<agent>/<动作>.png，由 tools/slice_sheet.py 从九宫格切出来）。
// 值是图的宽高，写进 img 好让排布在图片加载前就知道比例
const MANOR_ART = new Map([['claude', [375, 401]], ['dsh', [363, 405]], ['cursor', [283, 317]], ['codex', [390, 412]]]);

export default {
  face(n, s, pose) {
    const p = MANOR_POSE[pose];
    if (!MANOR_ART.has(n.a)) return canvasFace(n, s, p);
    const [w, h] = MANOR_ART.get(n.a);
    return html`<span class="chibi pose-${p}"><img src="art/manor/${n.a}/${p}.png" width="${w}" height="${h}" alt="" draggable="false"></span>`;
  },
  paint(view, { hex, isDark }) {
    const M = window.Pigeon?.Manor;
    if (!M) return [];
    const cur = hex('text'), night = isDark();
    return $$('canvas.av', view).map(c => {
      const node = c.closest('.node'), scale = node.matches('[data-center]') && view.clientWidth >= 560 ? 3 : 2;
      return { every: 1, draw: n => M.station(c, c.dataset.a, c.dataset.pose, n + (+node.dataset.k || 0) * 3, scale, { cur, night }) };
    });
  },
  bg(view, { isDark }) {
    const night = isDark();
    if (MANOR_HALL.day) {
      const url = night && MANOR_HALL.night ? MANOR_HALL.night : MANOR_HALL.day;
      view.classList.add('has-hall');
      $$('.page', view).forEach(pg => { pg.style.backgroundImage = `url(${url})`; pg.classList.toggle('night-tint', night && !MANOR_HALL.night); });
      return;
    }
    eachScene(view, (x, W, H, i, at) => window.Pigeon.Manor.bg(x, W, H, i, at, night));
  },
};
