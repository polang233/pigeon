// 跨设备发送前查密钥：找出疑似密钥的类别，或者把它们换成占位符。
// 只认几种长得很固定的密钥，宁可漏也不要误伤普通文字。用例在 tests/fixtures/secrets-cases.json，网页那份实现跑同一个文件。
// 占位符的写法固定：‹类别 已打码›

// 顺序无所谓：命中后按出现位置排序；位置重叠的，先出现的、同位置先写的算数。
const RULES = [
  { kind: 'npm token', re: /\bnpm_[A-Za-z0-9]{20,}/g },
  { kind: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { kind: 'API key', re: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { kind: 'AWS 密钥', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: '私钥', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
];

export const placeholder = kind => `‹${kind} 已打码›`;

function hits(text) {
  const all = [];
  for (const { kind, re } of RULES) {
    re.lastIndex = 0;
    for (const m of String(text || '').matchAll(re)) all.push({ kind, start: m.index, end: m.index + m[0].length });
  }
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let edge = -1;
  for (const h of all) { if (h.start >= edge) { out.push(h); edge = h.end; } }
  return out;
}

// 类别：按出现顺序、去重
export function detectSecrets(text) {
  return [...new Set(hits(text).map(h => h.kind))];
}

// 打码：返回 { text, kinds }
export function maskSecrets(text) {
  const src = String(text || '');
  const hs = hits(src);
  let out = '', pos = 0;
  for (const h of hs) { out += src.slice(pos, h.start) + placeholder(h.kind); pos = h.end; }
  return { text: out + src.slice(pos), kinds: [...new Set(hs.map(h => h.kind))] };
}
