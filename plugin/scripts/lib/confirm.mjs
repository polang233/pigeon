// 跨电脑送信前，让人在屏幕上点一下。
// 为什么要有：实测（2026-11-11）中继站对话收到带“我授权本次发送”的指令会直接照办，Codex 不弹审批。
// 也就是说，任何能跑 pigeon send 的 agent 都能不经人同意往另一台电脑发消息。这一步把同意放回人手里。
// 弹不出框、超时、被拦下，都算没同意，不发。
// 现在这个系统框只在 Pigeon 应用没开（或问不通）时才用，平时是在应用自己的面板里问（见 meta.mjs 的 askApp）。
// 这是护栏，不是安全边界：有 shell 权限的 agent 仍然能改设置文件或脚本绕过。
import { spawnSync } from 'node:child_process';

export const CONFIRM_WAIT_S = 90; // 比 Claude Code 的 Bash 默认超时（120 秒）短，免得命令先被杀掉
const SHOW_CHARS = 600;

const SCRIPT = [
  'on run argv',
  'tell me to activate',
  'set r to display dialog (item 1 of argv) with title "Pigeon 信鸽" buttons {"拦下", "放行"} default button "拦下" cancel button "拦下" giving up after ((item 2 of argv) as integer) with icon note',
  'if gave up of r then return "timeout"',
  'return "ok"',
  'end run',
];

// 确认框里的文字。正文只在这里显示，不写进任何文件。
const WHO = { codex: 'Codex', cursor: 'Cursor', deepseek: 'DeepSeek Harness', antigravity: 'Antigravity' };
const TO_AGENT = { codex: 'Codex', deepseek: 'DeepSeek Harness', antigravity: 'Antigravity' };

// ask：cross 往另一台电脑发；relay 接活的 agent 想把活再交给别人（本机的也问）
export function confirmText({ band, from, kind, ask = 'cross', to, project, text, secrets }, waitS = CONFIRM_WAIT_S) {
  const who = from && from.agent === 'claude' ? `Claude Code（对话 ${String(from.session || '').slice(0, 8) || '未知'}）`
    : WHO[from && from.agent] || (ask === 'relay' ? '一个经 Pigeon MCP 接入的 agent' : '终端里的命令');
  const body = String(text || '').trim();
  const shown = body.length > SHOW_CHARS ? body.slice(0, SHOW_CHARS) + '…' : body;
  const more = body.length > SHOW_CHARS ? `\n（共 ${body.length} 字，这里只显示前 ${SHOW_CHARS} 字）` : '';
  // 跨设备的收件人都是 Codex，不写；转派要写清交给哪家
  const agentName = ask === 'relay' ? ` ${TO_AGENT[to.agent] || 'Codex'} ` : '';
  const dest = kind === 'new'
    ? `在 ${to.loft_name} 的项目「${project || '未命名'}」里新开${agentName}对话「${to.title}」`
    : `${to.loft_name} 上的${agentName}对话「${to.title || to.session}」`;
  return [
    ask === 'relay' ? `${who}想把活转给别的 agent。` : `${who}想往另一台电脑发一条消息。`,
    '',
    `送到：${dest}`,
    `编号：${band}`,
    ...(secrets && secrets.length ? ['', `注意：内容里疑似有密钥（${secrets.join('、')}）。`] : []),
    '',
    '内容：',
    shown + more,
    '',
    `${waitS} 秒内不点，就当作拦下。`,
  ].join('\n');
}

// 被拦下、没人点的说明文字。应用里的面板和系统框共用，所以写在这里。
export const deniedError = () => '用户在确认框里拦下了这条消息，没有发送。不要重发，也不要换别的办法发；需要的话先问用户。';
export const timeoutError = (waitS, where = '确认框') => `${where}等了 ${waitS} 秒没人点，消息没有发送。用户可能不在电脑前，不要自动重发。`;

// 返回 { ok: true } 或 { ok: false, reason: 'denied' | 'timeout' | 'unavailable', error }
export function confirmRemote(info, waitS = CONFIRM_WAIT_S) {
  const text = confirmText(info, waitS);
  const wait = String(waitS);
  const custom = process.env.PIGEON_CONFIRM_BIN; // 只给测试用
  if (!custom && process.platform !== 'darwin') {
    return { ok: false, reason: 'unavailable', error: '这台电脑上弹不出确认框，跨电脑的消息没有发送。' };
  }
  const r = custom
    ? spawnSync(custom, [text, wait], { encoding: 'utf8', timeout: (waitS + 15) * 1000 })
    : spawnSync('/usr/bin/osascript', [...SCRIPT.flatMap(l => ['-e', l]), text, wait], { encoding: 'utf8', timeout: (waitS + 15) * 1000 });
  const out = String(r.stdout || '').trim();
  if (r.status === 0 && out === 'ok') return { ok: true };
  if (r.status === 0 && out === 'timeout') {
    return { ok: false, reason: 'timeout', error: timeoutError(waitS) };
  }
  if (/-128|User canceled|用户已取消/i.test(String(r.stderr || '')) || (custom && r.status === 1)) {
    return { ok: false, reason: 'denied', error: deniedError() };
  }
  const why = (r.error && r.error.message) || String(r.stderr || '').trim().split('\n').pop() || `退出码 ${r.status}`;
  return { ok: false, reason: 'unavailable', error: `确认框没能弹出来（${why.slice(0, 120)}），消息没有发送。` };
}
