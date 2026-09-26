'use strict';

/*
 * End-to-end: the real unpacked extension in Chromium, against the mock
 * ChatGPT app (tests/e2e/mock) serving a 200-exchange (400-turn) conversation.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { launch } = require('./harness.js');

let env;
before(async () => {
  env = await launch({ exchanges: 200 });
});
after(async () => {
  if (env) await env.close();
});
beforeEach(async () => {
  await env.reset();
});

const ui = (selector) => `speed-booster-ui ${selector}`;
const turns = (page) => page.evaluate(() => window.__mock.renderedTurns);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll a page function until it returns truthy — survives reloads mid-wait. */
async function until(page, fn, arg, timeout) {
  const end = Date.now() + (timeout || 10000);
  let last;
  while (Date.now() < end) {
    try {
      last = await page.evaluate(fn, arg);
      if (last) return last;
    } catch (error) {
      /* page is navigating */
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for: ${fn}`);
}

async function scrollToTop(page) {
  await page.evaluate(() => {
    document.querySelector('[data-scroll-root]').scrollTop = 0;
  });
}

/** Scroll up until the "older messages" pill shows (the app may still be pinning to the bottom). */
async function showPill(page, text) {
  await until(page, (expected) => {
    document.querySelector('[data-scroll-root]').scrollTop = 0;
    const pill = document.querySelector('speed-booster-ui').shadowRoot.querySelector('.pill:not(.hidden)');
    return !!pill && (!expected || pill.textContent.includes(expected));
  }, text);
  return page.locator(ui('.pill'));
}

function inView(page, turnId) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-turn-id-container="${id}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top > -120 && r.top < innerHeight * 0.6;
  }, turnId);
}

test('classic loader: a 400-message chat renders only the last 30', async () => {
  const page = await env.openChat('layout=virtual&api=tree');
  assert.equal(await turns(page), 30);
  const loaded = await page.evaluate(() => window.__mock.loaded);
  assert.ok(loaded.nodes < 60, `app received a trimmed tree (${loaded.nodes} nodes)`);

  await until(page, () => {
    const badge = document.querySelector('speed-booster-ui').shadowRoot.querySelector('.dock-btn[data-id="speed"] .badge');
    return badge && badge.textContent === '370';
  });

  const pill = await showPill(page);
  assert.match(await pill.textContent(), /370 older messages hidden for speed/);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('classic loader: "Load 30 more" and "Show all" bring history back', async () => {
  const page = await env.openChat('layout=virtual&api=tree');
  await showPill(page, '370 older');
  await page.locator(ui('.pill [data-act="more"]')).click();
  await until(page, () => window.__mock && window.__mock.renderedTurns === 60);

  await showPill(page, '340 older');
  await page.locator(ui('.pill [data-act="all"]')).click();
  await until(page, () => window.__mock && window.__mock.renderedTurns === 400);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('paged loader: older pages load up to the budget, then pause; "Load more" resumes without a reload', async () => {
  const page = await env.openChat('layout=virtual&api=paged');
  assert.equal(await turns(page), 12, 'newest page = 6 exchanges');
  const olderRequests = () => env.requests.filter((r) => r.path.endsWith('/messages')).length;

  // Scroll up: ChatGPT fetches older pages until 30+ messages are loaded, then Speed Booster pauses it.
  const pill = await showPill(page, 'Older messages paused for speed');
  await sleep(300);
  assert.equal(await turns(page), 36);
  assert.equal(olderRequests(), 2, 'the third older page is paused before it hits the network');

  const navigations = [];
  page.on('framenavigated', (frame) => frame === page.mainFrame() && navigations.push(frame.url()));
  await page.locator(ui('.pill [data-act="more"]')).click();
  await until(page, () => window.__mock.renderedTurns === 48);
  assert.equal(olderRequests(), 3);
  assert.deepEqual(navigations, [], 'resumed in place');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('outline lists all 200 prompts and jumps to visible and hidden ones', async () => {
  const page = await env.openChat('layout=virtual&api=tree');
  await page.keyboard.press('Alt+j');
  const items = page.locator(ui('.outline .item'));
  await items.first().waitFor();
  assert.equal(await items.count(), 200);
  assert.equal(await page.locator(ui('.outline .item.is-hidden')).count(), 185);

  await page.locator(ui('.outline .item:not(.is-hidden)')).first().click();
  await until(page, (id) => {
    const el = document.querySelector(`[data-turn-id-container="${id}"]`);
    const r = el && el.getBoundingClientRect();
    return r && r.top > -120 && r.top < innerHeight * 0.6;
  }, env.ids.prompts[185]);

  // A hidden prompt reloads with just enough history, then lands on it.
  await page.locator(ui('.outline .item.is-hidden')).nth(99).click();
  await until(page, () => window.__mock && window.__mock.renderedTurns === 204);
  await until(page, (id) => {
    const el = document.querySelector(`[data-turn-id-container="${id}"]`);
    const r = el && el.getBoundingClientRect();
    return r && r.top > -120 && r.top < innerHeight * 0.6;
  }, env.ids.prompts[99]);
  assert.ok(await inView(page, env.ids.prompts[99]));

  await page.keyboard.press('Escape');
  await page.close();
});

test('search covers the whole chat, including answers that were never loaded', async () => {
  const page = await env.openChat('layout=virtual&api=tree');
  await page.keyboard.press('Alt+j');
  await page.locator(ui('.outline input')).fill('answer 42.');
  const hit = page.locator(ui('.outline .item.is-hidden'));
  await hit.first().waitFor();
  assert.equal(await hit.count(), 1);
  assert.match(await hit.first().textContent(), /Here is answer 42\./);
  assert.match(await hit.first().textContent(), /not loaded/);
  const full = env.requests.filter((r) => r.path.startsWith('/backend-api/conversation/'));
  assert.equal(full.length, 2, 'one page load + one full fetch for search');
  assert.ok(full.every((r) => r.auth === 'Bearer mock-token'), 'uses ChatGPT’s own auth');
  await page.locator(ui('.outline input')).fill('');
  await page.keyboard.press('Escape');
  await page.close();
});

test('command palette: wide mode, prompt insertion, {{variables}} and insert & send', async () => {
  const page = await env.openChat('layout=virtual&api=tree');
  const width = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-is-intersecting="true"] .turn-inner');
      return el ? el.getBoundingClientRect().width : 0;
    });
  const before = await width();
  assert.ok(before > 700 && before < 800);

  await page.keyboard.press('Alt+k');
  await page.keyboard.type('wide mode');
  await page.keyboard.press('Enter');
  await until(page, (w) => {
    const el = document.querySelector('[data-is-intersecting="true"] .turn-inner');
    return el && el.getBoundingClientRect().width > w + 200;
  }, before);

  // Plain prompt into an empty composer.
  await page.keyboard.press('Alt+p');
  await page.keyboard.type('summarize this');
  await page.keyboard.press('Enter');
  await until(page, () => document.querySelector('#prompt-textarea').innerText.includes('Summarize our conversation'));
  assert.equal(await page.evaluate(() => document.querySelector('[data-testid="send-button"]').disabled), false);

  // Inserting into existing text goes in at the caret.
  await page.evaluate(() => {
    document.querySelector('#prompt-textarea').innerHTML = '<p><br></p>';
  });
  await page.click('#prompt-textarea');
  await page.keyboard.type('Please: ');
  await page.keyboard.press('Alt+p');
  await page.keyboard.type('continue');
  await page.keyboard.press('Enter');
  await until(page, () =>
    document.querySelector('#prompt-textarea').innerText.replace(/\u00a0/g, ' ').startsWith('Please: Continue exactly where you left off')
  );

  // Variables form, then Ctrl+Enter inserts and sends.
  await page.evaluate(() => {
    document.querySelector('#prompt-textarea').innerHTML = '<p><br></p>';
  });
  await page.keyboard.press('Alt+p');
  await page.keyboard.type('explain it simply');
  await page.keyboard.press('Enter');
  const field = page.locator(ui('.form [data-name="topic"]'));
  await field.waitFor();
  await field.fill('black holes');
  await page.keyboard.press('Control+Enter');
  await until(page, () => window.__mock.lastSent && window.__mock.lastSent.startsWith('Explain black holes simply'));
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('exports include every message, even ones hidden for speed', async () => {
  const page = await env.openChat('layout=virtual&api=tree');

  await page.locator(ui('.dock-btn[data-id="export"]')).click();
  const [md] = await Promise.all([page.waitForEvent('download'), page.locator(ui('.menu-item[data-act="md"]')).click()]);
  assert.match(md.suggestedFilename(), /^Tuning everything for speed - \d{4}-\d{2}-\d{2}\.md$/);
  const markdown = fs.readFileSync(await md.path(), 'utf8');
  assert.ok(markdown.includes('Question 1: how do I tune postgres for speed?'));
  assert.ok(markdown.includes('Question 200:'));
  assert.ok(markdown.includes('400 messages'));

  await page.keyboard.press('Alt+k');
  await page.keyboard.type('export chat as json');
  const [json] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  const data = JSON.parse(fs.readFileSync(await json.path(), 'utf8'));
  assert.equal(data.messages.length, 400);

  await page.locator(ui('.dock-btn[data-id="export"]')).click();
  const [html] = await Promise.all([page.waitForEvent('download'), page.locator(ui('.menu-item[data-act="html"]')).click()]);
  const doc = fs.readFileSync(await html.path(), 'utf8');
  assert.ok(doc.startsWith('<!doctype html>'));
  assert.ok(!/<script/i.test(doc));

  await page.locator(ui('.dock-btn[data-id="export"]')).click();
  const [printView] = await Promise.all([env.context.waitForEvent('page'), page.locator(ui('.menu-item[data-act="pdf"]')).click()]);
  await printView.waitForSelector('article.msg');
  assert.match(printView.url(), /\/src\/print\/print\.html#/);
  assert.equal(await printView.locator('article.msg').count(), 400);
  assert.equal(await printView.title(), 'Tuning everything for speed');
  await printView.close();
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('timestamps, model badges and the live token counter', async () => {
  const page = await env.openChat('layout=virtual&api=tree');
  const label = await until(page, () => {
    const el = document.querySelector('[data-message-author-role="assistant"][data-sb-time]');
    return el && el.getAttribute('data-sb-time');
  });
  assert.match(label, /\d.* · GPT-5 Thinking$/);
  const pseudo = await page.evaluate(
    () => getComputedStyle(document.querySelector('[data-message-author-role][data-sb-time]'), '::before').content
  );
  assert.notEqual(pseudo, 'none');

  await page.click('#prompt-textarea');
  await page.keyboard.type('one two three');
  await until(page, () => {
    const counter = document.querySelector('speed-booster-ui').shadowRoot.querySelector('.counter:not(.hidden)');
    return counter && counter.textContent === '3 words · ≈4 tokens';
  });

  // Messages sent now get a timestamp too.
  await page.keyboard.press('Enter');
  await until(page, () => {
    const users = document.querySelectorAll('[data-message-author-role="user"]');
    const last = users[users.length - 1];
    return last && last.textContent.includes('one two three') && last.hasAttribute('data-sb-time');
  });
  await page.close();
});

test('DOM fallback collapses old turns when the conversation API is unrecognized', async () => {
  const page = await env.openChat('layout=classic&api=hidden');
  assert.equal(await turns(page), 400);
  await until(page, () => document.querySelectorAll('[data-sb-collapsed]').length === 370);
  const cv = await page.evaluate(
    () => getComputedStyle(document.querySelector('article[data-testid^="conversation-turn-"]:not([data-sb-collapsed])')).contentVisibility
  );
  assert.equal(cv, 'auto', 'render boost applies to classic markup');

  await showPill(page, '370 older');
  await page.locator(ui('.pill [data-act="more"]')).click();
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-sb-collapsed]').length), 340);
  await page.locator(ui('.pill [data-act="all"]')).click();
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-sb-collapsed]').length), 0);
  await page.close();
});

test('turning Speed Booster off gives stock ChatGPT', async () => {
  await env.setSettings({ enabled: false });
  const page = await env.openChat('layout=virtual&api=tree');
  await sleep(500);
  assert.equal(await turns(page), 400);
  assert.equal(await page.locator(ui('.dock')).isVisible(), false);
  assert.equal(await page.evaluate(() => (document.getElementById('speed-booster-page-style') || {}).textContent || ''), '');

  // Turning it back on applies live (UI) without a reload.
  await env.setSettings({ enabled: true });
  await page.locator(ui('.dock')).waitFor({ state: 'visible' });
  await page.close();
});

test('options page: a new prompt shows up in the in-page library', async () => {
  const options = await env.context.newPage();
  await options.goto(`chrome-extension://${env.extensionId}/src/options/options.html#prompts`);
  await options.locator('.prompt').first().waitFor();
  assert.ok((await options.locator('.prompt').count()) >= 12, 'starter prompts');
  await options.click('#prompt-new');
  await options.fill('#prompt-title', 'Haiku machine');
  await options.fill('#prompt-body', 'Write a haiku about {{thing}}');
  assert.match(await options.textContent('#prompt-vars'), /thing/);
  await options.click('#prompt-save');
  await options.locator('.prompt h3', { hasText: 'Haiku machine' }).waitFor();
  await options.close();

  const page = await env.openChat('layout=virtual&api=tree');
  await page.keyboard.press('Alt+p');
  await page.keyboard.type('haiku');
  const first = page.locator(ui('.results .row')).first();
  await first.waitFor();
  assert.match(await first.textContent(), /Haiku machine/);
  await page.keyboard.press('Escape');
  await page.close();
});

test('popup: settings switches write to storage', async () => {
  const popup = await env.context.newPage();
  await popup.goto(`chrome-extension://${env.extensionId}/src/popup/popup.html`);
  await popup.locator('#chat .empty').waitFor();
  await popup.check('input[data-setting="wideMode"]');
  const stored = await until(popup, () =>
    chrome.storage.local.get('settings').then(({ settings }) => settings && settings.wideMode === true)
  );
  assert.ok(stored);
  assert.match(await popup.textContent('output[data-for="keepMessages"]'), /30 messages/);
  await popup.close();
});

test('popup ↔ page protocol: live status and load more', async () => {
  const page = await env.openChat('layout=virtual&api=tree');
  let status = null;
  for (let i = 0; i < 50 && !(status && status.total === 400); i++) {
    status = await env.worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
      return chrome.tabs.sendMessage(tab.id, { type: 'sb:status' });
    });
    await sleep(100);
  }
  assert.equal(status.ok, true);
  assert.equal(status.mode, 'tree');
  assert.equal(status.total, 400);
  assert.equal(status.kept, 30);
  assert.equal(status.hidden, 370);
  assert.ok(status.tokens > 10000);

  await env.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    return chrome.tabs.sendMessage(tab.id, { type: 'sb:loadMore' });
  });
  await until(page, () => window.__mock && window.__mock.renderedTurns === 60);
  await page.close();
});

test('dark theme follows ChatGPT', async () => {
  const page = await env.openChat('layout=virtual&api=tree');
  await page.evaluate(() => document.documentElement.classList.replace('light', 'dark'));
  await until(page, () => document.querySelector('speed-booster-ui').shadowRoot.querySelector('.sb').dataset.theme === 'dark');
  await page.close();
});
