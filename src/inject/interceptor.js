/**
 * Speed Booster — network layer (runs in the page's MAIN world at document_start).
 *
 * ChatGPT loads conversations in one of two ways, and this wraps window.fetch
 * (before ChatGPT's own code runs) to keep both fast:
 *
 *  - Classic loader: GET /backend-api/conversation/<id> returns the whole
 *    conversation tree. It is trimmed to the most recent turns before React
 *    ever sees it, so huge chats open instantly.
 *  - Paged loader (2026+): GET /backend-api/conversations/<id> returns the
 *    newest page and /messages?before=… fetches older pages as you scroll.
 *    Once the visible-message budget is reached, requests for older pages are
 *    paused until you ask for more — no page reload needed to resume.
 *
 * Trimming is display-only: the full chat stays on OpenAI's servers and the
 * model still sees all of it. Anything unexpected hands back the original
 * response untouched. Also loadable from Node (module.exports) for tests.
 */
(function (factory) {
  'use strict';
  const core = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = core;
  else if (typeof window !== 'undefined') core.install(window);
})(function () {
  'use strict';

  const TAG = '__speedBooster';
  const SETTINGS_KEY = 'speedBooster:settings';
  const KEEP_OVERRIDE_PREFIX = 'speedBooster:keep:';
  const DEFAULT_KEEP = 30;
  const SNIPPET_LENGTH = 160;

  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const UUID_ONLY = new RegExp('^' + UUID + '$', 'i');
  // Whole conversation tree (classic loader, deep links, exporters). Tolerates extra prefixes like /f/.
  const TREE_PATH = new RegExp('^/backend-api/(?:[\\w-]+/)*conversation/(' + UUID + ')/?$', 'i');
  // Paged loader: newest page, plus /messages for older pages.
  const PAGE_PATH = new RegExp('^/backend-api/(?:[\\w-]+/)*conversations/(' + UUID + ')(/messages)?/?$', 'i');
  // Headers that identify the user/workspace rather than one specific route.
  const AUTH_HEADER = /^(authorization|chatgpt-account-id|chatgpt-project-id|oai-[\w-]+)$/i;

  function isConversation(data) {
    return (
      !!data &&
      typeof data === 'object' &&
      !!data.mapping &&
      typeof data.mapping === 'object' &&
      typeof data.current_node === 'string' &&
      !!data.mapping[data.current_node]
    );
  }

  /** Which on-screen turn a message belongs to: 'user', 'assistant', or null when hidden. */
  function turnRole(message) {
    if (!message || !message.author) return null;
    const meta = message.metadata || {};
    if (meta.is_visually_hidden_from_conversation) return null;
    const role = message.author.role;
    if (role === 'user') {
      const type = message.content && message.content.content_type;
      return type === 'user_editable_context' ? null : 'user';
    }
    // Tool calls/outputs render inside the assistant's turn (images, code, browsing).
    if (role === 'assistant' || role === 'tool') return 'assistant';
    return null;
  }

  function messageText(message) {
    const content = message && message.content;
    if (!content) return '';
    if (Array.isArray(content.parts)) {
      let out = '';
      for (const part of content.parts) {
        if (typeof part === 'string') out += (out ? '\n' : '') + part;
        else if (part && typeof part.text === 'string') out += (out ? '\n' : '') + part.text;
      }
      return out;
    }
    if (typeof content.text === 'string') return content.text;
    if (typeof content.result === 'string') return content.result;
    if (Array.isArray(content.thoughts)) {
      return content.thoughts.map((t) => (t && (t.content || t.summary)) || '').join('\n');
    }
    return '';
  }

  /** Rough token count: ~4 chars/token for ASCII text, denser for other scripts. */
  function estimateTokens(text) {
    if (!text) return 0;
    let ascii = 0;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 128) ascii++;
    return Math.ceil(ascii / 4 + (text.length - ascii) / 1.5);
  }

  function snippet(text) {
    const flat = String(text || '').replace(/\s+/g, ' ').trim();
    return flat.length > SNIPPET_LENGTH ? flat.slice(0, SNIPPET_LENGTH - 1) + '…' : flat;
  }

  /** Node ids from the root down to `current_node` — the branch ChatGPT renders. */
  function activePath(data) {
    const path = [];
    const seen = new Set();
    let id = data.current_node;
    while (id && data.mapping[id] && !seen.has(id)) {
      seen.add(id);
      path.push(id);
      id = data.mapping[id].parent;
    }
    return path.reverse();
  }

  /** Where each visible turn starts in a list of messages. Consecutive assistant/tool messages form one turn. */
  function turnStarts(messages) {
    const turns = [];
    for (let i = 0; i < messages.length; i++) {
      const role = turnRole(messages[i]);
      if (!role) continue;
      if (role === 'user' || !turns.length || turns[turns.length - 1].role !== 'assistant') {
        turns.push({ index: i, role });
      }
    }
    return turns;
  }

  function turnsOf(data, path) {
    return turnStarts(path.map((id) => data.mapping[id].message));
  }

  /**
   * Keep only the last `keep` turns of the rendered branch.
   *  - Never splits a turn: if the cut lands on an answer, its prompt is kept too.
   *  - Nodes before the first turn (root, system, hidden context) stay as the root chain.
   *  - Everything below the cut survives (hidden nodes inside kept turns, branches),
   *    so the < 2/3 > version switcher and tool confirmations keep working.
   */
  function trimConversation(data, keep) {
    const path = activePath(data);
    const turns = turnsOf(data, path);
    const total = turns.length;
    const result = { data, path, turns, total, kept: total, hidden: 0, trimmed: false };
    if (!(keep > 0) || total <= keep) return result;

    let first = total - Math.floor(keep);
    if (turns[first].role !== 'user' && first > 0) first--;
    if (first <= 0) return result;

    const source = data.mapping;
    const cutId = path[turns[first].index];
    const prefix = path.slice(0, turns[0].index);
    const mapping = {};

    for (let i = 0; i < prefix.length; i++) {
      const next = i + 1 < prefix.length ? prefix[i + 1] : cutId;
      const node = Object.assign({}, source[prefix[i]], { children: [next] });
      if (i > 0) node.parent = prefix[i - 1];
      mapping[prefix[i]] = node;
    }

    const stack = [cutId];
    while (stack.length) {
      const id = stack.pop();
      if (mapping[id] || !source[id]) continue;
      const node = source[id];
      mapping[id] =
        id === cutId
          ? Object.assign({}, node, { parent: prefix.length ? prefix[prefix.length - 1] : null })
          : node;
      const children = node.children || [];
      for (let c = 0; c < children.length; c++) stack.push(children[c]);
    }

    // Inconsistent parent/children links: leave the conversation untouched.
    for (let i = turns[first].index; i < path.length; i++) {
      if (!mapping[path[i]]) return result;
    }

    result.data = Object.assign({}, data, { mapping });
    result.kept = total - first;
    result.hidden = first;
    result.trimmed = true;
    return result;
  }

  /**
   * Counts, prompt list (for the outline) and timestamps for an ordered list of
   * messages. `hiddenTurns` = how many leading turns are not rendered.
   */
  function summarize(messages, hiddenTurns) {
    const turns = turnStarts(messages);
    const prompts = [];
    const times = {};
    let tokens = 0;
    for (let t = 0; t < turns.length; t++) {
      if (turns[t].role !== 'user') continue;
      const message = messages[turns[t].index];
      prompts.push({
        id: message.id || null,
        text: snippet(messageText(message)),
        time: message.create_time || null,
        turn: t,
        hidden: t < hiddenTurns,
      });
    }
    const firstRendered = hiddenTurns > 0 && turns[hiddenTurns] ? turns[hiddenTurns].index : 0;
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (!message) continue;
      tokens += estimateTokens(messageText(message));
      if (i >= firstRendered && message.id && message.create_time) times[message.id] = message.create_time;
    }
    return { turns: turns.length, prompts, times, tokens };
  }

  /** Report for the classic loader, sent to the extension UI. */
  function buildReport(conversationId, data, result) {
    const summary = summarize(
      result.path.map((id) => data.mapping[id].message || { id }),
      result.hidden
    );
    return {
      conversationId,
      mode: 'tree',
      title: typeof data.title === 'string' ? data.title : '',
      total: result.total,
      kept: result.kept,
      hidden: result.hidden,
      trimmed: result.trimmed,
      paused: false,
      hasMore: false,
      tokens: summary.tokens,
      prompts: summary.prompts,
      times: summary.times,
      at: Date.now(),
    };
  }

  /** Report for the paged loader: only what has been loaded so far is known. */
  function buildPagedReport(conversationId, messages, hasMore, paused) {
    const summary = summarize(messages, 0);
    return {
      conversationId,
      mode: 'paged',
      title: '',
      total: hasMore ? null : summary.turns,
      kept: summary.turns,
      hidden: hasMore ? null : 0,
      trimmed: paused,
      paused,
      hasMore,
      tokens: summary.tokens,
      prompts: summary.prompts,
      times: summary.times,
      at: Date.now(),
    };
  }

  /** Paged responses carry messages (or nodes wrapping them), oldest first. */
  function pageMessages(data) {
    if (!data || !Array.isArray(data.messages)) return null;
    const out = [];
    for (const item of data.messages) {
      const message = item && item.message && item.message.author ? item.message : item;
      if (message && typeof message === 'object' && message.author) out.push(message);
    }
    return out;
  }

  function fingerprint(text) {
    return text.length + ':' + text.slice(0, 300) + '|' + text.slice(-300);
  }

  function install(win) {
    const FLAG = Symbol.for('speedBooster.fetchHook');
    if (win[FLAG] || typeof win.fetch !== 'function') return;
    win[FLAG] = true;

    const nativeFetch = win.fetch;
    const conversations = new Map();
    let lastReport = null;
    let navigation = 0;
    let lastPath = win.location.pathname;
    let conversationHeaders = null; // exact headers ChatGPT sent when loading a conversation tree
    let conversationHeadersId = null;
    let treePathTemplate = '/backend-api/conversation/{id}';
    let authHeaders = null; // user/workspace headers seen on any backend-api GET

    function stateFor(id) {
      let state = conversations.get(id);
      if (!state) {
        state = { id, tree: null, pages: new Map(), held: [], loaded: 0, hasMore: false, navigation, messages: [] };
        conversations.set(id, state);
      }
      return state;
    }

    // Settings arrive from the content script shortly after start; until then the
    // copy it left in localStorage on the previous load is used.
    let liveSettings = null;
    let settingsReady = null;
    const whenSettings = new Promise((resolve) => {
      settingsReady = resolve;
      setTimeout(resolve, 300);
    });

    function readSettings() {
      if (liveSettings) return liveSettings;
      try {
        const parsed = JSON.parse(win.localStorage.getItem(SETTINGS_KEY) || 'null');
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch (e) {
        return {};
      }
    }

    function keepFor(conversationId, settings) {
      if (settings.trimEnabled === false) return Infinity;
      try {
        const override = win.sessionStorage.getItem(KEEP_OVERRIDE_PREFIX + conversationId);
        if (override === 'all') return Infinity;
        const n = parseInt(override, 10);
        if (n > 0) return n;
      } catch (e) {
        /* storage blocked */
      }
      const n = Number(settings.keepMessages);
      return n > 0 ? n : DEFAULT_KEEP;
    }

    /** Deep links and temporary chats always get the untouched conversation. */
    function bypass(requestUrl) {
      const page = new win.URLSearchParams(win.location.search);
      if (page.has('message') || page.has('messageId') || page.get('temporary-chat') === 'true') return true;
      return !!requestUrl && requestUrl.searchParams.get('include_full_conversation') === 'true';
    }

    function post(type, payload) {
      try {
        win.postMessage({ [TAG]: 'page', type, payload }, win.location.origin);
      } catch (e) {
        /* ignore */
      }
    }

    function publish(report) {
      lastReport = report;
      post('conversation', report);
    }

    function trackNavigation() {
      if (win.location.pathname !== lastPath) {
        lastPath = win.location.pathname;
        navigation++;
      }
    }
    for (const method of ['pushState', 'replaceState']) {
      const original = win.history && win.history[method];
      if (typeof original !== 'function') continue;
      win.history[method] = function () {
        const out = original.apply(this, arguments);
        trackNavigation();
        return out;
      };
    }
    win.addEventListener('popstate', trackNavigation);

    function headersToObject(headers, filter) {
      const out = {};
      let found = false;
      headers.forEach((value, name) => {
        if (filter(name)) {
          out[name] = value;
          found = true;
        }
      });
      return found ? out : null;
    }

    /** Returns null for requests we don't care about; captures auth headers on the way. */
    function inspect(input, init) {
      let url;
      let method;
      let headers;
      if (typeof input === 'string') url = input;
      else if (input instanceof win.URL) url = input.href;
      else if (input && typeof input.url === 'string') {
        url = input.url;
        method = input.method;
        headers = input.headers;
      } else return null;
      if (init && init.method) method = init.method;
      if (String(method || 'GET').toUpperCase() !== 'GET') return null;

      const parsed = new win.URL(url, win.location.href);
      if (parsed.origin !== win.location.origin || !parsed.pathname.startsWith('/backend-api/')) return null;

      const all = new win.Headers((init && init.headers) || headers || undefined);
      const tree = TREE_PATH.exec(parsed.pathname);
      const page = tree ? null : PAGE_PATH.exec(parsed.pathname);
      if (all.has('authorization')) {
        authHeaders = headersToObject(all, (name) => AUTH_HEADER.test(name)) || authHeaders;
        if (tree) {
          conversationHeaders = headersToObject(all, (name) => !/^content-(type|length)$/i.test(name));
          conversationHeadersId = tree[1].toLowerCase();
        }
      }
      if (tree) {
        treePathTemplate = parsed.pathname.replace(tree[1], '{id}');
        return { kind: 'tree', conversationId: tree[1].toLowerCase(), url: parsed };
      }
      if (page) return { kind: page[2] ? 'older' : 'page', conversationId: page[1].toLowerCase(), url: parsed };
      return null;
    }

    function rebuildResponse(original, body) {
      const headers = new win.Headers(original.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      const response = new win.Response(body, {
        status: original.status,
        statusText: original.statusText,
        headers,
      });
      try {
        Object.defineProperties(response, {
          url: { value: original.url },
          redirected: { value: original.redirected },
          type: { value: original.type },
        });
      } catch (e) {
        /* cosmetic only */
      }
      return response;
    }

    function usable(response) {
      if (!response || response.status !== 200) return false;
      const type = response.headers.get('content-type') || '';
      return !type || /json/i.test(type);
    }

    async function handleTree(response, info) {
      try {
        if (!usable(response)) return response;
        await whenSettings;
        const settings = readSettings();
        if (settings.enabled === false) return response;
        const keep = bypass(info.url) ? Infinity : keepFor(info.conversationId, settings);
        const text = await response.clone().text();
        const state = stateFor(info.conversationId);
        const print = fingerprint(text);
        // ChatGPT re-requests open chats every few seconds; skip re-parsing identical payloads.
        if (!state.tree || state.tree.fingerprint !== print || state.tree.keep !== keep) {
          const data = JSON.parse(text);
          if (!isConversation(data)) return response;
          const result = trimConversation(data, keep);
          state.tree = {
            fingerprint: print,
            keep,
            body: result.trimmed ? JSON.stringify(result.data) : null,
            report: buildReport(info.conversationId, data, result),
          };
          publish(state.tree.report);
        }
        return state.tree.body ? rebuildResponse(response, state.tree.body) : response;
      } catch (e) {
        return response;
      }
    }

    function pagedReport(state) {
      return buildPagedReport(state.id, state.messages, state.hasMore, state.held.length > 0);
    }

    async function handlePage(response, info) {
      try {
        if (!usable(response)) return response;
        await whenSettings;
        if (readSettings().enabled === false) return response;
        const data = JSON.parse(await response.clone().text());
        const messages = pageMessages(data);
        if (!messages) return response;
        const state = stateFor(info.conversationId);
        const older = info.kind === 'older';
        if (!older && state.navigation !== navigation) {
          // Fresh open of this chat (not a background refresh): start counting again.
          state.pages.clear();
          state.navigation = navigation;
        }
        const key = older ? 'before:' + (info.url.searchParams.get('before') || '') : 'newest';
        state.pages.set(key, messages);
        const pageHasMore = !!(data.page_info && data.page_info.has_previous_page);
        if (older || state.pages.size === 1) state.hasMore = pageHasMore;

        const seen = new Set();
        const all = [];
        for (const list of state.pages.values()) {
          for (const m of list) {
            const id = m.id || JSON.stringify(m).slice(0, 80);
            if (seen.has(id)) continue;
            seen.add(id);
            all.push(m);
          }
        }
        all.sort((a, b) => (a.create_time || 0) - (b.create_time || 0));
        state.messages = all;
        state.loaded = turnStarts(all).length;
        publish(pagedReport(state));
      } catch (e) {
        /* report is best-effort; the response is never modified */
      }
      return response;
    }

    function route(response, info) {
      return info.kind === 'tree' ? handleTree(response, info) : handlePage(response, info);
    }

    function abortError(signal) {
      if (signal && signal.reason) return signal.reason;
      try {
        return new win.DOMException('The operation was aborted.', 'AbortError');
      } catch (e) {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        return error;
      }
    }

    /** Park a request for an older page until the user asks for more history. */
    function hold(state, input, init, info) {
      return new Promise((resolve, reject) => {
        const signal = (init && init.signal) || (input && typeof input === 'object' && input.signal) || null;
        if (signal && signal.aborted) {
          reject(abortError(signal));
          return;
        }
        const entry = {
          run() {
            nativeFetch
              .call(win, input, init)
              .then((response) => route(response, info))
              .then(resolve, reject);
          },
        };
        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              const index = state.held.indexOf(entry);
              if (index === -1) return;
              state.held.splice(index, 1);
              publish(pagedReport(state));
              reject(abortError(signal));
            },
            { once: true }
          );
        }
        state.held.push(entry);
        publish(pagedReport(state));
      });
    }

    /** Resume paused history: `amount` more messages, or 'all'. */
    function release(conversationId, amount) {
      const state = stateFor(conversationId);
      const value = amount === 'all' ? 'all' : String(state.loaded + Math.max(1, Math.floor(Number(amount)) || 1));
      try {
        win.sessionStorage.setItem(KEEP_OVERRIDE_PREFIX + conversationId, value);
      } catch (e) {
        /* ignore */
      }
      const held = state.held.splice(0);
      for (const entry of held) entry.run();
      publish(pagedReport(state));
      return held.length;
    }

    const hooked = {
      fetch(input, init) {
        let info = null;
        try {
          trackNavigation();
          info = inspect(input, init);
          if (info && info.kind === 'older') {
            const settings = readSettings();
            const state = stateFor(info.conversationId);
            if (
              settings.enabled !== false &&
              !bypass(info.url) &&
              state.loaded >= keepFor(info.conversationId, settings)
            ) {
              return hold(state, input, init, info);
            }
          }
        } catch (e) {
          info = null;
        }
        const pending = nativeFetch.apply(win, arguments);
        if (!info) return pending;
        return pending.then((response) => route(response, info));
      },
    }.fetch;
    win.fetch = hooked;

    async function sessionHeaders() {
      const response = await nativeFetch.call(win, '/api/auth/session', { credentials: 'include' });
      if (!response.ok) return null;
      const session = await response.json();
      if (!session || !session.accessToken) return null;
      const headers = { authorization: 'Bearer ' + session.accessToken };
      for (const name of ['chatgpt-account-id', 'chatgpt-project-id']) {
        if (authHeaders && authHeaders[name]) headers[name] = authHeaders[name];
      }
      return headers;
    }

    /** Full, untrimmed conversation for export and search — using ChatGPT's own auth headers. */
    async function fetchFullConversation(conversationId) {
      const id = String(conversationId || '').toLowerCase();
      if (!UUID_ONLY.test(id)) throw new Error('Invalid conversation id');
      const url = treePathTemplate.replace('{id}', id);
      const strategies = [];
      if (conversationHeaders) {
        strategies.push(() => {
          const swapped = {};
          for (const name of Object.keys(conversationHeaders)) {
            swapped[name] = conversationHeadersId
              ? conversationHeaders[name].split(conversationHeadersId).join(id)
              : conversationHeaders[name];
          }
          return swapped;
        });
      }
      if (authHeaders) strategies.push(() => authHeaders);
      strategies.push(sessionHeaders);

      let lastError = null;
      for (const strategy of strategies) {
        try {
          const headers = await strategy();
          if (!headers) continue;
          const response = await nativeFetch.call(win, url, { headers, credentials: 'include' });
          if (!response.ok) {
            lastError = new Error('HTTP ' + response.status);
            continue;
          }
          const text = await response.text();
          if (isConversation(JSON.parse(text))) return text;
          lastError = new Error('Unexpected response');
        } catch (e) {
          lastError = e;
        }
      }
      throw lastError || new Error('Conversation unavailable');
    }

    win.addEventListener('message', (event) => {
      const msg = event.data;
      // Same window (Firefox reports content-script messages differently) or same origin.
      const trusted = event.source === win || event.origin === win.location.origin;
      if (!trusted || !msg || typeof msg !== 'object' || msg[TAG] !== 'content') return;
      const payload = msg.payload || {};
      if (msg.type === 'settings') {
        liveSettings = payload;
        settingsReady();
      } else if (msg.type === 'hello') {
        post('hello', { report: lastReport });
      } else if (msg.type === 'fetchConversation') {
        fetchFullConversation(payload.conversationId).then(
          (text) => post('response', { requestId: payload.requestId, ok: true, text }),
          (error) => post('response', { requestId: payload.requestId, ok: false, error: String(error && error.message) })
        );
      } else if (msg.type === 'releaseOlder' && UUID_ONLY.test(String(payload.conversationId || ''))) {
        const released = release(String(payload.conversationId).toLowerCase(), payload.amount);
        post('response', { requestId: payload.requestId, ok: true, text: String(released) });
      }
    });
    // Content scripts may start before or after this one; announce so they can say hello.
    post('ready', {});
  }

  return {
    install,
    trimConversation,
    buildReport,
    buildPagedReport,
    summarize,
    pageMessages,
    activePath,
    turnsOf,
    turnStarts,
    turnRole,
    messageText,
    estimateTokens,
    isConversation,
    TREE_PATH,
    PAGE_PATH,
    SETTINGS_KEY,
    KEEP_OVERRIDE_PREFIX,
  };
});
