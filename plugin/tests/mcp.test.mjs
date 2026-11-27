// 统一 MCP 服务测试：JSON-RPC 2.0 握手、tools/list、resources/read、分派规则、跨工具发件人身份、子进程端到端派活与读回信。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeEnv, fakeApp, until, PIGEON } from './helpers.mjs';

function fakeDshWithStdin(dir, stdinLog) {
  const f = path.join(dir, 'fake-dsh-mcp.mjs');
  fs.writeFileSync(f, `#!/usr/bin/env node
import fs from 'node:fs';
const argv = process.argv.slice(2);
const i = argv.indexOf('--session-id');
const sid = i >= 0 ? argv[i + 1] : 'session-mcp-0001';
const input = fs.readFileSync(0, 'utf8');
fs.appendFileSync(${JSON.stringify(stdinLog)}, JSON.stringify({ argv, cwd: process.cwd(), input }) + '\\n');
const reply = 'DSH 收到：' + input.split('\\n')[0];
for (const o of [
  { type: 'session', sessionId: sid, cwd: process.cwd() },
  { type: 'text', text: reply },
  { type: 'final', sessionId: sid, reason: { kind: 'completed' }, text: reply },
]) console.log(JSON.stringify(o));
`, { mode: 0o755 });
  return f;
}

function startMcpProc(args, env) {
  const child = spawn(process.execPath, [PIGEON, 'mcp', ...args], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  const pending = [];
  const seen = [];
  const stderr = [];
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', d => stderr.push(d));
  child.stdout.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      seen.push(msg);
      // 请求是并发处理的，回话可能不按顺序：按 id 对上；没有 id（解析错误）的给最早那个没 id 的等待者
      const i = pending.findIndex(w => w.id === (msg.id ?? null));
      const waiter = i >= 0 ? pending.splice(i, 1)[0] : null;
      if (waiter) waiter.resolve(msg);
    }
  });
  const call = (req) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP timeout for ${req.method}; stderr=${stderr.join('')}`)), 15000);
    pending.push({
      id: req.id ?? null,
      resolve: msg => { clearTimeout(timer); resolve(msg); },
    });
    child.stdin.write(JSON.stringify(req) + '\n');
  });
  const notify = (req) => child.stdin.write(JSON.stringify(req) + '\n');
  const close = () => new Promise(resolve => {
    if (child.exitCode !== null || child.killed) return resolve({ code: child.exitCode ?? 0, stderr: stderr.join('') });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 2000);
    child.once('close', code => { clearTimeout(timer); resolve({ code, stderr: stderr.join('') }); });
    child.stdin.end();
  });
  return { call, notify, sendRaw: s => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MCP raw timeout')), 5000);
    pending.push({ id: null, resolve: msg => { clearTimeout(timer); resolve(msg); } });
    child.stdin.write(s + '\n');
  }), close, seen, kill: () => { try { child.kill('SIGKILL'); } catch {} } };
}

test('pigeon mcp：握手、分派规则、设备列表、以 codex 身份新开 DSH 并读回信、错误码', async () => {
  const e = makeEnv({
    settings: {
      lead: { kind: 'agent', agent: 'codex', loft: 'local' },
      dispatch: {
        seeded: 1,
        rules: [
          { id: 'r-review', when: '复审改动', kw: '复审 review', to: 'deepseek@local', fb: '', ask: false, on: true, mode: 'suggest' },
        ],
      },
    },
  });
  const app = await fakeApp();
  e.env.PIGEON_PORT = String(app.port);
  delete e.env.CLAUDE_CODE_SESSION_ID;
  fs.mkdirSync(e.pigeonHome, { recursive: true });
  fs.writeFileSync(path.join(e.pigeonHome, 'dispatch.json'), JSON.stringify({
    text: '派活建议：复审改动交给本机 DeepSeek Harness',
    alive: ['codex@local', 'deepseek@local'],
    lead: { kind: 'agent', agent: 'codex', loft: 'local' },
  }));
  fs.writeFileSync(path.join(e.codexHome, 'models_cache.json'), JSON.stringify({
    models: [{ slug: 'gpt-6-luna', display_name: 'GPT-6 Luna', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] }],
  }));
  const dshLog = path.join(e.root, 'dsh-stdin.jsonl');
  e.env.PIGEON_DSH_BIN = fakeDshWithStdin(e.root, dshLog);

  const client = startMcpProc(['--client', 'codex'], e.env);
  try {
    // 1. initialize
    const init = await client.call({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', clientInfo: { name: 'codex', version: '1.0' } },
    });
    assert.equal(init.result.serverInfo.name, 'pigeon');
    assert.equal(init.result.protocolVersion, '2025-03-26');
    assert.match(init.result.instructions, /当前身份：codex/);
    assert.match(init.result.instructions, /派活建议：复审改动交给本机 DeepSeek Harness/);

    // 2. notification (no response emitted) + ping + tools/list
    client.notify({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const ping = await client.call({ jsonrpc: '2.0', id: 2, method: 'ping' });
    assert.deepEqual(ping.result, {});

    const list = await client.call({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const names = list.result.tools.map(t => t.name);
    assert.deepEqual(names, ['pigeon_rules', 'pigeon_lofts', 'pigeon_send', 'pigeon_new', 'pigeon_wait', 'pigeon_read', 'pigeon_log', 'pigeon_models']);

    // 3. resources/list & resources/read
    const resList = await client.call({ jsonrpc: '2.0', id: 4, method: 'resources/list' });
    assert.deepEqual(resList.result.resources.map(r => r.uri), ['pigeon://rules', 'pigeon://lofts']);
    const resRules = await client.call({ jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'pigeon://rules' } });
    const rulesObj = JSON.parse(resRules.result.contents[0].text);
    assert.equal(rulesObj.rules[0].id, 'r-review');

    // 4. pigeon_rules with prompt hit
    const hitRes = await client.call({
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'pigeon_rules', arguments: { prompt: '帮我复审这次改动' } },
    });
    const hitData = JSON.parse(hitRes.result.content[0].text);
    assert.equal(hitData.hits.length, 1);
    assert.equal(hitData.hits[0].to, 'deepseek@local');
    assert.match(hitData.hits[0].hint, /DeepSeek Harness/);

    // 5. pigeon_lofts & pigeon_models
    const loftsRes = await client.call({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'pigeon_lofts', arguments: {} } });
    const loftsData = JSON.parse(loftsRes.result.content[0].text);
    assert.equal(loftsData.ok, true);
    assert.equal(loftsData.lofts[0].id, 'local');

    const modelsRes = await client.call({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'pigeon_models', arguments: {} } });
    const modelsData = JSON.parse(modelsRes.result.content[0].text);
    assert.equal(modelsData.codex[0].slug, 'gpt-6-luna');

    // 6. pigeon_new (wait: true) as codex -> DSH
    const newRes = await client.call({
      jsonrpc: '2.0', id: 9, method: 'tools/call',
      params: {
        name: 'pigeon_new',
        arguments: {
          agent: 'dsh',
          title: 'MCP 复审',
          cwd: e.root,
          sandbox: 'read-only',
          reason: '让 DSH 复审',
          message: '请只读复审本次修改。',
          wait: true,
        },
      },
    });
    assert.ok(!newRes.result.isError, newRes.result.content[0].text);
    const created = JSON.parse(newRes.result.content[0].text);
    assert.equal(created.state, 'home');
    assert.match(created.answer, /DSH 收到：请只读复审本次修改/);

    await until(() => e.journal().notes.find(n => n.band === created.band)?.state === 'home');
    const note = e.journal().notes.find(n => n.band === created.band);
    assert.equal(note.from.agent, 'codex', '发件人记为 codex 而非 you');
    assert.equal(app.asks.length, 0, 'codex 是指挥，派活不用问');
    assert.equal(note.to.agent, 'deepseek');

    const dshCall = JSON.parse(fs.readFileSync(dshLog, 'utf8').trim().split('\n')[0]);
    assert.match(dshCall.input, /来自这台 Mac上的 Codex/);

    // 7. pigeon_read & pigeon_log
    const readRes = await client.call({
      jsonrpc: '2.0', id: 10, method: 'tools/call',
      params: { name: 'pigeon_read', arguments: { band: created.band } },
    });
    const readData = JSON.parse(readRes.result.content[0].text);
    assert.equal(readData.ok, true);
    assert.match(readData.answer, /DSH 收到/);

    const logRes = await client.call({
      jsonrpc: '2.0', id: 11, method: 'tools/call',
      params: { name: 'pigeon_log', arguments: { limit: 5 } },
    });
    const logData = JSON.parse(logRes.result.content[0].text);
    assert.equal(logData.notes[0].band, created.band);

    // 8. JSON-RPC errors (-32700 parse error, -32601 unknown method)
    const parseErr = await client.sendRaw('{not-json');
    assert.equal(parseErr.error.code, -32700);
    const methErr = await client.call({ jsonrpc: '2.0', id: 12, method: 'unknown/method' });
    assert.equal(methErr.error.code, -32601);

    const exited = await client.close();
    assert.equal(exited.code, 0);
  } finally {
    client.kill();
    await app.close();
    e.cleanup();
  }
});


// 起一个接了假 DSH 的环境；指挥是 Claude Code（默认），所以别的 agent 经 MCP 派活算“往下转派”
async function relayEnv({ ask, askDelayMs = 0, settings = {} }) {
  const e = makeEnv({ settings });
  const app = await fakeApp({ ask, askDelayMs });
  e.env.PIGEON_PORT = String(app.port);
  delete e.env.CLAUDE_CODE_SESSION_ID;
  e.env.PIGEON_DSH_BIN = fakeDshWithStdin(e.root, path.join(e.root, 'dsh-stdin.jsonl'));
  return { e, app };
}
const init = (client, name = 'antigravity') => client.call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', clientInfo: { name } } });
const newDsh = (id, extra = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'pigeon_new', arguments: { agent: 'dsh', title: '转派', cwd: process.cwd(), message: '帮我看看', ...extra } } });

test('pigeon mcp：不是指挥的 agent 新开 DSH 先问你，等的时候 ping 照样马上回', async () => {
  const { e, app } = await relayEnv({ ask: 'release', askDelayMs: 1500 });
  const client = startMcpProc(['--client', 'antigravity'], e.env);
  try {
    await init(client);
    const pending = client.call(newDsh(5));
    await until(() => app.asks.length === 1);
    const t0 = Date.now();
    const ping = await client.call({ jsonrpc: '2.0', id: 6, method: 'ping' });
    assert.deepEqual(ping.result, {});
    assert.ok(Date.now() - t0 < 1000, '等确认时 ping 不排在后面');
    const res = await pending;
    assert.ok(!res.result.isError, res.result.content[0].text);
    assert.equal(app.asks[0].kind, 'relay');
    assert.equal(app.asks[0].from.agent, 'antigravity');
    assert.equal(app.asks[0].to.agent, 'deepseek');
    assert.ok(app.asks[0].seen.includes('asking'), '先报“等你确认”再问');
  } finally { client.kill(); await app.close(); e.cleanup(); }
});

test('pigeon mcp：转派被拦下就不起 DSH；关掉“转派前问我”就直接发', async () => {
  const { e, app } = await relayEnv({ ask: 'block' });
  const client = startMcpProc(['--client', 'cursor'], e.env);
  try {
    await init(client, 'cursor');
    const res = await client.call(newDsh(5));
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /拦下/);
    assert.ok(!fs.existsSync(path.join(e.root, 'dsh-stdin.jsonl')), 'DSH 没被起');
    const note = e.journal().notes[0];
    assert.equal(note.state, 'refused');
    assert.equal(note.reason, 'blocked');
  } finally { client.kill(); await app.close(); e.cleanup(); }

  const r2 = await relayEnv({ ask: 'block', settings: { post: { askRelay: false } } });
  const c2 = startMcpProc(['--client', 'cursor'], r2.e.env);
  try {
    await init(c2, 'cursor');
    const res = await c2.call(newDsh(5));
    assert.ok(!res.result.isError, res.result.content[0].text);
    assert.equal(r2.app.asks.length, 0);
  } finally { c2.kill(); await r2.app.close(); r2.e.cleanup(); }
});

test('pigeon mcp：认不出的客户端不当成你自己，也要先问', async () => {
  const { e, app } = await relayEnv({ ask: 'release' });
  const client = startMcpProc([], e.env);
  try {
    await init(client, 'some-editor');
    const res = await client.call(newDsh(5));
    assert.ok(!res.result.isError, res.result.content[0].text);
    assert.equal(app.asks.length, 1);
    assert.equal(app.asks[0].kind, 'relay');
  } finally { client.kill(); await app.close(); e.cleanup(); }
});

test('pigeon mcp：客户端取消后停掉那一件，不再回它', async () => {
  const { e, app } = await relayEnv({ ask: 'release', askDelayMs: 4000 });
  const client = startMcpProc(['--client', 'antigravity'], e.env);
  try {
    await init(client);
    client.notify(newDsh(7));
    await until(() => app.asks.length === 1);
    client.notify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7, reason: 'test' } });
    const ping = await client.call({ jsonrpc: '2.0', id: 8, method: 'ping' });
    assert.deepEqual(ping.result, {});
    await new Promise(r => setTimeout(r, 4500));
    assert.ok(!client.seen.some(m => m.id === 7), '取消了的请求不再回');
    assert.ok(!fs.existsSync(path.join(e.root, 'dsh-stdin.jsonl')), '取消后 DSH 没被起');
  } finally { client.kill(); await app.close(); e.cleanup(); }
});

test('pigeon mcp：lofts refresh 读得懂命令行排好版的多行 JSON', async () => {
  const { createMcpHandler } = await import('../scripts/mcp.mjs');
  const pretty = JSON.stringify({ updated: 1, lofts: [{ id: 'local', name: '这台 Mac', sessions: [{ id: 's1' }] }, { id: 'remote-control:env_x', name: 'WIN', sessions: [] }] }, null, 2);
  const calls = [];
  const handle = createMcpHandler({ client: 'codex', cliRunner: async (args) => { calls.push(args); return { code: 0, stdout: pretty + '\n', stderr: '' }; } });
  const res = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pigeon_lofts', arguments: { refresh: true } } });
  assert.ok(!res.result.isError, res.result.content[0].text);
  const data = JSON.parse(res.result.content[0].text);
  assert.equal(data.ok, true);
  assert.deepEqual(data.lofts.map(l => l.id), ['local', 'remote-control:env_x']);
  assert.deepEqual(calls[0].slice(0, 3), ['lofts', '--refresh', '--json']);
});
