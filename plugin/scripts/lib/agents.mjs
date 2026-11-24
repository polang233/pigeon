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
import { spawnSync, execFileSync } from 'node:child_process';
import { HOME, pidAlive, pigeonDir, readJson, writeJsonAtomic } from './common.mjs';

export const DSH = 'deepseek', AGY = 'antigravity';
// pigeon new --agent 认的写法
export const agentOfArg = a => ({ dsh: DSH, deepseek: DSH, 'deepseek-harness': DSH, antigravity: AGY, agy: AGY, codex: 'codex' })[String(a || '').toLowerCase()] || '';
export const AGENT_NAME = { codex: 'Codex', [DSH]: 'DeepSeek Harness', [AGY]: 'Antigravity' };
// Antigravity 老的三个档位（agentapi --model 认）。flash_lite 落到很旧的 gemini-3.5-flash-lite，不要当默认用；
// 正经的选法是具体的模型 id，比如 gemini-4-neon-high（模型系列 + 思考强度），列表从它本机服务读，见 agyModels
export const AGY_TIERS = ['flash_lite', 'flash', 'pro'];

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

/* ---------- Antigravity 命令行 agy ---------- */
// 2026-05 出的官方命令行，和桌面应用共用登录，不用开应用。`agy -p= --input-format stream-json --output-format stream-json`：
// 正文从标准输入给一行 {"event":"user","message":{"content":"…"}}，输出一行一个事件，result 里是 conversation_id、status、response、usage。
// 要人批准的操作在这种模式下不会停下来等，而是跳过（soft-deny），说明打在错误输出里；退出码照样是 0，所以要看 status 和错误输出。
// 对话存在 ~/.gemini/antigravity-cli/conversations/，概况在 conversation_summaries.db；默认不显示在桌面应用里。
export const agyCliHome = () => process.env.PIGEON_AGY_CLI_HOME || path.join(HOME, '.gemini', 'antigravity-cli');
export function agyCliBin() {
  // 写了 PIGEON_AGY_BIN（测试时）就只认它，写空串表示没装
  if (process.env.PIGEON_AGY_BIN !== undefined) { const c = process.env.PIGEON_AGY_BIN; try { if (c) { fs.accessSync(c, fs.constants.X_OK); return c; } } catch {} return ''; }
  const cands = [ path.join(HOME, '.local', 'bin', 'agy'), ...(process.env.PATH || '').split(':').filter(Boolean).map(d => path.join(d, 'agy'))];
  for (const c of cands) if (c) { try { fs.accessSync(c, fs.constants.X_OK); return c; } catch {} }
  return '';
}
// mode：accept-edits 能直接改文件、plan 只出方案、auto；空串用它自己的默认
export const AGY_CLI_MODES = ['accept-edits', 'auto', 'plan'];
export function agyCliArgs({ session = '', model = '', mode = '', timeoutMin = 0 } = {}) {
  return ['-p=', '--input-format', 'stream-json', '--output-format', 'stream-json',
    ...(model ? ['--model', model] : []), ...(session ? ['--conversation', session] : []), ...(mode ? ['--mode', mode] : []),
    '--print-timeout', `${Math.max(1, Math.round(timeoutMin || 10))}m`];
}
export const agyCliInput = text => JSON.stringify({ event: 'user', message: { content: String(text) } }) + '\n';
// 一行输出 → { conversation }、{ result: { status, response, error, usage } }，别的不管
export function agyCliEvent(line) {
  let e; try { e = JSON.parse(line); } catch { return null; }
  if (!e || typeof e !== 'object') return null;
  const p = e[e.event] && typeof e[e.event] === 'object' ? e[e.event] : {};
  if (e.event === 'step_update' && p.conversation_id) return { conversation: String(p.conversation_id) };
  if (e.event === 'result') return { result: { conversation: String(p.conversation_id || ''), status: String(p.status || ''), response: String(p.response || ''), error: p.error ? String(p.error.message || p.error) : '', usage: p.usage || null } };
  return null;
}
// 错误输出里“没批准、跳过了”的说明
export const agyDenials = stderr => String(stderr || '').split('\n').map(s => s.trim()).filter(s => /denied|not allowed|permission|requires approval|拒绝|没有权限/i.test(s)).slice(0, 5);
// 命令行里的对话（概况库里读，只读）。workspace_uris 是 file:// 开头的目录
export function agyCliSessions({ limit = 15 } = {}) {
  const db = path.join(agyCliHome(), 'conversation_summaries.db');
  if (!fs.existsSync(db)) return [];
  let rows = [];
  try {
    rows = JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', `file:${encodeURI(db)}?immutable=1`,
      `SELECT conversation_id AS id, title, preview, status, workspace_uris AS ws, last_modified_time AS t FROM conversation_summaries WHERE nesting_depth = 0 ORDER BY last_modified_time DESC LIMIT ${Number(limit) || 15}`],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }) || '[]');
  } catch { return []; }
  return rows.map(r => {
    let ws = []; try { ws = JSON.parse(r.ws || '[]'); } catch { ws = String(r.ws || '').split(/[\s,]+/); }
    const cwd = (ws.find(u => /^file:\/\//.test(u)) || '').replace(/^file:\/\//, '');
    return { id: r.id, agent: AGY, title: r.title || String(r.preview || '').split('\n')[0].slice(0, 40) || 'Antigravity 对话', cwd: decodeURIComponent(cwd), updated: Date.parse(r.t) || 0, via: 'cli', ...(/RUNNING/.test(r.status || '') ? { state: 'run' } : {}) };
  });
}
// `agy models`：一行一个“id<Tab>名字 (档)”，同系列并成一个（和 agyModels 一样的形状）。应用没开时用它
export function agyCliModels() {
  const bin = agyCliBin();
  if (!bin) return null;
  let out = '';
  try { out = execFileSync(bin, ['models'], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }); } catch { return null; }
  const fams = new Map();
  for (const line of out.split('\n')) {
    const [id, name] = line.split('\t').map(s => (s || '').trim());
    if (!id || !name) continue;
    const m = /^(.*)-(low|medium|high|xhigh|max)$/.exec(id), lv = /\((Low|Medium|High|XHigh|Max)\)\s*$/i.exec(name);
    if (m && lv) {
      const f = fams.get(m[1]) || { id: m[1], name: name.replace(/\s*\([^)]*\)\s*$/, ''), efforts: [], tag: '' };
      f.efforts.push(m[2]); fams.set(m[1], f);
    } else fams.set(id, { id, name: name.replace(/\s*\((Low|Medium|High|XHigh)\)\s*$/i, ''), efforts: [], tag: '' });
  }
  const order = ['low', 'medium', 'high', 'xhigh', 'max'];
  const models = [...fams.values()].map(f => ({ ...f, efforts: f.efforts.sort((a, b) => order.indexOf(a) - order.indexOf(b)) }));
  if (!models.length) return null;
  const neon = models.find(x => x.id === 'gemini-4-neon');
  return { updated: Date.now(), default: neon ? { model: neon.id, effort: 'high' } : { model: models[0].id, effort: models[0].efforts.includes('high') ? 'high' : models[0].efforts[0] || '' }, models };
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
    return { id: s.id, agent: AGY, title: s.title, cwd: '', updated: s.updated, via: 'app', ...(wait ? { state: 'wait', activity: 'waiting', detail: '等你在 Antigravity 里批准：' + wait } : s.running ? { state: 'run' } : {}) };
  });
}
// 它能用的模型：GetAvailableModels。按它自己“推荐”的顺序，同一系列（groupedModels）的几档思考强度并成一个，
// 别的（Orchestrator、GPT-OSS）单列、不分档。default 是它自己的默认（defaultAgentModelId），拆成系列 + 强度
export function agyModels(hub) {
  const j = agyRpc(hub, 'GetAvailableModels', {}), r = j && j.response;
  if (!r || !r.models) return null;
  const fams = r.groupedModels && typeof r.groupedModels === 'object' ? r.groupedModels : {};
  const levels = f => (fams[f].supportedThinkingLevels || []).map(t => t && t.thinkingSuffix).filter(Boolean);
  const famOf = id => Object.keys(fams).find(f => id.startsWith(f + '-') && levels(f).includes(id.slice(f.length + 1))) || '';
  const order = (Array.isArray(r.agentModelSorts) ? r.agentModelSorts : []).flatMap(s => (s.groups || []).flatMap(g => g.modelIds || []));
  const out = [], seen = new Set();
  for (const id of order) {
    const f = famOf(id), key = f || id;
    if (seen.has(key)) continue;
    seen.add(key);
    const m = r.models[id] || {};
    if (f) out.push({ id: f, name: fams[f].displayName || f, efforts: levels(f), tag: m.tagTitle || '' });
    else if (r.models[id]) out.push({ id, name: String(m.displayName || id).replace(/\s*\((Low|Medium|High|XHigh)\)$/i, ''), efforts: [], tag: m.tagTitle || '' });
  }
  const def = String(r.defaultAgentModelId || ''), df = famOf(def);
  return { updated: Date.now(), default: df ? { model: df, effort: def.slice(df.length + 1) } : { model: def, effort: '' }, models: out };
}
// 上次读到的模型列表存一份：Antigravity 没开时界面和命令行照样有得选
export const agyModelsFile = () => path.join(pigeonDir(), 'models', 'antigravity.json');
export function agyModelsCached({ refresh = true } = {}) {
  const fresh = refresh ? (agyModels(agyHub()) || agyCliModels()) : null;
  if (fresh && fresh.models.length) {
    try { fs.mkdirSync(path.dirname(agyModelsFile()), { recursive: true }); writeJsonAtomic(agyModelsFile(), fresh); } catch {}
    return { ...fresh, live: true, cli: !!agyCliBin() };
  }
  const old = readJson(agyModelsFile(), null);
  return old && Array.isArray(old.models) ? { ...old, live: false, cli: !!agyCliBin() } : { updated: 0, default: { model: '', effort: '' }, models: [], live: false, cli: !!agyCliBin() };
}
// 模型系列 + 思考强度 → agentapi 认的 id（gemini-4-neon + high → gemini-4-neon-high）；已经是完整 id 或老档位的原样用
export function agySlug(model, effort, list = []) {
  const m = String(model || '').trim(), e = String(effort || '').trim();
  if (!m) return '';
  const fam = list.find(x => x.id === m);
  if (fam && fam.efforts.length) return `${m}-${e && fam.efforts.includes(e) ? e : fam.efforts.includes('high') ? 'high' : fam.efforts.at(-1)}`;
  return e && !fam ? `${m}-${e}` : m;
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
