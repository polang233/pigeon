// 把 agent 发出去的正文、回信（多半是 Markdown）转成网页标记，在任务详情和频道里看全文。
// 只认常用的几样：标题、段落、列表（含一层嵌套和 [ ] 勾选）、引用、代码块、表格、分隔线，行内的代码、粗体、斜体、删除线、链接。
// 安全：先把整段文字转义，再按规则加标签；链接只留 http(s) 和 mailto，图片只当链接显示（不从外面加载东西）。
// 纯函数，不碰 DOM，node 里也能测（test/md.test.mjs）。返回 raw() 包好的标记。
import { esc, raw } from '../html.js';

const safeUrl = u => (/^(https?:|mailto:)/i.test(u) ? u : '');

// 行内：先把代码段抠出来占位，免得里面的 * _ 被当成格式
function inline(text) {
  const codes = [];
  let s = esc(text).replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  // 图片 ![alt](url) 不加载，显示成链接
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, alt, u) => { const h = safeUrl(u.replace(/&amp;/g, '&')); return h ? `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer">🖼 ${alt || '图片'}</a>` : m; });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, t, u) => { const h = safeUrl(u.replace(/&amp;/g, '&')); return h ? `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer">${t}</a>` : t; });
  s = s.replace(/(^|[\s(（])(https?:\/\/[^\s<)）]+)/g, (m, pre, u) => `${pre}<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^\w_])_([^_\s][^_\n]*?)_(?![\w_])/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}

const isTableSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
const LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;

export function mdToHtml(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const l = lines[i];
    // 代码块
    const fence = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(l);
    if (fence) {
      flush();
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code${fence[2] ? ` data-lang="${esc(fence[2])}"` : ''}>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (!l.trim()) { flush(); i++; continue; }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (h) { flush(); const n = Math.min(6, h[1].length + 2); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); out.push('<hr>'); i++; continue; }
    // 表格：一行表头，下一行是 |---|---|
    if (l.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flush();
      const head = cells(l), rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(`<div class="mdtable"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, k) => `<td>${inline(r[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*>/.test(l)) {
      flush();
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${mdToHtml(q.join('\n'))}</blockquote>`);
      continue;
    }
    if (LIST.test(l)) {
      flush();
      // 收齐这一串列表（含缩进的下一层和接着上一项写的续行），递归画
      const base = LIST.exec(l)[1].length, ordered = /\d/.test(LIST.exec(l)[2]);
      const items = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]);
        if (m && m[1].length <= base + 1) { items.push([m[3]]); i++; continue; }
        if (!lines[i].trim() || !items.length) break;
        if (m || /^\s{2,}/.test(lines[i])) { items.at(-1).push(lines[i].replace(new RegExp(`^\\s{0,${base + 4}}`), '')); i++; continue; }
        break;
      }
      const li = ([first, ...rest]) => {
        const box = /^\[([ xX])\]\s+(.*)$/.exec(first);
        const head = box ? `<input type="checkbox" disabled${box[1] !== ' ' ? ' checked' : ''}> ${inline(box[2])}` : inline(first);
        const sub = rest.length ? (LIST.test(rest[0]) ? mdToHtml(rest.join('\n')).s : `<br>${rest.map(inline).join('<br>')}`) : '';
        return `<li${box ? ' class="task"' : ''}>${head}${sub}</li>`;
      };
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(li).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    para.push(l);
    i++;
  }
  flush();
  return raw(out.join(''));
}

// 看起来像 Markdown 吗：有标题、列表、代码块、表格、粗体或链接。不像的照纯文字显示（保留换行）
export const looksMd = s => /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|```|>\s|\|.*\|)|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|`[^`]+`/.test(String(s || ''));
