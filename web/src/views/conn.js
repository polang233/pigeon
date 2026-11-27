// 接入：先讲 agent，再讲设备。
// - 接入 agent：最上面选指挥；下面一个 agent 一张卡片：它是怎么接进来的（插件、Hook、统一 MCP、命令行或应用），
//   它在哪几台设备上（每台一行：能不能发能不能收、默认模型、订阅剩多少、开关），“设置”里是交给它的活怎么跑。
// - 设备：一张卡片一台设备，标题旁写怎么连的，卡片里列它上面的 agent；远程设备的设置里换中继对话。添加设备先选怎么连。
// - 协作的规矩，最后是用量：各 agent、各家用了多少、占多少。
// 应用模式多一张新装检查清单（/api/setup），移除的设备能恢复；演示模式里设置改的是页面上的示例。
// 几块：head 页头、setup 检查清单、agents 接入 agent、devs 设备、rules2 协作的规矩、usage 用量、sheet 添加设备、rm 移除确认。
import { html, raw, bool } from '../html.js';
import { svg, IC, icon, brand } from '../icons.js';
import { $, part, patch, reduce } from '../dom.js';
import { AGENTS, AG, TH, CAP } from '../core/labels.js';
import { named, shortDev, isPaused, levelsOf, online, leadKey, leadOptions, nameOf, removalImpact, agOf, dvOf, customModelsOf } from '../core/names.js';
import { usageShare, FAM, METRIC, PERIOD, fmtTokens } from '../core/usage.js';
import { devIc, quotaDisc, modelTag, thinkPick, howChip, LINK, icOf } from './parts.js';
import { registerAll } from '../actions.js';
import { startRename } from './rename.js';
import { toast, after } from './toast.js';
import { srv } from './settings.js';

export { fmtTokens };

let store, st, ui;
let setupFold = null; // null 按是否全部就绪自动收起；true/false 手动折叠或展开
const live = () => st.mode === 'live';

const cap = (dir, k) => html`<i class="cap ${k}" role="img" aria-label="${CAP[dir][k]}" data-tip="${CAP[dir][k]}">${icon(dir)}</i>`;
// 接入页的“设备:agent”：设备 id 里可能有冒号，agent 在最后一个冒号后面
const mpKey = () => { const k = ui.conn.mp, i = k.lastIndexOf(':'); return { d: k.slice(0, i), a: k.slice(i + 1) }; };
const lb = (label, tip) => html`<span class="lb" ${tip ? html`data-tip="${tip}"` : ''}>${label}</span>`;
// 开关：data 是要带的参数，比如 { dev, a } 写成 data-dev、data-a
const sw = (on, action, label, data = {}, dis = false) => html`<button class="sw" type="button" role="switch" aria-checked="${bool(on)}" data-action="${action}" ${Object.entries(data).map(([k, v]) => html`data-${k}="${v}" `)}aria-label="${label}" ${dis ? raw('disabled') : ''}></button>`;
const cmdBox = cmd => html`<span class="cmdbox"><code>${cmd}</code><button class="ghost sm" type="button" data-action="copy-cmd" data-v="${cmd}">复制</button></span>`;

/* ---------- 默认模型：点设备一行里的模型，在下面展开 ---------- */
function mpanelHTML(c) {
  const grp = c.model.startsWith('group/'), list = st.MODELS[c.a] || [], { d } = mpKey(), mine = customModelsOf(st, c.a, d), remote = d !== st.home;
  const chip = (m, label, cls = '', tip = '') => html`<button class="mchip ${cls}" type="button" data-action="conn-model" data-m="${m}" aria-pressed="${bool(m === c.model)}" ${tip ? html`data-tip="${tip}"` : ''}>${label}</button>`;
  // 自己填的模型名：带一个去掉的小叉
  const own = m => html`<span class="mown">${chip(m, m, 'own', '自己填的模型名：思考强度几档都列出来，由对方建对话时校验')}<button class="mx" type="button" data-action="conn-model-rm" data-m="${m}" aria-label="去掉 ${m}">${icon('x')}</button></span>`;
  return html`<div class="mpanel"><span class="lb">模型</span><span class="mpick">${live() ? chip('', `${AG[c.a].name} 默认`, '', '不指定，用它自己配的') : ''}${list.map(([m, , label]) => chip(m, label || m))}${mine.map(own)}${live() && !list.length && !mine.length ? html`<span class="none">没读到它能用的模型</span>` : ''}</span>
    <span class="lb" data-tip="${remote ? '列表是从这台 Mac 的 Codex 读的，那台电脑上自定义的模型读不到，可以把名字填在这里' : '列表里没有的模型，可以把名字填在这里'}">自己填</span><span><input class="txtin" data-action="conn-model-add" placeholder="${remote ? '那台上的模型名，回车加上' : '模型名，回车加上'}" maxlength="80" autocomplete="off" spellcheck="false" aria-label="自己填一个模型名"></span>
    ${st.MAGPIE.on ? html`<span class="lb" data-tip="本机 magpie 里配的路由组：一个名字后面挂几个模型或账号，按它的规则自动选">magpie</span><span class="mpick">${st.MAGPIE.groups.map(([m, tip]) => chip(m, m, 'mg', tip))}</span>` : ''}
    <span class="lb">思考</span><span>${grp ? html`<span class="none">由 magpie 的路由组决定</span>` : !c.model && live() ? html`<span class="none">由 ${AG[c.a].name} 决定</span>` : thinkPick(levelsOf(st, c.a, c.model), c.think, 'conn-think')}</span>
    <span></span><small class="mut">Pigeon 派活、新开对话时默认用这个，不改它自己的配置；刘海上派活时还能临时换。</small></div>`;
}

/* ---------- 接入方式：每个 agent 自己的几种接法 ---------- */
// 统一 Pigeon MCP 的开关（Codex、Antigravity、Cursor）
function mcpRowHTML(client, tip) {
  const M = st.MCP || {}, c = M.clients?.[client] || {}, on = !!c.installed, noNode = M.nodeOk === false;
  return html`${lb('统一 MCP', tip)}
    <span class="hookrow">${sw(on, 'mcp-toggle', `${AG[client].name} 的统一 Pigeon MCP`, { client }, noNode)}<small class="${noNode ? 'bad' : 'mut'}" role="status">${noNode ? '没找到 Node.js，写不了 MCP 入口' : c.detail || (on ? '已接入，重开对话后它能读分派规则、给别的 agent 派活' : '没接：接上后它也能主动派活、读回信')}</small></span>`;
}
const relayTitle = id => ((st.RELAY?.relays || []).find(r => r.id === id) || {}).title || (st.S.find(s => s.id === id) || {}).title || (id ? id.slice(0, 8) + '…' : '');
const hasRemote = () => Object.keys(st.DEV).some(d => d !== st.home);

function waysHTML(a, c) {
  const det = c && c.det && c.det.detail ? c.det.detail : '';
  if (a === 'claude') {
    const P = st.SETUP?.claudePlugin, cmd1 = st.SETUP?.marketplacePath ? `/plugin marketplace add ${st.SETUP.marketplacePath}` : '', cmd2 = '/plugin install pigeon@pigeon';
    const plug = !live() ? html`<span class="mut">装好了，收到过它的 hook（示例）</span>`
      : !P ? html`<span class="mut">${det || '读不到插件的状态'}</span>`
      : P.hookReceived ? html`<span class="ok">已连通：收到过它的 hook，对话和子代理的状态会同步过来</span>`
      : P.installed ? html`<span class="warn">装了，还没收到 hook：在 Claude Code 里新开一个对话，说一句话就连上了</span>`
      : html`<span class="cmdcol"><span class="bad">没装。在 Claude Code 里依次运行这两条，再新开一个对话：</span>${cmd1 ? cmdBox(cmd1) : ''}${cmdBox(cmd2)}</span>`;
    return html`<div class="cpanel ways">
      ${lb('Pigeon 插件', 'Claude Code 的插件：带 hook（每一轮开始、结束时告诉 Pigeon）、pigeon 命令和两个 skill')}${plug}
      ${lb('分派规则', '它当指挥时，插件每一轮把分派规则追加到它的提示里')}<span class="mut">它当指挥时，每一轮把分派规则写进它的提示 <button class="ghost sm" type="button" data-action="nav" data-v="route">去分派规则</button></span>
      ${lb('接收')}<span class="mut">Pigeon 还不能把活送进 Claude Code 的对话，它当指挥、往外派活。</span>
    </div>`;
  }
  if (a === 'codex') {
    const H = st.HOOKS || {}, relay = srv(st, ['post', 'relayThread'], '') || (live() ? '' : st.RELAY?.shared || '');
    return html`<div class="cpanel ways">
      ${lb('Codex 应用', '经本机 Codex 应用给它的对话发消息、新开对话，等它这一轮结束再送进去，不打断；回信从对话里取')}<span class="mut">${det || '经本机 Codex 应用发消息、新开对话，不打断它正在跑的一轮'}</span>
      ${lb('事件回调', '在本机 Codex 的配置里加两条回调，它每一轮开始、结束、调工具时告诉 Pigeon。会改本机 Codex 的配置，马上生效')}
      <span class="hookrow">${sw(!!H.installed, 'cx-hooks', '接收 Codex 自己的事件', {}, H.busy || H.installed == null)}<small class="${H.err ? 'bad' : 'mut'}" role="status">${H.err || (H.busy ? '读取中…' : H.detail || (H.installed == null ? '' : H.working ? '已收到 Codex 的事件' : '还没收到 Codex 的事件'))}</small></span>
      ${mcpRowHTML('codex', '开启后往 ~/.codex/config.toml 写入 pigeon MCP 服务（保留原有配置），重开 Codex 对话后它能主动读分派规则、向其他 agent 派活')}
      ${lb('中继对话', '往别的电脑发消息，都由这台 Mac 上 Codex 里的一条对话转过去')}<span class="mut">${relay ? html`现在用「${relayTitle(relay)}」。` : '还没设。'}${hasRemote() ? '在下面“设备”里，远程设备卡片右上角的设置按钮里看和换。' : '添加设备时选一条。'}</span>
    </div>`;
  }
  if (a === 'dsh') {
    const mcpCmd = `${st.MCP?.wrapper || '~/.pigeon/pigeon-mcp'} --client deepseek`;
    return html`<div class="cpanel ways">
      ${lb('命令行', '用它自带的命令行在后台跑：新开对话、接着已有对话说，跑完把回复取回来；不用开它的应用')}<span class="mut">${det || '用它自带的命令行在后台跑，不用开它的应用'}</span>
      ${lb('统一 MCP', '可选：把这条命令加进 DeepSeek Harness 的 MCP 设置，它也能读分派规则、向其他 agent 派活')}<span class="cmdcol"><span class="mut">可选：把这条命令加进它的 MCP 设置</span>${cmdBox(mcpCmd)}</span>
    </div>`;
  }
  if (a === 'antigravity') {
    const cli = !!st.AGY_CLI, via = srv(st, ['agents', 'antigravity', 'via'], 'auto'), useCli = via === 'cli' || (via === 'auto' && cli);
    return html`<div class="cpanel ways">
      ${segRow('antigravity', 'via', '命令行或应用', [['auto', '自动'], ['cli', '命令行 agy'], ['app', 'Antigravity 应用']], '自动：装了命令行 agy 就用它。命令行 agy：不用开 Antigravity 应用，在派活的目录里干活，要批准的操作会跳过、不会停下来等；对话默认不显示在 Antigravity 应用里。Antigravity 应用：要它开着，对话在应用里看得到，读工作区外的文件会停下来等你批准', 'auto', useCli ? '现在走命令行' : '现在走应用')}
      ${useCli && !cli ? html`<span></span><small class="bad">没找到 agy（~/.local/bin/agy）。装上它：curl -fsSL https://antigravity.google/cli/install.sh | bash</small>` : ''}
      ${mcpRowHTML('antigravity', '开启后往 ~/.gemini/config/mcp_config.json 写入 pigeon MCP 服务，保留已有配置。重开对话后 Antigravity 也能主动读分派规则、向其他 agent 派活')}
    </div>`;
  }
  if (a === 'cursor') {
    return html`<div class="cpanel ways">
      ${mcpRowHTML('cursor', '开启后往 ~/.cursor/mcp.json 写入 pigeon MCP 服务，保留已有配置。重开 Cursor 对话后它能读分派规则、向其他 agent 派活')}
      ${lb('接收')}<span class="mut">接上 MCP 后 Cursor 能当指挥、往外派活；Pigeon 还不能把活送进 Cursor。</span>
    </div>`;
  }
  return '';
}

/* ---------- 交给它的活怎么跑（卡片右上角的“设置”） ---------- */
const CODEX0 = { preferForImages: true, imageMode: 'builtin', imageModel: 'gpt-image-2', imageQuality: 'medium', imageAspect: 'square', imageTransparent: false, imageDir: 'assets/generated',
  sessionMode: 'keep', openWhen: 'end', routeAll: true, model: '', effort: '', sandbox: 'auto', timeoutMin: 10, maxConcurrent: 2, summaryChars: 300 };
const EFFORT = { none: '不推理', minimal: '极少', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高', ultra: '超高' };
const AG_WIRE = { dsh: 'deepseek', antigravity: 'antigravity' };
// 设置里的几种控件。path 是设置文件里的路径（codex.timeoutMin、agents.deepseek.cwd）
const segOf = (path, label, opts, cur, tip, after = '') => html`${lb(label, tip)}<span><span class="seg" role="group" aria-label="${label}">${opts.map(([v, l]) => html`<button type="button" data-action="srv-set" data-path="${path}" data-v="${v}" aria-pressed="${bool(cur === v)}">${l}</button>`)}</span>${after ? html` <small class="mut">${after}</small>` : ''}</span>`;
const segRow = (a, k, label, opts, tip, def = '', after = '') => segOf(`agents.${AG_WIRE[a]}.${k}`, label, opts, srv(st, ['agents', AG_WIRE[a], k], def), tip, after);
const numOf = (path, label, cur, min, max, unit, tip, after = '') => html`${lb(label, tip)}<span><input class="numin" type="number" min="${min}" max="${max}" step="1" data-action="srv-num" data-path="${path}" data-min="${min}" data-max="${max}" value="${cur}" aria-label="${label}"> ${unit}${after ? html` <small class="mut">${after}</small>` : ''}</span>`;
const textOf = (path, label, cur, def, ph, tip) => html`${lb(label, tip)}<span><input class="txtin" data-action="srv-text" data-path="${path}" data-def="${def}" value="${cur}" placeholder="${ph}" autocomplete="off" spellcheck="false" aria-label="${label}"></span>`;
const pickOf = (path, label, opts, cur, tip) => html`${lb(label, tip)}<span><select class="pick" data-action="srv-pick" data-path="${path}" aria-label="${label}">${opts.map(([v, l]) => html`<option value="${v}" ${String(v) === String(cur) ? raw('selected') : ''}>${l}</option>`)}</select></span>`;
const swOf = (path, label, on, tip) => html`${lb(label, tip)}<span>${sw(on, 'srv-sw', label, { path })}</span>`;

function codexRunHTML() {
  const cx = k => { const v = srv(st, ['codex', k], undefined); if (k === 'sessionMode' && v === undefined && srv(st, ['codex', 'showInCodex'], true) === false) return 'temp'; if (k === 'openWhen' && !v) return srv(st, ['codex', 'autoOpen'], false) ? 'end' : 'never'; return v === undefined ? CODEX0[k] : v; };
  const p = k => `codex.${k}`, api = cx('imageMode') === 'api';
  const m0 = cx('model'), M = (st.CODEXM || []).find(x => x.slug === m0), efforts = M && M.efforts.length ? M.efforts : ['low', 'medium', 'high', 'xhigh', 'max'];
  return html`<div class="cpanel aset">
    <h4>Claude Code 经 pigeon run 交给 Codex 的活</h4>
    ${swOf(p('routeAll'), '都走 Pigeon', cx('routeAll'), 'Claude Code 直接跑 codex exec 或用 Codex 的 MCP 派活时，改走 pigeon run，这样都能看到进度、按这里的设置跑')}
    ${pickOf(p('model'), '模型', [['', 'Codex 默认'], ...(st.CODEXM || []).map(m => [m.slug, m.name])], m0, '只管经 pigeon run 跑的活；在对话里发消息、新开对话用上面设备一行里的默认模型')}
    ${pickOf(p('effort'), '推理档位', [['', 'Codex 默认'], ...efforts.map(e => [e, `${EFFORT[e] || e}（${e}）`])], cx('effort'))}
    ${pickOf(p('sandbox'), '权限', [['auto', '按任务自动'], ['read-only', '只读'], ['workspace-write', '可写工作区']], cx('sandbox'), '按任务自动：审查和其他任务只读，写代码和生图可写工作区')}
    ${segOf(p('sessionMode'), '对话记录', [['keep', '留在 Codex 里'], ['temp', '临时任务']], cx('sessionMode'), '留在 Codex 里：在 Codex 应用里能看到这段对话')}
    ${cx('sessionMode') === 'temp' ? '' : segOf(p('openWhen'), '在 Codex 里打开', [['start', '一开始'], ['end', '做完后'], ['never', '不打开']], cx('openWhen'), 'Codex 应用的对话列表不列 Pigeon 派的活，要靠这里打开。一开始就打开能看着它做，但跑完前只能看、不能接着说')}
    ${numOf(p('timeoutMin'), '超时', cx('timeoutMin'), 1, 120, '分钟')}
    ${numOf(p('maxConcurrent'), '同时最多', cx('maxConcurrent'), 1, 8, '件')}
    ${numOf(p('summaryChars'), '结果摘要最长', cx('summaryChars'), 60, 2000, '字')}
    <h4>生图</h4>
    ${lb('生图交给谁')}<span class="mut">在分派规则里设（“生图、改图”那条）<button class="ghost sm" type="button" data-action="nav" data-v="route">去分派规则</button></span>
    ${segOf(p('imageMode'), '生图方式', [['builtin', '内置'], ['api', 'API']], cx('imageMode'), '内置不需要 key；API 方式要 OPENAI_API_KEY，才能选模型和质量')}
    ${api ? textOf(p('imageModel'), '图片模型', cx('imageModel'), CODEX0.imageModel, CODEX0.imageModel) : ''}
    ${api ? segOf(p('imageQuality'), '图片质量', [['low', '低'], ['medium', '中'], ['high', '高']], cx('imageQuality')) : ''}
    ${segOf(p('imageAspect'), '画幅', [['square', '方形'], ['landscape', '横版'], ['portrait', '竖版']], cx('imageAspect'))}
    ${swOf(p('imageTransparent'), '透明背景', cx('imageTransparent'))}
    ${textOf(p('imageDir'), '存到项目里的', cx('imageDir'), CODEX0.imageDir, CODEX0.imageDir, '相对项目根目录')}
  </div>`;
}
function agRunHTML(a) {
  const w = AG_WIRE[a], v = (k, def) => srv(st, ['agents', w, k], def), path = k => `agents.${w}.${k}`;
  const timeout = numOf(path('timeoutMin'), '超时', v('timeoutMin', 0), 0, 240, '分钟', '到点还没做完就把它停掉、记成没回音。它是 Pigeon 起的进程，停掉活也就停了，所以默认 0 不限', '0 是不限，等它做完');
  const cwd = (tip) => textOf(path('cwd'), '在 Pigeon 里派活时的目录', v('cwd', ''), '', '不填就是你的主目录', tip);
  if (a === 'dsh') return html`<div class="cpanel aset">
    <h4>交给 DeepSeek Harness 的活</h4>
    ${segRow('dsh', 'sandbox', '权限', [['', '它自己的默认'], ['read-only', '只读'], ['workspace-write', '能改工作目录']], '没在命令里写 --sandbox 时用这个。只读适合复审；它自己的默认是能改工作目录')}
    ${cwd('在刘海或频道里派给它、没说目录时，它在这个目录里干活。Claude Code 派的活用 Claude Code 当前的目录')}
    ${timeout}
    <span></span><small class="mut">它用自己配的模型；上面设备一行里的默认模型只在 Pigeon 能指定时才用上。</small>
  </div>`;
  const cli = !!st.AGY_CLI, via = v('via', 'auto'), useCli = via === 'cli' || (via === 'auto' && cli);
  return html`<div class="cpanel aset">
    <h4>交给 Antigravity 的活</h4>
    ${useCli ? segRow('antigravity', 'mode', '命令行里能做什么', [['', '它自己的默认'], ['accept-edits', '能直接改文件'], ['plan', '只出方案']], '经命令行跑时传给 agy 的 --mode。要批准的操作在命令行里一律跳过，回信末尾会写跳过了哪些') : ''}
    ${useCli ? cwd('经命令行跑时它在这个目录里干活、能读这里的文件。Claude Code 派的活用 Claude Code 当前的目录') : ''}
    ${timeout}
    ${useCli ? '' : html`${lb('读文件要批准')}<span class="mut">经应用新开的对话不绑目录，读工作区外的文件会停下来问你，Pigeon 的任务上会写“在等你批准”。在 Antigravity 的询问里选 “Yes, and always allow” 以后就不再问，这是 Antigravity 自己的设置，Pigeon 不替你选。</span>`}
  </div>`;
}
// 有没有“设置”：本机接上了的 Codex、DeepSeek Harness、Antigravity
const runHTML = a => (a === 'codex' ? codexRunHTML() : a === 'dsh' || a === 'antigravity' ? agRunHTML(a) : '');
const hasRun = (a, c) => !!c && !c.na && ['codex', 'dsh', 'antigravity'].includes(a);

/* ---------- 接入 agent ---------- */
// 一台设备上的这个 agent：设备、接法、默认模型、能发能收、订阅、开关
function devRowHTML(d, c) {
  const k = `${d}:${c.a}`, D = st.DEV[d], home = d === st.home;
  const mdl = c.inn === 'nope' ? '' : html`<button type="button" class="mdlbtn" data-action="model-panel" data-dev="${d}" data-a="${c.a}" aria-expanded="${bool(ui.conn.mp === k)}">${c.model ? modelTag({ m: c.model, t: c.think }, `默认用 ${c.model}${TH[c.think] ? ' · 思考' + TH[c.think][0] : ''} · 点一下改`) : html`<span class="mdl" data-tip="没指定，用它自己配的 · 点一下改"><span>默认模型</span></span>`}</button>`;
  const isLead = leadKey(st) === `${c.a}@${d}`;
  return html`<div class="arow drow ${c.role || ''} ${c.on ? '' : 'off'} ${c.na ? 'na' : ''}">
    <span class="g dev">${devIc(st, d)}</span><b data-tip="${home ? '这台 Mac' : `${D.host} · ${LINK[D.link].label}`}">${shortDev(st, d, true)}</b>
    <span class="chips">${c.role === 'gate' ? html`<i class="flag gate" data-tip="入口：那台电脑上的别的 agent 经它带起">${icon('door')}</i>` : ''}${isLead ? html`<span class="chip2 lead" data-tip="现在的指挥">指挥</span>` : ''}${c.na
      ? html`<span class="chip2 na" data-tip="检测到装了 ${AG[c.a].name}，Pigeon 还没接上它：不能给它派活，也不能当指挥">还没接上</span>`
      : html`${mdl}${c.how.map(howChip)}`}</span>
    <span class="caps">${cap('out', c.out)}${cap('in', c.inn)}</span>
    ${st.SUB[`${c.a}@${d}`] ? quotaDisc(st, c.a, d) : html`<i class="quota none" data-tip="${live() ? '没有额度读数' : '按量付费，没有订阅额度'}"></i>`}
    ${c.na ? html`<button class="sw" type="button" role="switch" aria-checked="false" disabled aria-label="${AG[c.a].name} 还没接上"></button>` : sw(c.on, 'conn-on', `${D.name} 上的 ${AG[c.a].name}`, { dev: d, a: c.a })}</div>
    ${ui.conn.mp === k ? mpanelHTML(c) : ''}`;
}
function agentCardHTML(a) {
  const rows = Object.keys(st.DEV).map(d => [d, (st.CONN[d] || []).find(c => c.a === a)]).filter(([, c]) => c);
  const home = (rows.find(([d]) => d === st.home) || [])[1], open = ui.conn.ap === a, run = hasRun(a, home);
  const na = rows.every(([, c]) => c.na), off = !na && rows.every(([, c]) => !c.on || c.na);
  return html`<section class="acard ${na ? 'na' : ''}" id="ag-${a}">
    <header><span class="g lg">${brand(a)}</span><h3>${AG[a].name}</h3>${na ? html`<span class="chip2 na">还没接上</span>` : off ? html`<span class="chip2 offc" data-tip="在下面每台设备的开关里打开">都关着</span>` : ''}${home ? '' : html`<span class="chip2" data-tip="这台 Mac 上没检测到它，只在别的电脑上">只在别的电脑上</span>`}<span class="sp"></span>
      ${run ? html`<button type="button" class="chip2 cxbtn" data-action="ag-panel" data-a="${a}" aria-expanded="${bool(open)}" data-tip="交给 ${AG[a].name} 的活怎么跑：模型、权限、超时……">${icon('gear')}<span>设置</span></button>` : ''}</header>
    ${home ? waysHTML(a, home) : ''}
    <div class="arows">${rows.map(([d, c]) => devRowHTML(d, c))}</div>
    ${run && open ? runHTML(a) : ''}
  </section>`;
}
function leadHTML() {
  const lk = leadKey(st), opts = leadOptions(st);
  return html`<div class="panel leadrow"><label class="leadpick"><b>指挥</b><select class="pick" data-action="set-lead" aria-label="指挥">${opts.map(k => html`<option value="${k}" ${k === lk ? raw('selected') : ''}>${AG[agOf(k)].name} · ${shortDev(st, dvOf(k))}</option>`)}${lk !== 'you' && !opts.includes(lk) ? html`<option value="${lk}" selected>${nameOf(st, lk)}（现在不能发出）</option>` : ''}<option value="you" ${lk === 'you' ? raw('selected') : ''}>你自己</option></select></label>
    <small class="mut">同一时间只有一个指挥：它读分派规则、负责拆活。能发出的 agent 才能当；也可以是你自己，在刘海或频道里派活。</small></div>`;
}
function agentsHTML() {
  const here = AGENTS.filter(a => Object.keys(st.DEV).some(d => (st.CONN[d] || []).some(c => c.a === a))), missing = AGENTS.filter(a => !here.includes(a));
  const plan = !live() && ui.conn.plan ? html`<div class="panel plan"><div class="files mono">${st.PLAN.map(([f, w]) => html`<span data-tip="${w}，其他内容原样保留，可以单独撤回"><code>${f}</code></span>`)}</div>
    <div class="acts"><button class="ghost" type="button" data-action="plan">先不改</button><button class="btn" type="button" data-action="apply">改这 ${st.PLAN.length} 处</button></div></div>` : '';
  return html`<div data-part="agents"><div class="sechead"><h2 id="sec-ag">接入 agent</h2><span class="sp"></span>${live() ? '' : html`<button class="ghost sm" type="button" data-action="plan" aria-expanded="${bool(ui.conn.plan)}" data-tip="一键接入本机全部：先列出会改哪几个文件">${icon('wand')}一键接入本机</button>`}</div>
    ${plan}${leadHTML()}
    <div class="acards">${here.map(agentCardHTML)}</div>
    ${missing.length ? html`<p class="note">${live() ? '这台 Mac 上没检测到' : '还没接'}：${missing.map(a => AG[a].name).join('、')}。${live() ? '装上后会自己出现在这里。' : ''}</p>` : ''}</div>`;
}

/* ---------- 远程设备的设置：经哪条中继对话转发、它多大、用过的几条 ---------- */
// 中继对话的候选：用过的（没归档、本机还在）加上本机 Codex 最近的对话
function relayChoices() {
  const R = st.RELAY || {}, out = new Map();
  for (const r of R.relays || []) if (!r.archived && !r.missing) out.set(r.id, r.title || r.id.slice(0, 8));
  for (const s of st.S) if (s.agent === 'codex' && s.dev === st.home && !s.stub && !out.has(s.id)) out.set(s.id, s.title);
  return [...out];
}
const kTok = n => (n == null ? '读不到' : fmtTokens(n));
const effortZh = e => (e ? `思考${(TH[e] || [e])[0]}` : '');
// 正在用的那条：模型、思考强度、上一轮读了多少；太大了提醒换
function relayNow(r, warnAt) {
  const big = r.context != null && r.context > warnAt;
  return html`<span class="lb">现在用的</span><span class="rnow"><b>${r.title || r.id.slice(0, 8)}</b><span class="mono mut">${[r.model || '模型没记下', effortZh(r.effort)].filter(Boolean).join(' · ')}</span><span class="${big ? 'bad' : 'mut'}" data-tip="每转发一次，模型都要把这条对话的上下文整个读一遍">${r.context == null ? '还没读到它的大小（可能还没转发过）' : `上一轮读了 ${kTok(r.context)} token${r.window ? `（窗口 ${kTok(r.window)}）` : ''}`}</span><button class="ghost sm" type="button" data-action="relay-open" data-id="${r.id}">${icon('jump')}在 Codex 里打开</button></span>
    <span></span>${big ? html`<p class="rwarn">这条对话太长了，每转发一次都很费 token。建议换一条：在 Codex 里新建一条对话，选个便宜的模型、把思考强度调低，随便发一句“中转用”，再回这里选它。</p>`
      : html`<small class="mut">模型和思考强度只能在 Codex 里改：打开这条对话，在输入框下面换。Pigeon 自己新建的对话拿不到往别的电脑发消息的工具，所以中继对话要在 Codex 里建。</small>`}`;
}
function relayOld(r) {
  const used = r.shared || (r.hosts || []).length, del = ui.conn.rdel === r.id;
  const acts = used ? html`<span class="mut">在用</span>` : r.missing ? html`<span class="mut">本机没找到</span>`
    : html`${r.archived ? '' : html`<button class="ghost sm" type="button" data-action="relay-use" data-id="${r.id}" data-host="${ui.conn.dp}">用在这台</button>`}
      <button class="ghost sm" type="button" data-action="relay-arch" data-id="${r.id}" data-v="${r.archived ? 'unarchive' : 'archive'}" data-tip="${r.archived ? '在 Codex 里恢复这条对话' : '在 Codex 里归档，能恢复'}">${r.archived ? '恢复' : '归档'}</button>
      ${del ? html`<button class="btn danger sm" type="button" data-action="relay-del-ok" data-id="${r.id}">确认删除</button><button class="ghost sm" type="button" data-action="relay-del" data-id="">取消</button>`
        : html`<button class="ghost sm" type="button" data-action="relay-del" data-id="${r.id}" data-tip="从 Codex 里永久删除这条对话，找不回来">删除</button>`}`;
  return html`<div class="rrow ${r.archived ? 'arch' : ''}"><b>${r.title || r.id.slice(0, 8)}</b><small class="mono mut">${[r.model, effortZh(r.effort), r.context != null ? `上一轮 ${kTok(r.context)}` : ''].filter(Boolean).join(' · ')}</small>${r.archived ? html`<small class="mut">已归档</small>` : ''}<span class="sp"></span><span class="racts">${acts}</span></div>
    ${del ? html`<p class="rwarn">删除后这条对话和它的记录都没了，找不回来。只想腾地方的话，归档就行。</p>` : ''}`;
}
function devPanelHTML(d) {
  const R = st.RELAY;
  if (!R || (R.busy && !R.relays)) return html`<div class="cpanel devpanel"><small class="mut" role="status">读取中…</small></div>`;
  if (R.err && !R.relays) return html`<div class="cpanel devpanel"><small class="bad" role="status">${R.err}</small></div>`;
  const by = R.byHost || {}, own = by[d] || '', cur = own || R.shared || '', row = (R.relays || []).find(r => r.id === cur), warnAt = R.warnAt || 150000;
  const ch = relayChoices(), opt = (v, l, sel) => html`<option value="${v}" ${v === sel ? raw('selected') : ''}>${l}</option>`;
  const withCur = (id) => (id && !ch.some(([v]) => v === id) ? [[id, relayTitle(id)]] : []);
  const old = (R.relays || []).filter(r => r.id !== cur);
  return html`<div class="cpanel devpanel" aria-busy="${bool(!!R.busy)}">
    <h4 data-tip="往别的电脑发消息，都由这台 Mac 上 Codex 里的一条对话转过去，每转发一次跑一轮模型">中继对话 <button class="ghost sm" type="button" data-action="refresh-local">${icon('undo')}刷新本机对话</button></h4>
    <span class="lb" data-tip="这台单独用一条，它的上下文就不会和别的电脑挤在一起">往这台发经过</span><span><select class="pick" data-action="relay-pick" data-host="${d}" aria-label="往 ${st.DEV[d].name} 发经过哪条中继对话">${opt('', `跟共用的${R.shared ? `（${relayTitle(R.shared)}）` : '（还没设）'}`, own)}${[...ch, ...withCur(own)].map(([v, l]) => opt(v, l, own))}</select></span>
    <span class="lb" data-tip="所有远程设备默认都经过这条；单独指定了的除外">共用的</span><span><select class="pick" data-action="relay-pick" data-host="" aria-label="共用的中继对话">${opt('', '没设置', R.shared || '')}${[...ch, ...withCur(R.shared)].map(([v, l]) => opt(v, l, R.shared || ''))}</select></span>
    ${row ? relayNow(row, warnAt) : html`<span></span><small class="mut">${cur ? '这条对话在本机没找到，换一条吧' : '还没设中继对话：在 Codex 里新建一条对话，随便发一句“中转用”，再在上面选它'}</small>`}
    ${old.length ? html`<h4>用过的 · ${old.length}</h4><div class="rlist">${old.map(relayOld)}</div>` : ''}
    ${R.err ? html`<small class="bad" role="status">${R.err}</small>` : ''}
  </div>`;
}

/* ---------- 设备 ---------- */
function devCardHTML(d) {
  const D = st.DEV[d], L = LINK[D.link], home = d === st.home, list = st.CONN[d] || [];
  const retry = live() ? html`<button class="ghost sm" type="button" data-action="reconnect" data-dev="${d}" data-tip="经中继对话重新读一次远程电脑，要花一些 token">重新读一次</button>` : html`<button class="ghost sm" type="button" data-action="reconnect" data-dev="${d}">重试</button>`;
  const agChip = c => html`<button type="button" class="agchip ${c.on && !c.na ? '' : 'off'}" data-action="ag-jump" data-a="${c.a}" data-tip="${c.na ? '还没接上' : c.on ? `${c.role === 'gate' ? '入口 · ' : c.role === 'via' ? '经 Codex 带起 · ' : ''}在上面“接入 agent”里看` : '关着'}">${brand(c.a)}<span>${AG[c.a].name}</span>${c.role === 'gate' ? html`<i class="flag gate">${icon('door')}</i>` : ''}</button>`;
  return html`<section class="dcard ${ui.conn.fresh === d ? 'fresh' : ''}">
    <header><span class="g dev lg">${devIc(st, d)}</span><h2 class="dname" data-action="rename" data-dev="${d}" data-tip="${named(st, d) ? `电脑名 ${D.host} · ` : ''}点一下改名"><span>${D.name}</span>${icon('pen')}</h2>
      <span class="chip2 link" data-tip="${L.label}：${L.tip}">${icOf(L)}<span>${L.label}</span></span>${isPaused(st, d) ? html`<span class="chip2 pz">${icon('pause')}<span>已暂停</span></span>` : ''}${online(st, d) ? '' : html`<span class="chip2 off" role="status">${icon('x')}<span>连不上</span></span>${retry}`}<span class="sp"></span>
      ${home ? '' : html`<button class="ghost icon ${ui.conn.dp === d ? 'on' : ''}" type="button" data-action="dev-panel" data-dev="${d}" aria-expanded="${bool(ui.conn.dp === d)}" data-tip="这台的设置：经哪条中继对话转发、它有多大">${icon('gear')}</button>`}
      <button class="ghost icon ${st.paused.dev[d] ? 'on' : ''}" type="button" data-action="pause-dev" data-dev="${d}" data-tip="${st.paused.dev[d] ? '继续往这台送消息' : '暂停这台：不再往这台送消息，在路上的停在原地'}">${icon(st.paused.dev[d] ? 'play' : 'pause')}</button>
      ${home ? '' : html`<button class="ghost icon" type="button" data-action="rm-dev" data-dev="${d}" data-tip="${live() ? '从界面上移除这台设备' : '移除这台设备'}">${icon('more')}</button>`}</header>
    ${!home && ui.conn.dp === d ? devPanelHTML(d) : ''}
    <div class="dags">${list.length ? list.map(agChip) : html`<p class="note">${live() ? '这台没检测到能接的应用' : '还没接 agent'}</p>`}</div></section>`;
}
// 应用模式下移除过的设备列在下面，能恢复
const hiddenHTML = () => (st.HIDDEN || []).length ? html`<div class="panel hiddendev"><span class="mut">从界面上移除了</span>${st.HIDDEN.map(h => html`<span class="hd"><b>${h.name}</b><button class="ghost sm" type="button" data-action="restore-dev" data-dev="${h.id}">${icon('undo')}恢复</button></span>`)}</div>` : '';
const devsHTML = () => html`<div data-part="devs"><div class="sechead"><h2 id="sec-dev">设备</h2><span class="sp"></span><button class="btn sm" type="button" data-action="adddev">${icon('plus')}添加设备</button></div>
  <div class="dcards">${Object.keys(st.DEV).map(devCardHTML)}${Object.keys(st.DEV).length === 1 ? html`<section class="dcard ghostcard"><p>还没有别的设备。加一台，就能把活派到那台电脑上的 agent。</p><button class="btn" type="button" data-action="adddev">${icon('plus')}添加设备</button></section>` : ''}</div>${live() ? hiddenHTML() : ''}</div>`;

/* ---------- 页头：跳到哪一节、magpie 连没连上、图例 ---------- */
function headHTML() {
  const M = st.MPQ, bird = icon('bird');
  const groups = st.MAGPIE.on ? `；默认模型里能选它的 ${st.MAGPIE.groups.length} 个路由组` : '';
  const chip = M.state === 'live' ? html`<span class="chip2 mgc" data-tip="本机 magpie ${M.ver}：本机几家的订阅额度是从它读的（${M.cards} 张，${M.at} 读的）${live() ? groups : '；路由组还是示例'}">${bird}<span>magpie 已连上</span></span>`
    : M.state === 'off' ? html`<span class="chip2 mgc off" data-tip="${live() ? '连不上本机 magpie，读不到额度和路由组。打开 magpie 后一分钟内会自己连上' : '连不上本机 magpie，额度和路由组都是示例。打开 magpie 后一分钟内会自己连上'}">${bird}<span>magpie 没开</span></span>`
    : M.state === 'demo' && st.MAGPIE.on ? html`<span class="chip2 mgc" data-tip="示例：默认模型里能直接选 magpie 的 ${st.MAGPIE.groups.length} 个路由组。用 tools/serve.py 打开，额度会换成本机 magpie 的真数据">${bird}<span>magpie 已连上</span></span>` : '';
  const jump = (id, l) => html`<button type="button" data-action="conn-jump" data-v="${id}">${l}</button>`;
  return html`<div class="head" data-part="head"><h1>接入</h1><span class="seg cjump" role="group" aria-label="跳到">${jump('sec-ag', 'agent')}${jump('sec-dev', '设备')}${jump('sec-rules', '规矩')}${jump('sec-use', '用量')}</span><span class="sp"></span>${chip}
    <span class="legend">${['yes', 'part', 'nope'].map(k => html`<i class="cap ${k}" role="img" aria-label="图例：${CAP.legend[k]}" data-tip="${CAP.legend[k]}">${icon('out')}</i>`)}</span></div>`;
}
const rules2HTML = () => {
  const list = live() ? st.RULES2.filter(r => r.id !== 'split') : st.RULES2;
  return html`<div class="panel rules2" data-part="rules2">${list.map(r => html`<div class="trow"><span data-tip="${r.tip}">${r.t}</span>${r.kind === 'sw'
    ? html`<button class="sw" type="button" role="switch" aria-checked="${bool(r.on)}" data-action="rule2" data-id="${r.id}" aria-label="${r.t}"></button>`
    : r.kind === 'pick' ? html`<span class="pickunit"><select class="pick" data-action="rule2-pick" data-id="${r.id}" aria-label="${r.t}">${r.opts.map(v => html`<option value="${v}" ${v === r.v ? raw('selected') : ''}>${v}</option>`)}</select>${r.unit ? html` <span class="mut">${r.unit}</span>` : ''}</span>`
    : html`<span class="lock" data-tip="不能关">${icon('check')}</span>`}</div>`)}</div>`;
};

/* ---------- 全新安装检查清单（仅应用模式） ---------- */
const setupAllOk = () => {
  const S0 = st.SETUP, H = st.HOOKS || {}, cx = (st.CONN[st.home] || []).find(c => c.a === 'codex');
  const sessN = Math.max(Number(S0?.localSessions) || 0, st.S.filter(s => s.dev === st.home && !s.relay && !s.stub).length);
  return { sessN, ok: !!S0?.node?.ok && !!S0?.node?.zstd && !!S0?.claudePlugin?.hookReceived && (!cx || !!H.installed) && sessN > 0 };
};
function setupHTML() {
  if (!live() || !st.SETUP) return html`<div data-part="setup" hidden></div>`;
  const S0 = st.SETUP, H = st.HOOKS || {}, cx = (st.CONN[st.home] || []).find(c => c.a === 'codex');
  const nodeOk = !!S0.node?.ok, zstdOk = !!S0.node?.zstd;
  const claudeOk = !!S0.claudePlugin?.hookReceived, claudeInst = !!S0.claudePlugin?.installed;
  const codexOk = !cx || !!H.installed;
  const { sessN, ok: allOk } = setupAllOk();
  const folded = setupFold === null ? allOk : setupFold;
  if (folded) {
    return html`<div data-part="setup"><div class="panel setup-bar ${allOk ? 'ok' : ''}">
      <span class="sdot ${allOk ? 'ok' : 'warn'}"></span>
      <span>${allOk ? `连接环境已就绪（Node ${S0.node?.version || ''} · Claude 插件已连通 · ${sessN} 个本机对话）` : '首次连接检查已收起'}</span>
      <span class="sp"></span><button class="ghost sm" type="button" data-action="setup-toggle">${allOk ? '检查详情' : '展开'}</button></div></div>`;
  }
  const cmd1 = S0.marketplacePath ? `/plugin marketplace add ${S0.marketplacePath}` : '';
  const cmd2 = '/plugin install pigeon@pigeon';
  const mcpClients = ['codex', 'antigravity', 'cursor'].filter(a => (st.CONN[st.home] || []).some(c => c.a === a));
  const mcpInstalledN = mcpClients.filter(a => !!st.MCP?.clients?.[a]?.installed).length;
  const mcpPending = mcpClients.filter(a => !st.MCP?.clients?.[a]?.installed);
  const lk = leadKey(st), opts = leadOptions(st);
  const leadPick = html`<select class="pick" data-action="set-lead" aria-label="默认指挥">${opts.map(k => html`<option value="${k}" ${k === lk ? raw('selected') : ''}>${AG[agOf(k)].name} · ${shortDev(st, dvOf(k))}</option>`)}${lk !== 'you' && !opts.includes(lk) ? html`<option value="${lk}" selected>${nameOf(st, lk)}（现在不能发出）</option>` : ''}<option value="you" ${lk === 'you' ? raw('selected') : ''}>你自己</option></select>`;
  const row = (kind, title, desc, act = '') => html`<div class="setup-row"><span class="sdot ${kind}"></span><div class="smeta"><b>${title}</b><small class="mut">${desc}</small></div><span class="sp"></span>${act}</div>`;
  return html`<div data-part="setup"><section class="panel setup-card">
    <header><div><b>连接检查清单</b><small class="mut">装好后按这几步接上各家 agent，就能在对话时自然协作</small></div><span class="sp"></span><button class="ghost sm" type="button" data-action="setup-toggle">收起</button></header>
    ${row(nodeOk ? (zstdOk ? 'ok' : 'warn') : 'err', 'Node.js 运行时',
      !nodeOk ? '没找到 node：派活、扫描对话与模型需要安装 Node.js（建议 22.15+）'
        : zstdOk ? `${S0.node.version} · ${S0.node.path}`
        : `${S0.node.version} · ${S0.node.path}（低于 v22.15，读取 DeepSeek Harness 对话需要 v22.15+）`)}
    ${row(claudeOk ? 'ok' : claudeInst ? 'warn' : 'err', 'Claude Code 插件',
      claudeOk ? '已收到 hook 事件，正在实时同步对话与子代理状态'
        : claudeInst ? '已检测到插件，在 Claude Code 里新开一个对话并说一句话即可连通'
        : '在 Claude Code 里依次运行下面两条命令安装插件，然后新开一个会话：',
      !claudeOk && !claudeInst && cmd1 ? html`<div class="cmdlist">${cmdBox(cmd1)}${cmdBox(cmd2)}</div>` : '')}
    ${cx ? row(codexOk ? 'ok' : 'warn', 'Codex 事件回调',
      H.installed ? (H.working ? '已生效，正在接收 Codex 对话事件' : '已安装：下次打开 Codex 选“全部信任”一次即可') : '开启后，你在 Codex 里的聊天与审批也会同步到指挥台和刘海',
      H.installed ? '' : html`<button class="btn sm" type="button" data-action="setup-cx-hooks" ${H.busy ? raw('disabled') : ''}>一键开启</button>`) : ''}
    ${mcpClients.length ? row(mcpInstalledN > 0 ? 'ok' : 'warn', '多 Agent MCP 互联（可选）',
      mcpInstalledN === mcpClients.length
        ? `已接入全部 ${mcpInstalledN} 个支持的应用，在里面聊天时都能读分派规则并互相派活`
        : `已接入 ${mcpInstalledN}/${mcpClients.length}：开启后，在 Codex / Antigravity / Cursor 里对话时也能直接派活与读回信`,
      mcpPending.length ? html`<div class="mcp-acts">${mcpPending.map(a => html`<button class="ghost sm" type="button" data-action="mcp-toggle" data-client="${a}">接入 ${AG[a].name}</button>`)}</div>` : '') : ''}
    ${row('ok', '默认指挥',
      '决定由哪个 agent 读取分派规则并负责拆活；也可以选「你自己」直接在刘海或频道派活',
      leadPick)}
    ${row(sessN > 0 ? 'ok' : 'warn', '本机已有对话',
      sessN > 0 ? `已扫描到 ${sessN} 个本机对话（Codex / DSH / Antigravity）` : '还没扫描到本机对话；在各工具里新建过对话后点右侧刷新',
      html`<button class="ghost sm" type="button" data-action="refresh-local">${icon('undo')}刷新本机对话</button>`)}
  </section></div>`;
}

/* ---------- 用量：各 agent、各家用了多少、占多少（数据来自应用读的本机对话记录） ---------- */
const UMETRICS = [['input', '输入'], ['output', '输出'], ['cacheRead', '缓存读'], ['cacheWrite', '缓存写']];
function usageHTML() {
  const U = st.USAGE, per = ui.conn.up || 'week', met = ui.conn.um || 'all', R = usageShare(U, per, met);
  const seg = (k, map, cur) => html`<span class="seg" role="group" aria-label="${k === 'up' ? '时间' : '口径'}">${Object.entries(map).map(([v, l]) => html`<button type="button" data-action="use-set" data-k="${k}" data-v="${v}" aria-pressed="${bool(cur === v)}">${l}</button>`)}</span>`;
  const src = live()
    ? html`数据来自这台 Mac 上 Claude Code 和 Codex 自己写的对话记录：应用边读边按天累计每条回复的 token，存在 <code>~/Library/Application Support/Pigeon/usage.json</code>，只算这台 Mac。DeepSeek Harness、Antigravity、Cursor 的用量还读不到。按哪家分，看的是每个 agent 最近用的模型，换过模型的也算在一起。`
    : html`示例数字。应用里的数据来自这台 Mac 上 Claude Code 和 Codex 自己写的对话记录，只算这台 Mac；DeepSeek Harness、Antigravity、Cursor 的用量还读不到。`;
  const head = html`<div class="sechead"><h2 id="sec-use">用量</h2><span class="sp"></span>${seg('up', PERIOD, per)}${seg('um', METRIC, met)}</div>`;
  let body;
  if (!R) body = html`<p class="uempty">还没读到用量。应用读到 Claude Code 或 Codex 的对话记录后，这里会列出各 agent、各家用了多少。</p>`;
  else if (!R.total) body = html`<p class="uempty">${PERIOD[per]}还没有用量${per === 'today' ? html`，<button class="ghost sm" type="button" data-action="use-set" data-k="up" data-v="week">看近 7 天</button>` : '。'}</p>`;
  else {
    const color = r => (FAM[r.fam] || FAM.other).c;
    const tip = r => [`${r.name}${r.model ? ` · 最近用 ${r.model}` : ''}`, ...UMETRICS.map(([k, l]) => `${l} ${Number(r.t[k] || 0).toLocaleString('zh-CN')}`), r.t.messages != null ? `${Number(r.t.messages).toLocaleString('zh-CN')} 条回复` : ''].filter(Boolean).join(' · ');
    body = html`<div class="ufams">${R.fams.map(f => html`<span class="ufam"><i style="--c:${(FAM[f.fam] || FAM.other).c}"></i><b>${f.name}</b><span class="num">${f.pct}%</span><small class="mut num">${fmtTokens(f.n)}</small></span>`)}<span class="sp"></span><small class="mut">共 <span class="num">${fmtTokens(R.total)}</span> token</small></div>
      <div class="ubar" role="img" aria-label="${R.fams.map(f => `${f.name} ${f.pct}%`).join('，')}">${R.rows.map(r => html`<i class="${r.k === 'subagent' ? 'sub' : ''}" style="flex-grow:${r.n};--c:${color(r)}" data-tip="${r.name} ${r.pct}%"></i>`)}</div>
      <div class="urows">${R.rows.map(r => html`<div class="urow" data-tip="${tip(r)}"><span class="g">${r.a ? brand(r.a) : ''}</span><span class="uname"><b>${r.name}</b><small class="mono mut">${r.model || '模型没记下'}</small></span>
        <span class="utrack"><i class="${r.k === 'subagent' ? 'sub' : ''}" style="width:${Math.max(1, (r.n / R.rows[0].n) * 100)}%;--c:${color(r)}"></i></span><span class="num utok">${fmtTokens(r.n)}</span><span class="num upct">${r.pct}%</span></div>`)}</div>`;
  }
  return html`<div data-part="usage">${head}<div class="panel ushare">${body}<p class="usrc">${src}</p></div></div>`;
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
        ? html`指挥（${nameOf(st, leadKey(st))}）在这台上，先在“接入 agent”最上面把指挥换成别的，再移除。`
        : live() ? html`只是不在 Pigeon 里显示：它的 <b>${imp.sessions}</b> 个对话、<b>${imp.tasks}</b> 件任务跟着不显示，等你处理的一队里往这台的 <b>${imp.queue}</b> 件也不显示，到点就不发。不影响那台电脑，在“添加设备”里能恢复。`
        : html`会一起去掉它的 <b>${imp.sessions}</b> 个对话、<b>${imp.tasks}</b> 件任务，等你处理的一队里 <b>${imp.queue}</b> 件。演示里移除了就找不回来。`}</p></div>
      <div class="sheet-foot"><span class="sp"></span>${imp.isLead
        ? html`<button class="btn" type="button" data-action="rm-cancel" data-focus="rm-ok">知道了</button>`
        : html`<button class="ghost" type="button" data-action="rm-cancel">取消</button><button class="btn danger" type="button" data-action="rm-dev-ok" data-dev="${d}" data-focus="rm-ok">移除</button>`}</div>
    </div></div>`;
}

/* ---------- 添加设备：先选怎么连，再选哪台 ---------- */
// 每种连法一句说明；应用里还没做的两种置灰，写清楚为什么
const LINK_DESC = { codex: '那台登录同一个 Codex 账号，经这台 Codex 里的中继对话转过去，不用装别的', ssh: '填 user@host，经 SSH 在那台启动 agent', magpie: '两台都装 magpie，经它的 MCP 路由交给那台的 Pigeon 小助手' };
const LIVE_NO = { ssh: '还没做：应用里还不能经 SSH 连别的电脑', magpie: '还没做：应用里还不能经 magpie 连别的电脑' };
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
    <h3>中继对话 <button class="ghost sm" type="button" data-action="refresh-local">${icon('undo')}刷新本机对话</button></h3>
    <select class="pick" data-action="relay-pick" data-host="" aria-label="中继对话"><option value="" ${relay ? '' : raw('selected')}>没设置</option>${relayChoices().concat(relay && !relayChoices().some(([v]) => v === relay) ? [[relay, relayTitle(relay)]] : []).map(([v, l]) => html`<option value="${v}" ${v === relay ? raw('selected') : ''}>${l}</option>`)}</select>
    ${relay ? '' : html`<p class="snote">${icon('x')}<span>还没设中继对话：在 Codex 里新建一条对话，随便发一句“中转用”，再在上面选它。</span></p>`}
    <h3>现在知道的远程电脑</h3>
    <div class="found">${known.map(d => html`<span class="fd on" data-tip="${st.DEV[d].host}">${devIc(st, d)}<span>${st.DEV[d].name}</span></span>`)}${(st.HIDDEN || []).map(h => html`<button type="button" class="fd" data-action="restore-dev" data-dev="${h.id}" data-tip="从界面上移除了，点一下恢复">${icon('undo')}<span>${h.name}</span></button>`)}${known.length || (st.HIDDEN || []).length ? '' : html`<span class="mut">还没有</span>`}</div>`;
}
function sheetHTML() {
  const sh = ui.conn.sheet;
  if (!sh) return html`<div data-part="sheet" hidden></div>`;
  const codex = sh.link === 'codex', viaMp = sh.link === 'magpie', mpOff = st.MPQ.state === 'off';
  const opts = ['codex', 'ssh', 'magpie'].map(k => { const no = live() ? LIVE_NO[k] || '' : k === 'magpie' && mpOff ? '本机 magpie 没开，打开后才能选' : '';
    const demoOnly = !live() && k !== 'codex';
    return html`<button type="button" class="opt ${sh.link === k && !no ? 'on' : ''}" data-action="sheet-link" data-link="${k}" ${no ? raw('disabled') : ''} aria-describedby="opt-${k}">
      <span class="opt-ic">${icOf(LINK[k])}</span><b>${LINK[k].label}</b>${no ? html`<em>${live() ? '还没做' : '没开'}</em>` : demoOnly ? html`<em data-tip="演示里能走一遍，应用里还没做">示例</em>` : ''}
      <small id="opt-${k}" class="${no ? 'optno' : 'mut'}">${no || LINK_DESC[k]}</small></button>`; });
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
  const step = sh.step;
  return html`<div data-part="sheet"><div class="scrim" data-action="closesheet"></div>
    <div class="sheet" role="dialog" aria-label="添加设备">
      <div class="sheet-head"><h2>添加设备</h2><span class="dots"><i class="${step === 1 ? 'on' : ''}"></i><i class="${step === 2 ? 'on' : ''}"></i></span><span class="sp"></span><button class="x" type="button" data-action="closesheet" aria-label="关闭">×</button></div>
      <div class="sheet-body step-${step}">
        ${step === 1 ? html`<h3>怎么连</h3><div class="opts">${opts}</div>` : step2}
      </div>
      <div class="sheet-foot">${step === 2 ? html`<button class="ghost" type="button" data-action="sheetback">上一步</button>` : ''}<span class="sp"></span>
        <button class="btn" type="button" data-action="${step === 1 ? 'sheetnext' : live() ? 'sheet-refresh' : 'sheetdone'}" ${sheetReady({ ...sh, step }) ? '' : raw('disabled')}>${step === 1 ? '下一步' : live() ? '重新读一次' : '添加'}</button></div>
    </div></div>`;
}

export function mountConn(main) {
  const agents = () => part(main, 'agents', agentsHTML());
  const devs = () => { part(main, 'devs', devsHTML()); if (ui.conn.fresh) store.set('ui.conn.fresh', '', true); };
  const setup = () => part(main, 'setup', setupHTML());
  patch(main, html`<div data-part="head"></div>
    <div class="body conn">${live() ? html`<div data-part="setup"></div>` : ''}
      <div data-part="agents"></div>
      <div data-part="devs"></div>
      <h2 id="sec-rules">协作的规矩</h2>
      <div data-part="rules2"></div>
      <div data-part="usage"></div>
    </div><div data-part="sheet"></div><div data-part="rm"></div>`);
  part(main, 'head', headHTML()); if (live()) setup(); agents(); devs(); part(main, 'rules2', rules2HTML()); part(main, 'usage', usageHTML()); part(main, 'sheet', sheetHTML()); part(main, 'rm', rmHTML());
  store.loadCodexHooks?.();
  if (ui.conn.dp) store.loadRelay();
  const offs = [
    store.on(['SUB', 'DEV'], () => part(main, 'head', headHTML())),
    // 确认框打开时把焦点放到主按钮上
    store.on(['ui.conn.rm', 'DEV', 'S', 'T', 'Q', 'lead'], ch => { part(main, 'rm', rmHTML()); if (store.touched(ch, 'ui.conn.rm')) $('[data-focus="rm-ok"]', main)?.focus(); }),
    store.on(['DEV', 'paused', 'SUB', 'ui.conn.plan', 'ui.conn.mp', 'SRV', 'HOOKS', 'RELAY', 'SETUP', 'lead', 'MCP'], agents),
    store.on(['DEV', 'paused', 'ui.conn.mp', 'RELAY'], devs),
    store.on(['SETUP', 'HOOKS', 'S', 'DEV', 'lead'], () => { if (live()) setup(); }),
    store.on(['RULES2'], () => part(main, 'rules2', rules2HTML())),
    store.on(['ui.conn.sheet', 'SUB', 'DEV', 'SRV', 'RELAY'], () => part(main, 'sheet', sheetHTML())),
    store.on(['USAGE', 'ui.conn.up', 'ui.conn.um'], () => part(main, 'usage', usageHTML())),
    // 输入框打字：只改“添加”按钮能不能点
    store.on(['sheetText'], () => { const b = $('[data-action="sheetdone"]', main); if (b && ui.conn.sheet) b.disabled = !sheetReady(ui.conn.sheet); }),
  ];
  // 远程设备的设置里有本机对话列表（中继对话的候选），对话变了要跟着换；正在下拉时不动
  if (live()) offs.push(store.on(['S'], () => { if (ui.conn.dp && !main.querySelector('.devpanel select:focus')) devs(); }));
  return () => offs.forEach(f => f());
}

export function initConn(s) {
  store = s; st = s.state; ui = st.ui;
  const said = c => `${AG[c.a].name}（${shortDev(st, mpKey().d, true)}）默认用 ${c.model || '它自己的默认模型'}${TH[c.think] ? ' · 思考' + TH[c.think][0] : ''}`;
  const say = v => after(v, msg => { if (msg) toast(msg); });
  const flash = el => { if (!el) return; el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); el.classList.remove('fresh'); void el.offsetWidth; el.classList.add('fresh'); setTimeout(() => el.classList.remove('fresh'), 900); };
  registerAll({
    adddev: () => { store.openSheet(); if (ui.view !== 'conn') store.setView('conn'); },
    'refresh-local': () => after(store.refreshLocal().then(async msg => { if (ui.conn.dp || ui.conn.sheet) await store.loadRelay(); return msg; }), msg => { if (msg) toast(msg); }),
    'setup-toggle': () => { const cur = setupFold === null ? setupAllOk().ok : setupFold; setupFold = !cur; store.emit('SETUP'); },
    'setup-cx-hooks': () => after(store.setCodexHooks(true), h => toast(h.installed ? '装好了：Codex 每一轮会告诉 Pigeon' : '没装上')),
    'copy-cmd': ({ d }) => { navigator.clipboard?.writeText(d.v || '').then(() => toast('已复制命令'), () => toast('请手动复制')); },
    'conn-jump': ({ d }) => { const el = document.getElementById(d.v); if (el) el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); },
    'ag-jump': ({ d }) => flash(document.getElementById(`ag-${d.a}`)),
    'use-set': ({ d }) => store.set(`ui.conn.${d.k}`, d.v),
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
    // “接入 agent”最上面和检查清单里的“指挥”下拉
    'set-lead': [({ value }) => after(store.setLead(value === 'you' ? { kind: 'you' } : { kind: 'agent', agent: agOf(value), dev: dvOf(value) }), ok => { if (ok) toast(value === 'you' ? '你自己当指挥：在“派活”和刘海上派活，回信进任务页和刘海' : `${nameOf(st, value)} 现在是指挥`); }), 'change'],
    'model-panel': ({ d }) => store.toggleModelPanel(`${d.dev}:${d.a}`),
    'conn-model': ({ d }) => { const { d: dv, a } = mpKey(); after(store.setConnModel(dv, a, d.m), c => { if (c) toast(said(c)); }); },
    'conn-think': ({ d }) => { const { d: dv, a } = mpKey(); after(store.setConnThink(dv, a, d.t), c => { if (c) toast(said(c)); }); },
    'conn-on': ({ d }) => after(store.toggleConn(d.dev, d.a)),
    'ag-panel': ({ d }) => store.toggleAgentPanel(d.a),
    'dev-panel': ({ d }) => { store.toggleDevPanel(d.dev); if (ui.conn.dp) store.loadRelay(); },
    'relay-pick': [({ d, value }) => say(store.relayDo('use', value, d.host)), 'change'],
    'relay-use': ({ d }) => say(store.relayDo('use', d.id, d.host)),
    'relay-arch': ({ d }) => say(store.relayDo(d.v, d.id)),
    'relay-del': ({ d }) => store.askRelayDelete(d.id),
    'relay-del-ok': ({ d }) => { store.askRelayDelete(''); say(store.relayDo('delete', d.id)); },
    'relay-open': ({ d }) => say(store.openRelay(d.id)),
    'conn-model-add': [({ el }) => { const v = el.value.trim(); if (!v) return; const { d: dv, a } = mpKey(); el.value = ''; say(store.addCustomModel(dv, a, v)); }, 'change'],
    'conn-model-rm': ({ d }) => { const { d: dv, a } = mpKey(); say(store.removeCustomModel(dv, a, d.m)); },
    'cx-hooks': ({ el }) => after(store.setCodexHooks(el.getAttribute('aria-checked') !== 'true'), h => toast(h.installed ? '装好了：Codex 每一轮会告诉 Pigeon' : '关掉了：不再接收 Codex 自己的事件')),
    'mcp-toggle': ({ d, el }) => say(store.setMcp(d.client, el.getAttribute('aria-checked') !== 'true')),
    'srv-set': ({ d }) => after(store.setServer(d.path.split('.'), d.v)),
    reconnect: ({ d }) => say(store.reconnect(d.dev)),
    rule2: ({ d }) => store.toggleRule2(d.id),
    'rule2-pick': [({ d, value }) => store.setRule2(d.id, +value), 'change'],
  });
}
