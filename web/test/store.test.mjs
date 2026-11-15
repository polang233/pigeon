// store：话题攒到一起通知、前缀订阅；等你的一队（倒计时、拦下、暂停中放行、规矩关了直接做）、重发、派活、换指挥、移除设备、连不上
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { createMock } from '../src/data/mock.js';
import { removalImpact } from '../src/core/names.js';
import { NOW } from './helpers.mjs';

// 时钟能拨：tick(秒) 往前走
function fresh(saved) {
  let now = NOW;
  const s = createStore(createMock(NOW), saved, { clock: () => now });
  s.tick = sec => { now += sec * 1000; return now; };
  return s;
}
const qi = (s, kind) => s.state.Q.findIndex(q => q.kind === kind);
const task = (s, id) => s.state.T.find(t => t.id === id);

test('同一轮里的几次改动只通知一次；订阅前缀能收到子话题', async () => {
  const s = fresh(), got = [];
  s.on(['settings'], ch => got.push([...ch].sort().join(',')));
  s.setSetting('theme', 'dark'); s.setSetting('lines', 'arc');
  await Promise.resolve();
  assert.deepEqual(got, ['settings.lines,settings.theme']);
  s.setRule('r1', 'when', '生图');
  await Promise.resolve();
  assert.equal(got.length, 1, 'ruleText 不该通知 settings 的订阅');
});

test('取消订阅后不再通知；flush() 马上通知', () => {
  const s = fresh(); let n = 0;
  const off = s.on(['RULES'], () => n++);
  s.toggleRule('r1'); s.flush();
  assert.equal(n, 1);
  off(); s.toggleRule('r1'); s.flush();
  assert.equal(n, 1);
});

test('读进来的设置、设备名、指挥；默认场景样式是简洁；不能发出的 agent 不认', () => {
  const s = fresh({ settings: { theme: 'light', face: 'old' }, names: { win: '书房' }, lead: { kind: 'you' } });
  assert.equal(s.state.settings.theme, 'light');
  assert.equal(s.state.settings.skin, 'plain');
  assert.ok(!('face' in s.state.settings));
  assert.equal(s.state.DEV.win.name, '书房');
  assert.deepEqual(s.state.lead, { kind: 'you' });
  assert.deepEqual(s.state.ui.stage.sel, { t: 'you' });
  const bad = fresh({ lead: { kind: 'agent', agent: 'codex', dev: 'win' } });
  assert.deepEqual(bad.state.lead, { kind: 'agent', agent: 'claude', dev: 'mac' });
});

test('跨设备那件 90 秒没人点：没发出，reason=timeout，和拦下分开', () => {
  const s = fresh(), q = s.state.Q[qi(s, 'cross')];
  assert.equal(q.deadline - NOW, 65000);
  assert.deepEqual(s.expire(s.tick(60)), []);
  const gone = s.expire(s.tick(6));
  assert.equal(gone.length, 1);
  assert.equal(task(s, 't-3a07').state, 'refused');
  assert.equal(task(s, 't-3a07').reason, 'timeout');
  assert.equal(s.state.S.find(x => x.id === 's8').state, 'idle');
  assert.equal(qi(s, 'cross'), -1);
});

test('拦下：reason=blocked；放行：进行中、对方开始干活、刘海飞一只', () => {
  const s = fresh();
  s.qDo(qi(s, 'cross'), false);
  assert.equal(task(s, 't-3a07').reason, 'blocked');
  const s2 = fresh(), r = s2.qDo(qi(s2, 'cross'), true);
  assert.match(r.msg, /^已放行，正在送往 CHEN-Y9000P2023/);
  assert.deepEqual(r.fly, ['claude', 'claude']);
  assert.equal(task(s2, 't-3a07').state, 'flying');
  assert.equal(s2.state.S.find(x => x.id === 's8').state, 'run');
});

test('暂停中点放行：留在队里标 paused，不超时；继续后送出', () => {
  const s = fresh(); s.togglePause();
  const i = qi(s, 'cross'), r = s.qDo(i, true);
  assert.match(r.msg, /暂停中/);
  assert.equal(s.state.Q[i].paused, true);
  assert.equal(task(s, 't-3a07').state, 'queued');
  assert.equal(task(s, 't-3a07').paused, true);
  assert.deepEqual(s.expire(s.tick(200)), []);
  const back = s.togglePause();
  assert.equal(back.sent, 1);
  assert.equal(task(s, 't-3a07').state, 'flying');
  assert.ok(!task(s, 't-3a07').paused);
  assert.equal(qi(s, 'cross'), -1);
});

test('只暂停那一台也一样：放行往那台的先排着', () => {
  const s = fresh(); s.togglePauseDev('win');
  s.qDo(qi(s, 'cross'), true);
  assert.equal(task(s, 't-3a07').state, 'queued');
  assert.equal(s.togglePauseDev('win').sent, 1);
  assert.equal(task(s, 't-3a07').state, 'flying');
});

test('转派放行后多一件任务；“以后直接转”关掉协作规矩里那条', () => {
  const s = fresh(), st = s.state, n = st.T.length;
  s.qAuto(qi(s, 'relay'));
  assert.equal(st.T.length, n + 1);
  assert.equal(st.T[0].to, 's5');
  assert.equal(st.T[0].state, 'flying');
  assert.equal(st.RULES2.find(r => r.id === 'relay').on, false);
});

test('规矩开着：来一件转派、拆活就进队；关了直接做', () => {
  const s = fresh(), st = s.state, n = st.Q.length;
  assert.equal(s.incoming('relay').asked, true);
  assert.equal(st.Q.length, n + 1);
  assert.equal(st.ui.hud.state, 'confirm');
  s.toggleRule2('relay'); s.toggleRule2('split');
  const t0 = st.T.length;
  assert.equal(s.incoming('relay').asked, false);
  assert.equal(s.incoming('split').asked, false);
  assert.equal(st.T.length, t0 + 4);
  assert.equal(st.Q.length, n + 1);
});

test('快速派活：发件人是你；跨设备且要问就进队（asking），不问就直接送出', () => {
  const s = fresh(), st = s.state;
  assert.equal(s.target(), 'codex@win');
  s.setDraft('  跑一遍  ');
  const r = s.send();
  assert.equal(r.result, 'asking');
  assert.equal(r.task.from, 'you');
  assert.equal(r.task.state, 'asking');
  assert.equal(st.Q.at(-1).band, r.task.id);
  assert.equal(st.Q.at(-1).deadline - NOW, 90000);
  assert.equal(st.ui.hud.state, 'confirm');
  s.toggleRule2('cross');
  s.setTarget('codex@win'); s.setDraft('再跑一遍');
  assert.equal(s.send().result, 'flying');
  s.setTarget(`dsh@${st.home}`); s.setDraft('改文案');
  const r3 = s.send();
  assert.equal(r3.result, 'flying');
  assert.equal(st.S.find(x => x.id === r3.task.to).agent, 'dsh');
  assert.equal(s.send().empty, true);
});

test('派活时按规则建议对象；手动选过就不自动换；对照建议打标签', () => {
  const s = fresh(), st = s.state;
  s.compose();
  s.setDraft('画个 logo');
  assert.equal(st.ui.hud.target, 'codex@mac');
  assert.equal(s.send().task.why.kind, 'rule');
  s.compose(); s.setTarget('cursor@mac'); s.setDraft('画个 logo');
  assert.equal(st.ui.hud.target, 'cursor@mac');
  const why = s.send().task.why;
  assert.equal(why.kind, 'override');
  assert.deepEqual(why.suggested, { agent: 'codex', dev: 'mac' });
});

test('“给它发消息”发到那个对话里，不新开', () => {
  const s = fresh(), st = s.state, n = st.S.length;
  s.compose({ target: 'codex@mac', mode: 'msg', session: 's3' });
  s.setDraft('再看一眼第二处');
  const r = s.send();
  assert.equal(r.task.to, 's3');
  assert.equal(st.S.length, n);
});

test('那台连不上：往那台派活没发出，reason=offline；重试连上后能重发', () => {
  const s = fresh(), st = s.state;
  s.setOnline('win', false); s.toggleRule2('cross');
  s.setTarget('codex@win'); s.setDraft('跑一下');
  const r = s.send();
  assert.equal(r.result, 'offline');
  assert.equal(r.task.reason, 'offline');
  assert.equal(s.retryTask(r.task.id).result, 'offline');
  s.setOnline('win', true);
  const again = s.retryTask(r.task.id);
  assert.equal(again.result, 'flying');
  assert.equal(again.task.retry_of, r.task.id);
});

test('没回音的重发：新任务带 retry_of，跨设备的照样先问', () => {
  const s = fresh(), st = s.state;
  const r = s.retryTask('t-9d31');
  assert.equal(r.task.retry_of, 't-9d31');
  assert.equal(r.result, 'asking');
  assert.equal(st.Q.at(-1).band, r.task.id);
  assert.equal(st.S.find(x => x.id === 's9').state, 'wait');
});

test('出错的对话重试：连得上就接着干活，连不上还是出错', () => {
  const s = fresh(), st = s.state;
  s.setOnline('win', false);
  assert.equal(s.retrySession('s9'), false);
  assert.equal(st.S.find(x => x.id === 's9').state, 'error');
  s.setOnline('win', true);
  assert.equal(s.retrySession('s9'), true);
  assert.equal(st.S.find(x => x.id === 's9').state, 'run');
});

test('换指挥：只有能发出的 agent 或你自己；你当指挥时选中的是“你”', () => {
  const s = fresh(), st = s.state;
  assert.equal(s.setLead({ kind: 'agent', agent: 'codex', dev: 'win' }), false);
  assert.equal(s.setLead({ kind: 'agent', agent: 'codex', dev: 'mac' }), true);
  assert.deepEqual(st.ui.stage.sel, { t: 'session', id: 's2' });
  assert.equal(s.setLead({ kind: 'you' }), true);
  assert.deepEqual(st.ui.stage.sel, { t: 'you' });
});

test('移除设备：先算清会去掉多少；指挥在那台上不让删', () => {
  const s = fresh(), st = s.state;
  const imp = removalImpact(st, 'win');
  assert.deepEqual(imp, { sessions: 6, tasks: 4, queue: 1, isLead: false });
  s.select({ t: 'session', id: 's8' });
  assert.equal(s.removeDevice('win'), 'CHEN-Y9000P2023');
  assert.ok(!st.S.some(x => x.dev === 'win'));
  assert.ok(!st.Q.some(q => q.band === 't-3a07'));
  assert.deepEqual(st.ui.stage.sel, { t: 'session', id: 's1' });
  assert.equal(st.FOUND.find(f => f.name === 'CHEN-Y9000P2023').added, false);
  const s2 = fresh();
  s2.state.CONN.win[0].out = 'yes';
  s2.setLead({ kind: 'agent', agent: 'codex', dev: 'win' });
  assert.equal(removalImpact(s2.state, 'win').isLead, true);
  assert.equal(s2.removeDevice('win'), null);
  assert.ok(s2.state.DEV.win);
});

test('一键接入能撤回', () => {
  const s = fresh(), st = s.state;
  st.CONN.mac[2].on = false;
  const before = s.applyPlan();
  assert.ok(st.CONN.mac.every(c => c.on));
  s.undoPlan(before);
  assert.equal(st.CONN.mac[2].on, false);
});

test('换模型时原来那档思考强度没有，落到中间那档', () => {
  const s = fresh(), st = s.state;
  s.setTarget('claude@mac');
  assert.deepEqual(s.pickOf('claude@mac'), { m: 'Opus 5.5', t: 'high' });
  s.pickModel('Haiku 5.5');
  assert.deepEqual(s.pickOf('claude@mac'), { m: 'Haiku 5.5', t: 'high' });
  s.setTarget('dsh@mac'); s.pickModel('DeepSeek V4 Flash');
  assert.equal(st.ui.hud.pick['dsh@mac'].t, 'high');
  const c = s.setConnModel('mac', 'cursor', 'Sonnet 5.5'); // Composer 2 不分档，换成分三档的
  assert.equal(c.think, 'medium');
});

test('添加经 Codex 的设备：Codex 是入口，别的由它带起', () => {
  const s = fresh(), st = s.state;
  s.openSheet(); s.sheetSet({ step: 2, name: 'LIN-MBP16', alias: '<书房>' });
  const name = s.addDevice(), id = st.ui.conn.fresh;
  assert.equal(name, '书房');
  assert.equal(st.DEV[id].online, true);
  assert.deepEqual(st.CONN[id].map(c => [c.a, c.role]), [['codex', 'gate'], ['claude', 'via'], ['cursor', 'via']]);
  assert.equal(st.CONN[id][1].model, 'Sonnet 5.5');
  assert.equal(st.FOUND.find(f => f.name === 'LIN-MBP16').added, true);
});
