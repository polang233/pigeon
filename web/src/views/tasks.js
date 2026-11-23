// 全部任务（频道页里的“全部”，见 views/channels.js）：agent 之间发出的每一件事，谁给谁、什么状态、走到哪一步、回信、为什么给它、交出去多少上下文。
// 跨设备的任务在这里放行或拦下；没回音、没人理、连不上的可以重发。几块：head 页头和筛选、list 列表、drawer 展开的那件。
// 状态和原因照契约：asking / queued / flying / delivered / home / refused（reason）/ lost，暂停是 paused 叠在上面。
import { html } from '../html.js';
import { icon } from '../icons.js';
import { part, patch } from '../dom.js';
import { AG, REASON, LIVE } from '../core/labels.js';
import { by, cross, keyOf, keyOfEnd, nameOf, jumpLabel, tById, ruleById, secsLeft } from '../core/names.js';
import { g, taskSt, secretBody, secretNote } from './parts.js';
import { registerAll } from '../actions.js';
import { toast, after } from './toast.js';
import { durZh } from '../core/time.js';

let store, st, ui, shown = '';

const FILTERS = [['all', '全部', () => true], ['mine', '等我', t => t.state === 'asking'], ['cross', '跨设备', t => cross(st, t)]];
const listOf = () => st.T.filter(FILTERS.find(f => f[0] === ui.tasks.filter)[2]);
// 能重发的：没回音、没人理、连不上。应用模式下只有应用自己发的（retryable，应用留着原文）
export const canRetry = t => (st.mode !== 'live' || t.retryable) && (t.state === 'lost' || (t.state === 'refused' && ['timeout', 'offline'].includes(t.reason)));
// 用了多久：应用模式下还在路上的按现在算
const durOf = t => (st.mode === 'live' && t.created && (LIVE.includes(t.state) || t.state === 'asking') ? durZh(store.clock() - t.created) : t.dur);
const isReply = t => !t.why && t.kind === '回信';

// 为什么交给它：一个小标签放在任务那一行，详细的写在下面。why.kind：rule、quota、override、lead
export function whyChip(t) {
  const w = t.why; if (!w) return '';
  const r = w.rule && ruleById(st, w.rule), n = r ? st.RULES.indexOf(r) + 1 : 0, sug = w.suggested && keyOfEnd(w.suggested);
  if (w.kind === 'override') return html`<i class="why over" data-tip="规则建议给 ${nameOf(st, sug)}，${t.from === 'you' ? '你' : '指挥'}没照做">${t.from === 'you' ? '你改判' : '指挥改判'}</i>`;
  if (w.kind === 'quota') return html`<i class="why fb" data-tip="规则本该给 ${nameOf(st, sug)}，它额度不够，改派了">额度改派</i>`;
  if (w.kind === 'rule' && r) return html`<i class="why" data-tip="命中规则 ${n}：${r.when}">规则 ${n}</i>`;
  if (w.kind === 'lead') return html`<i class="why lead" data-tip="没有规则命中，${t.from === 'you' ? '你自己派的' : '指挥自己判断的'}">${t.from === 'you' ? '你派的' : '指挥判断'}</i>`;
  return '';
}
export function whyHTML(t) {
  const w = t.why;
  if (!w) return isReply(t) ? html`<h4>为什么给它</h4><p class="why-p">这是回信，原路送回给发活的那一方，不走分派规则。</p>` : '';
  const to = keyOf(by(st, t.to)), r = w.rule && ruleById(st, w.rule), rl = r ? `命中规则「${r.when}」` : '', sug = w.suggested && keyOfEnd(w.suggested);
  const who = t.from === 'you' ? '你' : '指挥';
  let p;
  if (w.kind === 'override') p = `${rl}，规则建议给 ${nameOf(st, sug)}；${who}没照做，给了 ${nameOf(st, to)}。${w.reason ? `理由：${w.reason}` : ''}`;
  else if (w.kind === 'quota') { const q = st.SUB[sug]; p = `${rl}，规则写的是交给 ${nameOf(st, sug)}，但它的${q && q.left != null ? `${q.win}只剩 ${q.left}%` : '额度不够'}，低于 ${st.LOW}%，按规则改派给 ${nameOf(st, to)}。`; }
  else if (w.kind === 'rule') p = `${rl || '命中一条规则'}，规则写的就是交给 ${nameOf(st, to)}。`;
  else p = `没有规则命中，${who}自己判断的。${w.reason ? `理由：${w.reason}` : ''}`;
  const act = r ? html`<button class="ghost" type="button" data-action="see-rule" data-id="${t.id}">在分派规则里看</button>`
    : w.kind === 'lead' ? html`<button class="ghost" type="button" data-action="rule-from" data-id="${t.id}">照这件加一条规则</button>` : '';
  return html`<h4>为什么给它</h4><p class="why-p">${p}</p>${act ? html`<div class="acts">${act}</div>` : ''}`;
}
export function ctxHTML(t) {
  if (!t.ctx) return '';
  const { tokens, files } = t.ctx, b = by(st, t.to), win = t.ctx.window || (st.CTXW || {})[b.model] || 0, k = +(tokens / 1000).toFixed(1);
  const pct = win ? Math.round(tokens / win * 100) : 0, big = pct >= 25;
  return html`<h4>交出去的上下文</h4><div class="ctx">${win ? html`<span class="ctxbar ${big ? 'big' : ''}" style="--p:${Math.max(2, pct)}%"><i></i></span><span>约 ${k}k token，占 ${b.model || AG[b.agent].name} 上下文的 ${pct < 1 ? '不到 1' : pct}%</span>` : html`<span>约 ${k}k token</span>`}</div>
    <div class="cfiles">${files.length ? files.map(f => html`<code>${f}</code>`) : html`<span class="mut">只有这一句说明，没带文件</span>`}</div>
    ${big ? html`<p class="warn-p">偏大：对方一开始就用掉 ${pct}% 的上下文，可以只带摘要和改过的文件。${st.mode === 'live' ? '' : html`<button class="ghost" type="button" data-action="slim">以后只带摘要</button>`}</p>` : ''}`;
}

const headHTML = () => {
  const n = Object.fromEntries(FILTERS.map(([k, , f]) => [k, st.T.filter(f).length]));
  return html`<div class="head" data-part="head"><h1>全部任务</h1><p>所有频道里的每一件事，只记谁给谁、什么状态、为什么给它</p><span class="sp"></span>
    <div class="seg">${FILTERS.map(([k, l]) => html`<button type="button" data-action="task-filter" data-f="${k}" aria-pressed="${ui.tasks.filter === k ? 'true' : 'false'}">${l} <span class="num mut">${n[k]}</span></button>`)}</div></div>`;
};
function listHTML(list) {
  const row = t => { const a = by(st, t.from), b = by(st, t.to);
    return html`<button type="button" class="trow ${t.id === shown ? 'hl' : ''}" data-action="open-task" data-id="${t.id}"><span class="num mut">${t.time}</span>
      <span class="who2">${g(a.agent, 'sm')}<span class="arrowto">→</span>${g(b.agent, 'sm')}<span class="ell"><b>${AG[b.agent].name}</b>${cross(st, t) ? html` <small style="display:inline">@ ${st.DEV[b.dev].name}</small>` : ''}</span></span>
      <span class="tcell"><span class="ell">${t.title}</span>${whyChip(t)}</span>${taskSt(t)}<span class="num mut">${durOf(t)}</span></button>`; };
  // 筛选后没有：说一句，给回到全部的按钮
  const empty = ui.tasks.filter === 'all'
    ? html`<div class="empty pad"><p>还没有任务。指挥派活、或者你自己派活之后，这里一件一件记下来。</p><button class="ghost" type="button" data-action="compose">${icon('send')}派活</button></div>`
    : html`<div class="empty pad"><p>${ui.tasks.filter === 'mine' ? '现在没有等你确认的任务。' : '现在没有跨设备的任务。'}</p><button class="ghost" type="button" data-action="task-filter" data-f="all">看全部</button></div>`;
  return html`<div class="panel t-tasks" data-part="list"><div class="trow head-row"><span>时间</span><span>谁给谁</span><span>内容</span><span>状态</span><span>用时</span></div>${list.length ? list.map(row) : empty}</div>`;
}
// 走到哪一步：跨设备的多一步“你确认”。failed 是经 pigeon run 交出去的活跑失败了，停在“送达”
const STEPS = { asking: ['你确认', '跨设备才需要'], queued: ['排队', '等对方空闲，不打断'], flying: ['送出', '在路上'], delivered: ['送达', '对方在做'], home: ['回信', ''] };
export function stepsHTML(t, x) {
  const order = [...(x ? ['asking'] : []), 'queued', 'flying', 'delivered', 'home'];
  // 没发出停在哪一步：拦下、没人理停在“你确认”，其余停在“排队”；没回音停在“送达”
  const bad = t.state === 'refused' ? (['blocked', 'timeout'].includes(t.reason) && x ? 0 : order.indexOf('queued')) : t.state === 'lost' || t.state === 'failed' ? order.indexOf('delivered') : -1;
  const at = bad >= 0 ? bad : order.indexOf(t.state);
  return html`<div class="steps">${order.map((k, i) => html`<div class="${i === bad ? 'bad' : i < at || t.state === 'home' ? 'done' : i === at ? 'now' : ''}"><b>${STEPS[k][0]}</b>${i === bad ? (t.state === 'lost' ? '没回音' : t.state === 'failed' ? '出错了' : REASON[t.reason] || '没发出') : i === at && t.paused ? '暂停中，继续后送出' : STEPS[k][1]}</div>`)}</div>`;
}
function drawerHTML(t) {
  if (!t) return html`<div data-part="drawer" hidden></div>`;
  const a = by(st, t.from), b = by(st, t.to), x = cross(st, t), q = st.Q.find(q => q.band === t.id);
  const warn = q && q.secrets?.length && st.settings.secrets === 'warn';
  const ask = t.state === 'asking' && q && !q.paused
    ? html`${warn ? html`<button class="btn" type="button" data-action="release" data-id="${t.id}" data-mask="1">打码后放行</button><button class="ghost" type="button" data-action="release" data-id="${t.id}">原样放行</button>` : html`<button class="btn" type="button" data-action="release" data-id="${t.id}">放行</button>`}<button class="ghost" type="button" data-action="block" data-id="${t.id}">拦下</button>` : '';
  const body = t.body || (q && q.text) || '';
  return html`<div class="panel drawer" data-part="drawer"><h3>${t.title}</h3><p class="meta"><span class="mono">${t.id}</span> · ${AG[a.agent].name}${a.id === 'you' ? '' : `（${a.title}）`} → ${AG[b.agent].name}（${b.title}）${x ? ' · 跨设备到 ' + st.DEV[b.dev].name : ''}${t.via === 'run' ? ' · 经 pigeon run 交给 Codex' : ''}${t.retry_of ? html` · 重发自 <button class="linkbtn mono" type="button" data-action="open-task" data-id="${t.retry_of}">${t.retry_of}</button>` : ''}</p>
    ${stepsHTML(t, x)}
    ${t.state === 'asking' && q ? html`<p class="note">${q.paused ? '已放行，暂停中，继续后送出' : html`<span data-deadline="${q.deadline}" data-long="1">还剩 ${secsLeft(q, store.clock())} 秒，不点就不发</span>`}</p>` : ''}
    ${body && t.state === 'asking' ? html`<h4>要发的内容</h4><div class="reply">${secretBody(st, body)}</div>${secretNote(st, body)}` : t.state === 'asking' && q?.secrets?.length ? html`<p class="snote">${icon('key')}<span>发送前查到像 ${q.secrets.join('、')} 的字符串</span></p>` : ''}
    ${t.error && ['refused', 'lost', 'failed'].includes(t.state) ? html`<p class="note">${t.error}</p>` : t.stale ? html`<p class="note">两个多小时没有新消息，当成没回音</p>` : ''}
    ${t.reply ? html`<h4>${t.state === 'failed' ? '出错的说法' : '回信'}</h4><div class="reply">${t.reply}</div>` : ''}
    ${whyHTML(t)}${ctxHTML(t)}
    <div class="insp" style="border:0;padding:0"><div class="acts">${ask}${canRetry(t) ? html`<button class="btn" type="button" data-action="retry-task" data-id="${t.id}">重发</button>` : ''}${b.id === 'you' || (b.stub && st.mode === 'live') ? '' : html`<button class="ghost" type="button" data-action="jump" data-s="${b.id}">${icon('jump')}${jumpLabel(st, b)}</button>`}${t.state === 'home' && st.mode !== 'live' ? html`<button class="ghost" type="button" data-action="fwd">把回信转给指挥</button>` : ''}</div></div>
  </div>`;
}

export function mountTasks(main) {
  const draw = () => {
    const list = listOf();
    // 要展开的那件不在列表里（筛掉了，或者刚重发、应用的推送还没到）就先展开第一件，记着的不改，到了就换过去
    const open = list.find(x => x.id === ui.tasks.open) || list[0];
    shown = open?.id || '';
    part(main, 'head', headHTML());
    part(main, 'list', listHTML(list));
    part(main, 'drawer', drawerHTML(open));
  };
  patch(main, html`<div data-part="head"></div><div class="body"><div data-part="list"></div><div data-part="drawer"></div></div>`);
  draw();
  const off = store.on(['T', 'S', 'Q', 'DEV', 'RULES', 'SUB', 'lead', 'settings.secrets', 'ui.tasks'], draw);
  return () => off();
}

export function initTasks(s) {
  store = s; st = s.state; ui = st.ui;
  const RETRIED = { asking: '重发了，跨设备的先在刘海上确认一次', flying: '重发了', paused: '重发了，暂停中先排着', offline: '那台还是连不上，没发出', no_target: '对方不在了，没发出', sent: '重发了，跨设备的会先在刘海上问你' };
  registerAll({
    // 点开一件任务：在看“全部”就展开它，在看某个频道就翻到它所在的频道、滚过去
    'open-task': ({ d }) => { store.openTask(d.id); store.chanFocus(d.id); if (ui.view !== 'tasks') store.setView('tasks'); },
    'task-filter': ({ d }) => store.setTaskFilter(d.f),
    'retry-task': ({ d }) => after(store.retryTask(d.id), r => { if (!r) return; if (r.result === 'asking') store.hud('confirm'); toast(RETRIED[r.result] || '重发了'); }),
    // 在分派规则里看：把这件的标题填进试算框
    'see-rule': ({ d }) => { store.setTry(tById(st, d.id).title); store.setView('route'); },
    // 照这件加一条规则：交给的就是这件交给的那家，接着去写“当任务是”和关键词
    'rule-from': ({ d }) => {
      const r = store.addRule(keyOf(by(st, tById(st, d.id).to)));
      store.setTry(''); store.setView('route'); store.flush();
      document.querySelector(`[data-focus="rule-when:${r.id}"]`)?.focus();
      toast('照这件加了一条，写一下“当任务是”和关键词');
    },
    slim: () => toast('以后派给它时只带摘要和改过的文件（示例）'),
  });
}
