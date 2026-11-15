// 核心逻辑的单元测试：参数解析、rollout 解析、中继回复解析、日志读写、防循环。不调用 Codex。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, clip, fingerprint, newBand, isBand } from '../scripts/lib/common.mjs';
import { parseLines, readFrom, digest, localProgress, findRollout, toolResult } from '../scripts/lib/rollout.mjs';
import { parseRelayReply, relayProgress, loftsProgress, remoteLofts, sendInstruction, newInstruction, fetchInstruction, toolFacts } from '../scripts/lib/relay.mjs';
import { canMove, readJournal, addNote, patchNote, getNote, prune, recent, updateJournal, KEEP_MS } from '../scripts/lib/journal.mjs';
import { chainFor, overHops, makeNote, eventOf, footer } from '../scripts/lib/post.mjs';
import { fixture, T } from './helpers.mjs';

const BAND = 'b-0123456789';
const events = name => parseLines(fixture(name));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pigeon-unit-'));

/* ---------- 参数解析 ---------- */
test('parseArgs：键值、开关、短参数、等号和 --', () => {
  assert.deepEqual(parseArgs(['--to', '问候@DESKTOP', '你好', '世界']), { _: ['你好', '世界'], to: '问候@DESKTOP' });
  assert.deepEqual(parseArgs(['-n', '5']), { _: [], n: '5' });
  assert.deepEqual(parseArgs(['--timeout=3', '--wait', 'hi']), { _: ['hi'], timeout: '3', wait: true });
  assert.deepEqual(parseArgs(['--kind', 'review', '--', '--看', '这个']), { _: ['--看 这个'], kind: 'review' });
  // 开关不吃后面的正文
  assert.deepEqual(parseArgs(['--to', 'x', '--wait', '正文']), { _: ['正文'], to: 'x', wait: true });
  assert.deepEqual(parseArgs(['--temp', '--brief-file', 'a.md']), { _: [], temp: true, 'brief-file': 'a.md' });
  // 以 - 开头的正文（比如列表项）不当成参数
  assert.deepEqual(parseArgs(['--to', 'x', '- 第一条']), { _: ['- 第一条'], to: 'x' });
  // 值后面紧跟另一个参数
  assert.deepEqual(parseArgs(['--title', '--to', 'x']), { _: [], title: true, to: 'x' });
});

test('编号、预览截断、指纹', () => {
  const b = newBand();
  assert.ok(isBand(b), b);
  assert.ok(!isBand('b-xyz'));
  assert.equal(clip('一二三四五六', 4), '一二三…');
  assert.equal(Array.from(clip('字'.repeat(200), 80)).length, 80);
  assert.equal(clip('  a \n b  ', 80), 'a b');
  assert.equal(fingerprint('你好').length, 16);
  assert.equal(fingerprint('你好'), fingerprint('你好'));
  assert.notEqual(fingerprint('你好'), fingerprint('你好 '));
});

/* ---------- rollout ---------- */
test('rollout：按轮整理，找到带编号的一轮', () => {
  const d = digest(events('local-thread.jsonl'));
  assert.equal(d.turns.length, 2);
  assert.equal(d.turns[0].trigger, 'exec');
  assert.equal(d.turns[1].trigger, 'queue');
  assert.equal(d.turns[1].answer, '测试全部通过，共 12 个。');
  assert.deepEqual(localProgress(events('local-thread.jsonl'), BAND), { state: 'home', turn: 't-l1', answer: '测试全部通过，共 12 个。' });
  assert.deepEqual(localProgress(events('local-thread-midway.jsonl'), BAND), { state: 'delivered', turn: 't-l1' });
  assert.equal(localProgress(events('local-thread-aborted.jsonl'), BAND).state, 'lost');
  assert.deepEqual(localProgress(events('local-thread.jsonl'), 'b-ffffffffff'), { state: '', turn: '' });
});

test('rollout：从偏移读，半行不读', () => {
  const dir = tmp();
  const f = path.join(dir, 'r.jsonl');
  fs.writeFileSync(f, '{"a":1}\n{"b":2}\n{"c":');
  const r = readFrom(f, 0);
  assert.equal(r.lines.length, 2);
  assert.equal(r.end, 16);
  fs.appendFileSync(f, '3}\n');
  const r2 = readFrom(f, r.end);
  assert.deepEqual(r2.lines, [{ c: 3 }]);
  assert.equal(readFrom(path.join(dir, 'none.jsonl'), 0), null);
  assert.deepEqual(readFrom(f, 9999).lines, []);
});

test('rollout：按 id 在 sessions 目录里找文件', () => {
  const root = tmp();
  const d = path.join(root, '2026', '11', '11');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `rollout-2026-11-11T00-00-00-${T.local}.jsonl`), '');
  assert.equal(findRollout(T.local, root), path.join(d, `rollout-2026-11-11T00-00-00-${T.local}.jsonl`));
  assert.equal(findRollout('nope', root), '');
});

/* ---------- 中继站 ---------- */
test('中继回复：代码块、裸 JSON、编号不对', () => {
  const j = parseRelayReply('好的\n```json\n{"pigeon":"b-0123456789","sent":true,"reply":"收到"}\n```', BAND);
  assert.equal(j.reply, '收到');
  assert.equal(parseRelayReply('{"pigeon":"b-0123456789","sent":false,"error":"拒绝"}', BAND).sent, false);
  assert.equal(parseRelayReply('```json\n{"pigeon":"b-9999999999","sent":true}\n```', BAND), null);
  assert.equal(parseRelayReply('完全不是 JSON', BAND), null);
  assert.equal(parseRelayReply('```\n{"pigeon":"b-0123456789","sent":true}\n```', BAND).sent, true);
});

test('中继进展：成功送达并取回回信', () => {
  const p = relayProgress(events('relay-send-ok.jsonl'), BAND);
  assert.equal(p.state, 'home');
  assert.equal(p.answer, '构建通过，没有报错。');
  assert.equal(p.threadId, T.remote);
  assert.equal(p.hostId, T.host);
  assert.equal(p.relayTurn, 't-relay-1');
});

test('中继进展：发出了还在等 → 已送达；还没开始 → 没有进展', () => {
  assert.equal(relayProgress(events('relay-send-midway.jsonl'), BAND).state, 'delivered');
  assert.equal(relayProgress(events('relay-send-ok.jsonl'), 'b-ffffffffff').state, '');
});

test('中继进展：审批策略 never → 没发出，带能照着做的提示', () => {
  const p = relayProgress(events('relay-send-never.jsonl'), BAND);
  assert.equal(p.state, 'refused');
  assert.match(p.error, /never/);
  assert.match(p.error, /pigeon relay use/);
});

test('中继进展：远程新建拿到新对话 id', () => {
  const p = relayProgress(events('relay-new-ok.jsonl'), BAND);
  assert.equal(p.state, 'home');
  assert.equal(p.threadId, '0199dddd-4444-7000-8000-000000000004');
  assert.equal(p.answer, '已在远程新建');
});

test('中继进展：等待超时 → 没回音，不拿上一轮的旧回复充数', () => {
  const p = relayProgress(events('relay-send-timeout.jsonl'), BAND);
  assert.equal(p.state, 'lost');
  assert.match(p.error, /没等到回信/);
});

test('中继进展：工具记录缺失时用最终 JSON 兜底；都看不出来就没回音', () => {
  const mk = answer => parseLines([
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `消息 ${BAND}` }], internal_chat_message_metadata_passthrough: { turn_id: 't1' } } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1', last_agent_message: answer } }),
  ].join('\n'));
  const ok = relayProgress(mk('```json\n{"pigeon":"b-0123456789","sent":true,"thread_id":"x","reply":"好"}\n```'), BAND);
  assert.equal(ok.state, 'home');
  assert.equal(ok.answer, '好');
  assert.equal(relayProgress(mk('我也不知道'), BAND).state, 'lost');
  assert.equal(relayProgress(mk('{"pigeon":"b-0123456789","sent":false,"error":"对方不存在 not found"}'), BAND).state, 'refused');
});

test('toolFacts：read_thread 只取最终回复', () => {
  const f = toolFacts([
    { tool: 'send_message_to_thread', arguments: { threadId: 'a', hostId: 'h' }, status: 'completed', result: { json: { threadId: 'a' } } },
    { tool: 'read_thread', arguments: {}, status: 'completed', result: { json: { turns: [{ status: 'completed', items: [{ type: 'agentMessage', text: '想一下', phase: 'commentary' }, { type: 'agentMessage', text: '最终', phase: 'final_answer' }] }] } } },
  ]);
  assert.equal(f.sent, true);
  assert.equal(f.reply, '最终');
});

test('中继指令：写明授权、编号、正文边界、等待时限和回复格式', () => {
  const s = sendInstruction({ band: BAND, threadId: T.remote, hostId: T.host, title: '构建', loftName: 'DESKTOP-TEST01', body: '跑一下 main', waitMin: 10 });
  assert.match(s, /我授权本次发送/);
  assert.match(s, /b-0123456789/);
  assert.match(s, /<<<PIGEON-BODY\n跑一下 main\nPIGEON-BODY>>>/);
  assert.match(s, /timeoutMs: 120000/);
  assert.match(s, /最多等 5 次/);
  assert.doesNotMatch(s, /timeoutMs: 600000/);
  assert.match(s, /send_message_to_thread/);
  assert.match(s, /"pigeon":"b-0123456789"/);
  const n = newInstruction({ band: BAND, projectId: 'p1', projectName: 'Projects', loftName: 'X', title: '新', body: 'b', waitMin: 2 });
  assert.match(n, /我授权本次新建/);
  assert.match(n, /"projectId":"p1","environment":\{"type":"local"\}/);
  assert.match(n, /不要指定 model/);
  assert.doesNotMatch(n, /thinking/);
  assert.match(s, /maxOutputCharsPerItem: 20000/);
  const m = newInstruction({ band: BAND, projectId: 'p1', projectName: 'Projects', loftName: 'X', title: '新', body: 'b', waitMin: 2, model: 'gpt-6-luna', effort: 'high' });
  assert.match(m, /model 写「gpt-6-luna」/);
  assert.match(m, /thinking 写「high」/);
  assert.doesNotMatch(m, /不要指定 model/);
  assert.match(newInstruction({ band: BAND, projectId: 'p1', title: '新', body: 'b', waitMin: 2, effort: 'medium' }), /不要指定 model，thinking 写「medium」/);
});

test('toolResult：多包了一层 content 的返回也能拆开', () => {
  const inner = { turns: [{ status: 'completed', items: [{ type: 'agentMessage', text: '做完了', phase: 'final_answer' }] }] };
  const wrapped = { content: [{ type: 'text', text: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(inner) }], isError: false }) }] };
  const r = toolResult(wrapped);
  assert.deepEqual(r.json, inner);
  assert.equal(r.isError, false);
  const f = toolFacts([{ tool: 'read_thread', arguments: {}, status: 'completed', result: r }]);
  assert.equal(f.reply, '做完了');
  assert.equal(toolResult({ content: [{ type: 'text', text: '{"content":"不是包装","x":1}' }] }).json.x, 1, '只拆真正的包装层');
  assert.equal(toolResult({ content: [{ type: 'text', text: JSON.stringify({ content: [{ type: 'text', text: '出错了' }], isError: true }) }] }).isError, true);
});

test('补取回信的指令：只读，等一次再读一次，不发消息', () => {
  const f = fetchInstruction({ band: 'b-aaaaaaaaaa', origBand: BAND, threadId: T.remote, hostId: T.host, title: '构建', loftName: 'X', waitMin: 10 });
  assert.match(f, /补取纸条 b-0123456789 的回信/);
  assert.match(f, /"pigeon":"b-aaaaaaaaaa"/);
  assert.match(f, /wait_threads/);
  assert.match(f, /read_thread/);
  assert.match(f, new RegExp(T.remote));
  assert.doesNotMatch(f, /send_message_to_thread|create_thread/);
  assert.match(f, /不要发消息/);
});

test('中继进展：补取的那一轮没有发送这一步，也算送到了', () => {
  const mk = tools => [
    { payload: { type: 'task_started', turn_id: 'tf' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '补取 b-aaaaaaaaaa' }], internal_chat_message_metadata_passthrough: { turn_id: 'tf' } } },
    ...tools.map(([tool, json]) => ({ payload: { type: 'item_completed', turn_id: 'tf', item: { type: 'McpToolCall', tool, arguments: {}, status: 'completed', result: { content: [{ type: 'text', text: JSON.stringify(json) }] } } } })),
    { payload: { type: 'task_complete', turn_id: 'tf', last_agent_message: '' } },
  ];
  const done = mk([['wait_threads', { timedOut: false, polls: [] }], ['read_thread', { turns: [{ status: 'completed', items: [{ type: 'agentMessage', text: '第二阶段做完了', phase: 'final_answer' }] }] }]]);
  assert.equal(relayProgress(done, 'b-aaaaaaaaaa').state, 'lost', '不是补取时，看不出发没发就算没回音');
  const p = relayProgress(done, 'b-aaaaaaaaaa', { fetched: true });
  assert.equal(p.state, 'home');
  assert.equal(p.answer, '第二阶段做完了');
  const busy = mk([['wait_threads', { timedOut: true, polls: [] }], ['read_thread', { turns: [{ status: 'inProgress', items: [] }] }]]);
  assert.equal(relayProgress(busy, 'b-aaaaaaaaaa', { fetched: true }).state, 'lost');
});

test('刷新设备：从工具返回整理出远程设备，排除本机和 ChatGPT 项目', () => {
  const p = loftsProgress(events('relay-lofts.jsonl'), 'b-aaaaaaaaaa');
  assert.equal(p.state, 'home');
  const lofts = remoteLofts(p, [{ id: 'remote-control:env_old', name: '旧电脑', online: true, sessions: [], projects: [] }]);
  const r = lofts.find(l => l.id === T.host);
  assert.equal(r.name, 'DESKTOP-TEST01');
  assert.equal(r.online, true);
  assert.deepEqual(r.projects, [{ id: '11111111-2222-4333-8444-555555555555', name: 'Projects', path: 'D:/Work/Projects' }]);
  assert.deepEqual(r.sessions.map(s => s.title), ['构建', '写测试']);
  assert.equal(r.sessions[0].updated, 1794366797000);
  assert.ok(!lofts.some(l => l.id === 'local'));
  assert.equal(lofts.find(l => l.id === 'remote-control:env_old').online, false);
});

/* ---------- 日志 ---------- */
const sample = (over = {}) => makeNote({ band: newBand(), kind: 'send', chain: '', count: 1, from: { loft: 'local', agent: 'claude', session: 's', title: '' },
  to: { loft: 'local', session: T.local, title: '跑测试' }, via: 'queue', text: '秘密正文', ...over });

test('日志：消息的字段和接口约定一致，不存正文', () => {
  const n = sample();
  assert.deepEqual(Object.keys(n).filter(k => k !== 'track').sort(),
    ['band', 'chain', 'count', 'created', 'effort', 'error', 'fingerprint', 'from', 'kind', 'model', 'reply_to', 'state', 'to', 'updated', 'via'].sort());
  assert.equal(n.model, '');
  assert.equal(n.effort, '');
  assert.deepEqual(Object.keys(n.to).sort(), ['agent', 'loft', 'loft_name', 'session', 'title']);
  assert.equal(n.chain, n.band);
  assert.equal(n.state, 'queued');
  assert.equal(n.to.loft_name, '这台 Mac');
  assert.ok(!JSON.stringify(n).includes('秘密正文'));
  const ev = eventOf(n, { preview: '预览' });
  for (const k of ['band', 'chain', 'count', 'kind', 'via', 'state', 'from', 'to', 'preview', 'answer_preview', 'error']) assert.ok(k in ev, k);
  assert.ok(!('track' in ev));
});

test('日志：状态只能往前走，没回音可以改成回信到了', () => {
  assert.ok(canMove('queued', 'flying'));
  assert.ok(canMove('flying', 'home'));
  assert.ok(canMove('queued', 'refused'));
  assert.ok(!canMove('delivered', 'flying'));
  assert.ok(!canMove('home', 'lost'));
  assert.ok(!canMove('refused', 'home'));
  assert.ok(canMove('lost', 'home'));
  assert.ok(!canMove('queued', 'bogus'));
});

test('日志：写入、改状态、只有真的变了才算 moved', async () => {
  const f = path.join(tmp(), 'journal.json');
  assert.deepEqual(readJournal(f), { version: 1, notes: [] });
  const n = sample();
  await addNote(n, f);
  let r = await patchNote(n.band, { state: 'flying' }, f);
  assert.equal(r.moved, true);
  r = await patchNote(n.band, { state: 'flying', to: { session: 'x' } }, f);
  assert.equal(r.moved, false);
  assert.equal(r.note.to.session, 'x');
  assert.equal(r.note.to.title, '跑测试');
  assert.equal(await patchNote(n.band, { state: 'queued' }, f), null);
  await patchNote(n.band, { state: 'home', track: { turn: 't' } }, f);
  assert.equal(getNote(n.band, f).state, 'home');
  assert.equal(getNote(n.band, f).track.turn, 't');
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).version, 1);
});

test('日志：并发写不丢', async () => {
  const f = path.join(tmp(), 'journal.json');
  await Promise.all(Array.from({ length: 25 }, () => addNote(sample(), f)));
  assert.equal(readJournal(f).notes.length, 25);
});

test('日志：只保留最近 7 天，最近的排前面', async () => {
  const now = Date.now();
  const old = { ...sample(), created: now - KEEP_MS - 1000, updated: now - KEEP_MS - 1000 };
  assert.equal(prune([old, sample()], now).length, 1);
  const f = path.join(tmp(), 'journal.json');
  fs.writeFileSync(f, JSON.stringify({ version: 1, notes: [old] }));
  const a = sample(), b = sample();
  await addNote(a, f);
  await updateJournal(ns => { ns.find(x => x.band === a.band).updated = now - 5000; }, f);
  await addNote(b, f);
  assert.ok(!getNote(old.band, f));
  assert.deepEqual(recent(10, f).map(x => x.band), [b.band, a.band]);
});

test('日志：坏文件当成空的', () => {
  const f = path.join(tmp(), 'journal.json');
  fs.writeFileSync(f, '{坏了');
  assert.deepEqual(readJournal(f), { version: 1, notes: [] });
});

/* ---------- 防循环 ---------- */
test('防循环：--reply-to 沿用链首，count 加一；超过上限拒发', () => {
  const parent = { band: 'b-1111111111', chain: 'b-0000000000', count: 3 };
  const lookup = b => (b === parent.band ? parent : null);
  assert.deepEqual(chainFor('', lookup), { chain: '', count: 1, parent: null, warn: '' });
  const c = chainFor(parent.band, lookup);
  assert.equal(c.chain, 'b-0000000000');
  assert.equal(c.count, 4);
  const u = chainFor('b-2222222222', lookup);
  assert.equal(u.chain, 'b-2222222222');
  assert.equal(u.count, 2);
  assert.ok(u.warn);
  assert.ok(!overHops(10, 10));
  assert.ok(overHops(11, 10));
  const n = makeNote({ band: 'b-3333333333', kind: 'send', replyTo: parent.band, chain: c.chain, count: c.count, from: {}, to: { loft: 'local' }, via: 'queue', text: 'x' });
  assert.equal(n.chain, 'b-0000000000');
  assert.equal(n.reply_to, parent.band);
});

test('消息末尾带编号和发件人', () => {
  assert.match(footer('b-0123456789', { agent: 'claude' }), /Pigeon 纸条 b-0123456789.*Claude Code/);
  assert.match(footer('b-0123456789', { agent: 'you' }), /用户/);
});
