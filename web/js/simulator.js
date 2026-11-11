// 模拟模式：按剧本发出和真实 hook 一样格式的事件，走同一条处理流程。
// 没有应用时（file:// 或连不上 /events）也能看到派活和送纸条的完整画面。
(function () {
  const M = (window.Pigeon = window.Pigeon || {});
  const SID = 'demo-7f3a';
  const CWD = '/Users/demo/Code/login-page';
  const CHEN = { loft: 'remote-control:env_demo-chen', loft_name: 'CHEN-Y9000P2023' };
  const STUDIO = { loft: 'remote-control:env_demo-studio', loft_name: 'STUDIO-MBP' };
  const CLAUDE = { loft: 'local', agent: 'claude', session: SID, title: '' };
  const YOU = { loft: 'local', agent: 'you', session: '', title: '' };

  const pre = (id, tool_name, tool_input, extra = {}) => ({ hook_event_name: 'PreToolUse', session_id: SID, cwd: CWD, tool_use_id: id, tool_name, tool_input, ...extra });
  const post = (id, tool_name, tool_response, extra = {}) => ({ hook_event_name: 'PostToolUse', session_id: SID, cwd: CWD, tool_use_id: id, tool_name, tool_response, ...extra });
  const text = t => ({ content: [{ type: 'text', text: t }] });
  // 纸条事件：band 里的 # 在每轮换成轮次，保证脚环不重复
  const note = (band, state, extra = {}) => ({ hook_event_name: 'PigeonNote', band, chain: extra.chain || band, count: 1, kind: 'send', via: 'relay', state, preview: '', answer_preview: '', error: '', ...extra });
  const run = (phase, extra) => ({ hook_event_name: 'PigeonRun', phase, task_id: 'pg-sim-img', session_id: SID, cwd: CWD, ...extra });

  const N1 = { from: CLAUDE, to: { ...CHEN, agent: 'codex', session: '01a1c898-demo', title: '问候' } };
  const N2 = { via: 'queue', from: YOU, to: { loft: 'local', agent: 'codex', session: '019a-local-notes', title: '整理发布说明' } };
  const N3 = { from: CLAUDE, to: { ...STUDIO, agent: 'codex', session: '01b2-studio-backup', title: '夜间备份' } };
  const N4 = { from: CLAUDE, to: { ...CHEN, agent: 'codex', session: '01a1c898-demo', title: '问候' }, chain: 'b-3f9a02c1d7', count: 11, reply_to: 'b-77aa3c01e2' };

  // [毫秒, 事件]
  const SCRIPT = [
    [400, pre('r1', 'Read', { file_path: `${CWD}/src/LoginPage.tsx` })],
    [1500, post('r1', 'Read', text('…'))],
    [1900, pre('a1', 'Agent', { subagent_type: 'Explore', description: '找出登录相关的测试', prompt: '在仓库里找出所有和登录流程有关的测试文件，列出路径和覆盖的场景。' })],
    // 后台子代理：PostToolUse 只表示已派出，真正结束看 SubagentStop
    [2000, post('a1', 'Agent', { isAsync: true, status: 'async_launched', agentId: 'sim-a1' })],
    // 一次跨鸽舍往返：Claude 经中继站给另一台电脑上的 Codex 送纸条
    [2600, note('b-3f9a02c1#', 'queued', { ...N1, preview: '构建 main 分支，把报错带回来' })],
    [3300, pre('c1', 'mcp__codex__codex', { prompt: '给登录页生成一张插图：夜晚的小镇，暖色窗户，尺寸 1200×800，导出 PNG 并压缩到 200KB 以内。' })],
    [3600, pre('s1', 'Grep', { pattern: 'login' }, { agent_id: 'sim-a1', agent_type: 'Explore' })],
    [4400, note('b-3f9a02c1#', 'flying', N1)],
    [5200, post('s1', 'Grep', text('8 matches'), { agent_id: 'sim-a1', agent_type: 'Explore' })],
    [5800, pre('a2', 'Agent', { subagent_type: 'code-reviewer', description: '审查 auth 模块的改动', prompt: '审查 src/auth 下的未提交改动，重点看 token 刷新和错误处理。' })],
    [6000, pre('s2', 'Read', { file_path: `${CWD}/tests/login.spec.ts` }, { agent_id: 'sim-a1', agent_type: 'Explore' })],
    [7200, pre('e1', 'Edit', { file_path: `${CWD}/src/LoginPage.tsx` })],
    // 本机往返：你给本机的 Codex 对话送一张纸条
    [8000, note('b-5c11e09a#', 'queued', { ...N2, preview: '把这周合并的 PR 整理成发布说明草稿' })],
    [8600, post('e1', 'Edit', text('ok'))],
    [9600, pre('h1', 'SubagentHandback', { message: '找到 3 个测试：login.spec.ts、auth.test.ts、session.test.ts，覆盖登录、登出和 token 过期。' }, { agent_id: 'sim-a1', agent_type: 'Explore' })],
    [9800, { hook_event_name: 'SubagentStop', session_id: SID, cwd: CWD, agent_id: 'sim-a1', agent_type: 'Explore' }],
    [10200, note('b-5c11e09a#', 'flying', N2)],
    [11200, note('b-3f9a02c1#', 'delivered', N1)],
    [12400, note('b-5c11e09a#', 'delivered', N2)],
    [12600, post('a2', 'Agent', { is_error: true, content: [{ type: 'text', text: '子代理超时：等待 10 分钟仍没有返回结果。' }] })],
    [13800, post('c1', 'mcp__codex__codex', text('已生成 public/login-hero.png（1200×800，184KB），顺手把旧的 hero.jpg 删了。'))],
    // 迷路：对方那台电脑离线，超时没有结果
    [14200, note('b-9d0be417#', 'queued', { ...N3, preview: '看看夜间备份脚本昨晚有没有跑完' })],
    [14600, { hook_event_name: 'Notification', session_id: SID, cwd: CWD, notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }],
    [15600, note('b-9d0be417#', 'flying', N3)],
    [16000, run('start', { title: '生成鸽舍图标', kind: 'image', prompt: '画一个红底白鸽的应用图标，扁平风格，不要文字。', model: 'gpt-6.1-sol' })],
    [17000, run('thread', { thread_id: '019a-sim-icon' })],
    [18200, note('b-3f9a02c1#', 'home', { ...N1, answer_preview: 'main 构建通过。两处警告：未使用的变量 token、过期的依赖 left-pad，行号都附上了。' })],
    [19000, pre('b1', 'Bash', { command: 'npm test -- login' })],
    [19600, run('activity', { activity: 'image', detail: 'image_gen 1024×1024' })],
    [21400, post('b1', 'Bash', text('3 passed'))],
    [22000, pre('c2', 'mcp__codex__codex-reply', { prompt: '再帮我跑一遍登录页的端到端测试，看看插图有没有影响布局。' })],
    [23000, note('b-5c11e09a#', 'home', { ...N2, answer_preview: '草稿写好了：新增 4 项、修复 7 项，放在对话里。' })],
    // 被拒收：同一条链已经传了太多次
    [24600, note('b-e2f48a60#', 'queued', { ...N4, preview: '再确认一次构建结果' })],
    [25600, note('b-e2f48a60#', 'refused', { ...N4, error: '这条链已经传了 11 次，超过往返上限 10' })],
    [26600, run('end', { status: 'done', summary: '图标画好了：assets/generated/loft-icon.png', files: [`${CWD}/assets/generated/loft-icon.png`], thread_id: '019a-sim-icon' })],
    [27400, post('c2', 'mcp__codex__codex-reply', text('端到端测试 6 项全部通过，插图在窄屏下会自动裁切。'))],
    [28800, { hook_event_name: 'Stop', session_id: SID, cwd: CWD }],
    [30600, note('b-9d0be417#', 'lost', { ...N3, error: '10 分钟内没有结果，没有自动重发' })],
    [31400, { source: 'codex', hook_event_name: 'PermissionRequest', session_id: 'sim-codex', cwd: CWD, tool_name: 'shell' }],
    [34800, { source: 'codex', hook_event_name: 'PreToolUse', session_id: 'sim-codex', cwd: CWD, tool_name: 'shell', tool_input: { command: 'git status' } }],
  ];
  const LOOP = 38000;

  const AGENTS = {
    claude: { installed: true, running: true, detail: '模拟：正在干活' },
    codex: { installed: true, running: true, detail: '模拟：ChatGPT 应用内置 Codex' },
    cursor: { installed: true, running: false, detail: '模拟：已安装，没打开' },
    deepseek: { installed: true, running: true, detail: '模拟：DeepSeek Harness 正在运行' },
  };

  function lofts() {
    const now = Date.now();
    return {
      version: 1, updated: now,
      lofts: [
        { id: 'local', name: '这台 Mac', online: true,
          sessions: [
            { id: '019a-local-relay', agent: 'codex', title: '中继站', cwd: '/Users/demo/Code', updated: now - 6e4, relay: true },
            { id: '019a-local-notes', agent: 'codex', title: '整理发布说明', cwd: '/Users/demo/Code/pigeon', updated: now - 3e5 },
          ], projects: [] },
        { id: CHEN.loft, name: CHEN.loft_name, online: true,
          sessions: [
            { id: '01a1c898-demo', agent: 'codex', title: '问候', cwd: 'F:\\Code\\Projects', updated: now - 4e5 },
            { id: '01a1c899-demo', agent: 'codex', title: '构建脚本', cwd: 'F:\\Code\\Projects\\build', updated: now - 9e5 },
          ],
          projects: [{ id: '477552e8-demo', name: 'Mac', path: 'F:/Code/Projects' }] },
        { id: STUDIO.loft, name: STUDIO.loft_name, online: false,
          sessions: [{ id: '01b2-studio-backup', agent: 'codex', title: '夜间备份', cwd: '/Users/studio/backup', updated: now - 864e5 }],
          projects: [] },
      ],
    };
  }
  // 飞行记录里的几条旧纸条（真实的 journal 不存正文，这里为了演示带上预览）
  function history() {
    const now = Date.now();
    return [
      { band: 'b-11c0ffee01', chain: 'b-11c0ffee01', count: 1, kind: 'send', via: 'relay', state: 'home', from: CLAUDE,
        to: { ...CHEN, agent: 'codex', session: '01a1c899-demo', title: '构建脚本' }, created: now - 3720e3, updated: now - 3600e3,
        preview: '把 Windows 上的构建脚本跑一遍', answer_preview: '跑完了，PowerShell 版本 7.4 下全部通过。' },
      { band: 'b-22d0d0cafe', chain: 'b-22d0d0cafe', count: 1, kind: 'new', via: 'relay', state: 'refused', from: YOU,
        to: { ...STUDIO, agent: 'codex', session: '', title: '新对话' }, created: now - 864e5, updated: now - 8639e4,
        preview: '新开一个对话整理照片库', error: '中继站的审批策略是 never，不能替你新开对话' },
    ];
  }

  class Simulator {
    constructor(store) { this.store = store; this.timers = []; this.round = 0; }
    start() {
      this.stop();
      const r = ++this.round;
      const suffix = `-${r}`;
      const hex = (r % 256).toString(16).padStart(2, '0');
      for (const [ms, ev] of SCRIPT) {
        const e = { ...ev };
        if (e.tool_use_id) e.tool_use_id += suffix;
        if (e.agent_id) e.agent_id += suffix;
        if (e.task_id) e.task_id += suffix;
        for (const k of ['band', 'chain', 'reply_to']) if (typeof e[k] === 'string') e[k] = e[k].replace('#', hex);
        if (e.tool_response && e.tool_response.agentId) e.tool_response = { ...e.tool_response, agentId: e.tool_response.agentId + suffix };
        this.timers.push(setTimeout(() => this.store.ingest(e), ms));
      }
      this.timers.push(setTimeout(() => this.start(), LOOP));
    }
    stop() { this.timers.forEach(clearTimeout); this.timers = []; }
    detect() { return new Promise(res => setTimeout(() => res(JSON.parse(JSON.stringify(AGENTS))), 900)); }
  }

  M.Simulator = Simulator;
  M.SIM_AGENTS = AGENTS;
  M.simLofts = lofts;
  M.simNotes = history;
})();
