// 频道：按项目分的群聊（设计见 docs/CHANNELS.md，现在是 0.3a 的原型）。
// 左边频道列表，中间消息流和输入框，右边成员。列表最下面的“全部任务”就是原来的任务页（views/tasks.js），嵌在中间那一栏。
// 在输入框里 @ 谁就是派活给谁，回信回到频道；没 @ 谁交给指挥；切成“留言”只记在频道里，不送给任何 agent。
// 几块各自重画：chlist 频道列表、chhead 频道头、stream 消息流、picks 交给谁、people 成员。输入框只在换频道时重画，打字不重画。
import { html, raw } from '../html.js';
import { icon, brand } from '../icons.js';
import { $, part, patch, reduce } from '../dom.js';
import { AG } from '../core/labels.js';
import { by, cross, shortDev, jumpLabel, isYou, canTake } from '../core/names.js';
import { channelsOf, streamOf, replyCount, mentionsOf, mentionAt, targetsOf } from '../core/channels.js';
import { g, taskSt, stTag, devIc, secretBody, secretNote, modelTag } from './parts.js';
import { whyChip, whyHTML, ctxHTML, stepsHTML, canRetry, mountTasks, mdBlock, fullOf, fullHTML, wantFull } from './tasks.js';
import { registerAll } from '../actions.js';
import { toast, after } from './toast.js';

let store, st, ui, root = null, unTasks = null, CH = [], cur = null;
const opened = new Set(); // 消息流里展开了详情的任务
let menu = { open: false, list: [], i: 0, at: -1 }; // @ 的候选框
const live = () => st.mode === 'live';

const chans = () => (CH = channelsOf(st, ui.chan.extra));
const current = () => ui.chan.id === 'all' ? null : CH.find(c => c.id === ui.chan.id) || CH.find(c => c.tasks.length) || CH[0] || null;
const notesOf = c => (c && st.NOTES[c.id]) || [];
const unreadOf = c => Math.max(0, replyCount(streamOf(st, c, [])) - (ui.chan.seen[c.id] ?? 0));

// 头像：agent 用它的像素标志，你用信鸽
const ava = (s, state) => s.id === 'you' ? html`<span class="g you">${brand('you')}</span>` : g(s.agent, '', state);
const devShort = d => st.DEV[d] ? shortDev(st, d) : d;
// 用的模型和思考强度：这件任务新开对话时指定的优先，没有就用接活那个对话自己的；都不知道就不画
const mdlOf = (t, s) => t && t.model ? { m: t.model, t: t.think } : s && s.model ? { m: s.model, t: s.think, run: s.state === 'run' } : null;
// 路径只留最后两段，悬停看全的
const shortPath = p => { const xs = String(p).split(/[\\/]/).filter(Boolean); return (xs.length > 2 ? '…/' : '') + xs.slice(-2).join(p.includes('\\') ? '\\' : '/'); };

/* ---------- 左边：频道列表 ---------- */
// 有任务（或手动拉过人）的频道排上面；只是有对话、还没派过活的项目收进底下的折叠组，免得列表太长
function chlistHTML() {
  const c0 = current(), active = c => c.tasks.length || (ui.chan.extra[c.id] || []).length;
  const busy = CH.filter(active), idle = CH.filter(c => !active(c));
  const item = c => {
    const n = unreadOf(c), on = c0 && c0.id === c.id;
    return html`<button type="button" class="chi" data-action="chan" data-id="${c.id}" ${on ? raw('aria-current="page"') : ''} aria-label="${c.name}${c.waiting ? `，${c.waiting} 件等你` : ''}${n ? `，${n} 封新回信` : ''}">
      <span class="chic">${icon(c.key ? 'folder' : 'more')}</span><span class="chn ell">${c.name}</span>
      ${c.running ? html`<i class="chrun" data-tip="${c.running} 个在干活"></i>` : ''}
      ${c.waiting ? html`<i class="flag wait" data-tip="${c.waiting} 件等你">${c.waiting}</i>` : n && !on ? html`<i class="chun num">${n}</i>` : ''}</button>`;
  };
  return html`<aside class="chlist" data-part="chlist"><div class="chlist-h" data-drag><b>频道</b><span class="sp"></span>${live() ? '' : html`<button class="ghost icon-btn" type="button" data-action="chan-new" data-tip="新建频道，挑几个对话拉进来">${icon('plus')}</button>`}</div>
    <div class="chis">${busy.map(item)}${idle.length ? html`<details class="chidle" ${idle.some(c => c0 && c0.id === c.id) ? raw('open') : ''}><summary>没有任务的项目 · ${idle.length}</summary>${idle.map(item)}</details>` : ''}</div>
    <button type="button" class="chi all" data-action="chan" data-id="all" ${ui.chan.id === 'all' ? raw('aria-current="page"') : ''}><span class="chic">${icon('tasks')}</span><span class="chn">全部任务</span><span class="num mut">${st.T.length}</span></button></aside>`;
}

/* ---------- 中间：频道头 ---------- */
function chheadHTML(c) {
  const n = c.members.length + (c.lead ? 1 : 0);
  return html`<div class="head chhead" data-part="chhead"><span class="chic big">${icon('folder')}</span><div class="chtitle"><h1>${c.name}</h1>
      <p>${c.paths.length ? c.paths.map(p => html`<span class="chpath" data-tip="${st.DEV[p.dev]?.name || p.dev}：${p.path}">${devIc(st, p.dev)}<span class="mono">${shortPath(p.path)}</span></span>`) : html`<span class="mut">这些任务的对话没有项目目录</span>`}</p></div>
    <span class="sp"></span><button class="ghost" type="button" data-action="chan-people" aria-pressed="${ui.chan.people ? 'true' : 'false'}">${icon('users')}成员 <span class="num">${n}</span></button></div>`;
}

/* ---------- 中间：消息流 ---------- */
function taskMsg(m) {
  const t = m.t, a = by(st, t.from), b = by(st, t.to);
  if (!a || !b) return '';
  const x = cross(st, t), q = st.Q.find(q => q.band === t.id), more = opened.has(t.id);
  const ask = t.state === 'asking' && q && !q.paused
    ? html`<button class="btn sm" type="button" data-action="release" data-id="${t.id}">放行</button><button class="ghost sm" type="button" data-action="block" data-id="${t.id}">拦下</button>` : '';
  return html`<article class="msg task ${t.state}" id="m-${t.id}" data-id="${t.id}">${ava(a)}
    <div class="mb"><header><b>${a.id === 'you' ? '你' : AG[a.agent].name}</b>${a.id === 'you' ? '' : html`<small class="ell">${a.title}</small>`}
      <span class="to"><span class="arrowto">→</span>${g(b.agent, 'sm')}<b>${AG[b.agent].name}</b>${x ? html`<span class="badge">${devIc(st, b.dev)}${devShort(b.dev)}</span>` : ''}<small class="ell">${b.title}</small>${modelTag(mdlOf(t, b))}</span><time class="num">${t.time}</time></header>
      <div class="bubble">${t.body && t.state === 'asking' ? secretBody(st, t.body) : t.title}</div>${t.body && t.state === 'asking' ? secretNote(st, t.body) : ''}
      <footer>${taskSt(t)}${whyChip(t)}<span class="sp"></span>${ask}${canRetry(t) ? html`<button class="btn sm" type="button" data-action="retry-task" data-id="${t.id}">重发</button>` : ''}
        <button class="linkbtn" type="button" data-action="msg-more" data-id="${t.id}" aria-expanded="${more ? 'true' : 'false'}">${more ? '收起' : '详情'}</button></footer>
      ${more ? html`<div class="mdetail">${stepsHTML(t, x)}${t.error && ['refused', 'lost', 'failed'].includes(t.state) ? html`<p class="note">${t.error}</p>` : ''}${t.state === 'asking' ? '' : fullHTML(t, { reply: false })}${whyHTML(t)}${ctxHTML(t)}</div>` : ''}
    </div></article>`;
}
function replyMsg(m) {
  const t = m.t, s = by(st, m.from);
  if (!s) return '';
  // 回信：读过全文就按 Markdown 画全文；没读过先画预览，预览可能被截短，给一个“看全文”
  const F = fullOf(t.id), whole = F && F.answer;
  const text = whole || (m.own ? (t.reply ? `${t.title}\n${t.reply}` : t.title) : t.reply);
  const cut = !whole && st.mode === 'live' && !m.own;
  return html`<article class="msg reply ${m.thread ? 'threaded' : ''}" id="m-${m.id}">${ava(s, s.state)}
    <div class="mb"><header><b>${AG[s.agent].name}</b><small class="ell">${s.title}</small><span class="rtag">回信</span>${modelTag(mdlOf(t, s))}${s.dev !== st.home ? html`<span class="badge">${devIc(st, s.dev)}${devShort(s.dev)}</span>` : ''}<time class="num">${t.time}</time></header>
      <div class="bubble">${mdBlock(text)}${cut ? html`<button class="linkbtn" type="button" data-action="msg-full" data-id="${t.id}">${F && F.busy ? '在读全文…' : F && F.err ? F.err + '，再试一次' : '看全文'}</button>` : ''}</div>
      <footer class="ract"><button class="ghost sm" type="button" data-action="chan-ask" data-s="${s.id}">接着问</button><button class="ghost sm" type="button" data-action="chan-fwd" data-id="${t.id}" data-s="${s.id}">转给…</button>${s.stub && st.mode === 'live' ? '' : html`<button class="ghost sm" type="button" data-action="jump" data-s="${s.id}">${icon('jump')}${jumpLabel(st, s)}</button>`}</footer>
    </div></article>`;
}
const noteMsg = m => html`<article class="msg note" id="m-${m.id}"><span class="g you">${brand('you')}</span>
  <div class="mb"><header><b>你</b><span class="rtag">留言</span><time class="num">${m.time}</time></header><div class="bubble">${m.text}</div></div></article>`;

function streamHTML(c) {
  const msgs = streamOf(st, c, notesOf(c));
  const hint = live()
    ? (c.key ? `按项目目录“${c.name}”自动归集往来；在下面 @ 一个能接活的 agent，可直接在这个项目目录里派活。` : '这些任务的对话没有项目目录，先放在这里。在下面 @ 一个能接活的 agent 派活。')
    : `${c.key ? `按项目目录“${c.name}”自动建的频道：目录名一样的对话都在这里，跨电脑也算。` : '这些任务的对话没有项目目录，先放在这里。'}没 @ 谁的消息交给指挥。`;
  const intro = html`<div class="sysline">${icon('folder')}<span>${hint}</span></div>`;
  const body = msgs.length ? msgs.map(m => m.kind === 'task' ? taskMsg(m) : m.kind === 'reply' ? replyMsg(m) : noteMsg(m))
    : html`<div class="empty pad"><p>这个频道还没有消息。在下面 @ 一个 agent 派活，或者写一句留言。</p></div>`;
  return html`<div class="stream" data-part="stream" role="log" aria-label="${c.name} 的消息">${intro}<div class="dayline"><span>今天</span></div>${body}</div>`;
}

/* ---------- 中间：输入框 ---------- */
function picksHTML(c) {
  const picks = ui.chan.picks, note = !live() && ui.chan.mode === 'note';
  const auto = targetsOf(st, c, []);
  const autoCanTake = auto.length && canTake((st.CONN[auto[0].dev] || []).find(x => x.a === auto[0].agent));
  const chip = (m, i) => html`<span class="pick">${g(m.agent, 'sm')}<b>${m.label}</b><small>${m.fresh ? '新开对话' : m.sub}${m.dev !== st.home ? ` · ${devShort(m.dev)}` : ''}</small><button type="button" class="px" data-action="chan-unpick" data-i="${i}" aria-label="不交给 ${m.label}">${icon('x')}</button></span>`;
  const who = note ? html`<span class="mut">只记在频道里，不送给任何 agent</span>`
    : picks.length ? picks.map(chip)
    : live() && !autoCanTake ? html`<span class="mut">输入 <code>@</code> 或点右下角 @ 选一个能接活的 agent</span>`
    : auto.length ? html`<span class="pick auto" data-tip="没 @ 谁时交给指挥，它按分派规则再交给合适的">${g(auto[0].agent, 'sm')}<b>指挥 ${auto[0].label}</b><small>没 @ 谁时交给它</small></span>`
    : html`<span class="warn-t">你自己当指挥，要 @ 一个接活的</span>`;
  return html`<div class="cmp-top" data-part="picks"><span class="mut">${note ? '留言' : '交给'}</span>${who}<span class="sp"></span>
    ${live() ? '' : html`<div class="seg sm">${[['task', '派活'], ['note', '留言']].map(([k, l]) => html`<button type="button" data-action="chan-mode" data-m="${k}" aria-pressed="${ui.chan.mode === k ? 'true' : 'false'}">${l}</button>`)}</div>`}</div>`;
}
const composerHTML = c => html`<div class="composer" data-part="composer">${picksHTML(c)}
  <div class="cmp-box"><textarea id="chan-input" data-focus="chan-input" rows="2" placeholder="${!live() && ui.chan.mode === 'note' ? '写一句留言，只记在频道里' : live() ? '@ 选一个能接活的 agent，在这个项目里派活' : '@ 交给谁，写下要做的事；不 @ 就交给指挥'}" aria-label="在 ${c.name} 里发消息"></textarea>
    <div class="mention" id="mention" role="listbox" hidden></div>
    <div class="cmp-act"><span class="mut kbd">⌘↩ 发出</span><button class="ghost icon-btn" type="button" data-action="chan-at" data-tip="@ 交给谁">${icon('at')}</button><button class="btn" type="button" data-action="chan-send">${icon('send')}发出</button></div></div></div>`;

/* ---------- 右边：成员 ---------- */
function peopleHTML(c) {
  if (!c || !ui.chan.people) return html`<aside class="people" data-part="people" hidden></aside>`;
  const L = c.lead && c.lead !== 'you' ? by(st, c.lead) : null;
  const row = (s, role) => html`<div class="prow">${ava(s, s.state)}<button type="button" class="pmain" data-action="chan-mention" data-s="${s.id}" data-tip="@ 它">
      <b>${AG[s.agent].name}${role ? html`<i class="role">${role}</i>` : ''}</b><small class="ell">${s.title}</small>${modelTag(mdlOf(null, s))}</button>
      ${stTag(s.state)}</div>`;
  const byDev = {};
  c.members.map(id => by(st, id)).filter(Boolean).forEach(s => (byDev[s.dev] ??= []).push(s));
  const devs = Object.keys(byDev).sort((a, b) => (a === st.home ? -1 : b === st.home ? 1 : 0));
  const rest = st.S.filter(s => !s.parent && !s.relay && s.id !== c.lead && !c.members.includes(s.id));
  return html`<aside class="people" data-part="people" aria-label="成员">
    <div class="people-h"><b>成员</b><span class="sp"></span><button class="px" type="button" data-action="chan-people" aria-label="收起成员">${icon('x')}</button></div>
    <h3>指挥</h3>${L ? row(L, '') : html`<div class="prow"><span class="g you">${brand('you')}</span><div class="pmain"><b>你</b><small>你自己派活</small></div></div>`}
    ${devs.map(d => html`<h3>${devIc(st, d)}${st.DEV[d]?.name || d} · ${byDev[d].length}</h3>${byDev[d].map(s => row(s, ''))}`)}
    ${isYou(st) ? '' : html`<h3>你</h3><div class="prow"><span class="g you">${brand('you')}</span><div class="pmain"><b>你</b><small>在频道里${live() ? '@ 谁派活' : '留言、@ 谁派活'}</small></div></div>`}
    ${live() ? '' : html`<details class="pull"><summary class="ghost">${icon('plus')}拉进来</summary>
      ${rest.length ? rest.map(s => html`<button type="button" class="prow pick-in" data-action="chan-pull" data-s="${s.id}">${ava(s, s.state)}<span class="pmain"><b>${AG[s.agent].name}</b><small class="ell">${s.title} · ${devShort(s.dev)}</small></span></button>`) : html`<p class="mut">别的对话都在这个频道里了</p>`}
    </details>`}</aside>`;
}

/* ---------- 画 ---------- */
function draw(changed) {
  if (!root) return;
  chans();
  const c = current();
  if (c && ui.chan.id !== c.id && ui.chan.id !== 'all') ui.chan.id = c.id;
  part(root, 'chlist', chlistHTML());
  const main = $('#chmain', root);
  if (!c) { // 全部任务
    if (!unTasks) { main.className = 'chmain all'; main.innerHTML = ''; unTasks = mountTasks(main); cur = null; }
    part(root, 'people', peopleHTML(null));
    return;
  }
  if (unTasks) { unTasks(); unTasks = null; }
  const fresh = !cur || cur !== c.id || !$('[data-part="stream"]', main);
  if (fresh) {
    main.className = 'chmain';
    patch(main, html`${chheadHTML(c)}${streamHTML(c)}${composerHTML(c)}`);
    cur = c.id;
    const ta = $('#chan-input', main); ta.value = ui.chan.draft || ''; autosize(ta);
    toBottom(true);
  } else {
    const sv = $('[data-part="stream"]', main), near = sv.scrollHeight - sv.scrollTop - sv.clientHeight < 80, top = sv.scrollTop;
    part(main, 'chhead', chheadHTML(c));
    part(main, 'stream', streamHTML(c));
    part(main, 'picks', picksHTML(c));
    const s2 = $('[data-part="stream"]', main);
    if (near) toBottom(false); else s2.scrollTop = top;
  }
  part(root, 'people', peopleHTML(c));
  store.chanSeen(c.id, replyCount(streamOf(st, c, [])));
  flashFocus();
}
function toBottom(instant) {
  const sv = $('[data-part="stream"]', root);
  if (sv) sv.scrollTo({ top: sv.scrollHeight, behavior: instant || reduce ? 'auto' : 'smooth' });
}
// 从别处点开的那件：滚过去亮一下
function flashFocus() {
  const id = ui.chan.focus;
  if (!id) return;
  ui.chan.focus = '';
  const el = $(`#m-${CSS.escape(id)}`, root);
  if (!el) return;
  requestAnimationFrame(() => { el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); });
}
// 输入框跟着字数长高，最多 160；空着时回到两行。宽度还是 0（刚挂上、换页动画里）时量不准，留到下一帧再量
const autosize = ta => {
  if (!ta.value) { ta.style.height = ''; return; }
  if (!ta.clientWidth) { requestAnimationFrame(() => autosize(ta)); return; }
  ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
};

/* ---------- @ 候选框 ---------- */
function showMenu(list, at, i = 0) {
  const box = $('#mention', root);
  if (!box) return;
  menu = { open: list.length > 0, list, i, at };
  if (!menu.open) { box.hidden = true; return; }
  const row = (m, i) => html`<button type="button" class="mopt ${i === menu.i ? 'on' : ''}" role="option" aria-selected="${i === menu.i ? 'true' : 'false'}" data-action="chan-pick" data-i="${i}">${g(m.agent, 'sm')}<b>${m.label}</b><small class="ell">${m.sub}</small>${m.dev !== st.home ? html`<span class="badge">${devIc(st, m.dev)}${devShort(m.dev)}</span>` : ''}${m.lead ? html`<i class="role">指挥</i>` : ''}</button>`;
  const inChan = list.filter(m => !m.fresh), fresh = list.filter(m => m.fresh);
  patch(box, html`${inChan.length ? html`<h4>频道里的对话</h4>${inChan.map(m => row(m, list.indexOf(m)))}` : ''}${fresh.length ? html`<h4>新开一个对话</h4>${fresh.map(m => row(m, list.indexOf(m)))}` : ''}`);
  box.hidden = false;
  $('.mopt.on', box)?.scrollIntoView({ block: 'nearest' });
}
const hideMenu = () => { menu.open = false; const b = $('#mention', root); if (b) b.hidden = true; };
function onInput(e) {
  const ta = e.target; if (ta.id !== 'chan-input') return;
  store.chanDraft(ta.value); autosize(ta);
  const c = current(), hit = c && mentionAt(ta.value, ta.selectionStart);
  if (hit) showMenu(mentionsOf(st, c, hit.q).slice(0, 12), hit.at); else hideMenu();
}
function choose(i) {
  const m = menu.list[i], ta = $('#chan-input', root);
  if (!m || !ta) return;
  // 把打了一半的 @xxx 从输入框里去掉，换成上面的一个标签
  if (menu.at >= 0) { const end = ta.selectionStart; ta.value = ta.value.slice(0, menu.at) + ta.value.slice(end).replace(/^\s/, ''); ta.setSelectionRange(menu.at, menu.at); store.chanDraft(ta.value); }
  hideMenu();
  store.chanPick({ ...m, picked: true });
  ta.focus();
}
function onKeydown(e) {
  if (e.target.id !== 'chan-input') return;
  if (menu.open) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); showMenu(menu.list, menu.at, (menu.i + (e.key === 'ArrowDown' ? 1 : -1) + menu.list.length) % menu.list.length); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(menu.i); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideMenu(); return; }
  }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); return; }
  // 输入框空着时按退格，去掉最后一个 @ 的标签
  if (e.key === 'Backspace' && !e.target.value && ui.chan.picks.length) { e.preventDefault(); store.chanUnpick(ui.chan.picks.length - 1); }
}

/* ---------- 发出 ---------- */
function send() {
  const c = current(), ta = $('#chan-input', root);
  if (!c || !ta) return;
  const text = ta.value.trim();
  if (!text) { ta.focus(); return; }
  const done = () => { ta.value = ''; store.chanDraft(''); autosize(ta); ui.chan.picks = []; store.emit('ui.chan.picks'); };
  if (!live() && ui.chan.mode === 'note') { store.chanNote(c.id, text); done(); return; }
  const targets = targetsOf(st, c, ui.chan.picks);
  if (!targets.length || (live() && !targets.some(m => canTake((st.CONN[m.dev] || []).find(x => x.a === m.agent))))) {
    toast(live() ? '请先 @ 一个能接活的 agent（Codex、DeepSeek Harness 或 Antigravity）' : '你自己当指挥时，要 @ 一个接活的');
    ta.focus();
    return;
  }
  after(store.chanSend({ targets, text, chan: c }), r => {
    if (!r || r.empty) return;
    done();
    const rs = r.results || [], asking = rs.filter(x => x.result === 'asking').length, off = rs.filter(x => ['offline', 'no_target'].includes(x.result)).length;
    const names = targets.map(x => x.lead && !x.picked ? `指挥 ${x.label}` : `${x.label}（${x.fresh ? `${x.dev !== st.home ? devShort(x.dev) + ' 上' : ''}新开的对话` : x.sub}）`).join('、');
    toast(off ? `有 ${off} 件没发出：那台连不上` : asking ? `交给 ${names}；跨设备的 ${asking} 件先在刘海上确认` : `交给 ${names} 了`);
    if (asking) store.hud('confirm');
  });
}

export function mountChannels(main) {
  root = main; cur = null; menu = { open: false, list: [], i: 0, at: -1 };
  // 窗口窄、成员栏只能盖在消息上时，默认不打开
  if (main.clientWidth && main.clientWidth < 1000) ui.chan.people = false;
  patch(main, html`<div class="chan" id="chan"><aside data-part="chlist"></aside><section class="chmain" id="chmain"></section><aside data-part="people"></aside></div>`);
  draw();
  const off = store.on(['T', 'S', 'Q', 'DEV', 'NOTES', 'lead', 'RULES', 'SUB', 'paused', 'ui.chan', 'settings.secrets', 'FULL'], draw);
  const offPicks = store.on(['ui.chan.picks'], () => { const c = current(); if (c) { part($('#chmain', root), 'picks', picksHTML(c)); const ta = $('#chan-input', root); if (ta) ta.placeholder = ui.chan.mode === 'note' ? '写一句留言，只记在频道里' : '@ 交给谁，写下要做的事；不 @ 就交给指挥'; } });
  const blur = e => {
    if (!e.target.closest?.('#mention, #chan-input')) hideMenu();
    // 成员栏盖在消息上（窗口窄）时，点外面收起
    const pp = $('.chan > .people:not([hidden])', root);
    if (pp && getComputedStyle(pp).position === 'absolute' && !e.target.closest?.('.people, [data-action="chan-people"]')) store.togglePeople();
  };
  main.addEventListener('input', onInput); main.addEventListener('keydown', onKeydown); document.addEventListener('mousedown', blur);
  return () => {
    off(); offPicks();
    main.removeEventListener('input', onInput); main.removeEventListener('keydown', onKeydown); document.removeEventListener('mousedown', blur);
    if (unTasks) { unTasks(); unTasks = null; }
    root = null; cur = null;
  };
}

export function initChannels(s) {
  store = s; st = s.state; ui = st.ui;
  registerAll({
    chan: ({ d }) => store.setChan(d.id),
    'chan-new': () => toast('手动拉群要等存得下频道（0.3b）；现在频道按项目目录自动建'),
    'chan-people': () => store.togglePeople(),
    'chan-mode': ({ d }) => { store.chanMode(d.m); $('#chan-input')?.focus(); },
    'chan-unpick': ({ d }) => store.chanUnpick(+d.i),
    'chan-pick': ({ d }) => choose(+d.i),
    'chan-send': () => send(),
    // 点 @ 按钮：在光标处插一个 @，弹出候选
    'chan-at': () => {
      const ta = $('#chan-input'); if (!ta) return;
      const p = ta.selectionStart ?? ta.value.length, pre = p > 0 && !/\s/.test(ta.value[p - 1]) ? ' @' : '@';
      ta.value = ta.value.slice(0, p) + pre + ta.value.slice(p); ta.focus(); ta.setSelectionRange(p + pre.length, p + pre.length);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    },
    // 成员栏里点一个对话：@ 它
    'chan-mention': ({ d }) => {
      const c = current(), m = c && mentionsOf(st, c).find(x => x.session === d.s);
      if (m) store.chanPick({ ...m, picked: true }); else toast('它现在接不了活');
      $('#chan-input')?.focus();
    },
    'chan-ask': ({ d }) => {
      const c = current(), m = c && mentionsOf(st, c).find(x => x.session === d.s);
      if (!m) { toast('它现在接不了活'); return; }
      ui.chan.picks = [{ ...m, picked: true }]; ui.chan.mode = 'task'; store.emit('ui.chan.picks');
      $('#chan-input')?.focus();
    },
    // 转给…：把回信引在输入框里，弹出 @ 候选选给谁
    'chan-fwd': ({ d }) => {
      const t = st.T.find(x => x.id === d.id), s = by(st, d.s), ta = $('#chan-input');
      if (!t || !ta) return;
      const quote = (t.reply || t.title).split('\n').map(l => '> ' + l).join('\n');
      ui.chan.picks = []; ui.chan.mode = 'task'; store.emit('ui.chan.picks');
      ta.value = `${AG[s?.agent]?.name || '它'}的回信，你接着处理：\n${quote}\n@`;
      store.chanDraft(ta.value); autosize(ta); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    },
    'chan-pull': ({ d }) => { const c = current(); if (c) { store.chanPull(c.id, d.s); toast('拉进来了（原型里只记在这个页面，刷新就没了）'); } },
    // 展开或收起一件的详情：只重画消息流，滚动位置不动
    // 回信看全文：读完 FULL 话题会重画
    'msg-full': ({ d }) => { const t = st.T.find(x => x.id === d.id); if (t && store.loadFull) store.loadFull(t.id); },
    'msg-more': ({ d }) => {
      if (opened.has(d.id)) opened.delete(d.id); else { opened.add(d.id); wantFull(st.T.find(x => x.id === d.id)); }
      const c = current(), sv = $('[data-part="stream"]', root); if (!c || !sv) return;
      const top = sv.scrollTop; part($('#chmain', root), 'stream', streamHTML(c)); $('[data-part="stream"]', root).scrollTop = top;
    },
  });
}
