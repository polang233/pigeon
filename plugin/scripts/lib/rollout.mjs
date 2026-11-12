// 读 Codex 的对话记录（~/.codex/sessions/年/月/日/rollout-*-<threadId>.jsonl），每行一个 JSON。
// 只读。用脚环在用户消息里认出“我们那一轮”，再看那一轮有没有结束、最终回复是什么。
import fs from 'node:fs';
import path from 'node:path';
import { codexHome } from './common.mjs';

export function parseLines(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

// 从字节偏移往后读。文件不存在返回 null；最后一行没写完的不算（下次再读）。
export function readFrom(file, offset = 0) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return null; }
  try {
    const size = fs.fstatSync(fd).size;
    if (size <= offset) return { lines: [], end: offset, size };
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    const lastNl = buf.lastIndexOf(0x0a);
    const usable = lastNl >= 0 ? buf.subarray(0, lastNl + 1) : Buffer.alloc(0);
    return { lines: parseLines(usable.toString('utf8')), end: offset + usable.length, size };
  } finally { fs.closeSync(fd); }
}
export const fileSize = f => { try { return fs.statSync(f).size; } catch { return 0; } };

// 按 id 在 sessions 目录里找 rollout 文件（sqlite 里没有记录时的退路）。从新到旧找日期目录。
export function findRollout(threadId, root = path.join(codexHome(), 'sessions')) {
  if (!threadId) return '';
  const want = `-${threadId}.jsonl`;
  const kids = d => { try { return fs.readdirSync(d).sort().reverse(); } catch { return []; } };
  for (const y of kids(root)) for (const m of kids(path.join(root, y))) for (const d of kids(path.join(root, y, m))) {
    const dir = path.join(root, y, m, d);
    const hit = kids(dir).find(f => f.startsWith('rollout-') && f.endsWith(want));
    if (hit) return path.join(dir, hit);
  }
  return '';
}

const textOf = content => (Array.isArray(content) ? content.map(c => c && (c.text ?? '')).join('') : String(content || ''));

// 把一串记录整理成按轮的结构：
// turns: Map<turnId, { id, trigger, users:[text], done, aborted, answer, tools:[{tool, arguments, status, result, error}] }>
export function digest(events) {
  const turns = new Map();
  let current = null;
  const get = id => {
    if (!id) return null;
    if (!turns.has(id)) turns.set(id, { id, trigger: '', users: [], done: false, aborted: false, reason: '', answer: '', tools: [], order: turns.size });
    return turns.get(id);
  };
  for (const ev of events) {
    const p = ev && ev.payload;
    if (!p || typeof p !== 'object') continue;
    const tid = p.turn_id || p.internal_chat_message_metadata_passthrough?.turn_id || '';
    if (p.type === 'task_started') { current = get(p.turn_id); if (current) current.trigger = p.turn_attribution?.turn_trigger || ''; continue; }
    if (p.type === 'task_complete') { const t = get(p.turn_id) || current; if (t) { t.done = true; t.answer = p.last_agent_message || ''; } continue; }
    if (p.type === 'turn_aborted') { const t = get(p.turn_id) || current; if (t) { t.aborted = true; t.reason = p.reason || ''; } continue; }
    const t = get(tid) || current;
    if (!t) continue;
    if (ev.type === 'response_item' && p.type === 'message' && p.role === 'user') t.users.push(textOf(p.content));
    else if (p.type === 'user_message' && p.message) t.users.push(String(p.message));
    else if (p.type === 'item_completed' && p.item) {
      const it = p.item;
      if (it.type === 'UserMessage') t.users.push(textOf(it.content));
      if (it.type === 'McpToolCall') {
        t.tools.push({ server: it.server || '', tool: it.tool || '', arguments: it.arguments || {}, status: it.status || '',
          result: toolResult(it.result), error: it.error ? (it.error.message || JSON.stringify(it.error)) : '' });
      }
    }
  }
  return { turns: [...turns.values()].sort((a, b) => a.order - b.order) };
}

// McpToolCall 的 result 是 {content:[{type:'text', text:'<json>'}], isError}；能解析成 JSON 就解析。
// 有的主机会再包一层（实测 2026-11-13，远程 read_thread 返回的 text 本身又是 {content:[…], isError}），拆到里面那层为止。
const textOfContent = c => (Array.isArray(c) ? c.map(x => (x && x.text) || '').join('') : '');
const isWrapper = j => j && typeof j === 'object' && Array.isArray(j.content) && Object.keys(j).every(k => ['content', 'isError', 'structuredContent', '_meta'].includes(k));
export function toolResult(r) {
  if (!r) return null;
  let text = textOfContent(r.content), isError = !!r.isError, json = null;
  try { json = JSON.parse(text); } catch {}
  for (let i = 0; i < 3 && isWrapper(json); i++) {
    isError = isError || !!json.isError;
    text = textOfContent(json.content);
    json = null;
    try { json = JSON.parse(text); } catch {}
  }
  return { isError, text, json };
}

// 找带着脚环的那一轮。同一个脚环出现多次时取第一次（我们只发一次）。
export function turnForBand(digested, band) {
  return digested.turns.find(t => t.users.some(u => u.includes(band))) || null;
}

// 本机对话（直接排队）的进展：没找到这一轮 → 还在排队；找到了 → 已送达；结束 → 归巢；被打断 → 迷路
export function localProgress(events, band) {
  const t = turnForBand(digest(events), band);
  if (!t) return { state: '', turn: '' };
  if (t.done) return { state: 'home', turn: t.id, answer: t.answer };
  if (t.aborted) return { state: 'lost', turn: t.id, error: `对方这一轮被中断了（${t.reason || '原因不明'}），没有回信` };
  return { state: 'delivered', turn: t.id };
}
