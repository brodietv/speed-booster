'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const prompts = require('../../src/shared/prompts.js');

test('variables: unique, in order, with defaults; built-ins excluded', () => {
  const vars = prompts.variables('Translate {{ text }} into {{language:Spanish}}. Again: {{text}} on {{date}} {{selection}}');
  assert.deepEqual(vars, [
    { name: 'text', fallback: '' },
    { name: 'language', fallback: 'Spanish' },
  ]);
  assert.deepEqual(prompts.variables('no blanks here'), []);
});

test('fill: values, defaults and built-ins', () => {
  const body = 'Say {{greeting}} in {{language:French}} about {{selection}} on {{date}}';
  assert.equal(
    prompts.fill(body, { greeting: 'hi' }, { selection: 'cats', date: '9/26/2026' }),
    'Say hi in French about cats on 9/26/2026'
  );
  assert.equal(prompts.fill(body, { greeting: 'yo', language: 'German' }, {}), 'Say yo in German about  on ');
});

test('sanitizePrompt accepts common shapes and rejects empties', () => {
  assert.equal(prompts.sanitizePrompt(null), null);
  assert.equal(prompts.sanitizePrompt({ title: 'x', body: '   ' }), null);
  const fromPromptField = prompts.sanitizePrompt({ prompt: 'First line\nsecond' });
  assert.equal(fromPromptField.title, 'First line');
  assert.equal(fromPromptField.body, 'First line\nsecond');
  assert.match(fromPromptField.id, /^p_/);
  assert.equal(prompts.sanitizePrompt({ body: 'b', uses: 'lots' }).uses, 0);
});

test('sanitizeList de-duplicates ids and drops junk', () => {
  const list = prompts.sanitizeList([{ id: 'a', body: 'one' }, { id: 'a', body: 'two' }, 5, null, { body: '' }]);
  assert.equal(list.length, 2);
  assert.notEqual(list[0].id, list[1].id);
  assert.deepEqual(prompts.sanitizeList('nope'), []);
});

test('starter prompts have stable ids and useful content', () => {
  const starters = prompts.starters();
  assert.ok(starters.length >= 12);
  assert.equal(starters[0].id, 'starter-1');
  assert.deepEqual(
    starters.map((p) => p.id),
    prompts.starters().map((p) => p.id)
  );
  assert.ok(starters.every((p) => p.title && p.body.length > 20));
});

test('rank favours frequently and recently used prompts', () => {
  const now = Date.now();
  const day = 86400000;
  const ranked = prompts.rank([
    { id: 'never', uses: 0, lastUsed: 0 },
    { id: 'old-habit', uses: 3, lastUsed: now - 60 * day },
    { id: 'one-off-now', uses: 1, lastUsed: now - 60000 },
    { id: 'favourite', uses: 12, lastUsed: now - 20 * day },
    { id: 'hot', uses: 3, lastUsed: now - 60000 },
  ]);
  assert.deepEqual(
    ranked.map((p) => p.id),
    ['hot', 'favourite', 'one-off-now', 'old-habit', 'never']
  );
});

test('load falls back to starters without extension storage', async () => {
  const list = await prompts.load();
  assert.equal(list.length, prompts.STARTERS.length);
});
