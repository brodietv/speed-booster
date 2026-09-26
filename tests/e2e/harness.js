/*
 * E2E harness: launches Chromium with the unpacked extension and routes
 * https://chatgpt.com to the mock app (tests/e2e/mock) and fixture API data.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { makeConversation, page: pageOf, CONVERSATION_ID } = require('../fixtures/conversation.js');

const EXTENSION = path.join(__dirname, '..', '..');
const MOCK = path.join(__dirname, 'mock');

async function launch(options) {
  const exchanges = (options && options.exchanges) || 200;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speed-booster-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });

  const { data, ids } = makeConversation({ exchanges });
  const requests = [];
  await context.route('https://chatgpt.com/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const auth = request.headers().authorization;
    requests.push({ path: url.pathname, search: url.search, auth, method: request.method() });

    if (url.pathname.startsWith('/mock/')) {
      return route.fulfill({ path: path.join(MOCK, path.basename(url.pathname)) });
    }
    if (url.pathname === '/api/auth/session') return route.fulfill({ json: { accessToken: 'mock-token' } });
    if (url.pathname.startsWith('/backend-api/')) {
      if (auth !== 'Bearer mock-token') return route.fulfill({ status: 401, json: { detail: 'Unauthorized' } });
      if (/^\/backend-api\/(conversation|v2\/chat)\/[0-9a-f-]{36}$/.test(url.pathname)) return route.fulfill({ json: data });
      if (/^\/backend-api\/conversations\/[0-9a-f-]{36}(\/messages)?$/.test(url.pathname)) {
        const numTurns = Number(url.searchParams.get('num_turns')) || 6;
        return route.fulfill({ json: pageOf(data, { before: url.searchParams.get('before'), numTurns }) });
      }
      return route.fulfill({ status: 404, json: {} });
    }
    return route.fulfill({ path: path.join(MOCK, 'app.html'), contentType: 'text/html; charset=utf-8' });
  });

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;

  // Close the welcome tab the extension opens on install.
  for (const p of context.pages()) if (p.url().includes('options.html')) await p.close();

  async function setSettings(patch) {
    await worker.evaluate(async (next) => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: Object.assign({}, settings, next) });
    }, patch || {});
  }

  async function reset() {
    await worker.evaluate(() => chrome.storage.local.clear());
    requests.length = 0;
  }

  /** Open the mock chat and wait until Speed Booster's UI is mounted and turns are rendered. */
  async function openChat(query, opts) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /speed booster/i.test(msg.text())) errors.push(msg.text());
    });
    page.errors = errors;
    // Each test starts with the outline closed (its open state persists per site).
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('sb-test-init')) {
        sessionStorage.setItem('sb-test-init', '1');
        localStorage.removeItem('speedBooster:outlineOpen');
      }
    });
    const target = (opts && opts.path) || `/c/${CONVERSATION_ID}`;
    await page.goto(`https://chatgpt.com${target}?${query || ''}`);
    await page.waitForSelector('speed-booster-ui', { state: 'attached' });
    if (!opts || opts.waitForTurns !== false) {
      await page.waitForFunction(() => window.__mock && window.__mock.renderedTurns > 0);
    }
    return page;
  }

  async function close() {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  return { context, worker, extensionId, data, ids, requests, setSettings, reset, openChat, close, CONVERSATION_ID };
}

module.exports = { launch, CONVERSATION_ID };
