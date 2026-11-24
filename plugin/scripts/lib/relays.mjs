// 中继站对话：所有远程设备默认共用一条（post.relayThread），某台远程设备可以单独用一条（post.relayByHost[主机 id]）。
// 用过的都记在 post.relayUsed，接入页列出来，能归档、删除。
// 这里只管“用哪条”和“它多大”，真正往里排消息在 post.mjs。
import fs from 'node:fs';
import zlib from 'node:zlib';

// 上一轮读进去的上下文超过这么多 token，就提醒换一条（每转发一次都要把它整个读一遍）
export const RELAY_WARN_TOKENS = 150000;
// 记多少条用过的
export const RELAY_USED_MAX = 20;

const str = v => (typeof v === 'string' ? v.trim() : '');
const uniq = a => [...new Set(a.filter(Boolean))];

// 设置里的三个字段整理成干净的样子
export function normRelay(post) {
  const by = post.relayByHost && typeof post.relayByHost === 'object' && !Array.isArray(post.relayByHost) ? post.relayByHost : {};
  post.relayThread = str(post.relayThread);
  post.relayByHost = Object.fromEntries(Object.entries(by).map(([h, id]) => [h, str(id)]).filter(([h, id]) => h && id));
  post.relayUsed = uniq((Array.isArray(post.relayUsed) ? post.relayUsed : []).map(str)).slice(0, RELAY_USED_MAX);
  return post;
}

// 往这台主机发用哪条：它单独指定的，没有就用共用的
export const relayFor = (post, host = '') => (host && post.relayByHost && post.relayByHost[host]) || post.relayThread || '';
// 现在在用的全部中继站（共用的 + 各台单独的）
export const relayIds = post => uniq([post.relayThread, ...Object.values(post.relayByHost || {})]);
export const isRelay = (post, id) => !!id && relayIds(post).includes(id);
// 哪几台单独用这条
export const hostsOf = (post, id) => Object.entries(post.relayByHost || {}).filter(([, v]) => v === id).map(([h]) => h);

// 换中继站：host 为空换共用的；id 为空表示这台不再单独用（跟着共用的）。换下来的和换上去的都记进用过的
export function useRelay(post, id, host = '') {
  const old = relayFor(post, host);
  if (host) {
    const by = { ...(post.relayByHost || {}) };
    if (id) by[host] = id; else delete by[host];
    post.relayByHost = by;
  } else post.relayThread = id;
  post.relayUsed = uniq([id, old, ...(post.relayUsed || [])]).slice(0, RELAY_USED_MAX);
  return post;
}
// 删掉以后从用过的里去掉
export const forgetRelay = (post, id) => { post.relayUsed = (post.relayUsed || []).filter(x => x !== id); return post; };

// 读对话记录的最后一段。Codex 会把闲着的记录压成 .jsonl.zst，那样就整个解压
export function readTail(file, bytes = 1 << 20) {
  if (!file) return '';
  try {
    if (fs.existsSync(file)) {
      const size = fs.statSync(file).size, n = Math.min(size, bytes), buf = Buffer.alloc(n);
      const fd = fs.openSync(file, 'r');
      try { fs.readSync(fd, buf, 0, n, size - n); } finally { fs.closeSync(fd); }
      return buf.toString('utf8');
    }
    const z = file.endsWith('.zst') ? file : file + '.zst';
    if (fs.existsSync(z) && typeof zlib.zstdDecompressSync === 'function') {
      const t = zlib.zstdDecompressSync(fs.readFileSync(z)).toString('utf8');
      return t.slice(-bytes);
    }
  } catch {}
  return '';
}

// 上一轮读进去多少 token（context），模型的上下文窗口多大（window）。读不到是 null
export function contextOf(file) {
  const t = readTail(file);
  if (!t) return null;
  const last = (re) => { let m, v = null; re.lastIndex = 0; while ((m = re.exec(t))) v = Number(m[1]); return v; };
  const context = last(/"last_token_usage":\{"input_tokens":(\d+)/g);
  if (context == null) return null;
  return { context, window: last(/"model_context_window":(\d+)/g) || 0 };
}

// 接入页要的整张表：现在在用的在前，用过的在后
export function relayRows(post, { thread, findRollout = () => '' }) {
  const ids = uniq([...relayIds(post), ...(post.relayUsed || [])]);
  return ids.map(id => {
    const t = thread(id);
    const c = t ? contextOf(t.rollout || findRollout(id)) : null;
    return {
      id, title: t ? t.title : '', missing: !t, archived: !!(t && t.archived), updated: t ? t.updated : 0,
      model: (t && t.model) || '', effort: (t && t.effort) || '', tokensUsed: (t && t.tokensUsed) || 0,
      context: c ? c.context : null, window: c ? c.window : 0,
      approval: (t && t.approval) || '', source: (t && t.source) || '',
      shared: id === post.relayThread, hosts: hostsOf(post, id),
    };
  });
}
