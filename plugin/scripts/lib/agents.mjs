// 本机除了 Codex 还能收活的两个 agent：DeepSeek Harness（DSH）和 Antigravity。2026-11-24 实测都能新开对话、接着已有对话说、把回复读回来。
//
// DSH：自带命令行 dsh。headless 档案跑一件事就退出：--json 一行一个事件，--session-id 接着已有对话，正文从标准输入读（`-`）。
//   对话存在 $DSH_HOME/sessions/<目录>/<session-id>/session.v4.jsonl.zstd，是几段 zstd 接在一起的 JSON 行。
// Antigravity：自带 agentapi（new-conversation、send-message），要它本机服务的地址和令牌，放在 ~/.gemini/antigravity/daemon/hub_*.json。
//   状态和回复读它本机服务的接口（GetAllCascadeTrajectories、GetCascadeTrajectorySteps）。这是它自己界面用的内部接口，不是公开的，升级可能会变。
// 线上的名字：DSH 是 deepseek（界面里叫 dsh），Antigravity 是 antigravity。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { HOME, pidAlive } from './common.mjs';

export const DSH = 'deepseek', AGY = 'antigravity';
// pigeon new --agent 认的写法
export const agentOfArg = a => ({ dsh: DSH, deepseek: DSH, 'deepseek-harness': DSH, antigravity: AGY, agy: AGY, codex: 'codex' })[String(a || '').toLowerCase()] || '';
export const AGENT_NAME = { codex: 'Codex', [DSH]: 'DeepSeek Harness', [AGY]: 'Antigravity' };
// Antigravity 新开对话能选的档位（agentapi --model），也可以写具体的模型 id
export const AGY_MODELS = [['flash_lite', 'Flash Lite'], ['flash', 'Flash'], ['pro', 'Pro']];

/* ---------- DSH ---------- */
const DSH_CLI = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh';
export const dshHome = () => process.env.DSH_HOME || path.join(HOME, '.dsh');
export function dshBin() {
  for (const c of [process.env.PIGEON_DSH_BIN, DSH_CLI]) if (c) { try { fs.accessSync(c, fs.constants.X_OK); return c; } catch {} }
  return '';
}
// 跑一件事的参数：正文从标准输入给，不出现在进程列表里
export function dshArgs({ session = '', mode = '' } = {}) {
  return ['headless', '--json', ...(session ? ['--session-id', session] : []), ...(mode ? ['--permission-mode', mode] : []), '-'];
}

// 几段 zstd 接在一起：按帧头切开一段段解。maxChars 够了就停（列对话时只要开头的标题）
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
export function readZstdFrames(file, maxChars = Infinity) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return ''; }
  if (typeof zlib.zstdDecompressSync !== 'function') return '';
  let out = '', i = buf.indexOf(ZSTD_MAGIC);
  while (i >= 0 && out.length < maxChars) {
    const j = buf.indexOf(ZSTD_MAGIC, i + 4);
    try { out += zlib.zstdDecompressSync(buf.subarray(i, j < 0 ? buf.length : j)).toString('utf8'); } catch {}
    i = j;
  }
  return out;
}
const jsonLines = t => t.split('\n').flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });

// 一条 DSH 对话的概况：标题（取最后一次起的）、目录、用的模型、建的时间
export function dshSessionInfo(file, maxChars = 200000) {
  const ev = jsonLines(readZstdFrames(file, maxChars));
  const head = ev.find(e => e.type === 'session') || {};
  const title = ev.filter(e => e.type === 'session/title').map(e => e.data?.title).filter(Boolean).at(-1) || '';
  const m = ev.filter(e => e.type === 'assistant/message').map(e => e.data?.message?.source?.model).filter(Boolean).at(-1) || '';
  return { id: head.id || '', cwd: head.cwd || '', title, model: m, created: Number(head.createdAt) || 0 };
}

// 本机最近的 DSH 对话（按最后改动排）
export function dshSessions({ limit = 15, root = path.join(dshHome(), 'sessions') } = {}) {
  const all = [];
  const kids = d => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => path.join(d, x.name)); } catch { return []; } };
  for (const proj of kids(root)) for (const dir of kids(proj)) {
    const id = path.basename(dir);
    if (!id.startsWith('session-')) continue;
    const file = path.join(dir, 'session.v4.jsonl.zstd');
    let st; try { st = fs.statSync(file); } catch { continue; }
    all.push({ id, file, updated: st.mtimeMs });
  }
  all.sort((a, b) => b.updated - a.updated);
  return all.slice(0, limit).map(s => {
    const i = dshSessionInfo(s.file, 400000);
    return { id: s.id, agent: DSH, title: i.title || folderOf(i.cwd) || 'DSH 对话', cwd: i.cwd, updated: Math.round(s.updated), ...(i.model ? { model: i.model } : {}) };
  });
}
export const findDshSession = (id, root = path.join(dshHome(), 'sessions')) => {
  const kids = d => { try { return fs.readdirSync(d); } catch { return []; } };
  for (const proj of kids(root)) if (kids(path.join(root, proj)).includes(id)) return path.join(root, proj, id, 'session.v4.jsonl.zstd');
  return '';
};
const folderOf = p => String(p || '').split(/[\\/]/).filter(Boolean).at(-1) || '';

// headless --json 的一行事件 → { session, text, final, usage, error }
export function dshEvent(line) {
  let e; try { e = JSON.parse(line); } catch { return null; }
  if (!e || typeof e !== 'object') return null;
  if (e.type === 'session') return { session: e.sessionId || '' };
  if (e.type === 'text') return { text: String(e.text || '') };
  if (e.type === 'final') {
    const ok = !e.reason || e.reason.kind === 'completed';
    return { final: String(e.text || ''), session: e.sessionId || '', ...(ok ? {} : { error: `没有正常结束（${e.reason.kind}${e.reason.message ? '：' + e.reason.message : ''}）` }) };
  }
  if (e.type === 'error') return { error: String(e.message || e.error || '出错了') };
  return null;
}

/* ---------- Antigravity ---------- */
export const agyHome = () => process.env.PIGEON_AGY_HOME || path.join(HOME, '.gemini', 'antigravity');
export const agentapiBin = () => {
  const c = process.env.PIGEON_AGY_AGENTAPI || path.join(agyHome(), 'bin', 'agentapi');
  try { fs.accessSync(c, fs.constants.X_OK); return c; } catch { return ''; }
};
// 它本机服务的地址和令牌：daemon 目录下最新的 hub_*.json，进程还活着才算
export function agyHub() {
  const dir = path.join(agyHome(), 'daemon');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => /^hub_.*\.json$/.test(f)).map(f => path.join(dir, f)); } catch { return null; }
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!j.httpPort || !j.csrfToken) continue;
      if (j.pid && !pidAlive(j.pid)) continue;
      return { port: Number(j.httpPort), token: String(j.csrfToken), pid: j.pid || 0 };
    } catch {}
  }
  return null;
}
export const HINT_AGY = 'Antigravity 没开：请先打开 Antigravity 应用，再重新发送。';
const agyEnv = hub => ({ ...process.env, ANTIGRAVITY_LS_ADDRESS: `127.0.0.1:${hub.port}`, ANTIGRAVITY_CSRF_TOKEN: hub.token });

// 调它本机服务的接口。用 curl，令牌经标准输入给（不出现在进程列表里）。读不到回 null
export function agyRpc(hub, method, body = {}) {
  if (!hub) return null;
  const cfg = `header = "x-codeium-csrf-token: ${hub.token}"\nheader = "content-type: application/json"\n`;
  const r = spawnSync('curl', ['-s', '-m', '15', '-X', 'POST', '-K', '-', '--data-binary', JSON.stringify(body),
    `http://127.0.0.1:${hub.port}/exa.language_server_pb.LanguageServerService/${method}`], { input: cfg, encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

// agentapi 的输出是一段 JSON：{ response: {...} } 或 { error: "…" }
function agentapi(hub, args) {
  const bin = agentapiBin();
  if (!bin) return { ok: false, error: '没找到 Antigravity 的 agentapi（~/.gemini/antigravity/bin/agentapi）。Antigravity 装了吗？' };
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 60000, env: agyEnv(hub), stdio: ['ignore', 'pipe', 'pipe'] });
  let j = null; try { j = JSON.parse(r.stdout); } catch {}
  if (r.status === 0 && j && j.response) return { ok: true, response: j.response };
  const why = (j && j.error) || (r.error && r.error.message) || String(r.stderr || '').trim().split('\n').at(-1) || `退出码 ${r.status}`;
  return { ok: false, error: 'agentapi 没成功：' + String(why).slice(0, 200) };
}
export function agyNew(hub, { prompt, model = '', title = '' }) {
  const r = agentapi(hub, ['new-conversation', ...(model ? [`--model=${model}`] : []), ...(title ? [`--title=${title}`] : []), prompt]);
  if (!r.ok) return r;
  const id = r.response?.newConversation?.conversationId;
  return id ? { ok: true, id } : { ok: false, error: 'agentapi 没给出对话编号' };
}
export function agySend(hub, id, content) {
  const r = agentapi(hub, ['send-message', id, content]);
  return r.ok ? { ok: true } : r;
}

// 全部对话的概况：{ id, title, running, steps, updated }
export function agyList(hub) {
  const j = agyRpc(hub, 'GetAllCascadeTrajectories', {});
  if (!j || !j.trajectorySummaries) return null;
  return Object.entries(j.trajectorySummaries).map(([id, s]) => ({
    id, title: s.annotations?.title || s.summary || 'Antigravity 对话', running: /RUNNING/.test(String(s.status || '')),
    steps: Number(s.stepCount) || 0, updated: Date.parse(s.lastModifiedTime || s.createdTime || '') || 0,
  }));
}
export function agySessions(hub, { limit = 15 } = {}) {
  const l = agyList(hub);
  if (!l) return [];
  return l.sort((a, b) => b.updated - a.updated).slice(0, limit).map(s => {
    // 在跑的再看一眼是不是停着等你批准
    const wait = s.running ? agyWaiting(agySteps(hub, s.id)) : '';
    return { id: s.id, agent: AGY, title: s.title, cwd: '', updated: s.updated, ...(wait ? { state: 'wait', activity: 'waiting', detail: '等你在 Antigravity 里批准：' + wait } : s.running ? { state: 'run' } : {}) };
  });
}
export const agySteps = (hub, id) => (agyRpc(hub, 'GetCascadeTrajectorySteps', { cascadeId: id }) || {}).steps || null;
// 停下来等用户批准的那一步（比如读工作区外的文件）：回一句说明，没有就是空串
export function agyWaiting(steps, from = 0) {
  const s = (steps || []).slice(from).find(x => /WAITING/.test(String(x.status || '')) && x.requestedInteraction);
  if (!s) return '';
  const p = s.requestedInteraction.permission || {}, r = p.resource || {};
  return [p.actionDescription || r.action || '一个操作', r.target].filter(Boolean).join('：');
}
// 从第 from 步起，模型最后一段非空的回复
export function agyAnswer(steps, from = 0) {
  return (steps || []).slice(from).filter(s => /PLANNER_RESPONSE/.test(String(s.type || '')))
    .map(s => String(s.plannerResponse?.modifiedResponse || s.plannerResponse?.response || '')).filter(x => x.trim()).at(-1) || '';
}
