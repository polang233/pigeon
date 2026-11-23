// Pigeon 的公共小工具：路径、参数解析、和应用通信、读设置、找 codex 命令。
// 所有路径都可以用环境变量改，测试靠这个把读写引到临时目录，不碰真实的 ~/.codex 和 ~/.pigeon。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const HOME = os.homedir();
export const port = () => Number(process.env.PIGEON_PORT || process.env.MEERKAT_PORT || 47321);
export const pigeonDir = () => process.env.PIGEON_HOME || path.join(HOME, '.pigeon');
export const codexHome = () => process.env.CODEX_HOME || path.join(HOME, '.codex');
export const journalFile = () => path.join(pigeonDir(), 'journal.json');
export const loftsFile = () => path.join(pigeonDir(), 'lofts.json');
export const runsDir = () => path.join(pigeonDir(), 'runs');
export const runningDir = () => path.join(pigeonDir(), 'running');
const APP_SUPPORT = path.join(HOME, 'Library/Application Support');
export const settingsFiles = () => process.env.PIGEON_SETTINGS_FILE
  ? [process.env.PIGEON_SETTINGS_FILE]
  : [path.join(APP_SUPPORT, 'Pigeon/settings.json'), path.join(APP_SUPPORT, 'Meerkat/settings.json')];

export const LOCAL = 'local';
export const LOCAL_NAME = '这台 Mac';

/* ---------- 文字 ---------- */
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const oneLine = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
// 预览按字符（不是字节）截断，中文一个字算一个
export const clip = (s, n) => {
  const chars = Array.from(String(s || '').replace(/\s+/g, ' ').trim());
  return chars.length > n ? chars.slice(0, n - 1).join('') + '…' : chars.join('');
};
export const fmtDur = ms => (ms < 60000 ? `${Math.round(ms / 1000)} 秒` : `${Math.floor(ms / 60000)} 分 ${Math.round((ms % 60000) / 1000)} 秒`);
export const fingerprint = text => crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16);
export const newBand = () => 'b-' + crypto.randomBytes(5).toString('hex');
export const isBand = s => /^b-[0-9a-f]{10}$/.test(String(s || ''));

/* ---------- 参数 ---------- */
// --k v / --k=v / --flag / -n 20 / -- 后面整体算正文。flags 里列的键永远是开关，不吃后面的参数。
export const BOOL_FLAGS = ['wait', 'refresh', 'temp', 'keep', 'json', 'help', 'h', 'all', 'stdin'];
export function parseArgs(argv, flags = BOOL_FLAGS) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { const rest = argv.slice(i + 1).join(' '); if (rest) out._.push(rest); break; }
    let k = null;
    if (a.startsWith('--') && a.length > 2) k = a.slice(2);
    else if (/^-[a-zA-Z]$/.test(a)) k = a.slice(1);
    if (k == null) { out._.push(a); continue; }
    const eq = k.indexOf('=');
    if (eq > 0) { out[k.slice(0, eq)] = k.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (flags.includes(k) || next == null || next === '--' || /^--?[a-zA-Z]/.test(next)) out[k] = true;
    else { out[k] = next; i++; }
  }
  return out;
}

/* ---------- 和应用通信 ---------- */
export function request(method, p, body, timeout = 600) {
  return new Promise(resolve => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port: port(), path: p, method, timeout,
      headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {} }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, json: JSON.parse(text) }); } catch { resolve({ status: res.statusCode, json: null }); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    if (data) req.write(data);
    req.end();
  });
}
export const emit = (name, ev) => request('POST', '/ev', { hook_event_name: name, ts: Date.now(), ...ev }, 500);

/* ---------- 设置 ---------- */
export const CODEX_DEFAULTS = {
  preferForImages: true,
  imageMode: 'builtin',
  imageModel: 'gpt-image-2',
  imageQuality: 'medium',
  imageAspect: 'square',
  imageTransparent: false,
  imageDir: 'assets/generated',
  showInCodex: true,
  sessionMode: '', // 'keep' 保留到 Codex 应用 / 'temp' 临时任务；空着时按旧的 showInCodex
  autoOpen: false, // 旧字段：true 等于 openWhen 'end'
  openWhen: '', // 什么时候在 Codex 应用里打开这段对话：'start' 一开始 / 'end' 做完 / 'never' 不打开；空着时按旧的 autoOpen
  routeAll: true, // 直接跑 codex exec 时拦下来，改走包装层（见 route-codex.mjs）
  model: '',
  effort: '',
  sandbox: 'auto',
  timeoutMin: 10,
  maxConcurrent: 2,
  summaryChars: 300,
};
// crossTimeoutSec：跨设备发送等用户确认多少秒；pauseMaxMin：暂停时一条消息最多排多久（插件自己的约定，见 post.mjs）
export const POST_DEFAULTS = { relayThread: '', maxHops: 10, waitTimeoutMin: 10, confirmRemote: true, crossTimeoutSec: 90, pauseMaxMin: 120 };
export const SECRETS_MODES = ['warn', 'mask', 'off'];

export function readSettingsFile() {
  for (const f of settingsFiles()) {
    try { return { raw: JSON.parse(fs.readFileSync(f, 'utf8')), file: f }; } catch {}
  }
  return { raw: null, file: '' };
}

// 暂停：直接读设置文件（应用写的），不经应用。目标设备被暂停，或者全部暂停，就算暂停。
export function isPaused(loft) {
  const p = (readSettingsFile().raw || {}).paused || {};
  return p.all === true || !!(p.lofts && p.lofts[loft] === true);
}

export async function loadSettings() {
  let raw = null, source = '默认值';
  const r = await request('GET', '/api/settings');
  if (r && r.status === 200 && r.json && typeof r.json === 'object') { raw = r.json; source = 'Pigeon 应用'; }
  else {
    const f = readSettingsFile();
    if (f.raw) { raw = f.raw; source = '设置文件（应用没开）'; }
  }
  const post = { ...POST_DEFAULTS, ...((raw && raw.post) || {}) };
  post.maxHops = Math.max(1, Number(post.maxHops) || POST_DEFAULTS.maxHops);
  post.waitTimeoutMin = Math.max(0.05, Number(post.waitTimeoutMin) || POST_DEFAULTS.waitTimeoutMin);
  post.confirmRemote = post.confirmRemote !== false; // 只有明确写 false 才关
  post.crossTimeoutSec = Math.max(1, Number(post.crossTimeoutSec) || POST_DEFAULTS.crossTimeoutSec);
  post.pauseMaxMin = Math.max(0.02, Number(post.pauseMaxMin) || POST_DEFAULTS.pauseMaxMin);
  const mode = raw && raw.secrets && raw.secrets.mode;
  const secrets = { mode: SECRETS_MODES.includes(mode) ? mode : 'warn' };
  return { codex: { ...CODEX_DEFAULTS, ...((raw && raw.codex) || {}) }, post, secrets, raw: raw || {}, source, appOnline: !!r };
}

// 改一处设置。应用开着时走 PUT（应用负责写文件和广播）；没开时直接改设置文件，
// 新文件不存在而旧的 Meerkat 文件存在时，先按迁移规则把旧内容带过来，免得应用以后跳过迁移。
export async function patchSettings(mutate) {
  const r = await request('GET', '/api/settings');
  if (r && r.status === 200 && r.json && typeof r.json === 'object') {
    const next = structuredClone(r.json);
    mutate(next);
    const w = await request('PUT', '/api/settings', next, 2000);
    if (w && w.status === 200) return { ok: true, where: 'Pigeon 应用' };
    return { ok: false, where: 'Pigeon 应用', error: '应用拒绝保存设置' };
  }
  const files = settingsFiles();
  const target = files[0];
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(target, 'utf8')); }
  catch { for (const f of files.slice(1)) { try { raw = JSON.parse(fs.readFileSync(f, 'utf8')); break; } catch {} } }
  if (!raw || typeof raw !== 'object') raw = {};
  if (raw.version == null) raw.version = 1;
  mutate(raw);
  writeJsonAtomic(target, raw);
  return { ok: true, where: target };
}

export function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}
export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/* ---------- Codex ---------- */
export function codexBin() {
  const cands = [
    process.env.PIGEON_CODEX_BIN,
    process.env.MEERKAT_CODEX_BIN,
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
    '/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex',
    '/opt/homebrew/bin/codex', '/usr/local/bin/codex', path.join(HOME, '.local/bin/codex'),
  ].filter(Boolean);
  for (const c of cands) { try { fs.accessSync(c, fs.constants.X_OK); return c; } catch {} }
  for (const dir of (process.env.PATH || '').split(':')) {
    const c = path.join(dir, 'codex');
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch {}
  }
  return null;
}

// Codex 桌面应用开着没有。本机的 Codex 在 ChatGPT.app 里，也可能是单独的 Codex.app。
export function codexAppRunning() {
  if (process.env.PIGEON_APP_RUNNING === '1') return true;
  if (process.env.PIGEON_APP_RUNNING === '0') return false;
  try {
    execFileSync('pgrep', ['-f', '(ChatGPT|Codex)\\.app/Contents/MacOS/(ChatGPT|Codex)$'], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// 发件人：在 Claude Code 里跑时是 claude，否则当成用户自己。cwd 是发件那个对话的项目目录，应用按它把消息归进频道
export function sender() {
  const sid = process.env.CLAUDE_CODE_SESSION_ID || '';
  return sid ? { loft: LOCAL, agent: 'claude', session: sid, title: '', cwd: process.cwd() } : { loft: LOCAL, agent: 'you', session: '', title: '' };
}
