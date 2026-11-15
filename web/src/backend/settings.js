// 写应用的设置：先 GET 完整设置，在它上面改，算出改了哪几处，只把这几处用 PATCH 交给应用去合并
// （契约：PATCH /api/settings，对象逐层合并，null 是删掉，数组整个换）。合并在应用那边做，
// 所以页面在读和写之间，菜单栏、刘海或命令行改的别的设置不会被盖掉；这里不认识的字段也不会碰。
// 几次改动排着队一个一个写，同时到的合成一次。api(path, { method, body }) 是发请求的函数（live.js 给的，测试里换成假的）。不碰 DOM。
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

// 把 a 变成 b 要改的那几处；一样就返回 undefined
export function diff(a, b) {
  if (isObj(a) && isObj(b)) {
    const p = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in b)) { p[k] = null; continue; }
      const d = diff(a[k], b[k]);
      if (d !== undefined) p[k] = d;
    }
    return Object.keys(p).length ? p : undefined;
  }
  return JSON.stringify(a) === JSON.stringify(b) ? undefined : b;
}

export function settingsWriter(api) {
  let chain = Promise.resolve();
  let batch = [];
  // fn(设置对象) 就地改；返回 Promise，写好后给出保存后的完整设置
  function update(fn) {
    return new Promise((resolve, reject) => {
      batch.push({ fn, resolve, reject });
      chain = chain.then(async () => {
        const mine = batch; batch = [];
        if (!mine.length) return;
        try {
          const got = await api('/api/settings');
          const cur = isObj(got) ? got : {}, next = structuredClone(cur);
          for (const x of mine) x.fn(next);
          const patch = diff(cur, next);
          const saved = patch ? await api('/api/settings', { method: 'PATCH', body: patch }) : cur;
          const out = isObj(saved) ? saved : next;
          mine.forEach(x => x.resolve(out));
        } catch (e) { mine.forEach(x => x.reject(e)); }
      });
    });
  }
  // 还有没写完的
  const busy = () => batch.length > 0;
  return { update, busy };
}
