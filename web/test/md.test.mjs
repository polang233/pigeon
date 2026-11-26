// Markdown 转网页标记：常用格式都认，而且不会把正文里的标签、脚本原样放进页面
import test from 'node:test';
import assert from 'node:assert/strict';
import { mdToHtml, looksMd } from '../src/core/md.js';

const md = s => String(mdToHtml(s));

test('标题、列表、代码块、表格、引用、分隔线', () => {
  const h = md('# 结论\n\n- 第一条 **重要**\n- 第二条 `a_b`\n  - 下一层\n\n1. 一\n2. 二\n\n```js\nconst x = 1 < 2;\n```\n\n| 文件 | 时长 |\n|---|---|\n| hit.wav | 0.4s |\n\n> 引用\n\n---');
  assert.match(h, /<h3>结论<\/h3>/);
  assert.match(h, /<ul><li>第一条 <strong>重要<\/strong><\/li><li>第二条 <code>a_b<\/code><ul><li>下一层<\/li><\/ul><\/li><\/ul>/);
  assert.match(h, /<ol><li>一<\/li><li>二<\/li><\/ol>/);
  assert.match(h, /<pre><code data-lang="js">const x = 1 &lt; 2;<\/code><\/pre>/);
  assert.match(h, /<th>文件<\/th><th>时长<\/th>.*<td>hit\.wav<\/td><td>0\.4s<\/td>/);
  assert.match(h, /<blockquote><p>引用<\/p><\/blockquote>/);
  assert.match(h, /<hr>/);
});

test('段落里的换行保留；勾选框；链接只留 http(s)', () => {
  assert.equal(md('第一行\n第二行'), '<p>第一行<br>第二行</p>');
  assert.match(md('- [x] 做完了\n- [ ] 没做'), /<li class="task"><input type="checkbox" disabled checked> 做完了<\/li><li class="task"><input type="checkbox" disabled> 没做<\/li>/);
  assert.match(md('看 [文档](https://example.com/a?b=1&c=2)'), /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">文档<\/a>/);
  assert.doesNotMatch(md('[点我](javascript:alert(1))'), /href/);
  assert.doesNotMatch(md('![图](https://x.test/a.png)'), /<img/);
});

test('正文里的标签、脚本一律转义', () => {
  const h = md('<script>alert(1)</script>\n\n**<img src=x onerror=alert(1)>**\n\n| <b>a</b> | b |\n|---|---|\n| c | d |');
  assert.doesNotMatch(h, /<script|<img|<b>/);
  assert.match(h, /&lt;script&gt;/);
});

test('像不像 Markdown', () => {
  assert.ok(looksMd('## 标题'));
  assert.ok(looksMd('做完了：\n- 一\n- 二'));
  assert.ok(!looksMd('收到，马上改。'));
});
