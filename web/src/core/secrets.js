// 跨设备发送前查一遍：消息里像密钥、token 的字符串。纯函数，不碰 DOM。
// 规则和命令行那份（plugin/scripts/lib/secrets.mjs）、原生刘海那份（mac/Notch 的 Secrets.swift）一样，三处跑同一份用例 tests/fixtures/secrets-cases.json
const SECRET = /\b(?:npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[0-9A-Z]{16}\b|xox[abprs]-[A-Za-z0-9-]{10,})|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;

export const secretKind = m => m.startsWith('npm_') ? 'npm token' : m.startsWith('gh') || m.startsWith('github_pat_') ? 'GitHub token' : m.startsWith('sk-') ? 'API key'
  : m.startsWith('AKIA') || m.startsWith('ASIA') ? 'AWS 密钥' : m.startsWith('-----BEGIN') ? '私钥' : 'Slack token';
export const secretsIn = v => String(v).match(SECRET) || [];
// 查到哪几类，按出现的先后、去重
export const kindsIn = v => [...new Set(secretsIn(v).map(secretKind))];
// 打码后对方收到的文字：每个密钥换成“‹类别 已打码›”（共用用例 tests/fixtures/secrets-cases.json）
export const maskSecrets = v => String(v).replace(SECRET, m => `‹${secretKind(m)} 已打码›`);

// 把一段话切成普通文字和密钥两种片段，界面再决定标红还是打码：[{ text } | { secret, kind }]
export function splitSecrets(v) {
  const s = String(v), out = [];
  let at = 0;
  for (const m of s.matchAll(SECRET)) {
    if (m.index > at) out.push({ text: s.slice(at, m.index) });
    out.push({ secret: m[0], kind: secretKind(m[0]) });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}
