// 页面看不见时（窗口关了、最小化、被盖住、切到别的 Space）停掉定时器和无限循环的 CSS 动画，看得见时接着来。

/** 只在页面看得见时跑的 setInterval。回到前台时接着跑，不补跑错过的那几次 */
export function whileVisible(fn, ms) {
  let t = 0;
  const sync = () => {
    if (document.hidden) { clearInterval(t); t = 0; } else if (!t) t = setInterval(fn, ms);
  };
  document.addEventListener('visibilitychange', sync);
  sync();
}

// 看不见时给 <html> 加 page-hidden，样式表里据此暂停所有 animation
const mark = () => document.documentElement.classList.toggle('page-hidden', document.hidden);
document.addEventListener('visibilitychange', mark);
mark();
