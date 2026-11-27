// 分派规则：逐条判、额度不够时改派、交给的不在了跳过、写进提示里的原文；本机 id 不写死
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeOf, promptText, kwRe, alive, lowQ, targets } from '../src/core/route.js';
import { nameOf, shortDev } from '../src/core/names.js';
import { freshState, rehome } from './helpers.mjs';

const steps = res => res.steps.map(x => `${x.r.id}:${x.st}`).join(' ');

test('命中第一条：生图交给本机 Codex', () => {
  const st = freshState(), res = routeOf(st, '帮我画一个 logo');
  assert.equal(res.r.id, 'r1');
  assert.equal(res.to, 'codex@mac');
  assert.equal(steps(res), 'r1:hit');
});

test('交给的那家额度低于阈值：按“额度不够时”改派', () => {
  const st = freshState(); // codex@win 剩 16%，阈值 20%
  assert.ok(lowQ(st, 'codex@win'));
  const res = routeOf(st, '在 Windows 上跑一遍测试');
  assert.equal(res.r.id, 'r3');
  assert.equal(res.fb, true);
  assert.equal(res.to, 'claude@win');
  assert.equal(steps(res), 'r1:miss r2:miss r3:fb');
});

test('阈值调低后不改派，照常交给原来那家', () => {
  const st = freshState(); st.LOW = 10;
  const res = routeOf(st, '在 Windows 上跑一遍测试');
  assert.equal(res.to, 'codex@win');
  assert.ok(!res.fb && !res.low);
});

test('额度低但没写改派：照常派，标出额度低', () => {
  const st = freshState(); st.RULES.find(r => r.id === 'r3').fb = '';
  const res = routeOf(st, 'windows 构建');
  assert.equal(res.to, 'codex@win');
  assert.equal(res.low, true);
});

test('关着的规则跳过；交给的设备移除了也跳过', () => {
  const st = freshState();
  st.RULES.find(r => r.id === 'r1').on = false;
  assert.equal(routeOf(st, '画图').r, null);
  assert.match(steps(routeOf(st, '画图')), /^r1:off/);
  const st2 = freshState(); delete st2.DEV.win; delete st2.CONN.win;
  const res = routeOf(st2, 'windows 测试');
  assert.match(steps(res), /r3:gone/);
  assert.ok(!alive(st2, 'codex@win'));
  assert.ok(!targets(st2).some(k => k.endsWith('@win')));
});

test('没有规则命中：留给指挥', () => {
  const res = routeOf(freshState(), '今天吃什么');
  assert.equal(res.r, null);
  assert.equal(res.steps.length, freshState().RULES.length);
});

test('关键词里的正则符号按字面算，不分大小写；空关键词不命中', () => {
  assert.ok(kwRe({ kw: 'c++ (x)' }).test('学 C++ 的书'));
  assert.ok(!kwRe({ kw: 'a.b' }).test('axb'));
  assert.equal(kwRe({ kw: '  ' }), null);
});

test('写进提示里的原文：额度不够写明先交给谁，跨设备写明要确认', () => {
  const text = promptText(freshState());
  assert.match(text, /- 生图、改图 → Codex（本机）\n/);
  assert.match(text, /要在 Windows 上跑的构建和测试 → Codex（CHEN-Y9000P2023）。它的额度现在只剩 16%，先交给 Claude Code（CHEN-Y9000P2023）。发之前要用户确认/);
  assert.match(text, /派活时附一句理由/);
});

test('本机 id 不叫 mac 也一样：本机显示“本机”，规则照常命中', () => {
  const st = rehome(freshState(), 'm1');
  assert.equal(shortDev(st, 'm1'), '本机');
  assert.equal(nameOf(st, 'codex@m1'), 'Codex（本机）');
  assert.equal(routeOf(st, '画个图').to, 'codex@m1');
  assert.match(promptText(st), /生图、改图 → Codex（本机）/);
  assert.ok(!promptText(st).includes('mac'));
});

test('协作的规矩关掉“跨设备先问我”：没写 ask 的跨设备规则不再要确认，提示原文跟着变', () => {
  const st = freshState();
  st.RULES.find(r => r.id === 'r3').ask = false;
  assert.match(promptText(st), /先交给 Claude Code（CHEN-Y9000P2023）。发之前要用户确认/);
  assert.match(promptText(st), /往别的电脑派活，Pigeon 会先问用户，90 秒没人点就不发/);
  st.RULES2.find(r => r.id === 'cross').on = false;
  assert.doesNotMatch(promptText(st), /发之前要用户确认/);
  assert.doesNotMatch(promptText(st), /往别的电脑派活/);
  st.RULES2.find(r => r.id === 'split').on = false;
  assert.doesNotMatch(promptText(st), /拆成 3 件以上/);
  assert.match(promptText(st), /接活的 agent 再往下转派时/);
});

test('交给的正好是指挥：算指挥自己做，提示里写“你自己做”，不问用户', () => {
  const st = freshState(); // 指挥是本机 Claude Code，r7 规划交给 claude@mac
  st.RULES.find(r => r.id === 'r7').ask = true;
  const res = routeOf(st, '把这个需求拆解一下');
  assert.equal(res.r.id, 'r7');
  assert.equal(res.to, 'claude@mac');
  const text = promptText(st);
  assert.match(text, /- 规划、统筹、拆解任务 → 你自己做，不用交出去\n/);
  assert.doesNotMatch(text, /拆解任务 → 你自己做，不用交出去。发之前/);
  // 改派写的是指挥自己：额度够时写明“它额度不够时你自己做”，不够时写“先你自己做”
  assert.match(text, /- 创作内容、设计新东西 → Antigravity（本机）。它额度不够时你自己做\n/);
  st.SUB['antigravity@mac'] = { left: 8 };
  assert.match(promptText(st), /创作内容、设计新东西 → Antigravity（本机）。它的额度现在只剩 8%，先你自己做/);
  assert.equal(routeOf(st, '写段文案').to, 'claude@mac');
});

test('换了指挥：原来“自己做”的规则照常交给 Claude Code；它接不了活就跳过，不写进提示', () => {
  const st = freshState(); st.lead = { kind: 'agent', agent: 'codex', dev: 'mac' };
  assert.match(promptText(st), /- 规划、统筹、拆解任务 → Claude Code（本机）\n/);
  assert.match(promptText(st), /- 生图、改图 → 你自己做，不用交出去\n/);
  st.CONN.mac.find(c => c.a === 'claude').inn = 'nope';
  assert.ok(!alive(st, 'claude@mac'));
  assert.doesNotMatch(promptText(st), /规划/);
  assert.match(routeOf(st, '规划一下').steps.at(-1).st, /gone/);
  assert.doesNotMatch(promptText(st), /它额度不够时你自己做/);
  // 指挥是 Claude Code、它又接不了活：自己做照样算数
  st.lead = { kind: 'agent', agent: 'claude', dev: 'mac' };
  assert.ok(alive(st, 'claude@mac'));
  assert.ok(!targets(st).includes('claude@mac'), '能接活的对象里没有它');
  assert.match(promptText(st), /规划、统筹、拆解任务 → 你自己做/);
});

test('你自己当指挥：没有提示可写', () => {
  const st = freshState(); st.lead = { kind: 'you' };
  assert.equal(promptText(st), null);
  assert.equal(routeOf(st, '画个图').to, 'codex@mac');
});
