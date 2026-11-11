// 端到端：真的跑 pigeon.mjs（以及后台看护进程），但 codex 是假的（fixtures/fake-codex.mjs），
// Codex 的数据目录、Pigeon 的状态目录、设置文件都在临时目录里，事件发到测试自己开的 HTTP 服务。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeEnv, fakeApp, pigeon, until, T, SHIM } from './helpers.mjs';

async function setup(opts = {}) {
  const e = makeEnv(opts);
  const app = await fakeApp({ settings: opts.appSettings || null });
  e.env.PIGEON_PORT = String(app.port);
  return { e, app, done: async () => { await app.close(); e.cleanup(); } };
}
const notes = (app, band) => app.events.filter(x => x.hook_event_name === 'PigeonNote' && x.band === band);
const bandOf = s => (/b-[0-9a-f]{10}/.exec(s) || [])[0];

test('本机发送：排队、看护进程跟到归巢、回信能读，日志里没有正文', async () => {
  const { e, app, done } = await setup({ mode: 'reply', settings: { post: { waitTimeoutMin: 1 } } });
  try {
    const r = await pigeon(['send', '--to', '跑测试', '请跑一下 npm test，告诉我结果'], e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const band = bandOf(r.stdout);
    assert.ok(band, r.stdout);
    // 假 codex 收到的 queue 参数
    const q = e.calls().find(c => c.argv[0] === 'queue');
    assert.deepEqual(q.argv.slice(0, 3), ['queue', '--thread', T.local]);
    assert.match(q.argv[4], new RegExp(`请跑一下 npm test[\\s\\S]*${band}`));
    await until(() => e.journal().notes.find(n => n.band === band)?.state === 'home');
    const n = e.journal().notes.find(x => x.band === band);
    assert.equal(n.kind, 'send');
    assert.equal(n.via, 'queue');
    assert.equal(n.chain, band);
    assert.equal(n.count, 1);
    assert.deepEqual(n.from, { loft: 'local', agent: 'claude', session: 'claude-session-test', title: '' });
    assert.equal(n.to.session, T.local);
    assert.equal(n.to.title, '跑测试');
    assert.ok(!fs.readFileSync(path.join(e.pigeonHome, 'journal.json'), 'utf8').includes('npm test'), '日志里不能有正文');
    await until(() => notes(app, band).some(x => x.state === 'home'));
    const states = notes(app, band).map(x => x.state);
    assert.deepEqual(states, ['queued', 'flying', 'delivered', 'home'].filter(s => states.includes(s)));
    assert.equal(states[0], 'queued');
    assert.equal(states.at(-1), 'home');
    assert.equal(notes(app, band)[0].preview, '请跑一下 npm test，告诉我结果');
    assert.match(notes(app, band).at(-1).answer_preview, /^收到：请跑一下 npm test/);
    assert.ok(notes(app, band).slice(1).every(x => x.preview === ''));
    const rd = await pigeon(['read', band], e.env);
    assert.equal(rd.code, 0);
    assert.match(rd.stdout, /已归巢/);
    assert.match(rd.stdout, /收到：请跑一下 npm test/);
    const lg = await pigeon(['log', '-n', '5'], e.env);
    assert.match(lg.stdout, new RegExp(band));
  } finally { await done(); }
});

test('send --wait：同步等到回信并打印', async () => {
  const { e, done } = await setup({ mode: 'reply' });
  try {
    e.env.FAKE_CODEX_DELAY_MS = '300';
    const r = await pigeon(['send', '--to', T.local, '--wait', '在吗'], e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /已归巢/);
    assert.match(r.stdout, /收到：在吗/);
  } finally { await done(); }
});

test('对方一直不接手：超时标迷路，不重发', async () => {
  const { e, app, done } = await setup({ mode: 'silent', settings: { post: { waitTimeoutMin: 0.05 } } });
  try {
    const r = await pigeon(['send', '--to', '跑测试', '你好'], e.env);
    const band = bandOf(r.stdout);
    await until(() => e.journal().notes.find(n => n.band === band)?.state === 'lost', 15000);
    assert.match(e.journal().notes[0].error, /没有自动重发/);
    assert.equal(e.calls().filter(c => c.argv[0] === 'queue').length, 1, '只排了一次');
    await until(() => notes(app, band).some(x => x.state === 'lost'));
    const w = await pigeon(['wait', band, '--timeout', '0.05'], e.env);
    assert.equal(w.code, 1);
    assert.match(w.stdout, /迷路/);
  } finally { await done(); }
});

test('codex queue 失败：被拒收，看护进程不启动', async () => {
  const { e, done } = await setup({ mode: 'fail' });
  try {
    const r = await pigeon(['send', '--to', '跑测试', '你好'], e.env);
    assert.equal(r.code, 1);
    const n = e.journal().notes[0];
    assert.equal(n.state, 'refused');
    assert.match(n.error, /codex queue 没排上/);
    assert.ok(!n.track.watcher);
  } finally { await done(); }
});

test('收件人不存在 → 被拒收并记日志；有歧义 → 报错不记', async () => {
  const { e, done } = await setup();
  try {
    const r = await pigeon(['send', '--to', '不存在的对话', '你好'], e.env);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /被拒收/);
    assert.equal(e.journal().notes[0].state, 'refused');
    assert.equal(e.calls().length, 0, '没有调用 codex');
    const amb = await pigeon(['send', '--to', '0199cccc', '你好'], e.env);
    assert.equal(amb.code, 64);
    assert.match(amb.stderr, /对上了 \d+ 条本机对话/);
    const arch = await pigeon(['send', '--to', '旧对话', '你好'], e.env);
    assert.equal(arch.code, 1, '归档的对话不参与按标题搜索');
    const archId = await pigeon(['send', '--to', T.archived, '你好'], e.env);
    assert.equal(archId.code, 1);
    assert.match(archId.stdout, /已归档/);
    assert.equal(e.calls().length, 0, '都没有调用 codex');
  } finally { await done(); }
});

test('防循环：沿着 --reply-to 传到上限就拒发', async () => {
  const { e, done } = await setup({ settings: { post: { maxHops: 2 } } });
  try {
    const a = bandOf((await pigeon(['send', '--to', '跑测试', '第一程'], e.env)).stdout);
    const b = bandOf((await pigeon(['send', '--to', '跑测试', '--reply-to', a, '第二程'], e.env)).stdout);
    const nb = e.journal().notes.find(n => n.band === b);
    assert.equal(nb.chain, a);
    assert.equal(nb.count, 2);
    assert.equal(nb.reply_to, a);
    const c = await pigeon(['send', '--to', '跑测试', '--reply-to', b, '第三程'], e.env);
    assert.equal(c.code, 1);
    const nc = e.journal().notes.find(n => n.band === bandOf(c.stdout));
    assert.equal(nc.state, 'refused');
    assert.equal(nc.count, 3);
    assert.match(nc.error, /往返上限 2/);
    assert.equal(e.calls().filter(x => x.argv[0] === 'queue').length, 2);
  } finally { await done(); }
});

test('远程发送：经中继站转发，解析出回信', async () => {
  const lofts = { version: 1, updated: 1, lofts: [{ id: 'local', name: '这台 Mac', online: true, sessions: [], projects: [] },
    { id: T.host, name: 'DESKTOP-TEST01', online: true, sessions: [{ id: T.remote, agent: 'codex', title: '构建', cwd: 'D:\\Work', updated: 1 }], projects: [] }] };
  const { e, app, done } = await setup({ mode: 'relay-ok', settings: { post: { relayThread: T.relay } } });
  try {
    fs.mkdirSync(e.pigeonHome, { recursive: true });
    fs.writeFileSync(path.join(e.pigeonHome, 'lofts.json'), JSON.stringify(lofts));
    const r = await pigeon(['send', '--to', '构建@DESKTOP-TEST01', '帮我看看构建'], e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /经中继站/);
    const band = bandOf(r.stdout);
    const q = e.calls().find(c => c.argv[0] === 'queue');
    assert.equal(q.argv[2], T.relay, '排到中继站对话');
    assert.match(q.argv[4], /我授权本次发送/);
    assert.match(q.argv[4], new RegExp(T.remote));
    await until(() => e.journal().notes.find(n => n.band === band)?.state === 'home');
    const n = e.journal().notes.find(x => x.band === band);
    assert.equal(n.via, 'relay');
    assert.equal(n.to.loft, T.host);
    assert.equal(n.to.loft_name, 'DESKTOP-TEST01');
    await until(() => notes(app, band).some(x => x.state === 'home'));
    assert.equal(notes(app, band).at(-1).answer_preview, '远程收到了');
    const rd = await pigeon(['read', band], e.env);
    assert.match(rd.stdout, /远程收到了/);
  } finally { await done(); }
});

test('远程发送：中继站审批策略 never → 被拒收', async () => {
  const lofts = { version: 1, updated: 1, lofts: [{ id: T.host, name: 'DESKTOP-TEST01', online: true, sessions: [{ id: T.remote, title: '构建' }], projects: [] }] };
  const { e, done } = await setup({ mode: 'relay-never', settings: { post: { relayThread: T.relay } } });
  try {
    fs.mkdirSync(e.pigeonHome, { recursive: true });
    fs.writeFileSync(path.join(e.pigeonHome, 'lofts.json'), JSON.stringify(lofts));
    const band = bandOf((await pigeon(['send', '--to', `${T.remote}@${T.host}`, 'hi'], e.env)).stdout);
    await until(() => e.journal().notes.find(n => n.band === band)?.state === 'refused');
    assert.match(e.journal().notes[0].error, /never/);
  } finally { await done(); }
});

test('远程发送的前置检查：没设中继站、中继站是 never、Codex 应用没开，都给提示且不发', async () => {
  const lofts = { version: 1, updated: 1, lofts: [{ id: T.host, name: 'DESKTOP-TEST01', online: true, sessions: [{ id: T.remote, title: '构建' }], projects: [] }] };
  const { e, done } = await setup();
  try {
    fs.mkdirSync(e.pigeonHome, { recursive: true });
    fs.writeFileSync(path.join(e.pigeonHome, 'lofts.json'), JSON.stringify(lofts));
    let r = await pigeon(['send', '--to', '构建@DESKTOP-TEST01', 'hi'], e.env);
    assert.equal(r.code, 3);
    assert.match(r.stdout, /pigeon relay use latest/);
    fs.writeFileSync(e.settingsFile, JSON.stringify({ post: { relayThread: T.never } }));
    r = await pigeon(['send', '--to', '构建@DESKTOP-TEST01', 'hi'], e.env);
    assert.equal(r.code, 3);
    assert.match(r.stdout, /never/);
    fs.writeFileSync(e.settingsFile, JSON.stringify({ post: { relayThread: T.relay } }));
    r = await pigeon(['send', '--to', '构建@DESKTOP-TEST01', 'hi'], { ...e.env, PIGEON_APP_RUNNING: '0' });
    assert.equal(r.code, 3);
    assert.match(r.stdout, /Codex 桌面应用没开/);
    assert.equal(e.calls().length, 0);
  } finally { await done(); }
});

test('本机新开对话：看护进程跑 codex exec，补上对话 id', async () => {
  const { e, app, done } = await setup({ mode: 'reply' });
  try {
    const r = await pigeon(['new', '--loft', 'local', '--project', '测试项目', '--title', '写个测试', '给 add 写单元测试'], e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const band = bandOf(r.stdout);
    await until(() => e.journal().notes.find(n => n.band === band)?.state === 'home');
    const n = e.journal().notes.find(x => x.band === band);
    assert.equal(n.kind, 'new');
    assert.equal(n.to.title, '写个测试');
    assert.match(n.to.session, /^0199ffff-/);
    const ex = e.calls().find(c => c.argv[0] === 'exec');
    assert.ok(ex.argv.includes('-C'));
    assert.equal(ex.argv[ex.argv.indexOf('-C') + 1], e.root);
    assert.ok(!ex.argv.includes('--ephemeral'), '对话要留在 Codex 应用里');
    assert.match(ex.argv.at(-1), new RegExp(band));
    await until(() => notes(app, band).some(x => x.state === 'home'));
    const evs = notes(app, band);
    assert.equal(evs[0].to.session, '', '对话建好之前 session 是空串');
    assert.ok(evs.some(x => x.to.session === n.to.session), '建好后的事件补上 session');
    const rd = await pigeon(['read', band], e.env);
    assert.match(rd.stdout, /完成：给 add 写单元测试/);
  } finally { await done(); }
});

test('远程新开对话：需要项目，经中继站 create_thread', async () => {
  const lofts = { version: 1, updated: 1, lofts: [{ id: T.host, name: 'DESKTOP-TEST01', online: true, sessions: [], projects: [{ id: 'p-1', name: 'Projects', path: 'D:/Work' }, { id: 'p-2', name: 'Other', path: 'D:/Other' }] }] };
  const { e, done } = await setup({ mode: 'silent', settings: { post: { relayThread: T.relay } } });
  try {
    fs.mkdirSync(e.pigeonHome, { recursive: true });
    fs.writeFileSync(path.join(e.pigeonHome, 'lofts.json'), JSON.stringify(lofts));
    let r = await pigeon(['new', '--loft', 'DESKTOP-TEST01', '--title', 't', 'hi'], e.env);
    assert.equal(r.code, 64);
    assert.match(r.stderr, /--project/);
    r = await pigeon(['new', '--loft', 'DESKTOP-TEST01', '--project', 'Projects', '--title', '新任务', '开始吧'], e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const q = e.calls().find(c => c.argv[0] === 'queue');
    assert.match(q.argv[4], /create_thread/);
    assert.match(q.argv[4], /"projectId":"p-1"/);
    assert.match(q.argv[4], /title 写「新任务」/);
  } finally { await done(); }
});

const REMOTE_LOFTS = { version: 1, updated: 1, lofts: [{ id: 'local', name: '这台 Mac', online: true, sessions: [], projects: [] },
  { id: T.host, name: 'DESKTOP-TEST01', online: true, sessions: [{ id: T.remote, agent: 'codex', title: '构建', cwd: 'D:\\Work', updated: 1 }], projects: [{ id: 'p-1', name: 'Projects', path: 'D:/Work' }] }] };
async function remoteSetup(opts) {
  const s = await setup({ mode: 'relay-ok', ...opts, settings: { post: { relayThread: T.relay, ...(opts.post || {}) } } });
  fs.mkdirSync(s.e.pigeonHome, { recursive: true });
  fs.writeFileSync(path.join(s.e.pigeonHome, 'lofts.json'), JSON.stringify(REMOTE_LOFTS));
  return s;
}

test('跨电脑确认：放飞才发，确认框里写清收件人和内容', async () => {
  const { e, done } = await remoteSetup({ confirm: 'ok' });
  try {
    const r = await pigeon(['send', '--to', '构建@DESKTOP-TEST01', '帮我看看构建'], e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const c = e.confirms();
    assert.equal(c.length, 1, '只问一次');
    assert.match(c[0].text, /Claude Code/);
    assert.match(c[0].text, /DESKTOP-TEST01 上的对话「构建」/);
    assert.match(c[0].text, /帮我看看构建/);
    assert.match(c[0].text, new RegExp(bandOf(r.stdout)));
    assert.equal(e.calls().filter(x => x.argv[0] === 'queue').length, 1);
  } finally { await done(); }
});

test('跨电脑确认：拦下、没人点、弹不出来，都不发，记成被拒收', async () => {
  for (const [confirm, why] of [['deny', /拦下了这张纸条/], ['timeout', /没人点/], ['broken', /没能弹出来/]]) {
    const { e, app, done } = await remoteSetup({ confirm });
    try {
      const r = await pigeon(['send', '--to', '构建@DESKTOP-TEST01', '帮我看看构建'], e.env);
      assert.equal(r.code, 1, confirm);
      assert.match(r.stdout, /被拒收/);
      assert.match(r.stdout, why);
      const band = bandOf(r.stdout);
      const n = e.journal().notes.find(x => x.band === band);
      assert.equal(n.state, 'refused');
      assert.match(n.error, why);
      assert.equal(e.calls().filter(x => x.argv[0] === 'queue').length, 0, '没有排到中继站');
      await until(() => notes(app, band).some(x => x.state === 'refused'));
      assert.ok(!JSON.stringify(e.journal()).includes('帮我看看构建'), '日志里没有正文');
    } finally { await done(); }
  }
});

test('跨电脑确认：远程新开对话也要问；本机发送不问；设置里关掉就不问', async () => {
  let s = await remoteSetup({ confirm: 'deny' });
  try {
    const r = await pigeon(['new', '--loft', 'DESKTOP-TEST01', '--project', 'Projects', '--title', '新任务', '开始吧'], s.e.env);
    assert.equal(r.code, 1);
    assert.match(s.e.confirms()[0].text, /在 DESKTOP-TEST01 的项目「Projects」里新开对话「新任务」/);
    assert.equal(s.e.calls().filter(x => x.argv[0] === 'queue').length, 0);
  } finally { await s.done(); }

  s = await remoteSetup({ confirm: 'deny', mode: 'reply' });
  try {
    const r = await pigeon(['send', '--to', T.local, '本机的话'], s.e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(s.e.confirms().length, 0, '本机发送不弹框');
  } finally { await s.done(); }

  s = await remoteSetup({ confirm: 'deny', post: { confirmRemote: false } });
  try {
    const r = await pigeon(['send', '--to', '构建@DESKTOP-TEST01', '帮我看看构建'], s.e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(s.e.confirms().length, 0, '关掉后不弹框');
    assert.equal(s.e.calls().filter(x => x.argv[0] === 'queue').length, 1);
  } finally { await s.done(); }
});

test('lofts：本机来自 sqlite，--refresh 经中继站读远程并写缓存', async () => {
  const { e, done } = await setup({ mode: 'relay-lofts', settings: { post: { relayThread: T.relay } } });
  try {
    let r = await pigeon(['lofts'], e.env);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /这台 Mac/);
    assert.match(r.stdout, /中转用　［中继站］/);
    assert.ok(!r.stdout.includes('旧对话'), '归档的不列');
    const cache = JSON.parse(fs.readFileSync(path.join(e.pigeonHome, 'lofts.json'), 'utf8'));
    assert.equal(cache.version, 1);
    assert.equal(cache.lofts[0].id, 'local');
    assert.equal(cache.lofts[0].sessions.find(s => s.id === T.relay).relay, true);
    assert.deepEqual(Object.keys(cache.lofts[0].sessions[0]).sort(), ['agent', 'cwd', 'id', 'relay', 'title', 'updated']);
    r = await pigeon(['lofts', '--refresh'], e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /DESKTOP-TEST01/);
    const c2 = JSON.parse(fs.readFileSync(path.join(e.pigeonHome, 'lofts.json'), 'utf8'));
    const remote = c2.lofts.find(l => l.id === T.host);
    assert.equal(remote.sessions[0].title, '构建');
    assert.equal(remote.projects[0].id, 'p-remote-1');
    // 不带 --refresh 时保留远程缓存
    await pigeon(['lofts'], e.env);
    assert.ok(JSON.parse(fs.readFileSync(path.join(e.pigeonHome, 'lofts.json'), 'utf8')).lofts.some(l => l.id === T.host));
  } finally { await done(); }
});

test('relay：use latest 写设置文件且保留其他字段；use 拒绝 never；check 只读', async () => {
  const { e, done } = await setup();
  try {
    let r = await pigeon(['relay'], e.env);
    assert.match(r.stdout, /还没有设置中继站/);
    r = await pigeon(['relay', 'use', T.never], e.env);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /never/);
    r = await pigeon(['relay', 'use', 'latest'], e.env);
    assert.equal(r.code, 0, r.stdout);
    const s = JSON.parse(fs.readFileSync(e.settingsFile, 'utf8'));
    assert.equal(s.post.relayThread, T.relay);
    assert.equal(s.post.maxHops, 10);
    assert.deepEqual(s.keepMe, { x: 1 });
    r = await pigeon(['relay', 'check'], e.env);
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /可以经中继站往远程发送/);
    assert.equal(e.calls().length, 0, 'check 不调用 codex');
  } finally { await done(); }
});

test('relay use：应用开着时走 PUT /api/settings', async () => {
  const { e, app, done } = await setup({ appSettings: { version: 1, codex: { model: 'm' }, unknown: 1 } });
  try {
    const r = await pigeon(['relay', 'use', T.relay], e.env);
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /Pigeon 应用/);
    assert.equal(app.settings().post.relayThread, T.relay);
    assert.equal(app.settings().unknown, 1);
    assert.equal(app.settings().codex.model, 'm');
  } finally { await done(); }
});

test('run：行为不变，事件改名 PigeonRun、任务 id 前缀 pg-、两个任务环境变量都带', async () => {
  const { e, app, done } = await setup();
  try {
    const r = await pigeon(['run', '--kind', 'review', '--title', '审查', '--cwd', e.root, '--', '看看这段代码'], e.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Codex 完成/);
    assert.match(r.stdout, /摘要：完成：看看这段代码/);
    assert.match(r.stdout, /完整记录：.*\/runs\/pg-/);
    const ex = e.calls().find(c => c.argv[0] === 'exec');
    assert.match(ex.env.PIGEON_TASK_ID, /^pg-/);
    assert.equal(ex.env.MEERKAT_TASK_ID, ex.env.PIGEON_TASK_ID);
    assert.equal(ex.argv[ex.argv.indexOf('-s') + 1], 'read-only');
    const runs = app.events.filter(x => x.hook_event_name === 'PigeonRun');
    assert.deepEqual(runs.map(x => x.phase).filter((p, i, a) => a.indexOf(p) === i), ['start', 'thread', 'activity', 'end']);
    assert.ok(runs.every(x => /^pg-/.test(x.task_id)));
    assert.equal(runs.at(-1).status, 'done');
    assert.ok(!app.events.some(x => x.hook_event_name === 'MeerkatCodex'));
    assert.ok(fs.existsSync(path.join(e.pigeonHome, 'runs')));
  } finally { await done(); }
});

test('run：失败时退出码 1，摘要是错误', async () => {
  const { e, done } = await setup({ mode: 'fail' });
  try {
    const r = await pigeon(['run', '--kind', 'code', '--cwd', e.root, '--', '写代码'], e.env);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /Codex 出错/);
    assert.match(r.stdout, /model exploded/);
  } finally { await done(); }
});

test('meerkat-codex.mjs 薄壳：转发到 pigeon', async () => {
  const { e, done } = await setup();
  try {
    const s = await pigeon(['settings'], e.env, SHIM);
    assert.equal(s.code, 0, s.stderr);
    assert.match(s.stdout, /Pigeon 设置/);
    const d = await pigeon(['doctor'], e.env, SHIM);
    assert.equal(d.code, 0);
    assert.match(d.stdout, /codex 命令：.*fake-codex/);
    const r = await pigeon(['run', '--kind', 'general', '--cwd', e.root, '--', '你好'], e.env, SHIM);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Codex 完成/);
  } finally { await done(); }
});

test('帮助和未知命令', async () => {
  const { e, done } = await setup();
  try {
    const h = await pigeon([], e.env);
    assert.equal(h.code, 0);
    assert.match(h.stdout, /pigeon send --to/);
    assert.equal((await pigeon(['bogus'], e.env)).code, 64);
    assert.equal((await pigeon(['read', 'nope'], e.env)).code, 64);
    assert.equal((await pigeon(['send', '--to', 'x'], e.env)).code, 64);
  } finally { await done(); }
});
