'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { render, inline } = require('../../src/shared/markdown.js');

test('headings, paragraphs and line breaks', () => {
  assert.equal(render('# Title\n\nHello\nworld'), '<h1>Title</h1>\n<p>Hello<br>world</p>');
  assert.equal(render('### Deep ###'), '<h3>Deep</h3>');
});

test('inline formatting', () => {
  assert.equal(inline('**bold** and *it* and _it2_ and ~~gone~~'), '<strong>bold</strong> and <em>it</em> and <em>it2</em> and <del>gone</del>');
  assert.equal(inline('use `a < b` here'), 'use <code>a &lt; b</code> here');
  assert.equal(inline('snake_case_name stays'), 'snake_case_name stays');
  assert.equal(inline('2 * 3 * 4'), '2 * 3 * 4');
  assert.equal(inline('``code with ` tick``'), '<code>code with ` tick</code>');
});

test('links: only http(s) and mailto become anchors', () => {
  assert.equal(inline('[docs](https://example.com/a?b=1&c=2)'), '<a href="https://example.com/a?b=1&amp;c=2">docs</a>');
  assert.equal(inline('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
  assert.equal(inline('<https://example.com>'), '<a href="https://example.com">https://example.com</a>');
  assert.equal(inline('![chart](https://img/x.png)'), '<span class="img">[image: chart]</span>');
});

test('raw HTML is always escaped', () => {
  const out = render('<img src=x onerror=alert(1)>\n\n<script>bad()</script>');
  assert.ok(!out.includes('<img'));
  assert.ok(!out.includes('<script'));
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!render('[a](https://x.com/"onmouseover="alert(1))').includes('" onmouseover'));
});

test('fenced code keeps content verbatim and escaped', () => {
  const out = render('```html\n<div class="x">**not bold**</div>\n  indented\n```');
  assert.equal(out, '<pre><code class="language-html">&lt;div class=&quot;x&quot;&gt;**not bold**&lt;/div&gt;\n  indented</code></pre>');
  assert.equal(render('~~~\nplain\n~~~'), '<pre><code>plain</code></pre>');
  // Unclosed fences run to the end instead of swallowing nothing.
  assert.equal(render('```\nopen'), '<pre><code>open</code></pre>');
});

test('lists: bullets, ordered with start, nesting and task items', () => {
  assert.equal(render('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(render('3. c\n4. d'), '<ol start="3"><li>c</li><li>d</li></ol>');
  const nested = render('- parent\n  - child\n- next');
  assert.equal(nested, '<ul><li>parent\n<ul><li>child</li></ul></li><li>next</li></ul>');
  assert.equal(render('- [ ] todo\n- [x] done'), '<ul><li>☐ todo</li><li>☑ done</li></ul>');
  assert.equal(render('1. one\n\n2. two'), '<ol><li>one</li><li>two</li></ol>');
});

test('tables with alignment', () => {
  const out = render('| Name | Score |\n|:---|---:|\n| **Ann** | 9 |\n| Bob | 7 |');
  assert.equal(
    out,
    '<table><thead><tr><th style="text-align:left">Name</th><th style="text-align:right">Score</th></tr></thead>' +
      '<tbody><tr><td style="text-align:left"><strong>Ann</strong></td><td style="text-align:right">9</td></tr>' +
      '<tr><td style="text-align:left">Bob</td><td style="text-align:right">7</td></tr></tbody></table>'
  );
});

test('blockquotes, rules and math blocks', () => {
  assert.equal(render('> quoted *text*'), '<blockquote><p>quoted <em>text</em></p></blockquote>');
  assert.equal(render('a\n\n---\n\nb'), '<p>a</p>\n<hr>\n<p>b</p>');
  assert.equal(render('$$\nE = mc^2 < x\n$$'), '<pre class="math">E = mc^2 &lt; x</pre>');
});

test('handles empty and odd input', () => {
  assert.equal(render(''), '');
  assert.equal(render(null), '');
  assert.equal(render('\u0000\u0001'), '');
});
