#!/usr/bin/env node
// meerkat-codex：Claude 把活交给 Codex 时统一走这里。
// 读 Meerkat 的设置拼 codex exec 参数，处理 Codex 的老毛病（stdin 卡死、超时、噪音输出、图片不在项目里），
// 把执行过程实时报给 Meerkat，最后只把精简结果交还给 Claude。
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const PORT = Number(process.env.MEERKAT_PORT || 47321);
const HOME = os.homedir();
const STATE = path.join(HOME, '.meerkat');
const RUNS = path.join(STATE, 'runs');
const RUNNING = path.join(STATE, 'running');
const SETTINGS_FILE = path.join(HOME, 'Library/Application Support/Meerkat/settings.json');

const DEFAULTS = {
  preferForImages: true,
  imageMode: 'builtin',
  imageModel: 'gpt-image-2',
  imageQuality: 'medium',
  imageAspect: 'square',
  imageTransparent: false,
  imageDir: 'assets/generated',
  showInCodex: true,
  sessionMode: '', // 'keep' 保留到 Codex 应用 / 'temp' 临时任务；空着时按旧的 showInCodex
  autoOpen: false,
  routeAll: true, // 直接跑 codex exec 时拦下来，改走包装层（见 route-codex.mjs）
  model: '',
  effort: '',
  sandbox: 'auto',
  timeoutMin: 10,
  maxConcurrent: 2,
  summaryChars: 300,
};
const ASPECT = { square: '正方形（1:1）', landscape: '横版（3:2）', portrait: '竖版（2:3）' };
const KINDS = ['image', 'code', 'review', 'general'];

/* ---------- 小工具 ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const oneLine = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
const fmtDur = ms => (ms < 60000 ? `${Math.round(ms / 1000)} 秒` : `${Math.floor(ms / 60000)} 分 ${Math.round((ms % 60000) / 1000)} 秒`);

function request(method, p, body, timeout = 600) {
  return new Promise(resolve => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method, timeout,
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
const report = ev => request('POST', '/ev', { hook_event_name: 'MeerkatCodex', ts: Date.now(), ...ev }, 500);

async function loadSettings() {
  let raw = null, source = '默认值';
  const r = await request('GET', '/api/settings');
  if (r && r.status === 200 && r.json) { raw = r.json; source = 'Meerkat 应用'; }
  else {
    try { raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); source = '设置文件（应用没开）'; } catch {}
  }
  return { codex: { ...DEFAULTS, ...((raw && raw.codex) || {}) }, source, appOnline: !!r };
}

function codexBin() {
  const cands = [
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

const keepOf = s => (s.sessionMode ? s.sessionMode !== 'temp' : s.showInCodex !== false);

// Codex 默认用哪个模型：读 ~/.codex/config.toml 顶层的 model
function defaultModel() {
  try {
    const home = process.env.CODEX_HOME || path.join(HOME, '.codex');
    const text = fs.readFileSync(path.join(home, 'config.toml'), 'utf8');
    const top = text.split(/^\[/m)[0];
    return (/^model\s*=\s*"([^"]+)"/m.exec(top) || [])[1] || '';
  } catch { return ''; }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out._.push(argv.slice(i + 1).join(' ')); break; }
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next == null || next.startsWith('--')) out[k] = true;
      else { out[k] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

/* ---------- 并发：同时最多几个 Codex 任务 ---------- */
function liveRuns() {
  fs.mkdirSync(RUNNING, { recursive: true });
  return fs.readdirSync(RUNNING).filter(f => {
    const pid = Number(f.split('.')[0]);
    try { process.kill(pid, 0); return true; } catch { fs.rmSync(path.join(RUNNING, f), { force: true }); return false; }
  });
}
async function waitForSlot(max, taskId, deadline) {
  let told = false;
  while (liveRuns().length >= max) {
    if (!told) { process.stderr.write(`已有 ${max} 个 Codex 任务在跑，排队等待…\n`); told = true; }
    if (Date.now() > deadline) return false;
    await sleep(2000);
  }
  fs.writeFileSync(path.join(RUNNING, `${process.pid}.${taskId}`), String(Date.now()));
  return true;
}
function releaseSlot(taskId) { fs.rmSync(path.join(RUNNING, `${process.pid}.${taskId}`), { force: true }); }

/* ---------- 拼任务说明 ---------- */
function buildPrompt(kind, brief, s, cwd) {
  const parts = [brief.trim()];
  if (kind === 'image') {
    const dir = path.resolve(cwd, s.imageDir);
    const req = [`画面比例：${ASPECT[s.imageAspect] || ASPECT.square}`];
    if (s.imageTransparent) req.push('背景要真正透明（保留 alpha 通道）');
    let how = '用内置的图片生成能力（image_gen）生成。';
    if (s.imageMode === 'api') {
      how = process.env.OPENAI_API_KEY
        ? `用 imagegen 技能的 CLI 模式生成（用户已确认走 API），模型 ${s.imageModel}，质量 ${s.imageQuality}。`
        : '用内置的图片生成能力（image_gen）生成。';
    }
    parts.push(`\n生图要求：${how}${req.join('；')}。生成后把图片复制到 ${dir}（目录不存在就创建），文件名用简短的英文小写加连字符。`);
  }
  parts.push('\n完成后用简短中文回复：做了什么；产出了哪些文件（写绝对路径）；还有哪些地方没把握。不要提交 git，不要改任务没提到的文件。');
  return parts.join('\n');
}
function sandboxFor(kind, s) {
  if (s.sandbox && s.sandbox !== 'auto') return s.sandbox;
  return kind === 'review' || kind === 'general' ? 'read-only' : 'workspace-write';
}
// Codex 每一步的命令 → Meerkat 的动作
const cleanCommand = (cmd = '') => cmd.replace(/^\/bin\/(z|ba)?sh -lc\s+/, '').replace(/^['"]|['"]$/g, '').replace(/^rtk\s+/, '');
function activityOfCommand(cmd = '') {
  const c = cleanCommand(cmd);
  if (/\b(rg|grep|find|fd|ag)\b/.test(c)) return 'search';
  if (/\b(cat|sed|head|tail|less|read|ls|wc)\b/.test(c)) return 'read';
  if (/\b(test|jest|vitest|pytest|npm|pnpm|yarn|node|swift|make|cargo|go)\b/.test(c)) return 'run';
  if (/\b(cp|mv|mkdir|tee|apply_patch|patch)\b/.test(c)) return 'code';
  return 'tool';
}
const NOISE = /ignoring \d+ unrecognized configuration|unrecognized configuration settings|AuthRequired|rmcp::transport/i;

/* ---------- run ---------- */
async function run(args) {
  const kind = KINDS.includes(args.kind) ? args.kind : 'general';
  const cwd = path.resolve(args.cwd || process.cwd());
  let brief = args._.join(' ');
  if (args['brief-file']) brief = fs.readFileSync(args['brief-file'], 'utf8');
  if (!brief.trim()) { console.error('缺少任务说明：用 --brief-file <文件> 或在 -- 后面写。'); return 64; }

  const { codex: s, appOnline } = await loadSettings();
  const bin = codexBin();
  if (!bin) { console.log('Codex 不可用：没找到 codex 命令（ChatGPT 应用里自带的也没有）。请改用子代理或自己完成。'); return 3; }

  const taskId = 'mk-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const title = oneLine(args.title || brief.split('\n')[0], 28);
  const timeoutMs = Math.max(1, Number(s.timeoutMin) || 10) * 60000;
  const t0 = Date.now();

  fs.mkdirSync(RUNS, { recursive: true });
  if (!(await waitForSlot(Math.max(1, Number(s.maxConcurrent) || 2), taskId, t0 + timeoutMs))) {
    console.log(`Codex 排队超时：等了 ${s.timeoutMin} 分钟仍没有空位。`); return 2;
  }

  // 这次任务保不保留会话：命令行 --temp / --keep 优先，其次是设置
  const keep = args.temp ? false : args.keep ? true : keepOf(s);
  const model = s.model || defaultModel();
  const prompt = buildPrompt(kind, brief, s, cwd);
  const lastFile = path.join(RUNS, `${taskId}.last.md`);
  const logFile = path.join(RUNS, `${taskId}.jsonl`);
  const cliArgs = ['exec', '--json', '--skip-git-repo-check', '-C', cwd, '-s', sandboxFor(kind, s), '-o', lastFile];
  if (s.model) cliArgs.push('-m', s.model);
  if (s.effort) cliArgs.push('-c', `model_reasoning_effort="${s.effort}"`);
  if (!keep) cliArgs.push('--ephemeral');
  cliArgs.push(prompt);

  await report({ phase: 'start', task_id: taskId, title, kind, prompt: oneLine(brief, 160), cwd, model, temp: !keep });
  if (kind === 'image') report({ phase: 'activity', task_id: taskId, activity: 'image' });

  const log = fs.createWriteStream(logFile);
  // stdin 必须关掉，否则 codex exec 会一直等“更多输入”
  const child = spawn(bin, cliArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MEERKAT_TASK_ID: taskId } }); // Codex 自己的 hook 靠它认出是哪个任务
  let threadId = null, lastMsg = '', usage = null, timedOut = false, buf = '';
  const errs = [];
  const killer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000); }, timeoutMs);

  child.stdout.on('data', chunk => {
    log.write(chunk);
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'thread.started') { threadId = ev.thread_id; report({ phase: 'thread', task_id: taskId, thread_id: threadId }); }
      const it = ev.item || {};
      if (ev.type === 'item.started' && it.type === 'command_execution') {
        report({ phase: 'activity', task_id: taskId, activity: activityOfCommand(it.command), detail: oneLine(cleanCommand(it.command), 80) });
      }
      if (ev.type === 'item.started' && /image/.test(it.type || '')) report({ phase: 'activity', task_id: taskId, activity: 'image' });
      if (ev.type === 'item.completed' && it.type === 'agent_message') lastMsg = it.text || lastMsg;
      if (ev.type === 'item.completed' && it.type === 'error' && !NOISE.test(it.message || '')) errs.push(it.message);
      if (ev.type === 'turn.completed') usage = ev.usage || null;
      if (ev.type === 'turn.failed' || ev.type === 'error') errs.push(ev.error?.message || ev.message || JSON.stringify(ev));
    }
  });
  child.stderr.on('data', c => { const t = c.toString('utf8'); if (!NOISE.test(t) && /error|fatal/i.test(t) && !/rmcp/.test(t)) errs.push(oneLine(t, 200)); });
  const code = await new Promise(r => child.on('close', r));
  clearTimeout(killer);
  log.end();
  releaseSlot(taskId);

  try { const m = fs.readFileSync(lastFile, 'utf8').trim(); if (m) lastMsg = m; } catch {}
  const files = kind === 'image' ? collectImages(threadId, cwd, s, t0) : [];
  const ok = code === 0 && !timedOut;
  const status = ok ? 'done' : 'failed';
  const summary = oneLine(timedOut ? `超时：${s.timeoutMin} 分钟内没完成` : ok ? lastMsg : (errs[0] || lastMsg || `codex 退出码 ${code}`), Number(s.summaryChars) || 300);

  await report({ phase: 'end', task_id: taskId, status, summary, files, thread_id: threadId, usage, model });
  if (ok && threadId && keep && s.autoOpen) { try { execFileSync('open', [`codex://threads/${threadId}`]); } catch {} }

  const lines = [
    `${ok ? 'Codex 完成' : timedOut ? 'Codex 超时' : 'Codex 出错'}（用时 ${fmtDur(Date.now() - t0)}）`,
    `摘要：${summary || '（没有回复）'}`,
  ];
  if (files.length) lines.push(`产出文件：\n${files.map(f => '  ' + f).join('\n')}`);
  if (threadId) lines.push(keep ? `Codex 会话：codex://threads/${threadId}（保留在 Codex 应用里，可以接着聊）` : 'Codex 会话：临时任务，没有保留');
  if (usage) lines.push(`用量：输入 ${usage.input_tokens}（缓存 ${usage.cached_input_tokens || 0}），输出 ${usage.output_tokens}`);
  lines.push(`完整记录：${logFile}`);
  if (!appOnline) lines.push('提示：Meerkat 应用没开，这次没有画面，设置用的是保存的值或默认值。');
  console.log(lines.join('\n'));
  return ok ? 0 : timedOut ? 2 : 1;
}

// 生图产物：确认图片进了项目；Codex 没复制的，从 ~/.codex/generated_images/<会话id>/ 补复制过来。
function collectImages(threadId, cwd, s, t0) {
  const dir = path.resolve(cwd, s.imageDir);
  const isImg = f => /\.(png|jpe?g|webp|gif)$/i.test(f);
  const fresh = () => { try { return fs.readdirSync(dir).filter(isImg).map(f => path.join(dir, f)).filter(f => fs.statSync(f).mtimeMs >= t0 - 1000); } catch { return []; } };
  let out = fresh();
  if (!out.length && threadId) {
    const src = path.join(HOME, '.codex/generated_images', threadId);
    try {
      const imgs = fs.readdirSync(src).filter(isImg);
      if (imgs.length) fs.mkdirSync(dir, { recursive: true });
      imgs.forEach((f, i) => {
        const dst = path.join(dir, `codex-${threadId.slice(0, 8)}${imgs.length > 1 ? '-' + (i + 1) : ''}${path.extname(f)}`);
        fs.copyFileSync(path.join(src, f), dst);
      });
      out = fresh();
    } catch {}
  }
  return out;
}

/* ---------- 其他命令 ---------- */
async function settingsCmd() {
  const { codex: s, source } = await loadSettings();
  const lines = [
    `Codex 委派设置（来自${source}）：`,
    `- 生图优先交给 Codex：${s.preferForImages ? '是' : '否'}`,
    `- 生图方式：${s.imageMode === 'api' ? `API（模型 ${s.imageModel}，质量 ${s.imageQuality}${process.env.OPENAI_API_KEY ? '' : '；但没检测到 OPENAI_API_KEY，会退回内置方式'}）` : '内置 image_gen（不需要 key，模型和质量不可选）'}`,
    `- 图片比例：${ASPECT[s.imageAspect] || s.imageAspect}${s.imageTransparent ? '，透明背景' : ''}；保存到项目的 ${s.imageDir}/`,
    `- 对话记录：${keepOf(s) ? '保留到 Codex 应用' : '临时任务，不保留'}${keepOf(s) && s.autoOpen ? '（完成后自动打开）' : ''}；单次可用 --temp / --keep 改`,
    `- 统一走包装层：${s.routeAll !== false ? '是（直接跑 codex exec 会被拦下）' : '否'}`,
    `- 模型：${s.model || 'Codex 默认'}；推理档位：${s.effort || 'Codex 默认'}；沙箱：${s.sandbox === 'auto' ? '按任务类型自动' : s.sandbox}`,
    `- 超时 ${s.timeoutMin} 分钟；同时最多 ${s.maxConcurrent} 个；摘要最长 ${s.summaryChars} 字`,
  ];
  console.log(lines.join('\n'));
  return 0;
}
async function doctor() {
  const bin = codexBin();
  const app = await request('GET', '/api/detect');
  const lines = [
    `codex 命令：${bin || '没找到'}`,
    `Codex 登录：${fs.existsSync(path.join(HOME, '.codex/auth.json')) ? '已登录（有 auth.json）' : '没找到登录信息'}`,
    `Meerkat 应用：${app ? '在运行' : '没开（不影响调用，只是没有画面）'}`,
  ];
  if (app && app.json && app.json.codex) lines.push(`Codex 状态：${app.json.codex.detail}`);
  console.log(lines.join('\n'));
  return bin ? 0 : 3;
}

const HELP = `用法：
  meerkat-codex run --kind image|code|review|general --title "标题" [--cwd 目录] --brief-file 任务说明.md
  meerkat-codex run --kind review -- 直接写任务说明
  meerkat-codex settings   看当前的委派设置
  meerkat-codex doctor     检查 Codex 能不能用
  meerkat-codex open <会话id>   在 Codex 应用里打开对话`;

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
let code = 0;
if (cmd === 'run') code = await run(args);
else if (cmd === 'settings') code = await settingsCmd();
else if (cmd === 'doctor') code = await doctor();
else if (cmd === 'open' && args._[0]) { execFileSync('open', [`codex://threads/${args._[0]}`]); }
else { console.log(HELP); code = cmd ? 64 : 0; }
process.exit(code);
