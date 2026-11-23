// 项目频道：按目录名把对话和任务归成频道、消息流的先后、@ 的候选、没 @ 时交给谁
import test from 'node:test';
import assert from 'node:assert/strict';
import { baseName, projectKey, channelsOf, streamOf, mentionsOf, mentionAt, targetsOf, taskChan, LOOSE } from '../src/core/channels.js';
import { freshState, rehome } from './helpers.mjs';

test('目录名：Mac 和 Windows 路径都取最后一段，大小写不分', () => {
  assert.equal(baseName('/Users/demo/Code/pigeon/'), 'pigeon');
  assert.equal(baseName('F:\\Code\\Pigeon'), 'Pigeon');
  assert.equal(projectKey('F:\\Code\\Pigeon'), projectKey('/Users/demo/Code/pigeon'));
  assert.equal(baseName(''), '');
});

test('同名目录的对话归进一个频道，跨电脑也算；指挥不算成员', () => {
  const st = freshState(), chs = channelsOf(st), p = chs.find(c => c.key === 'pigeon');
  assert.ok(p, '有 pigeon 频道');
  assert.equal(p.lead, 's1');
  assert.ok(!p.members.includes('s1'), '指挥单独放');
  for (const id of ['s2', 's3', 's4', 's6', 's7', 's8']) assert.ok(p.members.includes(id), `${id} 在 pigeon 里`);
  assert.deepEqual(p.paths.map(x => x.dev).sort(), ['mac', 'win']);
  assert.ok(chs.some(c => c.key === 'site' && c.members.includes('s5')));
  assert.ok(chs.some(c => c.key === 'pigeon-installer' && c.members.includes('s9')));
  // 子对话不单独当成员
  assert.ok(!chs.some(c => c.members.includes('s1a') || c.members.includes('s6a')));
});

test('任务归进干活那一方的频道；回信看发回来的那一方', () => {
  const st = freshState(), T = id => st.T.find(t => t.id === id);
  assert.equal(taskChan(st, T('t-29e4')), 'p:site');            // 指挥派给 site 里的 DeepSeek
  assert.equal(taskChan(st, T('t-4b90')), 'p:pigeon');          // Codex 回信给指挥
  assert.equal(taskChan(st, T('t-9d31')), 'p:pigeon-installer');
  const chs = channelsOf(st), all = chs.flatMap(c => c.tasks);
  assert.equal(all.length, st.T.length, '每件任务恰好在一个频道里');
  assert.equal(new Set(all).size, all.length);
  assert.equal(chs.find(c => c.key === 'pigeon').waiting >= 1, true, '等你确认的那件算在 pigeon');
});

test('没有目录的任务放进“没有项目目录”；没任务时这个频道不出现', () => {
  const st = freshState();
  assert.ok(!channelsOf(st).some(c => c.id === LOOSE));
  st.S.push({ id: 'sx', agent: 'codex', dev: 'mac', title: '临时', state: 'idle' });
  st.T.unshift({ id: 't-x', from: 'you', to: 'sx', title: '随手一件', state: 'home' }); // 两头都没有目录
  const c = channelsOf(st).find(c => c.id === LOOSE);
  assert.ok(c && c.tasks.includes('t-x') && c.members.includes('sx'));
  assert.equal(channelsOf(st)[0].id, LOOSE, '最新的一件在这里，排最前');
});

test('消息流从旧到新，回信紧跟在它的派活后面，留言按 seq 插进去', () => {
  const st = freshState(), p = channelsOf(st).find(c => c.key === 'pigeon');
  const msgs = streamOf(st, p, st.NOTES['p:pigeon']);
  for (let i = 1; i < msgs.length; i++) assert.ok(msgs[i - 1].seq <= msgs[i].seq);
  const i = msgs.findIndex(m => m.id === 't-5c11');
  assert.equal(msgs[i + 1].kind, 'reply'); assert.equal(msgs[i + 1].thread, 't-5c11'); assert.equal(msgs[i + 1].from, 's3');
  const own = msgs.find(m => m.id === 't-4b90');
  assert.equal(own.kind, 'reply'); assert.ok(own.own);
  const n = msgs.findIndex(m => m.kind === 'note');
  assert.ok(n > 0 && n < msgs.length - 1, '留言夹在中间');
  assert.equal(msgs.at(-1).id, 't-8f2c', '最新的一件在最后');
});

test('@ 的候选：频道里的对话在前，后面是能新开对话的 agent；能按名字筛', () => {
  const st = freshState(), p = channelsOf(st).find(c => c.key === 'pigeon');
  const all = mentionsOf(st, p);
  const firstFresh = all.findIndex(m => m.fresh);
  assert.ok(firstFresh > 0 && all.slice(0, firstFresh).every(m => m.session));
  assert.ok(all[0].lead, '指挥排第一');
  // Windows 上的 Codex 是入口，能收；不能收的（out/inn 都 nope 的）不出现
  assert.ok(all.some(m => m.fresh && m.k === 'codex@win'));
  const cx = mentionsOf(st, p, 'codex');
  assert.ok(cx.length && cx.every(m => m.agent === 'codex'));
  assert.ok(mentionsOf(st, p, 'CHEN').every(m => m.dev === 'win'), '按设备名也能筛');
});

test('输入框里正在打的 @', () => {
  assert.deepEqual(mentionAt('看一下 @cod', 9), { at: 4, q: 'cod' });
  assert.deepEqual(mentionAt('@', 1), { at: 0, q: '' });
  assert.equal(mentionAt('mail a@b.com', 12), null, '邮箱不算');
  assert.equal(mentionAt('@codex 做完了', 10), null, '@ 后面已经有空格，打完了');
  assert.equal(mentionAt('没有', 2), null);
});

test('没 @ 时交给指挥；你当指挥时要 @ 一个', () => {
  const st = freshState(), p = channelsOf(st).find(c => c.key === 'pigeon');
  const t = targetsOf(st, p, []);
  assert.equal(t.length, 1); assert.equal(t[0].session, 's1'); assert.ok(t[0].lead);
  const pick = [{ k: 'codex@mac', session: 's2' }];
  assert.equal(targetsOf(st, p, pick), pick);
  st.lead = { kind: 'you' };
  const p2 = channelsOf(st).find(c => c.key === 'pigeon');
  assert.equal(p2.lead, 'you');
  assert.deepEqual(targetsOf(st, p2, []), []);
});

test('本机设备 id 不写死', () => {
  const st = rehome(freshState(), 'local'), p = channelsOf(st).find(c => c.key === 'pigeon');
  assert.ok(p.paths.some(x => x.dev === 'local'));
  assert.ok(mentionsOf(st, p).some(m => m.k === 'codex@local'));
});

test('接活那一方没有目录时，按派活那一方的目录归', () => {
  const st = freshState();
  st.S.push({ id: 'stub1', agent: 'codex', dev: 'mac', title: '经 pigeon run 新开的', state: 'run', stub: true });
  st.T.unshift({ id: 't-run', from: 's1', to: 'stub1', title: '生图', state: 'flying' });
  assert.equal(taskChan(st, st.T[0]), 'p:pigeon');
  assert.ok(channelsOf(st).find(c => c.key === 'pigeon').members.includes('stub1'));
});
