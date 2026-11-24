// 演示模式的全部示例数据都在这里，别的文件里不该有假数据。createMock() 每次返回一份新的，store 拿它当初始状态。
// 应用模式不用这个文件：backend/adapt.js 把应用接口的数据换成同样形状的对象。字段名照 docs/CONTRACT.md 的“新界面要的数据”。
// 本机的设备 id 是 home（这里叫 mac，应用里是 local），别处一律读 st.home，不写死。契约里的 loft 在界面里叫 dev，deepseek 叫 dsh。
// now 是“现在”，等你处理的一队按它算倒计时；测试里传一个固定的值。

export function createMock(now = Date.now()) {
  const home = 'mac';

  // 设备。link：别的电脑是怎么连上的。codex = 用 Codex 应用自带的远程，ssh = 经 SSH，magpie = 经 magpie（两台都装 magpie，经它的 MCP 路由交给那台的 Pigeon 小助手）
  // name 是界面上显示的名字，用户可以自己改；host 是那台电脑自己的名字，改名不影响它；def 是没改名时用的名字；os 决定图标；online 连不连得上
  const DEV = {
    mac: { name: '这台 Mac', def: '这台 Mac', host: 'MacBook-Air', os: 'mac', link: 'local', online: true },
    win: { name: 'CHEN-Y9000P2023', def: 'CHEN-Y9000P2023', host: 'CHEN-Y9000P2023', os: 'win', link: 'codex', online: true },
  };
  // 每台设备接了哪些 agent、怎么接的。how 见 views/parts.js 的 HOW；role：gate 是远程设备上的入口，via 是经入口带起的；
  // out、inn 能不能发、能不能收：yes 能，part 部分能，nope 不能（不能发的不能当指挥）；model、think 是 Pigeon 派活时默认用的模型和思考强度
  const CONN = {
    mac: [
      { a: 'claude', how: ['plugin', 'hook'], out: 'yes', inn: 'part', on: true, model: 'Opus 5.5', think: 'high' },
      { a: 'codex', how: ['mcp', 'hook'], out: 'yes', inn: 'yes', on: true, model: 'GPT-5.5', think: 'medium' },
      { a: 'cursor', how: ['mcp', 'hook'], out: 'part', inn: 'part', on: true, model: 'Composer 2', think: '' },
      { a: 'dsh', how: ['plugin', 'ui'], out: 'part', inn: 'part', on: true, model: 'DeepSeek V4 Pro', think: 'high' },
      { a: 'antigravity', how: ['agentapi'], out: 'nope', inn: 'yes', on: true, model: 'gemini-4-neon', think: 'high' },
    ],
    win: [
      { a: 'codex', role: 'gate', how: ['inapp'], out: 'nope', inn: 'yes', on: true, model: 'GPT-5.5', think: 'high' },
      { a: 'claude', role: 'via', how: ['viacodex'], out: 'nope', inn: 'part', on: true, model: 'Sonnet 5.5', think: 'medium' },
      { a: 'cursor', role: 'via', how: ['viacodex'], out: 'nope', inn: 'part', on: true, model: 'Composer 2', think: '' },
    ],
  };
  // 指挥（契约里设置的 lead）：kind agent 时是哪台上的哪家，它最近一次派活的那个对话画在指挥台中心；kind you 是你自己在 Pigeon 里派活
  const lead = { kind: 'agent', agent: 'claude', dev: home };

  // 订阅剩多少。按“agent@设备”记，同一个 agent 在两台电脑上可能登的是不同的账号。
  // 这里是示例数字；用 tools/serve.py 打开时，本机这几家换成从 magpie 读到的（data/magpie.js）。字段见 core/quota.js
  const SUB = {
    'claude@mac': { plan: 'Claude Max', left: 62, win: '5 小时额度', reset: '1:40 后重置', more: '本周剩 48%' },
    'codex@mac': { plan: 'ChatGPT Pro', left: 34, win: '5 小时额度', reset: '3:05 后重置', more: '本周剩 71%' },
    'cursor@mac': { plan: 'Cursor Pro', left: 81, win: '本月额度', reset: '12 天后重置' },
    'codex@win': { plan: 'ChatGPT Plus', left: 16, win: '5 小时额度', reset: '0:50 后重置', more: '本周剩 40%' },
  };
  // 新加的 agent 默认用什么模型、思考强度
  const DEF_MODEL = { claude: ['Sonnet 5.5', 'medium'], codex: ['GPT-5.5', 'medium'], cursor: ['Composer 2', ''], dsh: ['DeepSeek V4 Flash', 'low'], antigravity: ['gemini-4-neon', 'high'] };
  // 发起对话时能选的模型，和每个模型分哪几档思考强度（空的不分）
  const MODELS = {
    claude: [['Opus 5.5', 'low medium high xhigh'], ['Sonnet 5.5', 'low medium high xhigh'], ['Haiku 5.5', 'low medium high']],
    codex: [['GPT-5.5', 'low medium high xhigh'], ['GPT-5.5 mini', 'low medium high']],
    cursor: [['Composer 2', ''], ['Sonnet 5.5', 'low medium high'], ['GPT-5.5', 'low medium high']],
    dsh: [['DeepSeek V4 Pro', 'low high'], ['DeepSeek V4 Flash', 'low high']],
    antigravity: [['gemini-4-neon', 'low medium high xhigh', 'Gemini 4 Neon'], ['gemini-4-hydrogen', 'low medium high xhigh', 'Gemini 4 Hydrogen'], ['gemini-4-carbon', 'low medium high', 'Gemini 4 Carbon'], ['claude-opus-5-5', 'low medium high', 'Claude Opus 5.5']],
  };

  // 对话。state 取 run、wait、idle、done、error（error 带一句 error）；activity 是在做什么，形象按它挑动作；
  // via 表示这个对话要经那台设备上的 Codex 带起；parent 是它从哪个对话拆出来的；cwd 是它的项目目录，频道按目录名把对话归成一个项目（子对话跟着父对话）
  const S = [
    { id: 's1', cwd: '/Users/demo/Code/pigeon', agent: 'claude', dev: 'mac', title: 'Pigeon 重构', state: 'run', activity: 'delegating', model: 'Opus 5.5', think: 'high', note: '正在把活分给 3 个 agent' },
    { id: 's2', cwd: '/Users/demo/Code/pigeon', agent: 'codex', dev: 'mac', title: '画应用图标', state: 'run', activity: 'typing', model: 'GPT-5.5', think: 'medium', note: '生图中，已跑 2 分 10 秒' },
    { id: 's3', cwd: '/Users/demo/Code/pigeon', agent: 'codex', dev: 'mac', title: '审查确认框改动', state: 'done', model: 'GPT-5.5', think: 'high', note: '回信：两处建议' },
    { id: 's4', cwd: '/Users/demo/Code/pigeon', agent: 'cursor', dev: 'mac', title: '设置页表单', state: 'run', activity: 'typing', model: 'Composer 2', think: '', note: '正在改 settings.js' },
    { id: 's5', cwd: '/Users/demo/Code/site', agent: 'dsh', dev: 'mac', title: '批量改文案', state: 'idle', model: 'DeepSeek V4 Flash', think: 'low', note: '空闲 12 分钟' },
    { id: 's6', cwd: 'F:\\Code\\pigeon', agent: 'codex', dev: 'win', title: 'Windows 构建', state: 'run', activity: 'building', model: 'GPT-5.5', think: 'high', note: 'cargo build，已跑 4 分钟' },
    { id: 's7', cwd: 'F:\\Code\\pigeon', agent: 'codex', dev: 'win', title: '问候', state: 'idle', model: 'GPT-5.5', think: 'low', note: '空闲' },
    { id: 's8', cwd: 'F:\\Code\\pigeon', agent: 'claude', dev: 'win', via: 'codex', title: '跑测试集', state: 'wait', activity: 'waiting', model: 'Sonnet 5.5', think: 'medium', note: '这个任务在等你确认才发过去' },
    { id: 's9', cwd: 'F:\\Code\\pigeon-installer', agent: 'cursor', dev: 'win', via: 'codex', title: '改安装脚本', state: 'error', error: '连不上：那台的 Codex 没开，Cursor 带不起来', model: 'Composer 2', think: '', note: '出错了' },
    { id: 's1a', agent: 'claude', dev: 'mac', parent: 's1', title: '子代理：查回调文档', state: 'run', activity: 'reading', model: 'Haiku 5.5', think: 'low', note: '读文档中' },
    { id: 's6a', agent: 'codex', dev: 'win', parent: 's6', title: '跑单元测试', state: 'run', activity: 'testing', model: 'GPT-5.5 mini', think: 'low', note: '子对话，已跑 1 分钟' },
    { id: 's6b', agent: 'codex', dev: 'win', parent: 's6', title: '查链接报错', state: 'done', model: 'GPT-5.5 mini', think: 'low', note: '子对话，已回报' },
  ];
  // 任务（契约里的纸条），从新到旧。state 取 asking 等你确认、queued 排队、flying 进行中、delivered 已送达、home 已回信、refused 没发出、lost 没回音；
  // refused 带 reason（blocked 你拦下、timeout 没人理、no_target 对方不在了、max_hops 来回超过上限、offline 那台连不上）；
  // 重发的带 retry_of；暂停中的带 paused: true（叠在 queued 或 asking 上）。from、to 是对话 id，你派的活 from 是 'you'
  const T = [
    { id: 't-8f2c', time: '10:41', from: 's1', to: 's2', kind: '生图', title: '画应用图标：信鸽侧影，深色底，不要文字', state: 'flying', dur: '2:10' },
    { id: 't-5a2e', time: '10:40', from: 's1', to: 's4', kind: '实现', title: '顺手把表单的 aria-label 补上', state: 'queued', dur: '' },
    { id: 't-71ab', time: '10:39', from: 's1', to: 's6', kind: '构建', title: '在 Windows 上跑一遍构建，把报错贴回来', state: 'delivered', dur: '4:02' },
    { id: 't-66d0', time: '10:36', from: 's1', to: 's4', kind: '实现', title: '设置页加“跨设备发送前先问我”开关', state: 'flying', dur: '6:48' },
    { id: 't-3a07', time: '10:35', from: 's1', to: 's8', kind: '测试', title: '在 Windows 上跑测试集，失败的贴回来', state: 'asking', dur: '' },
    { id: 't-5c11', time: '10:30', from: 's1', to: 's3', kind: '审查', title: '审一下确认框的改动，重点看超时处理', state: 'home', dur: '0:52', reply: '两处建议：\n1. 超时和用户点“拦下”现在是同一个退出码，建议分开。\n2. 正文超过 600 字被截断时，确认框里应当写明总字数。' },
    { id: 't-4b90', time: '10:22', from: 's2', to: 's1', kind: '回信', title: '图标初稿好了，放在 assets/generated', state: 'home', dur: '0:04', reply: '初稿两张，都在 assets/generated/ 下。第二张留白更多，更适合做小尺寸。' },
    { id: 't-29e4', time: '09:58', from: 's1', to: 's5', kind: '批量', title: '把 12 处旧说法改成“设备”', state: 'refused', reason: 'blocked', dur: '' },
    { id: 't-0e12', time: '09:41', from: 's1', to: 's7', kind: '安装', title: '在 Windows 上装一下 Node 22，装好说一声', state: 'refused', reason: 'timeout', dur: '' },
    { id: 't-9d31', time: '09:20', from: 's1', to: 's9', kind: '实现', title: '安装脚本里的路径改成用环境变量', state: 'lost', dur: '30:00' },
  ];
  // 每件任务的 why（为什么交给它）、ctx（交出去的上下文）、body（跨设备要发的原文）。字段照契约：
  // why.kind：rule 照规则、quota 额度不够改派、override 指挥没照建议、lead 没有规则命中由指挥判断；suggested 是规则建议给谁，reason 是指挥写的一句理由。
  // 回信没有 why。ctx：tokens 约多少 token（估算），window 对方模型的上下文长度，files 带了哪些文件
  const MORE = {
    't-8f2c': { why: { kind: 'rule', rule: 'r1' }, ctx: { tokens: 1200, window: 400000, files: [] } },
    't-5a2e': { why: { kind: 'rule', rule: 'r4' }, ctx: { tokens: 900, window: 200000, files: ['web/settings.js'] } },
    't-71ab': { why: { kind: 'override', rule: 'r3', suggested: { agent: 'claude', dev: 'win' }, reason: '构建要用那台电脑上装好的 MSVC，只有 Codex 那边配过环境' }, ctx: { tokens: 3800, window: 400000, files: ['Cargo.toml', 'build.rs'] } },
    't-66d0': { why: { kind: 'lead', reason: '设置页一处开关，改动范围小，Cursor 改表单最快' }, ctx: { tokens: 61000, window: 200000, files: ['web/settings.js', 'web/settings.css', 'docs/archive/PRD.md', 'docs/CONTRACT.md', '另外 8 个'] } },
    't-3a07': { why: { kind: 'quota', rule: 'r3', suggested: { agent: 'codex', dev: 'win' } }, ctx: { tokens: 2400, window: 200000, files: ['tests/README.md'] }, body: '在 Windows 上跑测试集，失败的贴回来。\n要先登录私有包源：NPM_TOKEN=npm_9fK2xQ7LmA3pR8sT1vW4yZ6b' },
    't-5c11': { why: { kind: 'rule', rule: 'r2' }, ctx: { tokens: 18000, window: 400000, files: ['src/confirm.rs', 'src/timeout.rs'] } },
    't-29e4': { why: { kind: 'rule', rule: 'r5' }, ctx: { tokens: 900, window: 128000, files: [] } },
    't-0e12': { why: { kind: 'lead', reason: '那台只有 Codex 能装东西' }, ctx: { tokens: 300, window: 400000, files: [] } },
    't-9d31': { why: { kind: 'lead', reason: '安装脚本是 Cursor 上次改的' }, ctx: { tokens: 5200, window: 200000, files: ['scripts/install.ps1'] } },
  };
  T.forEach(t => Object.assign(t, MORE[t.id]));

  // 分派规则：when 一句话、kw 关键词、to 交给谁、fb 额度不够时改派给谁、ask 发之前问不问、n 本周命中几次、over 指挥没照做几次
  const RULES = [
    { id: 'r1', when: '生图、改图', kw: '图 画 icon logo', to: 'codex@mac', fb: '', ask: false, on: true, n: 14, over: 0 },
    { id: 'r2', when: '代码审查、要第二意见', kw: '审 review 看看对不对', to: 'codex@mac', fb: 'cursor@mac', ask: false, on: true, n: 9, over: 1 },
    { id: 'r3', when: '要在 Windows 上跑的构建和测试', kw: 'windows win exe 构建 测试 msvc', to: 'codex@win', fb: 'claude@win', ask: true, on: true, n: 5, over: 1 },
    { id: 'r4', when: '边界清楚的界面改动', kw: '界面 页面 css 表单 样式', to: 'cursor@mac', fb: 'claude@mac', ask: false, on: true, n: 3, over: 0 },
    { id: 'r5', when: '大批量、重复的便宜活', kw: '批量 全部替换 翻译 重命名 压缩', to: 'dsh@mac', fb: '', ask: false, on: true, n: 2, over: 0 },
  ];
  // 协作的规矩。kind：sw 开关，pick 下拉（v 是选中的，opts 是可选的），lock 不能关。
  // cross、relay、split 三个开关对应契约设置里的 post.confirmRemote、post.askRelay、post.askSplit：关掉哪条，那类事就不进等你的一队，直接做
  const RULES2 = [
    { id: 'talk', t: '允许 agent 之间互相派活和发消息', tip: '关掉后它们只能看，不能发', kind: 'sw', on: true },
    { id: 'cross', t: '跨设备发送前先问我', tip: '在刘海上排进等你的一队，点“放行”才发。90 秒不点就不发', kind: 'sw', on: true },
    { id: 'xto', t: '跨设备发送等多久没人点就不发', tip: '到点没人点，就记成“没人理，没发出”，和你点“拦下”分开记', kind: 'pick', v: 90, opts: [30, 60, 90, 100], unit: '秒' },
    { id: 'relay', t: '接活的 agent 往下转派前问我', tip: '接活的 agent 想把活再交给别人时，先排进刘海里等你放行', kind: 'sw', on: true },
    { id: 'split', t: '指挥一次拆给 3 件以上时问我', tip: '指挥想同时派出好几件时，先排进刘海里等你看一眼', kind: 'sw', on: true },
    { id: 'hops', t: '连续来回上限', tip: '没有你插话时，agent 之间最多连着传几次，到了就停下等你', kind: 'pick', v: 10, opts: [3, 5, 10, 20] },
    { id: 'sign', t: '每条消息都标明是谁发的', tip: '对方看得到来自哪个 agent、哪个对话。不能关', kind: 'lock' },
  ];
  // 等你处理的一队（契约里的 GET /api/queue），从旧到新。kind：cross 跨设备发送（band 指向任务，deadline 到点就不发）、
  // relay 接活的 agent 往下转派、split 指挥拆活（parts 拆成的几件）。from、to 是 { dev, agent, session }，还没建对话的 session 是空串
  const ago = s => now - s * 1000;
  const Q = [
    { id: 'q2', kind: 'relay', from: { dev: 'mac', agent: 'codex', session: 's2' }, to: { dev: 'mac', agent: 'dsh', session: '' }, preview: '把 assets/generated 里的 40 张图压成 webp，原图留着', rule: 'r5', created: ago(300) },
    { id: 'q3', kind: 'split', from: { dev: 'mac', agent: 'claude', session: 's1' }, created: ago(150),
      parts: [{ to: { dev: 'mac', agent: 'cursor', session: '' }, preview: '设置页加“刘海”开关' }, { to: { dev: 'mac', agent: 'codex', session: '' }, preview: '审一遍开关的改动' }, { to: { dev: 'mac', agent: 'dsh', session: '' }, preview: '把文档里的旧说法都换成“刘海”' }] },
    { id: 'q1', kind: 'cross', band: 't-3a07', from: { dev: 'mac', agent: 'claude', session: 's1' }, to: { dev: 'win', agent: 'claude', session: 's8' }, preview: '在 Windows 上跑测试集，失败的贴回来', rule: 'r3', created: ago(25), deadline: ago(25) + 90000, secrets: ['npm token'] },
  ];

  // 频道里你写的留言（只记在频道里，不送给任何 agent），按频道 id 分。seq 决定排在哪两件任务之间：任务从旧到新是 1、2、3……
  const NOTES = { 'p:pigeon': [{ id: 'n-1', seq: 6.5, time: '10:33', text: '图标先出两版就行，我晚上一起挑。Windows 那边测试过了再合。' }] };

  // 同一个 Codex 账号下能找到的其他电脑
  const FOUND = [{ name: 'LIN-MBP16', os: 'mac' }, { name: 'home-ubuntu', os: 'linux' }, { name: 'CHEN-Y9000P2023', os: 'win', added: true }];
  // 本机 magpie 里加过的远程 magpie：id 是它在 magpie 里的名字，mcp 是“把它的 MCP 服务加进 Library”开没开，helper 是那台装没装 Pigeon 小助手，apps 是小助手在那台找到的应用
  const MP_FOUND = [
    { id: 'office', host: 'STUDIO-PC', os: 'win', addr: '192.168.1.20:3425', mcp: true, helper: true, apps: ['codex', 'claude', 'cursor'] },
    { id: 'nas', host: 'home-nas', os: 'linux', addr: '192.168.1.8:3425', mcp: true, helper: false, apps: [] },
    { id: 'lab', host: 'LAB-MINI', os: 'mac', addr: '100.86.4.12:3425', mcp: false, helper: true, apps: ['codex', 'dsh'] },
  ];
  // 本机装了 magpie 时，默认模型里能直接选它的路由组
  const MAGPIE = { on: true, groups: [['group/smart', '先用最快重置的订阅'], ['group/cheap', '最便宜的优先'], ['group/coding', '按意图分：写代码给强的，其余给快的']] };
  // 一键接入本机时会改的文件：[文件, 改什么]
  const PLAN = [['~/.claude/settings.json', '启用 pigeon 插件'], ['~/.codex/config.toml', '加 [mcp_servers.pigeon]'], ['~/.codex/hooks.json', '加 2 条回调'], ['~/.cursor/mcp.json', '加 pigeon'], ['~/.cursor/hooks.json', '加 1 条回调']];

  // 演示用：任务页先展开哪件、刘海“回信到了”演示哪件、刘海派活默认发给谁、新任务记的时间；
  // 设置里“演示”那行的“来一件转派 / 来一件拆活”用的两件事（经过协作规矩：开着就进等你的一队，关了直接做）
  const DEMO = {
    openTask: 't-3a07', reply: 't-5c11', target: 'codex@win', clock: '10:43',
    relay: { from: { dev: 'mac', agent: 'cursor', session: 's4' }, to: { dev: 'mac', agent: 'codex', session: '' }, preview: '帮我看一眼表单校验的正则对不对', rule: 'r2' },
    split: { from: { dev: 'mac', agent: 'claude', session: 's1' }, parts: [{ to: { dev: 'mac', agent: 'codex', session: '' }, preview: '画三张空状态插图' }, { to: { dev: 'mac', agent: 'cursor', session: '' }, preview: '把空状态接进任务页' }, { to: { dev: 'mac', agent: 'dsh', session: '' }, preview: '空状态的文案过一遍' }] },
  };

  // 中继站（接入页远程设备的设置里看）：共用的那条上下文已经很大，另有一条归档了的旧的
  const hrsAgo = h => Date.now() - h * 3600000;
  const RELAY = { shared: 'rl-1', byHost: {}, warnAt: 150000, relays: [
    { id: 'rl-1', title: '中转用', model: 'GPT-5.5', effort: 'xhigh', context: 262000, window: 400000, tokensUsed: 39800000, updated: hrsAgo(2), shared: true, hosts: [], archived: false, missing: false },
    { id: 'rl-2', title: '中转（轻量）', model: 'GPT-5.5 mini', effort: 'low', context: 18000, window: 400000, tokensUsed: 260000, updated: hrsAgo(30), shared: false, hosts: [], archived: false, missing: false },
    { id: 'rl-0', title: '中转（旧）', model: 'GPT-5.5', effort: 'high', context: 410000, window: 400000, tokensUsed: 61000000, updated: hrsAgo(240), shared: false, hosts: [], archived: true, missing: false },
  ] };
  // 自己填的模型名：那台电脑上自定义的模型
  const CUSTOMM = { 'codex@win': ['local/qwen3-coder'] };

  return { mode: 'demo', home, DEV, CONN, lead, SUB, DEF_MODEL, MODELS, S, T, RULES, LOW: 20, RULES2, Q, NOTES, FOUND, MP_FOUND, MAGPIE, PLAN, DEMO, RELAY, CUSTOMM };
}
