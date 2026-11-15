// 设备（电脑）和上面的对话。本机现读 sqlite，远程的来自上一次经中继站刷新的缓存 ~/.pigeon/lofts.json。
import { loftsFile, readJson, writeJsonAtomic, LOCAL, LOCAL_NAME } from './common.mjs';
import { listThreads, listProjects, searchThreads, getThread } from './codex-state.mjs';

export function readLofts(file = loftsFile()) {
  const j = readJson(file, null);
  if (!j || !Array.isArray(j.lofts)) return { version: 1, updated: 0, lofts: [] };
  return j;
}

export function localLoft(relayThread = '') {
  const t = listThreads({ limit: 40 });
  return {
    loft: {
      id: LOCAL, name: LOCAL_NAME, online: true,
      sessions: t.rows.map(r => ({ id: r.id, agent: 'codex', title: r.title, cwd: r.cwd, updated: r.updated, relay: r.id === relayThread })),
      projects: listProjects(),
    },
    error: t.ok ? '' : t.error,
  };
}

// 写缓存：本机部分每次重建，远程部分用传进来的（没传就沿用旧缓存）
export function saveLofts({ relayThread = '', remote = null } = {}, file = loftsFile()) {
  const old = readLofts(file);
  const { loft, error } = localLoft(relayThread);
  const remotes = remote || old.lofts.filter(l => l.id !== LOCAL);
  const out = { version: 1, updated: Date.now(), lofts: [loft, ...remotes] };
  if (remote) out.remoteUpdated = Date.now();
  else if (old.remoteUpdated) out.remoteUpdated = old.remoteUpdated;
  writeJsonAtomic(file, out);
  return { lofts: out, error };
}

export function findLoft(lofts, term) {
  const t = String(term || '').trim().toLowerCase();
  if (!t || t === LOCAL || t === LOCAL_NAME.toLowerCase()) return lofts.find(l => l.id === LOCAL) || { id: LOCAL, name: LOCAL_NAME, sessions: [], projects: [] };
  const all = lofts.filter(l => l.id !== LOCAL);
  return all.find(l => l.id.toLowerCase() === t)
    || all.find(l => (l.name || '').toLowerCase() === t)
    || all.find(l => l.id.toLowerCase().endsWith(t))
    || null;
}

const pick = (cands, term, key = 'title') => {
  const exact = cands.filter(c => c.id === term || (c[key] || '') === term || (c.name || '') === term);
  if (exact.length) return exact;
  const pre = cands.filter(c => term.length >= 6 && c.id.startsWith(term));
  if (pre.length) return pre;
  return cands.filter(c => (c[key] || '').includes(term));
};

// 解析 --to：<对话id|标题>[@<设备名或id>]
// 返回 { ok, target? , error?, candidates? }
// target = { loft, loft_name, session, title, cwd, approval?, rollout? }
export function resolveTarget(spec, lofts = readLofts().lofts) {
  const s = String(spec || '').trim();
  if (!s) return { ok: false, error: '缺少收件人：用 --to <对话id或标题>，远程写成 <对话>@<设备>' };
  const at = s.lastIndexOf('@');
  const who = at > 0 ? s.slice(0, at).trim() : s;
  const where = at > 0 ? s.slice(at + 1).trim() : '';

  if (where) {
    const loft = findLoft(lofts, where);
    if (!loft) return { ok: false, notFound: true, error: `没找到设备「${where}」。先跑 pigeon lofts 看看有哪些；远程设备要先 pigeon lofts --refresh` };
    if (loft.id !== LOCAL) {
      const c = pick(loft.sessions || [], who);
      if (c.length > 1) return { ok: false, error: `「${who}」在 ${loft.name} 上对上了 ${c.length} 条对话，请用对话 id`, candidates: c };
      if (c.length === 1) return { ok: true, target: { loft: loft.id, loft_name: loft.name, session: c[0].id, title: c[0].title || '', cwd: c[0].cwd || '' } };
      // 缓存里没有，但看起来是完整的对话 id：照样交给中继站，让对方那边判断
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(who)) return { ok: true, target: { loft: loft.id, loft_name: loft.name, session: who, title: '', cwd: '' } };
      return { ok: false, notFound: true, error: `${loft.name} 上没找到对话「${who}」。缓存可能旧了，可以 pigeon lofts --refresh（有 token 成本）` };
    }
  }

  // 本机
  const c = pick(searchThreads(who), who);
  if (c.length > 1) return { ok: false, error: `「${who}」对上了 ${c.length} 条本机对话，请用对话 id`, candidates: c };
  if (c.length === 1) {
    const t = c[0];
    return { ok: true, target: { loft: LOCAL, loft_name: LOCAL_NAME, session: t.id, title: t.title, cwd: t.cwd, approval: t.approval, rollout: t.rollout, archived: t.archived } };
  }
  if (!where) {
    // 没写设备，但 id 在某个远程设备的缓存里
    for (const l of lofts.filter(x => x.id !== LOCAL)) {
      const r = (l.sessions || []).filter(x => x.id === who);
      if (r.length === 1) return { ok: true, target: { loft: l.id, loft_name: l.name, session: r[0].id, title: r[0].title || '', cwd: r[0].cwd || '' } };
    }
  }
  return { ok: false, notFound: true, error: `本机没找到对话「${who}」。用 pigeon lofts 看看有哪些；远程对话写成 <对话>@<设备>` };
}

// 解析 new 的 --project
export function resolveProject(loft, term) {
  const ps = loft.projects || [];
  const t = String(term || '').trim();
  if (!t) {
    if (loft.id !== LOCAL && ps.length === 1) return { ok: true, project: ps[0] };
    if (loft.id === LOCAL) return { ok: true, project: null };
    return { ok: false, error: ps.length ? `${loft.name} 上有 ${ps.length} 个项目，请用 --project 指定：${ps.map(p => p.name).join('、')}` : `${loft.name} 上没有已知的项目。先 pigeon lofts --refresh` };
  }
  const hit = ps.filter(p => p.id === t || p.name === t || p.path === t);
  if (hit.length === 1) return { ok: true, project: hit[0] };
  if (hit.length > 1) return { ok: false, error: `项目「${t}」不唯一，请用项目 id：${hit.map(p => p.id).join('、')}` };
  if (loft.id === LOCAL) return { ok: true, project: { id: '', name: t, path: t } };
  return { ok: false, error: `${loft.name} 上没找到项目「${t}」。已知的项目：${ps.map(p => p.name).join('、') || '无'}` };
}

export { getThread };
