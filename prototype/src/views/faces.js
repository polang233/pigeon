// 简洁样式里会动的头像。pose 是 core/pages.js 的 poseOf 给的动作名（照 clawd-tank 的十个动作）。
// - Claude Code 用 clawd-tank 的 SVG 动画（MIT，见 art/clawd-tank/），DeepSeek 用照它的动作换了身子的像素鲸鱼（art/crew/，tools/crew_svg.py 生成）。
//   所有动作用同一个取景框对到头像上。
// - Codex 用它应用里自带的宠物（art/local/，不提交，版权归 OpenAI，正式版不能内置）。Codex 宠物的格式：每帧 192×208，8 列，一行一个动作；
//   新版 11 行（多了两行看向各个方向），旧版 9 行。加载不到（离线、文件不在）就退回标志。
// - Cursor 没有宠物，放它的像素标志，按状态动一动。
import { html } from '../html.js';
import { brand } from '../icons.js';

const CLAWD_VB = { happy: [-12, -15, 40], sleeping: [-10, -20, 40] }, CLAWD_WIN = [-4.5, -7.5, 24];
const PET = { codex: { url: 'art/local/codex-pet.webp', rows: 11, idle: 7 } };
// 动作：[行, 帧数, 一轮几秒]；待机那行的帧数各只宠物不一样，见上面的 idle
const PET_ROW = { idle: [0, 6, 1.1], wave: [3, 4, .7], jump: [4, 5, .84], fail: [5, 8, 1.22], wait: [6, 6, 1.01], run: [7, 6, .82], review: [8, 6, 1.03] };
const PET_POSE = { 'working-conducting': 'wave', 'working-thinking': 'review', 'working-confused': 'fail', notification: 'wait', happy: 'jump', 'idle-living': 'idle', sleeping: 'idle' };
// 图改过就把这里加一，免得浏览器用缓存里的旧图：DeepSeek 的鲸鱼重新生成后改 CREW_V，clawd-tank 的副本改过后改 CLAWD_V
const CREW_V = 5, CLAWD_V = 2;

// 先试着加载宠物图，加载不到就记下来（onBad 会让指挥台重画）
export function preloadPets(onBad) {
  for (const a in PET) { const im = new Image(); im.onerror = () => onBad(a); im.src = PET[a].url; }
}

export function plainFace(n, pose, petBad) {
  const asleep = pose === 'sleeping' ? 'asleep' : '';
  if (PET[n.a] && !petBad[n.a]) {
    const P = PET[n.a], name = PET_POSE[pose] || 'run', [row, k0, d] = PET_ROW[name], k = name === 'idle' ? P.idle : k0;
    return html`<span class="pet ${asleep}" style="--sheet:url(${P.url});--rows:${P.rows};--row:${row};--n:${k};--d:${d}s"></span>`;
  }
  if (n.a !== 'claude' && n.a !== 'dsh') return html`<span class="lgface ${asleep} lg-${PET_POSE[pose] || 'run'}">${brand(n.a)}</span>`;
  const [vx, vy, vw] = CLAWD_VB[pose] || [-15, -25, 45], [wx, wy, ws] = CLAWD_WIN;
  const pct = v => (v * 100).toFixed(2) + '%';
  return html`<span class="clawd" style="--vw:${pct(vw / ws)};--vl:${pct((vx - wx) / ws)};--vt:${pct((vy - wy) / ws)}"><img src="${n.a === 'dsh' ? `art/crew/dsh-${pose}.svg?v=${CREW_V}` : `art/clawd-tank/clawd-${pose}.svg?v=${CLAWD_V}`}" alt="" draggable="false"></span>`;
}
