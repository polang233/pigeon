// 把 Claude Code 的 hook 事件整理成任务和动作，再通知主题去播放。
(function () {
  const M = (window.Meerkat = window.Meerkat || {});

  const isSubagentTool = n => n === 'Agent' || n === 'Task';
  const isCodexTool = n => /^mcp__codex/i.test(n || '');
  const isCodexBash = p => p.tool_name === 'Bash' && /(^|[\s;&|(])codex(\s|$)/.test(p.tool_input?.command || '');

  // 从工具名和参数推测这是什么动作，主题按这个选动效。
  function activityOf(p) {
    const n = p.tool_name || '';
    const inp = p.tool_input || {};
    if (n === 'Read') return /\.(png|jpe?g|gif|webp|svg)$/i.test(inp.file_path || '') ? 'look' : 'read';
    if (/^(Grep|Glob|LS)$/.test(n)) return 'search';
    if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(n)) return 'code';
    if (n === 'Bash') return 'run';
    if (/^Web(Search|Fetch)$/.test(n)) return 'search';
    if (/Todo|plan/i.test(n)) return 'think';
    if (/image|imagegen|draw|paint/i.test(n)) return 'image';
    return 'tool';
  }
  // Codex 内部做了什么看不到，只能按任务内容猜一个主要动作。
  function guessFromText(t = '') {
    if (/图|插画|插图|image|png|icon|logo|sprite/i.test(t)) return 'image';
    if (/测试|test|跑一下|运行|run/i.test(t)) return 'run';
    if (/审|review|检查|看看/i.test(t)) return 'read';
    if (/找|搜索|search|grep|定位/i.test(t)) return 'search';
    return 'code';
  }

  function textOf(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map(textOf).join(' ');
    if (typeof v === 'object') {
      if (typeof v.text === 'string') return v.text;
      if (v.content != null) return textOf(v.content);
      if (v.result != null) return textOf(v.result);
      if (v.output != null) return textOf(v.output);
      if (v.stdout != null) return textOf(v.stdout);
    }
    try { return JSON.stringify(v); } catch (e) { return ''; }
  }
  const oneLine = (s, n) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  };
  function failed(resp) {
    if (!resp) return false;
    if (resp.is_error || resp.isError || resp.error) return true;
    const t = textOf(resp).trim();
    return /^(error|错误|failed)\b/i.test(t);
  }

  class Store {
    constructor() {
      this.tasks = new Map();
      this.order = [];
      this.listeners = new Set();
      this.sessions = new Map();
      this.waitingSessions = new Map();
    }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(type, data) { for (const fn of this.listeners) fn(type, data); }
    reset() { this.tasks.clear(); this.order = []; this.sessions.clear(); this.waitingSessions.clear(); this.emit('reset'); }

    list() { return this.order.map(id => this.tasks.get(id)); }
    running(kind) { return this.list().filter(t => t.status === 'running' && (!kind || t.kind === kind)); }
    // 6 小时还没解除的多半是会话被直接关掉了，和 Mac 应用的规则一致
    waiting() { const now = Date.now(); return Array.from(this.waitingSessions.values()).filter(w => now - w.since < 6 * 3600e3); }

    ingest(p, ts = Date.now()) {
      if (!p || typeof p !== 'object') return;
      const ev = p.hook_event_name;
      const session = p.session_id || '';
      const cwd = p.cwd || this.sessions.get(session)?.cwd || '';
      if (session) this.sessions.set(session, { cwd, last: ts });
      this.emit('heard', { ts });

      // 等用户与任务执行分开记录，Stop 只代表一轮结束。
      if (ev === 'Notification') {
        const type = p.notification_type || '';
        const kind = type === 'permission_prompt' ? 'permission'
          : type === 'idle_prompt' ? 'idle'
          : type === 'elicitation_dialog' ? 'question' : !type ? 'other' : null;
        // 登录成功、问询结束之类不是在等你；问询结束要把对应的等待清掉
        if (!kind) { if (type.startsWith('elicitation_')) this.clearWaiting(session); return; }
        const item = { session, cwd, message: p.message || '', kind, since: ts };
        this.waitingSessions.set(session, item);
        this.emit('waiting', item);
        return;
      }
      // 子代理里的工具调用也带同一个 session_id，不能拿来判断主对话已经不等你了
      if (ev === 'UserPromptSubmit' || ev === 'Stop' || (/^(PreToolUse|PostToolUse|PostToolUseFailure)$/.test(ev) && !p.agent_id)) {
        this.clearWaiting(session);
      }
      if (ev === 'Stop') { this.emit('turnEnd', { session, cwd, ts }); return; }

      if (ev === 'MeerkatCodex') return this.codexEvent(p, ts);
      if (ev === 'SubagentStop') {
        // 后台子代理以这个事件为结束；同步子代理一般已在 Agent 的 PostToolUse 收尾。
        const t = this.ownerOf(p);
        if (t) this.finish(t, { status: 'done', summary: t.summary || '子代理已结束' }, ts);
        return;
      }
      if (ev !== 'PreToolUse' && ev !== 'PostToolUse' && ev !== 'PostToolUseFailure') return;

      const id = p.tool_use_id || `${p.session_id}:${p.tool_name}:${ts}`;
      const name = p.tool_name;
      const kind = isSubagentTool(name) ? 'subagent' : (isCodexTool(name) || isCodexBash(p)) ? 'codex' : null;

      if (/^mcp__ccd_/.test(name || '')) return; // 桌面应用自己的内部工具，不算动作
      if (ev === 'PreToolUse') {
        if (kind) return this.start(id, kind, p, ts);
        // 子代理里的工具调用（hook 带 agent_id / agent_type）记到对应子代理头上，其余算 Claude 自己的。
        const owner = this.ownerOf(p);
        if (name === 'SubagentHandback') {
          if (owner) owner.summary = oneLine(p.tool_input?.message, 90);
          return;
        }
        this.emit('activity', { agent: owner ? owner.id : 'claude', activity: activityOf(p), tool: name, id });
        return;
      }
      // PostToolUse / PostToolUseFailure（工具失败走单独的事件，原因在 error 里）
      const t = this.tasks.get(id);
      const resp = p.tool_response;
      if (ev === 'PostToolUseFailure') {
        if (t) this.finish(t, { status: 'failed', summary: oneLine(textOf(p.error), 90) || '出错了' }, ts);
        else if (!kind) this.emit('activityEnd', { id });
        return;
      }
      if (t && t.kind === 'subagent' && resp && (resp.isAsync || resp.status === 'async_launched')) {
        t.agentId = resp.agentId || null; // 后台子代理：等 SubagentStop 再收尾
        return;
      }
      if (t) {
        const bad = failed(p.tool_response);
        const text = oneLine(textOf(p.tool_response), 90);
        this.finish(t, { status: bad ? 'failed' : 'done', summary: text || (bad ? '出错了' : '完成') }, ts);
      } else if (!kind) {
        this.emit('activityEnd', { id });
      }
    }

    clearWaiting(session) {
      const item = this.waitingSessions.get(session);
      if (item) { this.waitingSessions.delete(session); this.emit('waitingEnd', item); }
    }

    ownerOf(p) {
      const subs = this.running('subagent');
      if (p.agent_id) { const t = subs.find(x => x.agentId === p.agent_id); if (t) return t; }
      return p.agent_type ? subs.find(x => x.subagentType === p.agent_type) || null : null;
    }

    // 包装层 meerkat-codex 上报的 Codex 真实执行过程
    codexEvent(p, ts) {
      const id = p.task_id;
      if (!id) return;
      if (p.phase === 'start') {
        return this.start(id, 'codex', { session_id: p.session_id, cwd: p.cwd, tool_input: { prompt: p.prompt } }, ts, {
          title: p.title || 'Codex 任务', via: 'meerkat-codex', codexKind: p.kind,
          activity: p.kind === 'image' ? 'image' : p.kind === 'review' ? 'read' : 'think',
        });
      }
      const t = this.tasks.get(id);
      if (!t) return;
      if (p.phase === 'thread') { t.threadId = p.thread_id; this.emit('taskUpdate', t); }
      else if (p.phase === 'activity') { t.activity = p.activity; t.realActivity = true; t.detail = p.detail || ''; this.emit('taskActivity', t); }
      else if (p.phase === 'end') {
        t.threadId = p.thread_id || t.threadId; t.files = p.files || []; t.usage = p.usage || null;
        this.finish(t, { status: p.status === 'done' ? 'done' : 'failed', summary: oneLine(p.summary, 120) || (p.status === 'done' ? '完成' : '出错了') }, ts);
      }
    }

    start(id, kind, p, ts, extra) {
      if (this.tasks.has(id)) return;
      const inp = p.tool_input || {};
      const prompt = kind === 'codex' ? (inp.prompt || inp.command || '') : (inp.prompt || '');
      const title = kind === 'subagent'
        ? (inp.description || oneLine(prompt, 22) || '子代理任务')
        : (oneLine(String(prompt).split('\n')[0].replace(/^codex\s+(exec\s+)?/, ''), 22) || 'Codex 任务');
      const t = {
        id, kind, session: p.session_id, cwd: p.cwd,
        subagentType: kind === 'subagent' ? (inp.subagent_type || 'general-purpose') : null,
        title, prompt: oneLine(prompt, 120), status: 'running', startedAt: ts, endedAt: null, summary: '',
        activity: guessFromText(`${title} ${prompt}`),
      };
      if (extra) Object.assign(t, extra);
      this.tasks.set(id, t);
      this.order.push(id);
      if (this.order.length > 60) this.tasks.delete(this.order.shift());
      this.emit('taskStart', t);
    }
    finish(t, { status, summary }, ts) {
      if (t.status !== 'running') return;
      t.status = status; t.summary = summary; t.endedAt = ts;
      this.emit('taskEnd', t);
    }
  }

  M.Store = Store;
  M.oneLine = oneLine;
})();
