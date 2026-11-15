// 分派规则怎么判、写进指挥提示里的原文。纯函数，不碰 DOM（测试见 test/route.test.mjs）。
// 规则是给指挥看的建议：从上到下找第一条命中的；交给的那家额度低于 st.LOW 时，按“额度不够时”那一栏改派。
import { agOf, dvOf, isYou, askOn, nameOf, canTake } from './names.js';

// 关键词按空格、顿号、逗号分开，任意一个出现就算命中（不分大小写）。没写关键词的规则永远不命中
export const kwRe = r => {
  const w = r.kw.split(/[\s、，,]+/).filter(Boolean);
  return w.length ? new RegExp(w.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i') : null;
};
export const qLeft = (st, k) => st.SUB[k]?.left;
export const lowQ = (st, k) => qLeft(st, k) != null && qLeft(st, k) < st.LOW;
// 现在能交给的对象：每台设备上开着、能接收的 agent
export const targets = st => Object.keys(st.DEV).flatMap(d => (st.CONN[d] || []).filter(canTake).map(c => `${c.a}@${d}`));
// 交给的那家还在不在（设备移除了、关了、或者它不能接收就不在）
export const alive = (st, k) => !!k && !!st.DEV[dvOf(k)] && (st.CONN[dvOf(k)] || []).some(c => c.a === agOf(k) && canTake(c));

// 一句任务走一遍规则，记下每一条是怎么判的：off 关着、miss 没命中、gone 交给的不在了、hit 命中、fb 命中但额度不够改派
export function routeOf(st, text) {
  const steps = [];
  for (const r of st.RULES) {
    if (!r.on) { steps.push({ r, st: 'off' }); continue; }
    const re = kwRe(r);
    if (!re || !re.test(text)) { steps.push({ r, st: 'miss' }); continue; }
    if (!alive(st, r.to)) { steps.push({ r, st: 'gone' }); continue; }
    if (lowQ(st, r.to) && alive(st, r.fb)) { steps.push({ r, st: 'fb' }); return { r, to: r.fb, fb: true, steps }; }
    steps.push({ r, st: 'hit' });
    return { r, to: r.to, low: lowQ(st, r.to), steps };
  }
  return { r: null, steps };
}

// 发之前要不要问用户：规则写了问，或者交给别的电脑（不在本机）、并且协作的规矩里“跨设备发送前先问我”开着
export const asks = (st, r, k) => !!r.ask || (dvOf(k) !== st.home && askOn(st, 'cross'));

// 契约里 POST /api/dispatch/suggest 的回答：{ rule, suggested, fb, ask }，给了 to 才有 kind（rule、quota、override、lead）。
// 应用那边跑同一份用例 tests/fixtures/dispatch-cases.json
export function suggest(st, text, to) {
  const res = routeOf(st, text);
  const out = res.r ? { rule: res.r.id, suggested: res.to, fb: !!res.fb, ask: asks(st, res.r, res.to) } : { rule: '', suggested: '', fb: false, ask: false };
  if (to) out.kind = !res.r ? 'lead' : res.to === to ? (res.fb ? 'quota' : 'rule') : 'override';
  return out;
}

// 写进指挥提示里的原文。指挥每开新一轮时更新一次，额度变了、规矩改了也跟着变。
// 你自己当指挥时没有提示可写，返回 null；没有一条开着、能交出去的规则时返回空串（不往提示里写）
export function promptText(st) {
  if (isYou(st)) return null;
  const lines = st.RULES.filter(r => r.on && r.when && alive(st, r.to)).map(r => {
    let v = `- ${r.when} → ${nameOf(st, r.to)}`;
    if (lowQ(st, r.to)) v += alive(st, r.fb) ? `。它的额度现在只剩 ${qLeft(st, r.to)}%，先交给 ${nameOf(st, r.fb)}` : `。它的额度现在只剩 ${qLeft(st, r.to)}%`;
    if (asks(st, r, r.to)) v += '。发之前要用户确认';
    return v;
  });
  if (!lines.length) return '';
  const ask = [];
  if (askOn(st, 'cross')) ask.push(`- 往别的电脑派活，Pigeon 会先问用户，${st.settings?.crossTimeoutSec ?? 90} 秒没人点就不发`);
  // 拆活和转派前问用户要等统一的 MCP，接上应用的第一版里还不会这样问，就不往提示里写
  if (st.mode !== 'live') {
    if (askOn(st, 'split')) ask.push('- 一次拆成 3 件以上同时派出时，Pigeon 会先问用户');
    if (askOn(st, 'relay')) ask.push('- 接活的 agent 再往下转派时，Pigeon 会先问用户');
  }
  return `派活建议（Pigeon 写进来的，只是建议，最后由你判断）：\n${lines.join('\n')}\n- 其他的你自己做，或者自己决定交给谁${ask.length ? '\n' + ask.join('\n') : ''}\n派活时附一句理由；没照上面的建议做，也说明为什么。`;
}
