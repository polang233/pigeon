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
    }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(type, data) { for (const fn of this.listeners) fn(type, data); }
    reset() { this.tasks.clear(); this.order = []; this.sessions.clear(); this.emit('reset'); }

    list() { return this.order.map(id => this.tasks.get(id)); }
    running(kind) { return this.list().filter(t => t.status === 'running' && (!kind || t.kind === kind)); }

    ingest(p, ts = Date.now()) {
      if (!p || typeof p !== 'object') return;
      const ev = p.hook_event_name;
      if (p.session_id) this.sessions.set(p.session_id, { cwd: p.cwd, last: ts });
      this.emit('heard', { ts });

      if (ev === 'SubagentStop') {
        // 正常情况下 Agent 工具的 PostToolUse 已经收尾，这里只兜底。
        const t = this.running('subagent').find(x => !p.agent_type || x.subagentType === p.agent_type);
        if (t) this.finish(t, { status: 'done', summary: t.summary || '子代理已结束' }, ts);
        return;
      }
      if (ev !== 'PreToolUse' && ev !== 'PostToolUse') return;

      const id = p.tool_use_id || `${p.session_id}:${p.tool_name}:${ts}`;
      const name = p.tool_name;
      const kind = isSubagentTool(name) ? 'subagent' : (isCodexTool(name) || isCodexBash(p)) ? 'codex' : null;

      if (ev === 'PreToolUse') {
        if (kind) return this.start(id, kind, p, ts);
        // 子代理里的工具调用（hook 带 agent_type 时）记到对应子代理头上，其余算 Claude 自己的。
        const owner = p.agent_type ? this.running('subagent').find(t => t.subagentType === p.agent_type) : null;
        this.emit('activity', { agent: owner ? owner.id : 'claude', activity: activityOf(p), tool: name, id });
        return;
      }
      // PostToolUse
      const t = this.tasks.get(id);
      if (t) {
        const bad = failed(p.tool_response);
        const text = oneLine(textOf(p.tool_response), 90);
        this.finish(t, { status: bad ? 'failed' : 'done', summary: text || (bad ? '出错了' : '完成') }, ts);
      } else if (!kind) {
        this.emit('activityEnd', { id });
      }
    }

    start(id, kind, p, ts) {
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
