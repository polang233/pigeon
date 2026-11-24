// 几个页面都用的小块：agent 标记、状态、设备标签、订阅圆盘、模型和思考强度、接法标签、密钥标红。
// 都返回 html``，插进去的数据已经转义。
import { html, raw, bool } from '../html.js';
import { svg, IC, icon, brand } from '../icons.js';
import { AG, ST, TH, TS, LIVE, REASON } from '../core/labels.js';
import { shortDev } from '../core/names.js';
import { qc, qTip } from '../core/quota.js';
import { splitSecrets, secretsIn, secretKind } from '../core/secrets.js';

// 怎么接的：插件、Hook、MCP、应用操作；远程的是应用内、经 Codex、SSH、经 magpie
export const HOW = {
  plugin: { label: '插件', ic: icon('puzzle'), tip: '装进它自己的插件系统' },
  hook: { label: 'Hook', ic: icon('hook'), tip: '回调：它每一轮开始和结束时通知 Pigeon，也用这条路把消息送进去' },
  mcp: { label: 'MCP', ic: icon('plug'), tip: '给它加一组工具，它能自己派活、发消息' },
  ui: { label: '应用操作', ic: icon('pointer'), tip: '没有接口的地方，直接操作它的界面：点按钮、输入文字' },
  inapp: { label: '应用内', ic: () => brand('codex'), tip: 'Codex 自己处理：用它自带的远程能力，那台电脑不用装 Pigeon' },
  viacodex: { label: '经 Codex', ic: icon('via'), tip: '由那台电脑上的 Codex 启动并转交' },
  ssh: { label: 'SSH', ic: icon('term'), tip: '经 SSH 在那台电脑上启动它' },
  codexapp: { label: 'Codex 应用', ic: () => brand('codex'), tip: '经本机 Codex 应用给它的对话发消息、新开对话，等它这一轮结束再送进去，不打断；回信从对话里取' },
  cli: { label: '命令行', ic: icon('term'), tip: '用它自带的命令行在后台跑：新开对话、接着已有对话说，跑完把回复取回来' },
  agentapi: { label: 'agentapi', ic: icon('term'), tip: '用它给 agent 用的 agentapi 新开对话、发消息，再读它本机服务等回复。要 Antigravity 开着；读回复用的是它的内部接口，升级可能会变' },
  viamagpie: { label: '经 magpie', ic: icon('bird'), tip: '这台经 magpie 把活交给那台的 Pigeon 小助手，小助手在那台本地交给它；回信由这台定时去取' },
};
// 设备是怎么连上的
export const LINK = {
  local: { label: '本机', ic: icon('mac'), tip: 'Pigeon 就装在这台电脑上' },
  codex: { label: 'Codex 应用内', ic: () => brand('codex'), tip: '用 Codex 自带的远程，那台电脑登录同一个 Codex 账号就行，不用装别的。线从本机的 Codex 连过去' },
  ssh: { label: 'SSH', ic: icon('term'), tip: '经 SSH 连过去，在那边启动 agent' },
  magpie: { label: '经 magpie', ic: icon('bird'), tip: '两台都装 magpie：这台把那台加成远程 magpie，经它的 MCP 路由把活交给那台的 Pigeon 小助手，由小助手在那台本地发起。要在同一个局域网里，不在的话用 Tailscale 这类组网' },
};
// 图标有的要等 art/brand.js 加载完才画得出来，所以可以是函数
export const icOf = x => (typeof x.ic === 'function' ? x.ic() : x.ic);

// agent 的标记：一个小方块里放它的像素标志；state 有值时外面套一圈状态框
export const g = (a, cls = '', state) => html`<span class="g ${cls} ${state ? 'ring ' + state : ''}" style="--c:${AG[a].c}${state ? `;--s:${ST[state][1]}` : ''}">${brand(a)}</span>`;
// 任务的状态：没发出的写原因，暂停中的标出来
export const taskSt = t => html`<span class="st"><i class="dot ${LIVE.includes(t.state) && !t.paused ? 'run' : ''}" style="--s:${TS[t.state][1]}"></i>${t.state === 'refused' && REASON[t.reason] ? REASON[t.reason] : TS[t.state][0]}${t.paused ? '（暂停中）' : ''}</span>`;
// 一个状态：小圆点加文字
export const stTag = state => html`<span class="st"><i class="dot ${state}" style="--s:${ST[state][1]}"></i>${ST[state][0]}</span>`;
// 设备的图标（按它的系统）
export const devIc = (st, d) => svg(IC[st.DEV[d] ? st.DEV[d].os : d]);
export const devBadge = (st, d, short) => html`<span class="badge" title="${st.DEV[d].name}">${devIc(st, d)}${shortDev(st, d, !short)}</span>`;

// 订阅剩余：一个小圆盘，悬停看细节
export const quotaDisc = (st, a, d) => {
  const q = st.SUB[`${a}@${d}`]; if (!q) return '';
  if (q.left == null) return html`<i class="quota none" data-tip="${qTip(q)}"></i>`;
  return html`<i class="quota" style="--q:${q.left}%;--qc:${qc(q.left)}" data-tip="${qTip(q)}"></i>`;
};

// 正在用的模型和思考强度：几格小竖条，正在思考时一起起伏。m 是 { m 模型, t 思考强度, run 在不在想 }
export const modelTag = (m, tip) => {
  if (!m || !m.m) return '';
  const th = TH[m.t];
  return html`<span class="mdl ${m.run ? 'on' : ''}" data-tip="${tip || `${m.m}${th ? ` · 思考强度${th[0]}` : ' · 不分思考强度'}${m.run && th ? ' · 正在思考' : ''}`}"><span>${m.m}</span>${th ? raw(`<i class="think l${th[1]}"><b></b><b></b><b></b><b></b></i>`) : ''}</span>`;
};
// 选思考强度：点第几格就是哪一档。lv 是这个模型分的几档，action 是点了以后的动作（参数 data-t）
export const thinkPick = (lv, cur, action) => lv.length
  ? html`<span class="tpick" role="group" aria-label="思考强度">${lv.map(l => html`<button type="button" data-action="${action}" data-t="${l}" aria-pressed="${bool(l === cur)}" class="${lv.indexOf(l) <= lv.indexOf(cur) ? 'f' : ''}" aria-label="${TH[l][0]}"><i style="height:${5 + TH[l][1] * 3}px"></i></button>`)}<em>${TH[cur] ? TH[cur][0] : ''}</em></span>`
  : html`<span class="none">不分思考强度</span>`;

// 接法标签
export const howChip = k => html`<span class="chip2" data-tip="${HOW[k].label}：${HOW[k].tip}">${icOf(HOW[k])}<span>${HOW[k].label}</span></span>`;

// 要发的原文：按设置把像密钥的字符串标红或打码
export const secretBody = (st, v) => {
  const mode = st.settings.secrets;
  if (mode === 'off') return html`${v}`;
  return html`${splitSecrets(v).map(p => p.text != null ? p.text
    : mode === 'mask' ? html`<mark class="masked">‹${p.kind} 已打码›</mark>` : html`<mark class="secret">${p.secret.slice(0, 8)}…</mark>`)}`;
};
export function secretNote(st, v) {
  const n = secretsIn(v), mode = st.settings.secrets;
  if (!n.length || mode === 'off') return '';
  const kinds = [...new Set(n.map(secretKind))].join('、');
  return mode === 'mask'
    ? html`<p class="snote ok">${icon('key')}<span>里面有 ${n.length} 个 ${kinds}，已按设置打码，对方收到的是占位符</span></p>`
    : html`<p class="snote">${icon('key')}<span>里面有 ${n.length} 个像 ${kinds} 的字符串，原样放行的话，对方电脑上看得到原文</span></p>`;
}
