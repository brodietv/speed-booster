'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../src/inject/interceptor.js');
const { makeConversation, linearMessages, page, CONVERSATION_ID } = require('../fixtures/conversation.js');

const clone = (value) => JSON.parse(JSON.stringify(value));

/** Every parent/child reference in the mapping points at a node that exists, both ways. */
function assertConsistent(data) {
  for (const [id, node] of Object.entries(data.mapping)) {
    assert.equal(node.id, id);
    if (node.parent) {
      assert.ok(data.mapping[node.parent], `parent ${node.parent} of ${id} missing`);
      assert.ok(data.mapping[node.parent].children.includes(id), `${node.parent} does not list child ${id}`);
    }
    for (const child of node.children || []) {
      assert.ok(data.mapping[child], `child ${child} of ${id} missing`);
      assert.equal(data.mapping[child].parent, id);
    }
  }
  assert.ok(data.mapping[data.current_node], 'current_node survives');
}

function visibleTurns(data) {
  return core.turnsOf(data, core.activePath(data));
}

test('counts turns: tool call + output + final answer render as one assistant turn', () => {
  const { data } = makeConversation({ exchanges: 14 });
  const turns = visibleTurns(data);
  assert.equal(turns.length, 28);
  assert.deepEqual(
    turns.slice(0, 4).map((t) => t.role),
    ['user', 'assistant', 'user', 'assistant']
  );
});

test('trims to the last N turns and keeps the tree consistent', () => {
  const { data, ids } = makeConversation({ exchanges: 60 });
  const result = core.trimConversation(clone(data), 20);
  assert.equal(result.trimmed, true);
  assert.equal(result.total, 120);
  assert.equal(result.kept, 20);
  assert.equal(result.hidden, 100);
  assertConsistent(result.data);

  const turns = visibleTurns(result.data);
  assert.equal(turns.length, 20);
  assert.equal(turns[0].role, 'user', 'kept history starts at a prompt');
  // Hidden root chain (root → system → custom instructions) is preserved.
  const path = core.activePath(result.data);
  assert.equal(path[0], 'client-created-root');
  assert.equal(result.data.mapping[path[2]].message.content.content_type, 'user_editable_context');
  // The first kept prompt is exactly the 51st prompt.
  assert.equal(path[3], ids.prompts[50]);
  // Other fields are untouched.
  assert.equal(result.data.title, data.title);
  assert.equal(result.data.current_node, data.current_node);
});

test('keeps branches below the cut (version switcher) and drops ones above it', () => {
  const { data, ids } = makeConversation({ exchanges: 60 });
  const result = core.trimConversation(clone(data), 10);
  assert.ok(result.data.mapping[ids.regenerated], 'late regenerated answer survives');
  assert.ok(!result.data.mapping[ids.branchPrompt], 'early edited branch is dropped');
});

test('never splits a turn: an odd keep count snaps back to include the prompt', () => {
  const { data } = makeConversation({ exchanges: 30 });
  const result = core.trimConversation(clone(data), 7);
  assert.equal(result.kept, 8);
  assert.equal(visibleTurns(result.data)[0].role, 'user');
});

test('leaves small or unlimited conversations untouched', () => {
  const { data } = makeConversation({ exchanges: 5 });
  assert.equal(core.trimConversation(data, 40).trimmed, false);
  assert.equal(core.trimConversation(data, 40).data, data);
  const big = makeConversation({ exchanges: 50 }).data;
  assert.equal(core.trimConversation(big, Infinity).trimmed, false);
  assert.equal(core.trimConversation(big, 0).trimmed, false);
});

test('refuses to trim a tree with inconsistent parent/children links', () => {
  const { data } = makeConversation({ exchanges: 40, branches: false });
  const broken = clone(data);
  const path = core.activePath(broken);
  const victim = broken.mapping[path[path.length - 10]];
  victim.children = []; // the child still points at it via `parent`
  const result = core.trimConversation(broken, 10);
  assert.equal(result.trimmed, false);
  assert.equal(result.data, broken);
});

test('report lists every prompt, flags hidden ones, and times only rendered messages', () => {
  const { data } = makeConversation({ exchanges: 40 });
  const result = core.trimConversation(clone(data), 10);
  const report = core.buildReport(CONVERSATION_ID, data, result);
  assert.equal(report.mode, 'tree');
  assert.equal(report.prompts.length, 40);
  assert.equal(report.prompts.filter((p) => p.hidden).length, 35);
  assert.equal(report.prompts[0].text.startsWith('Question 1:'), true);
  assert.equal(report.prompts[39].turn, 78);
  assert.ok(report.tokens > 1000);
  const timed = Object.keys(report.times);
  const keptIds = new Set(core.activePath(result.data).slice(3));
  assert.ok(timed.length > 0 && timed.every((id) => keptIds.has(id)));
});

test('paged payloads: extracts messages and summarizes turns', () => {
  const { data } = makeConversation({ exchanges: 20 });
  const newest = page(data, { numTurns: 5 });
  const messages = core.pageMessages(newest);
  assert.ok(messages.length >= 10);
  const summary = core.summarize(messages, 0);
  assert.equal(summary.prompts.length, 5);
  assert.equal(summary.turns, 10);
  // Nodes wrapping messages are accepted too.
  const wrapped = core.pageMessages({ messages: newest.messages.map((m) => ({ id: m.id, message: m })) });
  assert.equal(wrapped.length, messages.length);
  assert.equal(core.pageMessages({ nope: true }), null);
});

test('URL patterns match both loaders and nothing else', () => {
  assert.ok(core.TREE_PATH.test(`/backend-api/conversation/${CONVERSATION_ID}`));
  assert.ok(core.TREE_PATH.test(`/backend-api/f/conversation/${CONVERSATION_ID}`));
  assert.ok(!core.TREE_PATH.test(`/backend-api/conversation/${CONVERSATION_ID}/stream_status`));
  assert.ok(!core.TREE_PATH.test('/backend-api/conversation'));
  assert.ok(core.PAGE_PATH.test(`/backend-api/conversations/${CONVERSATION_ID}`));
  assert.equal(core.PAGE_PATH.exec(`/backend-api/conversations/${CONVERSATION_ID}/messages`)[2], '/messages');
  assert.ok(!core.PAGE_PATH.test(`/backend-api/conversations/${CONVERSATION_ID}/textdocs`));
});

/* ---------- The installed fetch hook, against a fake window ---------- */

function fakeWindow(handler, options) {
  const local = new Map();
  const session = new Map();
  const listeners = {};
  const posted = [];
  const calls = [];
  const storage = (map) => ({
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  });
  const search = (options && options.search) || '';
  const win = {
    location: {
      origin: 'https://chatgpt.com',
      href: `https://chatgpt.com/c/${CONVERSATION_ID}${search}`,
      pathname: `/c/${CONVERSATION_ID}`,
      search,
    },
    URL,
    URLSearchParams,
    Headers,
    Response,
    DOMException,
    localStorage: storage(local),
    sessionStorage: storage(session),
    history: { pushState() {}, replaceState() {} },
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    postMessage(data) {
      posted.push(data);
      for (const fn of listeners.message || []) fn({ data, origin: 'https://chatgpt.com' });
    },
    fetch: async (input, init) => {
      calls.push({ input, init });
      return handler(typeof input === 'string' ? input : input.url, init);
    },
  };
  const reports = () => posted.filter((m) => m.__speedBooster === 'page' && m.type === 'conversation').map((m) => m.payload);
  const send = (type, payload) => win.postMessage({ __speedBooster: 'content', type, payload });
  const deliver = (data, origin) => {
    for (const fn of listeners.message || []) fn({ data, origin });
  };
  return { win, local, session, posted, calls, reports, send, deliver };
}

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('hook: trims the classic conversation response and reports stats', async () => {
  const { data } = makeConversation({ exchanges: 50 });
  const env = fakeWindow(() => json(data));
  // Stale copy from a previous page load; the live settings message wins.
  env.local.set(core.SETTINGS_KEY, JSON.stringify({ enabled: true, trimEnabled: true, keepMessages: 90 }));
  core.install(env.win);
  env.send('settings', { enabled: true, trimEnabled: true, keepMessages: 12 });

  const res = await env.win.fetch(`/backend-api/conversation/${CONVERSATION_ID}`, { headers: { Authorization: 'Bearer t' } });
  const body = await res.json();
  assert.equal(visibleTurns(body).length, 12);
  assert.equal(res.url, ''); // synthetic response keeps the original's url (empty in this fake)
  const [report] = env.reports();
  assert.equal(report.total, 100);
  assert.equal(report.hidden, 88);
  assert.equal(report.trimmed, true);

  // Identical re-requests (ChatGPT polls) reuse the cached result without re-reporting.
  const again = await (await env.win.fetch(`/backend-api/conversation/${CONVERSATION_ID}`)).json();
  assert.equal(visibleTurns(again).length, 12);
  assert.equal(env.reports().length, 1);
});

test('hook: honours "show all" overrides, disabled settings, deep links and non-GET requests', async () => {
  const { data } = makeConversation({ exchanges: 50 });
  const url = `/backend-api/conversation/${CONVERSATION_ID}`;

  const all = fakeWindow(() => json(data));
  all.session.set(core.KEEP_OVERRIDE_PREFIX + CONVERSATION_ID, 'all');
  core.install(all.win);
  assert.equal(visibleTurns(await (await all.win.fetch(url)).json()).length, 100);

  const off = fakeWindow(() => json(data));
  off.local.set(core.SETTINGS_KEY, JSON.stringify({ enabled: false }));
  core.install(off.win);
  assert.equal(visibleTurns(await (await off.win.fetch(url)).json()).length, 100);
  assert.equal(off.reports().length, 0);

  const deep = fakeWindow(() => json(data), { search: '?message=abc' });
  core.install(deep.win);
  assert.equal(visibleTurns(await (await deep.win.fetch(url)).json()).length, 100);

  const post = fakeWindow(() => json(data));
  core.install(post.win);
  assert.equal(visibleTurns(await (await post.win.fetch(url, { method: 'POST' })).json()).length, 100);
  assert.equal(post.reports().length, 0);
});

test('hook: passes through errors and non-JSON responses untouched', async () => {
  const env = fakeWindow((url) =>
    url.includes('missing') ? new Response('nope', { status: 404 }) : new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })
  );
  core.install(env.win);
  const notFound = await env.win.fetch(`/backend-api/conversation/${CONVERSATION_ID}?missing=1`);
  assert.equal(notFound.status, 404);
  const html = await env.win.fetch(`/backend-api/conversation/${CONVERSATION_ID}`);
  assert.equal(await html.text(), '<html>');
});

test('hook: paged loader pauses older pages past the budget and resumes on request', async () => {
  const { data } = makeConversation({ exchanges: 40, branches: false, tools: false });
  const env = fakeWindow((url) => {
    const u = new URL(url, 'https://chatgpt.com');
    return json(page(data, { before: u.searchParams.get('before'), numTurns: 5 }));
  });
  env.local.set(core.SETTINGS_KEY, JSON.stringify({ keepMessages: 20 }));
  core.install(env.win);

  const base = `/backend-api/conversations/${CONVERSATION_ID}`;
  let current = await (await env.win.fetch(`${base}?include_has_versions=true&num_turns=5`)).json();
  let reports = env.reports();
  assert.equal(reports.at(-1).mode, 'paged');
  assert.equal(reports.at(-1).kept, 10);
  assert.equal(reports.at(-1).hasMore, true);
  assert.equal(reports.at(-1).total, null);

  // One older page is allowed (10 < 20)...
  current = await (await env.win.fetch(`${base}/messages?before=${current.page_info.start_cursor}&num_turns=5`)).json();
  assert.equal(env.reports().at(-1).kept, 20);

  // ...the next one is parked until the user asks for more.
  const callsBefore = env.calls.length;
  let settled = false;
  const held = env.win.fetch(`${base}/messages?before=${current.page_info.start_cursor}&num_turns=5`).then((r) => {
    settled = true;
    return r.json();
  });
  await flush();
  assert.equal(settled, false);
  assert.equal(env.calls.length, callsBefore, 'no network request while paused');
  assert.equal(env.reports().at(-1).paused, true);

  env.send('releaseOlder', { conversationId: CONVERSATION_ID, amount: 10, requestId: 'r1' });
  const older = await held;
  assert.ok(older.messages.length > 0);
  assert.equal(env.session.get(core.KEEP_OVERRIDE_PREFIX + CONVERSATION_ID), '30');
  const last = env.reports().at(-1);
  assert.equal(last.paused, false);
  assert.equal(last.kept, 30);
  const released = env.posted.find((m) => m.type === 'response' && m.payload.requestId === 'r1');
  assert.equal(released.payload.text, '1');
});

test('hook: an aborted paused request rejects with AbortError', async () => {
  const { data } = makeConversation({ exchanges: 30, branches: false, tools: false });
  const env = fakeWindow((url) => {
    const u = new URL(url, 'https://chatgpt.com');
    return json(page(data, { before: u.searchParams.get('before'), numTurns: 10 }));
  });
  env.local.set(core.SETTINGS_KEY, JSON.stringify({ keepMessages: 4 }));
  core.install(env.win);
  const base = `/backend-api/conversations/${CONVERSATION_ID}`;
  const first = await (await env.win.fetch(`${base}?num_turns=10`)).json();
  const controller = new AbortController();
  const pending = env.win.fetch(`${base}/messages?before=${first.page_info.start_cursor}`, { signal: controller.signal });
  await flush();
  assert.equal(env.reports().at(-1).paused, true);
  controller.abort();
  await assert.rejects(pending, (error) => error.name === 'AbortError');
  assert.equal(env.reports().at(-1).paused, false);
});

test('hook: full-conversation export reuses ChatGPT’s own auth headers', async () => {
  const { data } = makeConversation({ exchanges: 50 });
  const seen = [];
  const env = fakeWindow((url, init) => {
    seen.push({ url, headers: new Headers(init && init.headers) });
    return json(data);
  });
  env.local.set(core.SETTINGS_KEY, JSON.stringify({ keepMessages: 10 }));
  core.install(env.win);
  await env.win.fetch(`/backend-api/conversation/${CONVERSATION_ID}`, {
    headers: { Authorization: 'Bearer secret', 'OAI-Device-Id': 'dev-1', 'ChatGPT-Account-Id': 'acct' },
  });

  env.send('fetchConversation', { conversationId: CONVERSATION_ID, requestId: 'x1' });
  for (let i = 0; i < 20 && !env.posted.some((m) => m.type === 'response'); i++) await flush();
  const reply = env.posted.find((m) => m.type === 'response' && m.payload.requestId === 'x1');
  assert.equal(reply.payload.ok, true);
  const full = JSON.parse(reply.payload.text);
  assert.equal(visibleTurns(full).length, 100, 'export gets the untrimmed conversation');
  const last = seen.at(-1);
  assert.equal(last.headers.get('authorization'), 'Bearer secret');
  assert.equal(last.headers.get('chatgpt-account-id'), 'acct');
  assert.ok(!env.posted.some((m) => JSON.stringify(m).includes('secret')), 'token never leaves the page layer');
});

test('hook: requests from other origins are ignored', async () => {
  const env = fakeWindow(() => json({}));
  core.install(env.win);
  assert.equal(env.posted.at(-1).type, 'ready', 'announces itself to content scripts');
  const before = env.posted.length;
  env.deliver({ __speedBooster: 'content', type: 'hello' }, 'https://evil.example');
  env.deliver({ __speedBooster: 'content', type: 'fetchConversation', payload: { conversationId: CONVERSATION_ID } }, 'https://evil.example');
  env.deliver({ __speedBooster: 'content', type: 'settings', payload: { enabled: false } }, 'https://evil.example');
  await flush();
  assert.equal(env.posted.length, before);
  assert.equal(env.calls.length, 0);
  // Same-origin hello is answered.
  env.deliver({ __speedBooster: 'content', type: 'hello' }, 'https://chatgpt.com');
  assert.equal(env.posted.at(-1).type, 'hello');
});

test('linear fixture sanity', () => {
  const { data } = makeConversation({ exchanges: 3 });
  const list = linearMessages(data);
  assert.equal(list[0].author.role, 'system');
  assert.equal(list.at(-1).id, data.current_node);
});
