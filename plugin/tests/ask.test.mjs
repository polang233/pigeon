// 向应用发问（/api/ask）、密钥、暂停、--json、--stdin、why/ctx、提示里的分派规则。
// 全部用假应用（临时端口上的 node:http 服务）和假 codex，不碰真实的 ~/.pigeon、设置、~/.codex、47321 端口，也不弹真对话框。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeEnv, fakeApp, deadPort, pigeon, pigeonIn, until, T, SCRIPTS, HERE } from './helpers.mjs';
import { detectSecrets, maskSecrets } from '../scripts/lib/secrets.mjs';
import { canMove, STATES } from '../scripts/lib/journal.mjs';
import { estimateTokens } from '../scripts/lib/meta.mjs';

const REMOTE_LOFTS = { version: 1, updated: 1, lofts: [{ id: 'local', name: '这台 Mac', online: true, sessions: [], projects: [] },
  { id: T.host, name: 'DESKTOP-TEST01', online: true, sessions: [{ id: T.remote, agent: 'codex', title: '构建', cwd: 'D:\\Work', updated: 1 }], projects: [{ id: 'p-1', name: 'Projects', path: 'D:/Work' }] }] };
const bandOf = s => (/b-[0-9a-f]{10}/.exec(s) || [])[0];
const evs = (app, band) => app.events.filter(x => x.hook_event_name === 'PigeonNote' && x.band === band);
const writeSettings = (e, extra) => fs.writeFileSync(e.settingsFile, JSON.stringify({ version: 1, ...extra }));
const queues = e => e.calls().filter(x => x.argv[0] === 'queue');
const SECRET = 'npm_9fK2xQ7LmA3pR8sT1vW4yZ6b';

// 远程环境：中继站已设置，远程设备缓存已写好。appOpts 是假应用的参数；dead 为 true 时端口指向没人监听的地方。
async function remote({ appOpts = {}, dead = false, mode = 'relay-ok', post = {}, extra = {}, confirm = 'ok' } = {}) {
  const e = makeEnv({ mode, confirm, settings: { post: { relayThread: T.relay, ...post }, ...extra } });
  const app = await fakeApp(appOpts);
  e.env.PIGEON_PORT = String(dead ? await deadPort() : app.port);
  fs.mkdirSync(e.pigeonHome, { recursive: true });
  fs.writeFileSync(path.join(e.pigeonHome, 'lofts.json'), JSON.stringify(REMOTE_LOFTS));
  return { e, app, done: async () => { await app.close(); e.cleanup(); } };
}
async function local({ appOpts = {}, mode = 'reply', post = {}, extra = {}, dead = false } = {}) {
  const e = makeEnv({ mode, settings: { post: { waitTimeoutMin: 1, ...post }, ...extra } });
  const app = await fakeApp(appOpts);
  e.env.PIGEON_PORT = String(dead ? await deadPort() : app.port);
  return { e, app, done: async () => { await app.close(); e.cleanup(); } };
}
const sendRemote = (e, text = '帮我看看构建', more = []) => pigeon(['send', '--to', '构建@DESKTOP-TEST01', ...more, text], e.env);
const jsonOf = r => { const lines = r.stdout.trim().split('\n'); assert.equal(lines.length, 1, '标准输出只有一行：' + r.stdout); return JSON.parse(lines[0]); };

/* ---------- 密钥 ---------- */
test('secrets：共用用例（tests/fixtures/secrets-cases.json）', () => {
  const { cases } = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'tests', 'fixtures', 'secrets-cases.json'), 'utf8'));
  assert.ok(cases.length >= 8);
  for (const c of cases) {
    assert.deepEqual(detectSecrets(c.text), c.kinds, c.text);
    const m = maskSecrets(c.text);
    assert.equal(m.text, c.masked, c.text);
    assert.deepEqual(m.kinds, c.kinds);
  }
});

test('secrets：私钥块整段打码，打码后不再有密钥', () => {
  const pem = '前文\n-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----\n后文';
  assert.deepEqual(detectSecrets(pem), ['私钥']);
  assert.equal(maskSecrets(pem).text, '前文\n‹私钥 已打码›\n后文');
  assert.deepEqual(detectSecrets(maskSecrets('a sk-abcdefghijklmnopqrstuvwx b').text), []);
});

test('journal：asking 只能走到 queued、flying、refused', () => {
  assert.ok(STATES.includes('asking'));
  for (const to of ['queued', 'flying', 'refused']) assert.ok(canMove('asking', to), to);
  for (const to of ['delivered', 'home', 'lost', 'asking']) assert.ok(!canMove('asking', to), to);
  assert.ok(!canMove('queued', 'asking'));
});

test('ctx：按文字长度估 token，汉字一个算一个', () => {
  assert.equal(estimateTokens('你好'), 2);
  assert.equal(estimateTokens('abcdefgh'), 2);
  assert.equal(estimateTokens(''), 0);
});

/* ---------- 问应用 ---------- */
test('ask：放行 → 先发 asking，再排队、进行中；请求体符合约定；不弹系统框', async () => {
  const { e, app, done } = await remote({ appOpts: { ask: 'release' }, post: { crossTimeoutSec: 33 } });
  try {
    const r = await sendRemote(e, `把 ${SECRET} 发过去`, ['--reason', '构建只能在那台跑', '--ctx-files', 'a.js, b.js']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const band = bandOf(r.stdout);
    assert.equal(app.asks.length, 1);
    const a = app.asks[0];
    assert.equal(a.kind, 'cross');
    assert.equal(a.band, band);
    assert.deepEqual(a.from, { loft: 'local', agent: 'claude', session: 'claude-session-test', title: '' });
    assert.equal(a.to.loft, T.host);
    assert.equal(a.to.agent, 'codex');
    assert.equal(a.to.session, T.remote);
    assert.equal(a.text, `把 ${SECRET} 发过去`);
    assert.equal(a.chars, a.text.length);
    assert.equal(a.preview, a.text);
    assert.deepEqual(a.files, ['a.js', 'b.js']);
    assert.equal(a.project, '');
    assert.equal(a.rule, '');
    assert.deepEqual(a.secrets, ['npm token'], '默认是提醒：把类别交给应用让用户选');
    assert.equal(a.timeoutSec, 33);
    assert.deepEqual(a.seen, ['asking'], '问之前 asking 事件已经发出去了');
    assert.equal(e.confirms().length, 0, '应用在就不弹系统框');
    assert.match(queues(e)[0].argv[4], new RegExp(SECRET), '放行就原样发');
    await until(() => e.journal().notes[0].state === 'home');
    const states = evs(app, band).map(x => x.state);
    assert.deepEqual(states.slice(0, 3), ['asking', 'queued', 'flying']);
    assert.equal(evs(app, band)[0].preview, `把 ${SECRET} 发过去`);
    assert.ok(!JSON.stringify(e.journal()).includes(SECRET), '日志里没有正文');
  } finally { await done(); }
});

test('ask：打码放行 → 发出去的是打码后的文字', async () => {
  const { e, done } = await remote({ appOpts: { ask: 'release_masked' } });
  try {
    const r = await sendRemote(e, `token ${SECRET} 用完就删`);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const msg = queues(e)[0].argv[4];
    assert.ok(msg.includes('token ‹npm token 已打码› 用完就删'));
    assert.ok(!msg.includes(SECRET));
  } finally { await done(); }
});

test('ask：拦下 → refused + blocked，不发；事件带原因', async () => {
  const { e, app, done } = await remote({ appOpts: { ask: 'block' } });
  try {
    const r = await sendRemote(e);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /没发出/);
    assert.match(r.stdout, /不要重发/);
    const n = e.journal().notes[0];
    assert.equal(n.state, 'refused');
    assert.equal(n.reason, 'blocked');
    assert.equal(queues(e).length, 0);
    assert.equal(e.confirms().length, 0);
    await until(() => evs(app, n.band).some(x => x.state === 'refused'));
    const last = evs(app, n.band).at(-1);
    assert.equal(last.reason, 'blocked');
    assert.deepEqual(evs(app, n.band).map(x => x.state), ['asking', 'refused']);
  } finally { await done(); }
});

test('ask：没人理 → refused + timeout', async () => {
  const { e, done } = await remote({ appOpts: { ask: 'timeout' } });
  try {
    const r = await sendRemote(e);
    assert.equal(r.code, 1);
    const n = e.journal().notes[0];
    assert.equal(n.state, 'refused');
    assert.equal(n.reason, 'timeout');
    assert.match(n.error, /没人点/);
    assert.equal(queues(e).length, 0);
  } finally { await done(); }
});

test('ask：远程新开对话也问，带项目名', async () => {
  const { e, app, done } = await remote({ appOpts: { ask: 'release' }, mode: 'silent' });
  try {
    const r = await pigeon(['new', '--loft', 'DESKTOP-TEST01', '--project', 'Projects', '--title', '新任务', '开始吧'], e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(app.asks[0].project, 'Projects');
    assert.equal(app.asks[0].to.session, '');
    assert.equal(app.asks[0].to.title, '新任务');
    assert.match(queues(e)[0].argv[4], /create_thread/);
  } finally { await done(); }
});

test('ask：应用没开 → 退回系统对话框（放行、拦下、弹不出来三种）', async () => {
  for (const [confirm, code, reason] of [['ok', 0, null], ['deny', 1, 'blocked'], ['timeout', 1, 'timeout'], ['broken', 1, 'timeout']]) {
    const { e, done } = await remote({ dead: true, confirm });
    try {
      const r = await sendRemote(e);
      assert.equal(r.code, code, confirm + r.stdout);
      assert.equal(e.confirms().length, 1, confirm);
      assert.equal(e.confirms()[0].wait, '90', '系统框也用 crossTimeoutSec');
      const n = e.journal().notes[0];
      if (reason) { assert.equal(n.state, 'refused'); assert.equal(n.reason, reason, confirm); assert.equal(queues(e).length, 0); }
      else assert.equal(queues(e).length, 1);
    } finally { await done(); }
  }
});

test('ask：连接中途断了、回的东西看不懂 → 也退回系统对话框', async () => {
  for (const ask of ['drop', 'garbage']) {
    const { e, app, done } = await remote({ appOpts: { ask }, confirm: 'deny' });
    try {
      const r = await sendRemote(e);
      assert.equal(r.code, 1, ask);
      assert.equal(app.asks.length, 1);
      assert.equal(e.confirms().length, 1, ask);
      assert.equal(e.journal().notes[0].reason, 'blocked');
    } finally { await done(); }
  }
});

test('ask：本机发送不问；confirmRemote 关掉不问', async () => {
  let s = await local({ appOpts: { ask: 'block' } });
  try {
    const r = await pigeon(['send', '--to', T.local, `本机 ${SECRET}`], s.e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(s.app.asks.length, 0);
    assert.ok(queues(s.e)[0].argv[4].includes(SECRET), '本机发送不查密钥、不打码');
  } finally { await s.done(); }
  s = await remote({ appOpts: { ask: 'block' }, post: { confirmRemote: false } });
  try {
    const r = await sendRemote(s.e);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(s.app.asks.length, 0);
    assert.equal(s.e.journal().notes[0].state === 'refused', false);
  } finally { await s.done(); }
});

/* ---------- secrets.mode ---------- */
test('secrets.mode：mask 自动打码再问；off 不查；warn 交给用户', async () => {
  let s = await remote({ appOpts: { ask: 'release' }, extra: { secrets: { mode: 'mask' } } });
  try {
    const r = await sendRemote(s.e, `key ${SECRET}`);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(s.app.asks[0].text, 'key ‹npm token 已打码›');
    assert.deepEqual(s.app.asks[0].secrets, []);
    assert.ok(!queues(s.e)[0].argv[4].includes(SECRET));
    assert.match(r.stderr, /自动打码/);
  } finally { await s.done(); }
  s = await remote({ appOpts: { ask: 'release' }, extra: { secrets: { mode: 'off' } } });
  try {
    await sendRemote(s.e, `key ${SECRET}`);
    assert.deepEqual(s.app.asks[0].secrets, []);
    assert.equal(s.app.asks[0].text, `key ${SECRET}`);
  } finally { await s.done(); }
  s = await remote({ appOpts: { ask: 'release' } });
  try {
    await sendRemote(s.e, '没有密钥的话');
    assert.deepEqual(s.app.asks[0].secrets, []);
  } finally { await s.done(); }
});

test('secrets.mode：mask 且 confirmRemote 关掉，也照样打码', async () => {
  const { e, done } = await remote({ post: { confirmRemote: false }, extra: { secrets: { mode: 'mask' } } });
  try {
    const r = await sendRemote(e, `key ${SECRET}`);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(!queues(e)[0].argv[4].includes(SECRET));
  } finally { await done(); }
});

test('系统框退回时，提醒里写明疑似密钥的类别', async () => {
  const { e, done } = await remote({ dead: true });
  try {
    await sendRemote(e, `key ${SECRET}`);
    assert.match(e.confirms()[0].text, /疑似有密钥（npm token）/);
  } finally { await done(); }
});

/* ---------- 暂停 ---------- */
test('暂停：本机发送排着（queued + paused），继续后看护进程自己送出', async () => {
  const { e, app, done } = await local({ extra: { paused: { all: true } } });
  try {
    const r = await pigeon(['send', '--to', T.local, '等会儿再发'], e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /暂停/);
    assert.match(r.stdout, /不用重发/);
    const band = bandOf(r.stdout);
    let n = e.journal().notes[0];
    assert.equal(n.state, 'queued');
    assert.equal(n.paused, true);
    assert.ok(n.track.pause_until > Date.now());
    assert.equal(queues(e).length, 0);
    await new Promise(r => setTimeout(r, 600));
    assert.equal(queues(e).length, 0, '暂停期间不送');
    assert.equal(e.journal().notes[0].state, 'queued');
    writeSettings(e, { paused: { all: false } });
    await until(() => e.journal().notes[0].state === 'home');
    n = e.journal().notes[0];
    assert.ok(!n.paused, '继续后清掉暂停标记');
    assert.equal(queues(e).length, 1);
    assert.match(queues(e)[0].argv[4], /等会儿再发/);
    assert.ok(!JSON.stringify(e.journal()).includes('等会儿再发'));
    const list = evs(app, band);
    assert.equal(list[0].paused, false);
    assert.ok(list.some(x => x.state === 'queued' && x.paused === true), '有一条事件标了 paused');
    assert.ok(list.some(x => x.state === 'flying' && x.paused === false));
  } finally { await done(); }
});

test('暂停：只暂停某一台；别的台不受影响', async () => {
  const { e, done } = await local({ extra: { paused: { all: false, lofts: { [T.host]: true } } } });
  try {
    const r = await pigeon(['send', '--to', T.local, '本机照发'], e.env);
    assert.equal(r.code, 0);
    assert.equal(e.journal().notes[0].state, 'flying');
    assert.ok(!e.journal().notes[0].paused);
  } finally { await done(); }
});

test('暂停：先问再暂停——放行后排着，继续后经中继站送出；拦下就不排', async () => {
  const { e, app, done } = await remote({ appOpts: { ask: 'release' }, extra: { paused: { lofts: { [T.host]: true } } } });
  try {
    const r = await sendRemote(e, '远程的话', ['--json']);
    assert.deepEqual(jsonOf(r), { ok: true, band: bandOf(r.stdout), state: 'queued', paused: true });
    assert.equal(app.asks.length, 1, '暂停时也先问');
    const band = bandOf(r.stdout);
    assert.deepEqual(evs(app, band).map(x => x.state).slice(0, 2), ['asking', 'queued']);
    assert.equal(e.journal().notes[0].paused, true);
    assert.equal(queues(e).length, 0);
    writeSettings(e, { post: { relayThread: T.relay }, paused: { lofts: { [T.host]: false } } });
    await until(() => e.journal().notes[0].state === 'home');
    assert.equal(queues(e).length, 1);
    assert.match(queues(e)[0].argv[4], /远程的话/);
  } finally { await done(); }
  const b = await remote({ appOpts: { ask: 'block' }, extra: { paused: { all: true } } });
  try {
    const r = await sendRemote(b.e);
    assert.equal(r.code, 1);
    assert.equal(b.e.journal().notes[0].reason, 'blocked');
    assert.ok(!b.e.journal().notes[0].paused);
  } finally { await b.done(); }
});

test('暂停：排太久（超过 post.pauseMaxMin）→ refused + timeout，不发', async () => {
  const { e, done } = await local({ post: { pauseMaxMin: 0.02 }, extra: { paused: { all: true } } });
  try {
    const r = await pigeon(['send', '--to', T.local, '一直暂停'], e.env);
    assert.equal(r.code, 0);
    await until(() => e.journal().notes[0].state === 'refused', 8000);
    const n = e.journal().notes[0];
    assert.equal(n.reason, 'timeout');
    assert.ok(!n.paused);
    assert.equal(queues(e).length, 0);
  } finally { await done(); }
});

test('暂停：本机新开对话排着，继续后用 codex exec 开', async () => {
  const { e, done } = await local({ extra: { paused: { all: true } } });
  try {
    const r = await pigeon(['new', '--loft', 'local', '--project', '测试项目', '--title', '排着', '暂停时的新对话'], e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(e.journal().notes[0].paused, true);
    assert.equal(e.calls().length, 0);
    writeSettings(e, { paused: { all: false } });
    await until(() => e.journal().notes[0].state === 'home');
    assert.match(e.calls().find(c => c.argv[0] === 'exec').argv.at(-1), /暂停时的新对话/);
  } finally { await done(); }
});

test('孤儿：等确认的命令没了、暂停的看护进程没了，read 把消息记成没发出', async () => {
  const { e, done } = await local();
  try {
    fs.mkdirSync(e.pigeonHome, { recursive: true });
    const base = { chain: 'x', count: 1, kind: 'send', reply_to: '', from: { loft: 'local', agent: 'you', session: '', title: '' }, to: { loft: 'local', loft_name: '这台 Mac', agent: 'codex', session: T.local, title: '跑测试' }, via: 'queue', created: Date.now(), updated: Date.now(), fingerprint: 'f', error: '' };
    const dead = 2 ** 22 + 12345; // 不会有这个 pid
    const notes = [
      { ...base, band: 'b-aaaaaaaaaa', chain: 'b-aaaaaaaaaa', state: 'asking', track: { asker: dead } },
      { ...base, band: 'b-bbbbbbbbbb', chain: 'b-bbbbbbbbbb', state: 'queued', paused: true, track: { watcher: dead } },
    ];
    fs.writeFileSync(path.join(e.pigeonHome, 'journal.json'), JSON.stringify({ version: 1, notes }));
    for (const b of ['b-aaaaaaaaaa', 'b-bbbbbbbbbb']) await pigeon(['read', b], e.env);
    for (const n of e.journal().notes) { assert.equal(n.state, 'refused', n.band); assert.equal(n.reason, 'timeout'); assert.ok(!n.paused); }
  } finally { await done(); }
});

/* ---------- --json ---------- */
test('--json：成功、被拦下、对方不存在、超过往返上限，都是一行 JSON，退出码照旧', async () => {
  let s = await local({ post: { maxHops: 1 } });
  try {
    let r = await pigeon(['send', '--to', T.local, '--json', '你好'], s.e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const ok = jsonOf(r);
    assert.deepEqual(ok, { ok: true, band: ok.band, state: 'flying' });
    assert.match(ok.band, /^b-[0-9a-f]{10}$/);
    assert.equal(r.stderr, '', '--json 时标准错误也没有文字');

    r = await pigeon(['send', '--to', '不存在的对话', '--json', '你好'], s.e.env);
    assert.equal(r.code, 1);
    let j = jsonOf(r);
    assert.deepEqual(Object.keys(j).sort(), ['band', 'error', 'ok', 'reason', 'state']);
    assert.equal(j.ok, false); assert.equal(j.state, 'refused'); assert.equal(j.reason, 'no_target'); assert.match(j.band, /^b-/);
    assert.equal(s.e.journal().notes.find(n => n.band === j.band).reason, 'no_target');

    r = await pigeon(['send', '--to', T.local, '--reply-to', ok.band, '--json', '第二程'], s.e.env);
    assert.equal(r.code, 1);
    j = jsonOf(r);
    assert.equal(j.reason, 'max_hops');

    r = await pigeon(['send', '--to', T.archived, '--json', 'hi'], s.e.env);
    assert.equal(jsonOf(r).reason, 'no_target');

    // 用法错误：还没有消息，band 是空串，没有 state
    r = await pigeon(['send', '--to', T.local, '--json'], s.e.env);
    assert.equal(r.code, 64);
    assert.deepEqual(Object.keys(jsonOf(r)).sort(), ['band', 'error', 'ok']);
    assert.equal(r.stderr, '');
  } finally { await s.done(); }

  s = await remote({ appOpts: { ask: 'block' } });
  try {
    const r = await sendRemote(s.e, 'x', ['--json']);
    assert.equal(r.code, 1);
    const j = jsonOf(r);
    assert.equal(j.reason, 'blocked');
    assert.equal(j.state, 'refused');
    assert.match(j.error, /不要重发/);
  } finally { await s.done(); }

  s = await remote({ appOpts: { ask: 'timeout' } });
  try {
    assert.equal(jsonOf(await sendRemote(s.e, 'x', ['--json'])).reason, 'timeout');
  } finally { await s.done(); }
});

test('--json：前置条件不满足（没设中继站）→ 退出码 3，reason 是 offline，没有编号', async () => {
  const { e, done } = await remote({ post: { relayThread: '' } });
  try {
    const r = await sendRemote(e, 'x', ['--json']);
    assert.equal(r.code, 3);
    const j = jsonOf(r);
    assert.deepEqual(j, { ok: false, band: '', state: 'refused', reason: 'offline', error: j.error });
    assert.match(j.error, /relay use/);
  } finally { await done(); }
});

test('--json：new 成功；codex queue 失败的原因（本机 no_target、远程 offline）', async () => {
  let s = await local({ mode: 'reply' });
  try {
    const r = await pigeon(['new', '--loft', 'local', '--project', '测试项目', '--title', 't', '--json', '开个新的'], s.e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(jsonOf(r), { ok: true, band: jsonOf(r).band, state: 'flying' });
  } finally { await s.done(); }
  s = await local({ mode: 'fail' });
  try {
    const j = jsonOf(await pigeon(['send', '--to', T.local, '--json', 'hi'], s.e.env));
    assert.equal(j.reason, 'no_target');
  } finally { await s.done(); }
  s = await remote({ appOpts: { ask: 'release' }, mode: 'fail' });
  try {
    const j = jsonOf(await sendRemote(s.e, 'hi', ['--json']));
    assert.equal(j.reason, 'offline');
  } finally { await s.done(); }
});

test('中继站说没发出去（审批策略 never）→ refused + offline', async () => {
  const { e, done } = await remote({ appOpts: { ask: 'release' }, mode: 'relay-never' });
  try {
    await sendRemote(e);
    await until(() => e.journal().notes[0].state === 'refused');
    assert.equal(e.journal().notes[0].reason, 'offline');
  } finally { await done(); }
});

/* ---------- --stdin ---------- */
test('--stdin：正文从标准输入读，不出现在命令行里', async () => {
  const { e, done } = await local();
  try {
    const r = await pigeonIn(['send', '--to', T.local, '--stdin', '--json'], e.env, '这段话来自标准输入\n第二行');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(jsonOf(r).state, 'flying');
    assert.match(queues(e)[0].argv[4], /这段话来自标准输入\n第二行/);
    const empty = await pigeonIn(['send', '--to', T.local, '--stdin', '--json'], e.env, '  \n');
    assert.equal(empty.code, 64);
    assert.equal(jsonOf(empty).ok, false);
  } finally { await done(); }
});

test('--stdin：new 本机，正文经看护进程交给 codex exec', async () => {
  const { e, done } = await local();
  try {
    const r = await pigeonIn(['new', '--loft', 'local', '--project', '测试项目', '--title', 'T', '--stdin', '--json'], e.env, '标准输入里的新任务');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    await until(() => e.journal().notes[0].state === 'home');
    assert.match(e.calls().find(c => c.argv[0] === 'exec').argv.at(-1), /标准输入里的新任务/);
  } finally { await done(); }
});

/* ---------- why、ctx、retry_of、model ---------- */
test('why：应用在 → 用它的 kind/rule/suggested；带上 --reason；事件和日志都有', async () => {
  const suggest = { rule: 'r3', suggested: 'codex@local', fb: false, ask: false, kind: 'rule' };
  const { e, app, done } = await local({ appOpts: { suggest } });
  try {
    const r = await pigeon(['send', '--to', T.local, '--reason', '生图归 Codex', '--retry-of', 'b-0123456789', '--ctx-files', 'a.js,b.js', '--ctx-tokens', '1200', '画个图'], e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(app.suggests, [{ text: '画个图', to: `codex@local` }]);
    const n = e.journal().notes[0];
    assert.deepEqual(n.why, { kind: 'rule', reason: '生图归 Codex', rule: 'r3', suggested: { agent: 'codex', loft: 'local' } });
    assert.deepEqual(n.ctx, { tokens: 1200, files: ['a.js', 'b.js'] });
    assert.equal(n.retry_of, 'b-0123456789');
    const ev = evs(app, n.band)[0];
    assert.deepEqual(ev.why, n.why);
    assert.deepEqual(ev.ctx, n.ctx);
    assert.equal(ev.retry_of, 'b-0123456789');
    assert.equal(ev.reason, '');
    assert.equal(ev.paused, false);
  } finally { await done(); }
});

test('why：应用没开 → lead；没写 --ctx-tokens 就估；其他老字段不变', async () => {
  const { e, done } = await local({ dead: true });
  try {
    const r = await pigeon(['send', '--to', T.local, '--reason', '我觉得该给它', '你好呀'], e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const n = e.journal().notes[0];
    assert.deepEqual(n.why, { kind: 'lead', reason: '我觉得该给它' });
    assert.deepEqual(n.ctx, { tokens: 3, files: [], estimated: true });
    assert.equal(n.retry_of, undefined);
    const r2 = await pigeon(['send', '--to', T.local, '没写理由'], e.env);
    assert.equal(r2.code, 0);
    assert.deepEqual(e.journal().notes.find(x => x.band === bandOf(r2.stdout)).why, { kind: 'lead', reason: '' });
  } finally { await done(); }
});

test('why：应用回的不是 200 / 没有 kind → 还是 lead', async () => {
  const { e, done } = await local({ appOpts: { suggest: { rule: '', suggested: '', fb: false, ask: false } } });
  try {
    await pigeon(['send', '--to', T.local, '--reason', 'x', '你好'], e.env);
    assert.deepEqual(e.journal().notes[0].why, { kind: 'lead', reason: 'x' });
  } finally { await done(); }
});

test('ask 里的 rule 来自 why.rule', async () => {
  const { e, app, done } = await remote({ appOpts: { ask: 'release', suggest: { rule: 'r7', suggested: `codex@${T.host}`, kind: 'rule', ask: true } } });
  try {
    await sendRemote(e);
    assert.equal(app.asks[0].rule, 'r7');
    assert.equal(app.suggests[0].to, `codex@${T.host}`);
  } finally { await done(); }
});

test('new --model/--effort：本机传给 codex exec，且命令行优先于设置；经中继站写进 create_thread', async () => {
  let s = await local({ extra: { codex: { model: 'settings-model', effort: 'low' } } });
  try {
    const r = await pigeon(['new', '--loft', 'local', '--project', '测试项目', '--title', 'M', '--model', 'gpt-x', '--effort', 'high', '换个模型'], s.e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    await until(() => s.e.calls().some(c => c.argv[0] === 'exec'));
    const ex = s.e.calls().find(c => c.argv[0] === 'exec').argv;
    assert.equal(ex[ex.indexOf('-m') + 1], 'gpt-x');
    assert.ok(ex.includes('model_reasoning_effort="high"'));
    const n = s.e.journal().notes[0];
    assert.equal(n.model, 'gpt-x'); assert.equal(n.effort, 'high'); assert.equal(n.model_applied, undefined);
  } finally { await s.done(); }
  s = await remote({ appOpts: { ask: 'release' }, mode: 'silent' });
  try {
    const r = await pigeon(['new', '--loft', 'DESKTOP-TEST01', '--project', 'Projects', '--title', 'M', '--model', 'gpt-x', '--effort', 'high', '远程新开'], s.e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /模型：gpt-x · high/);
    const n = s.e.journal().notes[0];
    assert.equal(n.model, 'gpt-x'); assert.equal(n.effort, 'high'); assert.equal(n.model_applied, undefined);
    assert.match(queues(s.e)[0].argv[4], /model 写「gpt-x」/);
    assert.match(queues(s.e)[0].argv[4], /thinking 写「high」/);
  } finally { await s.done(); }
});

test('run --reason：写进 PigeonRun 开始事件的 why', async () => {
  const { e, app, done } = await local({ appOpts: { suggest: { rule: 'r1', suggested: 'codex@local', kind: 'rule' } } });
  try {
    const r = await pigeon(['run', '--kind', 'review', '--cwd', e.root, '--reason', '独立审查', '--', '看看'], e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const start = app.events.find(x => x.hook_event_name === 'PigeonRun' && x.phase === 'start');
    assert.deepEqual(start.why, { kind: 'rule', reason: '独立审查', rule: 'r1', suggested: { agent: 'codex', loft: 'local' } });
  } finally { await done(); }
});

/* ---------- prompt-hint ---------- */
function hintEnv({ dispatch, settings } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pigeon-hint-'));
  const home = path.join(root, 'pg');
  fs.mkdirSync(home, { recursive: true });
  if (dispatch !== undefined) fs.writeFileSync(path.join(home, 'dispatch.json'), typeof dispatch === 'string' ? dispatch : JSON.stringify(dispatch));
  const sf = path.join(root, 'settings.json');
  if (settings !== undefined) fs.writeFileSync(sf, JSON.stringify(settings));
  const env = { ...process.env, HOME: root, PIGEON_HOME: home, PIGEON_SETTINGS_FILE: sf };
  return { root, run: prompt => spawnSync(process.execPath, [path.join(SCRIPTS, 'prompt-hint.mjs')], { input: JSON.stringify({ prompt }), env, encoding: 'utf8' }).stdout };
}
const DISPATCH = { text: '分派规则：生图交给 codex@local。', updated: 1, lead: 'claude' };

test('prompt-hint：指挥是 Claude Code（没写 lead 或写的就是 claude）→ 每轮追加分派规则', () => {
  for (const settings of [undefined, {}, { lead: { kind: 'agent', agent: 'claude', loft: 'local' } }]) {
    const h = hintEnv({ dispatch: DISPATCH, settings });
    assert.equal(h.run('把这个函数改成 async'), '分派规则：生图交给 codex@local。\n');
    // 关键词提示还在，规则排在后面
    const out = h.run('帮我画一张登录页插图');
    assert.match(out, /^Pigeon 提醒：[\s\S]*\n分派规则：生图交给 codex@local。\n$/);
    fs.rmSync(h.root, { recursive: true, force: true });
  }
});

test('prompt-hint：指挥是别的 agent 或你自己 → 不追加；没有文件、空文字、坏文件 → 不追加也不报错', () => {
  const cases = [
    [{ dispatch: DISPATCH, settings: { lead: { kind: 'you' } } }, ''],
    [{ dispatch: DISPATCH, settings: { lead: { kind: 'agent', agent: 'codex' } } }, ''],
    [{ settings: {} }, ''],
    [{ dispatch: { text: '   ' }, settings: {} }, ''],
    [{ dispatch: { text: 42 }, settings: {} }, ''],
    [{ dispatch: '{坏的json', settings: {} }, ''],
  ];
  for (const [opts, want] of cases) {
    const h = hintEnv(opts);
    assert.equal(h.run('把这个函数改成 async'), want);
    fs.rmSync(h.root, { recursive: true, force: true });
  }
});

test('prompt-hint：1200 字的保护只管关键词提示，分派规则照写', () => {
  const h = hintEnv({ dispatch: DISPATCH, settings: {} });
  try {
    assert.equal(h.run('画一张图 ' + '长'.repeat(1300)), '分派规则：生图交给 codex@local。\n');
  } finally { fs.rmSync(h.root, { recursive: true, force: true }); }
});
