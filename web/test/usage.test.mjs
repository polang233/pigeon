// 接入页“用量”：用量摘要 → 各 agent、各家的占比；哪家按最近的模型名猜；数字怎么写
import test from 'node:test';
import assert from 'node:assert/strict';
import { usageShare, famOf, tokensOf, fmtTokens } from '../src/core/usage.js';
import { createMock } from '../src/data/mock.js';

const U = { day: '2026-11-13', agents: {
  claude: { model: 'claude-opus-5-5', today: { input: 10, output: 40, cacheRead: 600, cacheWrite: 50, messages: 3 }, week: { input: 100, output: 400, cacheRead: 6000, cacheWrite: 500, messages: 30 } },
  subagent: { model: 'claude-haiku-5-5', today: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0 }, week: { input: 0, output: 100, cacheRead: 900, cacheWrite: 0, messages: 4 } },
  codex: { model: 'gpt-5.5', today: { input: 200, output: 60, cacheRead: 40, cacheWrite: 0, messages: 1 }, week: { input: 1000, output: 500, cacheRead: 500, cacheWrite: 0, messages: 5 } },
} };

test('全部 token：输入、输出、缓存读、缓存写加起来；按用量从多到少', () => {
  const r = usageShare(U, 'week', 'all');
  assert.equal(r.total, 7000 + 1000 + 2000);
  assert.deepEqual(r.rows.map(x => [x.k, x.n, x.pct]), [['claude', 7000, 70], ['codex', 2000, 20], ['subagent', 1000, 10]]);
  assert.deepEqual(r.fams.map(f => [f.name, f.n, f.pct]), [['Claude', 8000, 80], ['ChatGPT', 2000, 20]]);
  assert.equal(r.rows[0].a, 'claude');
  assert.equal(r.rows[2].name, 'Claude Code 子代理');
});

test('只算输出；今天没有用量的 agent 不列', () => {
  const r = usageShare(U, 'week', 'output');
  assert.deepEqual(r.rows.map(x => [x.k, x.n]), [['codex', 500], ['claude', 400], ['subagent', 100]]);
  assert.deepEqual(r.fams.map(f => [f.name, f.pct]), [['ChatGPT', 50], ['Claude', 50]]);
  const t = usageShare(U, 'today', 'all');
  assert.deepEqual(t.rows.map(x => x.k), ['claude', 'codex']);
});

test('没读到是 null，读到了但是零是 total 0', () => {
  assert.equal(usageShare(null), null);
  assert.equal(usageShare({ day: 'x' }), null);
  assert.deepEqual(usageShare({ day: 'x', agents: {} }), { total: 0, rows: [], fams: [] });
  assert.equal(usageShare({ agents: { claude: { model: '', today: {} } } }, 'week').total, 0);
  assert.equal(usageShare({ agents: { claude: null, codex: 'x' } }).total, 0);
});

test('哪家：先看模型名（去掉 codex/ 这类前缀），猜不出看 agent', () => {
  assert.equal(famOf('claude', 'claude-sonnet-5-5'), 'claude');
  assert.equal(famOf('codex', 'gpt-6.1-sol'), 'chatgpt');
  assert.equal(famOf('codex', 'o4-mini'), 'chatgpt');
  assert.equal(famOf('claude', 'codex/gpt-6.1-sol'), 'chatgpt');
  assert.equal(famOf('antigravity', 'gemini-4-neon'), 'gemini');
  assert.equal(famOf('antigravity', 'claude-opus-5-5'), 'claude');
  assert.equal(famOf('deepseek', ''), 'deepseek');
  assert.equal(famOf('codex', 'local/qwen3-coder'), 'chatgpt');
  assert.equal(famOf('whatever', ''), 'other');
});

test('tokensOf 不认识的值当 0', () => {
  assert.equal(tokensOf({ input: '5', output: -3, cacheRead: null }, 'all'), 5);
  assert.equal(tokensOf(null, 'all'), 0);
  assert.equal(tokensOf({ output: 7, input: 9 }, 'output'), 7);
});

test('fmtTokens：万、亿，上千万不带小数', () => {
  assert.equal(fmtTokens(1234), '1234');
  assert.equal(fmtTokens(56789), '5.7 万');
  assert.equal(fmtTokens(3435000), '343.5 万');
  assert.equal(fmtTokens(56688000), '5669 万');
  assert.equal(fmtTokens(123456789), '1.2 亿');
  assert.equal(fmtTokens(-1), '0');
});

test('演示的示例用量能算出占比，没有邮箱', () => {
  const m = createMock(0), r = usageShare(m.USAGE, 'week', 'all');
  assert.ok(r.total > 0 && r.fams.length === 2);
  assert.doesNotMatch(JSON.stringify(m.USAGE), /@/);
});
