'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const format = require('../../src/shared/format.js');
const { makeConversation, CONVERSATION_ID } = require('../fixtures/conversation.js');

test('normalize flattens the active branch into clean user/assistant messages', () => {
  const { data, ids } = makeConversation({ exchanges: 14 });
  const conv = format.normalize(data, CONVERSATION_ID);
  assert.equal(conv.title, 'Tuning everything for speed');
  assert.equal(conv.id, CONVERSATION_ID);
  assert.equal(conv.messages.length, 28, 'system, custom instructions and tool traffic are skipped');
  assert.deepEqual(new Set(conv.messages.map((m) => m.role)), new Set(['user', 'assistant']));
  assert.equal(conv.messages[0].id, ids.prompts[0]);
  assert.equal(conv.messages[1].model, 'gpt-5-thinking');
  assert.ok(conv.messages.every((m) => !m.text.includes('Question 6 (edited)')), 'off-branch edits are excluded');
  assert.ok(conv.messages[6].text.includes('Attachments: notes.pdf'), 'attachment names are listed');
});

test('normalize strips citation markers', () => {
  const { data } = makeConversation({ exchanges: 2 });
  const answer = format.normalize(data).messages[1].text;
  assert.ok(!/[\ue200-\ue2ff]/.test(answer));
  assert.ok(!answer.includes('【'));
  assert.ok(answer.includes('Tip two'));
  assert.equal(format.cleanText('a \ue200cite\ue202turn0search3\ue201b 【12†source】c'), 'a b c');
});

test('Markdown export has a header, labels, model and timestamps', () => {
  const { data } = makeConversation({ exchanges: 3 });
  const conv = format.normalize(data, CONVERSATION_ID);
  const md = format.toMarkdown(conv, Date.UTC(2026, 8, 26));
  assert.ok(md.startsWith('# Tuning everything for speed\n'));
  assert.ok(md.includes('6 messages'));
  assert.ok(md.includes(`<https://chatgpt.com/c/${CONVERSATION_ID}>`));
  assert.match(md, /\*\*You\*\* · \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  assert.match(md, /\*\*ChatGPT\*\* · GPT-5 Thinking · \d{4}-/);
  assert.ok(md.includes('```sql\nSELECT * FROM speed WHERE x < 10;\n```'));
});

test('text and JSON exports', () => {
  const { data } = makeConversation({ exchanges: 2 });
  const conv = format.normalize(data, CONVERSATION_ID);
  const text = format.toText(conv);
  assert.ok(text.includes('You ('));
  assert.ok(text.includes('ChatGPT ('));
  const json = JSON.parse(format.toJSON(conv, Date.UTC(2026, 0, 1)));
  assert.equal(json.messages.length, 4);
  assert.equal(json.url, `https://chatgpt.com/c/${CONVERSATION_ID}`);
  assert.equal(json.exported, '2026-01-01T00:00:00.000Z');
  assert.match(json.messages[0].time, /^2026-01-01T/);
});

test('HTML export is a standalone document with rendered markdown and no scripts', () => {
  const { data } = makeConversation({ exchanges: 2 });
  const conv = format.normalize(data, CONVERSATION_ID);
  conv.messages[0].text = 'Hi <script>alert(1)</script> & **not bold for users**';
  const html = format.toHTML(conv, Date.UTC(2026, 8, 26));
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<title>Tuning everything for speed</title>'));
  assert.ok(!/<script/i.test(html), 'no script tags');
  assert.ok(html.includes('Hi &lt;script&gt;alert(1)&lt;/script&gt; &amp; **not bold for users**'));
  assert.ok(html.includes('<pre><code class="language-sql">SELECT * FROM speed WHERE x &lt; 10;</code></pre>'));
  assert.ok(html.includes('<strong>bold</strong>'));
  assert.ok(html.includes('GPT-5 Thinking'));
});

test('filenames are safe on every OS', () => {
  const conv = { title: 'What: is "this" <file>/name?*|\u0007. ', messages: [] };
  const name = format.filename(conv, 'md', Date.UTC(2026, 8, 26, 12));
  assert.match(name, /^What is this file name - 2026-09-2\d\.md$/);
  assert.equal(format.filename({ title: '...' }, 'txt', 0).startsWith('ChatGPT conversation - '), true);
});

test('prettyModel', () => {
  assert.equal(format.prettyModel('gpt-5-thinking-mini'), 'GPT-5 Thinking Mini');
  assert.equal(format.prettyModel('gpt-4o'), 'GPT-4o');
  assert.equal(format.prettyModel('gpt-4.1-mini'), 'GPT-4.1 Mini');
  assert.equal(format.prettyModel('o4-mini-high'), 'o4 Mini High');
  assert.equal(format.prettyModel('o3'), 'o3');
  assert.equal(format.prettyModel('text-davinci-002-render-sha'), 'text-davinci-002-render-sha');
  assert.equal(format.prettyModel(null), '');
});

test('word and token estimates', () => {
  assert.equal(format.countWords(''), 0);
  assert.equal(format.countWords("Don't stop — it's 42 fast-paced words"), 6);
  assert.equal(format.countWords('日本語 テキスト'), 2);
  assert.equal(format.estimateTokens(''), 0);
  assert.equal(format.estimateTokens('abcd'.repeat(100)), 100);
  assert.ok(format.estimateTokens('日本語'.repeat(10)) >= 20);
});
