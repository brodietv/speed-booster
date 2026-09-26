/*
 * A small stand-in for ChatGPT's web app, faithful where Speed Booster depends
 * on it: how conversations are fetched (classic tree or paged), how turns are
 * grouped and marked up (2026 markup, optionally virtualized), and a
 * ProseMirror-like composer that syncs from DOM mutations and handles paste.
 *
 * Query params: layout=virtual|classic, api=tree|paged|hidden
 */
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const layout = params.get('layout') || 'virtual';
  const api = params.get('api') || 'tree';
  const headers = { Authorization: 'Bearer mock-token', 'OAI-Device-Id': 'mock-device', 'OAI-Language': 'en-US' };
  const scroller = document.querySelector('[data-scroll-root]');
  const thread = document.getElementById('thread');
  const composer = document.getElementById('prompt-textarea');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  const form = document.querySelector('form');
  const match = location.pathname.match(/\/c\/([0-9a-f-]{36})/);
  const conversationId = match && match[1];

  const state = { messages: [], cursor: null, loadingOlder: false, olderRequests: 0, loaded: null, generating: false };
  window.__mock = state;

  function visibleRole(m) {
    if (!m || !m.author) return null;
    if (m.metadata && m.metadata.is_visually_hidden_from_conversation) return null;
    if (m.author.role === 'user') return m.content.content_type === 'user_editable_context' ? null : 'user';
    if (m.author.role === 'assistant' || m.author.role === 'tool') return 'assistant';
    return null;
  }

  function groupTurns(messages) {
    const turns = [];
    for (const m of messages) {
      const role = visibleRole(m);
      if (!role) continue;
      const last = turns[turns.length - 1];
      if (role === 'assistant' && last && last.role === 'assistant') last.messages.push(m);
      else turns.push({ role, messages: [m] });
    }
    for (const t of turns) t.id = t.role === 'user' ? t.messages[0].id : 'turn-' + t.messages[0].id;
    return turns;
  }

  function messageEl(m) {
    if (m.author.role === 'tool' || (m.recipient && m.recipient !== 'all')) return null;
    const role = m.author.role === 'user' ? 'user' : 'assistant';
    const el = document.createElement('div');
    el.className = 'message ' + role;
    el.setAttribute('data-message-author-role', role);
    el.setAttribute('data-message-id', m.id);
    if (role === 'assistant' && m.metadata && m.metadata.model_slug) el.setAttribute('data-message-model-slug', m.metadata.model_slug);
    const body = document.createElement('div');
    body.className = role === 'assistant' ? 'markdown prose' : 'whitespace-pre-wrap';
    body.textContent = (m.content.parts || []).filter((p) => typeof p === 'string').join('\n');
    el.appendChild(body);
    return el;
  }

  function turnContent(turn, n) {
    const section = document.createElement(layout === 'classic' ? 'article' : 'section');
    section.setAttribute('data-testid', 'conversation-turn-' + n);
    section.setAttribute('data-turn', turn.role);
    section.setAttribute('data-turn-id', turn.id);
    const wrap = document.createElement('div');
    wrap.className = 'text-base [--thread-content-max-width:48rem]';
    const inner = document.createElement('div');
    inner.className = 'mx-auto max-w-(--thread-content-max-width) turn-inner';
    for (const m of turn.messages) {
      const el = messageEl(m);
      if (el) inner.appendChild(el);
    }
    wrap.appendChild(inner);
    section.appendChild(wrap);
    return section;
  }

  /* ---- Virtualization: off-screen turns are empty placeholders, like ChatGPT since mid-2026 ---- */
  function hydrate(box) {
    if (box.getAttribute('data-is-intersecting') === 'true') return;
    box.style.height = '';
    box.replaceChildren(turnContent(box.__turn, box.__n));
    box.setAttribute('data-is-intersecting', 'true');
  }
  function dehydrate(box) {
    if (box.getAttribute('data-is-intersecting') === 'false') return;
    box.style.height = (box.offsetHeight || 180) + 'px';
    box.replaceChildren();
    box.setAttribute('data-is-intersecting', 'false');
  }
  const virtualizer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) (entry.isIntersecting ? hydrate : dehydrate)(entry.target);
    },
    { root: scroller, rootMargin: '300px 0px' }
  );

  function container(turn, n) {
    const box = document.createElement('div');
    box.setAttribute('data-turn-id-container', turn.id);
    box.__turn = turn;
    box.__n = n;
    box.style.height = '180px';
    box.setAttribute('data-is-intersecting', 'false');
    virtualizer.observe(box);
    return box;
  }

  const sentinel = document.createElement('div');
  sentinel.setAttribute('data-testid', 'conversation-pagination-sentinel');
  sentinel.style.height = '1px';

  function render() {
    const turns = groupTurns(state.messages);
    const nodes = [];
    if (api === 'paged') nodes.push(sentinel);
    if (layout === 'virtual') {
      const root = document.createElement('div');
      root.setAttribute('data-turn-id-container', api === 'paged' ? 'paginated-root:' + conversationId : 'client-created-root');
      nodes.push(root);
      virtualizer.disconnect();
      turns.forEach((t, i) => nodes.push(container(t, i)));
    } else {
      turns.forEach((t, i) => nodes.push(turnContent(t, i)));
    }
    thread.replaceChildren(...nodes);
    state.renderedTurns = turns.length;
  }

  function scrollToBottom() {
    scroller.scrollTop = scroller.scrollHeight;
  }

  function linear(data) {
    const out = [];
    let id = data.current_node;
    while (id && data.mapping[id]) {
      if (data.mapping[id].message) out.unshift(data.mapping[id].message);
      id = data.mapping[id].parent;
    }
    return out;
  }

  async function loadOlder() {
    if (!state.cursor || state.loadingOlder) return;
    state.loadingOlder = true;
    state.olderRequests++;
    try {
      const res = await fetch(`/backend-api/conversations/${conversationId}/messages?before=${state.cursor}&num_turns=6`, { headers });
      const page = await res.json();
      state.cursor = page.page_info.has_previous_page ? page.page_info.start_cursor : null;
      const before = scroller.scrollHeight;
      state.messages = page.messages.concat(state.messages);
      render();
      scroller.scrollTop += scroller.scrollHeight - before;
    } finally {
      state.loadingOlder = false;
    }
  }
  new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadOlder(), { root: scroller }).observe(sentinel);

  async function load() {
    if (!conversationId) return;
    if (api === 'paged') {
      const res = await fetch(`/backend-api/conversations/${conversationId}?include_has_versions=true&num_turns=6`, { headers });
      const page = await res.json();
      state.messages = page.messages;
      state.cursor = page.page_info.has_previous_page ? page.page_info.start_cursor : null;
      state.loaded = { mode: 'paged', messages: page.messages.length };
    } else {
      const url = api === 'hidden' ? `/backend-api/v2/chat/${conversationId}` : `/backend-api/conversation/${conversationId}`;
      const data = await (await fetch(url, { headers })).json();
      state.messages = linear(data);
      state.loaded = { mode: api, nodes: Object.keys(data.mapping).length };
      document.title = data.title;
    }
    render();
    requestAnimationFrame(scrollToBottom);
    setTimeout(scrollToBottom, 50);
  }

  /* ---- Composer: syncs from DOM mutations like ProseMirror does ---- */
  const composerText = () => composer.innerText.replace(/\n$/, '').trim();
  function syncSend() {
    sendButton.disabled = !composerText() || state.generating;
  }
  new MutationObserver(syncSend).observe(composer, { childList: true, subtree: true, characterData: true });
  composer.addEventListener('input', syncSend);
  composer.addEventListener('paste', (event) => {
    const text = event.clipboardData && event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    const selection = window.getSelection();
    const range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (range && composer.contains(range.startContainer)) {
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
    } else {
      composer.append(document.createTextNode(text));
    }
    syncSend();
  });
  composer.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });

  function submit() {
    const text = composerText();
    if (!text || state.generating) return;
    composer.innerHTML = '<p><br></p>';
    const now = Date.now() / 1000;
    state.messages.push({ id: crypto.randomUUID(), author: { role: 'user' }, content: { content_type: 'text', parts: [text] }, create_time: now, metadata: {} });
    const reply = {
      id: crypto.randomUUID(),
      author: { role: 'assistant' },
      content: { content_type: 'text', parts: [''] },
      create_time: now,
      metadata: { model_slug: 'gpt-5' },
      recipient: 'all',
    };
    state.messages.push(reply);
    state.lastSent = text;
    render();
    scrollToBottom();
    stream(reply, 'Echo: ' + text);
  }

  function stream(reply, full) {
    state.generating = true;
    syncSend();
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.setAttribute('data-testid', 'stop-button');
    stop.textContent = 'Stop';
    form.appendChild(stop);
    let i = 0;
    const timer = setInterval(() => {
      i += 6;
      reply.content.parts[0] = full.slice(0, i);
      const el = document.querySelector(`[data-message-id="${reply.id}"] .markdown`);
      if (el) el.textContent = reply.content.parts[0];
      if (i >= full.length) {
        clearInterval(timer);
        stop.remove();
        state.generating = false;
        syncSend();
      }
    }, 30);
  }

  load().catch((error) => {
    state.error = String(error);
    console.error(error);
  });
})();
