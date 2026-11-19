// pigeon run 什么时候在 Codex 应用里打开对话：新字段 openWhen 优先，没写时按旧的 autoOpen
import test from 'node:test';
import assert from 'node:assert/strict';
import { openWhenOf } from '../scripts/lib/run.mjs';

test('openWhen 优先，旧 autoOpen 兜底', () => {
  assert.equal(openWhenOf({}), 'never');
  assert.equal(openWhenOf({ autoOpen: true }), 'end');
  assert.equal(openWhenOf({ openWhen: 'start', autoOpen: false }), 'start');
  assert.equal(openWhenOf({ openWhen: 'never', autoOpen: true }), 'never');
  assert.equal(openWhenOf({ openWhen: 'bogus', autoOpen: true }), 'end');
});
