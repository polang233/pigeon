// 接入页“用量”：把 GET /api/usage 的摘要（见 docs/CONTRACT.md「用量统计」）换成按 agent、按家的占比。纯函数，不碰 DOM。
// 数据只有应用读到的本机对话记录：Claude Code（含子代理）和 Codex，每个 agent 记的是总量和最近用的那个模型，
// 所以“哪家”按最近的模型名猜，猜不出按 agent 自己的那家。

// agent 的名字（用量接口里的键，不是界面里的 agent 键）
export const UNAME = { claude: 'Claude Code', subagent: 'Claude Code 子代理', codex: 'Codex', cursor: 'Cursor', deepseek: 'DeepSeek Harness', antigravity: 'Antigravity' };
// 用量接口的键 → 界面里的 agent（画标志、取颜色用）
export const UAGENT = { claude: 'claude', subagent: 'claude', codex: 'codex', cursor: 'cursor', deepseek: 'dsh', dsh: 'dsh', antigravity: 'antigravity' };
// 哪家：名字和颜色变量
export const FAM = {
  claude: { name: 'Claude', c: 'var(--claude)' },
  chatgpt: { name: 'ChatGPT', c: 'var(--codex)' },
  gemini: { name: 'Gemini', c: 'var(--antigravity)' },
  deepseek: { name: 'DeepSeek', c: 'var(--dsh)' },
  cursor: { name: 'Cursor', c: 'var(--cursor)' },
  other: { name: '其他', c: 'var(--faint)' },
};
const AGENT_FAM = { claude: 'claude', subagent: 'claude', codex: 'chatgpt', cursor: 'cursor', deepseek: 'deepseek', dsh: 'deepseek', antigravity: 'gemini' };
export function famOf(agent, model = '') {
  const m = String(model || '').toLowerCase().replace(/^[\w-]+\//, '');
  if (/^(claude|opus|sonnet|haiku)/.test(m)) return 'claude';
  if (/^(gpt|o\d|codex|chatgpt)/.test(m)) return 'chatgpt';
  if (/^gemini/.test(m)) return 'gemini';
  if (/^deepseek/.test(m)) return 'deepseek';
  return AGENT_FAM[agent] || 'other';
}

// 口径：all 是输入、输出、缓存读、缓存写加起来（模型实际读写的 token），output 只算输出
export const METRIC = { all: '全部 token', output: '只算输出' };
export const PERIOD = { today: '今天', week: '近 7 天' };
const num = v => Math.max(0, Number(v) || 0);
export const tokensOf = (t, metric) => (!t || typeof t !== 'object' ? 0 : metric === 'output' ? num(t.output) : num(t.input) + num(t.output) + num(t.cacheRead) + num(t.cacheWrite));

// U：接口原样的摘要或 null。返回 null（没读到）或 { total, rows, fams }：rows 按用量从多到少，pct 是 0–100 的整数（四舍五入，加起来不一定正好 100）
export function usageShare(U, period = 'week', metric = 'all') {
  if (!U || typeof U !== 'object' || !U.agents || typeof U.agents !== 'object') return null;
  const rows = Object.entries(U.agents).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => {
    const t = v[period] && typeof v[period] === 'object' ? v[period] : {};
    return { k, name: UNAME[k] || k, a: UAGENT[k] || '', model: String(v.model || ''), fam: famOf(k, v.model), n: tokensOf(t, metric), t };
  }).filter(r => r.n > 0);
  const total = rows.reduce((s, r) => s + r.n, 0);
  const pct = n => (total ? Math.round((n / total) * 100) : 0);
  rows.sort((x, y) => y.n - x.n || x.k.localeCompare(y.k));
  rows.forEach(r => { r.pct = pct(r.n); });
  const byFam = new Map();
  for (const r of rows) byFam.set(r.fam, (byFam.get(r.fam) || 0) + r.n);
  const fams = [...byFam].map(([fam, n]) => ({ fam, name: (FAM[fam] || FAM.other).name, n, pct: pct(n) })).sort((x, y) => y.n - x.n);
  return { total, rows, fams };
}

// 1234 → 1234，56789 → 5.7 万，56688000 → 5669 万（上千万不带小数），123456789 → 1.2 亿
export const fmtTokens = n => {
  const v = Math.max(0, Number(n) || 0), u = v >= 1e8 ? 1e8 : v >= 1e4 ? 1e4 : 1;
  if (u === 1) return String(Math.round(v));
  return String(Number((v / u).toFixed(u === 1e4 && v >= 1e7 ? 0 : 1))) + (u === 1e8 ? ' 亿' : ' 万');
};
