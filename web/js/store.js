// 把各个 agent 的 hook 事件整理成任务和动作，再通知主题去播放。
(function () {
  const M = (window.Pigeon = window.Pigeon || {});

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
    if (/exec_command|shell|terminal/i.test(n)) return 'run';
    if (/apply_patch|edit_file|write_file/i.test(n)) return 'code';
    if (/read_file|view_image/i.test(n)) return /image/i.test(n) ? 'look' : 'read';
    if (/search|grep|glob|list_dir/i.test(n)) return 'search';
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
  // 命令只显示实际内容，不把启动 shell 的外壳带到任务旁边。
  function detailOf(p) {
    const inp = p.tool_input || {};
    let command = inp.command || inp.cmd || '';
    if (Array.isArray(command)) {
      command = /(?:^|\/)zsh$/.test(command[0]) && command[1] === '-lc' ? command.slice(2).join(' ') : command.join(' ');
    }
    command = String(command).replace(/^\s*(?:\/bin\/)?zsh\s+-lc\s+/, '');
    if (/^(['"])[\s\S]*\1$/.test(command)) command = command.slice(1, -1);
    return oneLine(command || inp.file_path || inp.path || textOf(inp), 90);
  }
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
      this.notes = new Map();
    }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(type, data) { for (const fn of this.listeners) fn(type, data); }
    reset() { this.tasks.clear(); this.order = []; this.sessions.clear(); this.waitingSessions.clear(); this.notes.clear(); this.emit('reset'); }

    list() { return this.order.map(id => this.tasks.get(id)); }
    running(kind) { return this.list().filter(t => t.status === 'running' && (!kind || t.kind === kind)); }
    byAgent() {
      const groups = { claude: [], codex: [], subagent: [] };
      for (const t of this.list()) if (groups[t.kind]) groups[t.kind].push(t);
      return groups;
    }
    // 6 小时还没解除的多半是会话被直接关掉了，和 Mac 应用的规则一致
    waiting() { const now = Date.now(); return Array.from(this.waitingSessions.values()).filter(w => now - w.since < 6 * 3600e3); }

    ingest(p, ts = Date.now()) {
      if (!p || typeof p !== 'object') return;
      // Codex 自己的事件完全独立，不能解除 Claude 的等待或播放 Claude 的动作。
      if (p.source === 'codex') { this.emit('heard', { ts }); return this.codexHook(p, ts); }
      const ev = p.hook_event_name;
      // 纸条和别的事件无关，不碰会话和等待
      if (ev === 'PigeonNote') { this.emit('heard', { ts }); return this.noteEvent(p, ts); }
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
        const item = { session, cwd, agent: 'claude', message: p.message || '', kind, since: ts };
        this.waitingSessions.set(session, item);
        this.emit('waiting', item);
        return;
      }
      // 子代理里的工具调用也带同一个 session_id，不能拿来判断主对话已经不等你了
      if (ev === 'UserPromptSubmit' || ev === 'Stop' || (/^(PreToolUse|PostToolUse|PostToolUseFailure)$/.test(ev) && !p.agent_id)) {
        this.clearWaiting(session);
      }
      if (ev === 'Stop') { this.emit('turnEnd', { session, cwd, ts }); return; }

      // 包装层派活：新名 PigeonRun，旧名 MeerkatCodex
      if (ev === 'PigeonRun' || ev === 'MeerkatCodex') return this.codexEvent(p, ts);
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

    // Codex 应用的一轮对话是一个任务；包装层派出的任务沿用原来的 id。
    codexHook(p, ts) {
      const ev = p.hook_event_name;
      const session = p.session_id || '';
      const key = `codex:${session}`;
      const cwd = p.cwd || this.sessions.get(key)?.cwd || '';
      this.sessions.set(key, { cwd, last: ts });
      if (/^(PreToolUse|PostToolUse|Stop)$/.test(ev)) this.clearWaiting(key);
      if (ev === 'PermissionRequest') {
        const item = { session, cwd, agent: 'codex', message: `Codex 要用 ${p.tool_name || '工具'}`, kind: 'permission', since: ts };
        this.waitingSessions.set(key, item);
        this.emit('waiting', item);
        return;
      }
      const taskId = p.pigeon_task_id || p.meerkat_task_id;
      const wrapped = taskId && this.tasks.get(taskId);
      let t = wrapped && wrapped.kind === 'codex' ? wrapped : this.running('codex').slice().reverse().find(x =>
        x.via === 'codex-app' && x.session === session && (!p.turn_id || x.turnId === p.turn_id));
      if (ev === 'UserPromptSubmit' && !wrapped) {
        const id = `codex:${session}:${p.turn_id || ts}`;
        this.start(id, 'codex', { session_id: session, cwd, tool_input: { prompt: p.prompt || '' } }, ts, {
          via: 'codex-app', turnId: p.turn_id || '', model: p.model || '',
          title: oneLine(String(p.prompt || '').split('\n')[0], 22) || 'Codex 对话',
        });
        return;
      }
      if (!t || t.status !== 'running') return;
      if (p.model) t.model = p.model;
      if (ev === 'PreToolUse' || ev === 'PostToolUse') {
        t.activity = activityOf(p); t.realActivity = true; t.detail = detailOf(p);
        this.emit('taskActivity', t);
      } else if (ev === 'Stop' && t.via === 'codex-app') {
        this.finish(t, { status: 'done', summary: oneLine(textOf(p.last_assistant_message), 120) || '完成' }, ts);
      }
    }

    // 包装层（pigeon run，原 meerkat-codex）上报的 Codex 真实执行过程
    codexEvent(p, ts) {
      const id = p.task_id;
      if (!id) return;
      if (p.phase === 'start') {
        return this.start(id, 'codex', { session_id: p.session_id, cwd: p.cwd, tool_input: { prompt: p.prompt } }, ts, {
          title: p.title || 'Codex 任务', via: 'pigeon-run', codexKind: p.kind, model: p.model || '',
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
        model: inp.model || '',
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

  /* ---------- 纸条 ---------- */
  const NOTE_STATES = ['queued', 'flying', 'delivered', 'home', 'refused', 'lost'];
  const TERMINAL = new Set(['home', 'refused', 'lost']);
  const MAX_NOTES = 100;
  const endpoint = (o, old = {}) => {
    const v = o && typeof o === 'object' ? o : {};
    const out = { ...old };
    for (const k of ['loft', 'loft_name', 'agent', 'session', 'title']) if (v[k] != null && v[k] !== '') out[k] = String(v[k]);
    out.loft = out.loft || 'local';
    out.agent = out.agent || '';
    out.session = out.session || '';
    out.title = out.title || '';
    return out;
  };
  function mergeNote(prev, p, ts) {
    const n = prev ? { ...prev } : {
      band: p.band, chain: p.band, count: 1, kind: 'send', via: '', state: 'queued',
      from: endpoint(), to: endpoint(), preview: '', answer_preview: '', error: '', created: ts, updated: ts, fingerprint: '',
    };
    for (const k of ['chain', 'kind', 'via', 'reply_to', 'fingerprint']) if (p[k]) n[k] = String(p[k]);
    if (Number(p.count) > 0) n.count = Number(p.count);
    if (p.from) n.from = endpoint(p.from, n.from);
    if (p.to) n.to = endpoint(p.to, n.to);
    if (p.preview) n.preview = oneLine(p.preview, 80);
    if (p.answer_preview) n.answer_preview = oneLine(p.answer_preview, 160);
    if (p.error != null && p.state) n.error = String(p.error || '');
    if (p.created) n.created = Number(p.created);
    if (!prev && !p.created) n.created = Number(p.ts) || ts;
    n.updated = Math.max(Number(p.updated || p.ts) || ts, prev ? prev.updated : 0);
    const st = NOTE_STATES.includes(p.state) ? p.state : null;
    // 已经归巢、被拒或迷路的纸条不会再回到路上；迟到的旧事件只补字段
    if (st && !(prev && TERMINAL.has(prev.state) && !TERMINAL.has(st))) n.state = st;
    return n;
  }
  Object.assign(Store.prototype, {
    noteEvent(p, ts) {
      if (!p.band) return;
      const prev = this.notes.get(p.band) || null;
      const n = mergeNote(prev, p, ts);
      n.prevState = prev ? prev.state : null;
      this.notes.set(n.band, n);
      this.trimNotes();
      this.emit('noteUpdate', n);
    },
    // 页面加载时从 /api/notes 恢复：不播动画，已有的纸条保留事件里带的预览
    loadNotes(list) {
      if (!Array.isArray(list)) return;
      for (const raw of list) {
        if (!raw || !raw.band) continue;
        const prev = this.notes.get(raw.band) || null;
        const n = mergeNote(prev, { ...raw, ts: raw.updated }, Number(raw.updated) || Date.now());
        if (prev && prev.updated > n.updated) continue;
        n.prevState = prev ? prev.state : null;
        this.notes.set(n.band, n);
      }
      this.trimNotes();
      this.emit('notesLoaded', this.noteList());
    },
    trimNotes() {
      if (this.notes.size <= MAX_NOTES) return;
      const old = this.noteList().slice(MAX_NOTES);
      for (const n of old) this.notes.delete(n.band);
    },
    noteList() { return Array.from(this.notes.values()).sort((a, b) => b.updated - a.updated); },
    note(band) { return this.notes.get(band) || null; },
    flyingNotes() { return this.noteList().filter(n => !TERMINAL.has(n.state)); },
  });

  M.Store = Store;
  M.NOTE_TERMINAL = TERMINAL;
  M.oneLine = oneLine;
})();
