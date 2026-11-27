// pigeon run：Claude 把活交给 Codex 时统一走这里。
// 读设置拼 codex exec 参数，处理 Codex 的老毛病（stdin 卡死、超时、噪音输出、图片不在项目里），
// 把执行过程实时报给 Pigeon 应用（PigeonRun 事件），最后只把精简结果交还给 Claude。
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { whyOf } from './meta.mjs';
import { dshBin, agyCliBin, agyHub, agentapiBin } from './agents.mjs';
import { pruneArtifacts } from './journal.mjs';
import { HOME, sleep, oneLine, fmtDur, request, emit, loadSettings, codexBin, codexHome, runsDir, runningDir, codexAppRunning } from './common.mjs';

const ASPECT = { square: '正方形（1:1）', landscape: '横版（3:2）', portrait: '竖版（2:3）' };
const KINDS = ['image', 'code', 'review', 'general'];
const report = ev => emit('PigeonRun', ev);

export const keepOf = s => (s.sessionMode ? s.sessionMode !== 'temp' : s.showInCodex !== false);
export const openWhenOf = s => (['start', 'end', 'never'].includes(s.openWhen) ? s.openWhen : s.autoOpen ? 'end' : 'never');
const OPEN_WHEN = { start: '（一开始就在 Codex 里打开，跑完前只能看）', end: '（做完后在 Codex 里打开）', never: '' };

// Codex 默认用哪个模型：读 ~/.codex/config.toml 顶层的 model
function defaultModel() {
  try {
    const text = fs.readFileSync(path.join(codexHome(), 'config.toml'), 'utf8');
    const top = text.split(/^\[/m)[0];
    return (/^model\s*=\s*"([^"]+)"/m.exec(top) || [])[1] || '';
  } catch { return ''; }
}

/* ---------- 并发：同时最多几个 Codex 任务 ---------- */
function liveRuns() {
  fs.mkdirSync(runningDir(), { recursive: true });
  return fs.readdirSync(runningDir()).filter(f => {
    const pid = Number(f.split('.')[0]);
    try { process.kill(pid, 0); return true; } catch { fs.rmSync(path.join(runningDir(), f), { force: true }); return false; }
  });
}
async function waitForSlot(max, taskId, deadline) {
  let told = false;
  while (liveRuns().length >= max) {
    if (!told) { process.stderr.write(`已有 ${max} 个 Codex 任务在跑，排队等待…\n`); told = true; }
    if (Date.now() > deadline) return false;
    await sleep(2000);
  }
  fs.writeFileSync(path.join(runningDir(), `${process.pid}.${taskId}`), String(Date.now()));
  return true;
}
function releaseSlot(taskId) { fs.rmSync(path.join(runningDir(), `${process.pid}.${taskId}`), { force: true }); }

/* ---------- 拼任务说明 ---------- */
export function buildPrompt(kind, brief, s, cwd) {
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
export function sandboxFor(kind, s) {
  if (s.sandbox && s.sandbox !== 'auto') return s.sandbox;
  return kind === 'review' || kind === 'general' ? 'read-only' : 'workspace-write';
}
// Codex 每一步的命令 → 画面上的动作
const cleanCommand = (cmd = '') => cmd.replace(/^\/bin\/(z|ba)?sh -lc\s+/, '').replace(/^['"]|['"]$/g, '').replace(/^rtk\s+/, '');
export function activityOfCommand(cmd = '') {
  const c = cleanCommand(cmd);
  if (/\b(rg|grep|find|fd|ag)\b/.test(c)) return 'search';
  if (/\b(cat|sed|head|tail|less|read|ls|wc)\b/.test(c)) return 'read';
  if (/\b(test|jest|vitest|pytest|npm|pnpm|yarn|node|swift|make|cargo|go)\b/.test(c)) return 'run';
  if (/\b(cp|mv|mkdir|tee|apply_patch|patch)\b/.test(c)) return 'code';
  return 'tool';
}
const NOISE = /ignoring \d+ unrecognized configuration|unrecognized configuration settings|AuthRequired|rmcp::transport/i;

/* ---------- run ---------- */
export async function run(args) {
  const kind = KINDS.includes(args.kind) ? args.kind : 'general';
  const cwd = path.resolve(args.cwd || process.cwd());
  let brief = args._.join(' ');
  if (args['brief-file']) brief = fs.readFileSync(args['brief-file'], 'utf8');
  if (!brief.trim()) { console.error('缺少任务说明：用 --brief-file <文件> 或在 -- 后面写。'); return 64; }

  const { codex: s, appOnline } = await loadSettings();
  const bin = codexBin();
  if (!bin) { console.log('Codex 不可用：没找到 codex 命令（ChatGPT 应用里自带的也没有）。请改用子代理或自己完成。'); return 3; }

  const taskId = 'pg-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const title = oneLine(args.title || brief.split('\n')[0], 28);
  const timeoutMs = Math.max(1, Number(s.timeoutMin) || 10) * 60000;
  const t0 = Date.now();

  fs.mkdirSync(runsDir(), { recursive: true });
  pruneArtifacts();
  if (!(await waitForSlot(Math.max(1, Number(s.maxConcurrent) || 2), taskId, t0 + timeoutMs))) {
    console.log(`Codex 排队超时：等了 ${s.timeoutMin} 分钟仍没有空位。`); return 2;
  }

  // 这次任务保不保留会话：命令行 --temp / --keep 优先，其次是设置
  const keep = args.temp ? false : args.keep ? true : keepOf(s);
  const openWhen = openWhenOf(s);
  const model = s.model || defaultModel();
  const prompt = buildPrompt(kind, brief, s, cwd);
  const metaFile = path.join(runsDir(), `${taskId}.meta.json`);
  const lastFile = path.join(runsDir(), `${taskId}.last.md`);
  const logFile = path.join(runsDir(), `${taskId}.jsonl`);
  const meta = {
    id: taskId,
    title,
    kind,
    prompt: oneLine(brief, 160),
    cwd,
    model: model || '',
    temp: !keep,
    status: 'running',
    started: t0,
    updated: t0,
    thread: '',
    detail: '',
    summary: '',
    files: [],
  };
  const saveMeta = (patch = {}) => {
    Object.assign(meta, patch, { updated: Date.now() });
    try {
      fs.mkdirSync(runsDir(), { recursive: true });
      const tmp = `${metaFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(meta));
      fs.renameSync(tmp, metaFile);
    } catch {}
  };
  const cliArgs = ['exec', '--json', '--skip-git-repo-check', '-C', cwd, '-s', sandboxFor(kind, s), '-o', lastFile];
  if (s.model) cliArgs.push('-m', s.model);
  if (s.effort) cliArgs.push('-c', `model_reasoning_effort="${s.effort}"`);
  if (!keep) cliArgs.push('--ephemeral');
  cliArgs.push(prompt);

  // 为什么交给它：指挥写的理由，加上应用按规则给的判断（应用没开就是 lead）
  const why = await whyOf(args.reason, brief, 'codex@local');
  saveMeta({ model: model || '' });
  await report({ phase: 'start', task_id: taskId, title, kind, prompt: oneLine(brief, 160), cwd, model, temp: !keep, why });
  if (kind === 'image') report({ phase: 'activity', task_id: taskId, activity: 'image' });

  const log = fs.createWriteStream(logFile);
  // stdin 必须关掉，否则 codex exec 会一直等“更多输入”
  // PIGEON_TASK_ID 给 Codex 自己的 hook 认任务
  const child = spawn(bin, cliArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PIGEON_TASK_ID: taskId } });
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
      if (ev.type === 'thread.started') {
        threadId = ev.thread_id; saveMeta({ thread: threadId }); report({ phase: 'thread', task_id: taskId, thread_id: threadId });
        // 一开始就打开：Codex 应用的列表不列 Pigeon 派的对话，只能靠链接打开；-g 不抢焦点
        if (keep && openWhen === 'start') { try { spawn('open', ['-g', `codex://threads/${threadId}`], { stdio: 'ignore', detached: true }).unref(); } catch {} }
      }
      const it = ev.item || {};
      if (ev.type === 'item.started' && it.type === 'command_execution') {
        const detail = oneLine(cleanCommand(it.command), 80);
        saveMeta({ detail });
        report({ phase: 'activity', task_id: taskId, activity: activityOfCommand(it.command), detail });
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

  saveMeta({ status, summary, files, thread: threadId || meta.thread, ended: Date.now(), ...(usage ? { usage } : {}), ...(model ? { model } : {}) });
  await report({ phase: 'end', task_id: taskId, status, summary, files, thread_id: threadId, usage, model });
  if (ok && threadId && keep && openWhen === 'end') { try { execFileSync('open', [`codex://threads/${threadId}`]); } catch {} }

  const lines = [
    `${ok ? 'Codex 完成' : timedOut ? 'Codex 超时' : 'Codex 出错'}（用时 ${fmtDur(Date.now() - t0)}）`,
    `摘要：${summary || '（没有回复）'}`,
  ];
  if (files.length) lines.push(`产出文件：\n${files.map(f => '  ' + f).join('\n')}`);
  if (threadId) lines.push(keep ? `Codex 会话：codex://threads/${threadId}（保留在 Codex 应用里，可以接着聊）` : 'Codex 会话：临时任务，没有保留');
  if (usage) lines.push(`用量：输入 ${usage.input_tokens}（缓存 ${usage.cached_input_tokens || 0}），输出 ${usage.output_tokens}`);
  lines.push(`完整记录：${logFile}`);
  if (!appOnline) lines.push('提示：Pigeon 应用没开，这次没有画面，设置用的是保存的值或默认值。');
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
    const src = path.join(codexHome(), 'generated_images', threadId);
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

/* ---------- settings / doctor ---------- */
export async function settingsCmd() {
  const { codex: s, post, source, raw } = await loadSettings();
  const d = (raw && raw.dispatch) || {}, rules = Array.isArray(d.rules) ? d.rules : [];
  // 生图交给谁：加过默认规则后看“生图、改图”那条（seed-image），之前看旧的开关
  const img = rules.find(r => r && r.id === 'seed-image');
  const imageLine = d.seeded
    ? `- 生图交给 Codex：${img && img.on !== false ? `是（分派规则“${img.when}”，${img.mode === 'must' ? '照做' : '建议'}）` : '否（分派规则里没开“生图、改图”那条）'}`
    : `- 生图优先交给 Codex：${s.preferForImages ? '是' : '否'}`;
  const lines = [
    `Pigeon 设置（来自${source}）：`,
    'Codex 派活（run）：',
    imageLine,
    `- 生图方式：${s.imageMode === 'api' ? `API（模型 ${s.imageModel}，质量 ${s.imageQuality}${process.env.OPENAI_API_KEY ? '' : '；但没检测到 OPENAI_API_KEY，会退回内置方式'}）` : '内置 image_gen（不需要 key，模型和质量不可选）'}`,
    `- 图片比例：${ASPECT[s.imageAspect] || s.imageAspect}${s.imageTransparent ? '，透明背景' : ''}；保存到项目的 ${s.imageDir}/`,
    `- 对话记录：${keepOf(s) ? '保留到 Codex 应用' : '临时任务，不保留'}${keepOf(s) ? OPEN_WHEN[openWhenOf(s)] : ''}；单次可用 --temp / --keep 改`,
    `- 统一走包装层：${s.routeAll !== false ? '是（直接跑 codex exec 会被拦下）' : '否'}`,
    `- 模型：${s.model || 'Codex 默认'}；推理档位：${s.effort || 'Codex 默认'}；沙箱：${s.sandbox === 'auto' ? '按任务类型自动' : s.sandbox}`,
    `- 超时 ${s.timeoutMin} 分钟；同时最多 ${s.maxConcurrent} 个；摘要最长 ${s.summaryChars} 字`,
    '送信（send / new）：',
    `- 中继站对话：${post.relayThread || '还没设置（远程发送要先 pigeon relay use <对话id|latest>）'}`,
    `- 往返上限：${post.maxHops} 程；等待超时：${post.waitTimeoutMin} 分钟`,
    `- 跨电脑发送前让你确认：${post.confirmRemote ? `是（在 Pigeon 面板里点“放行”才发，${post.crossTimeoutSec} 秒没人点就不发；应用没开时弹系统框）` : '否（直接发）'}`,
    `- 暂停：全部暂停或某台暂停时，消息先排着，继续后自己送出（最多排 ${post.pauseMaxMin} 分钟）`,
  ];
  console.log(lines.join('\n'));
  return 0;
}

function claudeSetup() {
  const claudeDir = path.join(HOME, '.claude');
  let cmd = '';
  for (const d of (process.env.PATH || '').split(':').filter(Boolean).concat([path.join(HOME, '.local/bin'), path.join(HOME, '.claude/local'), '/opt/homebrew/bin', '/usr/local/bin'])) {
    const p = path.join(d, 'claude');
    try { fs.accessSync(p, fs.constants.X_OK); cmd = p; break; } catch {}
  }
  const read = f => { try { return fs.readFileSync(path.join(claudeDir, f), 'utf8'); } catch { return ''; } };
  const plugin = /"pigeon(@|")/.test(read('plugins/installed_plugins.json')) || /forward\.sh/.test(read('settings.json') + read('settings.local.json'));
  return { cmd, plugin };
}

export async function doctor() {
  const bin = codexBin();
  const app = await request('GET', '/api/detect');
  const { post } = await loadSettings();
  const zstdOk = typeof zlib.zstdDecompressSync === 'function';
  const claude = claudeSetup();
  const dsh = dshBin();
  const agy = agyCliBin();
  const agyApp = agentapiBin();
  const agyLive = agyApp ? agyHub() : null;
  const lines = [
    `Node.js：${process.version}${zstdOk ? '' : '（提示：低于 v22.15，读取 DeepSeek Harness 对话需要 v22.15+）'}`,
    `Claude Code：${claude.cmd || '没找到命令'}；Pigeon 插件/hook：${claude.plugin ? '已配置' : '未检测到（请在 Claude Code 里安装 pigeon 插件）'}`,
    `codex 命令：${bin || '没找到'}`,
    `Codex 登录：${fs.existsSync(path.join(codexHome(), 'auth.json')) ? '已登录（有 auth.json）' : '没找到登录信息'}`,
    `Codex 桌面应用：${codexAppRunning() ? '在运行' : '没开（本机消息会排队等它打开；远程发送用不了）'}`,
    `DeepSeek Harness（dsh）：${dsh || '未检测到'}`,
    `Antigravity：命令行 agy ${agy || '未装'}；应用 agentapi ${agyApp ? (agyLive ? '在运行' : '已安装但未打开') : '未装'}`,
    `Pigeon 应用：${app ? '在运行' : '没开（不影响命令行调用，只是没有画面）'}`,
    `中继站：${post.relayThread || '还没设置'}（详细检查：pigeon relay check）`,
  ];
  if (app && app.json && app.json.codex) lines.push(`Codex 状态：${app.json.codex.detail}`);
  console.log(lines.join('\n'));
  return bin ? 0 : 3;
}

export { HOME };
