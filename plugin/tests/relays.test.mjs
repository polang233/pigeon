// 中继站：共用一条、某台单独用一条、换下来的记进用过的；读对话记录最后一轮的上下文大小（包括 Codex 压过的 .zst）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { normRelay, relayFor, relayIds, isRelay, useRelay, forgetRelay, contextOf, relayRows, RELAY_USED_MAX } from '../scripts/lib/relays.mjs';

test('往哪台发用哪条：那台单独指定了用它的，没有用共用的', () => {
  const post = normRelay({ relayThread: ' r0 ', relayByHost: { win: 'r1', bad: '', '': 'x' }, relayUsed: ['r0', 'r0', '', 3] });
  assert.equal(post.relayThread, 'r0');
  assert.deepEqual(post.relayByHost, { win: 'r1' });
  assert.deepEqual(post.relayUsed, ['r0']);
  assert.equal(relayFor(post, 'win'), 'r1');
  assert.equal(relayFor(post, 'mac2'), 'r0');
  assert.equal(relayFor(post), 'r0');
  assert.deepEqual(relayIds(post), ['r0', 'r1']);
  assert.ok(isRelay(post, 'r1') && !isRelay(post, 'r2') && !isRelay(post, ''));
  // 设置里乱写的也不出错
  assert.deepEqual(normRelay({ relayByHost: ['x'], relayUsed: 'x' }), { relayThread: '', relayByHost: {}, relayUsed: [] });
});

test('换中继站：换下来的和换上去的都记进用过的，最新的在前；那台清掉后跟着共用的', () => {
  let post = normRelay({ relayThread: 'r0' });
  post = useRelay(post, 'r1');
  assert.equal(post.relayThread, 'r1');
  assert.deepEqual(post.relayUsed, ['r1', 'r0']);
  post = useRelay(post, 'r2', 'win');
  assert.deepEqual(post.relayByHost, { win: 'r2' });
  assert.deepEqual(post.relayUsed, ['r2', 'r1', 'r0']);
  post = useRelay(post, '', 'win');
  assert.deepEqual(post.relayByHost, {});
  assert.equal(relayFor(post, 'win'), 'r1');
  assert.deepEqual(forgetRelay(post, 'r0').relayUsed, ['r2', 'r1']);
  for (let i = 0; i < 30; i++) post = useRelay(post, 'n' + i);
  assert.equal(post.relayUsed.length, RELAY_USED_MAX);
});

test('上下文大小：取最后一次 token_count；Codex 把记录压成 .zst 以后也读得到', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pigeon-relay-'));
  const ev = n => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: n * 10 }, last_token_usage: { input_tokens: n, cached_input_tokens: 0 }, model_context_window: 400000 } } });
  const text = [ev(1000), '{"type":"response_item"}', ev(52000), ''].join('\n');
  const plain = path.join(dir, 'a.jsonl');
  fs.writeFileSync(plain, text);
  assert.deepEqual(contextOf(plain), { context: 52000, window: 400000 });
  if (typeof zlib.zstdCompressSync === 'function') {
    const z = path.join(dir, 'b.jsonl');
    fs.writeFileSync(z + '.zst', zlib.zstdCompressSync(Buffer.from(text)));
    assert.deepEqual(contextOf(z), { context: 52000, window: 400000 }, '数据库里记的还是 .jsonl，文件已经是 .jsonl.zst');
  }
  assert.equal(contextOf(path.join(dir, 'none.jsonl')), null);
  fs.writeFileSync(path.join(dir, 'c.jsonl'), '{"type":"session_meta"}\n');
  assert.equal(contextOf(path.join(dir, 'c.jsonl')), null, '还没跑过一轮');
});

test('整张表：在用的在前，标出共用的和单独给哪台；本机没找到的也列出来', () => {
  const post = normRelay({ relayThread: 'r1', relayByHost: { win: 'r2' }, relayUsed: ['r0', 'r1'] });
  const threads = { r1: { id: 'r1', title: '中转用', model: 'm', effort: 'low', tokensUsed: 9, updated: 5, rollout: '' }, r2: { id: 'r2', title: '给 Windows', archived: false, rollout: '' } };
  const rows = relayRows(post, { thread: id => threads[id] || null });
  assert.deepEqual(rows.map(r => r.id), ['r1', 'r2', 'r0']);
  assert.equal(rows[0].shared, true);
  assert.deepEqual(rows[1].hosts, ['win']);
  assert.equal(rows[2].missing, true);
  assert.equal(rows[0].context, null);
  assert.equal(rows[0].model, 'm');
});
