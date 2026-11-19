// 指挥台：一台设备一页，底部翻页。画面只放身份和状态：会动的形象、名字、模型、一排小圆点（每个点是一个对话）。
// 在做什么留给悬停提示、右侧详情和底部轮播。任务是沿着连线飞的信鸽，颜色跟着发信的那个 agent。
// 别的电脑在指挥那一页上默认收成一张卡片，点卡片右上角的按钮展开，展开后那块底右上角的按钮收起。节点按 core/layout.js 自动排，不能拖。
//
// 这一页分几块，各自按话题重画：
//   head      页头（全部暂停、派活）                 paused
//   pausebar  暂停时舞台顶上的横幅                   paused
//   view      舞台：场景、每页的节点和连线、悬停提示  设备、指挥、对话、任务、展开收起、外观类设置、图片加载失败；额度只在“一直显示”时
//   pagerbar  底部的设备标签                         设备、对话、暂停
//   ticker    底部轮播                               任务、对话、暂停、翻页
//   insp      右侧详情                               选中、指挥、对话、任务、设备
// 简洁样式不依赖 skins/ 里的任何模块；选了实验样式才按需加载。
import { html, raw, bool } from '../html.js';
import { svg, IC, icon, Brand, brand } from '../icons.js';
import { $, $$, patch, part, reduce } from '../dom.js';
import { whileVisible } from '../visible.js';
import { AG, ST, TS, TH, ACT, LIVE } from '../core/labels.js';
import { by, cross, kids, worst, shortDev, jumpLabel, isPaused, isYou, leadSession, leadKey, canLead, canTake, online } from '../core/names.js';
import { pagesOf, stateOf, parentOf, edgeOf, modelOf, poseOf, pageSessions, events } from '../core/pages.js';
import { zoomOf, gridOf, leavesOf, placeCells, cellXY, edgePath } from '../core/layout.js';
import { qc } from '../core/quota.js';
import { rst } from '../core/time.js';
import { g, stTag, taskSt, devIc, devBadge, quotaDisc, modelTag, LINK, icOf } from './parts.js';
import { plainFace, preloadPets } from './faces.js';
import { registerAll, onKey } from '../actions.js';
import { startRename } from './rename.js';
import { toast, after } from './toast.js';

let store, st, ui, root = null;
let PAGES = [];
const GEO = [];

// 当前配色里的颜色（连线渐变、鸽子要用实色）
const hex = a => getComputedStyle(document.documentElement).getPropertyValue('--' + a).trim() || '#999999';
const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
const skinName = () => st.settings.skin || 'plain';

/* ---------- 实验样式：按需加载 skins/ ---------- */
const SKINS = {};
function skinMod(name) {
  if (name === 'plain' || SKINS[name]) return SKINS[name] || null;
  SKINS[name] = null;
  import(`../skins/${name}.js`).then(
    m => { SKINS[name] = m.default; if (root && skinName() === name) drawView(); },
    e => { console.warn('样式没加载出来，先用简洁', e); SKINS[name] = 'bad'; if (root) drawView(); });
  return null;
}
// 当前要用的样式模块；还在加载返回 undefined，用简洁（或加载失败）返回 null
function skinNow() {
  const n = skinName();
  if (n === 'plain') return null;
  if (!(n in SKINS)) skinMod(n);
  const m = SKINS[n];
  return m === 'bad' ? null : m === null ? undefined : m;
}

/* ---------- 节点 ---------- */
const selAttrs = sel => sel.t === 'session' ? html`data-action="select" data-t="session" data-id="${sel.id}"` : sel.t === 'you' ? html`data-action="select" data-t="you"` : html`data-action="select" data-t="agent" data-a="${sel.a}" data-dev="${sel.d}"`;
const selOf = d => d.t === 'session' ? { t: 'session', id: d.id } : d.t === 'you' ? { t: 'you' } : { t: 'agent', a: d.a, d: d.dev };
const sameSel = (a, b) => a.t === b.t && (a.t === 'session' ? a.id === b.id : a.t === 'you' || (a.a === b.a && a.d === b.d));
// 状态旁边的小标：等你、出错、入口、刚完成
const flagOf = (s, n, err) => s === 'wait' ? html`<i class="flag wait" data-tip="有一件事等你确认">!</i>`
  : s === 'error' ? html`<i class="flag err" data-tip="出错：${err || '看详情'}">×</i>`
  : n.gate ? html`<i class="flag gate" data-tip="入口：这台电脑只连了 ${AG[n.a].name}，别的 agent 经它带起">${icon('door')}</i>`
  : s === 'done' ? html`<i class="flag ok" data-tip="刚完成，回信到了">✓</i>` : '';
const errOf = n => n.ids.map(id => by(st, id)).find(x => x.state === 'error')?.error;

const pips = ids => {
  const top = ids.map(id => by(st, id)).filter(s => !ids.includes(s.parent));
  return html`<span class="pips">${top.slice(0, 5).map(s => html`<i class="pip ${s.state}" style="--s:${ST[s.state][1]}"></i>${kids(st, s).filter(k => ids.includes(k.id)).map(k => html`<i class="pip kid ${k.state}" style="--s:${ST[k.state][1]}"></i>`)}`)}${top.length > 5 ? html`<em>+${top.length - 5}</em>` : ''}</span>`;
};

// 收起来的设备：一张占两格的卡片，里面只有 logo 和框。host 是别的设备那页上，指挥所在那台收成的卡片（不能展开）
function groupHTML(n, k) {
  const s = worst(n.ids.map(id => by(st, id))), L = LINK[n.link], center = k == null, LA = n.host && !isYou(st) ? st.lead.agent : '', off = !online(st, n.dev);
  const mini = a => {
    const ss = st.S.filter(x => x.dev === n.dev && x.agent === a), s2 = ss.length ? worst(ss) : 'idle', c = st.CONN[n.dev].find(x => x.a === a) || {};
    const role = n.host ? (a === LA ? ' · 指挥' : a === n.via ? ' · 经它连到这台' : '') : c.role === 'gate' ? ' · 入口' : '';
    const badge = n.host ? (a === LA ? html`<i class="gdoor glead">${icon('stage')}</i>` : '') : c.role === 'gate' ? html`<i class="gdoor">${icon('door')}</i>` : '';
    return html`<span class="gmini st-${s2}" data-tip="${AG[a].name}${role} · ${ST[s2][0]}">${brand(a)}${badge}</span>`;
  };
  return html`<div class="node k-group ${n.host ? 'host' : ''} ${off ? 'offline' : ''} st-${s}" ${center ? raw('data-center') : html`data-k="${k}"`} data-action="go-dev" data-dev="${n.go}" role="button" tabindex="0" aria-label="${n.label}${off ? '，连不上' : ''}，已收起，回车翻到这台">
    <div class="gcard"><header><span class="gdev">${devIc(st, n.dev)}</span><b>${n.label}</b><span class="glink" data-tip="${L.label}：${L.tip}">${icOf(L)}</span><span class="sp"></span>${off ? html`<i class="flag err" data-tip="连不上">×</i>` : s === 'wait' || s === 'error' ? flagOf(s, n, errOf(n)) : ''}${n.host ? '' : html`<button type="button" class="gx" data-action="open-dev" data-dev="${n.dev}" data-tip="展开" aria-label="展开 ${n.label}">${icon('unfold')}</button>`}</header>
      <div class="gminis">${n.agents.map(mini)}</div></div></div>`;
}

// 你自己当指挥：中心画一只信鸽和“你”
const youHTML = sk => html`<button type="button" class="node k-lead k-you" data-center ${selAttrs({ t: 'you' })} aria-label="你，指挥">
    <span class="ava">${sk ? '' : raw('<i class="perch" aria-hidden="true"></i>')}<span class="youface">${icon('bird')}</span></span>
    <span class="nm">你</span><span class="mdl"><span>自己派活</span></span></button>`;
function nodeHTML(n, k, sk) {
  if (n.kind === 'group') return groupHTML(n, k);
  if (n.kind === 'you') return youHTML(sk);
  const s = stateOf(st, n), center = k == null, pose = poseOf(st, n, s);
  const face = sk ? sk.face(n, s, pose) : plainFace(n, pose, ui.petBad);
  const flag = flagOf(s, n, s === 'error' ? errOf(n) : '');
  const away = n.kind === 'relay' || n.remote || (n.remoteOf && n.gate);
  const corner = away ? html`<i class="corner" data-tip="在 ${st.DEV[n.dev].name}">${devIc(st, n.dev)}</i>` : '';
  const perch = center && !sk ? raw('<i class="perch" aria-hidden="true"></i>') : '';
  return html`<button type="button" class="node k-${n.kind} st-${s} ${n.via ? 'via' : ''} ${n.remoteOf ? 'remote' : ''}" ${center ? raw('data-center') : html`data-k="${k}"`}
      ${selAttrs(n.sel)} aria-label="${n.label}">
      <span class="ava">${perch}${face}${flag}${corner}${st.settings.quota === 'always' ? quotaDisc(st, n.a, n.dev || st.home) : ''}</span>
      <span class="nm">${n.label}</span>${modelTag(modelOf(st, n))}${pips(n.ids)}
    </button>`;
}
// 一只鸽子：会自己动的 SVG 做背景
const bird = (a, cls, k) => { const p = Brand().pigeon(hex(a === 'you' ? 'accent' : a), cls === 'wait' ? 'hover' : 'fly'); return html`<i class="pg ${cls}" data-k="${k}" style="--sheet:${p.url};--fw:${p.w * 1.6}px;--fh:${p.h * 1.6}px"></i>`; };

function pageHTML(p, i, sk) {
  const off = !online(st, p.key), only = PAGES.length === 1;
  return html`<section class="page ${i === ui.stage.page ? 'on' : ''} ${isPaused(st, p.key) ? 'paused' : ''}" aria-label="${p.title}" data-i="${i}" ${i === ui.stage.page ? '' : raw('inert')}>
    <canvas class="scene" aria-hidden="true"></canvas>
    <div class="page-title"><span class="g dev">${svg(IC[p.os])}</span><h2>${p.title}</h2></div>
    ${off ? html`<div class="offbar" role="status">${icon('x')}<span><b>连不上 ${p.title}</b>往这台派的活发不出去，会记成“连不上，没发出”</span><button class="ghost" type="button" data-action="reconnect" data-dev="${p.key}" ${st.mode === 'live' ? raw('data-tip="经中继对话重新读一次远程电脑，要花一些 token"') : ''}>${st.mode === 'live' ? '重新读一次' : '重试'}</button></div>` : ''}
    ${only ? html`<div class="emptyhint"><span>只有这台电脑。要把活派到别的电脑上，先添加一台。</span><button class="ghost" type="button" data-action="adddev">${icon('plus')}添加设备</button></div>` : ''}
    <div class="orbit"><svg class="wires" aria-hidden="true"></svg>
      ${p.nodes.map((n, k) => { const e = edgeOf(st, p, k); return e.st ? bird(e.a, e.st, k) : ''; })}
      ${nodeHTML(p.center, null, sk)}${p.nodes.map((n, k) => nodeHTML(n, k, sk))}
    </div></section>`;
}

// 场景：浅色是白天（太阳、云、偶尔路过的一小群鸽子），深色是夜晚（星星、月亮、偶尔一颗流星）。只在简洁样式里有
function sceneHTML(sk) {
  if (sk || st.settings.scene !== 'on') return '';
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  if (isDark()) {
    const stars = Array.from({ length: 54 }, () => raw(`<i class="star" style="left:${(rnd() * 100).toFixed(1)}%;top:${(rnd() * 82).toFixed(1)}%;--d:${(rnd() * 5).toFixed(2)}s;--sz:${rnd() < .18 ? 3 : 2}px"></i>`));
    return html`<div class="sky night" aria-hidden="true">${stars}<i class="moon"></i><i class="meteor"></i></div>`;
  }
  return raw('<div class="sky day" aria-hidden="true"><i class="sun"></i><i class="cloud c1"></i><i class="cloud c2"></i><i class="cloud c3"></i><i class="flock"><b></b><b></b><b></b><b></b></i></div>');
}
// 场景里用到的几张像素画，颜色读样式表里的 --art-*
const pix = (gr, pal) => { const c = document.createElement('canvas'); c.width = gr[0].length; c.height = gr.length; const x = c.getContext('2d'); gr.forEach((row, y) => [...row].forEach((ch, i) => { if (pal[ch]) { x.fillStyle = pal[ch]; x.fillRect(i, y, 1, 1); } })); return c.toDataURL(); };
const ART = {};
const moonArt = () => ART.moon ??= pix(['....####....', '..###.......', '.###........', '.##.........', '###.........', '###.........', '###.........', '###.........', '.###........', '.####.......', '..######..#.', '....####....'], { '#': hex('art-moon') });
const sunArt = () => ART.sun ??= pix(['......#.......', '..#...#...#...', '...#.....#....', '.....####.....', '....######....', '##.########.##', '...########...', '....######....', '.....####.....', '...#.....#....', '..#...#...#...', '......#.......'], { '#': hex('art-sun') });
const cloudArt = () => ART.cloud ??= pix(['.....####.........', '...########..###..', '.################.', '##################', '.################.'], { '#': hex('art-cloud') });

/* ---------- 排布和连线 ---------- */
function put(G, k) {
  const o = G.b[k]; o.el.style.left = o.x + 'px'; o.el.style.top = o.y + 'px';
  if (k === 0) { G.orbit.style.setProperty('--cx', o.x + 'px'); G.orbit.style.setProperty('--cy', o.y + 'px'); } // 指挥身后那圈光跟着它
}
function layout() {
  $$('.page', root).forEach(pg => {
    const i = +pg.dataset.i, p = PAGES[i], orbit = $('.orbit', pg), W = orbit.clientWidth, H = orbit.clientHeight;
    if (!W || !H) return;
    const z = zoomOf(W, H); // 舞台大时节点跟着放大一点
    orbit.style.setProperty('--z', z.toFixed(3));
    const all = [p.center, ...p.nodes];
    const els = [$('.node[data-center]', orbit), ...$$('.node[data-k]', orbit)];
    const rest = els.slice(1).filter(el => !el.classList.contains('k-group'));
    const nw = rest.length ? Math.max(...rest.map(el => el.offsetWidth)) * z : 118 * z, nh = rest.length ? Math.max(...rest.map(el => el.offsetHeight)) * z : 120 * z;
    const G = { ...gridOf(W, H, nw, nh, z, leavesOf(p)), i, p, orbit };
    els.forEach(el => { if (el.classList.contains('k-group')) { el.classList.remove('compact'); el.style.width = (2 * G.cw - 20 * z) / z + 'px'; } });
    const cells = placeCells(G, p, all.map(n => (n.kind === 'group' ? 2 : 1)));
    // 地方不够放两格：卡片缩成一格，里面的 logo 变小
    G.b = els.map((el, k) => {
      const { c, span, compact } = cells[k];
      if (compact) { el.classList.add('compact'); el.style.width = (G.cw - 16 * z) / z + 'px'; }
      const [x, y] = cellXY(G, c, span);
      return { el, c, span, x, y, w: el.offsetWidth * z, h: el.offsetHeight * z };
    });
    GEO[i] = G;
    G.b.forEach((_, k) => put(G, k));
    wire(i);
  });
}

// 连线。像素折线：一格一格的小方块，颜色从发的一方渐变到收的一方；有任务在送时方块往前走，回信往回走，等你确认的那段变红
function wire(i) {
  const G = GEO[i]; if (!G) return;
  const { p, orbit, z, b, W, H } = G, N = p.nodes, arc = st.settings.lines === 'arc';
  const A = b.map(o => { const av = $('.ava, .gcard', o.el); return { cx: o.x - o.w / 2 + (av.offsetLeft + av.offsetWidth / 2) * z, cy: o.y - o.h / 2 + (av.offsetTop + av.offsetHeight / 2) * z, rx: av.offsetWidth / 2 * z, ry: av.offsetHeight / 2 * z }; });
  const E = N.map((n, k) => edgePath(A[n.from + 1], A[k + 1], z, arc));
  const col = n => n.kind === 'group' ? hex('accent') : hex(n.a);
  const wires = $('svg.wires', orbit);
  wires.setAttribute('viewBox', `0 0 ${W} ${H}`);
  wires.setAttribute('class', `wires ${arc ? 'arc' : 'px'}`);
  wires.innerHTML = String(html`<defs>${N.map((n, k) => { const [x1, y1, x2, y2] = E[k].g; return html`<linearGradient id="gr${i}-${k}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${col(parentOf(p, k))}"/><stop offset="1" stop-color="${col(n)}"/></linearGradient>`; })}</defs>${N.map((n, k) => { const crossing = n.dev !== parentOf(p, k).dev; return html`<path data-k="${k}" ${arc ? '' : html`style="stroke:url(#gr${i}-${k})"`} class="${edgeOf(st, p, k).st} ${crossing ? 'cross' : ''} ${n.from >= 0 && !crossing ? 'dotted' : ''}" d="${E[k].d}"/>`; })}`);
  $$('.pg', orbit).forEach(el => { const k = +el.dataset.k; el.style.offsetPath = `path("${E[k].d}")`; if (!el.style.animationDelay) el.style.animationDelay = `${(k * .41) % 1.8}s, 0s`; el.classList.toggle('flip', el.classList.contains('back') ? !E[k].left : E[k].left); });
  // 跨设备的那一段，靠收信那头标出是怎么连的
  $$('.linkb', orbit).forEach(el => el.remove());
  N.forEach((n, k) => {
    const lk = n.link && LINK[n.link]; if (!lk || n.dev === parentOf(p, k).dev) return;
    const path = $(`path[data-k="${k}"]`, wires), pt = path.getPointAtLength(path.getTotalLength() * .72);
    const el = document.createElement('i'); el.className = 'linkb'; el.dataset.tip = lk.label + '：' + lk.tip; el.innerHTML = String(icOf(lk));
    el.style.left = pt.x + 'px'; el.style.top = pt.y + 'px'; orbit.append(el);
  });
  // 展开的远程设备：在它的几个 agent 身后铺一块底，标出是哪台电脑，右上角的按钮收起
  $$('.devzone', orbit).forEach(el => el.remove());
  const zones = {};
  N.forEach((n, k) => { if (n.remoteOf) (zones[n.remoteOf] ??= []).push(b[k + 1]); });
  for (const [od, os] of Object.entries(zones)) {
    const pad = 12 * z, x1 = Math.min(...os.map(o => o.x - o.w / 2)) - pad, x2 = Math.max(...os.map(o => o.x + o.w / 2)) + pad;
    const y1 = Math.min(...os.map(o => o.y - o.h / 2)) - pad - 26, y2 = Math.max(...os.map(o => o.y + o.h / 2)) + pad;
    const el = document.createElement('div'); el.className = 'devzone';
    el.style.cssText = `left:${x1}px;top:${y1}px;width:${x2 - x1}px;height:${y2 - y1}px`;
    el.innerHTML = String(html`<header><span class="gdev">${devIc(st, od)}</span><b>${st.DEV[od].name}</b><button type="button" class="gx" data-action="fold-dev" data-dev="${od}" data-tip="收起">${icon('fold')}</button></header>`);
    orbit.insertBefore(el, wires);
  }
  if (hot.i === i) hot.ks.forEach(k => $(`path[data-k="${k}"]`, wires)?.classList.add('hot'));
}

/* ---------- 实验样式的画布：逐帧画头像、画背景 ---------- */
let anim = [], tickN = 0;
if (!reduce) whileVisible(() => { tickN++; anim.forEach(a => { const ev = a.every || 3; if (tickN % ev === 0) a.draw(Math.floor(tickN / ev)); }); }, 160);
function paintScene(sk) {
  const view = $('.pager-view', root);
  anim = sk && view ? sk.paint(view, { hex, isDark }) : [];
  anim.forEach(a => a.draw(0));
}
// 背景要等节点排好再画，地毯得对准指挥的位置。简洁样式：指挥头上那只鸽子、天上的云和月亮太阳，都用 CSS 变量传给样式表
function paintBg(sk) {
  const view = $('.pager-view', root);
  if (!view) return;
  const rest = Brand().pigeon(hex('bird-rest'), 'rest');
  view.style.setProperty('--rest', rest.url); view.style.setProperty('--rw', rest.w * 1.6 + 'px'); view.style.setProperty('--rh', rest.h * 1.6 + 'px');
  view.style.setProperty('--cloud', `url(${cloudArt()})`);
  view.style.setProperty('--moon', `url(${moonArt()})`); view.style.setProperty('--sun', `url(${sunArt()})`);
  view.style.setProperty('--bird', Brand().pigeon(hex('bird-far'), 'far').url);
  if (sk) sk.bg(view, { hex, isDark });
}

/* ---------- 底部轮播：一次一件正在发生的事，对应的连线跟着亮起来 ---------- */
let tkI = 0, tkTimer, hot = { i: -1, ks: [] }, tkHold = false;
function ticker(reset) {
  clearTimeout(tkTimer);
  if (!root || !$('#ticker', root)) return;
  const pi = ui.stage.page, p = PAGES[pi]; if (!p) return;
  const ev = events(st, p), ss = pageSessions(st, p);
  const cnt = [[ss.filter(s => s.state === 'run').length, '在干活', 'run'], [ss.filter(s => s.state === 'wait').length, '等你', 'wait'], [st.T.filter(t => t.state === 'home').length, '回信', 'ok']];
  patch($('#tk-count', root), html`${cnt.map(([v, l, c]) => html`<span data-tip="${l}"><i class="dot ${c === 'run' && v ? 'run' : ''}" style="--s:var(--${c})"></i><b>${v}</b></span>`)}`);
  const orbit = $(`.page[data-i="${pi}"] .orbit`, root);
  $$('.hot', root).forEach(el => el.classList.remove('hot'));
  const el = $('#tk-text', root);
  if (st.paused.all) { el.innerHTML = '<span class="mut">已暂停，消息都停在原地</span>'; return; }
  if (!ev.length) { el.innerHTML = '<span class="mut">安静</span>'; return; }
  if (reset) tkI = 0;
  const { t, at } = ev[tkI % ev.length], a = by(st, t.from), b2 = by(st, t.to);
  hot = { i: pi, ks: [] };
  const hl = k => { if (k < 1) return; const n = p.nodes[k - 1]; hot.ks.push(k - 1); $(`path[data-k="${k - 1}"]`, orbit)?.classList.add('hot'); $(`.node[data-k="${k - 1}"]`, orbit)?.classList.add('hot'); hl(n.from + 1); };
  hl(at); $('.node[data-center]', orbit)?.classList.add('hot');
  el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
  patch(el, html`<button type="button" data-action="open-task" data-id="${t.id}"><span class="g sm">${brand(a.agent)}</span><span class="arr">→</span><span class="g sm">${brand(b2.agent)}</span>${cross(st, t) ? html`<span class="badge">${devIc(st, b2.dev)}${shortDev(st, b2.dev)}</span>` : ''}<span class="ell">${t.title}</span><i class="dot ${LIVE.includes(t.state) ? 'run' : ''}" style="--s:${TS[t.state][1]}" data-tip="${TS[t.state][0]}" role="img" aria-label="${TS[t.state][0]}"></i></button>`);
  tkI++;
  if (ev.length > 1 && !reduce) tkTimer = setTimeout(next, 3400);
}
// 鼠标停在轮播上、或者焦点在里面时不换下一条
function next() { if (tkHold) tkTimer = setTimeout(next, 1000); else ticker();
}

/* ---------- 悬停提示：在做什么、模型、订阅额度、今天接了几件 ---------- */
function tipInfo(n) {
  if (n.kind === 'group' || n.kind === 'you') return '';
  const q = st.SUB[`${n.a}@${n.dev}`], m = modelOf(st, n), c = (st.CONN[n.dev] || []).find(x => x.a === n.a), rows = [];
  const err = n.ids.map(id => by(st, id)).find(x => x.state === 'error'), act = n.ids.map(id => by(st, id)).find(x => x.state === 'run' && x.activity);
  if (err) rows.push(['出错', err.error || '看详情', 'warn'], ['', '点一下在右边详情里重试', 'mut']);
  if (act) rows.push(['在做', ACT[act.activity] || '在干活']);
  const today = st.T.filter(t => n.ids.includes(t.to)).length;
  if (m && m.m) rows.push(['模型', `${m.m}${TH[m.t] ? ' · 思考' + TH[m.t][0] : ''}`]);
  if (q && q.left != null) {
    rows.push(['额度', html`<span class="qbar" style="--q:${q.left}%;--qc:${qc(q.left)}"><i></i></span>${q.win}剩 ${q.left}%`]);
    rows.push(['', `${q.plan} · ${rst(q)}${q.more ? ' · ' + q.more : ''}`, 'mut']);
    if (q.left < st.LOW) rows.push(['', `低于 ${st.LOW}%，分派规则会先改派给别人`, 'warn']);
  } else if (q && q.bal != null) {
    rows.push(['额度', `按量付费 · 余额 ${q.bal}`, q.warn ? 'warn' : '']);
    rows.push(['', `${q.plan}${q.more ? ' · ' + q.more : ''}`, 'mut']);
  } else if (q) rows.push(['额度', q.why, 'mut']);
  else if (c) rows.push(['额度', '按量付费，没有订阅额度', 'mut']);
  if (q && q.src) rows.push(['', `来自本机 magpie · ${st.MPQ.at} 读的`, 'mut']);
  else if ((q || c) && st.mode !== 'live' && st.MPQ.state !== 'demo') rows.push(['', st.MPQ.state === 'off' ? '示例数字：连不上本机 magpie' : '示例数字', 'mut']);
  if (today) rows.push(['今天', `接了 ${today} 件`]);
  if (isPaused(st, n.dev)) rows.push(['', '已暂停，不再往这里送消息', 'warn']);
  return rows.length ? html`<dl class="tipinfo">${rows.map(([t, v, k]) => html`<dt>${t}</dt><dd class="${k || ''}">${v}</dd>`)}</dl>` : '';
}
let tipFor = null;
function showNodeTip(node) {
  tipFor = node;
  const tip = $('#tip', root); if (!tip) return;
  if (!node) return tip.classList.remove('on');
  const p = PAGES[ui.stage.page], n = node.hasAttribute('data-center') ? p.center : p.nodes[+node.dataset.k];
  if (!n) return;
  const ss = n.ids.map(id => by(st, id)).slice(0, 5), here = st.DEV[p.key];
  const sub = n.kind === 'you' ? '你自己当指挥 · 回信进任务页和刘海' : n.host ? `${isYou(st) ? '你在这台指挥' : '指挥在这台'}${n.via ? ` · 经它的 ${AG[n.via].name} 连到 ${here.name}` : here.link === 'magpie' ? ` · 经 magpie 连到 ${here.name}` : ''} · 点一下翻回去`
    : n.kind === 'group' ? `${LINK[n.link].label} · 点一下翻到这台，右上角的按钮展开`
    : n.kind === 'relay' ? `${st.DEV[n.dev].name} · 经它连到这台`
    : n.via ? `${st.DEV[n.dev].name} · 经 ${AG[n.via].name} 带起`
    : n.kind === 'lead' ? '指挥 · ' + st.DEV[n.dev].name : st.DEV[n.dev].name;
  patch(tip, html`<b>${n.kind === 'group' ? st.DEV[n.dev].name : n.kind === 'you' ? '你' : AG[n.a].name}</b><small>${sub}</small>${tipInfo(n)}
    ${ss.map(s => html`<div class="${s.parent ? 'kid' : ''}"><i class="dot ${s.state}" style="--s:${ST[s.state][1]}"></i><span>${s.title}</span></div>`)}${n.ids.length > 5 ? html`<div class="mut">还有 ${n.ids.length - 5} 个</div>` : ''}`);
  const v = $('.pager-view', root).getBoundingClientRect(), r = $('.ava, .gcard', node).getBoundingClientRect();
  tip.classList.add('on');
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = r.left - v.left + r.width / 2 - tw / 2, y = r.top - v.top - th - 12;
  if (y < 6) y = r.bottom - v.top + 12;
  tip.style.left = Math.max(6, Math.min(v.width - tw - 6, x)) + 'px'; tip.style.top = y + 'px';
}

/* ---------- 右侧详情 ---------- */
function taskRow(t) {
  const a = by(st, t.from), b = by(st, t.to);
  return html`<button type="button" class="item" data-action="open-task" data-id="${t.id}">${g(b.agent, 'sm')}<div><b>${t.title}</b><small>${AG[a.agent].name} → ${AG[b.agent].name}${cross(st, t) ? ' @ ' + st.DEV[b.dev].name : ''}</small></div>${taskSt(t)}</button>`;
}
function drawInsp() {
  const sel = ui.stage.sel;
  let h;
  // 设为指挥：只给接入页里能发出的 agent，已经是指挥的不给
  const leadBtn = (a, d) => canLead(st, a, d) && leadKey(st) !== `${a}@${d}` ? html`<button class="ghost" type="button" data-action="lead" data-a="${a}" data-dev="${d}">设为指挥</button>` : '';
  // 能不能给它派活：开着、能接收的（第一版里本机的 Claude Code 还不能接收）
  const takes = (a, d) => canTake((st.CONN[d] || []).find(c => c.a === a));
  if (sel.t === 'session' && by(st, sel.id)) {
    const s = by(st, sel.id), ts = st.T.filter(t => t.from === s.id || t.to === s.id), ks = kids(st, s), isLead = leadSession(st) === s;
    h = html`<div class="who">${g(s.agent, '', s.state)}<div><b>${s.title}</b><small>${AG[s.agent].name} · ${st.DEV[s.dev].name}</small></div></div>
      <div class="acts">${stTag(s.state)}${isLead ? html`<span class="badge">指挥</span>` : ''}${s.state === 'run' && s.activity ? html`<span class="badge">${ACT[s.activity]}</span>` : ''}${s.model ? html`<span class="badge">${s.model}${TH[s.think] ? ' · 思考' + TH[s.think][0] : ''}</span>` : ''}</div>
      ${s.state === 'error' ? html`<div class="errbox" role="alert"><span>${s.error || '出错了'}</span>${st.mode === 'live' ? '' : html`<button class="ghost" type="button" data-action="retry-session" data-id="${s.id}">重试</button>`}</div>` : ''}
      <p class="note">${s.note}${s.via ? `。这台设备只连了 ${AG[s.via].name}，它是由 ${AG[s.via].name} 在那边带起来的` : ''}${s.parent ? `。由「${by(st, s.parent).title}」拆出来` : ''}</p>
      ${ks.length ? html`<h3>它拆出的子对话 · ${ks.length}</h3><div class="list">${ks.map(k => html`<button type="button" class="item" ${selAttrs({ t: 'session', id: k.id })}>${g(k.agent, 'sm')}<div><b>${k.title}</b><small>${k.note}</small></div>${stTag(k.state)}</button>`)}</div>` : ''}
      <div class="acts">${takes(s.agent, s.dev) && !s.stub ? html`<button class="ghost" type="button" data-action="msg" data-s="${s.id}">给它发消息</button>` : ''}${s.stub && st.mode === 'live' ? '' : html`<button class="ghost" type="button" data-action="jump" data-s="${s.id}">${icon('jump')}${jumpLabel(st, s)}</button>`}${s.parent ? '' : leadBtn(s.agent, s.dev)}</div>
      <h3>它的往来 · ${ts.length}</h3><div class="list">${ts.length ? ts.map(taskRow) : html`<p class="note">还没有往来</p>`}</div>`;
  } else if (sel.t === 'you') {
    const ts = st.T.filter(t => t.from === 'you');
    h = html`<div class="who"><span class="g">${icon('bird')}</span><div><b>你</b><small>指挥 · 在 Pigeon 里自己派活</small></div></div>
      <p class="note">你派的活回信不送回任何对话，在任务页和刘海的“回信到了”里看。</p>
      <div class="acts"><button class="btn" type="button" data-action="compose">${icon('send')}派活</button><button class="ghost" type="button" data-action="nav" data-v="conn">换指挥</button></div>
      <h3>你派的 · ${ts.length}</h3><div class="list">${ts.length ? ts.map(taskRow) : html`<p class="note">还没派过。点“派活”，或者在刘海上快速派活</p>`}</div>`;
  } else {
    const a = sel.a, d = sel.d, ss = st.S.filter(s => s.agent === a && (!d || s.dev === d));
    h = html`<div class="who">${g(a, '', worst(ss))}<div><b>${AG[a].name}</b><small>${d ? st.DEV[d].name : '全部设备'} · ${ss.length} 个对话</small></div></div>
      <div class="acts">${takes(a, d || st.home) ? html`<button class="ghost" type="button" data-action="new" data-a="${a}" data-dev="${d || st.home}">新开对话派活</button>` : ''}<button class="ghost" type="button" data-action="nav" data-v="conn">接入情况</button>${d ? leadBtn(a, d) : ''}</div>
      <h3>它的对话</h3><div class="list">${ss.length ? ss.map(s => html`<button type="button" class="item" ${selAttrs({ t: 'session', id: s.id })}>${g(s.agent, 'sm')}<div><b>${s.title}</b><small>${s.state === 'error' ? s.error : s.note}</small></div>${d ? stTag(s.state) : devBadge(st, s.dev)}</button>`) : html`<p class="note">还没有对话。点“新开对话派活”给它一件</p>`}</div>`;
  }
  const live = st.T.filter(t => t.state === 'asking' || LIVE.includes(t.state));
  patch($('#insp', root), html`<button class="close" type="button" data-action="close-insp" aria-label="收起详情">×</button>${h}<h3>正在进行 · ${live.length}</h3><div class="list">${live.map(taskRow)}</div>`);
}
// 节点上的选中框
const mark = () => $$('.node[data-action="select"]', root).forEach(n => n.setAttribute('aria-pressed', sameSel(selOf(n.dataset), ui.stage.sel)));

/* ---------- 页面的几块 ---------- */
const headHTML = () => html`<div class="head" data-part="head"><h1>指挥台</h1><span class="sp"></span>
    <button class="ghost pausebtn ${st.paused.all ? 'on' : ''}" type="button" data-action="pause" data-tip="${st.paused.all ? '接着把停下的消息送出去' : '不再送出任何消息，在路上的停在原地，正在干活的做完这一轮就停'}">${icon(st.paused.all ? 'play' : 'pause')}${st.paused.all ? '继续' : '全部暂停'}</button>
    <button class="btn" type="button" data-action="compose">${icon('send')}派活</button></div>`;
const pausebarHTML = () => st.paused.all
  ? html`<div class="pausebar" data-part="pausebar">${icon('pause')}<span><b>已暂停</b>agent 之间不再送消息，在路上的停在原地，正在干活的做完这一轮就停</span><button class="ghost" type="button" data-action="pause">继续</button></div>`
  : html`<div data-part="pausebar" hidden></div>`;
const pagerbarHTML = () => html`<div class="pagerbar" data-part="pagerbar"><button class="arrow" type="button" data-action="step" data-n="-1" aria-label="上一页">‹</button>
    ${PAGES.map((p, i) => { const w = pageSessions(st, p).filter(s => s.state === 'wait').length;
      return html`<button class="ptab" type="button" data-action="page" data-i="${i}" aria-pressed="${bool(i === ui.stage.page)}" data-tip="双击改名"><span class="g sm dev">${svg(IC[p.os])}</span><span>${p.title}</span>${!st.paused.all && st.paused.dev[p.key] ? html`<i class="ppause" data-tip="这台已暂停">${icon('pause')}</i>` : ''}${w ? html`<i class="flag wait">${w}</i>` : ''}</button>`; })}
    <button class="ptab add" type="button" data-action="adddev" data-tip="添加设备">${icon('plus')}</button>
    <button class="arrow" type="button" data-action="step" data-n="1" aria-label="下一页">›</button></div>`;

// 翻页：只挪轨道、换选中的标签，不重画
function slide() {
  const i = ui.stage.page, track = $('#track', root);
  if (!track) return;
  track.style.transform = `translateX(${-i * 100}%)`;
  $$('.page', root).forEach((p, j) => { p.classList.toggle('on', j === i); p.toggleAttribute('inert', j !== i); });
  $$('.ptab[data-i]', root).forEach((b, j) => b.setAttribute('aria-pressed', j === i));
  ticker(true);
}
// 舞台整个重画：页、节点、连线、场景
function drawView() {
  if (!root) return;
  const sk = skinNow();
  if (sk === undefined) return; // 实验样式还在加载，加载完会再叫一次
  PAGES = pagesOf(st);
  if (ui.stage.page > PAGES.length - 1) store.set('ui.stage.page', PAGES.length - 1, true);
  showNodeTip(null);
  part(root, 'view', html`<div class="pager-view" data-part="view" data-skin="${sk ? skinName() : 'plain'}" ${st.paused.all ? raw('data-paused') : ''}>${sceneHTML(sk)}<div class="track" id="track">${PAGES.map((p, i) => pageHTML(p, i, sk))}</div><div class="tip" id="tip" role="tooltip"></div></div>`);
  part(root, 'pagerbar', pagerbarHTML());
  slide(); mark(); paintScene(sk); layout(); paintBg(sk);
}
// 舞台大小变了（窗口缩放、暂停横幅出现或收起）：节点重新排、连线重画，不重建
function relayout() {
  const sk = skinNow();
  if (sk === undefined || !$('#track', root)) return;
  paintScene(sk); layout(); paintBg(sk);
}
// 暂停：页头、横幅、标签、轮播、舞台上的几个开关，不重画舞台
function drawPause() {
  part(root, 'head', headHTML());
  part(root, 'pausebar', pausebarHTML());
  part(root, 'pagerbar', pagerbarHTML());
  const view = $('.pager-view', root);
  view?.toggleAttribute('data-paused', st.paused.all);
  $$('.page', root).forEach((pg, i) => pg.classList.toggle('paused', !!PAGES[i] && isPaused(st, PAGES[i].key)));
  relayout(); ticker(true);
}

// 舞台要不要整个重画
const VIEW_TOPICS = ['DEV', 'lead', 'S', 'T', 'ui.open', 'art', 'settings.theme', 'settings.palette', 'settings.scene', 'settings.lines', 'settings.skin', 'settings.quota'];

export function mountStage(main) {
  root = main;
  patch(main, html`${headHTML()}
    <div class="stage-wrap" id="stage-wrap"><div class="stage-col">
      ${pausebarHTML()}
      <div class="pager-view" data-part="view"></div>
      <div class="ticker" id="ticker"><span class="tk-text" id="tk-text"></span><span class="tk-count num" id="tk-count"></span></div>
      <div data-part="pagerbar"></div>
    </div><aside class="insp" id="insp" aria-label="选中的对象"></aside></div>`);
  drawView(); drawInsp();
  // 轮播：鼠标停在上面或者焦点在里面时不换
  const tk = $('#ticker', main), hold = v => () => { tkHold = v; };
  tk.addEventListener('mouseenter', hold(true)); tk.addEventListener('mouseleave', hold(false));
  tk.addEventListener('focusin', hold(true)); tk.addEventListener('focusout', hold(false));

  const offs = [
    store.on(VIEW_TOPICS.concat('SUB'), changed => {
      if (store.touched(changed, ...VIEW_TOPICS) || st.settings.quota === 'always') drawView();
    }),
    store.on(['paused'], drawPause),
    store.on(['ui.stage.page'], slide),
    store.on(['ui.stage.sel', 'S', 'T', 'DEV', 'lead'], () => { mark(); drawInsp(); }),
  ];
  // 悬停节点出提示；悬停在带小说明的元素上时让给小说明
  const over = e => {
    const t = e.target.closest('[data-tip]'), n = t ? null : e.target.closest('.orbit .node');
    if (n !== tipFor) showNodeTip(n);
  };
  const fin = e => { if (e.target.matches?.('.orbit .node')) showNodeTip(e.target); };
  const fout = e => { if (e.target.matches?.('.orbit .node')) showNodeTip(null); };
  let rz;
  const resize = () => { clearTimeout(rz); rz = setTimeout(() => { if (root) relayout(); }, 150); };
  main.addEventListener('mouseover', over); main.addEventListener('focusin', fin); main.addEventListener('focusout', fout);
  addEventListener('resize', resize);
  return () => {
    offs.forEach(f => f());
    main.removeEventListener('mouseover', over); main.removeEventListener('focusin', fin); main.removeEventListener('focusout', fout);
    removeEventListener('resize', resize);
    clearTimeout(tkTimer); anim = []; root = null; tipFor = null;
  };
}

// 只做一次：注册动作、按键、预加载宠物
export function initStage(s) {
  store = s; st = s.state; ui = st.ui;
  preloadPets(a => store.markPetBad(a));
  const pages = () => PAGES.length || 1;
  registerAll({
    select: ({ d }) => { store.select(selOf(d)); $('#stage-wrap')?.classList.add('open'); showNodeTip(null); },
    'close-insp': () => $('#stage-wrap')?.classList.remove('open'),
    // 底部的设备标签：点一下翻过去，双击改名
    page: [({ d, el, type }) => { if (type === 'dblclick') { if (PAGES[+d.i]) startRename(store, PAGES[+d.i].key, el); } else store.setPage(+d.i); }, 'click', 'dblclick'],
    step: ({ d }) => store.setPage((ui.stage.page + +d.n + pages()) % pages()),
    'go-dev': ({ d }) => { const i = PAGES.findIndex(p => p.key === d.dev); if (i >= 0) store.setPage(i); },
    'open-dev': ({ d }) => store.setOpen(d.dev, true),
    'fold-dev': ({ d }) => store.setOpen(d.dev, false),
    lead: ({ d }) => after(store.setLead({ kind: 'agent', agent: d.a, dev: d.dev }), ok => { if (ok) toast(`${AG[d.a].name}（${shortDev(st, d.dev, true)}）现在是指挥`); }),
    'retry-session': ({ d }) => after(store.retrySession(d.id), ok => toast(ok ? '重试了，它接着干活' : '还是连不上，先看看那台开没开')),
  });
  // 左右方向键翻页
  onKey(e => {
    if (!root || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return false;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return false;
    store.setPage((ui.stage.page + (e.key === 'ArrowRight' ? 1 : -1) + pages()) % pages());
    return true;
  });
}
