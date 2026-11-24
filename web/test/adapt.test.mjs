// 应用模式的适配层：接口给的数据（docs/CONTRACT.md）→ 界面的状态；纸条合并；规则命中次数；设置的读、改、写
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLive, mergeNote, mergeRun, ruleHits, rulesToWire, rulesFromWire, keyFromWire, keyToWire, rules2Of, dispatchBody } from '../src/backend/adapt.js';
import { settingsWriter, diff } from '../src/backend/settings.js';
import { targets, promptText } from '../src/core/route.js';
import { leadOptions, canLead } from '../src/core/names.js';

const NOW = Date.parse('2026-11-14T10:00:00+08:00');
const R = 'remote-control:env_x1';
const ME = { loft: 'local', agent: 'claude', session: 'cl-1' };
function raw() {
  return {
    lofts: { version: 1, updated: NOW, lofts: [
      { id: 'local', name: '这台 Mac', online: true, sessions: [
        { id: 'cl-1', agent: 'claude', title: '', cwd: '/Users/demo/Code/pigeon', updated: NOW, state: 'run', activity: 'delegating', model: 'claude-opus-5-5', effort: 'high' },
        { id: 'cl-1:tu', agent: 'claude', title: '子代理', parent: 'cl-1', state: 'run', activity: 'reading' },
        { id: 'th-r', agent: 'codex', title: '中继', relay: true },
        { id: 'th-x', agent: 'codex', title: '没父对话', parent: 'gone', state: 'done' },
      ] },
      { id: R, name: 'STUDIO-WIN', online: false, sessions: [{ id: 'th-w', agent: 'codex', title: '构建', cwd: 'D:\\Code', state: 'error', error: '进程退出' }] },
      { id: 'remote-control:env_hidden', name: 'OLD-PC', online: true, sessions: [{ id: 'th-h', agent: 'codex', title: '旧的' }] },
    ] },
    detect: { claude: { installed: true }, codex: { installed: true }, cursor: { installed: true }, deepseek: { installed: false } },
    settings: {
      lead: { kind: 'agent', agent: 'claude', loft: 'local' }, paused: { all: false, lofts: { [R]: true } },
      devices: { names: { [R]: '书房<b>' }, hidden: ['remote-control:env_hidden'], off: { local: ['codex'] }, models: { [`codex@${R}`]: { model: 'gpt-6.1-sol', effort: 'high' } } },
      dispatch: { rules: [{ id: 'r1', when: '生图', kw: '图 画', to: 'codex@local', fb: '', ask: false, on: true }, { id: 'r2', when: '批量', kw: '批量', to: 'deepseek@local', fb: `codex@${R}`, ask: true }] },
      quota: { low: 30, show: 'always' }, secrets: { mode: 'mask' }, perch: { notch: false }, post: { confirmRemote: false, crossTimeoutSec: 120, maxHops: 7 },
    },
    notes: [
      { band: 'b-1', kind: 'send', state: 'home', from: ME, to: { loft: 'local', agent: 'codex', session: 'th-r' }, preview: '画个图标', answer_preview: '好了', created: NOW - 60e3, updated: NOW - 30e3,
        why: { kind: 'rule', rule: 'r1' }, ctx: { tokens: 1200, window: 400000, files: ['a.js'] } },
      { band: 'b-2', kind: 'new', state: 'asking', from: { loft: 'local', agent: 'you', session: '' }, to: { loft: R, loft_name: 'STUDIO-WIN', agent: 'codex', session: '' }, preview: '跑测试', created: NOW - 10e3, updated: NOW - 10e3,
        why: { kind: 'override', rule: 'r1', suggested: { agent: 'deepseek', loft: 'local' }, reason: '那台有环境' } },
      { band: 'b-3', kind: 'send', state: 'refused', reason: 'timeout', retryable: true, from: ME, to: { loft: 'remote-control:env_new', loft_name: 'NEW-PC', agent: 'codex', session: 'th-n' }, preview: '装 Node', created: NOW - 3600e3, updated: NOW - 3500e3 },
      { band: 'b-4', kind: 'send', state: 'flying', from: ME, to: { loft: 'local', agent: 'codex', session: 'th-r' }, preview: '很久以前的', created: NOW - 5 * 3600e3, updated: NOW - 3 * 3600e3 },
      { band: 'b-5', kind: 'send', state: 'home', from: ME, to: { loft: 'remote-control:env_hidden', agent: 'codex', session: 'th-h' }, preview: '在被移除的设备上', created: NOW - 1000, updated: NOW - 500 },
      { band: 'b-6', kind: 'send', state: 'home', from: ME, to: { loft: 'local', agent: 'codex', session: 'th-r' }, preview: '上周的', created: NOW - 9 * 86400e3, updated: NOW - 9 * 86400e3, why: { kind: 'rule', rule: 'r1' } },
    ],
    runs: [],
    queue: [{ id: 'q1', kind: 'cross', band: 'b-2', from: { loft: 'local', agent: 'you', session: '' }, to: { loft: R, agent: 'codex', session: '' }, preview: '跑测试', created: NOW - 10e3, deadline: NOW + 80e3, secrets: ['npm token'], text: '跑测试 npm_xxx', chars: 12, files: [] }],
    codexModels: [{ slug: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', efforts: ['minimal', 'low', 'medium', 'high'] }],
    mpModels: [{ id: 'group/smart', context_window: 200000 }, { id: 'codex/gpt-6.1-sol', context_window: 400000 }],
  };
}

test('设备：移除的不显示、改的名字去掉尖括号、离线、按路径猜系统；本机叫 local', () => {
  const st = mapLive(raw(), NOW);
  assert.equal(st.mode, 'live');
  assert.equal(st.home, 'local');
  assert.deepEqual(Object.keys(st.DEV).sort(), ['local', R, 'remote-control:env_new'].sort(), '纸条里提到的、列表里没有的设备补上');
  assert.equal(st.DEV[R].name, '书房b');
  assert.equal(st.DEV[R].def, 'STUDIO-WIN');
  assert.equal(st.DEV[R].online, false);
  assert.equal(st.DEV[R].os, 'win');
  assert.equal(st.DEV[R].link, 'codex');
  assert.deepEqual(st.HIDDEN, [{ id: 'remote-control:env_hidden', name: 'OLD-PC' }]);
  assert.ok(!st.T.some(t => t.id === 'b-5'), '移除的设备上的任务不显示');
});

test('每台接了哪些：本机 Claude Code 能发不能收，Codex 能收；Cursor 检测到了标还没接上；远程只有 Codex 入口', () => {
  const st = mapLive(raw(), NOW);
  assert.deepEqual(st.CONN.local.map(c => [c.a, c.out, c.inn, c.on, !!c.na]), [['claude', 'yes', 'nope', true, false], ['codex', 'nope', 'yes', false, false], ['cursor', 'nope', 'nope', false, true]]);
  assert.deepEqual(st.CONN[R].map(c => [c.a, c.role, c.how[0], c.model, c.think]), [['codex', 'gate', 'inapp', 'gpt-6.1-sol', 'high']]);
  assert.deepEqual(leadOptions(st), ['claude@local'], '只有本机 Claude Code 能当指挥');
  assert.ok(!canLead(st, 'codex', R));
  assert.deepEqual(targets(st), [`codex@${R}`, 'codex@remote-control:env_new'], '本机 Codex 关了；能交给的只剩远程 Codex');
});

test('对话：状态、在做什么、模型和思考强度、子对话；父对话不在的当普通对话；标题空的用目录名', () => {
  const st = mapLive(raw(), NOW), s = id => st.S.find(x => x.id === id);
  assert.equal(s('cl-1').title, 'pigeon');
  assert.equal(s('cl-1').activity, 'delegating');
  assert.equal(s('cl-1').think, 'high');
  assert.equal(s('cl-1:tu').parent, 'cl-1');
  assert.equal(s('th-x').parent, undefined);
  assert.equal(s('th-w').state, 'error');
  assert.equal(s('th-w').error, '进程退出');
  assert.equal(s('th-r').relay, true);
  assert.ok(!st.S.some(x => x.id === 'th-h'), '移除的设备上的对话不显示');
});

test('任务：状态、原因、为什么给它（deepseek → dsh）、上下文、回信、能不能重发；过期的算没回音；你派的发件人是 you', () => {
  const st = mapLive(raw(), NOW), t = id => st.T.find(x => x.id === id);
  assert.deepEqual(st.T.map(x => x.id), ['b-2', 'b-1', 'b-3', 'b-4', 'b-6'], '从新到旧');
  assert.equal(t('b-1').state, 'home');
  assert.equal(t('b-1').reply, '好了');
  assert.deepEqual(t('b-1').ctx, { tokens: 1200, window: 400000, files: ['a.js'] });
  assert.equal(t('b-2').from, 'you');
  assert.equal(t('b-2').state, 'asking');
  assert.equal(t('b-2').kind, '新开对话');
  assert.deepEqual(t('b-2').why, { kind: 'override', rule: 'r1', suggested: { agent: 'dsh', dev: 'local' }, reason: '那台有环境' });
  assert.equal(t('b-2').body, '跑测试 npm_xxx', '等你确认的原文来自队列');
  const to = st.S.find(x => x.id === t('b-2').to);
  assert.equal(to.dev, R); assert.ok(to.stub, '还没建好的对话补一个占位的');
  assert.equal(t('b-3').reason, 'timeout');
  assert.equal(t('b-3').retryable, true);
  assert.equal(t('b-4').state, 'lost'); assert.equal(t('b-4').stale, true);
});

test('等你的一队：from、to 换成界面的样子；你发的 session 是空的', () => {
  const st = mapLive(raw(), NOW), [q] = st.Q;
  assert.deepEqual(q.from, { dev: 'local', agent: 'you', session: '' });
  assert.deepEqual(q.to, { dev: R, agent: 'codex', session: '' });
  assert.deepEqual(q.secrets, ['npm token']);
  assert.equal(q.deadline, NOW + 80e3);
});

test('设置：指挥、暂停、阈值、额度显示、查密钥、刘海、协作的规矩、模型、magpie 路由组', () => {
  const st = mapLive(raw(), NOW);
  assert.deepEqual(st.lead, { kind: 'agent', agent: 'claude', dev: 'local' });
  assert.deepEqual(st.paused, { all: false, dev: { [R]: true } });
  assert.equal(st.LOW, 30);
  assert.deepEqual(st.settings, { notch: 'off', quota: 'always', secrets: 'mask', crossTimeoutSec: 120 });
  const r2 = Object.fromEntries(st.RULES2.map(r => [r.id, r.kind === 'sw' ? r.on : r.v]));
  assert.deepEqual(r2, { cross: false, xto: 120, relay: true, split: true, hops: 7, wait: 10 });
  assert.ok(st.RULES2.find(r => r.id === 'hops').opts.includes(7), '设置里的值不在下拉里也要列出来');
  assert.deepEqual(st.MODELS.codex, [['gpt-6.1-sol', 'low medium high', 'GPT-6.1 Sol']], '思考强度只留界面认得的几档');
  assert.deepEqual(st.MAGPIE.groups.map(g => g[0]), ['group/smart']);
  assert.equal(st.CTXW['codex/gpt-6.1-sol'], 400000);
  assert.deepEqual(mapLive({ ...raw(), settings: { lead: { kind: 'you' } } }, NOW).lead, { kind: 'you' });
});

test('规则：deepseek ↔ dsh 换过来再换回去不变；命中次数只算近 7 天，没照做的另算', () => {
  const st = mapLive(raw(), NOW);
  assert.deepEqual(st.RULES.map(r => [r.id, r.to, r.fb, r.ask, r.on, r.n, r.over]), [['r1', 'codex@local', '', false, true, 2, 1], ['r2', 'dsh@local', `codex@${R}`, true, true, 0, 0]]);
  assert.deepEqual(rulesToWire(st.RULES), raw().settings.dispatch.rules.map(r => ({ ...r, on: r.on !== false })));
  assert.deepEqual(ruleHits(raw().notes, NOW), { r1: { n: 2, over: 1 } });
  assert.equal(keyFromWire('deepseek@remote-control:env_a:b'), 'dsh@remote-control:env_a:b');
  assert.equal(keyToWire('dsh@local'), 'deepseek@local');
  assert.deepEqual(rulesFromWire([{ id: 'x' }, null, { when: '没 id' }]).map(r => r.id), ['x']);
});

test('写进指挥提示的原文和 PUT /api/dispatch 的请求体；指挥是你时原文是空串', () => {
  const st = { ...mapLive(raw(), NOW), SUB: { 'codex@local': { left: 16 }, 'dsh@local': { none: true } } };
  // 这份数据里两条规则交给的那家都不在（本机没接 Codex、DeepSeek 还没接上）：没有能交出去的规则，就不往提示里写
  assert.equal(promptText(st), '');
  st.RULES[0].to = `codex@${R}`;
  const b = dispatchBody(promptText(st), st, targets(st));
  assert.match(b.text, /^派活建议/);
  assert.match(b.text, /生图 → /);
  assert.deepEqual(b.quota, { 'codex@local': 16 });
  assert.deepEqual(b.alive, [`codex@${R}`, 'codex@remote-control:env_new']);
  assert.equal(b.low, 30);
  const you = { ...st, lead: { kind: 'you' } };
  assert.equal(dispatchBody(promptText(you), you, []).text, '');
});

test('纸条合并：已经回信的不会回到路上；暂停只叠在排队上；预览只在第一条里带', () => {
  let n = mergeNote(null, { band: 'b-1', state: 'queued', paused: true, preview: '第一条', from: ME, to: { loft: 'local', agent: 'codex' }, ts: 1 }, 1);
  assert.equal(n.paused, true);
  n = mergeNote(n, { band: 'b-1', state: 'flying', ts: 2 }, 2);
  assert.equal(n.paused, undefined);
  n = mergeNote(n, { band: 'b-1', state: 'home', answer_preview: '好', ts: 3 }, 3);
  n = mergeNote(n, { band: 'b-1', state: 'flying', ts: 4 }, 4);
  assert.equal(n.state, 'home');
  assert.equal(n.preview, '第一条');
  assert.equal(n.answer_preview, '好');
});

test('pigeon run 的活也记成任务：在跑、做完、出错', () => {
  let r = mergeRun(null, { phase: 'start', task_id: 'pg-1', title: '补 aria-label', kind: 'code', session_id: 'cl-1', ts: NOW - 5000 }, NOW - 5000);
  const st1 = mapLive({ ...raw(), runs: [r] }, NOW), t1 = st1.T.find(t => t.id === 'pg-1');
  assert.equal(t1.state, 'flying'); assert.equal(t1.from, 'cl-1'); assert.equal(t1.via, 'run');
  assert.equal(st1.S.find(s => s.id === t1.to).state, 'run');
  r = mergeRun(r, { phase: 'end', task_id: 'pg-1', status: 'failed', summary: '测试没过' }, NOW - 1000);
  const t2 = mapLive({ ...raw(), runs: [r] }, NOW).T.find(t => t.id === 'pg-1');
  assert.equal(t2.state, 'failed'); assert.equal(t2.reply, '测试没过');
});

test('协作的规矩：没写的用默认（都开、90 秒、10 次、10 分钟）', () => {
  assert.deepEqual(rules2Of({}).map(r => [r.id, r.kind === 'sw' ? r.on : r.v]), [['cross', true], ['xto', 90], ['relay', true], ['split', true], ['hops', 10], ['wait', 10]]);
});

/* ---------- 设置的读、改、写 ---------- */
function fakeApi(initial) {
  let saved = structuredClone(initial); const calls = [];
  const api = async (path, { method = 'GET', body } = {}) => {
    calls.push([method, path, body && structuredClone(body)]);
    if (method === 'GET') return structuredClone(saved);
    if (fakeApi.fail) throw new Error(fakeApi.fail);
    // 和应用一样合并：对象逐层合并，null 删掉，其余整个换
    const merge = (base, patch) => { for (const [k, v] of Object.entries(patch)) { if (v === null) delete base[k]; else if (v && typeof v === 'object' && !Array.isArray(v)) merge((base[k] = base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? base[k] : {}), v); else base[k] = v; } };
    if (method === 'PATCH') merge(saved, structuredClone(body)); else saved = structuredClone(body);
    return structuredClone(saved);
  };
  return { api, calls, get saved() { return saved; } };
}

test('存设置：先读完整设置再改，别的模块的字段、不认识的字段原样留着', async () => {
  const f = fakeApi({ version: 1, codex: { model: 'x', future: 1 }, mystery: { keep: [1, 2] }, devices: { names: { a: '甲' }, extra: true } });
  const w = settingsWriter(f.api);
  const out = await w.update(s => { (s.devices.names ??= {}).b = '乙'; });
  assert.deepEqual(out, { version: 1, codex: { model: 'x', future: 1 }, mystery: { keep: [1, 2] }, devices: { names: { a: '甲', b: '乙' }, extra: true } });
  assert.deepEqual(f.calls.map(c => c[0]), ['GET', 'PATCH']);
  assert.deepEqual(f.calls[1][2], { devices: { names: { b: '乙' } } }, '只把改了的那一处交给应用');
});

test('存设置：同时到的几次改动合成一次写；后来的在前面的结果上改', async () => {
  const f = fakeApi({ quota: { low: 20 }, other: 'x' });
  const w = settingsWriter(f.api);
  const a = w.update(s => { s.quota.low = 30; }), b = w.update(s => { s.quota.show = 'always'; });
  await Promise.all([a, b]);
  assert.deepEqual(f.saved, { quota: { low: 30, show: 'always' }, other: 'x' });
  assert.equal(f.calls.filter(c => c[0] === 'PATCH').length, 1);
  await w.update(s => { s.lead = { kind: 'you' }; });
  assert.deepEqual(f.saved, { quota: { low: 30, show: 'always' }, other: 'x', lead: { kind: 'you' } });
});

test('存设置：只交改动，所以读和写之间别处改的设置不会被盖掉；没改就不写', async () => {
  const f = fakeApi({ quota: { low: 20 }, paused: { all: false, lofts: {} } });
  const w = settingsWriter(async (path, opt = {}) => {
    const out = await f.api(path, opt);
    // 页面读完之后、写之前，你在刘海上点了全部暂停
    if (!opt.method) await f.api('/api/settings', { method: 'PATCH', body: { paused: { all: true } } });
    return out;
  });
  await w.update(s => { s.quota.low = 30; });
  assert.deepEqual(f.saved, { quota: { low: 30 }, paused: { all: true, lofts: {} } });
  const n = f.calls.length;
  await w.update(() => {});
  assert.equal(f.calls.length - n, 2, '没改动：只读了一次（加上测试里插的那一次），不写');
  assert.deepEqual(diff({ a: 1, b: { c: [1, 2], d: 'x' }, gone: true }, { a: 1, b: { c: [1, 3], d: 'x' }, e: {} }), { b: { c: [1, 3] }, gone: null, e: {} });
  assert.equal(diff({ a: { b: 1 } }, { a: { b: 1 } }), undefined);
});

test('存设置：应用回错时这次的 Promise 被拒绝，下一次照常写', async () => {
  const f = fakeApi({ a: 1 });
  const w = settingsWriter(f.api);
  fakeApi.fail = '磁盘满了';
  await assert.rejects(w.update(s => { s.a = 2; }), /磁盘满了/);
  fakeApi.fail = '';
  await w.update(s => { s.b = 3; });
  assert.deepEqual(f.saved, { a: 1, b: 3 });
});

test('自己填的模型名：按“agent@设备”记，deepseek 换成 dsh；列表里没有的模型几档思考强度都列出来', async () => {
  const { levelsOf, customModelsOf, ALL_LEVELS } = await import('../src/core/names.js');
  const st = mapLive({ ...raw(), settings: { devices: { customModels: { 'codex@remote-control:env_x': ['local/qwen3', ' ', 'my-model'], 'deepseek@local': ['ds-x'], bad: ['y'], 'codex@local': 'nope' } } } }, NOW);
  assert.deepEqual(st.CUSTOMM, { 'codex@remote-control:env_x': ['local/qwen3', 'my-model'], 'dsh@local': ['ds-x'] });
  assert.deepEqual(customModelsOf(st, 'codex', 'remote-control:env_x'), ['local/qwen3', 'my-model']);
  assert.deepEqual(customModelsOf(st, 'codex', 'local'), []);
  assert.deepEqual(levelsOf(st, 'codex', 'local/qwen3'), ALL_LEVELS);
  assert.ok(ALL_LEVELS.includes('max') && ALL_LEVELS.includes('ultra'));
  assert.deepEqual(levelsOf(st, 'codex', ''), [], '没指定模型就不分档');
  assert.deepEqual(levelsOf(st, 'codex', 'group/smart'), [], 'magpie 的路由组由它决定');
});

test('中继站操作完成后的提示', async () => {
  const { relayMsg } = await import('../src/backend/live.js');
  assert.equal(relayMsg('use', { title: '中转用' }, ''), '共用的中继站换成「中转用」');
  assert.equal(relayMsg('use', { title: '给 Windows' }, 'h'), '这台中继站换成「给 Windows」');
  assert.equal(relayMsg('use', { ok: true }, 'h'), '这台跟着共用的中继站');
  assert.equal(relayMsg('delete', {}), '删掉了');
});
