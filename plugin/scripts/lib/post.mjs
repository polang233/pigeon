// 送信：send / new / wait / read / log / lofts / relay，以及后台看护进程（_watch）。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  LOCAL, LOCAL_NAME, sleep, clip, oneLine, fmtDur, fingerprint, newBand, isBand, emit, loadSettings, patchSettings,
  codexBin, codexAppRunning, pidAlive, sender, isRelayFrom, isPaused, POST_DEFAULTS, pigeonDir, HOME,
} from './common.mjs';
import { addNote, getNote, patchNote, recent, TERMINAL, STATE_ZH } from './journal.mjs';
import { readFrom, fileSize, findRollout, localProgress, digest, turnForBand } from './rollout.mjs';
import { sendInstruction, newInstruction, fetchInstruction, loftsInstruction, relayProgress, loftsProgress, remoteLofts, toolFacts, parseRelayReply } from './relay.mjs';
import { getThread, latestRelayCandidate, listThreads, listProjects } from './codex-state.mjs';
import { relayFor, relayIds, isRelay, useRelay, forgetRelay, relayRows, RELAY_WARN_TOKENS } from './relays.mjs';
import { DSH, AGY, AGENT_NAME, AGY_TIERS, HINT_AGY, agyModelsCached, agySlug, agentOfArg, dshBin, dshArgs, dshEvent, dshSessionInfo, findDshSession, agentapiBin, agyHub, agyNew, agySend, agyList, agySteps, agyAnswer, agyWaiting, agyCliBin, agyCliArgs, agyCliInput, agyCliEvent, agyDenials, agyCliSessions, AGY_CLI_MODES } from './agents.mjs';
import { readLofts, saveLofts, resolveTarget, findLoft, resolveProject } from './lofts.mjs';
import { confirmRemote, deniedError, timeoutError } from './confirm.mjs';
import { detectSecrets, maskSecrets } from './secrets.mjs';
import { askApp, whyOf, ctxOf, toKeyOf } from './meta.mjs';

export const PIGEON_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pigeon.mjs');
const pollMs = () => Number(process.env.PIGEON_POLL_MS) || 2000;
const ago = ms => fmtDur(Math.max(0, ms));
const say = (...l) => console.log(l.join('\n'));
const HINT_APP = 'Codex 桌面应用没开：请先打开 ChatGPT 应用（里面的 Codex），再重新发送。';
const HINT_RELAY_UNSET = '还没有设置中继站：请在 Codex 应用里手动新建一条对话（随便发一句“中转用”），然后运行 pigeon relay use latest。';
// create_thread 的 thinking 字段能取的值；具体模型支持哪几档，由对方主机在建对话时校验。
export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const HINT_RELAY_NEVER = '中继站对话的审批策略是 never（多半是 codex exec 建的），不能替你发到远程。请在 Codex 应用里手动新建一条对话，再运行 pigeon relay use <对话id>。';

/* ---------- 输出 ---------- */
// --json 时标准输出只有最后那一行 JSON，别的文字（包括标准错误）一概不写；退出码照旧。
// 没编号（消息还没建就失败了）时 band 是空串。
function makeOut(args) {
  const json = !!args.json;
  return {
    json,
    say: (...l) => { if (!json) say(...l); },
    err: (...l) => { if (!json) console.error(l.join('\n')); },
    done(code, res) { if (json) console.log(JSON.stringify(res)); return code; },
    // 用法错误、前置条件不满足（还没建消息）
    usage(code, msg) { if (json) console.log(JSON.stringify({ ok: false, band: '', error: msg })); else console.error(msg); return code; },
    // 前置条件不满足，打印在标准输出（老行为），没有消息
    notReady(code, msg) {
      if (json) console.log(JSON.stringify({ ok: false, band: '', state: 'refused', reason: 'offline', error: msg })); else say(msg);
      return code;
    },
    refused(note, error, reason) {
      if (!json) say(`没发出：${error}`, `编号 ${note.band}`);
      return this.done(1, { ok: false, band: note.band, state: 'refused', reason, error });
    },
  };
}

/* ---------- 消息和事件 ---------- */
const FOOTER_FROM = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', deepseek: 'DeepSeek Harness', antigravity: 'Antigravity' };
export function footer(band, from) {
  const who = FOOTER_FROM[from.agent] || '用户';
  return `\n\n（Pigeon 纸条 ${band}，来自${LOCAL_NAME}上的 ${who}。回信直接写在这一轮的最终回复里就行。）`;
}

// 事件：老字段不变，新字段（reason、retry_of、paused、why、ctx）只是加上去
export function eventOf(note, extra = {}) {
  return {
    band: note.band, chain: note.chain, count: note.count, kind: note.kind, via: note.via, state: note.state,
    from: note.from, to: { loft: note.to.loft, loft_name: note.to.loft_name, agent: note.to.agent, session: note.to.session, title: note.to.title },
    preview: '', answer_preview: '', error: note.error || '', progress: note.progress || '',
    reason: note.reason || '', retry_of: note.retry_of || '', paused: !!note.paused,
    model: note.model || '', effort: note.effort || '',
    ...(note.why ? { why: note.why } : {}), ...(note.ctx ? { ctx: note.ctx } : {}),
    ...extra,
  };
}
const report = (note, extra) => emit('PigeonNote', eventOf(note, extra));

// DSH、Antigravity 的回信：它们的对话记录不像 Codex 那样好按编号找，看护进程拿到回复时存一份，只在本机、只有自己能读
export const answersDir = () => path.join(pigeonDir(), 'answers');
export function saveAnswer(band, text) {
  try { fs.mkdirSync(answersDir(), { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(answersDir(), band + '.md'), String(text), { mode: 0o600 }); } catch {}
}
export const readAnswer = band => { try { return fs.readFileSync(path.join(answersDir(), band + '.md'), 'utf8'); } catch { return ''; } };
// 发出去的正文也存一份（打码以后的样子），应用里的任务详情、频道能看全文。只在本机、只有自己能读，和回信放在一起
export const bodiesDir = () => path.join(pigeonDir(), 'bodies');
export function saveBody(band, text) {
  try { fs.mkdirSync(bodiesDir(), { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(bodiesDir(), band + '.md'), String(text), { mode: 0o600 }); } catch {}
}
export const readBody = band => { try { return fs.readFileSync(path.join(bodiesDir(), band + '.md'), 'utf8'); } catch { return ''; } };
// 看护进程自己跑的几种：codex exec 新开、DSH、Antigravity
const OWN_WATCH = ['exec', 'dsh', 'agy', 'agycli'];

// 链：--reply-to 沿用同一条链，count + 1
export function chainFor(replyTo, lookup = getNote) {
  if (!replyTo) return { chain: '', count: 1, parent: null, warn: '' };
  const parent = lookup(replyTo);
  if (parent) return { chain: parent.chain || parent.band, count: (Number(parent.count) || 1) + 1, parent, warn: '' };
  return { chain: replyTo, count: 2, parent: null, warn: `任务记录里没有 ${replyTo}（可能是别的电脑发的），按第 2 程计。` };
}
export const overHops = (count, maxHops) => count > maxHops;
// 看护进程最多跟多久。经中继站的要多留几分钟：中继站自己也要等 waitTimeoutMin，再加上它排队和跑模型的时间
export const deadlineOf = (note, post, from = note.created) => from + (post.waitTimeoutMin + (note.via === 'relay' ? 3 : 0)) * 60000;

// model、effort：pigeon new 指定的模型和思考强度，没指定是空串；extra：retry_of、why、ctx 这些新增的字段
export function makeNote({ band, kind, replyTo, chain, count, from, to, via, text, now = Date.now(), track = {}, model = '', effort = '', extra = {} }) {
  return {
    band, chain: chain || band, count, kind, reply_to: replyTo || '', model, effort,
    from, to: { loft: to.loft, loft_name: to.loft_name || (to.loft === LOCAL ? LOCAL_NAME : ''), agent: to.agent || 'codex', session: to.session || '', title: to.title || '' },
    via, state: 'queued', created: now, updated: now, fingerprint: fingerprint(text), error: '', ...extra, track,
  };
}

// 状态变了才发事件；force 时即使状态没变（比如只是标上暂停）也发一条
async function move(band, patch, extra, force = false) {
  const r = await patchNote(band, patch);
  if (r && (r.moved || force)) await report(r.note, extra);
  return r ? r.note : getNote(band);
}

async function refuseNew(note, error, reason, preview) {
  note.state = 'refused'; note.error = error; note.reason = reason;
  await addNote(note);
  await report(note, { preview });
  return note;
}

// 这几类附加信息从命令行来：--retry-of、--ctx-*、--reason（why 在问过应用之后才补全）
function extrasOf(args, text) {
  const extra = { ctx: ctxOf(args, text), why: { kind: 'lead', reason: typeof args.reason === 'string' ? args.reason.trim() : '' } };
  if (typeof args['retry-of'] === 'string' && args['retry-of']) extra.retry_of = args['retry-of'];
  return extra;
}

/* ---------- 跑 codex queue ---------- */
// 排进队列的消息，只有 Codex 桌面应用已经载入那条对话时才会被接手。
// 实测（2026-11-11）：没在应用里打开过的对话会一直排着；用唤醒链接让应用载入它，十几秒内就会开工。
// -g：不把 Codex 应用拉到前台。
export function wakeThread(threadId) {
  if (process.env.PIGEON_NO_WAKE || process.platform !== 'darwin') return;
  try { spawn('open', ['-g', `codex://threads/wake/${threadId}`], { stdio: 'ignore', detached: true }).unref(); } catch {}
}

export function codexQueue(bin, threadId, message) {
  const r = spawnSync(bin, ['queue', '--thread', threadId, '--message', message], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const m = /Queued message (\S+) for thread (\S+)/.exec(out);
  if (r.status === 0 && m) { wakeThread(threadId); return { ok: true, queueId: m[1] }; }
  const why = (r.error && r.error.message) || out.split('\n').map(s => s.trim()).filter(s => s && !/unrecognized configuration|rmcp/i.test(s)).slice(-1)[0] || `退出码 ${r.status}`;
  return { ok: false, error: 'codex queue 没排上：' + oneLine(why, 200) };
}

// 后台看护进程。body 是要交给它的东西（JSON 文字，只走标准输入，不落盘）：暂停中排着的、本机新开对话的，都靠它。
function spawnWatcher(band, body) {
  const child = spawn(process.execPath, [PIGEON_SCRIPT, '_watch', band], {
    detached: true, stdio: [body == null ? 'ignore' : 'pipe', 'ignore', 'ignore'], env: process.env,
  });
  child.unref();
  if (body == null) return Promise.resolve(child.pid);
  return new Promise(r => child.stdin.end(body, () => r(child.pid)));
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

// 正文：--stdin 从标准输入读（不出现在命令行里），--file 读文件，否则是命令行上的文字
async function bodyOf(args) {
  if (args.stdin) { try { return await readStdin(); } catch (e) { return { error: '读不了标准输入：' + e.message }; } }
  if (args.file) { try { return fs.readFileSync(String(args.file), 'utf8'); } catch (e) { return { error: '读不到消息文件：' + e.message }; } }
  return args._.join(' ');
}

/* ---------- 中继站 ---------- */
// host：往哪台远程主机发。那台单独指定了中继站就用它的，没有用共用的
export function relayStatus(post, host = '') {
  const id = relayFor(post, host);
  if (!id) return { ok: false, error: HINT_RELAY_UNSET };
  const t = getThread(id);
  if (!t) return { ok: false, error: `中继站对话 ${id} 在本机没找到（可能删了）。` + HINT_RELAY_UNSET.slice(HINT_RELAY_UNSET.indexOf('请')) };
  if (t.archived) return { ok: false, thread: t, error: `中继站对话「${t.title}」已经归档。请换一条：pigeon relay use <对话id>` };
  if (t.approval === 'never') return { ok: false, thread: t, error: HINT_RELAY_NEVER };
  return { ok: true, thread: t };
}

/* ---------- 跨电脑发送前：查密钥、问用户 ---------- */
// 按设置里的 secrets.mode 处理正文。只用于跨设备发送，本机的不查。
// warn：原文不动，把类别告诉用户让他选；mask：直接打码；off：不查。
export function screenText(text, mode) {
  if (mode === 'mask') { const m = maskSecrets(text); return { text: m.text, kinds: [], masked: m.kinds }; }
  if (mode === 'warn') return { text, kinds: detectSecrets(text), masked: [] };
  return { text, kinds: [], masked: [] };
}

// 问用户。先问 Pigeon 应用（它的面板里排队等用户决定），问不通才退回系统对话框。
// 返回 { ok: true, text } 可以发（text 是最终要发的正文）；或 { ok: false, reason, error }。
// 说明：弹不出系统框（不是 macOS、osascript 出错）时没人能确认，按"没人理"算，reason 记 timeout。
// kind：cross 跨设备发送；relay 接活的 agent 往下转派（本机的也问），两种共用同一个等待时间
async function askUser(note, post, sc, text, project, o, kind = 'cross') {
  const preview = clip(sc.text, 80);
  o.err(`等用户在 Pigeon 里确认（最多 ${post.crossTimeoutSec} 秒）……`);
  const act = await askApp({
    kind, band: note.band, from: note.from, to: note.to, preview, text: sc.text, files: (note.ctx && note.ctx.files) || [],
    project, rule: (note.why && note.why.rule) || '', secrets: sc.kinds, timeoutSec: post.crossTimeoutSec,
  });
  if (act === 'release') return { ok: true, text: sc.text };
  if (act === 'release_masked') return { ok: true, text: maskSecrets(sc.text).text };
  if (act === 'block') return { ok: false, reason: 'blocked', error: deniedError() };
  if (act === 'timeout') return { ok: false, reason: 'timeout', error: timeoutError(post.crossTimeoutSec, 'Pigeon 里') };
  // 应用没开、请求失败或连接断了：退回系统对话框
  const c = confirmRemote({ band: note.band, from: note.from, kind: note.kind, ask: kind, to: note.to, project, text: sc.text, secrets: sc.kinds }, post.crossTimeoutSec);
  if (c.ok) return { ok: true, text: sc.text };
  return { ok: false, reason: c.reason === 'denied' ? 'blocked' : 'timeout', error: c.error };
}

// 发之前要不要问你、问哪一种：跨设备（cross）按“跨电脑发送前问我”；本机的按“接活的 agent 往下转派前问我”
function askKindOf(via, from, raw, post) {
  if (via === 'relay') return post.confirmRemote ? 'cross' : (post.askRelay && isRelayFrom(from, raw) ? 'relay' : '');
  return post.askRelay && isRelayFrom(from, raw) ? 'relay' : '';
}

/* ---------- 真正送出 ---------- */
// d 说明送什么、送去哪：
//   { type: 'local', session, message }   本机已有对话，codex queue
//   { type: 'relay', instr, track }       经中继站，instr 是给中继站的完整指令
//   { type: 'exec', message, cwd, model, effort }  本机新开对话，由看护进程跑 codex exec（不走这里）
// 成功返回 { ok: true }，状态已是 flying；失败时消息已记成没发出，返回 { ok: false, reason, error }。
async function deliver(note, d, post) {
  const band = note.band;
  const fail = async (reason, error) => { await move(band, { state: 'refused', reason, error }); return { ok: false, reason, error }; };
  const bin = codexBin();
  if (!bin) return fail('offline', '没找到 codex 命令（ChatGPT 应用里自带的也没有）。');
  if (d.type === 'local') {
    const rollout = (getThread(d.session) || {}).rollout || findRollout(d.session);
    await patchNote(band, { track: { rollout, offset: fileSize(rollout) } });
    const q = codexQueue(bin, d.session, d.message);
    if (!q.ok) return fail('no_target', q.error);
    await move(band, { state: 'flying', track: { queue_id: q.queueId } });
    return { ok: true };
  }
  const rs = relayStatus(post, note.to.loft);
  if (!rs.ok) return fail('offline', rs.error);
  if (!codexAppRunning()) return fail('offline', HINT_APP);
  const relayRollout = rs.thread.rollout || findRollout(rs.thread.id);
  await patchNote(band, { track: { relay_thread: rs.thread.id, relay_rollout: relayRollout, relay_offset: fileSize(relayRollout), ...(d.track || {}) } });
  const q = codexQueue(bin, rs.thread.id, d.instr);
  if (!q.ok) return fail('offline', q.error);
  await move(band, { state: 'flying', track: { queue_id: q.queueId } });
  return { ok: true };
}

// 排好的消息放出去：暂停中就记成 queued + paused 交给看护进程等；否则马上送。
// 返回 { ok: true } | { ok: true, paused: true } | { ok: false, reason, error }
async function launch(note, d, post) {
  const band = note.band;
  if (isPaused(note.to.loft)) {
    await move(band, { paused: true, track: { pause_until: Date.now() + post.pauseMaxMin * 60000 } }, undefined, true);
    const pid = await spawnWatcher(band, JSON.stringify(d));
    await patchNote(band, { track: { watcher: pid } });
    return { ok: true, paused: true };
  }
  if (OWN_WATCH.includes(d.type)) {
    const pid = await spawnWatcher(band, JSON.stringify(d));
    await patchNote(band, { track: { watcher: pid } });
    return { ok: true };
  }
  const r = await deliver(note, d, post);
  if (!r.ok) return r;
  const pid = await spawnWatcher(band);
  await patchNote(band, { track: { watcher: pid } });
  return { ok: true };
}

const pausedText = (band, post) => [`消息已排上，编号 ${band}`,
  `Pigeon 现在是暂停的，这条消息先排着，继续之后会自己送出，不用重发（最多排 ${post.pauseMaxMin} 分钟，超过就不发了）。`,
  `看进展：node "${PIGEON_SCRIPT}" read ${band}`];

/* ---------- send ---------- */
export async function sendCmd(args) {
  const o = makeOut(args);
  const text = await bodyOf(args);
  if (typeof text !== 'string') return o.usage(64, text.error);
  if (!text.trim()) return o.usage(64, '消息是空的：pigeon send --to <对话> "要说的话"（或 --file <文件>、--stdin）');
  if (args.model || args.effort) return o.usage(64, '已有对话换不了模型和思考强度。要指定，请用 pigeon new 新开一条对话。');
  const { post, secrets, raw } = await loadSettings();
  const from = sender();
  const { chain, count, warn } = chainFor(args['reply-to']);
  const band = newBand();
  if (warn) o.err(warn);

  const res = resolveTarget(args.to);
  if (!res.ok && !res.notFound) {
    o.usage(64, res.error);
    if (res.candidates) o.err(res.candidates.slice(0, 8).map(c => `  ${c.id}  ${c.title || ''}`).join('\n'));
    return 64;
  }
  const to = res.ok ? res.target : { loft: LOCAL, loft_name: LOCAL_NAME, session: '', title: String(args.to || '') };
  const via = to.loft === LOCAL ? 'queue' : 'relay';
  const extra = extrasOf(args, text);
  const note = makeNote({ band, kind: 'send', replyTo: args['reply-to'], chain, count, from, to, via, text, extra, track: { asker: process.pid } });
  if (!res.ok) { await refuseNew(note, res.error, 'no_target', clip(text, 80)); return o.refused(note, res.error, 'no_target'); }
  if (overHops(count, post.maxHops)) {
    const err = `这条链已经传了 ${count - 1} 次，超过往返上限 ${post.maxHops}，为防止 agent 互相无限传话，不再发送。`;
    await refuseNew(note, err, 'max_hops', clip(text, 80)); return o.refused(note, err, 'max_hops');
  }
  if (to.agent === DSH || to.agent === AGY) return launchOther(o, note, { agent: to.agent, session: to.session, cwd: to.cwd || '', via: to.via || '', mode: sandboxArg(args) }, post, args, text);
  const bin = codexBin();
  if (!bin) return o.notReady(3, 'Codex 不可用：没找到 codex 命令（ChatGPT 应用里自带的也没有）。');

  let d, sc = { text, kinds: [], masked: [] };
  if (via === 'queue') {
    if (isRelay(post, to.session)) return o.usage(64, '这条是中继站对话，不能直接给它发消息。');
    if (to.archived) { const e = `对话「${to.title}」已归档，对方收不到。`; await refuseNew(note, e, 'no_target', clip(text, 80)); return o.refused(note, e, 'no_target'); }
  } else {
    const rs = relayStatus(post, to.loft);
    if (!rs.ok) return o.notReady(3, rs.error);
    if (!codexAppRunning()) return o.notReady(3, HINT_APP);
    sc = screenText(text, secrets.mode);
  }

  note.why = await whyOf(args.reason, text, toKeyOf(to));
  note.track.deadline = deadlineOf(note, post);
  if (via === 'relay') Object.assign(note.track, { host: to.loft });
  const askKind = askKindOf(via, from, raw, post);
  const needAsk = !!askKind;
  note.state = needAsk ? 'asking' : 'queued';
  await addNote(note);
  saveBody(note.band, sc.text);
  await report(note, { preview: clip(sc.text, 80) });
  if (sc.masked.length) o.err(`已按设置自动打码：${sc.masked.join('、')}。`);

  let sendText = sc.text;
  if (needAsk) {
    const a = await askUser(note, post, sc, text, '', o, askKind);
    if (!a.ok) { await move(band, { state: 'refused', reason: a.reason, error: a.error }); return o.refused(note, a.error, a.reason); }
    sendText = a.text;
    await move(band, { state: 'queued' });
  }
  const message = sendText.trimEnd() + footer(band, from);
  d = via === 'queue'
    ? { type: 'local', session: to.session, message }
    : { type: 'relay', instr: sendInstruction({ band, threadId: to.session, hostId: to.loft, title: to.title, loftName: to.loft_name, body: message, waitMin: post.waitTimeoutMin }) };

  const r = await launch(note, d, post);
  if (!r.ok) return o.refused(note, r.error, r.reason);
  if (r.paused) { o.say(...pausedText(band, post)); return o.done(0, { ok: true, band, state: 'queued', paused: true }); }
  const warnApp = via === 'queue' && !codexAppRunning() ? '\n提示：Codex 桌面应用没开，消息会一直排着队，打开应用后才会被接手。' : '';
  o.say(`消息已发出，编号 ${band}`,
    `收件人：${to.title || to.session}${to.loft === LOCAL ? '（本机）' : `@${to.loft_name}（经中继站转发，会跑一轮模型，有 token 成本）`}` + warnApp,
    `等回信：node "${PIGEON_SCRIPT}" wait ${band}　读回信：node "${PIGEON_SCRIPT}" read ${band}`);
  if (args.wait && !o.json) return waitCmd({ _: [band], timeout: args.timeout });
  return o.done(0, { ok: true, band, state: 'flying' });
}

/* ---------- new ---------- */
export async function newCmd(args) {
  const o = makeOut(args);
  const text = await bodyOf(args);
  if (typeof text !== 'string') return o.usage(64, text.error);
  if (!text.trim()) return o.usage(64, '消息是空的：pigeon new --loft <设备> --title "标题" "要说的话"（或 --stdin）');
  const title = oneLine(args.title || text.split('\n')[0], 40);
  const model = typeof args.model === 'string' ? args.model.trim() : '';
  const effort = typeof args.effort === 'string' ? args.effort.trim().toLowerCase() : '';
  if (args.model === true || args.effort === true) return o.usage(64, '--model 和 --effort 后面要跟值，比如 --model gpt-6-luna --effort high');
  if (effort && !EFFORTS.includes(effort)) return o.usage(64, `思考强度只能是 ${EFFORTS.join(' / ')}，收到「${args.effort}」。`);
  const agent = agentOfArg(args.agent || 'codex');
  if (!agent) return o.usage(64, `--agent 只能是 codex、dsh、antigravity，收到「${args.agent}」。`);
  if (agent === DSH && (model || effort)) return o.usage(64, 'DeepSeek Harness 用它自己配的模型，--model 和 --effort 指定不了。');
  const { post, secrets, raw } = await loadSettings();
  const from = sender();
  const { chain, count, warn } = chainFor(args['reply-to']);
  if (warn) o.err(warn);
  const band = newBand();
  const lofts = readLofts().lofts;
  let loft = findLoft(lofts, args.loft || LOCAL);
  if (loft && loft.id === LOCAL) loft = { ...loft, projects: listProjects() };
  if (!loft) return o.usage(64, `没找到设备「${args.loft}」。先跑 pigeon lofts；远程设备要先 pigeon lofts --refresh`);
  const pr = resolveProject(loft, args.project);
  if (!pr.ok) return o.usage(64, pr.error);
  if (agent !== 'codex' && loft.id !== LOCAL) return o.usage(64, `${AGENT_NAME[agent]} 只能在这台 Mac 上新开对话。`);
  const to = { loft: loft.id, loft_name: loft.name, session: '', title, agent };
  const via = loft.id === LOCAL ? 'queue' : 'relay';
  const extra = extrasOf(args, text);
  // 模型和思考强度：本机新开对话由 codex exec 的 -m 和 -c 指定；经中继站的写进 create_thread 的 model 和 thinking
  const note = makeNote({ band, kind: 'new', replyTo: args['reply-to'], chain, count, from, to, via, text, model, effort, extra, track: { asker: process.pid } });
  if (overHops(count, post.maxHops)) {
    const err = `这条链已经传了 ${count - 1} 次，超过往返上限 ${post.maxHops}，不再发送。`;
    await refuseNew(note, err, 'max_hops', clip(text, 80)); return o.refused(note, err, 'max_hops');
  }
  if (agent !== 'codex') {
    // 目录：命令里写的 > 在 Pigeon 应用里派的用设置里的（没设就是主目录）> 当前目录（Claude Code 派的就是它的项目）
    const fromApp = !!process.env.PIGEON_SEND_ID, setDir = String(agentCfg(raw, agent).cwd || '').trim().replace(/^~(?=\/|$)/, HOME);
    const cwd = path.resolve(pr.project && pr.project.path ? pr.project.path : (args.cwd || (fromApp ? (setDir || HOME) : process.cwd())));
    if (!fs.existsSync(cwd)) return o.usage(64, `项目目录不存在：${cwd}`);
    return launchOther(o, note, { agent, session: '', cwd, model, effort, title, mode: sandboxArg(args) }, post, args, text);
  }
  const bin = codexBin();
  if (!bin) return o.notReady(3, 'Codex 不可用：没找到 codex 命令（ChatGPT 应用里自带的也没有）。');

  let cwd = '', sc = { text, kinds: [], masked: [] };
  if (via === 'queue') {
    // 本机新开对话：后台看护进程跑 codex exec，对话会留在 Codex 应用里
    cwd = path.resolve(pr.project && pr.project.path ? pr.project.path : (args.cwd || process.cwd()));
    if (!fs.existsSync(cwd)) return o.usage(64, `项目目录不存在：${cwd}`);
  } else {
    const rs = relayStatus(post, loft.id);
    if (!rs.ok) return o.notReady(3, rs.error);
    if (!codexAppRunning()) return o.notReady(3, HINT_APP);
    sc = screenText(text, secrets.mode);
  }

  note.why = await whyOf(args.reason, text, toKeyOf(to));
  note.track.deadline = deadlineOf(note, post);
  if (via === 'queue') Object.assign(note.track, { method: 'exec', cwd, offset: 0 });
  else Object.assign(note.track, { host: loft.id, project: pr.project.id });
  const askKind = askKindOf(via, from, raw, post);
  const needAsk = !!askKind;
  note.state = needAsk ? 'asking' : 'queued';
  await addNote(note);
  saveBody(note.band, sc.text);
  await report(note, { preview: clip(sc.text, 80) });
  if (sc.masked.length) o.err(`已按设置自动打码：${sc.masked.join('、')}。`);

  let sendText = sc.text;
  if (needAsk) {
    const a = await askUser(note, post, sc, text, pr.project.name, o, askKind);
    if (!a.ok) { await move(band, { state: 'refused', reason: a.reason, error: a.error }); return o.refused(note, a.error, a.reason); }
    sendText = a.text;
    await move(band, { state: 'queued' });
  }
  const message = sendText.trimEnd() + footer(band, from);
  const d = via === 'queue'
    ? { type: 'exec', message, cwd, model, effort }
    : { type: 'relay', instr: newInstruction({ band, projectId: pr.project.id, projectName: pr.project.name, loftName: loft.name, title, body: message, waitMin: post.waitTimeoutMin, model, effort }) };

  const r = await launch(note, d, post);
  if (!r.ok) return o.refused(note, r.error, r.reason);
  if (r.paused) { o.say(...pausedText(band, post)); return o.done(0, { ok: true, band, state: 'queued', paused: true }); }
  o.say(`消息已发出，编号 ${band}（新开对话「${title}」）`,
    `设备：${loft.name}${via === 'relay' ? '（经中继站转发，会跑一轮模型，有 token 成本）' : ''}`,
    `模型：${modelLabel(note) || (via === 'relay' ? '对方设备的默认设置' : '本机 Codex 设置')}`,
    `等回信：node "${PIGEON_SCRIPT}" wait ${band}　读回信：node "${PIGEON_SCRIPT}" read ${band}`);
  if (args.wait && !o.json) return waitCmd({ _: [band], timeout: args.timeout });
  return o.done(0, { ok: true, band, state: 'flying' });
}

/* ---------- 看进展 ---------- */
// 读记录，算出这条消息现在的进展（不写日志）
export function progressOf(note) {
  const t = note.track || {};
  // DSH、Antigravity 由看护进程直接写状态，这里没有记录可读
  if (t.method === 'dsh' || t.method === 'agy' || t.method === 'agycli') return { state: '' };
  if (note.via === 'relay') {
    const file = t.relay_rollout || (getThread(t.relay_thread) || {}).rollout || findRollout(t.relay_thread);
    const r = file ? readFrom(file, t.relay_offset || 0) : null;
    if (!r) return { state: '' };
    return relayProgress(r.lines, t.fetch_band || note.band, { fetched: !!t.fetch_band });
  }
  if (!note.to.session) return { state: '' };
  const file = t.rollout || (getThread(note.to.session) || {}).rollout || findRollout(note.to.session);
  const r = file ? readFrom(file, t.offset || 0) : null;
  if (!r) return { state: '' };
  return { ...localProgress(r.lines, note.band), rollout: file };
}

// 把进展写进日志，状态变了就上报
export async function applyProgress(note, p) {
  if (!p || !p.state) return note;
  const patch = { state: p.state };
  if (p.error) patch.error = p.error;
  if (p.state === 'refused') patch.reason = 'offline'; // 中继站说没发出去：对方那台连不上或不收
  const to = {};
  if (note.via === 'relay' && p.threadId && !note.to.session) to.session = p.threadId;
  if (Object.keys(to).length) patch.to = to;
  const track = {};
  if (p.turn) track.turn = p.turn;
  if (p.relayTurn) track.relay_turn = p.relayTurn;
  if (p.rollout && !note.track?.rollout) track.rollout = p.rollout;
  if (Object.keys(track).length) patch.track = track;
  if (p.state === note.state && !patch.to && !patch.track) return note;
  return move(note.band, patch, p.state === 'home' ? { answer_preview: clip(p.answer, 160) } : undefined);
}

// 发送的进程或看护进程没了，消息却还停在“等确认”“暂停排着”：正文只在那个进程的内存里，已经发不出去了，记成没发出。
async function reapOrphan(note) {
  const t = note.track || {};
  if (note.state === 'asking' && t.asker && !pidAlive(t.asker)) {
    return move(note.band, { state: 'refused', reason: 'timeout', error: '发送的命令在用户确认之前就退出了，消息没有发送。不要自动重发。' });
  }
  if (note.state === 'queued' && note.paused && t.watcher && !pidAlive(t.watcher)) {
    return move(note.band, { state: 'refused', reason: 'timeout', paused: false, error: '暂停期间后台进程退出了，消息没有发送。不要自动重发，需要的话请用户决定。' });
  }
  return note;
}

export async function step(band) {
  let note = getNote(band);
  if (!note) return null;
  note = await reapOrphan(note) || note;
  if (TERMINAL.has(note.state) && note.state !== 'lost') return note;
  return applyProgress(note, progressOf(note));
}

/* ---------- 后台看护 ---------- */
// 暂停中排着的消息：每隔一个轮询间隔（默认 2 秒）读一次设置文件，继续了就送出，超过 pause_until 就不送了。
// 返回 true 表示可以送了；false 表示已经处理完（记成没发出，或者消息被别处改了）。
async function waitResume(band) {
  for (;;) {
    const cur = getNote(band);
    if (!cur || cur.state !== 'queued' || !cur.paused) return false;
    if (!isPaused(cur.to.loft)) return true;
    if (Date.now() > ((cur.track && cur.track.pause_until) || 0)) {
      await move(band, { state: 'refused', reason: 'timeout', paused: false, error: '暂停了太久一直没继续，这条消息没有发送。不要自动重发，需要的话请用户决定。' });
      return false;
    }
    await sleep(pollMs());
  }
}

export async function watch(band) {
  let note = getNote(band);
  if (!note) return 1;
  try {
    const method = (note.track && note.track.method) || '';
    const needBody = note.paused || OWN_WATCH.includes(method);
    let d = null;
    if (needBody) { try { d = JSON.parse(await readStdin()); } catch {} }
    if (note.paused) {
      if (!d) { await move(band, { state: 'refused', reason: 'offline', paused: false, error: '看护进程没收到消息内容，没有发送。' }); return 1; }
      if (!await waitResume(band)) return 0;
      const { post } = await loadSettings();
      // 继续了：清掉暂停标记，等回信的时限从现在算起
      note = await move(band, { paused: false, track: { deadline: deadlineOf(note, post, Date.now()) } });
      if (!OWN_WATCH.includes(d.type)) {
        const r = await deliver(note, d, post);
        if (!r.ok) return 0;
      }
    }
    if (method === 'exec') return await watchExec(getNote(band) || note, d);
    if (method === 'dsh') return await watchDsh(getNote(band) || note, d);
    if (method === 'agy') return await watchAgy(getNote(band) || note, d);
    if (method === 'agycli') return await watchAgyCli(getNote(band) || note, d);
    const deadline = (getNote(band).track && getNote(band).track.deadline) || note.created + POST_DEFAULTS.waitTimeoutMin * 60000;
    for (;;) {
      note = await step(band);
      if (!note || TERMINAL.has(note.state)) return 0;
      if (Date.now() > deadline) {
        await move(band, { state: 'lost', error: `等了 ${fmtDur(Date.now() - note.created)} 还没有结果，没有自动重发。可以去 Codex 里看看，或者稍后 pigeon read ${band} 再查。` });
        return 0;
      }
      await sleep(pollMs());
    }
  } catch (e) {
    await move(band, { state: 'lost', error: '看护进程出错：' + oneLine(e.message, 160) });
    return 1;
  }
}

async function watchExec(note, d) {
  const band = note.band;
  const message = d && d.message || '';
  if (!message.trim()) { await move(band, { state: 'lost', error: '看护进程没收到消息内容，没有发送。' }); return 1; }
  const bin = codexBin();
  const { codex: s } = await loadSettings();
  const t = note.track;
  const model = d.model || s.model, effort = d.effort || s.effort; // 命令行指定的优先，其次是设置
  const cliArgs = ['exec', '--json', '--skip-git-repo-check', '-C', t.cwd, '-s', s.sandbox && s.sandbox !== 'auto' ? s.sandbox : 'workspace-write'];
  if (model) cliArgs.push('-m', model);
  if (effort) cliArgs.push('-c', `model_reasoning_effort="${effort}"`);
  cliArgs.push(message);
  const child = spawn(bin, cliArgs, { cwd: t.cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PIGEON_BAND: band } });
  await move(band, { state: 'flying' });
  let buf = '', last = '', failed = '', timedOut = false, pending = Promise.resolve();
  const killer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000); }, Math.max(1000, t.deadline - Date.now()));
  child.stdout.on('data', chunk => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'thread.started' && ev.thread_id) { const id = ev.thread_id; pending = pending.then(() => move(band, { state: 'delivered', to: { session: id } })); }
      if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') last = ev.item.text || last;
      if (ev.type === 'turn.failed' || ev.type === 'error') failed = ev.error?.message || ev.message || failed;
    }
  });
  child.stderr.on('data', () => {});
  const code = await new Promise(r => child.on('close', r));
  clearTimeout(killer);
  await pending;
  const fresh = getNote(band);
  if (fresh && fresh.to.session) {
    const p = progressOf(fresh);
    if (p.state === 'home') { await applyProgress(fresh, p); return 0; }
  }
  if (code === 0 && !timedOut && last) { await move(band, { state: 'home' }, { answer_preview: clip(last, 160) }); return 0; }
  const err = timedOut ? `等了 ${fmtDur(Date.now() - note.created)} 还没完成，已经停下，没有自动重发。` : `新对话没有正常结束：${oneLine(failed || `codex 退出码 ${code}`, 160)}`;
  await move(band, { state: 'lost', error: err });
  return 0;
}

/* ---------- DSH、Antigravity ---------- */
// 都在本机，不经中继站、不问放行。由看护进程跑：DSH 跑 dsh headless，Antigravity 经 agentapi 发、再读它本机服务等回复
// --sandbox：DSH 的权限档（read-only 只读、workspace-write 能改工作目录），不写看设置，再不写用它自己的默认（能改工作目录）
const DSH_MODES = ['read-only', 'workspace-write'];
// 设置里每家的配置：agents.deepseek / agents.antigravity（sandbox、cwd、timeoutMin）
const agentCfg = (raw, agent) => { const a = raw && raw.agents && raw.agents[agent]; return a && typeof a === 'object' ? a : {}; };
const sandboxArg = args => (typeof args.sandbox === 'string' ? args.sandbox.trim() : '');
async function launchOther(o, note, d, post, args, text) {
  const band = note.band, name = AGENT_NAME[d.agent];
  if (d.mode && d.agent !== DSH) return o.usage(64, '--sandbox 只对 DeepSeek Harness 有用。');
  if (d.mode && !DSH_MODES.includes(d.mode)) return o.usage(64, `--sandbox 只能是 ${DSH_MODES.join(' / ')}，收到「${d.mode}」。`);
  if (d.agent === DSH && !dshBin()) return o.notReady(3, '没找到 DeepSeek Harness 的命令行：/Applications/DeepSeek Harness.app 装了吗？');
  // Antigravity 走哪条路：已有对话跟着它原来在哪（命令行的对话在桌面应用里看不到，反过来也一样）；
  // 新开的看设置 agents.antigravity.via：auto（默认，装了 agy 就用它）、cli、app
  if (d.agent === AGY) {
    const { raw: r0 } = await loadSettings(), want = String(agentCfg(r0, AGY).via || 'auto');
    if (!d.via) d.via = d.session ? (agyCliSessions({ limit: 200 }).some(s => s.id === d.session) ? 'cli' : 'app') : want === 'app' ? 'app' : want === 'cli' || agyCliBin() ? 'cli' : 'app';
    if (d.via === 'cli' && !agyCliBin()) return o.notReady(3, '没找到 Antigravity 的命令行 agy（~/.local/bin/agy）。装上它，或者在接入页把 Antigravity 改成“经 Antigravity 应用”。');
    if (d.via === 'app' && !agentapiBin()) return o.notReady(3, '没找到 Antigravity 的 agentapi（~/.gemini/antigravity/bin/agentapi）。Antigravity 装了吗？');
    if (d.via === 'app' && !agyHub()) return o.notReady(3, HINT_AGY);
    if (d.via === 'cli' && d.session && !d.cwd) d.cwd = (agyCliSessions({ limit: 200 }).find(s => s.id === d.session) || {}).cwd || '';
  }
  if (d.agent === DSH && d.session && !d.cwd) d.cwd = dshSessionInfo(findDshSession(d.session), 4000).cwd || '';
  // 设置里的默认：DSH 的权限、Antigravity 新开对话用哪一档（接入页“默认模型”）、各自的超时
  const { raw } = await loadSettings(), cfg = agentCfg(raw, d.agent);
  if (d.agent === DSH && !d.mode && DSH_MODES.includes(cfg.sandbox)) d.mode = cfg.sandbox;
  if (d.agent === AGY && !d.session) {
    // 模型：命令里写的 > 接入页选的“默认模型” > Antigravity 自己的默认；系列 + 思考强度拼成它认的 id
    const list = agyModelsCached();
    const saved = ((raw.devices && raw.devices.models) || {})[`${AGY}@${LOCAL}`] || {};
    const pick = d.model ? { model: d.model, effort: d.effort || '' } : saved.model ? { model: saved.model, effort: saved.effort || '' } : list.default;
    const known = list.models.find(x => x.id === pick.model);
    if (pick.effort && known && known.efforts.length && !known.efforts.includes(pick.effort)) return o.usage(64, `${known.name} 的思考强度只能是 ${known.efforts.join(' / ')}，收到「${pick.effort}」。`);
    d.model = agySlug(pick.model, pick.effort, list.models);
    if (d.model) { note.model = pick.model; note.effort = known && known.efforts.length ? d.model.slice(pick.model.length + 1) : ''; }
  }
  note.why = await whyOf(args.reason, text, toKeyOf(note.to));
  // 超时：设置里写了几分钟就到点停下；0（默认）不限，等它做完。DSH、agy 是 Pigeon 自己起的进程，
  // 到点停下就是把它停掉、活也停了，所以默认不限；只留一个 OPEN_MAX_MIN 的上限，免得进程一直挂着
  const tmin = Number(cfg.timeoutMin) > 0 ? Number(cfg.timeoutMin) : 0;
  note.track.deadline = note.created + (tmin || OPEN_MAX_MIN) * 60000;
  note.track.limit = tmin;
  Object.assign(note.track, { method: d.agent === DSH ? 'dsh' : d.via === 'cli' ? 'agycli' : 'agy', cwd: d.cwd || '' });
  if (d.agent === AGY && d.via === 'cli') { const m = String(cfg.mode || ''); if (AGY_CLI_MODES.includes(m)) d.mode = m; }
  // DSH、agy 是 Pigeon 自己起的、能改文件的进程：接活的 agent 往下转派时，先问你
  const askKind = askKindOf('queue', note.from, raw, post);
  note.state = askKind ? 'asking' : 'queued';
  await addNote(note);
  saveBody(note.band, text);
  await report(note, { preview: clip(text, 80) });
  if (askKind) {
    const a = await askUser(note, post, { text, kinds: [], masked: [] }, text, d.cwd ? path.basename(d.cwd) : '', o, askKind);
    if (!a.ok) { await move(band, { state: 'refused', reason: a.reason, error: a.error }); return o.refused(note, a.error, a.reason); }
    text = a.text;
    await move(band, { state: 'queued' });
  }
  const message = text.trimEnd() + footer(band, note.from);
  const r = await launch(note, { ...d, type: note.track.method, message }, post);
  if (!r.ok) return o.refused(note, r.error, r.reason);
  if (r.paused) { o.say(...pausedText(band, post)); return o.done(0, { ok: true, band, state: 'queued', paused: true }); }
  o.say(...[`消息已发出，编号 ${band}（${d.session ? `给 ${name} 的「${note.to.title || d.session}」` : `新开 ${name} 对话「${note.to.title}」`}）`,
    d.agent === AGY && !d.session && d.via === 'app' ? 'Antigravity 新开的对话不绑项目目录：要它看文件，消息里写清文件的完整路径。' : '',
    d.agent === AGY && d.via === 'cli' && !d.session ? `经 Antigravity 命令行 agy，在 ${d.cwd} 里干活；要人批准的操作它会跳过，不会停下来等。` : '',
    `等回信：node "${PIGEON_SCRIPT}" wait ${band}　读回信：node "${PIGEON_SCRIPT}" read ${band}`].filter(Boolean));
  if (args.wait && !o.json) return waitCmd({ _: [band], timeout: args.timeout });
  return o.done(0, { ok: true, band, state: 'flying' });
}

// 拿到回信：存一份，记成已回信，顺手刷新本机对话列表（新开的对话要出现在指挥台上）
async function finishOther(band, answer) {
  saveAnswer(band, answer);
  await move(band, { state: 'home' }, { answer_preview: clip(answer, 160) });
  try { const { post } = await loadSettings(); saveLofts({ relays: relayIds(post) }); } catch {}
}
const OPEN_MAX_MIN = 240;
const timedOutMsg = note => note.track && note.track.limit
  ? `到了设置里的 ${note.track.limit} 分钟还没完成，已经停下，没有自动重发。要它做更久，在接入页把这一家的超时调大或改成 0（不限）。`
  : `等了 ${fmtDur(Date.now() - note.created)} 还没完成，已经停下，没有自动重发。`;
// 在做什么：写进任务，指挥台和任务页上看得到。几秒最多报一次
function progressReporter(band) {
  let last = '', at = 0, timer = null, pending = Promise.resolve();
  const flush = () => { timer = null; at = Date.now(); const v = last; pending = pending.then(async () => { const n = await patchNote(band, { progress: v }); if (n) await report(getNote(band) || n); }).catch(() => {}); };
  return {
    set(text) { if (!text || text === last) return; last = text; if (timer) return; const wait = Math.max(0, 3000 - (Date.now() - at)); timer = setTimeout(flush, wait); },
    async done() { if (timer) { clearTimeout(timer); timer = null; } await pending; },
  };
}

async function watchDsh(note, d) {
  const band = note.band, t = note.track;
  const message = d && d.message || '';
  if (!message.trim()) { await move(band, { state: 'lost', error: '看护进程没收到消息内容，没有发送。' }); return 1; }
  const bin = dshBin();
  if (!bin) { await move(band, { state: 'refused', reason: 'offline', error: '没找到 DeepSeek Harness 的命令行。' }); return 0; }
  const cwd = t.cwd && fs.existsSync(t.cwd) ? t.cwd : HOME;
  const child = spawn(bin, dshArgs({ session: d.session || '', mode: d.mode || '' }), { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PIGEON_BAND: band } });
  child.stdin.end(message);
  await move(band, { state: 'flying' });
  let buf = '', last = '', final = null, failed = '', timedOut = false, pending = Promise.resolve();
  const killer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000); }, Math.max(1000, t.deadline - Date.now()));
  child.stdout.on('data', chunk => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const e = dshEvent(buf.slice(0, nl)); buf = buf.slice(nl + 1);
      if (!e) continue;
      if (e.session && !note.to.session) { const id = e.session; note.to.session = id; pending = pending.then(() => move(band, { state: 'delivered', to: { session: id } })); }
      if (e.text) last = e.text;
      if (e.final != null) final = e.final;
      if (e.error) failed = e.error;
    }
  });
  let err = '';
  child.stderr.on('data', c => { err = (err + c.toString('utf8')).slice(-2000); });
  const code = await new Promise(r => child.on('close', r));
  clearTimeout(killer);
  await pending;
  const answer = final != null && final !== '' ? final : last;
  if (code === 0 && !timedOut && !failed && answer) { await finishOther(band, answer); return 0; }
  const why = failed || err.trim().split('\n').at(-1) || `dsh 退出码 ${code}`;
  await move(band, { state: 'lost', error: timedOut ? timedOutMsg(note) : `DeepSeek Harness 没有正常结束：${oneLine(why, 160)}` });
  return 0;
}

// 经 agy 命令行：拿到 result 就算这一轮完了（它有时还会等标准输入，拿到就停掉它）
async function watchAgyCli(note, d) {
  const band = note.band, t = note.track;
  const message = d && d.message || '';
  if (!message.trim()) { await move(band, { state: 'lost', error: '看护进程没收到消息内容，没有发送。' }); return 1; }
  const bin = agyCliBin();
  if (!bin) { await move(band, { state: 'refused', reason: 'offline', error: '没找到 Antigravity 的命令行 agy。' }); return 0; }
  const cwd = t.cwd && fs.existsSync(t.cwd) ? t.cwd : HOME;
  // 设置里写了超时才传给 agy；没写（0）不限，让它做完
  const mins = t.limit ? Math.max(1, Math.ceil((t.deadline - Date.now()) / 60000)) : 0;
  const child = spawn(bin, agyCliArgs({ session: d.session || '', model: d.model || '', mode: d.mode || '', timeoutMin: mins }), { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PIGEON_BAND: band } });
  const prog = progressReporter(band);
  let steps = 0;
  child.stdin.end(agyCliInput(message));
  await move(band, { state: 'flying' });
  let buf = '', result = null, err = '', timedOut = false, pending = Promise.resolve();
  const stop = () => { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000); };
  const killer = setTimeout(() => { timedOut = true; stop(); }, Math.max(1000, t.deadline - Date.now() + 30000));
  child.stdout.on('data', chunk => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const e = agyCliEvent(buf.slice(0, nl)); buf = buf.slice(nl + 1);
      if (!e) continue;
      if (e.conversation && !note.to.session) { const id = e.conversation; note.to.session = id; pending = pending.then(() => move(band, { state: 'delivered', to: { session: id } })); }
      if (e.step) { steps++; prog.set(`${e.step}（第 ${steps} 步）`); }
      if (e.result) { result = e.result; if (result.conversation && !note.to.session) { note.to.session = result.conversation; pending = pending.then(() => move(band, { state: 'delivered', to: { session: result.conversation } })); } stop(); }
    }
  });
  child.stderr.on('data', c => { err = (err + c.toString('utf8')).slice(-8000); });
  const code = await new Promise(r => child.on('close', r));
  clearTimeout(killer);
  await prog.done();
  await pending;
  if (getNote(band)?.progress) await patchNote(band, { progress: '' });
  const denied = agyDenials(err);
  if (result && result.status === 'SUCCESS' && result.response.trim()) {
    const note2 = denied.length ? `\n\n（Pigeon：Antigravity 有 ${denied.length} 个操作要人批准，在命令行里被跳过了：${denied.join('；')}）` : '';
    await finishOther(band, result.response.trimEnd() + note2);
    return 0;
  }
  const why = result ? (result.error || `状态 ${result.status || '不明'}${denied.length ? `；被跳过的操作：${denied.join('；')}` : ''}`) : (err.trim().split('\n').at(-1) || `agy 退出码 ${code}`);
  await move(band, { state: 'lost', error: timedOut ? timedOutMsg(note) : `Antigravity 没有正常结束：${oneLine(why, 200)}` });
  return 0;
}

async function watchAgy(note, d) {
  const band = note.band, t = note.track;
  const message = d && d.message || '';
  if (!message.trim()) { await move(band, { state: 'lost', error: '看护进程没收到消息内容，没有发送。' }); return 1; }
  const hub = agyHub();
  if (!hub) { await move(band, { state: 'refused', reason: 'offline', error: HINT_AGY }); return 0; }
  let id = d.session || '', base = 0;
  if (id) {
    base = ((agyList(hub) || []).find(x => x.id === id) || {}).steps || 0;
    const r = agySend(hub, id, message);
    if (!r.ok) { await move(band, { state: 'refused', reason: 'no_target', error: r.error }); return 0; }
    await move(band, { state: 'delivered' });
  } else {
    const r = agyNew(hub, { prompt: message, model: d.model || '', title: d.title || '' });
    if (!r.ok) { await move(band, { state: 'refused', reason: 'offline', error: r.error }); return 0; }
    id = r.id;
    await move(band, { state: 'delivered', to: { session: id } });
  }
  // 等它这一轮停下来：不在跑了，而且 base 之后有了回复
  let quiet = 0, said = '';
  while (Date.now() < t.deadline) {
    await sleep(pollMs());
    const h = agyHub() || hub;
    const s = (agyList(h) || []).find(x => x.id === id);
    if (s && s.running) {
      // 停着等你批准（比如读工作区外的文件）：Pigeon 不替你点，写进任务里，等你在 Antigravity 里处理
      const w = agyWaiting(agySteps(h, id), base), msg = w ? `Antigravity 在等你批准：${w}。去 Antigravity 里点同意或拒绝。` : '';
      if (msg !== said) { said = msg; await patchNote(band, { error: msg }); await report(getNote(band)); }
      quiet = 0; continue;
    }
    if (!s) { quiet = 0; continue; }
    if (said) { said = ''; await patchNote(band, { error: '' }); }
    const answer = agyAnswer(agySteps(h, id), base);
    if (answer) { await finishOther(band, answer); return 0; }
    // 停着却没有回复：可能还没开始，多等几次；一直这样就算没回音
    if (++quiet > 30) break;
  }
  await move(band, { state: 'lost', error: Date.now() >= t.deadline ? timedOutMsg(note) + '可以去 Antigravity 里看看。' : 'Antigravity 停下了，但没读到回复。去 Antigravity 里看看。' });
  return 0;
}

/* ---------- 模型列表 ---------- */
// pigeon models [antigravity] [--json]：Antigravity 能用的模型（读它本机服务，没开时用上次存的）
export async function modelsCmd(args) {
  const which = agentOfArg(args._[0] || 'antigravity');
  if (which !== AGY) { console.error('现在只列 Antigravity 的模型：pigeon models antigravity。Codex 的模型列表应用自己读。'); return 64; }
  const l = agyModelsCached();
  if (args.json) { console.log(JSON.stringify({ antigravity: l })); return 0; }
  if (!l.models.length) { say('还没读到 Antigravity 的模型列表：打开 Antigravity 再试一次。'); return 1; }
  say(`Antigravity 的模型（${l.live ? '刚读的' : '上次读的，Antigravity 现在没开'}；默认 ${agySlug(l.default.model, l.default.effort, l.models)}）：`,
    ...l.models.map(m => `  ${m.id}　${m.name}${m.efforts.length ? `　思考：${m.efforts.join(' / ')}` : ''}${m.tag ? `　［${m.tag}］` : ''}`),
    '新开对话：pigeon new --agent antigravity --model <上面的 id> --effort <思考强度>');
  return 0;
}

/* ---------- 回信 ---------- */
export function answerOf(note) {
  const m = (note.track || {}).method;
  if (m === 'dsh' || m === 'agy' || m === 'agycli') return { answer: readAnswer(note.band), progress: { state: note.state } };
  const p = progressOf(note);
  if (p.state === 'home') return { answer: p.answer, progress: p };
  // 没回音了但中继站有 JSON 里的回信，也拿出来给人看
  if (note.via === 'relay') {
    const t = note.track || {};
    const file = t.relay_rollout || findRollout(t.relay_thread);
    const r = file ? readFrom(file, t.relay_offset || 0) : null;
    const turn = r ? turnForBand(digest(r.lines), t.fetch_band || note.band) : null;
    if (turn && turn.done) {
      const j = parseRelayReply(turn.answer, t.fetch_band || note.band);
      const f = toolFacts(turn.tools);
      const a = f.reply || (j && j.reply) || '';
      if (a) return { answer: a, progress: p };
    }
  }
  return { answer: '', progress: p };
}

const WHO_NAME = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor', deepseek: 'DeepSeek Harness', antigravity: 'Antigravity', you: '你' };
const who = p => WHO_NAME[p.agent] || p.agent || '?';
const where = to => `${to.title || to.session || '（新对话）'}${to.agent && to.agent !== 'codex' ? `（${AGENT_NAME[to.agent] || to.agent}）` : ''}${to.loft === LOCAL ? '' : '@' + (to.loft_name || to.loft)}`;
const elapsed = n => ago((TERMINAL.has(n.state) ? n.updated : Date.now()) - n.created);
const modelLabel = n => [n.model, n.effort].filter(Boolean).join(' · ');
const codexLink = n => (n.to.session && n.to.loft === LOCAL && (n.to.agent || 'codex') === 'codex' ? `codex://threads/${n.to.session}` : '');

export async function readCmd(args) {
  const band = args._[0];
  if (!isBand(band)) { console.error('用法：pigeon read <编号>（形如 b-3f9a02c1d7）'); return 64; }
  let note = getNote(band);
  if (!note) { console.error(`任务记录里没有 ${band}（只保留最近 7 天）。`); return 1; }
  note = await reapOrphan(note) || note;
  const { answer, progress } = answerOf(note);
  note = (await applyProgress(note, progress)) || note;
  // --json：应用的任务详情、频道要看全文（发出去的正文和完整回信），都是原样的 Markdown
  if (args.json) {
    console.log(JSON.stringify({ ok: true, band, state: note.state, body: readBody(band), answer: answer || '', error: note.error || '', progress: note.progress || '' }));
    return 0;
  }
  const lines = [`${band}　${STATE_ZH[note.state] || note.state}${note.paused ? '（暂停中，继续后自动送出）' : ''}　${who(note.from)} → ${where(note.to)}　用时 ${elapsed(note)}${modelLabel(note) ? `　模型 ${modelLabel(note)}` : ''}`];
  if (note.reason) lines.push(`原因：${note.reason}`);
  if (note.error) lines.push(`说明：${note.error}`);
  if (codexLink(note)) lines.push(`对话：${codexLink(note)}`);
  if (answer) lines.push('回信：', answer);
  else if (!TERMINAL.has(note.state)) lines.push('还没有回信。等它：pigeon wait ' + band);
  else if (note.state === 'lost' && note.via === 'relay' && note.to.session) lines.push(`没有回信。对方可能还在忙，等它做完可以补取：pigeon fetch ${band}`);
  else lines.push('没有回信。');
  say(...lines);
  return answer ? 0 : TERMINAL.has(note.state) ? 1 : 2;
}

export async function waitCmd(args) {
  const band = args._[0];
  if (!isBand(band)) { console.error('用法：pigeon wait <编号> [--timeout 分钟]'); return 64; }
  const { post } = await loadSettings();
  const limit = Math.max(0.05, Number(args.timeout) || post.waitTimeoutMin) * 60000;
  const t0 = Date.now();
  let told = false;
  for (;;) {
    let note = getNote(band);
    if (!note) { console.error(`任务记录里没有 ${band}。`); return 1; }
    note = await reapOrphan(note) || note;
    if (!(note.track && note.track.method === 'exec')) note = (await step(band)) || note;
    if (TERMINAL.has(note.state)) return readCmd({ _: [band] });
    const dl = (note.track && note.track.deadline) || 0;
    if (dl && Date.now() > dl + 5000 && !pidAlive(note.track.watcher)) {
      await move(band, { state: 'lost', error: `等了 ${fmtDur(Date.now() - note.created)} 还没有结果，没有自动重发。` });
      continue;
    }
    if (Date.now() - t0 > limit) {
      say(`还在路上：${band}　${STATE_ZH[note.state]}　已用 ${elapsed(note)}。后台还在跟，稍后再 pigeon wait ${band} 或 pigeon read ${band}。`);
      return 2;
    }
    if (!told) { process.stderr.write(`等 ${band}（${STATE_ZH[note.state]}）…\n`); told = true; }
    await sleep(pollMs());
  }
}

/* ---------- 补取回信 ---------- */
// 经中继站送到了、但当时没等到回信（没回音）的消息：请中继站再等一次、再读一次。只读，不给对方发消息，所以不弹放行确认。
export async function fetchCmd(args) {
  const band = args._[0];
  if (!isBand(band)) { console.error('用法：pigeon fetch <编号> [--wait-min 分钟]'); return 64; }
  let note = getNote(band);
  if (!note) { console.error(`任务记录里没有 ${band}（只保留最近 7 天）。`); return 1; }
  if (note.state === 'home') return readCmd({ _: [band] });
  if (note.via !== 'relay') { console.error('补取只用于经中继站发到远程的消息。本机的消息直接 pigeon wait / pigeon read。'); return 64; }
  if (note.state !== 'lost') { console.error(`这条消息现在是「${STATE_ZH[note.state] || note.state}」，不用补取：${note.state === 'refused' ? '它没发出去。' : `等它：pigeon wait ${band}`}`); return 64; }
  if (!note.to.session) { console.error('任务记录里没有对方的对话 id（可能根本没送到），没法补取。去 Codex 里看看，或者重新发。'); return 1; }
  const { post } = await loadSettings();
  const waitMin = Number(args['wait-min']) > 0 ? Number(args['wait-min']) : post.waitTimeoutMin;
  const host = note.track?.host || note.to.loft;
  const rs = relayStatus(post, host);
  if (!rs.ok) { say(rs.error); return 3; }
  if (!codexAppRunning()) { say(HINT_APP); return 3; }
  const bin = codexBin();
  if (!bin) { say('Codex 不可用：没找到 codex 命令。'); return 3; }
  const fetchBand = newBand();
  const file = rs.thread.rollout || findRollout(rs.thread.id);
  const offset = fileSize(file);
  const instr = fetchInstruction({ band: fetchBand, origBand: band, threadId: note.to.session, hostId: host, title: note.to.title, loftName: note.to.loft_name, waitMin });
  const q = codexQueue(bin, rs.thread.id, instr);
  if (!q.ok) { say(`没排上：${q.error}`); return 1; }
  await patchNote(band, { error: `正在补取回信（${fetchBand}）…`, track: { fetch_band: fetchBand, relay_thread: rs.thread.id, relay_rollout: file, relay_offset: offset } });
  process.stderr.write(`已请中继站补取 ${band} 的回信（最多等 ${waitMin} 分钟，经中继站，有 token 成本）…\n`);
  const deadline = Date.now() + (waitMin + 3) * 60000;
  while (Date.now() < deadline) {
    await sleep(pollMs());
    note = getNote(band);
    const p = progressOf(note);
    if (!p.state || p.state === 'delivered' || p.state === 'flying') continue;
    // 先清掉“正在补取”的说明，这样发给应用的“已回信”事件里不带它
    if (p.state === 'home') { await patchNote(band, { error: '' }); await applyProgress(note, p); return readCmd({ _: [band] }); }
    // 中继站这一轮结束了但没拿到回信：还是没回音，换上这次的说明
    await patchNote(band, { error: p.error || '补取也没拿到回信' });
    return readCmd({ _: [band] });
  }
  await patchNote(band, { error: `补取超时：中继站 ${waitMin + 3} 分钟内没回来。稍后可以再 pigeon fetch ${band}。` });
  return readCmd({ _: [band] });
}

export async function logCmd(args) {
  const n = Math.max(1, Number(args.n || args.limit) || 20);
  const notes = recent(n);
  if (args.json) { console.log(JSON.stringify({ notes }, null, 2)); return 0; }
  if (!notes.length) { say('还没有任务记录。发一条：pigeon send --to <对话> "要说的话"'); return 0; }
  const d = ts => { const x = new Date(ts); return `${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; };
  const rows = notes.map(x => `${x.band}  ${d(x.created)}  ${(STATE_ZH[x.state] || x.state).padEnd(3, '　')}  ${who(x.from)} → ${where(x.to)}${x.via === 'relay' ? '（经中继）' : ''}  ${elapsed(x)}${x.count > 1 ? `  第 ${x.count} 程` : ''}${modelLabel(x) ? `  ${modelLabel(x)}` : ''}${x.error ? '\n    ' + oneLine(x.error, 120) : ''}`);
  say(`最近 ${notes.length} 条消息（新的在上）：`, ...rows);
  return 0;
}

/* ---------- 设备 ---------- */
export async function loftsCmd(args) {
  const { post } = await loadSettings();
  if (args.refresh) {
    const r = await refreshRemote(post);
    if (!r.ok) { say(r.error); return r.code || 1; }
  }
  const { lofts, error } = saveLofts({ relays: relayIds(post) });
  if (args.json) { console.log(JSON.stringify(lofts, null, 2)); return 0; }
  const out = [];
  for (const l of lofts.lofts) {
    out.push(`${l.name}（${l.id}）${l.online ? '' : '　离线'}`);
    for (const s of (l.sessions || []).slice(0, Number(args.n) || 15)) out.push(`  ${s.id}  ${oneLine(s.title, 40)}${s.relay ? '　［中继站］' : ''}`);
    if ((l.sessions || []).length > (Number(args.n) || 15)) out.push(`  ……还有 ${l.sessions.length - (Number(args.n) || 15)} 条（-n 看更多）`);
    if (l.id !== LOCAL && (l.projects || []).length) out.push(`  项目：${l.projects.map(p => `${p.name}（${p.path}）`).join('、')}`);
  }
  if (error) out.push('', '注意：' + error);
  const remoteAge = lofts.remoteUpdated ? `远程设备是 ${ago(Date.now() - lofts.remoteUpdated)}前经中继站读的` : '还没读过远程设备';
  out.push('', `${remoteAge}；要刷新：pigeon lofts --refresh（经中继站，有 token 成本）`);
  say(...out);
  return 0;
}

async function refreshRemote(post) {
  const rs = relayStatus(post);
  if (!rs.ok) return { ok: false, error: rs.error, code: 3 };
  if (!codexAppRunning()) return { ok: false, error: HINT_APP, code: 3 };
  const bin = codexBin();
  if (!bin) return { ok: false, error: 'Codex 不可用：没找到 codex 命令。', code: 3 };
  const band = newBand();
  const file = rs.thread.rollout || findRollout(rs.thread.id);
  const offset = fileSize(file);
  const q = codexQueue(bin, rs.thread.id, loftsInstruction({ band }));
  if (!q.ok) return { ok: false, error: q.error };
  process.stderr.write('已请中继站读远程设备，等它回来（通常半分钟到两分钟）…\n');
  const deadline = Date.now() + 5 * 60000;
  while (Date.now() < deadline) {
    await sleep(pollMs());
    const r = readFrom(file || findRollout(rs.thread.id), offset);
    if (!r) continue;
    const p = loftsProgress(r.lines, band);
    if (p.state === 'lost') return { ok: false, error: '刷新失败：' + p.error };
    if (p.state === 'home') {
      const previous = readLofts().lofts.filter(l => l.id !== LOCAL);
      const remote = remoteLofts(p, previous);
      saveLofts({ relays: relayIds(post), remote });
      if (p.errors.length) process.stderr.write('部分工具调用失败：' + p.errors.join('；') + '\n');
      return { ok: true };
    }
  }
  return { ok: false, error: '刷新超时：中继站 5 分钟内没有回来。缓存没有改。' };
}

/* ---------- relay ---------- */
// 中继站：
//   pigeon relay                      看现在用的
//   pigeon relay use <对话id|latest> [--host <主机>]   换共用的；带 --host 是只给那台远程设备换
//   pigeon relay use default --host <主机>             那台不再单独用，跟着共用的
//   pigeon relay list [--json]         现在在用的和用过的：模型、思考强度、上一轮读了多少上下文
//   pigeon relay archive|unarchive|delete <对话id> [--json]   归档、恢复、删除用过的（在用的不让动）
//   pigeon relay check                 只读检查
export async function relayCmd(args) {
  const sub = args._[0] || '';
  const { post } = await loadSettings();
  const o = makeOut(args);
  const host = typeof args.host === 'string' ? args.host.trim() : '';
  // 不是用法错误的失败原因照旧打在标准输出（--json 时是那一行 JSON）
  const fail = (code, msg) => (o.json ? o.usage(code, msg) : (say(msg), code));
  if (sub === 'use') {
    const id = args._[1] || '';
    if (!id) return o.usage(64, '用法：pigeon relay use <对话id|latest> [--host <主机>]');
    if (id === 'default') {
      if (!host) return o.usage(64, 'use default 只用于某台远程设备：pigeon relay use default --host <主机>');
      const w = await patchSettings(s => { s.post = useRelay({ ...POST_DEFAULTS, ...(s.post || {}) }, '', host); });
      if (!w.ok) return fail(1, '没保存成功：' + w.error);
      saveLofts({ relays: relayIds(useRelay({ ...post }, '', host)) });
      o.say(`${host} 不再单独用中继站，跟着共用的那条。`);
      return o.done(0, { ok: true });
    }
    const t = id === 'latest' ? latestRelayCandidate() : getThread(id);
    if (!t) return fail(1, id === 'latest' ? '没找到合适的对话：' + HINT_RELAY_UNSET : `本机没找到对话 ${id}。`);
    if (t.approval === 'never') return fail(1, HINT_RELAY_NEVER);
    if (t.archived) return fail(1, `对话「${t.title}」已经归档，先恢复它：pigeon relay unarchive ${t.id}`);
    const w = await patchSettings(s => { s.post = useRelay({ ...POST_DEFAULTS, ...(s.post || {}) }, t.id, host); });
    if (!w.ok) return fail(1, '没保存成功：' + w.error);
    saveLofts({ relays: relayIds(useRelay({ ...post }, t.id, host)) });
    o.say(`${host ? `${host} 单独用的` : ''}中继站设为「${t.title}」（${t.id}），已保存到${w.where}。`,
      t.source === 'exec' ? '注意：这条对话是 codex exec 建的，拿不到 codex_app 工具，转发会失败。' : '远程发送时 Codex 可能会弹审批，需要你在 Codex 应用里点同意。');
    return o.done(0, { ok: true, id: t.id, title: t.title });
  }
  if (sub === 'list') {
    const rows = relayRows(post, { thread: getThread, findRollout });
    if (o.json) { console.log(JSON.stringify({ shared: post.relayThread, byHost: post.relayByHost, warnAt: RELAY_WARN_TOKENS, relays: rows })); return 0; }
    if (!rows.length) { say(HINT_RELAY_UNSET); return 0; }
    const k = n => n == null ? '读不到' : `${Math.round(n / 1000)}K`;
    say(...rows.map(r => `${r.id}  ${r.missing ? '（本机没找到）' : `「${r.title}」`}${r.shared ? '　［共用］' : ''}${r.hosts.length ? `　［单独给 ${r.hosts.join('、')}］` : ''}${r.archived ? '　已归档' : ''}`
      + `\n    ${r.model || '模型没记下'}${r.effort ? ' · ' + r.effort : ''} · 上一轮读了 ${k(r.context)}${r.window ? ` / 窗口 ${k(r.window)}` : ''}${r.context > RELAY_WARN_TOKENS ? '　太大了，建议换一条' : ''}`));
    return 0;
  }
  if (sub === 'archive' || sub === 'unarchive' || sub === 'delete') {
    const id = args._[1] || '';
    if (!id) return o.usage(64, `用法：pigeon relay ${sub} <对话id>`);
    if (sub !== 'unarchive' && isRelay(post, id)) return fail(1, '这条还在当中继站用，先换一条再' + (sub === 'delete' ? '删除' : '归档') + '。');
    if (!(post.relayUsed || []).includes(id) && !isRelay(post, id)) return o.usage(64, '只能处理用过的中继站对话（pigeon relay list 里列的）。别的对话请在 Codex 里管。');
    const bin = codexBin();
    if (!bin) return fail(3, 'Codex 不可用：没找到 codex 命令。');
    const r = spawnSync(bin, [sub, id], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.status !== 0) {
      const why = (r.error && r.error.message) || `${r.stderr || ''}\n${r.stdout || ''}`.split('\n').map(x => x.trim()).filter(x => x && !/unrecognized configuration|rmcp/i.test(x)).slice(-1)[0] || `退出码 ${r.status}`;
      return fail(1, `codex ${sub} 没成功：${oneLine(why, 200)}`);
    }
    if (sub === 'delete') { const w = await patchSettings(s => { s.post = forgetRelay({ ...POST_DEFAULTS, ...(s.post || {}) }, id); }); if (!w.ok) o.err('删掉了，但没能从用过的列表里去掉：' + w.error); }
    o.say({ archive: '归档了，在 Codex 里能恢复。', unarchive: '恢复了。', delete: '删掉了，找不回来。' }[sub]);
    return o.done(0, { ok: true });
  }
  if (sub === 'check') return relayCheck(post);
  const rs = relayStatus(post);
  if (!post.relayThread) { say(HINT_RELAY_UNSET); return 0; }
  say(`中继站：${rs.thread ? `「${rs.thread.title}」` : ''}${post.relayThread}`, rs.ok ? '状态：可用（详细检查：pigeon relay check）' : '问题：' + rs.error,
    ...Object.entries(post.relayByHost || {}).map(([h, id]) => `${h} 单独用：${(getThread(id) || {}).title || ''} ${id}`));
  return 0;
}

export async function relayCheck(post) {
  const items = [];
  const add = (ok, label, detail = '') => items.push({ ok, label, detail });
  const bin = codexBin();
  add(!!bin, 'codex 命令', bin || '没找到');
  const app = codexAppRunning();
  add(app, 'Codex 桌面应用', app ? '在运行' : HINT_APP);
  add(!!post.relayThread, '中继站已设置', post.relayThread || HINT_RELAY_UNSET);
  let t = null;
  if (post.relayThread) {
    t = getThread(post.relayThread);
    add(!!t, '中继站对话存在', t ? `「${t.title}」` : '本机没找到这条对话');
    if (t) {
      add(!t.archived, '没有归档', t.archived ? '已归档，请换一条' : '');
      add(t.approval !== 'never', '审批策略不是 never', t.approval === 'never' ? HINT_RELAY_NEVER : t.approval);
      add(t.source !== 'exec', '是桌面应用里建的对话', t.source === 'exec' ? 'codex exec 建的对话拿不到 codex_app 工具' : `来源 ${t.source}`);
      const file = t.rollout || findRollout(t.id);
      const r = file ? readFrom(file, 0) : null;
      add(!!r, '对话记录可读', file || '没找到 rollout 文件');
      if (r) {
        const turns = digest(r.lines).turns;
        const lastTurn = turns.at(-1);
        const busy = lastTurn && !lastTurn.done && !lastTurn.aborted;
        add(!busy, '中继站空闲', busy ? '最近一轮还没结束，新的指令会排在后面' : '');
      }
    }
  }
  const lofts = readLofts();
  const remotes = lofts.lofts.filter(l => l.id !== LOCAL);
  items.push({ ok: true, info: true, label: '远程设备缓存', detail: remotes.length ? remotes.map(l => `${l.name}（${(l.sessions || []).length} 条对话）`).join('、') : '还没有，pigeon lofts --refresh 读一次' });
  const lines = items.map(i => `${i.info ? '  ·' : i.ok ? '  通过' : '  不行'}　${i.label}${i.detail ? '：' + i.detail : ''}`);
  const bad = items.filter(i => !i.ok);
  say('中继站检查（只读，不发消息）：', ...lines, bad.length ? `\n有 ${bad.length} 项不行，远程发送暂时用不了。` : '\n可以经中继站往远程发送。');
  return bad.length ? 1 : 0;
}

export { listThreads };
