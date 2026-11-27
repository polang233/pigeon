// 任务记录 ~/.pigeon/journal.json：Pigeon 命令写，Mac 应用读。只存元数据，不存正文。
// 发件的命令、后台看护进程、wait 可能同时写，所以写之前先拿一把目录锁，写临时文件再改名。
import fs from 'node:fs';
import path from 'node:path';
import { journalFile, pigeonDir, readJson, writeJsonAtomic, sleep } from './common.mjs';

// 原来的六个状态不变，前面加一个 asking（等用户确认）。asking 只能走到 queued、flying、refused。
export const STATES = ['asking', 'queued', 'flying', 'delivered', 'home', 'refused', 'lost'];
// 没发出的原因
export const REASONS = ['blocked', 'timeout', 'no_target', 'max_hops', 'offline'];
export const TERMINAL = new Set(['home', 'refused', 'lost']);
const RANK = { asking: -1, queued: 0, flying: 1, delivered: 2, home: 3, refused: 3, lost: 3 };
export const KEEP_MS = 7 * 24 * 3600 * 1000;
export const STATE_ZH = { asking: '等你确认', queued: '排队', flying: '进行中', delivered: '已送达', home: '已回信', refused: '没发出', lost: '没回音' };

// 状态只能往前走；唯一的例外是“没回音”后来又等到了回信，可以改成“已回信”。
export function canMove(from, to) {
  if (!STATES.includes(to)) return false;
  if (from === to) return false;
  if (from === 'lost' && to === 'home') return true;
  if (TERMINAL.has(from)) return false;
  if (from === 'asking') return to === 'queued' || to === 'flying' || to === 'refused';
  return RANK[to] > RANK[from];
}

export function readJournal(file = journalFile()) {
  const j = readJson(file, null);
  if (!j || !Array.isArray(j.notes)) return { version: 1, notes: [] };
  return { version: 1, notes: j.notes };
}

export function prune(notes, now = Date.now()) {
  return notes.filter(n => now - (n.updated || n.created || 0) < KEEP_MS);
}

async function withLock(file, fn) {
  const lock = file + '.lock';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let i = 0; ; i++) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) { fs.rmSync(lock, { recursive: true, force: true }); continue; } } catch {}
      if (i > 400) throw new Error('任务记录被占用太久，没能写入：' + lock);
      await sleep(25);
    }
  }
  try { return await fn(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

let lastPruned = 0;
// 清理超过 7 天的临时正文、回信和 run 日志（~/.pigeon/{bodies,answers,runs}）
export function pruneArtifacts(dir = pigeonDir(), now = Date.now(), { force = false } = {}) {
  if (!force && now - lastPruned < 10 * 60 * 1000) return 0;
  lastPruned = now;
  let removed = 0;
  for (const sub of ['bodies', 'answers', 'runs']) {
    const full = path.join(dir, sub);
    let names;
    try { names = fs.readdirSync(full); } catch { continue; }
    for (const name of names) {
      const f = path.join(full, name);
      try {
        const st = fs.statSync(f);
        if (st.isFile() && now - st.mtimeMs >= KEEP_MS) { fs.rmSync(f, { force: true }); removed++; }
      } catch {}
    }
  }
  return removed;
}

// mutate(notes) 可以原地改；返回值透传给调用方
export function updateJournal(mutate, file = journalFile()) {
  return withLock(file, async () => {
    const j = readJournal(file);
    const out = await mutate(j.notes);
    j.notes = prune(j.notes);
    writeJsonAtomic(file, j);
    if (file === journalFile()) pruneArtifacts(path.dirname(file));
    return out;
  });
}

export const addNote = (note, file) => updateJournal(notes => { notes.push(note); return note; }, file);
export const getNote = (band, file) => readJournal(file).notes.find(n => n.band === band) || null;

// 改一条消息。patch 里有 state 时按 canMove 判断；不允许的状态变化整条丢弃，返回 null。
// 返回 { note, moved }：moved 表示状态真的变了（只有变了的那一方发事件，避免重复上报）。
export function patchNote(band, patch, file) {
  return updateJournal(notes => {
    const n = notes.find(x => x.band === band);
    if (!n) return null;
    let moved = false;
    if (patch.state && patch.state !== n.state) {
      if (!canMove(n.state, patch.state)) return null;
      moved = true;
    }
    const { to, track, ...rest } = patch;
    Object.assign(n, rest);
    if (to) n.to = { ...n.to, ...to };
    if (track) n.track = { ...(n.track || {}), ...track };
    n.updated = Date.now();
    return { note: structuredClone(n), moved };
  }, file);
}

export function recent(n = 20, file) {
  return readJournal(file).notes.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, n);
}
