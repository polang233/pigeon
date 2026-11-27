#!/usr/bin/env node
// 假的 Pigeon 应用服务：放 web/ 里的文件，在内存里实现 docs/CONTRACT.md 里网页要用的接口，不依赖别的包。
// 用来在没有 Mac 应用时跑网页的应用模式。数据全是编的（设备名、对话、额度都是示例，没有任何真账号）。
//
// 用法（在仓库根目录）：node tools/fake-hub.mjs [端口，默认 47421]
//   打开 http://127.0.0.1:47421/ 就是应用模式。不要用 47321，那是真应用的端口。
//
// 调试用的几个地址（不在契约里）：
//   GET /__fake/fail?path=/api/pause&status=500&error=…&n=1   接下来 n 次请求这个路径都回错（看页面的错误提示）
//   GET /__fake/magpie?on=0                                   magpie 的三个接口回 502（on=1 恢复）
//   GET /__fake/drop                                          断开所有 SSE 连接（看页面的重连）
//   GET /__fake/state                                         看现在的设置、最近一次 PUT /api/dispatch、刘海收到的请求
//   GET /__fake/ask                                           来一件跨设备的事排进等你的一队
//   GET /__fake/run                                           来一件 Claude Code 经 pigeon run 交给 Codex 的活（推 PigeonRun）
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const PORT = Number(process.argv[2] || process.env.PORT || 47421);
if (PORT === 47321) { console.error('47321 是真应用的端口，换一个'); process.exit(1); }

const T0 = Date.now(), ago = s => T0 - s * 1000;
const REMOTE = 'remote-control:env_demo01';
const hex = () => Math.random().toString(16).slice(2, 12).padEnd(10, '0');

/* ---------- 数据 ---------- */
let settings = {
  version: 1,
  notify: { done: true, failed: true, waiting: true, turnEnd: true, turnMinSec: 60, noteHome: true, noteLost: true },
  scene: { theme: 'loft', seats: 3, showSubLabels: true, hoverCards: true },
  codex: { preferForImages: true, imageMode: 'builtin', imageModel: 'gpt-image-2', imageQuality: 'medium', imageAspect: 'square', imageTransparent: false, imageDir: 'assets/generated', sessionMode: 'keep', routeAll: true, openWhen: 'end', model: '', effort: '', sandbox: 'auto', timeoutMin: 10, maxConcurrent: 2, summaryChars: 300 },
  post: { relayThread: 'th-relay-0001', maxHops: 10, waitTimeoutMin: 10, confirmRemote: true, askRelay: true, askSplit: true, crossTimeoutSec: 90 },
  perch: { enabled: true, notch: true },
  quota: { show: 'hover', low: 20 },
  secrets: { mode: 'warn' },
  lead: { kind: 'agent', agent: 'claude', loft: 'local' },
  paused: { all: false, lofts: {} },
  devices: { names: {}, hidden: [], off: {}, models: { 'codex@local': { model: 'gpt-6.1-sol', effort: 'medium' } } },
  dispatch: { rules: [
    { id: 'r1', when: '生图、改图', kw: '图 画 icon logo', to: 'codex@local', fb: '', ask: false, on: true },
    { id: 'r2', when: '代码审查', kw: '审 review', to: 'codex@local', fb: '', ask: false, on: true },
    { id: 'r3', when: '要在 Windows 上跑的构建和测试', kw: 'windows win exe 构建 测试', to: `codex@${REMOTE}`, fb: 'codex@local', ask: false, on: true },
  ] },
  // 别的模块写的、网页不认识的字段：网页存设置时要原样留着
  experimental: { keepMe: true },
};

const lofts = {
  version: 1, updated: T0, remoteUpdated: ago(600),
  lofts: [
    { id: 'local', name: '这台 Mac', online: true, projects: [], sessions: [
      { id: 'cl-main-0001', agent: 'claude', title: 'Pigeon 重构', cwd: '/Users/demo/Code/pigeon', updated: ago(5), state: 'run', activity: 'delegating', detail: 'pigeon send', model: 'claude-opus-5-5', effort: 'high' },
      { id: 'cl-main-0001:tu-01', agent: 'claude', title: '子代理：查回调文档', cwd: '/Users/demo/Code/pigeon', updated: ago(8), state: 'run', activity: 'reading', detail: 'Read docs/CONTRACT.md', model: 'claude-haiku-5-5', parent: 'cl-main-0001' },
      // 本机同时开着的另一个 Claude Code 对话：它也算指挥，指挥台上应该收在指挥身上，不另画一个
      { id: 'cl-side-0002', agent: 'claude', title: '整理文档', cwd: '/Users/demo/Code/notes', updated: ago(1500), state: 'idle', model: 'claude-sonnet-5-5', effort: 'medium' },
      // DeepSeek Harness、Antigravity 的对话：由插件从它们自己的记录里列出来
      { id: 'session-dsh-0001', agent: 'deepseek', title: '复审确认框改动', cwd: '/Users/demo/Code/pigeon', updated: ago(400), state: 'idle', model: 'deepseek-v4.1-flash' },
      { id: 'agy-0001', agent: 'antigravity', title: '听一下提示音', cwd: '', updated: ago(120), state: 'run' },
      { id: 'th-relay-0001', agent: 'codex', title: '中继', cwd: '/Users/demo', updated: ago(900), relay: true, state: 'idle' },
      { id: 'th-icon-0002', agent: 'codex', title: '画应用图标', cwd: '/Users/demo/Code/pigeon', updated: ago(30), state: 'run', activity: 'typing', detail: 'apply_patch', model: 'gpt-6.1-sol', effort: 'medium' },
      { id: 'th-review-0003', agent: 'codex', title: '审查确认框改动', cwd: '/Users/demo/Code/pigeon', updated: ago(200), state: 'done', model: 'gpt-6.1-sol', effort: 'high' },
    ] },
    { id: REMOTE, name: 'STUDIO-WIN', online: true, projects: [{ id: 'pj-1', name: 'pigeon', path: 'D:/Code/pigeon' }], sessions: [
      { id: 'th-win-build-01', agent: 'codex', title: 'Windows 构建', cwd: 'D:\\Code\\pigeon', updated: ago(60), state: 'run', activity: 'building', detail: 'cargo build --release', model: 'gpt-6.1-sol', effort: 'high' },
      { id: 'th-win-hello-02', agent: 'codex', title: '问候', cwd: 'D:\\Code', updated: ago(4000), state: 'idle' },
      { id: 'th-win-err-03', agent: 'codex', title: '改安装脚本', cwd: 'D:\\Code\\pigeon', updated: ago(700), state: 'error', error: '进程退出：codex 返回 1' },
    ] },
  ],
};

const P = (loft, agent, session, title = '', extra = {}) => ({ loft, agent, session, title, ...extra });
const ME = P('local', 'claude', 'cl-main-0001');
let notes = [
  { band: 'b-1a2b3c4d5e', kind: 'send', via: 'queue', state: 'flying', from: ME, to: P('local', 'codex', 'th-icon-0002', '画应用图标'), preview: '画应用图标：信鸽侧影，深色底，不要文字', created: ago(130), updated: ago(120),
    why: { kind: 'rule', rule: 'r1', reason: '' }, ctx: { tokens: 1200, window: 400000, files: [] } },
  { band: 'b-2b3c4d5e6f', kind: 'send', via: 'relay', state: 'delivered', from: ME, to: P(REMOTE, 'codex', 'th-win-build-01', 'Windows 构建', { loft_name: 'STUDIO-WIN' }), preview: '在 Windows 上跑一遍构建，把报错贴回来', created: ago(300), updated: ago(240),
    why: { kind: 'override', rule: 'r3', suggested: { agent: 'codex', loft: 'local' }, reason: '构建要用那台电脑上装好的 MSVC' }, ctx: { tokens: 3800, window: 400000, files: ['Cargo.toml', 'build.rs'] } },
  { band: 'b-3c4d5e6f70', kind: 'send', via: 'queue', state: 'home', from: ME, to: P('local', 'codex', 'th-review-0003', '审查确认框改动'), preview: '审一下确认框的改动，重点看超时处理', answer_preview: '两处建议：超时和用户点“拦下”现在是同一个退出码，建议分开；正文被截断时写明总字数。', created: ago(900), updated: ago(840),
    why: { kind: 'rule', rule: 'r2' }, ctx: { tokens: 18000, window: 400000, files: ['src/confirm.rs'] } },
  { band: 'b-4d5e6f7081', kind: 'send', via: 'relay', state: 'asking', from: ME, to: P(REMOTE, 'codex', '', '', { loft_name: 'STUDIO-WIN' }), preview: '在 Windows 上跑测试集，失败的贴回来', created: ago(20), updated: ago(20),
    why: { kind: 'rule', rule: 'r3' }, ctx: { tokens: 2400, window: 200000, files: ['tests/README.md'] } },
  { band: 'b-5e6f708192', kind: 'new', via: 'relay', state: 'refused', reason: 'timeout', from: P('local', 'you', ''), to: P(REMOTE, 'codex', '', '装 Node', { loft_name: 'STUDIO-WIN' }), preview: '在 Windows 上装一下 Node 22，装好说一声', created: ago(5400), updated: ago(5310), retryable: true,
    why: { kind: 'lead', reason: '你在 Pigeon 里自己派的' } },
  { band: 'b-6f708192a3', kind: 'send', via: 'queue', state: 'refused', reason: 'blocked', from: ME, to: P('local', 'codex', 'th-icon-0002'), preview: '把 12 处旧说法改成“设备”', created: ago(7000), updated: ago(6990), why: { kind: 'lead' } },
  { band: 'b-708192a3b4', kind: 'send', via: 'relay', state: 'lost', from: P('local', 'you', ''), to: P(REMOTE, 'codex', 'th-win-err-03', '改安装脚本'), preview: '安装脚本里的路径改成用环境变量', created: ago(4000), updated: ago(2200), retryable: true, error: '等了 30 分钟没有结果',
    why: { kind: 'lead', reason: '你在 Pigeon 里自己派的' }, ctx: { tokens: 5200, window: 200000, files: ['scripts/install.ps1'] } },
];
const FAKE_TOKEN = 'npm_' + 'Demo0Token1Not2Real3Abcd';
let queue = [
  { id: 'q-0001', kind: 'cross', band: 'b-4d5e6f7081', from: ME, to: P(REMOTE, 'codex', ''), preview: '在 Windows 上跑测试集，失败的贴回来', rule: 'r3', created: ago(20), deadline: ago(20) + 90000,
    secrets: ['npm token'], text: `在 Windows 上跑测试集，失败的贴回来。\n要先登录私有包源：NPM_TOKEN=${FAKE_TOKEN}`, chars: 64, files: ['tests/README.md'], project: '' },
];
let detect = {
  claude: { installed: true, running: true, detail: '收到过 hook' },
  codex: { installed: true, running: true, detail: 'ChatGPT 应用内置 Codex' },
  cursor: { installed: true, running: false, detail: '已安装，没打开' },
  deepseek: { installed: true, running: false, detail: '已安装' },
  antigravity: { installed: true, running: true, detail: 'Antigravity 正在运行' },
};
const usage = { day: new Date(T0).toISOString().slice(0, 10), agents: {
  claude: { model: 'claude-opus-5-5', today: { input: 228, output: 100286, cacheRead: 28879364, cacheWrite: 548907, messages: 112 }, week: { input: 680, output: 380856, cacheRead: 97425216, cacheWrite: 1549481, messages: 336 } },
  codex: { model: 'gpt-6.1-sol', today: { input: 79548, output: 19940, cacheRead: 1205632, cacheWrite: 0, messages: 3 }, week: { input: 179548, output: 49940, cacheRead: 3205632, cacheWrite: 0, messages: 9 } },
  subagent: { model: 'claude-haiku-5-5', today: { input: 1200, output: 8800, cacheRead: 220000, cacheWrite: 1000, messages: 14 }, week: { input: 3200, output: 18800, cacheRead: 520000, cacheWrite: 3000, messages: 40 } },
} };
const codexModels = [{ slug: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', efforts: ['low', 'medium', 'high', 'xhigh'] }, { slug: 'gpt-6.1-mini', name: 'GPT-6.1 mini', efforts: ['minimal', 'low', 'medium', 'high'] }];
let hooks = { installed: true, working: true, detail: '已收到 Codex 的事件' };
let magpieOn = process.env.FAKE_MAGPIE !== 'off';
const iso = s => new Date(T0 + s * 1000).toISOString();
const magpie = {
  hello: { name: 'magpie', version: '0.0.0-fake' },
  quotas: { data: [
    { provider: 'codex', name: '示例账号 A', kind: 'subscription', plan: 'pro', last: true, readAt: iso(-60), windows: [{ name: '5 hours', used: 84, resetsAt: iso(3 * 3600) }, { name: '7 days', used: 40, resetsAt: iso(4 * 86400) }] },
    { provider: 'codex', name: '示例账号 B', kind: 'subscription', plan: 'plus', readAt: iso(-60), windows: [{ name: '5 hours', used: 10, resetsAt: iso(2 * 3600) }] },
    { provider: 'cursor', name: '示例账号 C', kind: 'subscription', plan: 'premium', readAt: iso(-60), windows: [{ name: 'monthly', used: 17, resetsAt: iso(12 * 86400) }] },
    { provider: 'deepseek', name: '示例 key', kind: 'balance', balance: '¥12.30', readAt: iso(-60) },
  ] },
  models: { data: [{ id: 'group/smart', context_window: 200000, reasoning_levels: ['low', 'medium', 'high'] }, { id: 'group/cheap', context_window: 128000, reasoning_levels: [] }, { id: 'codex/gpt-6.1-sol', context_window: 400000, reasoning_levels: ['low', 'medium', 'high', 'xhigh'] }] },
};
let lastDispatch = null;
const notchLog = [];

/* ---------- SSE ---------- */
const clients = new Set();
function send(msg) { const line = `data: ${JSON.stringify(msg)}\n\n`; for (const c of clients) c.write(line); }
const pushNote = n => send({ type: 'hook', ts: Date.now(), payload: { hook_event_name: 'PigeonNote', ts: Date.now(), ...n } });
const pushQueue = () => send({ type: 'queue', items: queue });
const pushSettings = () => send({ type: 'settings', settings });
// 中继站对话的示例信息：现在用的那条上下文已经很大；还有一条用过、归档了的
const relayInfo = {
  'th-relay-0001': { title: '中继', model: 'gpt-6.1-terra', effort: 'xhigh', context: 259878, window: 486400, tokensUsed: 39872176 },
  'th-relay-old0': { title: '中转（旧）', model: 'gpt-6.1-terra', effort: 'high', context: 412000, window: 486400, tokensUsed: 61000000, archived: true, updated: ago(86400) },
};
settings.post.relayUsed = ['th-relay-0001', 'th-relay-old0'];
const mergeInto = (base, patch) => { for (const [k, v] of Object.entries(patch)) { if (v === null) delete base[k]; else if (v && typeof v === 'object' && !Array.isArray(v)) mergeInto((base[k] = base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? base[k] : {}), v); else base[k] = v; } };
const pushLofts = () => { lofts.updated = Date.now(); send({ type: 'lofts', lofts }); };
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 15000);

/* ---------- 纸条怎么走（很粗的模拟） ---------- */
const noteBy = band => notes.find(n => n.band === band);
function setNote(band, patch) { const n = noteBy(band); if (!n) return; Object.assign(n, patch, { updated: Date.now() }); if (!['queued', 'asking'].includes(n.state)) delete n.paused; pushNote(n); }
const paused = loft => settings.paused?.all || !!settings.paused?.lofts?.[loft];
function fly(band) {
  const n = noteBy(band); if (!n) return;
  if (paused(n.to.loft)) { setNote(band, { state: 'queued', paused: true }); return; }
  setNote(band, { state: 'flying', paused: false });
  setTimeout(() => { if (noteBy(band)?.state === 'flying') setNote(band, { state: 'delivered' }); }, 3000);
  setTimeout(() => { if (noteBy(band)?.state === 'delivered') setNote(band, { state: 'home', answer_preview: '做完了：一切正常（假服务的回信）' }); }, 9000);
}
function ask(n, text) {
  const q = { id: 'q-' + hex().slice(0, 6), kind: 'cross', band: n.band, from: n.from, to: n.to, preview: n.preview, created: Date.now(), deadline: Date.now() + (settings.post?.crossTimeoutSec || 90) * 1000, text, chars: text.length, files: [], project: '' };
  if (/npm_[A-Za-z0-9]{20,}/.test(text)) q.secrets = ['npm token'];
  queue.push(q); pushQueue();
}
// 到点没人理：不发
setInterval(() => {
  const now = Date.now(), gone = queue.filter(q => q.deadline && q.deadline < now && !q.paused);
  if (!gone.length) return;
  queue = queue.filter(q => !gone.includes(q)); pushQueue();
  gone.forEach(q => setNote(q.band, { state: 'refused', reason: 'timeout' }));
}, 1000);
// 对话在动：本机那个 Codex 对话轮流换在做什么
const ACTS = ['typing', 'reading', 'testing', 'thinking'];
let actI = 0;
setInterval(() => { const s = lofts.lofts[0].sessions.find(x => x.id === 'th-icon-0002'); if (s && s.state === 'run') { s.activity = ACTS[actI++ % ACTS.length]; s.detail = { typing: 'apply_patch', reading: 'rg pigeon', testing: 'npm test', thinking: '' }[s.activity]; s.updated = Date.now(); pushLofts(); } }, 6000);
// 一件 Claude Code 经 pigeon run 交给 Codex 的活
function runDemo() {
  const id = 'pg-' + hex().slice(0, 8), ev = (phase, x) => send({ type: 'hook', ts: Date.now(), payload: { hook_event_name: 'PigeonRun', phase, task_id: id, ...x } });
  ev('start', { title: '给设置页补 aria-label', kind: 'code', prompt: '给设置页补 aria-label', cwd: '/Users/demo/Code/pigeon', model: 'gpt-6.1-sol', session_id: 'cl-main-0001' });
  setTimeout(() => ev('activity', { activity: 'run', detail: 'npm test' }), 4000);
  setTimeout(() => ev('end', { status: 'done', summary: '补了 6 处 aria-label，测试都过了', files: ['web/src/views/settings.js'] }), 14000);
}
setTimeout(runDemo, 5000);

/* ---------- 分派规则的建议：和网页用同一份判法 ---------- */
let routeMod = null;
async function suggestOf(text, to) {
  routeMod ??= await import('../web/src/core/route.js');
  const fw = a => (a === 'deepseek' ? 'dsh' : a), key = k => (k ? `${fw(k.split('@')[0])}@${k.slice(k.indexOf('@') + 1)}` : '');
  const alive = lastDispatch ? lastDispatch.alive.map(key) : null, quota = lastDispatch ? lastDispatch.quota : {};
  const devs = new Set((alive || []).map(k => k.slice(k.indexOf('@') + 1)));
  const st = { home: 'local', DEV: Object.fromEntries([...devs, 'local'].map(d => [d, {}])), CONN: {}, SUB: Object.fromEntries(Object.entries(quota).map(([k, v]) => [key(k), { left: v }])), LOW: lastDispatch?.low ?? settings.quota?.low ?? 20,
    RULES: (settings.dispatch?.rules || []).map(r => ({ ...r, to: key(r.to), fb: key(r.fb) })), RULES2: [{ id: 'cross', on: settings.post?.confirmRemote !== false }], settings: {},
    // 指挥照设置里的 lead：交给指挥自己的规则算“自己做”
    lead: settings.lead?.kind === 'you' ? { kind: 'you' } : { kind: 'agent', agent: fw(settings.lead?.agent || 'claude'), dev: settings.lead?.loft || 'local' } };
  for (const k of alive || []) { const d = k.slice(k.indexOf('@') + 1); (st.CONN[d] ??= []).push({ a: k.split('@')[0], on: true, inn: 'yes' }); }
  if (!alive) for (const r of st.RULES) for (const k of [r.to, r.fb]) if (k) { const d = k.slice(k.indexOf('@') + 1); st.DEV[d] ??= {}; (st.CONN[d] ??= []).push({ a: k.split('@')[0], on: true, inn: 'yes' }); }
  const r = routeMod.suggest(st, text, to ? key(to) : undefined);
  const back = k => (k ? k.replace(/^dsh@/, 'deepseek@') : '');
  return { ...r, suggested: back(r.suggested) };
}

/* ---------- 出错的注入 ---------- */
const fails = new Map(); // path -> { status, error, n }
function failFor(path) { const f = fails.get(path); if (!f) return null; if (--f.n <= 0) fails.delete(path); return f; }

/* ---------- HTTP ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.md': 'text/plain; charset=utf-8' };
function json(res, code, body) { const data = Buffer.from(JSON.stringify(body)); res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': data.length }); res.end(data); }
async function bodyOf(req) { let s = ''; for await (const c of req) s += c; if (!s) return {}; try { return JSON.parse(s); } catch { return undefined; } }
async function serveFile(res, path) {
  const rel = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '');
  let file = join(ROOT, rel);
  if (!file.startsWith(ROOT)) return json(res, 403, { error: '不行' });
  try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); const data = await readFile(file); res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(data); }
  catch { json(res, 404, { error: '没有这个文件' }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), path = url.pathname, M = req.method;
  if (path.startsWith('/__fake/')) {
    if (path === '/__fake/fail') { fails.set(url.searchParams.get('path'), { status: Number(url.searchParams.get('status') || 500), error: url.searchParams.get('error') || '假服务故意回错', n: Number(url.searchParams.get('n') || 1) }); return json(res, 200, { ok: true, fails: [...fails] }); }
    if (path === '/__fake/magpie') { magpieOn = url.searchParams.get('on') !== '0'; return json(res, 200, { ok: true, magpieOn }); }
    if (path === '/__fake/drop') { for (const c of clients) c.end(); clients.clear(); return json(res, 200, { ok: true }); }
    if (path === '/__fake/run') { runDemo(); return json(res, 200, { ok: true }); }
    if (path === '/__fake/state') return json(res, 200, { settings, lastDispatch, notchLog: notchLog.slice(-10), queue });
    if (path === '/__fake/ask') { const n = { band: 'b-' + hex(), kind: 'send', via: 'relay', state: 'asking', from: ME, to: P(REMOTE, 'codex', 'th-win-hello-02', '问候', { loft_name: 'STUDIO-WIN' }), preview: '帮我看一下那台的磁盘还剩多少', created: Date.now(), updated: Date.now(), why: { kind: 'lead', reason: '只有那台能看' } }; notes.push(n); pushNote(n); ask(n, n.preview); return json(res, 200, { ok: true, band: n.band }); }
    return json(res, 404, { error: '没有这个调试地址' });
  }
  if (!path.startsWith('/api/') && path !== '/events') return serveFile(res, path === '/' ? '/index.html' : path);

  const f = path.startsWith('/api/') && failFor(path.replace(/^\/api\/queue\/.+$/, '/api/queue/*'));
  if (f) return json(res, f.status, { ok: false, error: f.error });

  if (path === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'detect', ts: Date.now(), agents: detect })}\n\n`);
    clients.add(res); req.on('close', () => clients.delete(res));
    return;
  }
  const body = ['POST', 'PUT', 'PATCH'].includes(M) ? await bodyOf(req) : null;
  if (body === undefined) return json(res, 400, { error: '请求体不是 JSON' });

  if (path === '/api/lofts' && M === 'GET') return json(res, 200, lofts);
  if (path === '/api/lofts/refresh' && M === 'POST') {
    if (!settings.post?.relayThread) return json(res, 200, { ok: false, error: '还没设中继对话' });
    setTimeout(() => { lofts.remoteUpdated = Date.now(); pushLofts(); }, 1200);
    return json(res, 200, { ok: true });
  }
  if (path === '/api/notes' && M === 'GET') return json(res, 200, { notes: [...notes].sort((a, b) => b.updated - a.updated).slice(0, 100) });
  if (path === '/api/queue' && M === 'GET') return json(res, 200, { items: queue });
  if (path.startsWith('/api/queue/') && M === 'POST') {
    const id = decodeURIComponent(path.slice('/api/queue/'.length)), q = queue.find(x => x.id === id);
    if (!q) return json(res, 404, { ok: false, error: '这件已经不在队里了' });
    if (!['release', 'block', 'release_masked'].includes(body.action)) return json(res, 400, { ok: false, error: 'action 不对' });
    queue = queue.filter(x => x !== q); pushQueue();
    if (body.action === 'block') setNote(q.band, { state: 'refused', reason: 'blocked' }); else fly(q.band);
    return json(res, 200, { ok: true });
  }
  if (path === '/api/pause' && M === 'POST') {
    settings.paused ??= { all: false, lofts: {} };
    if (body.loft) { settings.paused.lofts ??= {}; settings.paused.lofts[body.loft] = !!body.on; } else settings.paused.all = !!body.on;
    pushSettings();
    if (!body.on) for (const n of notes.filter(n => n.paused && n.state === 'queued' && !paused(n.to.loft))) fly(n.band);
    return json(res, 200, { ok: true });
  }
  if (path === '/api/send' && M === 'POST') {
    const to = body.to || {};
    if (to.agent !== 'codex') return json(res, 501, { ok: false, error: '第一版只能发给 Codex' });
    const old = body.retry_of && noteBy(body.retry_of);
    if (body.retry_of && !old?.retryable) return json(res, 200, { ok: false, error: '没有这件的原文，不能重发' });
    const text = body.text || (old ? old.preview : '');
    if (!text) return json(res, 200, { ok: false, error: '没有要发的内容' });
    const n = { band: 'b-' + hex(), kind: to.session ? 'send' : 'new', via: to.loft === 'local' ? 'queue' : 'relay', state: 'queued', from: P('local', 'you', ''), to: P(to.loft, 'codex', to.session || '', '', to.loft !== 'local' ? { loft_name: 'STUDIO-WIN' } : {}),
      preview: text.slice(0, 80), created: Date.now(), updated: Date.now(), retryable: true, ...(body.retry_of ? { retry_of: body.retry_of } : {}), why: body.why || (old?.why) || { kind: 'lead' } };
    notes.push(n);
    if (to.loft !== 'local' && settings.post?.confirmRemote !== false) { n.state = 'asking'; pushNote(n); ask(n, text); } else { pushNote(n); fly(n.band); }
    return json(res, 200, { ok: true, band: n.band });
  }
  if (path === '/api/open' && M === 'POST') { notchLog.push({ open: body }); return body.session ? json(res, 200, { ok: true }) : json(res, 200, { ok: false, error: '没有这个对话的 id，打不开' }); }
  if (path === '/api/notch' && M === 'POST') { notchLog.push(body); return json(res, 200, { ok: true }); }
  if (path === '/api/settings') {
    if (M === 'GET') return json(res, 200, settings);
    if (M === 'PUT') { if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: '设置要是一个对象' }); settings = body; pushSettings(); return json(res, 200, settings); }
    // 只改几处：对象逐层合并，null 删掉，其余整个换
    if (M === 'PATCH') { if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: '设置要是一个对象' }); mergeInto(settings, body); pushSettings(); return json(res, 200, settings); }
  }
  if (path === '/api/detect') { if (M === 'POST') send({ type: 'detect', ts: Date.now(), agents: detect }); return json(res, 200, detect); }
  if (path === '/api/usage' && M === 'GET') return json(res, 200, usage);
  if (path === '/api/codex/models' && M === 'GET') return json(res, 200, codexModels);
  if (path === '/api/agents/models' && M === 'GET') return json(res, 200, { antigravity: { updated: T0, live: true, default: { model: 'gemini-4-neon', effort: 'high' }, models: [
    { id: 'gemini-4-neon', name: 'Gemini 4 Neon', efforts: ['low', 'medium', 'high', 'xhigh'], tag: 'New' },
    { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen', efforts: ['low', 'medium', 'high', 'xhigh'], tag: 'New' },
    { id: 'gemini-4-argon', name: 'Gemini 4 Argon', efforts: ['low', 'medium', 'high'], tag: 'Leaving Soon' },
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', efforts: ['low', 'medium', 'high'], tag: 'New' },
    { id: 'gemini-pro-orchestrator-neon', name: 'Orchestrator (Neon)', efforts: [], tag: 'New' }] } });
  // 中继站：模型、上下文大小是写死的示例；换、归档、删除改 settings.post 和这张表
  if (path === '/api/relay') {
    const P = settings.post = { relayByHost: {}, relayUsed: [], ...settings.post };
    const titleOf = id => (lofts.lofts[0].sessions.find(x => x.id === id) || {}).title || '';
    if (M === 'POST') {
      const { action, id = '', host = '' } = body, inUse = id && (P.relayThread === id || Object.values(P.relayByHost).includes(id));
      if (action === 'use') {
        const old = host ? P.relayByHost[host] || P.relayThread : P.relayThread;
        if (host) { if (id) P.relayByHost[host] = id; else delete P.relayByHost[host]; } else P.relayThread = id;
        P.relayUsed = [...new Set([id, old, ...P.relayUsed].filter(Boolean))];
        pushSettings();
        return json(res, 200, id ? { ok: true, id, title: titleOf(id) } : { ok: true });
      }
      if (!relayInfo[id]) return json(res, 400, { ok: false, error: '只能处理用过的中继站对话' });
      if (inUse && action !== 'unarchive') return json(res, 409, { ok: false, error: '这条还在当中继站用，先换一条再' + (action === 'delete' ? '删除' : '归档') + '。' });
      if (action === 'delete') { delete relayInfo[id]; P.relayUsed = P.relayUsed.filter(x => x !== id); pushSettings(); }
      else relayInfo[id].archived = action === 'archive';
      return json(res, 200, { ok: true });
    }
    const ids = [...new Set([P.relayThread, ...Object.values(P.relayByHost), ...P.relayUsed].filter(Boolean))];
    return json(res, 200, { shared: P.relayThread, byHost: P.relayByHost, warnAt: 150000, relays: ids.map(id => ({
      id, title: titleOf(id) || (relayInfo[id] || {}).title || '', missing: !relayInfo[id] && !titleOf(id), archived: false, updated: ago(900),
      model: '', effort: '', tokensUsed: 0, context: null, window: 0, ...(relayInfo[id] || {}), shared: id === P.relayThread, hosts: Object.keys(P.relayByHost).filter(h => P.relayByHost[h] === id) })) });
  }
  if (path === '/api/codex/hooks') {
    if (M === 'POST') { hooks = { ...hooks, installed: !!body.enable, working: !!body.enable && hooks.working, detail: body.enable ? '已安装，还没收到 Codex 的事件' : '没装' }; }
    return json(res, 200, hooks);
  }
  if (path.startsWith('/api/magpie/') && M === 'GET') {
    if (!magpieOn) return json(res, 502, { error: '连不上本机 magpie（假服务）' });
    const k = path.slice('/api/magpie/'.length);
    return magpie[k] ? json(res, 200, magpie[k]) : json(res, 404, { error: '没有' });
  }
  if (path === '/api/dispatch' && M === 'PUT') { lastDispatch = { ...body, updated: Date.now() }; return json(res, 200, { ok: true }); }
  if (path === '/api/dispatch/suggest' && M === 'POST') return json(res, 200, await suggestOf(String(body.text || ''), body.to));
  return json(res, 404, { error: '假服务没有这个接口' });
});
server.listen(PORT, '127.0.0.1', () => console.log(`假的 Pigeon 应用：http://127.0.0.1:${PORT}/`));
