// DeepSeek Harness 和 Antigravity：读对话列表、解析事件；经 pigeon new / send 发过去、等到回信。用假的 dsh 和假的 Antigravity 本机服务。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { makeEnv, fakeApp, pigeon, until } from './helpers.mjs';
import { dshEvent, readZstdFrames, dshSessions, agyAnswer, agyWaiting, agentOfArg, dshArgs } from '../scripts/lib/agents.mjs';

const zst = typeof zlib.zstdCompressSync === 'function';
const frames = lines => Buffer.concat(lines.map(l => zlib.zstdCompressSync(Buffer.from(JSON.stringify(l) + '\n'))));
const bandOf = s => (/b-[0-9a-f]{10}/.exec(s) || [])[0];

test('dsh 的事件：对话编号、正文、最终回复；没正常结束的带原因', () => {
  assert.deepEqual(dshEvent('{"type":"session","sessionId":"session-1","cwd":"/x"}'), { session: 'session-1' });
  assert.deepEqual(dshEvent('{"type":"text","text":"pong"}'), { text: 'pong' });
  assert.deepEqual(dshEvent('{"type":"final","sessionId":"session-1","reason":{"kind":"completed"},"text":"pong"}'), { final: 'pong', session: 'session-1' });
  assert.match(dshEvent('{"type":"final","reason":{"kind":"aborted"},"text":""}').error, /aborted/);
  assert.equal(dshEvent('{"type":"status","phase":"turn_start"}'), null);
  assert.equal(dshEvent('不是 JSON'), null);
  assert.deepEqual(dshArgs({ session: 's', mode: 'read-only' }), ['headless', '--json', '--session-id', 's', '--permission-mode', 'read-only', '-']);
  assert.equal(agentOfArg('DSH'), 'deepseek');
  assert.equal(agentOfArg('agy'), 'antigravity');
  assert.equal(agentOfArg('cursor'), '');
});

test('DSH 的对话列表：几段 zstd 接在一起也读得全，取最后一次起的标题，按改动时间排', { skip: !zst }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pigeon-dsh-'));
  const mk = (proj, id, title, mtime) => {
    const d = path.join(root, proj, id); fs.mkdirSync(d, { recursive: true });
    const f = path.join(d, 'session.v4.jsonl.zstd');
    fs.writeFileSync(f, frames([{ type: 'session', id, cwd: '/Users/x/' + proj, createdAt: 1 }, { type: 'session/title', data: { title: '临时' } },
      { type: 'session/title', data: { title } }, { type: 'assistant/message', data: { message: { source: { model: 'deepseek-v4.1-flash' } } } }]));
    fs.utimesSync(f, mtime, mtime);
  };
  mk('a', 'session-old', '旧的', 1000);
  mk('b', 'session-new', '复审改动', 2000);
  assert.match(readZstdFrames(path.join(root, 'b', 'session-new', 'session.v4.jsonl.zstd')), /复审改动/);
  const l = dshSessions({ root });
  assert.deepEqual(l.map(s => [s.id, s.title, s.agent]), [['session-new', '复审改动', 'deepseek'], ['session-old', '旧的', 'deepseek']]);
  assert.equal(l[0].cwd, '/Users/x/b');
  assert.equal(l[0].model, 'deepseek-v4.1-flash');
});

test('Antigravity 的回复：只看 from 之后、最后一段非空的', () => {
  const steps = [{ type: 'CORTEX_STEP_TYPE_USER_INPUT' }, { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', plannerResponse: { response: 'pong' } },
    { type: 'CORTEX_STEP_TYPE_SYSTEM_MESSAGE' }, { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', plannerResponse: { response: '先看看' } },
    { type: 'CORTEX_STEP_TYPE_RUN_COMMAND' }, { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', plannerResponse: { response: '', modifiedResponse: '' } }];
  assert.equal(agyAnswer(steps, 0), '先看看');
  assert.equal(agyAnswer(steps.slice(0, 2), 0), 'pong');
  assert.equal(agyAnswer(steps.slice(0, 2), 2), '');
  // 停着等用户批准读文件
  const wait = [...steps, { type: 'CORTEX_STEP_TYPE_GENERIC', status: 'CORTEX_STEP_STATUS_WAITING', requestedInteraction: { permission: { resource: { action: 'read_file', target: '/tmp/a.wav' }, actionDescription: 'Analyzing a.wav' } } }];
  assert.equal(agyWaiting(wait), 'Analyzing a.wav：/tmp/a.wav');
  assert.equal(agyWaiting(steps), '');
  assert.equal(agyWaiting(wait, 7), '', '只看 from 之后的');
});

// 假的 dsh：把标准输入的第一行回回去，带上对话编号
function fakeDsh(dir) {
  const f = path.join(dir, 'fake-dsh.mjs');
  fs.writeFileSync(f, `#!/usr/bin/env node
import fs from 'node:fs';
const argv = process.argv.slice(2), i = argv.indexOf('--session-id'), sid = i >= 0 ? argv[i + 1] : 'session-fake-0001';
fs.appendFileSync(process.env.FAKE_DSH_LOG, JSON.stringify({ argv, cwd: process.cwd() }) + '\\n');
const input = fs.readFileSync(0, 'utf8');
const out = [{ type: 'session', sessionId: sid, cwd: process.cwd() }, { type: 'text', text: '收到：' + input.split('\\n')[0] },
  { type: 'final', sessionId: sid, reason: { kind: process.env.FAKE_DSH_FAIL ? 'aborted' : 'completed' }, text: '收到：' + input.split('\\n')[0] }];
for (const o of out) console.log(JSON.stringify(o));
`, { mode: 0o755 });
  return f;
}

test('新开 DSH 对话、接着已有对话说：回信存下来能读；--sandbox 只读传给 dsh', async () => {
  const e = makeEnv(); const app = await fakeApp(); e.env.PIGEON_PORT = String(app.port);
  try {
    const log = path.join(e.root, 'dsh.log');
    Object.assign(e.env, { PIGEON_DSH_BIN: fakeDsh(e.root), FAKE_DSH_LOG: log, DSH_HOME: path.join(e.root, 'dsh') });
    let r = await pigeon(['new', '--agent', 'dsh', '--cwd', e.root, '--sandbox', 'read-only', '--title', '复审', '复审一下这个改动'], e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const band = bandOf(r.stdout);
    await until(() => e.journal().notes.find(n => n.band === band)?.state === 'home');
    const n = e.journal().notes.find(x => x.band === band);
    assert.equal(n.to.agent, 'deepseek');
    assert.equal(n.to.session, 'session-fake-0001');
    assert.ok(!JSON.stringify(n).includes('复审一下这个改动'), '任务记录里没有正文');
    const call = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n')[0]);
    assert.deepEqual(call.argv, ['headless', '--json', '--permission-mode', 'read-only', '-']);
    assert.equal(fs.realpathSync(call.cwd), fs.realpathSync(e.root));
    r = await pigeon(['read', band], e.env);
    assert.match(r.stdout, /收到：复审一下这个改动/);
    assert.ok(!/codex:\/\//.test(r.stdout), '不是 Codex 的对话，不给 codex:// 链接');
    // 参数不对的不发
    r = await pigeon(['new', '--agent', 'dsh', '--model', 'x', 'hi'], e.env);
    assert.equal(r.code, 64);
    r = await pigeon(['new', '--agent', 'cursor', 'hi'], e.env);
    assert.equal(r.code, 64);
  } finally { await app.close(); e.cleanup(); }
});

// 假的 Antigravity：agentapi 脚本 + 本机服务（GetAllCascadeTrajectories、GetCascadeTrajectorySteps），令牌对了才回
async function fakeAgy(root) {
  const convs = new Map();
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      if (req.headers['x-codeium-csrf-token'] !== 'tok') { res.writeHead(403); return res.end('{}'); }
      const m = req.url.split('/').at(-1), j = body ? JSON.parse(body) : {};
      res.writeHead(200, { 'content-type': 'application/json' });
      if (m === 'GetAllCascadeTrajectories') return res.end(JSON.stringify({ trajectorySummaries: Object.fromEntries([...convs].map(([id, c]) => [id, { summary: c.title, stepCount: c.steps.length, status: 'CASCADE_RUN_STATUS_IDLE', lastModifiedTime: new Date().toISOString(), annotations: { title: c.title } }])) }));
      if (m === 'GetCascadeTrajectorySteps') return res.end(JSON.stringify({ steps: (convs.get(j.cascadeId) || { steps: [] }).steps }));
      // 假 agentapi 用的两个口子
      if (m === 'new') { const id = 'agy-' + (convs.size + 1); convs.set(id, { title: j.title || '新对话', steps: [{ type: 'CORTEX_STEP_TYPE_USER_INPUT' }, { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', plannerResponse: { response: '收到：' + j.prompt.split('\n')[0] } }] }); return res.end(JSON.stringify({ id })); }
      if (m === 'send') { const c = convs.get(j.id); c.steps.push({ type: 'CORTEX_STEP_TYPE_SYSTEM_MESSAGE' }, { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', plannerResponse: { response: '又收到：' + j.content.split('\n')[0] } }); return res.end('{}'); }
      res.end('{}');
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port, home = path.join(root, 'agy');
  fs.mkdirSync(path.join(home, 'daemon'), { recursive: true });
  fs.writeFileSync(path.join(home, 'daemon', 'hub_1.json'), JSON.stringify({ pid: process.pid, httpPort: port, csrfToken: 'tok' }));
  const api = path.join(root, 'fake-agentapi.mjs');
  fs.writeFileSync(api, `#!/usr/bin/env node
const [cmd, ...rest] = process.argv.slice(2);
if (!process.env.ANTIGRAVITY_LS_ADDRESS || process.env.ANTIGRAVITY_CSRF_TOKEN !== 'tok') { console.log(JSON.stringify({ error: 'ANTIGRAVITY_LS_ADDRESS is not set' })); process.exit(1); }
const post = (m, b) => fetch('http://' + process.env.ANTIGRAVITY_LS_ADDRESS + '/x/' + m, { method: 'POST', headers: { 'x-codeium-csrf-token': 'tok' }, body: JSON.stringify(b) }).then(r => r.json());
const opt = k => (rest.find(a => a.startsWith('--' + k + '=')) || '').split('=')[1] || '';
const plain = rest.filter(a => !a.startsWith('--'));
if (cmd === 'new-conversation') { const r = await post('new', { title: opt('title'), prompt: plain[0] }); console.log(JSON.stringify({ response: { newConversation: { prompt: plain[0], conversationId: r.id } } })); }
else if (cmd === 'send-message') { await post('send', { id: plain[0], content: plain[1] }); console.log(JSON.stringify({ response: { sendMessage: { recipientId: plain[0] } } })); }
`, { mode: 0o755 });
  return { home, api, close: () => new Promise(r => srv.close(r)) };
}

test('新开 Antigravity 对话、接着说：经 agentapi 发，读它本机服务等到回复', async () => {
  const e = makeEnv(); const app = await fakeApp(); e.env.PIGEON_PORT = String(app.port);
  const agy = await fakeAgy(e.root);
  try {
    Object.assign(e.env, { PIGEON_AGY_HOME: agy.home, PIGEON_AGY_AGENTAPI: agy.api, DSH_HOME: path.join(e.root, 'dsh') });
    let r = await pigeon(['new', '--agent', 'antigravity', '--model', 'flash_lite', '--title', '听一下音频', '听听 /tmp/a.wav 有没有爆音'], e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /完整路径/);
    let band = bandOf(r.stdout);
    await until(() => e.journal().notes.find(n => n.band === band)?.state === 'home');
    let n = e.journal().notes.find(x => x.band === band);
    assert.equal(n.to.agent, 'antigravity');
    assert.equal(n.to.session, 'agy-1');
    assert.equal(n.model, 'flash_lite');
    r = await pigeon(['read', band], e.env);
    assert.match(r.stdout, /收到：听听 \/tmp\/a.wav 有没有爆音/);
    // 对话列表里有它，按标题就能接着发
    r = await pigeon(['send', '--to', '听一下音频', '再听一遍'], e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    band = bandOf(r.stdout);
    await until(() => e.journal().notes.find(n => n.band === band)?.state === 'home');
    r = await pigeon(['read', band], e.env);
    assert.match(r.stdout, /又收到：再听一遍/);
    assert.doesNotMatch(r.stdout, /收到：听听/, '只取这次之后的回复');
    // Antigravity 不分思考强度
    r = await pigeon(['new', '--agent', 'antigravity', '--effort', 'high', 'hi'], e.env);
    assert.equal(r.code, 64);
  } finally { await agy.close(); await app.close(); e.cleanup(); }
});

test('Antigravity 没开：不发，给提示', async () => {
  const e = makeEnv(); const app = await fakeApp(); e.env.PIGEON_PORT = String(app.port);
  try {
    const api = path.join(e.root, 'agentapi'); fs.writeFileSync(api, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    Object.assign(e.env, { PIGEON_AGY_HOME: path.join(e.root, 'none'), PIGEON_AGY_AGENTAPI: api });
    const r = await pigeon(['new', '--agent', 'antigravity', 'hi'], e.env);
    assert.equal(r.code, 3);
    assert.match(r.stdout + r.stderr, /Antigravity 没开/);
  } finally { await app.close(); e.cleanup(); }
});
