// 把应用的本机服务和命令行串起来跑：应用派活 → 自带的 pigeon.mjs → 假的 codex。
// 要先构建应用：cd mac && swift build。没构建过就跳过。
// 全程用临时的 HOME、~/.pigeon、CODEX_HOME 和假的 codex，端口 47430 起，不碰真的应用和用户数据。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeEnv, T, until } from '../../plugin/tests/helpers.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(ROOT, 'mac', '.build', 'debug', 'Pigeon');
const skip = fs.existsSync(BIN) ? false : '没有 mac/.build/debug/Pigeon，先 cd mac && swift build';
let nextPort = 47430;

const LOFTS = { version: 1, updated: 1, lofts: [
  { id: 'local', name: '这台 Mac', online: true, sessions: [], projects: [] },
  { id: T.host, name: 'DESKTOP-TEST01', online: true, sessions: [{ id: T.remote, agent: 'codex', title: '构建', cwd: 'D:\\Work', updated: 1 }], projects: [{ id: 'p-1', name: 'Projects', path: 'D:/Work' }] }] };

// 起一个没有界面的应用。设置文件用临时 HOME 下的默认位置，这样应用和命令行读的是同一份
async function start({ mode = 'reply', settings = {} } = {}) {
  const e = makeEnv({ mode });
  const port = nextPort++;
  const env = { ...e.env, HOME: e.root, PIGEON_PORT: String(port), PIGEON_HEADLESS: '1', PIGEON_WEB_ROOT: e.root, PIGEON_PLUGIN_ROOT: path.join(ROOT, 'plugin') };
  delete env.PIGEON_SETTINGS_FILE; delete env.CLAUDE_CODE_SESSION_ID; delete env.MAGPIE_PORT;
  const settingsFile = path.join(e.root, 'Library', 'Application Support', 'Pigeon', 'settings.json');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ version: 1, keepMe: { x: 1 }, post: { relayThread: T.relay }, ...settings }));
  fs.mkdirSync(e.pigeonHome, { recursive: true });
  fs.writeFileSync(path.join(e.pigeonHome, 'lofts.json'), JSON.stringify(LOFTS));
  const child = spawn(BIN, [], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', d => (err += d));
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  };
  await until(async () => { try { return (await fetch(base + '/api/settings')).ok; } catch { return false; } }, 15000, 100).catch(() => { child.kill(); throw new Error('应用没起来：' + err); });
  return { e, call, settingsFile,
    notes: async () => (await call('GET', '/api/notes')).json.notes,
    note: async band => (await call('GET', '/api/notes')).json.notes.find(n => n.band === band),
    stop: async () => { child.kill(); await new Promise(r => child.once('exit', r)); e.cleanup(); } };
}

test('应用派活：本机新开对话、给已有对话发消息，发件人是你，能重发', { skip }, async () => {
  const a = await start();
  try {
    const made = await a.call('POST', '/api/send', { to: { loft: 'local', agent: 'codex', session: '' }, text: '画一个图标\n深色底', title: '画图标', why: { reason: '试一下' } });
    assert.equal(made.status, 200); assert.equal(made.json.ok, true, made.text);
    const n = await a.note(made.json.band);
    assert.equal(n.from.agent, 'you'); assert.equal(n.kind, 'new'); assert.equal(n.why.reason, '试一下'); assert.equal(n.retryable, true);

    const sent = await a.call('POST', '/api/send', { to: { loft: 'local', agent: 'codex', session: T.local }, text: '跑一下测试' });
    assert.equal(sent.json.ok, true, sent.text); assert.equal(sent.json.state, 'flying');
    const queued = a.e.calls().find(c => c.args?.[0] === 'queue' || JSON.stringify(c).includes(T.local));
    assert.ok(queued, '假的 codex 应该收到这条消息');

    const again = await a.call('POST', '/api/send', { retry_of: sent.json.band });
    assert.equal(again.json.ok, true, again.text);
    assert.equal((await a.note(again.json.band)).retry_of, sent.json.band);

    const cursor = await a.call('POST', '/api/send', { to: { loft: 'local', agent: 'cursor', session: '' }, text: 'x' });
    assert.equal(cursor.status, 501);
  } finally { await a.stop(); }
});

test('应用派到别的电脑：马上回“等你确认”，放行后经中继站发出；拦下就不发', { skip }, async () => {
  const a = await start({ mode: 'relay-ok' });
  try {
    const t0 = Date.now();
    const r = await a.call('POST', '/api/send', { to: { loft: T.host, agent: 'codex', session: T.remote }, text: '在 Windows 上构建\nNPM_TOKEN=npm_9fK2xQ7LmA3pR8sT1vW4yZ6b' });
    assert.equal(r.json.ok, true, r.text); assert.equal(r.json.state, 'asking');
    assert.ok(Date.now() - t0 < 10000, '不该等到你点确认才回话');
    const q = (await a.call('GET', '/api/queue')).json.items;
    assert.equal(q.length, 1);
    assert.equal(q[0].kind, 'cross'); assert.equal(q[0].band, r.json.band); assert.equal(q[0].from.agent, 'you');
    assert.deepEqual(q[0].secrets, ['npm token']); assert.match(q[0].text, /npm_9fK2/); assert.ok(q[0].deadline > Date.now());
    assert.equal((await a.note(r.json.band)).state, 'asking');

    const ok = await a.call('POST', `/api/queue/${q[0].id}`, { action: 'release_masked' });
    assert.equal(ok.json.ok, true);
    await until(async () => ['flying', 'delivered', 'home'].includes((await a.note(r.json.band)).state));
    const relayed = JSON.stringify(a.e.calls());
    assert.ok(relayed.includes('npm token 已打码'), '发出去的应该是打码后的');
    assert.ok(!relayed.includes('npm_9fK2xQ7LmA3pR8sT1vW4yZ6b'));
    assert.equal((await a.call('GET', '/api/queue')).json.items.length, 0);

    const r2 = await a.call('POST', '/api/send', { to: { loft: T.host, agent: 'codex', session: T.remote }, text: '再来一条' });
    const q2 = await until(async () => (await a.call('GET', '/api/queue')).json.items[0]);
    const before = a.e.calls().length;
    await a.call('POST', `/api/queue/${q2.id}`, { action: 'block' });
    const n2 = await until(async () => { const n = await a.note(r2.json.band); return n.state === 'refused' && n; });
    assert.equal(n2.reason, 'blocked');
    assert.equal(a.e.calls().length, before, '拦下后不该再调 codex');
  } finally { await a.stop(); }
});

test('全部暂停：应用派的活先排着，继续后自己送出', { skip }, async () => {
  const a = await start();
  try {
    assert.equal((await a.call('POST', '/api/pause', { on: true })).json.paused.all, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(a.settingsFile, 'utf8')).keepMe, { x: 1 }, '别的设置要原样留着');
    const r = await a.call('POST', '/api/send', { to: { loft: 'local', agent: 'codex', session: T.local }, text: '暂停时发的' });
    assert.equal(r.json.ok, true, r.text); assert.equal(r.json.state, 'queued'); assert.equal(r.json.paused, true);
    const n = await a.note(r.json.band);
    assert.equal(n.state, 'queued'); assert.equal(n.paused, true);
    await a.call('POST', '/api/pause', { on: false });
    const after = await until(async () => { const x = await a.note(r.json.band); return x.state !== 'queued' && x; });
    assert.ok(['flying', 'delivered', 'home'].includes(after.state), after.state);
    assert.ok(!after.paused);
  } finally { await a.stop(); }
});

test('分派规则：网页交给应用的建议，命令行发消息时拿来打标签', { skip }, async () => {
  const rules = [{ id: 'r1', when: '生图、改图', kw: '图 画 icon', to: 'codex@local', fb: '', ask: false, on: true }];
  const a = await start({ settings: { dispatch: { rules }, quota: { low: 20 } } });
  try {
    const put = await a.call('PUT', '/api/dispatch', { text: '派活建议：生图交给 Codex', low: 20, quota: { 'codex@local': 60 }, alive: ['codex@local'] });
    assert.equal(put.status, 200);
    const file = JSON.parse(fs.readFileSync(path.join(a.e.pigeonHome, 'dispatch.json'), 'utf8'));
    assert.equal(file.text, '派活建议：生图交给 Codex'); assert.ok(file.updated > 0);
    const hit = await a.call('POST', '/api/send', { to: { loft: 'local', agent: 'codex', session: T.local }, text: '画一个图标' });
    assert.equal((await a.note(hit.json.band)).why.kind, 'rule');
    assert.equal((await a.note(hit.json.band)).why.rule, 'r1');
    const miss = await a.call('POST', '/api/send', { to: { loft: 'local', agent: 'codex', session: T.local }, text: '解释一下这个函数' });
    assert.equal((await a.note(miss.json.band)).why.kind, 'lead');
  } finally { await a.stop(); }
});
