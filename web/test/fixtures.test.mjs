// 和应用、插件共用的两份用例：分派规则怎么判（tests/fixtures/dispatch-cases.json）、跨设备发送前查密钥（secrets-cases.json）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { suggest } from '../src/core/route.js';
import { kindsIn, maskSecrets } from '../src/core/secrets.js';
import { rulesFromWire, keyFromWire, keyToWire } from '../src/backend/adapt.js';

const load = f => JSON.parse(readFileSync(new URL(`../../tests/fixtures/${f}`, import.meta.url), 'utf8'));
const D = load('dispatch-cases.json'), SEC = load('secrets-cases.json');

// 用例里的 alive、quota、confirmRemote、lead → 界面的状态：alive 里的每一家都开着、能接收；没写 lead 就是用户自己当指挥
function stateOf(c) {
  const alive = c.alive.map(keyFromWire), DEV = { local: {} }, CONN = {}, L = c.lead && keyFromWire(c.lead);
  for (const k of alive) { const d = k.slice(k.indexOf('@') + 1); DEV[d] = {}; (CONN[d] ??= []).push({ a: k.split('@')[0], on: true, inn: 'yes' }); }
  return {
    home: 'local', DEV, CONN, LOW: D.low, RULES: rulesFromWire(D.rules),
    SUB: Object.fromEntries(Object.entries(c.quota).map(([k, v]) => [keyFromWire(k), { left: v }])),
    RULES2: [{ id: 'cross', on: c.confirmRemote }], lead: L ? { kind: 'agent', agent: L.split('@')[0], dev: L.split('@')[1] } : { kind: 'you' }, settings: {},
  };
}

for (const c of D.cases) {
  test(`分派用例：${c.name}`, () => {
    const got = suggest(stateOf(c), c.text, c.to ? keyFromWire(c.to) : undefined);
    const want = { ...c.expect };
    if (!c.to) delete want.kind;
    assert.deepEqual({ ...got, suggested: keyToWire(got.suggested) }, want);
  });
}

test('查密钥的共用用例：类别按出现先后去重，打码后的文字', () => {
  for (const c of SEC.cases) {
    assert.deepEqual(kindsIn(c.text), c.kinds, c.text);
    assert.equal(maskSecrets(c.text), c.masked, c.text);
  }
});
