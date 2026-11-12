// 送信：send / new / wait / read / log / lofts / relay，以及后台看护进程（_watch）。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  LOCAL, LOCAL_NAME, sleep, clip, oneLine, fmtDur, fingerprint, newBand, isBand, emit, loadSettings, patchSettings,
  codexBin, codexAppRunning, pidAlive, sender, POST_DEFAULTS,
} from './common.mjs';
import { addNote, getNote, patchNote, recent, TERMINAL, STATE_ZH } from './journal.mjs';
import { readFrom, fileSize, findRollout, localProgress, digest, turnForBand } from './rollout.mjs';
import { sendInstruction, newInstruction, fetchInstruction, loftsInstruction, relayProgress, loftsProgress, remoteLofts, toolFacts, parseRelayReply } from './relay.mjs';
import { getThread, latestRelayCandidate, listThreads, listProjects } from './codex-state.mjs';
import { readLofts, saveLofts, resolveTarget, findLoft, resolveProject } from './lofts.mjs';
import { confirmRemote } from './confirm.mjs';

export const PIGEON_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pigeon.mjs');
const pollMs = () => Number(process.env.PIGEON_POLL_MS) || 2000;
const ago = ms => fmtDur(Math.max(0, ms));
const say = (...l) => console.log(l.join('\n'));
const HINT_APP = 'Codex 桌面应用没开：请先打开 ChatGPT 应用（里面的 Codex），再重新发送。';
const HINT_RELAY_UNSET = '还没有设置中继站：请在 Codex 应用里手动新建一条对话（随便发一句“中转用”），然后运行 pigeon relay use latest。';
// create_thread 的 thinking 字段能取的值；具体模型支持哪几档，由对方主机在建对话时校验。
export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const HINT_RELAY_NEVER = '中继站对话的审批策略是 never（多半是 codex exec 建的），不能替你发到远程。请在 Codex 应用里手动新建一条对话，再运行 pigeon relay use <对话id>。';

/* ---------- 纸条和事件 ---------- */
export function footer(band, from) {
  const who = from.agent === 'claude' ? 'Claude Code' : '用户';
  return `\n\n（Pigeon 纸条 ${band}，来自${LOCAL_NAME}上的 ${who}。回信直接写在这一轮的最终回复里就行。）`;
}

export function eventOf(note, extra = {}) {
  return {
    band: note.band, chain: note.chain, count: note.count, kind: note.kind, via: note.via, state: note.state,
    from: note.from, to: { loft: note.to.loft, loft_name: note.to.loft_name, agent: note.to.agent, session: note.to.session, title: note.to.title },
    preview: '', answer_preview: '', error: note.error || '', ...extra,
  };
}
const report = (note, extra) => emit('PigeonNote', eventOf(note, extra));

// 链：--reply-to 沿用同一条链，count + 1
export function chainFor(replyTo, lookup = getNote) {
  if (!replyTo) return { chain: '', count: 1, parent: null, warn: '' };
  const parent = lookup(replyTo);
  if (parent) return { chain: parent.chain || parent.band, count: (Number(parent.count) || 1) + 1, parent, warn: '' };
  return { chain: replyTo, count: 2, parent: null, warn: `飞行记录里没有 ${replyTo}（可能是别的电脑发的），按第 2 程计。` };
}
export const overHops = (count, maxHops) => count > maxHops;
// 看护进程最多跟多久。经中继站的要多留几分钟：中继站自己也要等 waitTimeoutMin，再加上它排队和跑模型的时间
export const deadlineOf = (note, post) => note.created + (post.waitTimeoutMin + (note.via === 'relay' ? 3 : 0)) * 60000;

export function makeNote({ band, kind, replyTo, chain, count, from, to, via, text, now = Date.now(), track = {}, model = '', effort = '' }) {
  return {
    band, chain: chain || band, count, kind, reply_to: replyTo || '', model, effort,
    from, to: { loft: to.loft, loft_name: to.loft_name || (to.loft === LOCAL ? LOCAL_NAME : ''), agent: 'codex', session: to.session || '', title: to.title || '' },
    via, state: 'queued', created: now, updated: now, fingerprint: fingerprint(text), error: '', track,
  };
}

async function move(band, patch, extra) {
  const r = await patchNote(band, patch);
  if (r && r.moved) await report(r.note, extra);
  return r ? r.note : getNote(band);
}

async function refuseNew(note, error, text) {
  note.state = 'refused'; note.error = error;
  await addNote(note);
  await report(note, { preview: clip(text, 80) });
  return note;
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

function spawnWatcher(band, body) {
  const child = spawn(process.execPath, [PIGEON_SCRIPT, '_watch', band], {
    detached: true, stdio: [body == null ? 'ignore' : 'pipe', 'ignore', 'ignore'], env: process.env,
  });
  child.unref();
  if (body == null) return Promise.resolve(child.pid);
  return new Promise(r => child.stdin.end(body, () => r(child.pid)));
}

function bodyOf(args) {
  if (args.file) { try { return fs.readFileSync(String(args.file), 'utf8'); } catch (e) { return { error: '读不到纸条文件：' + e.message }; } }
  return args._.join(' ');
}

/* ---------- 中继站 ---------- */
export function relayStatus(post) {
  const id = post.relayThread || '';
  if (!id) return { ok: false, error: HINT_RELAY_UNSET };
  const t = getThread(id);
  if (!t) return { ok: false, error: `中继站对话 ${id} 在本机没找到（可能删了）。` + HINT_RELAY_UNSET.slice(HINT_RELAY_UNSET.indexOf('请')) };
  if (t.archived) return { ok: false, thread: t, error: `中继站对话「${t.title}」已经归档。请换一条：pigeon relay use <对话id>` };
  if (t.approval === 'never') return { ok: false, thread: t, error: HINT_RELAY_NEVER };
  return { ok: true, thread: t };
}

/* ---------- 跨电脑发送前的确认 ---------- */
// 返回 true 表示可以发。没同意就把纸条记成被拒收，并告诉调用方不要重发。
async function releaseRemote(note, post, text, project) {
  if (post.confirmRemote === false) return true;
  const c = confirmRemote({ band: note.band, from: note.from, kind: note.kind, to: note.to, project, text });
  if (c.ok) return true;
  await move(note.band, { state: 'refused', error: c.error });
  say(`被拒收：${c.error}`, `脚环 ${note.band}`);
  return false;
}

/* ---------- send ---------- */
export async function sendCmd(args) {
  const text = bodyOf(args);
  if (typeof text !== 'string') { console.error(text.error); return 64; }
  if (!text.trim()) { console.error('纸条是空的：pigeon send --to <对话> "要说的话"（或 --file <文件>）'); return 64; }
  if (args.model || args.effort) { console.error('已有对话换不了模型和推理档位。要指定，请用 pigeon new 新开一条对话。'); return 64; }
  const { post, codex } = await loadSettings();
  const from = sender();
  const { chain, count, warn } = chainFor(args['reply-to']);
  const band = newBand();
  if (warn) console.error(warn);

  const res = resolveTarget(args.to);
  if (!res.ok && !res.notFound) {
    console.error(res.error);
    if (res.candidates) console.error(res.candidates.slice(0, 8).map(c => `  ${c.id}  ${c.title || ''}`).join('\n'));
    return 64;
  }
  const to = res.ok ? res.target : { loft: LOCAL, loft_name: LOCAL_NAME, session: '', title: String(args.to || '') };
  const via = to.loft === LOCAL ? 'queue' : 'relay';
  const note = makeNote({ band, kind: 'send', replyTo: args['reply-to'], chain, count, from, to, via, text });
  if (!res.ok) { await refuseNew(note, res.error, text); say(`被拒收：${res.error}`, `脚环 ${band}`); return 1; }
  if (overHops(count, post.maxHops)) {
    const err = `这条链已经传了 ${count - 1} 次，超过往返上限 ${post.maxHops}，为防止 agent 互相无限传话，不再发送。`;
    await refuseNew(note, err, text); say(`被拒收：${err}`, `脚环 ${band}`); return 1;
  }
  const bin = codexBin();
  if (!bin) { say('Codex 不可用：没找到 codex 命令（ChatGPT 应用里自带的也没有）。'); return 3; }

  const message = text.trimEnd() + footer(band, from);
  if (via === 'queue') {
    if (post.relayThread && to.session === post.relayThread) { console.error('这条是中继站对话，不能直接给它送纸条。'); return 64; }
    if (to.archived) { await refuseNew(note, `对话「${to.title}」已经归档，对方收不到。`, text); say(`被拒收：对话已归档。脚环 ${band}`); return 1; }
    const rollout = to.rollout || findRollout(to.session);
    note.track = { rollout, offset: fileSize(rollout), deadline: deadlineOf(note, post) };
    await addNote(note);
    await report(note, { preview: clip(text, 80) });
    const q = codexQueue(bin, to.session, message);
    if (!q.ok) { await move(band, { state: 'refused', error: q.error }); say(`被拒收：${q.error}`, `脚环 ${band}`); return 1; }
    await move(band, { state: 'flying', track: { queue_id: q.queueId } });
  } else {
    const rs = relayStatus(post);
    if (!rs.ok) { say(rs.error); return 3; }
    if (!codexAppRunning()) { say(HINT_APP); return 3; }
    const relayRollout = rs.thread.rollout || findRollout(rs.thread.id);
    note.track = { relay_thread: rs.thread.id, relay_rollout: relayRollout, relay_offset: fileSize(relayRollout), host: to.loft, deadline: deadlineOf(note, post) };
    await addNote(note);
    await report(note, { preview: clip(text, 80) });
    if (!await releaseRemote(note, post, text)) return 1;
    const instr = sendInstruction({ band, threadId: to.session, hostId: to.loft, title: to.title, loftName: to.loft_name, body: message, waitMin: post.waitTimeoutMin });
    const q = codexQueue(bin, rs.thread.id, instr);
    if (!q.ok) { await move(band, { state: 'refused', error: q.error }); say(`被拒收：${q.error}`, `脚环 ${band}`); return 1; }
    await move(band, { state: 'flying', track: { queue_id: q.queueId } });
  }
  const pid = await spawnWatcher(band);
  await patchNote(band, { track: { watcher: pid } });
  const warnApp = via === 'queue' && !codexAppRunning() ? '\n提示：Codex 桌面应用没开，纸条会一直排着队，打开应用后才会被接手。' : '';
  say(`纸条已放飞：${band}`,
    `收件人：${to.title || to.session}${to.loft === LOCAL ? '（本机）' : `@${to.loft_name}（经中继站转发，会跑一轮模型，有 token 成本）`}` + warnApp,
    `等回信：node "${PIGEON_SCRIPT}" wait ${band}　读回信：node "${PIGEON_SCRIPT}" read ${band}`);
  if (args.wait) return waitCmd({ _: [band], timeout: args.timeout });
  return 0;
}

/* ---------- new ---------- */
export async function newCmd(args) {
  const text = bodyOf(args);
  if (typeof text !== 'string') { console.error(text.error); return 64; }
  if (!text.trim()) { console.error('纸条是空的：pigeon new --loft <鸽舍> --title "标题" "要说的话"'); return 64; }
  const title = oneLine(args.title || text.split('\n')[0], 40);
  const model = typeof args.model === 'string' ? args.model.trim() : '';
  const effort = typeof args.effort === 'string' ? args.effort.trim().toLowerCase() : '';
  if (args.model === true || args.effort === true) { console.error('--model 和 --effort 后面要跟值，比如 --model gpt-6-luna --effort high'); return 64; }
  if (effort && !EFFORTS.includes(effort)) { console.error(`推理档位只能是 ${EFFORTS.join(' / ')}，收到「${args.effort}」。`); return 64; }
  const { post, codex } = await loadSettings();
  const from = sender();
  const { chain, count, warn } = chainFor(args['reply-to']);
  if (warn) console.error(warn);
  const band = newBand();
  const lofts = readLofts().lofts;
  let loft = findLoft(lofts, args.loft || LOCAL);
  if (loft && loft.id === LOCAL) loft = { ...loft, projects: listProjects() };
  if (!loft) { console.error(`没找到鸽舍「${args.loft}」。先跑 pigeon lofts；远程鸽舍要先 pigeon lofts --refresh`); return 64; }
  const pr = resolveProject(loft, args.project);
  if (!pr.ok) { console.error(pr.error); return 64; }
  const to = { loft: loft.id, loft_name: loft.name, session: '', title };
  const via = loft.id === LOCAL ? 'queue' : 'relay';
  const note = makeNote({ band, kind: 'new', replyTo: args['reply-to'], chain, count, from, to, via, text, model, effort });
  if (overHops(count, post.maxHops)) {
    const err = `这条链已经传了 ${count - 1} 次，超过往返上限 ${post.maxHops}，不再发送。`;
    await refuseNew(note, err, text); say(`被拒收：${err}`, `脚环 ${band}`); return 1;
  }
  const bin = codexBin();
  if (!bin) { say('Codex 不可用：没找到 codex 命令（ChatGPT 应用里自带的也没有）。'); return 3; }
  const message = text.trimEnd() + footer(band, from);
  const deadline = deadlineOf(note, post);

  if (via === 'queue') {
    // 本机新开对话：后台看护进程跑 codex exec，对话会留在 Codex 应用里
    const cwd = path.resolve(pr.project && pr.project.path ? pr.project.path : (args.cwd || process.cwd()));
    if (!fs.existsSync(cwd)) { console.error(`项目目录不存在：${cwd}`); return 64; }
    note.track = { method: 'exec', cwd, offset: 0, deadline, model, effort };
    await addNote(note);
    await report(note, { preview: clip(text, 80) });
    const pid = await spawnWatcher(band, message);
    await patchNote(band, { track: { watcher: pid } });
  } else {
    const rs = relayStatus(post);
    if (!rs.ok) { say(rs.error); return 3; }
    if (!codexAppRunning()) { say(HINT_APP); return 3; }
    const relayRollout = rs.thread.rollout || findRollout(rs.thread.id);
    note.track = { relay_thread: rs.thread.id, relay_rollout: relayRollout, relay_offset: fileSize(relayRollout), host: loft.id, project: pr.project.id, deadline };
    await addNote(note);
    await report(note, { preview: clip(text, 80) });
    if (!await releaseRemote(note, post, text, pr.project.name)) return 1;
    const instr = newInstruction({ band, projectId: pr.project.id, projectName: pr.project.name, loftName: loft.name, title, body: message, waitMin: post.waitTimeoutMin, model, effort });
    const q = codexQueue(bin, rs.thread.id, instr);
    if (!q.ok) { await move(band, { state: 'refused', error: q.error }); say(`被拒收：${q.error}`, `脚环 ${band}`); return 1; }
    await move(band, { state: 'flying', track: { queue_id: q.queueId } });
    const pid = await spawnWatcher(band);
    await patchNote(band, { track: { watcher: pid } });
  }
  say(`纸条已放飞：${band}（新开对话「${title}」）`,
    `鸽舍：${loft.name}${via === 'relay' ? '（经中继站转发，会跑一轮模型，有 token 成本）' : ''}`,
    `模型：${modelLabel(note) || (via === 'relay' ? '对方主机的默认设置' : '本机 Codex 设置')}`,
    `等回信：node "${PIGEON_SCRIPT}" wait ${band}　读回信：node "${PIGEON_SCRIPT}" read ${band}`);
  if (args.wait) return waitCmd({ _: [band], timeout: args.timeout });
  return 0;
}

/* ---------- 看进展 ---------- */
// 读记录，算出这张纸条现在的进展（不写日志）
export function progressOf(note) {
  const t = note.track || {};
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

export async function step(band) {
  const note = getNote(band);
  if (!note) return null;
  if (TERMINAL.has(note.state) && note.state !== 'lost') return note;
  return applyProgress(note, progressOf(note));
}

/* ---------- 后台看护 ---------- */
export async function watch(band) {
  let note = getNote(band);
  if (!note) return 1;
  try {
    if (note.track && note.track.method === 'exec') return await watchExec(note);
    const deadline = (note.track && note.track.deadline) || note.created + POST_DEFAULTS.waitTimeoutMin * 60000;
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

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function watchExec(note) {
  const band = note.band;
  const message = await readStdin();
  if (!message.trim()) { await move(band, { state: 'lost', error: '看护进程没收到纸条内容，没有发送。' }); return 1; }
  const bin = codexBin();
  const { codex: s } = await loadSettings();
  const t = note.track;
  const cliArgs = ['exec', '--json', '--skip-git-repo-check', '-C', t.cwd, '-s', s.sandbox && s.sandbox !== 'auto' ? s.sandbox : 'workspace-write'];
  const model = t.model || s.model, effort = t.effort || s.effort;
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

/* ---------- 回信 ---------- */
export function answerOf(note) {
  const p = progressOf(note);
  if (p.state === 'home') return { answer: p.answer, progress: p };
  // 迷路了但中继站有 JSON 里的回信，也拿出来给人看
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

const who = p => (p.agent === 'claude' ? 'Claude' : p.agent === 'you' ? '你' : p.agent || '?');
const where = to => `${to.title || to.session || '（新对话）'}${to.loft === LOCAL ? '' : '@' + (to.loft_name || to.loft)}`;
const elapsed = n => ago((TERMINAL.has(n.state) ? n.updated : Date.now()) - n.created);
const modelLabel = n => [n.model, n.effort].filter(Boolean).join(' · ');
const codexLink = n => (n.to.session && n.to.loft === LOCAL ? `codex://threads/${n.to.session}` : '');

export async function readCmd(args) {
  const band = args._[0];
  if (!isBand(band)) { console.error('用法：pigeon read <脚环>（形如 b-3f9a02c1d7）'); return 64; }
  let note = getNote(band);
  if (!note) { console.error(`飞行记录里没有 ${band}（只保留最近 7 天）。`); return 1; }
  const { answer, progress } = answerOf(note);
  note = (await applyProgress(note, progress)) || note;
  const lines = [`${band}　${STATE_ZH[note.state] || note.state}　${who(note.from)} → ${where(note.to)}　用时 ${elapsed(note)}${modelLabel(note) ? `　模型 ${modelLabel(note)}` : ''}`];
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
  if (!isBand(band)) { console.error('用法：pigeon wait <脚环> [--timeout 分钟]'); return 64; }
  const { post } = await loadSettings();
  const limit = Math.max(0.05, Number(args.timeout) || post.waitTimeoutMin) * 60000;
  const t0 = Date.now();
  let told = false;
  for (;;) {
    let note = getNote(band);
    if (!note) { console.error(`飞行记录里没有 ${band}。`); return 1; }
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
// 经中继站送到了、但当时没等到回信（迷路）的纸条：请中继站再等一次、再读一次。只读，不给对方发消息，所以不弹放飞确认。
export async function fetchCmd(args) {
  const band = args._[0];
  if (!isBand(band)) { console.error('用法：pigeon fetch <脚环> [--wait-min 分钟]'); return 64; }
  let note = getNote(band);
  if (!note) { console.error(`飞行记录里没有 ${band}（只保留最近 7 天）。`); return 1; }
  if (note.state === 'home') return readCmd({ _: [band] });
  if (note.via !== 'relay') { console.error('补取只用于经中继站发到远程的纸条。本机的纸条直接 pigeon wait / pigeon read。'); return 64; }
  if (note.state !== 'lost') { console.error(`这张纸条现在是「${STATE_ZH[note.state] || note.state}」，不用补取：${note.state === 'refused' ? '它没发出去。' : `等它：pigeon wait ${band}`}`); return 64; }
  if (!note.to.session) { console.error('飞行记录里没有对方的对话 id（可能根本没送到），没法补取。去 Codex 里看看，或者重新发。'); return 1; }
  const { post } = await loadSettings();
  const waitMin = Number(args['wait-min']) > 0 ? Number(args['wait-min']) : post.waitTimeoutMin;
  const rs = relayStatus(post);
  if (!rs.ok) { say(rs.error); return 3; }
  if (!codexAppRunning()) { say(HINT_APP); return 3; }
  const bin = codexBin();
  if (!bin) { say('Codex 不可用：没找到 codex 命令。'); return 3; }
  const fetchBand = newBand();
  const file = rs.thread.rollout || findRollout(rs.thread.id);
  const offset = fileSize(file);
  const host = note.track?.host || note.to.loft;
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
    if (p.state === 'home') { await applyProgress(note, p); await patchNote(band, { error: '' }); return readCmd({ _: [band] }); }
    // 中继站这一轮结束了但没拿到回信：留在迷路，换上这次的说明
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
  if (!notes.length) { say('还没有飞行记录。送一张：pigeon send --to <对话> "要说的话"'); return 0; }
  const d = ts => { const x = new Date(ts); return `${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; };
  const rows = notes.map(x => `${x.band}  ${d(x.created)}  ${(STATE_ZH[x.state] || x.state).padEnd(3, '　')}  ${who(x.from)} → ${where(x.to)}${x.via === 'relay' ? '（经中继）' : ''}  ${elapsed(x)}${x.count > 1 ? `  第 ${x.count} 程` : ''}${modelLabel(x) ? `  ${modelLabel(x)}` : ''}${x.error ? '\n    ' + oneLine(x.error, 120) : ''}`);
  say(`最近 ${notes.length} 张纸条（新的在上）：`, ...rows);
  return 0;
}

/* ---------- 鸽舍 ---------- */
export async function loftsCmd(args) {
  const { post } = await loadSettings();
  if (args.refresh) {
    const r = await refreshRemote(post);
    if (!r.ok) { say(r.error); return r.code || 1; }
  }
  const { lofts, error } = saveLofts({ relayThread: post.relayThread });
  if (args.json) { console.log(JSON.stringify(lofts, null, 2)); return 0; }
  const out = [];
  for (const l of lofts.lofts) {
    out.push(`${l.name}（${l.id}）${l.online ? '' : '　离线'}`);
    for (const s of (l.sessions || []).slice(0, Number(args.n) || 15)) out.push(`  ${s.id}  ${oneLine(s.title, 40)}${s.relay ? '　［中继站］' : ''}`);
    if ((l.sessions || []).length > (Number(args.n) || 15)) out.push(`  ……还有 ${l.sessions.length - (Number(args.n) || 15)} 条（-n 看更多）`);
    if (l.id !== LOCAL && (l.projects || []).length) out.push(`  项目：${l.projects.map(p => `${p.name}（${p.path}）`).join('、')}`);
  }
  if (error) out.push('', '注意：' + error);
  const remoteAge = lofts.remoteUpdated ? `远程鸽舍是 ${ago(Date.now() - lofts.remoteUpdated)}前经中继站读的` : '还没读过远程鸽舍';
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
  process.stderr.write('已请中继站读远程鸽舍，等它回来（通常半分钟到两分钟）…\n');
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
      saveLofts({ relayThread: post.relayThread, remote });
      if (p.errors.length) process.stderr.write('部分工具调用失败：' + p.errors.join('；') + '\n');
      return { ok: true };
    }
  }
  return { ok: false, error: '刷新超时：中继站 5 分钟内没有回来。缓存没有改。' };
}

/* ---------- relay ---------- */
export async function relayCmd(args) {
  const sub = args._[0] || '';
  const { post } = await loadSettings();
  if (sub === 'use') {
    let id = args._[1] || '';
    if (!id) { console.error('用法：pigeon relay use <对话id|latest>'); return 64; }
    let t = id === 'latest' ? latestRelayCandidate() : getThread(id);
    if (!t) { say(id === 'latest' ? '没找到合适的对话：' + HINT_RELAY_UNSET : `本机没找到对话 ${id}。`); return 1; }
    if (t.approval === 'never') { say(HINT_RELAY_NEVER); return 1; }
    const w = await patchSettings(s => { s.post = { ...POST_DEFAULTS, ...(s.post || {}), relayThread: t.id }; });
    if (!w.ok) { say('没保存成功：' + w.error); return 1; }
    saveLofts({ relayThread: t.id });
    say(`中继站设为「${t.title}」（${t.id}），已保存到${w.where}。`,
      t.source === 'exec' ? '注意：这条对话是 codex exec 建的，拿不到 codex_app 工具，转发会失败。' : '远程发送时 Codex 可能会弹审批，需要你在 Codex 应用里点同意。');
    return 0;
  }
  if (sub === 'check') return relayCheck(post);
  const rs = relayStatus(post);
  if (!post.relayThread) { say(HINT_RELAY_UNSET); return 0; }
  say(`中继站：${rs.thread ? `「${rs.thread.title}」` : ''}${post.relayThread}`, rs.ok ? '状态：可用（详细检查：pigeon relay check）' : '问题：' + rs.error);
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
  items.push({ ok: true, info: true, label: '远程鸽舍缓存', detail: remotes.length ? remotes.map(l => `${l.name}（${(l.sessions || []).length} 条对话）`).join('、') : '还没有，pigeon lofts --refresh 读一次' });
  const lines = items.map(i => `${i.info ? '  ·' : i.ok ? '  通过' : '  不行'}　${i.label}${i.detail ? '：' + i.detail : ''}`);
  const bad = items.filter(i => !i.ok);
  say('中继站检查（只读，不发消息）：', ...lines, bad.length ? `\n有 ${bad.length} 项不行，远程发送暂时用不了。` : '\n可以经中继站往远程发送。');
  return bad.length ? 1 : 0;
}

export { listThreads };
