// 中继站：本机 Codex 桌面应用里专门用来转发的那条对话。远程设备只能经它的 codex_app 工具到达。
// 这里只负责两件事：写给中继站的指令，以及从中继站那一轮的记录里读出结果。
// 读结果时优先用记录里工具调用的原始返回（准确），模型最后给的 JSON 只当补充。
import { digest, turnForBand } from './rollout.mjs';

const BODY_OPEN = '<<<PIGEON-BODY';
const BODY_CLOSE = 'PIGEON-BODY>>>';
const ms = min => Math.max(60000, Math.round(min * 60000));

const replyFormat = (band, extra = '') => [
  '最后，你这一轮的最终回复只输出一个 json 代码块，不要别的文字，格式如下：',
  '```json',
  `{"pigeon":"${band}","sent":true,"thread_id":"对方对话的 threadId","host_id":"对方的 hostId","timed_out":false,"reply":"对方最新一轮最终回复的原文","error":""${extra}}`,
  '```',
  '没发出去时 sent 写 false，error 写一句原因；等待超时时 timed_out 写 true，reply 写空串。',
].join('\n');

const rules = [
  '规矩：只调用上面写到的工具；发送或新建只调用一次，失败或被拒就停下，不要重试，也不要换别的办法发；wait_threads 只按上面说的次数重复；',
  '除这一张纸条外不要发其他消息、不要新建其他对话、不要改任何文件。',
].join('');

// wait_threads 的 timeoutMs 上限是 120000（实测 2026-11-11：传 600000 会被拒）。
// 要等更久就分几次等，每次带上一次返回的 cursor。
export const WAIT_STEP_MS = 120000;
export function waitPlan(waitMin) {
  const total = ms(waitMin);
  const step = Math.min(total, WAIT_STEP_MS);
  const times = Math.max(1, Math.ceil(total / WAIT_STEP_MS));
  const again = times > 1 ? `；如果返回 timedOut 为 true，就带上返回的 cursor（写进 targets 里的 afterCursor）再等一次，总共最多等 ${times} 次` : '';
  return `timeoutMs: ${step}${again}`;
}

// kind = 'send'：给远程已有对话发
export function sendInstruction({ band, threadId, hostId, title, loftName, body, waitMin }) {
  return [
    `我授权本次发送（Pigeon 纸条 ${band}）。`,
    `请用 mcp__codex_app__send_message_to_thread 给远程对话「${title || threadId}」（threadId: ${threadId}，hostId: ${hostId}${loftName ? `，主机 ${loftName}` : ''}）发送下面 ${BODY_OPEN} 和 ${BODY_CLOSE} 之间的文字，原文照发，不要改动、不要加话、不要带这两行标记：`,
    BODY_OPEN,
    body,
    BODY_CLOSE,
    `发出后用 mcp__codex_app__wait_threads 等它这一轮完成（targets 只写这一条，${waitPlan(waitMin)}），再用 mcp__codex_app__read_thread 读最新一轮（turnLimit: 1）。`,
    rules,
    replyFormat(band),
  ].join('\n');
}

// kind = 'new'：在远程主机的某个项目里新开对话
export function newInstruction({ band, projectId, projectName, loftName, title, body, waitMin }) {
  return [
    `我授权本次新建（Pigeon 纸条 ${band}）。`,
    `请用 mcp__codex_app__create_thread 在远程主机${loftName ? ` ${loftName}` : ''}的项目「${projectName || projectId}」下新建一条对话：target 写 {"type":"project","projectId":"${projectId}","environment":{"type":"local"}}，title 写「${title}」，不要指定 model，prompt 是下面 ${BODY_OPEN} 和 ${BODY_CLOSE} 之间的文字，原文照用，不要改动、不要带这两行标记：`,
    BODY_OPEN,
    body,
    BODY_CLOSE,
    `建好后用 mcp__codex_app__wait_threads 等新对话这一轮完成（${waitPlan(waitMin)}），再用 mcp__codex_app__read_thread 读最新一轮（turnLimit: 1）。`,
    rules,
    replyFormat(band),
  ].join('\n');
}

// 刷新远程设备：只读
export function loftsInstruction({ band }) {
  return [
    `Pigeon 刷新鸽舍（${band}）。只读检查：不要发消息、不要新建对话、不要改文件。`,
    '1. 调用 mcp__codex_app__list_projects（参数 {}）。',
    '2. 调用 mcp__codex_app__list_threads（mode: "recent"，limit: 40，不带 hostId）。',
    '最终回复只输出一个 json 代码块，不要别的文字：',
    '```json',
    `{"pigeon":"${band}","hosts":[{"id":"工具说明里 Available hosts 列出的每个 hostId","name":"它的显示名"}],"error":""}`,
    '```',
  ].join('\n');
}

// 从最终回复里挑出带这个编号的 JSON
export function parseRelayReply(text, band) {
  const s = String(text || '');
  const cands = [];
  for (const m of s.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) cands.push(m[1]);
  // 没有代码块时，找最外层的花括号
  const first = s.indexOf('{'), last = s.lastIndexOf('}');
  if (first >= 0 && last > first) cands.push(s.slice(first, last + 1));
  for (const c of cands) {
    try {
      const j = JSON.parse(c.trim());
      if (j && typeof j === 'object' && (!band || j.pigeon === band)) return j;
    } catch {}
  }
  return null;
}

const finalText = items => {
  const msgs = (items || []).filter(i => i && i.type === 'agentMessage');
  const fin = msgs.filter(i => i.phase === 'final_answer');
  return ((fin.length ? fin : msgs).at(-1) || {}).text || '';
};

// 从工具调用里整理出结果
export function toolFacts(tools) {
  const f = { sent: null, threadId: '', hostId: '', sendError: '', waited: false, timedOut: null, reply: '', turnStatus: '' };
  for (const t of tools) {
    const j = t.result && t.result.json;
    const failed = t.status === 'failed' || !!t.error || (t.result && t.result.isError);
    if (t.tool === 'send_message_to_thread' || t.tool === 'create_thread') {
      if (failed) { f.sent = false; f.sendError = t.error || (t.result && t.result.text) || '发送失败'; }
      else {
        f.sent = true;
        f.threadId = (j && j.threadId) || t.arguments.threadId || f.threadId;
        f.hostId = (j && j.hostId) || t.arguments.hostId || f.hostId;
      }
    }
    if (t.tool === 'wait_threads' && !failed && j) {
      f.waited = true;
      f.timedOut = !!j.timedOut;
      const poll = (j.polls || []).find(p => !f.threadId || p.thread?.id === f.threadId) || (j.polls || [])[0];
      if (poll) {
        f.turnStatus = poll.latestTurn?.status || f.turnStatus;
        const m = poll.latestAssistantMessage;
        if (m && m.text && (!m.phase || m.phase === 'final_answer') && !j.timedOut) f.reply = m.text;
      }
    }
    if (t.tool === 'read_thread' && !failed && j) {
      const turn = (j.turns || [])[0];
      if (turn) {
        f.turnStatus = turn.status || f.turnStatus;
        if (turn.status === 'completed') { const txt = finalText(turn.items); if (txt) f.reply = txt; }
      }
    }
  }
  return f;
}

// 中继站那一轮的进展 → 消息状态
// 返回 { state, relayTurn, threadId, hostId, answer, error }；state 为空表示还没有新进展
export function relayProgress(events, band) {
  const t = turnForBand(digest(events), band);
  if (!t) return { state: '' };
  const f = toolFacts(t.tools);
  const base = { relayTurn: t.id, threadId: f.threadId, hostId: f.hostId };
  if (f.sent === false) return { ...base, state: 'refused', error: refusedReason(f.sendError) };
  if (!t.done && !t.aborted) return { ...base, state: f.sent ? 'delivered' : 'flying' };
  if (t.aborted) return { ...base, state: 'lost', error: `中继站这一轮被中断了（${t.reason || '原因不明'}）${f.sent ? '，消息已经发出，但没取回回信' : ''}` };
  // 中继站这一轮结束了
  const j = parseRelayReply(t.answer, band) || {};
  const sent = f.sent ?? (j.sent === true ? true : j.sent === false ? false : null);
  const threadId = f.threadId || j.thread_id || '';
  const hostId = f.hostId || j.host_id || '';
  if (sent === false) return { ...base, threadId, hostId, state: 'refused', error: refusedReason(j.error || f.sendError || '中继站说没发出去') };
  if (sent == null) return { ...base, state: 'lost', error: '中继站结束了这一轮，但看不出消息有没有发出去，没有自动重发' };
  const timedOut = f.timedOut ?? !!j.timed_out;
  const answer = f.reply || (typeof j.reply === 'string' ? j.reply : '');
  if (timedOut || !answer) {
    return { ...base, threadId, hostId, state: 'lost', error: timedOut ? '消息已经送到，但在等待时限内没等到回信；可以去 Codex 里看对方的对话' : '消息已经送到，但没取回回信' };
  }
  return { ...base, threadId, hostId, state: 'home', answer };
}

function refusedReason(msg) {
  const m = String(msg || '');
  if (/approval policy is never/i.test(m)) return '中继站对话的审批策略是 never，不能替你发。请在 Codex 应用里手动新建一条对话，再运行 pigeon relay use <对话id>';
  if (/not found|未找到|没有找到/i.test(m)) return '对方不存在或主机没连上：' + m;
  if (/denied|rejected|拒绝/i.test(m)) return '发送被拒（审批没通过）：' + m;
  return m;
}

// 刷新设备：从中继站那一轮里取 list_projects / list_threads 的原始返回
export function loftsProgress(events, band) {
  const t = turnForBand(digest(events), band);
  if (!t) return { state: '' };
  if (!t.done && !t.aborted) return { state: 'flying' };
  if (t.aborted) return { state: 'lost', error: '中继站这一轮被中断了' };
  const projects = [], threads = [], errors = [];
  for (const tool of t.tools) {
    const j = tool.result && tool.result.json;
    if (tool.status === 'failed' || tool.error) { errors.push(`${tool.tool}: ${tool.error || '失败'}`); continue; }
    if (tool.tool === 'list_projects' && j) projects.push(...(j.projects || []));
    if (tool.tool === 'list_threads' && j) threads.push(...(j.threads || []), ...((j.pinnedThreads || []).filter(x => x.hostId)));
  }
  const j = parseRelayReply(t.answer, band) || {};
  return { state: 'home', projects, threads, hosts: Array.isArray(j.hosts) ? j.hosts : [], errors };
}

// 远程的结果 → lofts.json 里远程设备的形状
export function remoteLofts({ projects, threads, hosts }, previous = []) {
  const map = new Map();
  const ensure = (id, name) => {
    if (!id || id === 'local') return null;
    if (!map.has(id)) map.set(id, { id, name: name || '', online: true, sessions: [], projects: [] });
    const l = map.get(id);
    if (name && !l.name) l.name = name;
    return l;
  };
  for (const h of hosts || []) ensure(h.id, h.name);
  for (const p of projects || []) {
    if (p.projectKind !== 'remote' && !(p.hostId && p.hostId !== 'local')) continue;
    const l = ensure(p.hostId, p.hostDisplayName);
    if (l) l.projects.push({ id: p.projectId, name: p.label || '', path: p.path || '' });
  }
  for (const t of threads || []) {
    if (t.kind && t.kind !== 'codex') continue;
    const l = ensure(t.hostId);
    if (l && !l.sessions.some(s => s.id === t.id)) {
      l.sessions.push({ id: t.id, agent: 'codex', title: t.title || '', cwd: t.cwd || '', updated: Math.round((Number(t.updatedAt) || 0) * 1000), projectId: t.projectId || '' });
    }
  }
  // 以前见过、这次没出现的主机，留着但标成离线
  for (const old of previous) if (old.id !== 'local' && !map.has(old.id)) map.set(old.id, { ...old, online: false });
  for (const l of map.values()) if (!l.name) l.name = (previous.find(p => p.id === l.id) || {}).name || l.id;
  return [...map.values()];
}
