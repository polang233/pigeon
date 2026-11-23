// 接入：一张卡片一台设备，一行一个 agent：怎么接的、能不能发能不能收、订阅剩多少、开关；默认模型点开在下面改。
// 下面是协作的规矩。“添加设备”是一个两步的面板：先选怎么连，再选哪台电脑、起名、接哪些应用。
// 应用模式：本机 Codex 那一行多一个“设置”（Codex 自己的事件、中继对话、交给 Codex 的活怎么跑），页面最下面是用量；
// 添加设备只有“Codex 应用内”（经中继对话重新读一次远程电脑），移除的设备能恢复。
// 几块：head 页头（magpie 连没连上）、cards 设备卡片、rules2 协作的规矩、usage 用量、sheet 添加设备、rm 移除确认。
import { html, raw, bool } from '../html.js';
import { svg, IC, icon, brand } from '../icons.js';
import { $, part, patch } from '../dom.js';
import { AGENTS, AG, TH, CAP } from '../core/labels.js';
import { named, shortDev, isPaused, levelsOf, online, leadKey, leadOptions, nameOf, removalImpact, agOf, dvOf } from '../core/names.js';
import { devIc, quotaDisc, modelTag, thinkPick, howChip, LINK, icOf } from './parts.js';
import { registerAll } from '../actions.js';
import { startRename } from './rename.js';
import { toast, after } from './toast.js';
import { srv } from './settings.js';

let store, st, ui;
const live = () => st.mode === 'live';

const cap = (dir, k) => html`<i class="cap ${k}" role="img" aria-label="${CAP[dir][k]}" data-tip="${CAP[dir][k]}">${icon(dir)}</i>`;
// 接入页的“设备:agent”：设备 id 里可能有冒号，agent 在最后一个冒号后面
const mpKey = () => { const k = ui.conn.mp, i = k.lastIndexOf(':'); return { d: k.slice(0, i), a: k.slice(i + 1) }; };

function mpanelHTML(c) {
  const grp = c.model.startsWith('group/'), list = st.MODELS[c.a] || [];
  const chip = (m, label, cls = '', tip = '') => html`<button class="mchip ${cls}" type="button" data-action="conn-model" data-m="${m}" aria-pressed="${bool(m === c.model)}" ${tip ? html`data-tip="${tip}"` : ''}>${label}</button>`;
  return html`<div class="mpanel"><span class="lb">模型</span><span class="mpick">${live() ? chip('', `${AG[c.a].name} 默认`, '', '不指定，用它自己配的') : ''}${list.map(([m, , label]) => chip(m, label || m))}${live() && !list.length ? html`<span class="none">没读到它能用的模型</span>` : ''}</span>
    ${st.MAGPIE.on ? html`<span class="lb" data-tip="本机 magpie 里配的路由组：一个名字后面挂几个模型或账号，按它的规则自动选">magpie</span><span class="mpick">${st.MAGPIE.groups.map(([m, tip]) => chip(m, m, 'mg', tip))}</span>` : ''}
    <span class="lb">思考</span><span>${grp ? html`<span class="none">由 magpie 的路由组决定</span>` : !c.model && live() ? html`<span class="none">由 ${AG[c.a].name} 决定</span>` : thinkPick(levelsOf(st, c.a, c.model), c.think, 'conn-think')}</span>
    <span></span><small class="mut">Pigeon 派活、新开对话时默认用这个，不改它自己的配置；刘海上派活时还能临时换。</small></div>`;
}

/* ---------- 本机 Codex 的设置（应用模式）：Codex 自己的事件、中继对话、交给 Codex 的活怎么跑 ---------- */
const CODEX0 = { preferForImages: true, imageMode: 'builtin', imageModel: 'gpt-image-2', imageQuality: 'medium', imageAspect: 'square', imageTransparent: false, imageDir: 'assets/generated',
  sessionMode: 'keep', openWhen: 'end', routeAll: true, model: '', effort: '', sandbox: 'auto', timeoutMin: 10, maxConcurrent: 2, summaryChars: 300 };
const EFFORT = { none: '不推理', minimal: '极少', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高', ultra: '超高' };
function cxHTML() {
  const cx = k => { const v = srv(st, ['codex', k], undefined); if (k === 'sessionMode' && v === undefined && srv(st, ['codex', 'showInCodex'], true) === false) return 'temp'; if (k === 'openWhen' && !v) return srv(st, ['codex', 'autoOpen'], false) ? 'end' : 'never'; return v === undefined ? CODEX0[k] : v; };
  const sw = (k, label, tip, dis) => html`<span class="lb" ${tip ? html`data-tip="${tip}"` : ''}>${label}</span><span><button class="sw" type="button" role="switch" aria-checked="${bool(cx(k))}" data-action="srv-sw" data-path="codex.${k}" aria-label="${label}" ${dis ? raw('disabled') : ''}></button></span>`;
  const seg = (k, label, opts, tip) => html`<span class="lb" ${tip ? html`data-tip="${tip}"` : ''}>${label}</span><span class="seg" role="group" aria-label="${label}">${opts.map(([v, l]) => html`<button type="button" data-action="srv-set" data-path="codex.${k}" data-v="${v}" aria-pressed="${bool(cx(k) === v)}">${l}</button>`)}</span>`;
  const pick = (path, label, opts, cur, tip, num) => html`<span class="lb" ${tip ? html`data-tip="${tip}"` : ''}>${label}</span><span><select class="pick" data-action="srv-pick" data-path="${path}" ${num ? raw('data-num="1"') : ''} aria-label="${label}">${opts.map(([v, l]) => html`<option value="${v}" ${String(v) === String(cur) ? raw('selected') : ''}>${l}</option>`)}</select></span>`;
  const num = (k, label, min, max, unit, tip) => html`<span class="lb" ${tip ? html`data-tip="${tip}"` : ''}>${label}</span><span><input class="numin" type="number" min="${min}" max="${max}" step="1" data-action="srv-num" data-path="codex.${k}" data-min="${min}" data-max="${max}" value="${cx(k)}" aria-label="${label}"> ${unit}</span>`;
  const text = (k, label, tip) => html`<span class="lb" ${tip ? html`data-tip="${tip}"` : ''}>${label}</span><span><input class="txtin" data-action="srv-text" data-path="codex.${k}" data-def="${CODEX0[k]}" value="${cx(k)}" placeholder="${CODEX0[k]}" autocomplete="off" spellcheck="false" aria-label="${label}"></span>`;
  const H = st.HOOKS || {}, api = cx('imageMode') === 'api';
  const relay = srv(st, ['post', 'relayThread'], ''), mine = st.S.filter(s => s.agent === 'codex' && s.dev === st.home && !s.stub);
  const relayOpts = [['', '没设置'], ...mine.map(s => [s.id, `${s.relay ? '★ ' : ''}${s.title}`]), ...(relay && !mine.some(s => s.id === relay) ? [[relay, `当前：${relay.slice(0, 8)}…`]] : [])];
  const m0 = cx('model'), M = (st.CODEXM || []).find(x => x.slug === m0), efforts = M && M.efforts.length ? M.efforts : ['low', 'medium', 'high', 'xhigh', 'max'];
  return html`<div class="cpanel">
    <h4>Codex 和 Pigeon</h4>
    <span class="lb" data-tip="在本机 Codex 的配置里加两条回调，它每一轮开始、结束、调工具时告诉 Pigeon。会改本机 Codex 的配置，马上生效">接收 Codex 自己的事件</span>
    <span class="hookrow"><button class="sw" type="button" role="switch" aria-checked="${bool(!!H.installed)}" data-action="cx-hooks" aria-label="接收 Codex 自己的事件" ${H.busy || H.installed == null ? raw('disabled') : ''}></button><small class="${H.err ? 'bad' : 'mut'}" role="status">${H.err || (H.busy ? '读取中…' : H.detail || (H.installed == null ? '' : H.working ? '已收到 Codex 的事件' : '还没收到 Codex 的事件'))}</small></span>
    ${pick('post.relayThread', '中继对话', relayOpts, relay, '本机 Codex 里专门用来转发的那个对话。往别的电脑发消息都要经过它，每次转发跑一轮模型。不设就只能给本机的对话发')}
    <h4>Claude Code 经 pigeon run 交给 Codex 的活</h4>
    ${sw('routeAll', '都走 Pigeon', 'Claude Code 直接跑 codex exec 或用 Codex 的 MCP 派活时，改走 pigeon run，这样都能看到进度、按这里的设置跑')}
    ${pick('codex.model', '模型', [['', 'Codex 默认'], ...(st.CODEXM || []).map(m => [m.slug, m.name])], m0)}
    ${pick('codex.effort', '推理档位', [['', 'Codex 默认'], ...efforts.map(e => [e, `${EFFORT[e] || e}（${e}）`])], cx('effort'))}
    ${pick('codex.sandbox', '沙箱', [['auto', '按任务自动'], ['read-only', '只读'], ['workspace-write', '可写工作区']], cx('sandbox'), '按任务自动：审查和其他任务只读，写代码和生图可写工作区')}
    ${seg('sessionMode', '对话记录', [['keep', '留在 Codex 里'], ['temp', '临时任务']], '留在 Codex 里：在 Codex 应用里能看到这段对话')}
    ${cx('sessionMode') === 'temp' ? '' : seg('openWhen', '在 Codex 里打开', [['start', '一开始'], ['end', '做完后'], ['never', '不打开']], 'Codex 应用的对话列表不列 Pigeon 派的活，要靠这里打开。一开始就打开能看着它做，但跑完前只能看、不能接着说')}
    ${num('timeoutMin', '超时', 1, 120, '分钟')}
    ${num('maxConcurrent', '同时最多', 1, 8, '件')}
    ${num('summaryChars', '结果摘要最长', 60, 2000, '字')}
    <h4>生图</h4>
    ${sw('preferForImages', '生图先交给 Codex', 'Claude Code 遇到要生成位图的活时，交给 Codex 画')}
    ${seg('imageMode', '生图方式', [['builtin', '内置'], ['api', 'API']], '内置不需要 key；API 方式要 OPENAI_API_KEY，才能选模型和质量')}
    ${api ? text('imageModel', '图片模型') : ''}
    ${api ? seg('imageQuality', '图片质量', [['low', '低'], ['medium', '中'], ['high', '高']]) : ''}
    ${seg('imageAspect', '画幅', [['square', '方形'], ['landscape', '横版'], ['portrait', '竖版']])}
    ${sw('imageTransparent', '透明背景')}
    ${text('imageDir', '存到项目里的', '相对项目根目录')}
  </div>`;
}

const rowHTML = (d, c) => {
  const k = `${d}:${c.a}`, isCx = live() && d === st.home && c.a === 'codex';
  const tip = c.det && c.det.detail ? c.det.detail : '';
  const mdl = c.inn === 'nope' ? '' : html`<button type="button" class="mdlbtn" data-action="model-panel" data-dev="${d}" data-a="${c.a}" aria-expanded="${bool(ui.conn.mp === k)}">${c.model ? modelTag({ m: c.model, t: c.think }, `默认用 ${c.model}${TH[c.think] ? ' · 思考' + TH[c.think][0] : ''} · 点一下改`) : html`<span class="mdl" data-tip="没指定，用它自己配的 · 点一下改"><span>默认模型</span></span>`}</button>`;
  return html`<div class="arow ${c.role || ''} ${c.on ? '' : 'off'} ${c.na ? 'na' : ''}">
    <span class="g">${brand(c.a)}</span><b ${tip ? html`data-tip="${tip}"` : ''}>${AG[c.a].name}</b>${c.role === 'gate' ? html`<i class="flag gate" data-tip="入口：别的 agent 经它带起">${icon('door')}</i>` : ''}
    <span class="chips">${c.na ? html`<span class="chip2 na" data-tip="检测到装了 ${AG[c.a].name}，Pigeon 还没接上它：不能给它派活，也不能当指挥">还没接上</span>` : html`${mdl}${c.how.map(howChip)}${isCx ? html`<button type="button" class="chip2 cxbtn" data-action="cx-panel" aria-expanded="${bool(ui.conn.cx)}" data-tip="Codex 自己的事件、中继对话、交给 Codex 的活怎么跑">${icon('gear')}<span>设置</span></button>` : ''}`}</span>
    <span class="caps">${cap('out', c.out)}${cap('in', c.inn)}</span>
    ${st.SUB[`${c.a}@${d}`] ? quotaDisc(st, c.a, d) : html`<i class="quota none" data-tip="${live() ? '没有额度读数' : '按量付费，没有订阅额度'}"></i>`}
    ${c.na ? html`<button class="sw" type="button" role="switch" aria-checked="false" disabled aria-label="${AG[c.a].name} 还没接上"></button>` : html`<button class="sw" type="button" role="switch" aria-checked="${bool(c.on)}" data-action="conn-on" data-dev="${d}" data-a="${c.a}" aria-label="接入 ${AG[c.a].name}"></button>`}</div>
    ${ui.conn.mp === k ? mpanelHTML(c) : ''}${isCx && ui.conn.cx ? cxHTML() : ''}`;
};

function cardHTML(d) {
  const D = st.DEV[d], L = LINK[D.link], home = d === st.home;
  const plan = html`<div class="plan"><div class="files mono">${st.PLAN.map(([f, w]) => html`<span data-tip="${w}，其他内容原样保留，可以单独撤回"><code>${f}</code></span>`)}</div>
    <div class="acts"><button class="ghost" type="button" data-action="plan">先不改</button><button class="btn" type="button" data-action="apply">改这 ${st.PLAN.length} 处</button></div></div>`;
  const retry = live() ? html`<button class="ghost sm" type="button" data-action="reconnect" data-dev="${d}" data-tip="经中继对话重新读一次远程电脑，要花一些 token">重新读一次</button>` : html`<button class="ghost sm" type="button" data-action="reconnect" data-dev="${d}">重试</button>`;
  return html`<section class="dcard ${ui.conn.fresh === d ? 'fresh' : ''}">
    <header><span class="g dev lg">${devIc(st, d)}</span><h2 class="dname" data-action="rename" data-dev="${d}" data-tip="${named(st, d) ? `电脑名 ${D.host} · ` : ''}点一下改名"><span>${D.name}</span>${icon('pen')}</h2>
      <span class="chip2 link" data-tip="${L.label}：${L.tip}">${icOf(L)}<span>${L.label}</span></span>${isPaused(st, d) ? html`<span class="chip2 pz">${icon('pause')}<span>已暂停</span></span>` : ''}${online(st, d) ? '' : html`<span class="chip2 off" role="status">${icon('x')}<span>连不上</span></span>${retry}`}<span class="sp"></span>
      <button class="ghost icon ${st.paused.dev[d] ? 'on' : ''}" type="button" data-action="pause-dev" data-dev="${d}" data-tip="${st.paused.dev[d] ? '继续往这台送消息' : '暂停这台：不再往这台送消息，在路上的停在原地'}">${icon(st.paused.dev[d] ? 'play' : 'pause')}</button>
      ${home ? (live() ? '' : html`<button class="ghost icon" type="button" data-action="plan" data-tip="一键接入本机全部：先列出会改哪几个文件">${icon('wand')}</button>`) : html`<button class="ghost icon" type="button" data-action="rm-dev" data-dev="${d}" data-tip="${live() ? '从界面上移除这台设备' : '移除这台设备'}">${icon('more')}</button>`}</header>
    ${home && ui.conn.plan && !live() ? plan : ''}
    <div class="arows">${st.CONN[d].length ? st.CONN[d].map(c => rowHTML(d, c)) : html`<p class="note pad">${live() ? '这台没检测到能接的应用' : '还没接 agent'}</p>`}</div></section>`;
}
// 只有本机的时候多一张虚线卡片，告诉你下一步；应用模式下移除过的设备列在下面，能恢复
const hiddenHTML = () => (st.HIDDEN || []).length ? html`<div class="panel hiddendev"><span class="mut">从界面上移除了</span>${st.HIDDEN.map(h => html`<span class="hd"><b>${h.name}</b><button class="ghost sm" type="button" data-action="restore-dev" data-dev="${h.id}">${icon('undo')}恢复</button></span>`)}</div>` : '';
const cardsHTML = () => html`<div data-part="cards"><div class="dcards">${Object.keys(st.DEV).map(cardHTML)}${Object.keys(st.DEV).length === 1 ? html`<section class="dcard ghostcard"><p>还没有别的设备。加一台，就能把活派到那台电脑上的 agent。</p><button class="btn" type="button" data-action="adddev">${icon('plus')}添加设备</button></section>` : ''}</div>${live() ? hiddenHTML() : ''}</div>`;

function headHTML() {
  const M = st.MPQ, bird = icon('bird');
  const groups = st.MAGPIE.on ? `；默认模型里能选它的 ${st.MAGPIE.groups.length} 个路由组` : '';
  const chip = M.state === 'live' ? html`<span class="chip2 mgc" data-tip="本机 magpie ${M.ver}：本机几家的订阅额度是从它读的（${M.cards} 张，${M.at} 读的）${live() ? groups : '；路由组还是示例'}">${bird}<span>magpie 已连上</span></span>`
    : M.state === 'off' ? html`<span class="chip2 mgc off" data-tip="${live() ? '连不上本机 magpie，读不到额度和路由组。打开 magpie 后一分钟内会自己连上' : '连不上本机 magpie，额度和路由组都是示例。打开 magpie 后一分钟内会自己连上'}">${bird}<span>magpie 没开</span></span>`
    : M.state === 'demo' && st.MAGPIE.on ? html`<span class="chip2 mgc" data-tip="示例：默认模型里能直接选 magpie 的 ${st.MAGPIE.groups.length} 个路由组。用 tools/serve.py 打开，额度会换成本机 magpie 的真数据">${bird}<span>magpie 已连上</span></span>` : '';
  const lk = leadKey(st), opts = leadOptions(st);
  const leadPick = html`<label class="leadpick" data-tip="同一时间只有一个指挥。能发出的 agent 才能当；也可以是你自己，在 Pigeon 里派活"><span>指挥</span><select class="pick" data-action="set-lead" aria-label="指挥">${opts.map(k => html`<option value="${k}" ${k === lk ? raw('selected') : ''}>${AG[agOf(k)].name} · ${shortDev(st, dvOf(k))}</option>`)}${lk !== 'you' && !opts.includes(lk) ? html`<option value="${lk}" selected>${nameOf(st, lk)}（现在不能发出）</option>` : ''}<option value="you" ${lk === 'you' ? raw('selected') : ''}>你自己</option></select></label>`;
  return html`<div class="head" data-part="head"><h1>接入</h1>${leadPick}<span class="sp"></span>${chip}
    <span class="legend">${['yes', 'part', 'nope'].map(k => html`<i class="cap ${k}" role="img" aria-label="图例：${CAP.legend[k]}" data-tip="${CAP.legend[k]}">${icon('out')}</i>`)}</span>
    <button class="btn" type="button" data-action="adddev">${icon('plus')}添加设备</button></div>`;
}
const rules2HTML = () => html`<div class="panel rules2" data-part="rules2">${st.RULES2.map(r => html`<div class="trow"><span data-tip="${r.tip}">${r.t}</span>${r.kind === 'sw'
  ? html`<button class="sw" type="button" role="switch" aria-checked="${bool(r.on)}" data-action="rule2" data-id="${r.id}" aria-label="${r.t}"></button>`
  : r.kind === 'pick' ? html`<span class="pickunit"><select class="pick" data-action="rule2-pick" data-id="${r.id}" aria-label="${r.t}">${r.opts.map(v => html`<option value="${v}" ${v === r.v ? raw('selected') : ''}>${v}</option>`)}</select>${r.unit ? html` <span class="mut">${r.unit}</span>` : ''}</span>`
  : html`<span class="lock" data-tip="不能关">${icon('check')}</span>`}</div>`)}</div>`;

/* ---------- 用量（应用模式）：今天和近 7 天，来自 Claude Code 和 Codex 自己的对话记录，只在本机统计 ---------- */
const UNAME = { claude: 'Claude Code', subagent: '子代理', codex: 'Codex', cursor: 'Cursor', deepseek: 'DeepSeek Harness' };
const METRICS = [['output', '输出'], ['input', '输入'], ['cacheRead', '缓存读'], ['cacheWrite', '缓存写'], ['messages', '消息数']];
export const fmtTokens = n => { const v = Math.max(0, Number(n) || 0), u = v >= 1e8 ? 1e8 : v >= 1e4 ? 1e4 : 1; return u === 1 ? String(Math.round(v)) : String(Number((v / u).toFixed(1))) + (u === 1e8 ? ' 亿' : ' 万'); };
function usageHTML() {
  const U = st.USAGE, order = Object.keys(UNAME);
  if (!U) return html`<div data-part="usage"><h2>用量</h2><div class="panel pad"><p class="note" style="margin:0">还没读到用量</p></div></div>`;
  const list = Object.entries(U.agents || {}).filter(([, v]) => v && typeof v === 'object').sort(([a], [b]) => (order.includes(a) ? order.indexOf(a) : 99) - (order.includes(b) ? order.indexOf(b) : 99));
  return html`<div data-part="usage"><h2>用量 · ${U.day || '今天'}，按 token 算<span class="mut" data-tip="来自 Claude Code 和 Codex 自己的对话记录，只在本机统计">只算本机</span></h2>
    ${list.length ? html`<div class="ucards">${list.map(([a, v]) => html`<div class="panel ucard"><header><b>${UNAME[a] || a}</b><span class="mono mut">${v.model || '模型没记下'}</span></header>
      <table class="utable"><caption class="sr">${UNAME[a] || a} 的用量</caption><thead><tr><th scope="col"></th><th scope="col">今天</th><th scope="col">近 7 天</th></tr></thead><tbody>${METRICS.map(([k, l]) => html`<tr><th scope="row">${l}</th>${['today', 'week'].map(p => { const n = v[p]?.[k]; return html`<td class="num" ${n != null ? html`data-tip="${Number(n).toLocaleString('zh-CN')}${k === 'messages' ? ' 条消息' : ' token'}"` : ''}>${n == null ? '—' : k === 'messages' ? Number(n).toLocaleString('zh-CN') : fmtTokens(n)}</td>`; })}</tr>`)}</tbody></table></div>`)}</div>`
      : html`<div class="panel pad"><p class="note" style="margin:0">还没有用量记录</p></div>`}</div>`;
}

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
        : live() ? html`只是不在 Pigeon 里显示：它的 <b>${imp.sessions}</b> 个对话、<b>${imp.tasks}</b> 件任务跟着不显示，等你处理的一队里往这台的 <b>${imp.queue}</b> 件也不显示，到点就不发。不影响那台电脑，在“添加设备”里能恢复。`
        : html`会一起去掉它的 <b>${imp.sessions}</b> 个对话、<b>${imp.tasks}</b> 件任务，等你处理的一队里 <b>${imp.queue}</b> 件。演示里移除了就找不回来。`}</p></div>
      <div class="sheet-foot"><span class="sp"></span>${imp.isLead
        ? html`<button class="btn" type="button" data-action="rm-cancel" data-focus="rm-ok">知道了</button>`
        : html`<button class="ghost" type="button" data-action="rm-cancel">取消</button><button class="btn danger" type="button" data-action="rm-dev-ok" data-dev="${d}" data-focus="rm-ok">移除</button>`}</div>
    </div></div>`;
}

/* ---------- 添加设备 ---------- */
// 应用模式里第一版只有“Codex 应用内”
const LIVE_NO = { ssh: '第一版还不能经 SSH 连', magpie: '第一版还不能经 magpie 连' };
function sheetReady(sh) {
  if (live()) return sh.step === 1 ? sh.link === 'codex' : !!srv(st, ['post', 'relayThread'], '');
  const codex = sh.link === 'codex', viaMp = sh.link === 'magpie', mf = st.MP_FOUND.find(f => f.id === sh.mp);
  const mpApps = mf ? sh.apps.filter(a => mf.apps.includes(a)) : [];
  return sh.step === 1 ? !!sh.link : viaMp ? !!(mf && mf.mcp && mf.helper && mpApps.length) : (codex ? !!sh.name : !!(sh.host || '').trim()) && !!(sh.apps.length || (codex && sh.only));
}
// 应用模式的第二步：说明会做什么、花 token，列出现在知道的远程电脑（移除过的能恢复）
function liveStep2() {
  const relay = srv(st, ['post', 'relayThread'], ''), known = Object.keys(st.DEV).filter(d => d !== st.home);
  return html`<h3>经 Codex 应用内</h3>
    <p class="mpnote">那台电脑登录同一个 Codex 账号就行，不用装别的。Pigeon 经本机 Codex 的中继对话重新读一次：这个账号下连着的电脑会出现在接入页和指挥台上。</p>
    <p class="snote">${icon('key')}<span>这会让中继对话跑一轮模型，要花一些 token。</span></p>
    ${relay ? '' : html`<p class="snote">${icon('x')}<span>还没设中继对话：先在本机 Codex 那一行的“设置”里选一个。</span></p>`}
    <h3>现在知道的远程电脑</h3>
    <div class="found">${known.map(d => html`<span class="fd on" data-tip="${st.DEV[d].host}">${devIc(st, d)}<span>${st.DEV[d].name}</span></span>`)}${(st.HIDDEN || []).map(h => html`<button type="button" class="fd" data-action="restore-dev" data-dev="${h.id}" data-tip="从界面上移除了，点一下恢复">${icon('undo')}<span>${h.name}</span></button>`)}${known.length || (st.HIDDEN || []).length ? '' : html`<span class="mut">还没有</span>`}</div>`;
}
function sheetHTML() {
  const sh = ui.conn.sheet;
  if (!sh) return html`<div data-part="sheet" hidden></div>`;
  const codex = sh.link === 'codex', viaMp = sh.link === 'magpie', mpOff = st.MPQ.state === 'off';
  const opts = ['codex', 'ssh', 'magpie'].map(k => { const no = live() ? LIVE_NO[k] : k === 'magpie' && mpOff ? '本机 magpie 没开，打开后才能选' : '';
    return html`<button type="button" class="opt ${sh.link === k && !no ? 'on' : ''}" data-action="sheet-link" data-link="${k}" ${no ? raw('disabled') : ''} data-tip="${no || LINK[k].tip}">
      <span class="opt-ic">${icOf(LINK[k])}</span><b>${LINK[k].label}</b>${no ? html`<em>${live() ? '还不能' : '没开'}</em>` : ''}</button>`; });
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
  const step2 = live() ? liveStep2() : html`<h3>${codex || viaMp ? '哪台电脑' : '地址'}</h3>${where}
             <h3>名字</h3><input class="field2" id="dev-alias" data-action="sheet-text" data-f="alias" maxlength="24" placeholder="${alias}" value="${sh.alias || ''}" autocomplete="off" aria-label="给这台设备起个名字">
             <h3>接哪些应用 ${codex ? html`<span class="sp"></span><label class="only" data-tip="打开：那台电脑不用装 Pigeon，只连 Codex，别的应用由它带起。关掉：在那台电脑上也装 Pigeon，直接接这些应用"><span>只连 Codex</span><button class="sw" type="button" role="switch" aria-checked="${bool(sh.only)}" data-action="sheet-only"></button></label>` : ''}</h3>
             <div class="apps">${apps}</div>`;
  return html`<div data-part="sheet"><div class="scrim" data-action="closesheet"></div>
    <div class="sheet" role="dialog" aria-label="添加设备">
      <div class="sheet-head"><h2>添加设备</h2><span class="dots"><i class="${sh.step === 1 ? 'on' : ''}"></i><i class="${sh.step === 2 ? 'on' : ''}"></i></span><span class="sp"></span><button class="x" type="button" data-action="closesheet" aria-label="关闭">×</button></div>
      <div class="sheet-body step-${sh.step}">
        ${sh.step === 1 ? html`<h3>怎么连</h3><div class="opts">${opts}</div>` : step2}
      </div>
      <div class="sheet-foot">${sh.step === 2 ? html`<button class="ghost" type="button" data-action="sheetback">上一步</button>` : ''}<span class="sp"></span>
        <button class="btn" type="button" data-action="${sh.step === 1 ? 'sheetnext' : live() ? 'sheet-refresh' : 'sheetdone'}" ${sheetReady(sh) ? '' : raw('disabled')}>${sh.step === 1 ? '下一步' : live() ? '重新读一次' : '添加'}</button></div>
    </div></div>`;
}

export function mountConn(main) {
  const cards = () => { part(main, 'cards', cardsHTML()); if (ui.conn.fresh) store.set('ui.conn.fresh', '', true); };
  patch(main, html`<div data-part="head"></div>
    <div class="body"><div data-part="cards"></div>
      <h2>协作的规矩</h2>
      <div data-part="rules2"></div>
      ${live() ? html`<div data-part="usage"></div>` : ''}
    </div><div data-part="sheet"></div><div data-part="rm"></div>`);
  part(main, 'head', headHTML()); cards(); part(main, 'rules2', rules2HTML()); part(main, 'sheet', sheetHTML()); part(main, 'rm', rmHTML());
  if (live()) { part(main, 'usage', usageHTML()); if (ui.conn.cx) store.loadCodexHooks(); }
  const offs = [
    store.on(['SUB', 'DEV', 'lead'], () => part(main, 'head', headHTML())),
    // 确认框打开时把焦点放到主按钮上
    store.on(['ui.conn.rm', 'DEV', 'S', 'T', 'Q', 'lead'], ch => { part(main, 'rm', rmHTML()); if (store.touched(ch, 'ui.conn.rm')) $('[data-focus="rm-ok"]', main)?.focus(); }),
    store.on(['DEV', 'paused', 'SUB', 'ui.conn.plan', 'ui.conn.mp', 'SRV', 'HOOKS'], cards),
    store.on(['RULES2'], () => part(main, 'rules2', rules2HTML())),
    store.on(['ui.conn.sheet', 'SUB', 'DEV', 'SRV'], () => part(main, 'sheet', sheetHTML())),
    store.on(['USAGE'], () => { if (live()) part(main, 'usage', usageHTML()); }),
    // 输入框打字：只改“添加”按钮能不能点
    store.on(['sheetText'], () => { const b = $('[data-action="sheetdone"]', main); if (b && ui.conn.sheet) b.disabled = !sheetReady(ui.conn.sheet); }),
  ];
  // 本机 Codex 的设置里有对话列表（中继对话），对话变了要跟着换；正在下拉时不动
  if (live()) offs.push(store.on(['S'], () => { if (ui.conn.cx && !main.querySelector('.cpanel select:focus')) cards(); }));
  return () => offs.forEach(f => f());
}

export function initConn(s) {
  store = s; st = s.state; ui = st.ui;
  const said = c => `${AG[c.a].name}（${shortDev(st, mpKey().d, true)}）默认用 ${c.model || '它自己的默认模型'}${TH[c.think] ? ' · 思考' + TH[c.think][0] : ''}`;
  const say = v => after(v, msg => { if (msg) toast(msg); });
  registerAll({
    adddev: () => { store.openSheet(); if (ui.view !== 'conn') store.setView('conn'); },
    closesheet: () => store.closeSheet(),
    sheetnext: () => store.sheetSet({ step: 2 }),
    sheetback: () => store.sheetSet({ step: 1 }),
    sheetdone: () => { const n = store.addDevice(); toast(`已添加 ${n}（示例）`); },
    // 应用模式的“添加设备”：经中继对话重新读一次远程电脑
    'sheet-refresh': () => after(store.refreshRemote(), msg => { store.closeSheet(); toast(msg); }),
    'sheet-link': ({ d }) => store.sheetSet({ link: d.link, only: d.link === 'codex' }),
    'sheet-found': ({ d }) => store.sheetSet({ name: d.name }),
    'sheet-mp': ({ d }) => store.sheetSet({ mp: d.id }),
    'sheet-app': ({ d }) => store.sheetToggleApp(d.a),
    'sheet-only': () => store.sheetSet({ only: !ui.conn.sheet.only }),
    'sheet-text': [({ d, value }) => store.sheetText(d.f, value), 'input'],
    rename: ({ d, el }) => startRename(store, d.dev, el),
    'rm-dev': ({ d }) => store.askRemove(d.dev),
    'rm-cancel': () => store.cancelRemove(),
    'rm-dev-ok': ({ d }) => after(store.removeDevice(d.dev), n => { if (n) toast(live() ? `已从界面上移除 ${n}，在“添加设备”里能恢复` : `已移除 ${n}（示例）`); }),
    'restore-dev': ({ d }) => after(store.restoreDevice(d.dev), n => toast(`${n} 回来了`)),
    'pause-dev': ({ d }) => { const n = st.DEV[d.dev].name; after(store.togglePauseDev(d.dev), r => toast(r.paused ? `已暂停 ${n}：不再往这台送消息` : `${n} 继续了${r.sent ? `，排着的 ${r.sent} 件送出去了` : ''}`)); },
    plan: () => store.togglePlan(),
    // 一键接入（演示）：改完给一个“撤回”
    apply: () => { const before = store.applyPlan(); toast(`改了 ${st.PLAN.length} 处，本机 ${(st.CONN[st.home] || []).length} 个 agent 都接上了（示例）`, { label: '撤回', run: () => { store.undoPlan(before); toast('撤回了，那几处改回去了（示例）'); } }); },
    // 页头的“指挥”下拉
    'set-lead': [({ value }) => after(store.setLead(value === 'you' ? { kind: 'you' } : { kind: 'agent', agent: agOf(value), dev: dvOf(value) }), ok => { if (ok) toast(value === 'you' ? '你自己当指挥：在“派活”和刘海上派活，回信进任务页和刘海' : `${nameOf(st, value)} 现在是指挥`); }), 'change'],
    'model-panel': ({ d }) => store.toggleModelPanel(`${d.dev}:${d.a}`),
    'conn-model': ({ d }) => { const { d: dv, a } = mpKey(); after(store.setConnModel(dv, a, d.m), c => { if (c) toast(said(c)); }); },
    'conn-think': ({ d }) => { const { d: dv, a } = mpKey(); after(store.setConnThink(dv, a, d.t), c => { if (c) toast(said(c)); }); },
    'conn-on': ({ d }) => after(store.toggleConn(d.dev, d.a)),
    'cx-panel': () => { store.toggleCodexPanel(); if (ui.conn.cx) store.loadCodexHooks(); },
    'cx-hooks': ({ el }) => after(store.setCodexHooks(el.getAttribute('aria-checked') !== 'true'), h => toast(h.installed ? '装好了：Codex 每一轮会告诉 Pigeon' : '关掉了：不再接收 Codex 自己的事件')),
    'srv-set': ({ d }) => after(store.setServer(d.path.split('.'), d.v)),
    reconnect: ({ d }) => say(store.reconnect(d.dev)),
    rule2: ({ d }) => store.toggleRule2(d.id),
    'rule2-pick': [({ d, value }) => store.setRule2(d.id, +value), 'change'],
  });
}
