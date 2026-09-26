'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../../src/shared/settings.js');

test('sanitize fills defaults and drops unknown keys', () => {
  const out = settings.sanitize({ bogus: 1 });
  assert.deepEqual(out, { ...settings.DEFAULTS });
  assert.equal('bogus' in out, false);
  assert.deepEqual(settings.sanitize(null), { ...settings.DEFAULTS });
});

test('sanitize clamps numbers, rounds, and rejects wrong types', () => {
  const out = settings.sanitize({ keepMessages: 100000, loadMoreStep: -3, chatWidth: '1501.6', wideMode: 'yes', dockPosition: 'top' });
  assert.equal(out.keepMessages, settings.RANGES.keepMessages[1]);
  assert.equal(out.loadMoreStep, settings.RANGES.loadMoreStep[0]);
  assert.equal(out.chatWidth, 1502);
  assert.equal(out.wideMode, settings.DEFAULTS.wideMode);
  assert.equal(out.dockPosition, 'right');
  assert.equal(settings.sanitize({ keepMessages: 'NaN' }).keepMessages, settings.DEFAULTS.keepMessages);
});

test('only what the network layer needs is mirrored into the page', () => {
  assert.deepEqual(Object.keys(settings.pageSubset(settings.DEFAULTS)).sort(), ['enabled', 'keepMessages', 'trimEnabled']);
});

test('load works without extension storage', async () => {
  assert.deepEqual(await settings.load(), { ...settings.DEFAULTS });
});
