// 刘海面板（演示）：两侧的状态、下沿的光带、展开后的五种样子（收起、悬停总览、等你处理、回信到了、快速派活），
// 等你的一队，光带上飞的信鸽。设置里关掉刘海后，同一个面板从菜单栏的鸽子图标展开。
// 等你的一队照 docs/REDESIGN.md 的“重构前定下的事”：键盘只在面板展开、且鼠标在面板上或焦点在面板里时算数；
// 回车放行选中的那条，焦点在某个按钮上时回车就是按那个按钮；跨设备的倒计时到点就不发；暂停中放行的先排着。
import { html, raw, bool } from '../html.js';
import { icon, Brand } from '../icons.js';
import { $, $$, patch, part, reduce } from '../dom.js';
import { AGENTS, AG, ST, TH, QK, SHORT } from '../core/labels.js';
import { by, agOf, dvOf, keyOf, worst, shortDev, nameOf, levelsOf, qInfo, ruleById, tById, askOn, online, secsLeft, agoZh } from '../core/names.js';
import { g, devIc, thinkPick, secretBody, secretNote } from './parts.js';
import { secretsIn } from '../core/secrets.js';
import { registerAll, onKey } from '../actions.js';
import { toast } from './toast.js';

let store, st, ui;
const hudEl = () => $('#hud');

/* ---------- 面板里的几种样子 ---------- */
const pauseBtn = () => html`<button class="hbtn ${st.paused.all ? 'go' : 'no'}" type="button" data-action="pause">${icon(st.paused.all ? 'play' : 'pause')}${st.paused.all ? '继续' : '全部暂停'}</button>`;

function overviewHTML() {
  const live = st.S.filter(s => s.state !== 'idle' && !s.parent);
  return html`${st.Q.length ? html`<button class="qbanner" type="button" data-action="hud" data-state="confirm"><span>${st.Q.length} 件等你处理</span><span>›</span></button>` : ''}<h3><span>正在进行</span><span>${live.length}</span></h3>${live.map(s => html`<div class="row">${g(s.agent, 'sm', s.state)}<div style="min-width:0"><b>${s.title}</b><small>${AG[s.agent].name}${s.dev === st.home ? '' : ' @ ' + st.DEV[s.dev].name} · ${s.state === 'error' ? s.error : s.note}</small></div><span class="tag" style="color:${ST[s.state][1]}">${ST[s.state][0]}</span></div>`)}
    <div class="acts" style="margin-top:10px"><span>移开鼠标就收起</span><span><button class="hbtn" type="button" data-action="compose">派活</button> <button class="hbtn" type="button" data-action="nav" data-v="stage">打开 Pigeon</button></span></div>`;
}

function replyHTML() {
  const r = tById(st, st.DEMO.reply); if (!r) return html`<h3><span>没有新的回信</span></h3>`;
  const x = by(st, r.to).agent, y = by(st, r.from).agent;
  return html`<h3><span>回信到了</span><span>刚刚</span></h3><div class="route">${g(x, 'sm')}<b>${AG[x].name}</b><span class="arr">→</span>${g(y, 'sm')}<b>${AG[y].name}</b></div><div class="quote">${r.reply.split('\n').map((l, i) => html`${i ? raw('<br>') : ''}${l}`)}</div>
    <div class="acts"><span>审查 · 用时 ${r.dur}</span><span><button class="hbtn" type="button" data-action="dismiss">知道了</button> <button class="hbtn go" type="button" data-action="fwd">转给指挥</button></span></div>`;
}

/* ---------- 快速派活：对象、模型、思考强度，几块分开画，打字时不重画输入框 ---------- */
function cgridHTML() {
  const target = store.target(), a = agOf(target), p = store.pickOf(target), lv = levelsOf(st, a, p.m);
  const rows = Object.keys(st.DEV).map(d => {
    const on = (st.CONN[d] || []).filter(c => c.on);
    return on.length ? html`<span class="lb">${shortDev(st, d)}</span><span class="chips">${on.map(c => { const k = `${c.a}@${d}`; return html`<button class="chip" type="button" data-action="target" data-k="${k}" aria-pressed="${bool(k === target)}">${g(c.a, 'sm')}${SHORT[c.a]}</button>`; })}</span>` : '';
  });
  const models = [...st.MODELS[a].map(([m]) => html`<button class="mchip" type="button" data-action="pick-model" data-m="${m}" aria-pressed="${bool(m === p.m)}">${m}</button>`),
    ...(st.MAGPIE.on ? st.MAGPIE.groups.map(([m, tip]) => html`<button class="mchip mg" type="button" data-action="pick-model" data-m="${m}" aria-pressed="${bool(m === p.m)}" data-tip="magpie 的路由组：${tip}">${m}</button>`) : [])];
  const think = p.m.startsWith('group/') ? html`<span class="none">由 magpie 的路由组决定</span>` : thinkPick(lv, p.t, 'pick-think');
  return html`<div class="tgrid" data-part="cgrid">${rows}<span class="lb">模型</span><span class="mpick">${models}</span><span class="lb">思考</span><span>${think}</span></div>`;
}
// 规则建议给谁（和选中的不一样时给一个“选它”）
function csugHTML() {
  const k = ui.hud.suggest, target = store.target();
  if (!k) return html`<p class="csug" data-part="csug" hidden></p>`;
  return k === target ? html`<p class="csug" data-part="csug">照分派规则选的：${nameOf(st, k)}</p>`
    : html`<p class="csug" data-part="csug">分派规则建议给 ${nameOf(st, k)} <button class="hbtn link" type="button" data-action="target" data-k="${k}">选它</button></p>`;
}
function cfootHTML() {
  const target = store.target(), d = dvOf(target), away = d !== st.home, msg = ui.hud.mode === 'msg' && by(st, ui.hud.session);
  const where = !online(st, d) ? `${st.DEV[d].name} 现在连不上，发不出去` : `${msg ? '发到这个对话里' : `${away ? '跨设备' : '本机'}，新开一个对话`}${away && askOn(st, 'cross') ? '，发之前还会让你确认一次' : ''}`;
  return html`<div class="acts" data-part="cfoot"><span>${where}</span><span><button class="hbtn" type="button" data-action="hud" data-state="idle">取消</button> <button class="hbtn go" type="button" data-action="send">发出</button></span></div>`;
}
function composeHTML() {
  const msg = ui.hud.mode === 'msg' && by(st, ui.hud.session);
  return html`<h3><span>${msg ? html`发给「${msg.title}」` : ui.hud.mode === 'new' && !ui.hud.auto ? '新开对话' : '快速派活'}</span><span>⌥ 空格 呼出</span></h3>${cgridHTML()}
    <input class="field" id="hud-input" data-action="draft" placeholder="让它做什么…" autocomplete="off" aria-label="让它做什么" value="${ui.hud.draft}">${csugHTML()}${cfootHTML()}`;
}

/* ---------- 等你的一队 ---------- */
const left = (q, long) => { const s = secsLeft(q, store.clock()); return long ? `还剩 ${s} 秒，不点就不发` : `剩 ${s} 秒`; };
// 一件展开后：跨设备写明发到哪台、原文、带了什么、倒计时；转派写明谁想转给谁、命中哪条规则；拆活列出拆成哪几件
function qDetail(q, x) {
  const jump = x.from.id === 'you' ? '' : html`<button class="hbtn link" type="button" data-action="jump" data-s="${x.from.id}">${icon('jump')}跳回对话</button>`;
  const no = html`<button class="hbtn no" type="button" data-action="qno">拦下</button>`;
  // 暂停中放行过的：只剩拦下
  const held = html`<div class="acts"><span>${jump}<em class="qpz">暂停中，继续后送出</em></span><span>${no}</span></div>`;
  if (q.kind === 'cross') {
    const d = dvOf(x.to), warn = secretsIn(x.text).length && st.settings.secrets === 'warn', ctx = x.t && x.t.ctx;
    return html`<div class="qd"><div class="route">${g(x.from.agent, 'sm')}<b>${AG[x.from.agent].name}</b><span class="arr">→</span>${g(agOf(x.to), 'sm')}<b>${AG[agOf(x.to)].name}</b><span class="badge">${devIc(st, d)}${st.DEV[d].name}</span></div>
      <div class="quote">${secretBody(st, x.text)}</div>${secretNote(st, x.text)}
      <p class="qnote">${ctx ? `带 ${ctx.files.length ? ctx.files.length + ' 个文件' : '这一句说明'} · 约 ${(ctx.tokens / 1000).toFixed(1).replace(/\.0$/, '')}k token · ` : ''}${q.paused ? '已放行' : html`<span data-deadline="${q.deadline}" data-long="1">${left(q, true)}</span>`}</p>
      ${q.paused ? held : html`<div class="acts"><span>${jump}</span><span>${no} ${warn ? html`<button class="hbtn" type="button" data-action="qyes">原样放飞</button> <button class="hbtn go" type="button" data-action="qyes" data-mask="1">打码后放飞</button>` : html`<button class="hbtn go" type="button" data-action="qyes">放飞</button>`}</span></div>`}</div>`;
  }
  if (q.kind === 'relay') {
    const r = q.rule && ruleById(st, q.rule);
    return html`<div class="qd"><p class="qline">${AG[x.from.agent].name}（${x.from.title}）想把这件转给 <b>${nameOf(st, x.to)}</b></p><div class="quote">${x.text}</div>
      ${r ? html`<p class="qnote">命中规则「${r.when}」</p>` : ''}
      ${q.paused ? held : html`<div class="acts"><span>${jump}<button class="hbtn link" type="button" data-action="qauto" data-tip="以后接活的 agent 转派不再问你，在“接入 → 协作的规矩”里能改回来">以后直接转</button></span><span>${no} <button class="hbtn go" type="button" data-action="qyes">放行</button></span></div>`}</div>`;
  }
  return html`<div class="qd"><p class="qline">指挥想把「${x.from.title}」拆成 ${x.parts.length} 件，同时派出去</p><div class="qparts">${x.parts.map(([k, v]) => html`<div>${g(agOf(k), 'sm')}<b>${SHORT[agOf(k)]}</b><span class="ell">${v}</span></div>`)}</div>
    ${q.paused ? held : html`<div class="acts"><span>${jump}</span><span>${no} <button class="hbtn go" type="button" data-action="qyes">全部放行</button></span></div>`}</div>`;
}

function queueHTML() {
  if (!st.Q.length) return html`<h3><span>没有等你的事</span></h3><p class="qempty">跨设备发送、转派、拆活要你点头时会排在这里。</p><div class="acts"><span><button class="hbtn" type="button" data-action="compose">派活</button></span><span>${pauseBtn()}</span></div>`;
  const qSel = Math.max(0, Math.min(ui.hud.q, st.Q.length - 1)), now = store.clock();
  store.set('ui.hud.q', qSel, true);
  const it = (q, i) => {
    const x = qInfo(st, q), on = i === qSel, tos = x.parts ? x.parts.map(p => g(agOf(p[0]), 'sm')) : g(agOf(x.to), 'sm');
    const right = q.paused ? html`<em class="qpz">暂停中</em>` : q.kind === 'cross' ? html`<em class="qleft" data-deadline="${q.deadline}">${left(q)}</em>` : html`<em>${agoZh(q.created, now)}</em>`;
    return html`<div class="qi ${on ? 'on' : ''}"><button type="button" class="qh" data-action="hud-q" data-i="${i}" aria-expanded="${bool(on)}"><i class="qk ${q.kind}">${QK[q.kind]}</i>${g(x.from.agent, 'sm')}<span class="arr">→</span><span class="tos">${tos}</span><span class="ell">${x.title}</span>${right}</button>${on ? qDetail(q, x) : ''}</div>`;
  };
  return html`<h3><span>等你 · ${st.Q.length}</span><span class="keys">↑↓ 选　↩ 放行　⌫ 拦下</span></h3><div class="qlist">${st.Q.map(it)}</div>
    <div class="acts qfoot"><span>${st.paused.all ? '暂停中：放行的先排着，继续后再送出' : '拿不准时，可以先全部停下'}</span><span>${pauseBtn()}</span></div>`;
}

function drawBody() {
  const s = ui.hud.state;
  hudEl().dataset.state = s;
  const body = { idle: () => '', overview: overviewHTML, confirm: queueHTML, reply: replyHTML, compose: composeHTML }[s]();
  patch($('#hud-body'), html`<div>${body ? html`<div class="hud-pad"><button class="hud-x" type="button" data-action="hud" data-state="idle" aria-label="收起刘海面板">${icon('x')}</button>${body}</div>` : ''}</div>`);
}

// 刘海两侧：左边是在干活的 agent，右边是等你的数量；下沿一条光带，每个 agent 一段。颜色读样式表里的身份色（刘海里那份是深色配色的）
function drawEars() {
  const running = [...new Set(st.S.filter(s => s.state === 'run').map(s => s.agent))], need = st.Q.length;
  patch($('#ear-l'), st.paused.all ? html`<span class="paused">${icon('pause')}已暂停</span>` : html`${running.map(a => html`<i class="pip run" style="--c:${AG[a].c}" title="${AG[a].name} 在干活"></i>`)}`);
  patch($('#ear-r'), need ? html`<span class="need num" data-action="hud" data-state="confirm" role="button" tabindex="0">${need} 件等你</span>` : html`<span>都在忙</span>`);
  patch($('#mb-q'), html`${icon('bird')}${need ? html`<b class="num">${need}</b>` : ''}`);
  $('#mb-q').setAttribute('aria-label', need ? `Pigeon：${need} 件等你` : 'Pigeon：没有等你的事');
  patch($('#hud-glow'), html`${AGENTS.map(a => html`<i class="${worst(st.S.filter(x => x.agent === a))}" style="--c:${AG[a].c}"></i>`)}`);
}

/* ---------- 刘海上的信鸽 ---------- */
// 把刘海当成一颗星球：鸽子从发信那一段颜色起飞，往下扎出去，被“引力”拉回来，落到收信那一段。
// 横向匀速、竖向受一个朝上的恒定引力，所以是一条挂在刘海下面的抛物线；越靠近底部飞得越慢。
export function flyNotch(fromA, toA) {
  if (reduce || ui.hud.state !== 'idle' || document.hidden || st.settings.notch === 'off' || st.paused.all) return;
  const segs = $$('#hud-glow i'), s0 = segs[AGENTS.indexOf(fromA)], s1 = segs[AGENTS.indexOf(toA)];
  if (!s0 || !s1 || s0 === s1) return;
  const bar = $('.menubar'), mb = bar.getBoundingClientRect(), r0 = s0.getBoundingClientRect(), r1 = s1.getBoundingClientRect();
  const x0 = r0.left + r0.width / 2 - mb.left, x1 = r1.left + r1.width / 2 - mb.left, y0 = r0.bottom - mb.top + 3;
  const dx = x1 - x0, depth = Math.max(46, Math.abs(dx) * .7), dur = 1100 + Math.abs(dx) * 5;
  const color = getComputedStyle(hudEl()).getPropertyValue('--' + fromA).trim() || '#999999';
  const p = Brand().pigeon(color, 'fly'), sh = { w: p.w * .62, h: p.h * .62 }, el = document.createElement('i');
  el.className = 'npg'; el.style.cssText = `--sheet:${p.url};--fw:${sh.w * 2}px;--fh:${sh.h * 2}px`;
  bar.append(el); s0.classList.add('launch'); setTimeout(() => s0.classList.remove('launch'), 500);
  let t0 = null, last = 0;
  const frame = now => {
    t0 ??= now;
    const t = Math.min(1, (now - t0) / dur), x = x0 + dx * t, y = y0 + depth * 4 * t * (1 - t);
    const tilt = Math.atan2(depth * 4 * (1 - 2 * t), Math.abs(dx)) * 180 / Math.PI * .7; // 往下扎时低头，往回飞时抬头
    el.style.transform = `translate(${x - sh.w}px, ${y - sh.h}px) scaleX(${dx < 0 ? -1 : 1}) rotate(${tilt}deg)`;
    if (now - last > 45 && t > .04 && t < .95) { last = now; trail(bar, x, y, color); }
    if (t < 1) return requestAnimationFrame(frame);
    el.remove(); s1.classList.add('catch'); setTimeout(() => s1.classList.remove('catch'), 650);
  };
  requestAnimationFrame(frame);
}
function trail(bar, x, y, color) {
  const d = document.createElement('i'); d.className = 'ntrail'; d.style.cssText = `left:${x}px;top:${y}px;background:${color}`;
  bar.append(d); setTimeout(() => d.remove(), 700);
}
// 轮流把正在送和刚回来的信飞一遍
const notchRoutes = () => st.T.filter(t => ['flying', 'delivered', 'home'].includes(t.state))
  .map(t => t.state === 'home' ? [by(st, t.to).agent, by(st, t.from).agent] : [by(st, t.from).agent, by(st, t.to).agent]).filter(([a, b]) => a !== b && a !== 'you' && b !== 'you');

// 放行或拦下等你的第 i 件，顺带提示、放飞时在刘海上飞一只
export function doQ(i, ok, opt) {
  const r = store.qDo(i, ok, opt); if (!r) return;
  if (r.fly) setTimeout(() => flyNotch(...r.fly), 380);
  toast(r.msg);
}
// 快速派活发出后怎么说
const SENT = {
  asking: '跨设备任务，先确认一次', paused: '暂停中：这件先排着，继续后再送出',
  offline: '那台连不上，没发出（任务页里能重发）', no_target: '对方不在了，没发出',
};

export function mountHud(s) {
  store = s; st = s.state; ui = st.ui;
  store.on(['ui.hud', 'Q', 'paused', 'S', 'T', 'DEV', 'SUB', 'RULES', 'RULES2', 'lead', 'settings.secrets'], drawBody);
  store.on(['S', 'Q', 'paused'], drawEars);
  // 打字时：规则自动换了对象就重画对象那几块；建议那一行跟着字走
  store.on(['hudTarget'], () => { if (ui.hud.state === 'compose') { part(hudEl(), 'cgrid', cgridHTML()); part(hudEl(), 'cfoot', cfootHTML()); } });
  store.on(['draft'], () => { if (ui.hud.state === 'compose') part(hudEl(), 'csug', csugHTML()); });
  drawEars(); drawBody();

  // 鼠标在不在面板上：键盘只在这时（或焦点在面板里）算数
  let over = false;
  $('.hud-top').addEventListener('mouseenter', () => { if (ui.hud.state === 'idle') store.hud('overview', false); });
  hudEl().addEventListener('mouseenter', () => { over = true; });
  hudEl().addEventListener('mouseleave', () => { over = false; if (!ui.hud.pinned) store.hud('idle'); });
  const inPanel = () => over || hudEl().contains(document.activeElement);

  // 倒计时：每秒改一下“剩几秒”，到点的跨设备那件不发
  setInterval(() => {
    const now = store.clock();
    $$('[data-deadline]').forEach(el => { const q = { deadline: +el.dataset.deadline }; el.textContent = left(q, !!el.dataset.long); });
    const gone = store.expire(now);
    if (gone.length) toast(`没人理，没发出：${gone.map(t => t.title).join('、').slice(0, 40)}`);
  }, 1000);

  let nI = 0;
  setInterval(() => { const r = notchRoutes(); if (r.length) flyNotch(...r[nI++ % r.length]); }, 4200);
  setTimeout(() => { const r = notchRoutes(); if (r.length) flyNotch(...r[0]); }, 900);

  registerAll({
    hud: ({ d }) => store.hud(d.state),
    // 菜单栏的鸽子图标（关掉刘海时才有）：有事等你就展开那一队，没有就展开总览
    mbq: () => store.hud(ui.hud.state === 'idle' ? (st.Q.length ? 'confirm' : 'overview') : 'idle'),
    'hud-q': ({ d }) => { store.hudSel(+d.i); store.hud('confirm'); },
    qyes: ({ d }) => doQ(ui.hud.q, true, { mask: !!d.mask }),
    qno: () => doQ(ui.hud.q, false),
    qauto: () => { const r = store.qAuto(ui.hud.q); if (r?.fly) setTimeout(() => flyNotch(...r.fly), 380); toast('以后接活的 agent 转派不再问你，在“接入 → 协作的规矩”里能改回来'); },
    // 任务页里放飞、拦下一件跨设备的任务：找到它在队里的那一件
    release: ({ d }) => { const i = st.Q.findIndex(q => q.band === d.id); if (i >= 0) doQ(i, true); },
    block: ({ d }) => { const i = st.Q.findIndex(q => q.band === d.id); if (i >= 0) doQ(i, false); },
    dismiss: () => store.hud('idle'),
    fwd: () => { store.hud('idle'); toast('回信已排进指挥的队列，等它空闲时送达'); },
    // 派活：指挥台的“派活”、总览里的“派活”
    compose: () => store.compose(),
    // 详情里的“给它发消息”（发给这个对话）和“新开对话派活”（对象选好，新开一个对话）
    msg: ({ d }) => { const s2 = by(st, d.s); if (s2) store.compose({ target: keyOf(s2), mode: 'msg', session: s2.id }); },
    new: ({ d }) => store.compose({ target: `${d.a}@${d.dev}`, mode: 'new' }),
    target: ({ d }) => { store.setTarget(d.k); store.hud('compose'); },
    'pick-model': ({ d }) => { store.pickModel(d.m); store.hud('compose'); },
    'pick-think': ({ d }) => { store.pickThink(d.t); store.hud('compose'); },
    draft: [({ value }) => store.setDraft(value), 'input'],
    send: () => {
      const k = store.target(), p = store.pickOf(k), m = `${p.m}${p.t ? ' · 思考' + TH[p.t][0] : ''}`, r = store.send();
      if (r.empty) return toast('先写一句要它做什么');
      toast(r.result === 'flying' ? (r.fresh ? `已用 ${m} 新开对话：${r.task.title.slice(0, 18)}` : `已发给「${by(st, r.task.to).title}」`) : r.result === 'asking' ? `${SENT.asking}（${m}）` : SENT[r.result]);
    },
    // 设置里的演示：来一件转派、拆活（规矩开着进队，关了直接做）
    'demo-in': ({ d }) => { const r = store.incoming(d.kind); if (!r.asked) toast(`规矩里关了“问我”，直接做了：${r.msg}`); },
  });

  // 刘海展开在“等你”、并且鼠标在面板上或焦点在面板里时：上下选、回车放行、⌫ 拦下。焦点在按钮上时回车交给那个按钮
  onKey(e => {
    if (ui.hud.state !== 'confirm' || !st.Q.length || !inPanel() || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); store.hudStep(e.key === 'ArrowDown' ? 1 : -1); store.hud('confirm'); return true; }
    if (e.key === 'Enter') {
      if (e.target.closest?.('button, a, [role="button"]')) return false;
      e.preventDefault(); doQ(ui.hud.q, true); return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); doQ(ui.hud.q, false); return true; }
    return false;
  });
}
