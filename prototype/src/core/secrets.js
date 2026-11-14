// 跨设备发送前查一遍：消息里像密钥、token 的字符串。纯函数，不碰 DOM。
const SECRET = /\b(?:npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,})/g;

export const secretKind = m => m.startsWith('npm_') ? 'npm token' : m.startsWith('gh') ? 'GitHub token' : m.startsWith('sk-') ? 'API key' : m.startsWith('AKIA') ? 'AWS 密钥' : 'Slack token';
export const secretsIn = v => String(v).match(SECRET) || [];

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
