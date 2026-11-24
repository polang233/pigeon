// 本机 Codex 的对话列表：~/.codex/state_5.sqlite 的 threads 表。只读（sqlite3 -readonly）。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { codexHome } from './common.mjs';

export const dbFile = () => path.join(codexHome(), 'state_5.sqlite');

function query(sql) {
  const db = dbFile();
  if (!fs.existsSync(db)) return { ok: false, rows: [], error: '没找到 Codex 的对话数据库：' + db };
  // 先正常只读打开；有时（Codex 正拿着锁、或者沙箱里）只读打开会失败，退一步用 immutable=1 读快照
  let last = '';
  for (const target of [db, `file:${encodeURI(db)}?immutable=1`, `file:${encodeURI(db)}?immutable=1`]) {
    try {
      const out = execFileSync('sqlite3', ['-readonly', '-json', target, sql], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
      return { ok: true, rows: out.trim() ? JSON.parse(out) : [] };
    } catch (e) {
      last = String(e.stderr || e.message).trim().split('\n')[0];
    }
  }
  return { ok: false, rows: [], error: '读 Codex 对话数据库失败：' + last };
}
const q = s => "'" + String(s).replace(/'/g, "''") + "'";

const BASE_COLS = `id, rollout_path, title, cwd, source, approval_mode, archived,
  COALESCE(updated_at_ms, updated_at * 1000) AS updated, COALESCE(name, '') AS name, COALESCE(project_id, '') AS project_id`;
// 模型、思考强度、用了多少 token：新版 Codex 才有这几列，没有的就当空的，免得整条查询失败
const EXTRA = [['model', "''", 'model'], ['reasoning_effort', "''", 'effort'], ['tokens_used', '0', 'tokens_used']];
const colsCache = new Map();
function colsFor(db) {
  if (!colsCache.has(db)) {
    let have = new Set();
    try { have = new Set(JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', `file:${encodeURI(db)}?immutable=1`, 'PRAGMA table_info(threads)'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }) || '[]').map(r => r.name)); } catch {}
    colsCache.set(db, BASE_COLS + EXTRA.map(([c, d, as]) => `, ${have.has(c) ? `COALESCE(${c}, ${d})` : d} AS ${as}`).join(''));
  }
  return colsCache.get(db);
}

// 子代理、审查员之类的内部对话（source 是 JSON）不算
const isUserThread = r => !String(r.source || '').startsWith('{');

export function shapeThread(r) {
  return {
    id: r.id, title: r.name || oneLineTitle(r.title), cwd: r.cwd || '', source: r.source || '', approval: r.approval_mode || '',
    archived: !!r.archived, updated: Number(r.updated) || 0, rollout: r.rollout_path || '', projectId: r.project_id || '',
    model: r.model || '', effort: r.effort || '', tokensUsed: Number(r.tokens_used) || 0,
  };
}
// exec 建的对话没有标题，title 是第一条消息全文。取第一行正文；“# 目标”这种短标题行跳过
const oneLineTitle = t => {
  const lines = String(t || '').split('\n').map(s => s.trim()).filter(Boolean);
  const body = lines.find(s => !/^#{1,6}\s/.test(s)) || (lines[0] || '').replace(/^#+\s*/, '');
  return body.slice(0, 60);
};

export function listThreads({ limit = 40, includeArchived = false } = {}) {
  const r = query(`SELECT ${colsFor(dbFile())} FROM threads ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY updated DESC LIMIT ${Number(limit) * 2}`);
  return { ...r, rows: r.rows.filter(isUserThread).slice(0, limit).map(shapeThread) };
}

export function getThread(id) {
  const r = query(`SELECT ${colsFor(dbFile())} FROM threads WHERE id = ${q(id)} LIMIT 1`);
  return r.rows[0] ? shapeThread(r.rows[0]) : null;
}

// 按 id 前缀或标题找。返回所有候选
export function searchThreads(term) {
  const t = String(term || '').trim();
  if (!t) return [];
  const exact = getThread(t);
  if (exact) return [exact];
  const like = q('%' + t.replace(/[%_]/g, '') + '%');
  const r = query(`SELECT ${colsFor(dbFile())} FROM threads WHERE archived = 0 AND (id LIKE ${q(t.replace(/[%_]/g, '') + '%')} OR name = ${q(t)} OR title = ${q(t)} OR name LIKE ${like} OR title LIKE ${like}) ORDER BY updated DESC LIMIT 20`);
  return r.rows.filter(isUserThread).map(shapeThread);
}

// 本机的项目（Codex 应用侧边栏里的项目）
export function listProjects() {
  const r = query(`SELECT p.id AS id, p.name AS name, COALESCE(MIN(pr.path), '') AS path FROM projects p LEFT JOIN project_roots pr ON pr.project_id = p.id GROUP BY p.id ORDER BY p.position`);
  return r.rows.map(x => ({ id: x.id, name: x.name, path: x.path }));
}

// 中继站候选：桌面应用里手动建的（不是 exec 建的）、审批不是 never 的最近对话
export function latestRelayCandidate() {
  const r = query(`SELECT ${colsFor(dbFile())} FROM threads WHERE archived = 0 AND approval_mode <> 'never' AND source NOT IN ('exec', 'cli') ORDER BY updated DESC LIMIT 20`);
  return r.rows.filter(isUserThread).map(shapeThread)[0] || null;
}

export { query as _query };
