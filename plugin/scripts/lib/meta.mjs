// 消息上的附加信息：为什么给它（why）、交出去多少（ctx），以及向应用发问（/api/ask）。
import { request } from './common.mjs';

/* ---------- ctx：交出去的上下文 ---------- */
// 没有 --ctx-tokens 时按文字估：汉字等宽字符一个字算 1，其余 4 个字符算 1
export function estimateTokens(text) {
  let wide = 0, other = 0;
  for (const ch of String(text || '')) { if (/[⺀-鿿가-힯＀-￯]/.test(ch)) wide++; else other++; }
  return wide + Math.ceil(other / 4);
}

export function ctxOf(args, text) {
  const files = String(args['ctx-files'] === true ? '' : args['ctx-files'] || '').split(',').map(s => s.trim()).filter(Boolean);
  const given = Number(args['ctx-tokens']);
  const has = args['ctx-tokens'] != null && args['ctx-tokens'] !== true && Number.isFinite(given) && given >= 0;
  const ctx = { tokens: has ? Math.round(given) : estimateTokens(text), files };
  if (!has) ctx.estimated = true;
  return ctx;
}

/* ---------- why：为什么给它 ---------- */
// 先写指挥给的理由；再问应用的分派规则，拿 kind / rule / suggested。应用没开或没回就是 lead（指挥自己判断）。
// 只等很短的时间：派活不能因为这个慢下来。
export const SUGGEST_TIMEOUT_MS = 1500;
const KINDS = ['rule', 'quota', 'override', 'lead'];

export async function whyOf(reason, text, toKey) {
  const why = { kind: 'lead', reason: typeof reason === 'string' ? reason.trim() : '' };
  const body = { text: String(text || '').slice(0, 4000) };
  if (toKey) body.to = toKey;
  const r = await request('POST', '/api/dispatch/suggest', body, SUGGEST_TIMEOUT_MS);
  if (!r || r.status !== 200 || !r.json || typeof r.json !== 'object') return why;
  const j = r.json;
  if (KINDS.includes(j.kind)) why.kind = j.kind;
  if (j.rule) why.rule = String(j.rule);
  if (j.suggested) {
    const s = String(j.suggested), at = s.indexOf('@');
    why.suggested = at > 0 ? { agent: s.slice(0, at), loft: s.slice(at + 1) } : { agent: s, loft: '' };
  }
  return why;
}
// 给 /api/dispatch/suggest 的 to：<agent>@<设备 id>
export const toKeyOf = to => `codex@${to.loft}`;

/* ---------- 问应用：等用户在 Pigeon 自己的面板里决定 ---------- */
export const ASK_ACTIONS = ['release', 'release_masked', 'block', 'timeout'];
const chars = (s, n) => Array.from(String(s || '')).slice(0, n).join('');

// 连接一直挂着，直到用户决定。客户端的等待上限是 timeoutSec + 15 秒。
// 返回 'release' | 'release_masked' | 'block' | 'timeout'；应用没开、请求失败、连接断了、回的东西看不懂，都返回 null（调用方退回系统对话框）。
export async function askApp({ band, from, to, preview, text, files, project, rule, secrets, timeoutSec }) {
  const body = {
    kind: 'cross', band, from,
    to: { loft: to.loft, loft_name: to.loft_name, agent: to.agent || 'codex', session: to.session || '', title: to.title || '' },
    preview, text: chars(text, 4000), chars: Array.from(String(text || '')).length,
    files: files || [], project: project || '', rule: rule || '', secrets: secrets || [], timeoutSec,
  };
  // 应用自己派的活（POST /api/send）给子进程带了这个号：应用认出来后先回界面“已排进等你的一队”，不用等到你点确认
  if (process.env.PIGEON_SEND_ID) body.send_id = process.env.PIGEON_SEND_ID;
  const r = await request('POST', '/api/ask', body, (timeoutSec + 15) * 1000);
  if (!r || r.status !== 200 || !r.json || typeof r.json !== 'object') return null;
  return ASK_ACTIONS.includes(r.json.action) ? r.json.action : null;
}
