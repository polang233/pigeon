// magpie 的额度卡怎么对上本机几家 agent；时间和悬停的说法
import test from 'node:test';
import assert from 'node:assert/strict';
import { fromCards, qTip, qc, quotaSig } from '../src/core/quota.js';
import { untilZh, rst } from '../src/core/time.js';

const CARDS = [
  { provider: 'codex', kind: 'subscription', plan: 'plus', lastServedAt: '2026-11-13T09:00:00Z', windows: [{ name: '5 hours', used: 10, resetsAt: '2026-11-13T12:00:00Z' }] },
  { provider: 'codex', kind: 'subscription', plan: 'prolite', last: true, windows: [{ name: '5 hours', used: 40, resetsAt: '2026-11-13T12:00:00Z' }, { name: '7 days', used: 78, resetsAt: '2026-11-18T00:00:00Z' }] },
  { provider: 'cursor', kind: 'subscription', plan: 'premium', windows: [{ name: 'monthly', used: 17, resetsAt: '2026-12-01T00:00:00Z' }, { name: 'auto', used: 3, lane: 'auto', resetsAt: '2026-12-01T00:00:00Z' }] },
  { provider: 'deepseek', kind: 'balance', balance: '¥-0.00' },
  { provider: 'claude', kind: 'subscription', from: 'office', windows: [{ name: '5 hours', used: 50, resetsAt: '2026-11-13T12:00:00Z' }] },
];

test('同一家几个账号取最近答话的那个，时间窗取用得最多的', () => {
  const out = fromCards(CARDS, 'mac'), q = out['codex@mac'];
  assert.equal(q.plan, 'ChatGPT Pro Lite');
  assert.equal(q.left, 22);
  assert.equal(q.win, '7 天额度');
  assert.equal(q.more, '5 小时剩 60% · 共 2 个账号，这是最近用的');
  assert.equal(q.src, 'magpie');
  assert.equal(q.resetAt, Date.parse('2026-11-18T00:00:00Z'));
});

test('分道的时间窗不算；按量付费写余额，余额是 0 标红', () => {
  const out = fromCards(CARDS, 'mac');
  assert.equal(out['cursor@mac'].left, 83);
  assert.equal(out['cursor@mac'].win, '本月额度');
  assert.equal(out['dsh@mac'].bal, '¥0.00');
  assert.equal(out['dsh@mac'].warn, true);
});

test('别的电脑上的卡不算本机的；读不到就写为什么', () => {
  const out = fromCards(CARDS, 'mac');
  assert.equal(out['claude@mac'].none, true);
  assert.equal(out['claude@mac'].why, 'magpie 里没有 Claude 的额度');
  const err = fromCards([{ provider: 'cursor', kind: 'subscription', error: 'timeout', windows: [] }], 'mac');
  assert.equal(err['cursor@mac'].why, 'magpie 这次没读到 Cursor 的额度');
});

test('键按本机 id 算，不写死 mac', () => {
  const out = fromCards(CARDS, 'm1');
  assert.deepEqual(Object.keys(out).sort(), ['antigravity@m1', 'claude@m1', 'codex@m1', 'cursor@m1', 'dsh@m1']);
});

test('悬停的说法、颜色、多久后重置', () => {
  assert.equal(qTip({ plan: 'Claude Max', left: 62, win: '5 小时额度', reset: '1:40 后重置', more: '本周剩 48%' }), 'Claude Max · 5 小时额度剩 62% · 1:40 后重置 · 本周剩 48%');
  assert.equal(qTip({ plan: 'magpie 里的 DeepSeek key', bal: '¥3.20' }), '按量付费 · magpie 里的 DeepSeek key 余额 ¥3.20');
  assert.equal(qTip({ none: true, why: '读不到' }), '读不到');
  assert.equal(qc(10), 'var(--wait)'); assert.equal(qc(30), 'var(--run)'); assert.equal(qc(80), 'var(--ok)');
  const now = Date.parse('2026-11-13T10:00:00Z');
  assert.equal(untilZh(now + 65 * 60000, now), '1:05 后重置');
  assert.equal(untilZh(now + 3 * 86400000, now), '3 天后重置');
  assert.equal(untilZh(now - 1, now), '马上重置');
  assert.equal(rst({ resetAt: now + 30 * 60000 }, now), '0:30 后重置');
  assert.equal(rst({ reset: '12 天后重置' }), '12 天后重置');
});

test('额度有没有变：只差重置时间不算变', () => {
  assert.equal(quotaSig('live', { a: { left: 1, resetAt: 1 } }), quotaSig('live', { a: { left: 1, resetAt: 2 } }));
  assert.notEqual(quotaSig('live', { a: { left: 1 } }), quotaSig('off', { a: { left: 1 } }));
});
