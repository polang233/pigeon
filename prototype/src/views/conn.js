// 接入：一张卡片一台设备，一行一个 agent：怎么接的、能不能发能不能收、订阅剩多少、开关；默认模型点开在下面改。
// 下面是协作的规矩。“添加设备”是一个两步的面板：先选怎么连，再选哪台电脑、起名、接哪些应用。
// 几块：head 页头（magpie 连没连上）、cards 设备卡片、rules2 协作的规矩、sheet 添加设备。
import { html, raw, bool } from '../html.js';
import { svg, IC, icon, brand } from '../icons.js';
import { $, part, patch } from '../dom.js';
import { AGENTS, AG, TH, CAP } from '../core/labels.js';
import { named, shortDev, isPaused, levelsOf, online, leadKey, leadOptions, nameOf, removalImpact, agOf, dvOf } from '../core/names.js';
import { g, devIc, quotaDisc, modelTag, thinkPick, howChip, LINK, icOf } from './parts.js';
import { registerAll } from '../actions.js';
import { startRename } from './rename.js';
import { toast } from './toast.js';

let store, st, ui;

const cap = (dir, k) => html`<i class="cap ${k}" role="img" aria-label="${CAP[dir][k]}" data-tip="${CAP[dir][k]}">${icon(dir)}</i>`;

function mpanelHTML(c) {
  const grp = c.model.startsWith('group/');
  return html`<div class="mpanel"><span class="lb">模型</span><span class="mpick">${st.MODELS[c.a].map(([m]) => html`<button class="mchip" type="button" data-action="conn-model" data-m="${m}" aria-pressed="${bool(m === c.model)}">${m}</button>`)}</span>
    ${st.MAGPIE.on ? html`<span class="lb" data-tip="本机 magpie 里配的路由组：一个名字后面挂几个模型或账号，按它的规则自动选">magpie</span><span class="mpick">${st.MAGPIE.groups.map(([m, tip]) => html`<button class="mchip mg" type="button" data-action="conn-model" data-m="${m}" aria-pressed="${bool(m === c.model)}" data-tip="${tip}">${m}</button>`)}</span>` : ''}
    <span class="lb">思考</span><span>${grp ? html`<span class="none">由 magpie 的路由组决定</span>` : thinkPick(levelsOf(st, c.a, c.model), c.think, 'conn-think')}</span>
    <span></span><small class="mut">Pigeon 派活、新开对话时默认用这个，不改它自己的配置；刘海上派活时还能临时换。</small></div>`;
}
const rowHTML = (d, c) => html`<div class="arow ${c.role || ''} ${c.on ? '' : 'off'}">
    <span class="g">${brand(c.a)}</span><b>${AG[c.a].name}</b>${c.role === 'gate' ? html`<i class="flag gate" data-tip="入口：别的 agent 经它带起">${icon('door')}</i>` : ''}
    <span class="chips"><button type="button" class="mdlbtn" data-action="model-panel" data-dev="${d}" data-a="${c.a}" aria-expanded="${bool(ui.conn.mp === `${d}:${c.a}`)}">${modelTag({ m: c.model, t: c.think }, `默认用 ${c.model}${TH[c.think] ? ' · 思考' + TH[c.think][0] : ''} · 点一下改`)}</button>${c.how.map(howChip)}</span>
    <span class="caps">${cap('out', c.out)}${cap('in', c.inn)}</span>
    ${st.SUB[`${c.a}@${d}`] ? quotaDisc(st, c.a, d) : html`<i class="quota none" data-tip="按量付费，没有订阅额度"></i>`}
    <button class="sw" type="button" role="switch" aria-checked="${bool(c.on)}" data-action="conn-on" data-dev="${d}" data-a="${c.a}" aria-label="接入 ${AG[c.a].name}"></button></div>`;

function cardHTML(d) {
  const D = st.DEV[d], L = LINK[D.link], home = d === st.home;
  const plan = html`<div class="plan"><div class="files mono">${st.PLAN.map(([f, w]) => html`<span data-tip="${w}，其他内容原样保留，可以单独撤回"><code>${f}</code></span>`)}</div>
    <div class="acts"><button class="ghost" type="button" data-action="plan">先不改</button><button class="btn" type="button" data-action="apply">改这 ${st.PLAN.length} 处</button></div></div>`;
  return html`<section class="dcard ${ui.conn.fresh === d ? 'fresh' : ''}">
    <header><span class="g dev lg">${devIc(st, d)}</span><h2 class="dname" data-action="rename" data-dev="${d}" data-tip="${named(st, d) ? `电脑名 ${D.host} · ` : ''}点一下改名"><span>${D.name}</span>${icon('pen')}</h2>
      <span class="chip2 link" data-tip="${L.label}：${L.tip}">${icOf(L)}<span>${L.label}</span></span>${isPaused(st, d) ? html`<span class="chip2 pz">${icon('pause')}<span>已暂停</span></span>` : ''}${online(st, d) ? '' : html`<span class="chip2 off" role="status">${icon('x')}<span>连不上</span></span><button class="ghost sm" type="button" data-action="reconnect" data-dev="${d}">重试</button>`}<span class="sp"></span>
      <button class="ghost icon ${st.paused.dev[d] ? 'on' : ''}" type="button" data-action="pause-dev" data-dev="${d}" data-tip="${st.paused.dev[d] ? '继续往这台送消息' : '暂停这台：不再往这台送消息，在路上的停在原地'}">${icon(st.paused.dev[d] ? 'play' : 'pause')}</button>
      ${home ? html`<button class="ghost icon" type="button" data-action="plan" data-tip="一键接入本机全部：先列出会改哪几个文件">${icon('wand')}</button>` : html`<button class="ghost icon" type="button" data-action="rm-dev" data-dev="${d}" data-tip="移除这台设备">${icon('more')}</button>`}</header>
    ${home && ui.conn.plan ? plan : ''}
    <div class="arows">${st.CONN[d].map(c => html`${rowHTML(d, c)}${ui.conn.mp === `${d}:${c.a}` ? mpanelHTML(c) : ''}`)}</div></section>`;
}
// 只有本机的时候多一张虚线卡片，告诉你下一步
const cardsHTML = () => html`<div class="dcards" data-part="cards">${Object.keys(st.DEV).map(cardHTML)}${Object.keys(st.DEV).length === 1 ? html`<section class="dcard ghostcard"><p>还没有别的设备。加一台，就能把活派到那台电脑上的 agent。</p><button class="btn" type="button" data-action="adddev">${icon('plus')}添加设备</button></section>` : ''}</div>`;

function headHTML() {
  const M = st.MPQ, bird = icon('bird');
  const chip = M.state === 'live' ? html`<span class="chip2 mgc" data-tip="本机 magpie ${M.ver}：本机几家的订阅额度是从它读的（${M.cards} 张，${M.at} 读的）；路由组还是示例">${bird}<span>magpie 已连上</span></span>`
    : M.state === 'off' ? html`<span class="chip2 mgc off" data-tip="连不上本机 magpie，额度和路由组都是示例。打开 magpie 后一分钟内会自己连上">${bird}<span>magpie 没开</span></span>`
    : st.MAGPIE.on ? html`<span class="chip2 mgc" data-tip="示例：默认模型里能直接选 magpie 的 ${st.MAGPIE.groups.length} 个路由组。用 tools/serve.py 打开原型，额度会换成本机 magpie 的真数据">${bird}<span>magpie 已连上</span></span>` : '';
  const lk = leadKey(st), opts = leadOptions(st);
  const leadPick = html`<label class="leadpick" data-tip="同一时间只有一个指挥。能发出的 agent 才能当；也可以是你自己，在 Pigeon 里派活"><span>指挥</span><select class="pick" data-action="set-lead" aria-label="指挥">${opts.map(k => html`<option value="${k}" ${k === lk ? raw('selected') : ''}>${AG[agOf(k)].name} · ${shortDev(st, dvOf(k))}</option>`)}<option value="you" ${lk === 'you' ? raw('selected') : ''}>你自己</option></select></label>`;
  return html`<div class="head" data-part="head"><h1>接入</h1>${leadPick}<span class="sp"></span>${chip}
    <span class="legend">${['yes', 'part', 'nope'].map(k => html`<i class="cap ${k}" role="img" aria-label="图例：${CAP.legend[k]}" data-tip="${CAP.legend[k]}">${icon('out')}</i>`)}</span>
    <button class="btn" type="button" data-action="adddev">${icon('plus')}添加设备</button></div>`;
}
const rules2HTML = () => html`<div class="panel rules2" data-part="rules2">${st.RULES2.map(r => html`<div class="trow"><span data-tip="${r.tip}">${r.t}</span>${r.kind === 'sw'
  ? html`<button class="sw" type="button" role="switch" aria-checked="${bool(r.on)}" data-action="rule2" data-id="${r.id}" aria-label="${r.t}"></button>`
  : r.kind === 'pick' ? html`<select class="pick" data-action="rule2-pick" data-id="${r.id}" aria-label="${r.t}">${r.opts.map(v => html`<option ${v === r.v ? raw('selected') : ''}>${v}</option>`)}</select>`
  : html`<span class="lock" data-tip="不能关">${icon('check')}</span>`}</div>`)}</div>`;

/* ---------- 移除设备：先在页内确认，写清会一起去掉多少；指挥在那台上时不让删 ---------- */
function rmHTML() {
  const d = ui.conn.rm, D = d && st.DEV[d];
  if (!D) return html`<div data-part="rm" hidden></div>`;
  const imp = removalImpact(st, d);
  return html`<div data-part="rm"><div class="scrim" data-action="rm-cancel"></div>
    <div class="sheet confirm" role="alertdialog" aria-label="移除 ${D.name}" aria-describedby="rm-desc">
      <div class="sheet-head"><h2>移除 ${D.name}？</h2><span class="sp"></span><button class="x" type="button" data-action="rm-cancel" aria-label="关闭">×</button></div>
      <div class="sheet-body"><p id="rm-desc">${imp.isLead
        ? html`指挥（${nameOf(st, leadKey(st))}）在这台上，先在页头把指挥换成别的，再移除。`
        : html`会一起去掉它的 <b>${imp.sessions}</b> 个对话、<b>${imp.tasks}</b> 件任务，等你处理的一队里 <b>${imp.queue}</b> 件。原型里移除了就找不回来。`}</p></div>
      <div class="sheet-foot"><span class="sp"></span>${imp.isLead
        ? html`<button class="btn" type="button" data-action="rm-cancel" data-focus="rm-ok">知道了</button>`
        : html`<button class="ghost" type="button" data-action="rm-cancel">取消</button><button class="btn danger" type="button" data-action="rm-dev-ok" data-dev="${d}" data-focus="rm-ok">移除</button>`}</div>
    </div></div>`;
}

/* ---------- 添加设备 ---------- */
function sheetReady(sh) {
  const codex = sh.link === 'codex', viaMp = sh.link === 'magpie', mf = st.MP_FOUND.find(f => f.id === sh.mp);
  const mpApps = mf ? sh.apps.filter(a => mf.apps.includes(a)) : [];
  return sh.step === 1 ? !!sh.link : viaMp ? !!(mf && mf.mcp && mf.helper && mpApps.length) : (codex ? !!sh.name : !!(sh.host || '').trim()) && !!(sh.apps.length || (codex && sh.only));
}
function sheetHTML() {
  const sh = ui.conn.sheet;
  if (!sh) return html`<div data-part="sheet" hidden></div>`;
  const codex = sh.link === 'codex', viaMp = sh.link === 'magpie', mpOff = st.MPQ.state === 'off';
  const opts = ['codex', 'ssh', 'magpie'].map(k => { const no = k === 'magpie' && mpOff;
    return html`<button type="button" class="opt ${sh.link === k ? 'on' : ''}" data-action="sheet-link" data-link="${k}" ${no ? raw('disabled') : ''} data-tip="${no ? '本机 magpie 没开，打开后才能选' : LINK[k].tip}">
      <span class="opt-ic">${icOf(LINK[k])}</span><b>${LINK[k].label}</b>${no ? html`<em>没开</em>` : ''}</button>`; });
  const mf = st.MP_FOUND.find(f => f.id === sh.mp);
  const chk = (ok, t, fix) => html`<li class="${ok ? 'ok' : 'no'}"><i>${ok ? icon('check') : '!'}</i><span>${t}${!ok && fix ? html`<small>${fix}</small>` : ''}</span></li>`;
  const mpWhere = html`<div class="found">${st.MP_FOUND.map(f => html`<button type="button" class="fd ${sh.mp === f.id ? 'on' : ''}" data-action="sheet-mp" data-id="${f.id}" ${f.added ? html`disabled data-tip="已经加过了"` : html`data-tip="${f.host} · ${f.addr}"`}>${svg(IC[f.os])}<span>${f.id}</span><small class="mut">${f.host}</small></button>`)}</div>
    ${mf ? html`<ul class="mpchk">${chk(true, `已加成远程 magpie：${mf.id} · ${mf.addr}`)}
      ${chk(mf.mcp, '它的 MCP 服务已加进本机 Library', '在 magpie 的 Providers 里打开这台的“Add its MCP servers to the Library”')}
      ${chk(mf.helper, `那台装了 Pigeon 小助手${mf.helper ? `，找到 ${mf.apps.map(a => AG[a].name).join('、')}` : ''}`, '在那台装上小助手，加进那台 magpie 的 Library，打开它的 MCP 路由')}</ul>` : ''}
    <p class="mpnote mut">只列本机 magpie 里加过的远程 magpie。没看到那台：先在那台 magpie 打开“在局域网共享”，再在这台 magpie 的 Providers 里加成 Remote magpie。用的钥匙要不限额，限过的启动不了那台的程序。</p>`;
  const where = viaMp ? mpWhere : codex
    ? html`<div class="found">${st.FOUND.map(f => html`<button type="button" class="fd ${sh.name === f.name ? 'on' : ''}" data-action="sheet-found" data-name="${f.name}" ${f.added ? html`disabled data-tip="已经加过了"` : ''}>${svg(IC[f.os])}<span>${f.name}</span></button>`)}</div>`
    : html`<input class="field2" id="ssh-host" data-action="sheet-text" data-f="host" placeholder="user@host" value="${sh.host || ''}" autocomplete="off" aria-label="SSH 地址">`;
  const apps = AGENTS.map(a => {
    const gate = codex && sh.only && a === 'codex', on = gate || sh.apps.includes(a), miss = viaMp && mf && !mf.apps.includes(a);
    return html`<button type="button" class="app ${on && !miss ? 'on' : ''}" data-action="sheet-app" data-a="${a}" ${gate || miss ? raw('disabled') : ''} ${miss ? html`data-tip="小助手在那台没找到它"` : ''} aria-pressed="${bool(on && !miss)}">
      <span class="g">${brand(a)}</span><b>${AG[a].name}</b>${gate ? html`<i class="flag gate" data-tip="入口">${icon('door')}</i>` : codex && sh.only && on ? html`<em data-tip="由 Codex 在那边带起">${icon('via')}</em>` : ''}<i class="tick">${icon('check')}</i></button>`;
  });
  const alias = (viaMp ? mf && mf.host : codex ? sh.name : (sh.host || '').trim().split('@').pop()) || '不填就用电脑名';
  return html`<div data-part="sheet"><div class="scrim" data-action="closesheet"></div>
    <div class="sheet" role="dialog" aria-label="添加设备">
      <div class="sheet-head"><h2>添加设备</h2><span class="dots"><i class="${sh.step === 1 ? 'on' : ''}"></i><i class="${sh.step === 2 ? 'on' : ''}"></i></span><span class="sp"></span><button class="x" type="button" data-action="closesheet" aria-label="关闭">×</button></div>
      <div class="sheet-body step-${sh.step}">
        ${sh.step === 1 ? html`<h3>怎么连</h3><div class="opts">${opts}</div>`
          : html`<h3>${codex || viaMp ? '哪台电脑' : '地址'}</h3>${where}
             <h3>名字</h3><input class="field2" id="dev-alias" data-action="sheet-text" data-f="alias" maxlength="24" placeholder="${alias}" value="${sh.alias || ''}" autocomplete="off" aria-label="给这台设备起个名字">
             <h3>接哪些应用 ${codex ? html`<span class="sp"></span><label class="only" data-tip="打开：那台电脑不用装 Pigeon，只连 Codex，别的应用由它带起。关掉：在那台电脑上也装 Pigeon，直接接这些应用"><span>只连 Codex</span><button class="sw" type="button" role="switch" aria-checked="${bool(sh.only)}" data-action="sheet-only"></button></label>` : ''}</h3>
             <div class="apps">${apps}</div>`}
      </div>
      <div class="sheet-foot">${sh.step === 2 ? html`<button class="ghost" type="button" data-action="sheetback">上一步</button>` : ''}<span class="sp"></span>
        <button class="btn" type="button" data-action="${sh.step === 1 ? 'sheetnext' : 'sheetdone'}" ${sheetReady(sh) ? '' : raw('disabled')}>${sh.step === 1 ? '下一步' : '添加'}</button></div>
    </div></div>`;
}

export function mountConn(main) {
  const cards = () => { part(main, 'cards', cardsHTML()); if (ui.conn.fresh) store.set('ui.conn.fresh', '', true); };
  patch(main, html`<div data-part="head"></div>
    <div class="body"><div data-part="cards"></div>
      <h2>协作的规矩</h2>
      <div data-part="rules2"></div>
    </div><div data-part="sheet"></div><div data-part="rm"></div>`);
  part(main, 'head', headHTML()); cards(); part(main, 'rules2', rules2HTML()); part(main, 'sheet', sheetHTML()); part(main, 'rm', rmHTML());
  const offs = [
    store.on(['SUB', 'DEV', 'lead'], () => part(main, 'head', headHTML())),
    // 确认框打开时把焦点放到主按钮上
    store.on(['ui.conn.rm', 'DEV', 'S', 'T', 'Q', 'lead'], ch => { part(main, 'rm', rmHTML()); if (store.touched(ch, 'ui.conn.rm')) $('[data-focus="rm-ok"]', main)?.focus(); }),
    store.on(['DEV', 'paused', 'SUB', 'ui.conn.plan', 'ui.conn.mp'], cards),
    store.on(['RULES2'], () => part(main, 'rules2', rules2HTML())),
    store.on(['ui.conn.sheet', 'SUB', 'DEV'], () => part(main, 'sheet', sheetHTML())),
    // 输入框打字：只改“添加”按钮能不能点
    store.on(['sheetText'], () => { const b = $('[data-action="sheetdone"]', main); if (b && ui.conn.sheet) b.disabled = !sheetReady(ui.conn.sheet); }),
  ];
  return () => offs.forEach(f => f());
}

export function initConn(s) {
  store = s; st = s.state; ui = st.ui;
  const mpKey = () => { const [d, a] = ui.conn.mp.split(':'); return { d, a }; };
  const said = c => `${AG[c.a].name}（${shortDev(st, mpKey().d, true)}）默认用 ${c.model}${TH[c.think] ? ' · 思考' + TH[c.think][0] : ''}`;
  registerAll({
    adddev: () => { store.openSheet(); if (ui.view !== 'conn') store.setView('conn'); },
    closesheet: () => store.closeSheet(),
    sheetnext: () => store.sheetSet({ step: 2 }),
    sheetback: () => store.sheetSet({ step: 1 }),
    sheetdone: () => { const n = store.addDevice(); toast(`已添加 ${n}（示例）`); },
    'sheet-link': ({ d }) => store.sheetSet({ link: d.link, only: d.link === 'codex' }),
    'sheet-found': ({ d }) => store.sheetSet({ name: d.name }),
    'sheet-mp': ({ d }) => store.sheetSet({ mp: d.id }),
    'sheet-app': ({ d }) => store.sheetToggleApp(d.a),
    'sheet-only': () => store.sheetSet({ only: !ui.conn.sheet.only }),
    'sheet-text': [({ d, value }) => store.sheetText(d.f, value), 'input'],
    rename: ({ d, el }) => startRename(store, d.dev, el),
    'rm-dev': ({ d }) => store.askRemove(d.dev),
    'rm-cancel': () => store.cancelRemove(),
    'rm-dev-ok': ({ d }) => { const n = store.removeDevice(d.dev); if (n) toast(`已移除 ${n}（示例）`); },
    'pause-dev': ({ d }) => { const r = store.togglePauseDev(d.dev), n = st.DEV[d.dev].name; toast(r.paused ? `已暂停 ${n}：不再往这台送消息` : `${n} 继续了${r.sent ? `，排着的 ${r.sent} 件送出去了` : ''}`); },
    plan: () => store.togglePlan(),
    // 一键接入：改完给一个“撤回”
    apply: () => { const before = store.applyPlan(); toast(`改了 ${st.PLAN.length} 处，本机 ${(st.CONN[st.home] || []).length} 个 agent 都接上了（示例）`, { label: '撤回', run: () => { store.undoPlan(before); toast('撤回了，那几处改回去了（示例）'); } }); },
    // 页头的“指挥”下拉
    'set-lead': [({ value }) => { if (store.setLead(value === 'you' ? { kind: 'you' } : { kind: 'agent', agent: agOf(value), dev: dvOf(value) })) toast(value === 'you' ? '你自己当指挥：在“派活”和刘海上派活，回信进任务页和刘海' : `${nameOf(st, value)} 现在是指挥`); }, 'change'],
    'model-panel': ({ d }) => store.toggleModelPanel(`${d.dev}:${d.a}`),
    'conn-model': ({ d }) => { const { d: dv, a } = mpKey(), c = store.setConnModel(dv, a, d.m); if (c) toast(said(c)); },
    'conn-think': ({ d }) => { const { d: dv, a } = mpKey(), c = store.setConnThink(dv, a, d.t); if (c) toast(said(c)); },
    'conn-on': ({ d }) => store.toggleConn(d.dev, d.a),
    rule2: ({ d }) => store.toggleRule2(d.id),
    'rule2-pick': [({ d, value }) => store.setRule2(d.id, +value), 'change'],
  });
}
