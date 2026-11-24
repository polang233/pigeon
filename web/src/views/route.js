// 分派规则：哪类活交给谁。上面是流向图和“试一句”，下面是能直接改的规则表，再下面是额度阈值和写进指挥提示里的样子。
// 判断逻辑都在 core/route.js。几块：flow 流向图、tryout 试算结果（输入框本身不重画）、rules 规则表、cols 阈值和提示原文。
import { html, raw, bool } from '../html.js';
import { icon } from '../icons.js';
import { $, $$, part, patch } from '../dom.js';
import { AG } from '../core/labels.js';
import { agOf, dvOf, leadSession, isYou, shortDev, nameOf } from '../core/names.js';
import { qLeft, lowQ, alive, targets, routeOf, promptText, asks } from '../core/route.js';
import { qc, qTip } from '../core/quota.js';
import { g } from './parts.js';
import { registerAll } from '../actions.js';
import { toast } from './toast.js';

let store, st, ui;

const qmini = k => {
  const q = st.SUB[k];
  return q && q.left != null
    ? html`<span class="qmini ${q.left < st.LOW ? 'low' : ''}" data-tip="${qTip(q)}"><i style="--q:${q.left}%;--qc:${qc(q.left)}"></i>${q.left}%</span>`
    : html`<span class="qmini none" data-tip="${q ? qTip(q) : '按量付费，没有订阅额度'}">${q && q.none ? '没读到' : '按量'}</span>`;
};

function flowHTML() {
  const L = leadSession(st), you = isYou(st), dst = [...new Set(st.RULES.flatMap(r => [r.to, r.fb]).filter(k => alive(st, k)))];
  const la = you ? 'you' : st.lead.agent;
  return html`<div class="flow2" data-part="flow">
    <div class="f-col f-src"><div class="box" data-src>${g(la)}<div><b>${AG[la].name}</b><small>${you ? '指挥 · 自己派活' : `指挥 · ${L ? L.title : shortDev(st, st.lead.dev, true)}`}</small></div></div></div>
    <div class="f-col f-rules">${st.RULES.map((r, i) => html`<div class="box f-rule ${r.on ? '' : 'off'}" data-r="${i}"><span class="rn">${i + 1}</span><b class="ell">${r.when || html`<span class="mut">还没写</span>`}</b>${r.ask ? html`<i class="askm" data-tip="发之前问你">问</i>` : ''}</div>`)}
      <div class="box f-rule other" data-r="-2"><span class="rn">·</span><span class="mut ell">其他的，指挥自己判断</span></div></div>
    <div class="f-col f-dsts">${dst.map(k => html`<div class="box f-dst" data-k="${k}">${g(agOf(k), 'sm')}<span class="ell"><b>${AG[agOf(k)].name}</b><small>${shortDev(st, dvOf(k), true)}</small></span>${qmini(k)}</div>`)}</div>
    <svg class="f-lines" aria-hidden="true"></svg>
  </div>`;
}

function ruleRow(r, i) {
  const opts = (cur, none) => html`${none ? html`<option value="" ${cur ? '' : raw('selected')}>不改派</option>` : ''}${targets(st).map(k => html`<option value="${k}" ${k === cur ? raw('selected') : ''}>${AG[agOf(k)].name} · ${shortDev(st, dvOf(k))}</option>`)}${cur && !alive(st, cur) ? html`<option value="${cur}" selected>（已经不在了）</option>` : ''}`;
  const live = lowQ(st, r.to) && alive(st, r.fb);
  return html`<div class="trow ${r.on ? '' : 'off'}" data-r="${i}">
    <button class="sw" type="button" role="switch" aria-checked="${bool(r.on)}" data-action="rule-on" data-id="${r.id}" aria-label="启用这条规则"></button>
    <span class="grip" draggable="true" data-tip="拖动调整先后">${icon('grip')}</span>
    <span class="rwhen"><input class="cell" data-action="rule-text" data-id="${r.id}" data-f="when" data-focus="rule-when:${r.id}" value="${r.when}" placeholder="当任务是…" aria-label="当任务是" autocomplete="off"><input class="cell kw" data-action="rule-text" data-id="${r.id}" data-f="kw" data-focus="rule-kw:${r.id}" value="${r.kw}" placeholder="关键词，空格隔开" aria-label="关键词" autocomplete="off"></span>
    <span class="arrowto">→</span>
    <span class="who2">${g(agOf(r.to), 'sm')}<select class="pick" data-action="rule-field" data-id="${r.id}" data-f="to" aria-label="交给">${opts(r.to)}</select>${lowQ(st, r.to) ? html`<i class="qlow" data-tip="它的额度只剩 ${qLeft(st, r.to)}%">${qLeft(st, r.to)}%</i>` : ''}</span>
    <span class="who2 fbc ${live ? 'live' : ''}" ${live ? html`data-tip="交给的那家额度低于 ${st.LOW}%，现在按这一栏派"` : ''}>${r.fb ? g(agOf(r.fb), 'sm') : ''}<select class="pick" data-action="rule-field" data-id="${r.id}" data-f="fb" aria-label="额度不够时改派给">${opts(r.fb, true)}</select></span>
    <select class="pick" data-action="rule-field" data-id="${r.id}" data-f="must" aria-label="指挥怎么用这条" data-tip="建议：写进提示，由指挥自己判断交不交。照做：这句话里出现关键词时，提示里写成必须交给它，除非你在那句话里明说不要"><option value="0" ${r.must ? '' : raw('selected')}>建议</option><option value="1" ${r.must ? raw('selected') : ''}>照做</option></select>
    <select class="pick" data-action="rule-field" data-id="${r.id}" data-f="ask" aria-label="发之前要不要问我"><option value="0" ${r.ask ? '' : raw('selected')}>直接发</option><option value="1" ${r.ask ? raw('selected') : ''}>每次问我</option></select>
    <span class="num stat" data-tip="本周命中 ${r.n} 次${r.over ? `，其中指挥没照做 ${r.over} 次` : ''}">${r.n} 次${r.over ? html`<small>没照做 ${r.over}</small>` : ''}</span>
    <button class="rdel" type="button" data-action="del-rule" data-id="${r.id}" aria-label="删掉这条" data-tip="删掉这条">${icon('x')}</button></div>`;
}
const rulesHTML = () => html`<div class="panel t-rules" data-part="rules"><div class="trow head-row"><span></span><span></span><span>当任务是</span><span></span><span>交给</span><span data-tip="交给的那家订阅额度低于 ${st.LOW}% 时，改派给这一家">额度不够时</span><span data-tip="建议：由指挥判断。照做：命中关键词就交给它">指挥</span><span>发之前</span><span>本周</span><span></span></div>
    ${st.RULES.length ? st.RULES.map(ruleRow) : html`<div class="empty pad"><p>还没有规则，所有活都由指挥自己判断交给谁。</p><button class="ghost" type="button" data-action="addrule">${icon('plus')}加一条</button></div>`}
    <div class="trow other"><span></span><span></span><span class="mut">其他的</span><span class="arrowto">→</span><span class="mut">指挥自己判断，派活时附一句理由</span></div></div>`;
const colsHTML = () => html`<div class="cols" data-part="cols">
    <div><h2>额度</h2><div class="panel pad"><p>交给的那家订阅额度低于 <select class="pick" data-action="low" aria-label="额度阈值">${[10, 20, 30, 50].map(v => html`<option value="${v}" ${v === st.LOW ? raw('selected') : ''}>${v}</option>`)}</select> % 时，按“额度不够时”那一栏改派；没写改派的照常派，提示里会告诉指挥它快用完了。</p>
      <p class="note">按量付费的没有额度，不受这条影响。跨设备的任务不管规则怎么写，默认都要你点一次确认，这条在“接入”里能关。</p></div></div>
    <div><h2>写进指挥提示里的样子</h2><div class="panel pad">${isYou(st)
      ? html`<p class="note" style="margin-top:0">指挥是你自己，没有提示可写。你在刘海上派活时，会按这些规则先把建议的对象选好，你可以改。</p><button class="ghost" type="button" data-action="nav" data-v="conn">换指挥</button>`
      : html`<pre class="prompt" id="prompt">${promptText(st) || '现在没有开着的规则，不往指挥的提示里写。'}</pre><p class="note">指挥每开新一轮时更新一次，额度变了、协作的规矩改了也跟着变。</p>`}</div></div>
  </div>`;

// 流向图的线：量好三列方框的位置再画
function flowLines(root) {
  const box = $('.flow2', root); if (!box) return;
  const R = box.getBoundingClientRect(), src = $('[data-src]', box), out = [];
  const pt = (el, side) => { const r = el.getBoundingClientRect(); return [(side === 'r' ? r.right : r.left) - R.left, r.top - R.top + r.height / 2]; };
  const curve = ([x0, y0], [x1, y1]) => { const m = (x0 + x1) / 2; return `M${x0},${y0} C${m},${y0} ${m},${y1} ${x1},${y1}`; };
  $$('.f-rule', box).forEach(rb => {
    const i = +rb.dataset.r, r = st.RULES[i];
    out.push(html`<path data-r="${i}" class="in ${r && !r.on ? 'off' : ''}" d="${curve(pt(src, 'r'), pt(rb, 'l'))}"/>`);
    if (!r) return;
    const tb = $(`.f-dst[data-k="${CSS.escape(r.to)}"]`, box), fb = r.fb && $(`.f-dst[data-k="${CSS.escape(r.fb)}"]`, box), weak = lowQ(st, r.to) && fb;
    if (tb) out.push(html`<path data-r="${i}" class="to ${weak ? 'weak' : ''} ${r.on ? '' : 'off'}" d="${curve(pt(rb, 'r'), pt(tb, 'l'))}"/>`);
    if (fb) out.push(html`<path data-r="${i}" class="fb ${weak ? 'live' : ''} ${r.on ? '' : 'off'}" d="${curve(pt(rb, 'r'), pt(fb, 'l'))}"/>`);
  });
  const sv = $('.f-lines', box); sv.setAttribute('viewBox', `0 0 ${R.width} ${R.height}`); sv.innerHTML = String(html`${out}`);
  paintRoute(root);
}
// 走到的那条规则、那条线、那一家亮起来，其他的变淡
function paintRoute(root) {
  const { hit, hitTo, hitFb } = ui.route, any = hit !== -1;
  $$('.flow2 .f-rule', root).forEach(el => { const me = +el.dataset.r === hit; el.classList.toggle('hit', me); el.classList.toggle('dim', any && !me); });
  $$('.flow2 .f-dst', root).forEach(el => { const me = !!hitTo && el.dataset.k === hitTo; el.classList.toggle('hit', any && me); el.classList.toggle('dim', any && !me); });
  $$('.flow2 path', root).forEach(el => {
    const me = +el.dataset.r === hit, goes = me && (el.classList.contains('in') || (el.classList.contains('to') ? !hitFb : hitFb));
    el.classList.toggle('hit', goes); el.classList.toggle('dim', any && !goes);
  });
  $$('.t-rules .trow[data-r]', root).forEach(el => el.classList.toggle('hl', +el.dataset.r === hit));
}
// 试一句：逐条列出每条规则怎么判，最后一句写交给谁、要不要问你
function tryRoute(root) {
  const out = $('#try-out', root); if (!out) return;
  const v = ui.route.try.trim();
  if (!v) { patch(out, html`<span class="mut">输入一句任务，看它会走哪条规则、交给谁</span>`); store.setHit(-1); return; }
  const res = routeOf(st, v), lab = { off: '关着', gone: '交给的那家不在了，跳过', miss: '没命中', hit: '命中', fb: '命中，额度不够，改派' };
  const steps = res.steps.map(x => html`<li class="s-${x.st}"><span class="rn">${st.RULES.indexOf(x.r) + 1}</span><span class="ell">${x.r.when || '还没写'}</span><em>${lab[x.st]}</em></li>`);
  let end = html`没有规则命中，留给指挥自己判断`;
  if (res.r) { const k = res.to; end = html`建议交给 <b>${nameOf(st, k)}</b>${res.fb ? `（${nameOf(st, res.r.to)} 的额度只剩 ${qLeft(st, res.r.to)}%）` : res.low ? `（它的额度只剩 ${qLeft(st, k)}%，没写改派，照常派）` : ''}${asks(st, res.r, k) ? '，发之前问你' : ''}`; }
  patch(out, html`<ol class="trace">${steps}</ol><p class="res">${end}</p>`);
  store.setHit(res.r ? st.RULES.indexOf(res.r) : -2, res.to || '', !!res.fb);
}

export function mountRoute(main) {
  patch(main, html`<div class="head"><h1>分派规则</h1><p>哪类活交给谁。规则写进指挥的提示里当建议，最后由它判断；它没照做时要说理由</p><span class="sp"></span><button class="btn" type="button" data-action="addrule">${icon('plus')}加一条</button></div>
    <div class="body"><div class="panel">
      ${flowHTML()}
      <div class="try"><label for="try">试一句</label><input id="try" data-action="try" placeholder="比如：在 Windows 上跑一遍测试" autocomplete="off" value="${ui.route.try}"><div class="try-out" id="try-out"></div></div>
    </div>
    <h2>规则 · 从上到下，第一条命中的算数</h2>
    ${rulesHTML()}
    ${colsHTML()}</div>`);
  const flow = () => { part(main, 'flow', flowHTML()); flowLines(main); };
  flowLines(main); tryRoute(main);

  const offs = [
    // 规则的结构、额度、设备、指挥变了：除了试算的输入框都重画
    store.on(['RULES', 'RULES2', 'SUB', 'DEV', 'S', 'lead'], () => { flow(); part(main, 'rules', rulesHTML()); part(main, 'cols', colsHTML()); tryRoute(main); }),
    // 只是规则的文字改了：表格里的输入框已经是新值，不重画表格
    store.on(['ruleText'], () => { flow(); const pr = $('#prompt', main); if (pr) pr.textContent = promptText(st) || '现在没有开着的规则，不往指挥的提示里写。'; tryRoute(main); }),
    store.on(['ui.route.try'], () => tryRoute(main)),
    store.on(['ui.route.hit'], () => paintRoute(main)),
  ];
  // 悬停规则（流向图里的或表格里的）：走到的那条线动起来。试算框里有字时让给试算
  const over = e => {
    if (ui.route.try.trim()) return;
    const r = e.target.closest('.t-rules .trow[data-r], .flow2 .f-rule[data-r]'), n = r ? +r.dataset.r : -1;
    if (n === ui.route.hit) return;
    const R = st.RULES[n], fb = !!R && lowQ(st, R.to) && alive(st, R.fb);
    store.setHit(n, R ? (fb ? R.fb : R.to) : '', fb);
  };
  // 拖动左边的把手调整规则的先后
  let from = -1;
  const clearDrop = () => $$('.t-rules .trow.drop', main).forEach(x => x.classList.remove('drop'));
  const dragstart = e => { const gp = e.target.closest?.('.t-rules .grip'); if (!gp) return; const row = gp.closest('.trow'); from = +row.dataset.r; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); try { e.dataTransfer.setDragImage(row, 24, 20); } catch (_) { /* 有的浏览器不支持 */ } };
  const dragover = e => { if (from < 0) return; const r = e.target.closest('.t-rules .trow[data-r]'); if (!r) return; e.preventDefault(); $$('.t-rules .trow.drop', main).forEach(x => x !== r && x.classList.remove('drop')); r.classList.add('drop'); };
  const drop = e => { if (from < 0) return; const r = e.target.closest('.t-rules .trow[data-r]'); if (!r) return; e.preventDefault(); const to = +r.dataset.r, f = from; from = -1; clearDrop(); if (to === f) return; store.moveRule(f, to); toast('先后改了，从上到下匹配'); };
  const dragend = () => { from = -1; clearDrop(); };
  const resize = () => flowLines(main);
  const L = [['mouseover', over], ['dragstart', dragstart], ['dragover', dragover], ['drop', drop], ['dragend', dragend]];
  L.forEach(([t, f]) => main.addEventListener(t, f));
  addEventListener('resize', resize);
  return () => { offs.forEach(f => f()); L.forEach(([t, f]) => main.removeEventListener(t, f)); removeEventListener('resize', resize); };
}

export function initRoute(s) {
  store = s; st = s.state; ui = st.ui;
  const addRule = () => {
    const r = store.addRule();
    if (ui.view !== 'route') store.setView('route');
    store.flush();
    document.querySelector(`[data-focus="rule-when:${r.id}"]`)?.focus();
  };
  registerAll({
    addrule: addRule,
    'del-rule': ({ d }) => { const r = store.delRule(d.id); toast(`删掉了「${r.when || '没写完的那条'}」`); },
    'rule-on': ({ d }) => store.toggleRule(d.id),
    'rule-text': [({ d, value }) => store.setRule(d.id, d.f, value), 'input'],
    'rule-field': [({ d, value }) => store.setRule(d.id, d.f, value), 'change'],
    low: [({ value }) => { store.setLow(+value); toast(`额度低于 ${st.LOW}% 时改派`); }, 'change'],
    try: [({ value }) => store.setTry(value), 'input'],
  });
}
