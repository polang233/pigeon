#!/usr/bin/env node
// 测试用的假 codex 命令：不联网、不碰真实的 Codex，只往 $CODEX_HOME 下的假 rollout 里写记录。
// FAKE_CODEX_MODE：
//   reply（默认）  queue 后立刻写完整的一轮，回复“收到：<第一行>”
//   silent        queue 成功但对方一直不接手
//   fail          queue 失败
//   relay-ok      对中继站排队：写一轮带 send_message_to_thread / wait_threads 的记录
//   relay-never   对中继站排队：send_message_to_thread 因审批策略 never 失败
//   relay-lofts   对中继站排队：写 list_projects / list_threads 的记录
//   relay-lost    对中继站排队：消息发出了，但 wait_threads 超时，没等到回信
//   relay-fetch   对中继站排队：补取回信，写 wait_threads / read_thread 的记录
// 每次调用都追加一行到 $FAKE_CODEX_LOG，方便测试检查参数。
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const home = process.env.CODEX_HOME;
const mode = process.env.FAKE_CODEX_MODE || 'reply';
if (process.env.FAKE_CODEX_LOG) fs.appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({ argv, env: { PIGEON_TASK_ID: process.env.PIGEON_TASK_ID || '', MEERKAT_TASK_ID: process.env.MEERKAT_TASK_ID || '' } }) + '\n');

const HOST = 'remote-control:env_e_0000test0000aaaa';
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };
let ord = 0;
const L = (type, payload) => JSON.stringify({ timestamp: new Date().toISOString(), ordinal: ord++, type, payload });
const dayDir = () => path.join(home, 'sessions', '2026', '11', '11');
function rolloutOf(id) {
  const root = path.join(home, 'sessions');
  const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { const r = walk(p); if (r) return r; } else if (f.name.endsWith(`-${id}.jsonl`)) return p;
  } return ''; };
  try { return walk(root); } catch { return ''; }
}
const turn = (thread, id, text, tools, answer) => [
  L('event_msg', { type: 'task_started', turn_attribution: { turn_id: id, turn_trigger: 'queue' }, turn_id: id }),
  L('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text }], internal_chat_message_metadata_passthrough: { turn_id: id } }),
  ...tools.map(([tool, args, result, error]) => L('event_msg', { type: 'item_completed', thread_id: thread, turn_id: id, item: Object.assign(
    { type: 'McpToolCall', server: 'codex_app', tool, arguments: args, status: error ? 'failed' : 'completed' },
    error ? { error: { message: error } } : { result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false } }) })),
  L('event_msg', { type: 'task_complete', turn_id: id, last_agent_message: answer }),
].join('\n') + '\n';

const cmd = argv[0];
if (cmd === 'queue') {
  const thread = opt('--thread'), message = opt('--message');
  if (mode === 'fail') { console.error('Error: thread not found: ' + thread); process.exit(1); }
  const file = rolloutOf(thread);
  console.log(`Queued message q-${Date.now()} for thread ${thread}`);
  if (mode === 'silent' || !file) process.exit(0);
  const band = (/b-[0-9a-f]{10}/.exec(message) || [''])[0];
  const tid = 't-' + Date.now();
  let text;
  if (mode === 'relay-ok') {
    const target = (/threadId: ([^，,）)]+)/.exec(message) || [])[1] || 'remote-thread';
    text = turn(thread, tid, message, [
      ['send_message_to_thread', { threadId: target, hostId: HOST, prompt: '…' }, { threadId: target }],
      ['wait_threads', { targets: [{ threadId: target, hostId: HOST }] }, { timedOut: false, polls: [{ thread: { id: target }, latestTurn: { status: 'completed' }, latestAssistantMessage: { phase: 'final_answer', text: '远程收到了' } }] }],
    ], '```json\n' + JSON.stringify({ pigeon: band, sent: true, thread_id: target, host_id: HOST, timed_out: false, reply: '远程收到了', error: '' }) + '\n```');
  } else if (mode === 'relay-lost') {
    const target = (/threadId: ([^，,）)]+)/.exec(message) || [])[1] || 'remote-thread';
    text = turn(thread, tid, message, [
      ['send_message_to_thread', { threadId: target, hostId: HOST, prompt: '…' }, { threadId: target }],
      ['wait_threads', { targets: [{ threadId: target, hostId: HOST }] }, { timedOut: true, polls: [] }],
    ], '```json\n' + JSON.stringify({ pigeon: band, sent: true, thread_id: target, host_id: HOST, timed_out: true, reply: '', error: '' }) + '\n```');
  } else if (mode === 'relay-fetch') {
    const target = (/threadId: ([^，,）)]+)/.exec(message) || [])[1] || 'remote-thread';
    text = turn(thread, tid, message, [
      ['wait_threads', { targets: [{ threadId: target, hostId: HOST }] }, { timedOut: false, polls: [{ thread: { id: target }, latestTurn: { status: 'completed' } }] }],
      ['read_thread', { threadId: target, hostId: HOST, turnLimit: 1 }, { turns: [{ status: 'completed', items: [{ type: 'agentMessage', text: '第二阶段做完了：' + target, phase: 'final_answer' }] }] }],
    ], '```json\n' + JSON.stringify({ pigeon: band, sent: true, thread_id: target, host_id: HOST, timed_out: false, reply: '第二阶段做完了', error: '' }) + '\n```');
  } else if (mode === 'relay-never') {
    text = turn(thread, tid, message, [['send_message_to_thread', { threadId: 'x', hostId: HOST }, null, 'MCP tool call requires approval, but approval policy is never']], '没发出去');
  } else if (mode === 'relay-lofts') {
    text = turn(thread, tid, message, [
      ['list_projects', {}, { projects: [{ projectId: 'p-remote-1', projectKind: 'remote', label: 'Projects', path: 'D:/Work', hostId: HOST, hostDisplayName: 'DESKTOP-TEST01' }] }],
      ['list_threads', { mode: 'recent' }, { threads: [{ id: '0199aaaa-1111-7000-8000-000000000001', kind: 'codex', hostId: HOST, title: '构建', cwd: 'D:\\Work', updatedAt: 1794366797 }] }],
    ], '```json\n' + JSON.stringify({ pigeon: band, hosts: [{ id: HOST, name: 'DESKTOP-TEST01' }] }) + '\n```');
  } else {
    text = turn(thread, tid, message, [], '收到：' + message.split('\n')[0]);
  }
  // 模拟桌面应用过一会儿才接手
  setTimeout(() => { fs.appendFileSync(file, text); process.exit(0); }, Number(process.env.FAKE_CODEX_DELAY_MS || 0));
} else if (cmd === 'exec') {
  const prompt = argv[argv.length - 1];
  const id = '0199ffff-0000-7000-8000-' + String(Date.now()).slice(-12).padStart(12, '0');
  const answer = mode === 'fail' ? '' : `完成：${prompt.split('\n')[0]}（任务 ${process.env.PIGEON_TASK_ID || '-'}）`;
  if (!argv.includes('--ephemeral')) {
    fs.mkdirSync(dayDir(), { recursive: true });
    fs.writeFileSync(path.join(dayDir(), `rollout-2026-11-11T00-00-00-${id}.jsonl`), turn(id, 't-exec', prompt, [], answer).replace(/"turn_trigger":"queue"/, '"turn_trigger":"exec"'));
  }
  const out = [{ type: 'thread.started', thread_id: id }, { type: 'item.started', item: { type: 'command_execution', command: '/bin/zsh -lc "npm test"' } }];
  if (mode === 'fail') out.push({ type: 'turn.failed', error: { message: 'model exploded' } });
  else out.push({ type: 'item.completed', item: { type: 'agent_message', text: answer } }, { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 5 } });
  for (const o of out) console.log(JSON.stringify(o));
  const last = opt('-o');
  if (last && answer) fs.writeFileSync(last, answer);
  process.exit(mode === 'fail' ? 1 : 0);
} else {
  console.log('fake codex');
}
