// html`` 的转义：数据里来的字符串（包括写在属性里的）一律转义，raw() 和嵌套的 html`` 原样放
import test from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, bool, esc, join } from '../src/html.js';

test('文字里的尖括号、& 转义', () => {
  assert.equal(String(html`<b>${'<img src=x onerror=alert(1)> & co'}</b>`), '<b>&lt;img src=x onerror=alert(1)&gt; &amp; co</b>');
});

test('属性里的引号转义，data-tip 也一样', () => {
  const name = '他说"你好" \'嗨\'';
  assert.equal(String(html`<i data-tip="在 ${name}">x</i>`), '<i data-tip="在 他说&quot;你好&quot; &#39;嗨&#39;">x</i>');
  assert.equal(String(html`<input value="${'"><script>'}">`), '<input value="&quot;&gt;&lt;script&gt;">');
});

test('raw() 和嵌套的 html`` 不再转义一遍', () => {
  const inner = html`<i>${'a<b'}</i>`;
  assert.equal(String(html`<p>${inner}${raw('<svg/>')}</p>`), '<p><i>a&lt;b</i><svg/></p>');
  assert.equal(String(raw(raw('<x>'))), '<x>');
});

test('数组按顺序拼起来，每项照样转义', () => {
  assert.equal(String(html`<ul>${['<1>', html`<li>2</li>`, 3]}</ul>`), '<ul>&lt;1&gt;<li>2</li>3</ul>');
  assert.equal(String(join(['a', '<b>'], raw('<br>'))), 'a<br>&lt;b&gt;');
});

test('null、undefined、false 什么都不出；0 和 true 照常出', () => {
  assert.equal(String(html`[${null}${undefined}${false}${0}${true}]`), '[0true]');
  assert.equal(bool(false), 'false');
  assert.equal(String(html`<b aria-pressed="${bool(0)}">`), '<b aria-pressed="false">');
});

test('多行的回信不会被当成标记', () => {
  const reply = '两处建议：\n1. <b>超时</b>';
  assert.equal(String(html`<div class="reply">${reply}</div>`), '<div class="reply">两处建议：\n1. &lt;b&gt;超时&lt;/b&gt;</div>');
  assert.equal(esc(5), '5');
});
