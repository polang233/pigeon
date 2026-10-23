// 模拟模式：按剧本发出和真实 hook 一样格式的事件，走同一条处理流程。
(function () {
  const M = (window.Meerkat = window.Meerkat || {});
  const SID = 'demo-7f3a';
  const CWD = '/Users/demo/Code/login-page';

  const pre = (id, tool_name, tool_input, extra = {}) => ({ hook_event_name: 'PreToolUse', session_id: SID, cwd: CWD, tool_use_id: id, tool_name, tool_input, ...extra });
  const post = (id, tool_name, tool_response, extra = {}) => ({ hook_event_name: 'PostToolUse', session_id: SID, cwd: CWD, tool_use_id: id, tool_name, tool_response, ...extra });
  const text = t => ({ content: [{ type: 'text', text: t }] });

  // [毫秒, 事件]
  const SCRIPT = [
    [400, pre('r1', 'Read', { file_path: `${CWD}/src/LoginPage.tsx` })],
    [1500, post('r1', 'Read', text('…'))],
    [1900, pre('a1', 'Agent', { subagent_type: 'Explore', description: '找出登录相关的测试', prompt: '在仓库里找出所有和登录流程有关的测试文件，列出路径和覆盖的场景。' })],
    // 后台子代理：PostToolUse 只表示已派出，真正结束看 SubagentStop
    [2000, post('a1', 'Agent', { isAsync: true, status: 'async_launched', agentId: 'sim-a1' })],
    [3600, pre('s1', 'Grep', { pattern: 'login' }, { agent_id: 'sim-a1', agent_type: 'Explore' })],
    [5400, post('s1', 'Grep', text('8 matches'), { agent_id: 'sim-a1', agent_type: 'Explore' })],
    [6000, pre('s2', 'Read', { file_path: `${CWD}/tests/login.spec.ts` }, { agent_id: 'sim-a1', agent_type: 'Explore' })],
    [3300, pre('c1', 'mcp__codex__codex', { prompt: '给登录页生成一张插图：夜晚的小镇，暖色窗户，尺寸 1200×800，导出 PNG 并压缩到 200KB 以内。' })],
    [4300, pre('g1', 'Grep', { pattern: 'useAuth' })],
    [5200, post('g1', 'Grep', text('12 matches'))],
    [5800, pre('a2', 'Agent', { subagent_type: 'code-reviewer', description: '审查 auth 模块的改动', prompt: '审查 src/auth 下的未提交改动，重点看 token 刷新和错误处理。' })],
    [7200, pre('e1', 'Edit', { file_path: `${CWD}/src/LoginPage.tsx` })],
    [8600, post('e1', 'Edit', text('ok'))],
    [9600, pre('h1', 'SubagentHandback', { message: '找到 3 个测试：login.spec.ts、auth.test.ts、session.test.ts，覆盖登录、登出和 token 过期。' }, { agent_id: 'sim-a1', agent_type: 'Explore' })],
    [9800, { hook_event_name: 'SubagentStop', session_id: SID, cwd: CWD, agent_id: 'sim-a1', agent_type: 'Explore' }],
    [10400, pre('x1', 'Read', { file_path: `${CWD}/public/login-hero.png` }, { agent_type: 'code-reviewer' })],
    [12600, post('a2', 'Agent', { is_error: true, content: [{ type: 'text', text: '子代理超时：等待 10 分钟仍没有返回结果。' }] })],
    [13800, post('c1', 'mcp__codex__codex', text('已生成 public/login-hero.png（1200×800，184KB），顺手把旧的 hero.jpg 删了。'))],
    [14600, { hook_event_name: 'Notification', session_id: SID, cwd: CWD, notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }],
    [19000, pre('b1', 'Bash', { command: 'npm test -- login' })],
    [21400, post('b1', 'Bash', text('3 passed'))],
    [22000, pre('c2', 'mcp__codex__codex-reply', { prompt: '再帮我跑一遍登录页的端到端测试，看看插图有没有影响布局。' })],
    [27400, post('c2', 'mcp__codex__codex-reply', text('端到端测试 6 项全部通过，插图在窄屏下会自动裁切。'))],
    [28800, { hook_event_name: 'Stop', session_id: SID, cwd: CWD }],
  ];
  const LOOP = 32000;

  const AGENTS = {
    claude: { installed: true, running: true, detail: '模拟：正在干活' },
    codex: { installed: true, running: true, detail: '模拟：ChatGPT 应用内置 Codex' },
    cursor: { installed: true, running: false, detail: '模拟：已安装，没打开' },
  };

  class Simulator {
    constructor(store) { this.store = store; this.timers = []; this.round = 0; }
    start() {
      this.stop();
      const r = ++this.round;
      const suffix = `-${r}`;
      for (const [ms, ev] of SCRIPT) {
        const e = { ...ev, tool_use_id: ev.tool_use_id && ev.tool_use_id + suffix };
        if (e.agent_id) e.agent_id += suffix;
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
})();
