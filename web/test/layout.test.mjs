// 指挥台的排布：默认格子、撞了找空格、放不下两格时卡片缩成一格；连线形状；一页上有哪些节点
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCells, freeCell, placeCells, cellsOf, gridOf, leavesOf, edgePath, zoomOf, saveCell, loadCell, nearestCell } from '../src/core/layout.js';
import { devicePage, pagesOf, edgeOf, stateOf, poseOf, events, leadSessions } from '../src/core/pages.js';
import { freshState, rehome } from './helpers.mjs';

const tree = (...froms) => ({ center: { kind: 'lead' }, nodes: froms.map(from => ({ kind: 'agent', from })) });
const noOverlap = (placed) => {
  const seen = new Set();
  for (const { c, span } of placed) for (const q of cellsOf(c, span)) { assert.ok(!seen.has(q), `格子 ${q} 放了两个节点`); seen.add(q); }
};

test('指挥在最左边，孩子往右一列，父节点在孩子中间', () => {
  const cells = defaultCells(tree(-1, -1, -1), 7, 5);
  const [lead, ...kids] = cells;
  assert.ok(kids.every(c => c[0] > lead[0]), '孩子都在指挥右边');
  assert.equal(new Set(kids.map(c => c[0])).size, 1, '孩子在同一列');
  assert.deepEqual(kids.map(c => c[1]), [1, 2, 3]);
  assert.equal(lead[1], 2, '指挥在三个孩子中间那行');
});

test('孙子节点再往右一层', () => {
  const cells = defaultCells(tree(-1, 0), 7, 4);
  assert.ok(cells[2][0] > cells[1][0]);
  assert.equal(cells[2][1], cells[1][1]);
});

test('格子被占了就找最近的空格；一个空的都没有返回 null', () => {
  const G = { cols: 3, rows: 2 };
  assert.deepEqual(freeCell(G, [1, 0], new Set()), [1, 0]);
  const near = freeCell(G, [1, 0], new Set(['1,0']));
  assert.equal(Math.hypot(near[0] - 1, (near[1] - 0) * 1.2), 1);
  assert.equal(freeCell(G, [0, 0], new Set(['0,0', '1,0', '2,0', '0,1', '1,1', '2,1'])), null);
});

test('按默认格子放下去不重叠；收起的设备占两格，放不下时缩成一格', () => {
  const st = freshState(), p = devicePage(st, 'mac');
  const spans = [p.center, ...p.nodes].map(n => (n.kind === 'group' ? 2 : 1));
  const G = { cols: 8, rows: 4 };
  const placed = placeCells(G, p, spans);
  noOverlap(placed);
  const gi = p.nodes.findIndex(n => n.kind === 'group') + 1;
  assert.equal(placed[gi].span, 2);
  assert.ok(placed.every(({ c, span }) => c[0] >= 0 && c[0] + span <= G.cols && c[1] >= 0 && c[1] < G.rows));
  // 窄到每列只放得下零散的空格：卡片缩成一格
  const tight = placeCells({ cols: 3, rows: 2 }, p, spans);
  noOverlap(tight.filter(x => x.c));
  assert.ok(tight[gi].compact && tight[gi].span === 1);
});

test('网格大小：节点越多行距收得越紧，至少 3 列 2 行', () => {
  const z = zoomOf(900, 520), G = gridOf(900, 520, 118, 120, z, 6);
  assert.ok(G.cols >= 3 && G.rows >= 2);
  assert.ok(G.ch <= 132 && G.ch >= 120 * .9);
  assert.equal(leavesOf(tree(-1, 0, 0)), 2);
});

test('连线：同一行是一条横线，上下排着时从下边出发', () => {
  const a = { cx: 0, cy: 50, rx: 20, ry: 20 }, b = { cx: 200, cy: 50, rx: 20, ry: 20 };
  assert.equal(edgePath(a, b, 1, false).d, 'M25,50 H175');
  const c = { cx: 10, cy: 200, rx: 20, ry: 20 };
  assert.match(edgePath(a, c, 1, false).d, /^M0,74 V/);
  assert.match(edgePath(a, b, 1, true).d, /^M0,50 Q/);
});

test('指挥那页：远程设备默认收成卡片，线从本机的 Codex 出去；展开后换成那台的几个 agent', () => {
  const st = freshState(), p = devicePage(st, 'mac');
  const card = p.nodes.find(n => n.kind === 'group');
  assert.equal(card.dev, 'win');
  assert.equal(p.nodes[card.from].a, 'codex');
  st.ui.open.win = true;
  const p2 = devicePage(st, 'mac'), remote = p2.nodes.filter(n => n.remoteOf === 'win');
  assert.deepEqual(remote.map(n => n.a), ['codex', 'claude', 'cursor']);
  assert.ok(remote[0].gate);
  assert.equal(p2.nodes[remote[1].from], remote[0], '经入口带起的挂在入口下面');
});

test('别的设备那页：指挥那台收成卡片放在最左边，跨设备等确认的那段停着鸽子', () => {
  const st = freshState(), [, win] = pagesOf(st);
  assert.equal(win.center.kind, 'group');
  assert.ok(win.center.host);
  assert.equal(win.center.via, 'codex');
  const k = win.nodes.findIndex(n => n.a === 'claude');
  assert.equal(edgeOf(st, win, k).st, '', '这页上 claude 和卡片之间隔着 Codex，等确认的停在 Codex 那段');
  const kc = win.nodes.findIndex(n => n.a === 'codex');
  assert.equal(edgeOf(st, win, kc).st, 'wait');
  assert.equal(stateOf(st, win.nodes[k]), 'wait');
  assert.equal(poseOf(st, win.nodes[k], 'wait'), 'notification');
  assert.ok(events(st, win).length > 0);
});

test('本机 id 换了，指挥那页照样排', () => {
  const st = rehome(freshState(), 'm1'), p = devicePage(st, 'm1');
  assert.equal(p.key, 'm1');
  assert.equal(p.center.kind, 'lead');
  assert.ok(p.nodes.some(n => n.kind === 'group' && n.dev === 'win'));
});

test('形象按 activity 挑动作：指挥派活是指挥，构建、测试是搭建，读是在想，出错挠头', () => {
  const st = freshState(), [mac, win] = pagesOf(st);
  assert.equal(poseOf(st, mac.center, stateOf(st, mac.center)), 'working-conducting');
  const by = (p, a) => p.nodes.find(n => n.a === a && n.kind === 'agent');
  assert.equal(poseOf(st, by(win, 'codex'), 'run'), 'working-building');
  const cursor = by(win, 'cursor');
  assert.equal(stateOf(st, cursor), 'error');
  assert.equal(poseOf(st, cursor, 'error'), 'working-confused');
  st.S.find(s => s.id === 's6').activity = 'reading';
  assert.equal(poseOf(st, by(win, 'codex'), 'run'), 'working-thinking');
});

test('你自己当指挥：中心画“你”，本机的 agent 都挂在你下面；别的设备那页的卡片里没有指挥的标', () => {
  const st = freshState(); st.lead = { kind: 'you' };
  const [mac, win] = pagesOf(st);
  assert.equal(mac.center.kind, 'you');
  assert.deepEqual(mac.nodes.filter(n => n.kind === 'agent').map(n => n.a), ['claude', 'codex', 'cursor', 'dsh', 'antigravity']);
  assert.equal(win.center.host, true);
  assert.deepEqual(win.center.agents, ['claude', 'codex', 'cursor', 'dsh', 'antigravity']);
});

test('换个能发出的 agent 当指挥：它在那台的对话都画在中心，最近一次派活的排第一', () => {
  const st = freshState(); st.lead = { kind: 'agent', agent: 'codex', dev: 'mac' };
  const [mac] = pagesOf(st);
  assert.equal(mac.center.a, 'codex');
  assert.deepEqual(mac.center.ids, ['s2', 's3']);
  assert.ok(!mac.nodes.some(n => n.kind === 'agent' && n.a === 'codex'), '不再另画一个 Codex');
  assert.ok(mac.nodes.some(n => n.a === 'claude'));
  // 远程卡片原来挂在本机 Codex 下面，Codex 当指挥时就挂在中心
  assert.equal(mac.nodes.find(n => n.kind === 'group').from, -1);
});

test('指挥在本机还有别的对话：都算指挥，收在中心，不再另画一个同名的 agent', () => {
  const st = freshState();
  st.S.push({ id: 'c2', agent: 'claude', dev: 'mac', title: '另一个 Claude Code 对话', state: 'wait', activity: 'waiting', model: 'Opus 5.5', think: 'high', note: '等你批准' });
  const [mac, win] = pagesOf(st);
  assert.equal(mac.center.kind, 'lead');
  assert.deepEqual(mac.center.ids, ['s1', 's1a', 'c2'], '最近派活的 s1 和它的子代理在前');
  assert.ok(!mac.nodes.some(n => n.kind === 'agent' && n.a === 'claude'), '本机那页上只有一个 Claude Code');
  assert.equal(stateOf(st, mac.center), 'wait', '其中一个对话在等你，指挥就显示在等你');
  assert.deepEqual(leadSessions(st).map(s => s.id), ['s1', 'c2']);
  // 别的电脑上的 Claude Code 是另一个，照常画
  assert.ok(win.nodes.some(n => n.a === 'claude'));
  // 你当指挥时，本机的 Claude Code 是普通的一个节点，几个对话都在它身上
  st.lead = { kind: 'you' };
  const [mac2] = pagesOf(st);
  assert.deepEqual(mac2.nodes.find(n => n.a === 'claude').ids, ['s1', 's1a', 'c2']);
});

test('拖过的节点先占位，别的绕开；位置按比例换算到新网格', () => {
  const G = { cols: 8, rows: 5 }, p = tree(-1, -1, 0), spans = [1, 1, 1, 1];
  const def = placeCells(G, p, spans);
  // 把第三个节点钉到第一个节点默认的格子上：它拿到这格，第一个节点挪到别处
  const pinned = [null, null, null, def[1].c];
  const placed = placeCells(G, p, spans, pinned);
  assert.deepEqual(placed[3].c, def[1].c);
  assert.ok(placed[3].pinned && !placed[1].pinned);
  assert.notDeepEqual(placed[1].c, def[1].c);
  noOverlap(placed);
  // 比例记法：网格从 8×5 变成 11×7，最右下角还是最右下角
  const f = saveCell(G, [7, 4]);
  assert.deepEqual(loadCell({ cols: 11, rows: 7 }, f), [10, 6]);
  assert.deepEqual(loadCell(G, saveCell(G, [3, 2])), [3, 2]);
  // 像素到最近的格子，出界的夹回网格里
  const g = { cols: 6, rows: 4, cw: 100, ch: 80, ox: 50, oy: 40 };
  assert.deepEqual(nearestCell(g, 260, 130), [2, 1]);
  assert.deepEqual(nearestCell(g, 9999, -50), [5, 0]);
  assert.deepEqual(nearestCell(g, 560, 40, 2), [4, 0]);
});

// 整条路线：别的 agent 发的活从发信方一路画到收信方
import { routeOf, routesOf, nodeOf } from '../src/core/pages.js';
import { routePath, peerPath } from '../src/core/layout.js';

test('有指挥时，两个 agent 之间直接传，不经指挥', () => {
  const st = freshState(), p = devicePage(st, st.home), t = st.T.find(x => x.id === 't-c0d5');
  const a = nodeOf(p, t.from), b = nodeOf(p, t.to);
  assert.ok(a > 0 && b > 0);
  assert.deepEqual(routeOf(st, p, t), { hops: [a, b], peer: 0 });
  // 这件不再算在 DSH 那段线上，鸽子沿着路线飞
  assert.notEqual(edgeOf(st, p, b - 1).a, 'codex');
  assert.ok(routesOf(st, p).some(r => r.t === 't-c0d5' && r.st === 'live' && r.a === 'codex' && r.b === 'dsh'));
});

test('指挥自己派的活照旧画在收信那段线上', () => {
  const st = freshState(), p = devicePage(st, st.home);
  assert.equal(routeOf(st, p, st.T.find(x => x.id === 't-8f2c')), null);
});

test('你自己当指挥时，Claude 发的活经过你，路线是 Claude → 你 → 收信方', () => {
  const st = freshState(); st.lead = { kind: 'you' };
  const p = devicePage(st, st.home), t = st.T.find(x => x.id === 't-8f2c');
  const a = nodeOf(p, t.from), b = nodeOf(p, t.to);
  assert.deepEqual(routeOf(st, p, t), { hops: [a, 0, b], peer: -1 });
});

test('路线几跳首尾接成一条路径，第二跳起不再另起一笔', () => {
  const A = [{ cx: 0, cy: 100, rx: 30, ry: 30 }, { cx: 200, cy: 0, rx: 25, ry: 25 }, { cx: 200, cy: 200, rx: 25, ry: 25 }];
  const r = routePath(A, [1, 0, 2], -1, 1, false);
  assert.equal((r.d.match(/M/g) || []).length, 1);
  assert.deepEqual(r.g.slice(0, 2), [200 - 30, 0]);
  // 上下摞着的两个直接连：从外侧绕过去，不穿过中间
  const pp = peerPath(A[1], A[2], 1, false, A[0]);
  assert.match(pp.d, /^M230,0 H/);
});
