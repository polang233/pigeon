// 时间的说法。纯函数，now 可以传进来，方便测试。

// 多久后重置：不到一天写“时:分 后重置”，再久写“几天后重置”
export const untilZh = (t, now = Date.now()) => {
  const m = Math.round((t - now) / 60000);
  return m <= 0 ? '马上重置' : m < 1440 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} 后重置` : `${Math.round(m / 1440)} 天后重置`;
};
// 几点几分（本地时间）
export const hm = t => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
// 一条额度什么时候重置：读来的有具体时间，示例数据直接写好了一句
export const rst = (q, now) => q.resetAt ? untilZh(q.resetAt, now) : q.reset;
