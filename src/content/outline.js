/*
 * Speed Booster — outline & search panel. Lists every prompt in the chat
 * (including ones hidden for speed), tracks where you are, and searches the
 * whole conversation — answers and unloaded messages included.
 */
(() => {
  'use strict';
  const SB = globalThis.SpeedBooster;
  const OPEN_KEY = 'speedBooster:outlineOpen';
  const MSG = '[data-message-author-role]';
  const FULL_MAX_AGE = 120000;

  let panel = null;
  let list = null;
  let input = null;
  let countEl = null;
  let isOpen = false;
  let signature = '';
  let entries = [];
  let currentIndex = -1;
  let full = null; // { conversationId, conv, at } — full conversation for search / complete outline
  let fullLoading = null;

  function flat(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function snippet(text, query) {
    const value = flat(text);
    const i = query ? value.toLowerCase().indexOf(query.toLowerCase()) : -1;
    if (i < 60) return value.slice(0, 200);
    return '…' + value.slice(i - 50, i + 150);
  }

  function highlight(text, query) {
    if (!query) return SB.ui.escape(text);
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    let out = '';
    let from = 0;
    let i;
    while ((i = lower.indexOf(q, from)) !== -1) {
      out += SB.ui.escape(text.slice(from, i)) + '<mark>' + SB.ui.escape(text.slice(i, i + q.length)) + '</mark>';
      from = i + q.length;
    }
    return out + SB.ui.escape(text.slice(from));
  }

  function fullConversation() {
    const id = SB.state.conversationId;
    return full && full.conversationId === id ? full.conv : null;
  }

  /** Fetch the untrimmed chat once (cached), for search and the complete outline. */
  function loadFull() {
    const id = SB.state.conversationId;
    if (!id || fullLoading || (full && full.conversationId === id && Date.now() - full.at < FULL_MAX_AGE)) return;
    fullLoading = SB.exporter
      .fetchFull(id)
      .then((conv) => {
        if (SB.state.conversationId === id) full = { conversationId: id, conv, at: Date.now() };
      })
      .catch(() => {
        full = { conversationId: id, conv: null, at: Date.now() };
      })
      .finally(() => {
        fullLoading = null;
        render(true);
      });
    render(true);
  }

  /** Ids of messages that are loaded into ChatGPT right now (rendered or virtualized). */
  function loadedIds(report) {
    const ids = new Set(SB.chatgpt.messages().map((m) => m.getAttribute('data-message-id')));
    if (report) {
      for (const id of Object.keys(report.times)) ids.add(id);
      for (const p of report.prompts) if (!p.hidden && p.id) ids.add(p.id);
    }
    return ids;
  }

  /** Outline entries: prompts from the network report (+ full chat when known), then live DOM prompts. */
  function outlineItems() {
    const report = SB.util.currentReport();
    const conv = fullConversation();
    const items = [];
    const known = new Set();
    let hidden = 0;

    if (conv && report && report.mode === 'paged' && report.hasMore) {
      const loaded = loadedIds(report);
      conv.messages.forEach((m, i) => {
        if (m.role !== 'user') return;
        const isHidden = !loaded.has(m.id);
        hidden += isHidden ? 1 : 0;
        known.add(m.id);
        items.push({ kind: isHidden ? 'hidden' : 'prompt', id: m.id, text: flat(m.text), time: m.time, fromEnd: conv.messages.length - i });
      });
    } else if (report) {
      for (const p of report.prompts) {
        hidden += p.hidden ? 1 : 0;
        if (p.id) known.add(p.id);
        items.push({ kind: p.hidden ? 'hidden' : 'prompt', id: p.id, text: p.text, time: p.time, fromEnd: (report.total || 0) - p.turn });
      }
    }

    for (const turn of SB.chatgpt.turns()) {
      if (turn.role !== 'user') continue;
      const msg = turn.el.matches(MSG) ? turn.el : turn.el.querySelector(MSG);
      const id = (msg && msg.getAttribute('data-message-id')) || turn.id;
      if (id && known.has(id)) continue;
      items.push({ kind: 'prompt', id, el: turn.el, text: msg ? SB.chatgpt.messageText(msg, true) : flat(turn.el.textContent) });
    }
    items.forEach((item, i) => (item.n = i + 1));
    return { items, count: items.length, hidden, report };
  }

  /** Search results across the whole chat when the full conversation is available. */
  function searchItems(query) {
    const q = query.toLowerCase();
    const conv = fullConversation();
    const report = SB.util.currentReport();
    if (!conv) {
      const base = outlineItems().items.filter((item) => item.text.toLowerCase().includes(q));
      // Rendered answers can be searched right away.
      for (const turn of SB.chatgpt.turns()) {
        if (turn.role !== 'assistant') continue;
        const text = Array.from(turn.el.querySelectorAll(MSG)).map((m) => SB.chatgpt.messageText(m, true)).join(' ');
        if (text.toLowerCase().includes(q)) base.push({ kind: 'answer', el: turn.el, text });
      }
      return base;
    }
    const loaded = loadedIds(report);
    const results = [];
    let promptId = null;
    let n = 0;
    conv.messages.forEach((m, i) => {
      if (m.role === 'user') {
        promptId = m.id;
        n++;
      }
      if (!m.text.toLowerCase().includes(q)) return;
      const isLoaded = loaded.has(m.id) || !report;
      results.push({
        kind: !isLoaded ? 'hidden' : m.role === 'user' ? 'prompt' : 'answer',
        role: m.role,
        id: m.id,
        promptId,
        n: m.role === 'user' ? n : null,
        text: m.text,
        time: m.time,
        fromEnd: conv.messages.length - i,
      });
    });
    return results;
  }

  function metaFor(item) {
    const time = item.time ? SB.util.friendlyTime(item.time) : '';
    if (item.kind === 'hidden') {
      const label = item.role === 'assistant' ? 'Answer · not loaded' : 'Hidden';
      return `<span class="meta">${SB.ui.icon('history')} ${label}${time ? ' · ' + SB.ui.escape(time) : ''}</span>`;
    }
    if (item.kind === 'answer') return `<span class="meta">Answer${time ? ' · ' + SB.ui.escape(time) : ''}</span>`;
    return time ? `<span class="meta">${SB.ui.escape(time)}</span>` : '';
  }

  function render(force) {
    if (!isOpen || !panel) return;
    const query = input.value.trim();
    const outline = outlineItems();
    const items = query.length >= 2 ? searchItems(query) : query ? outline.items.filter((i) => i.text.toLowerCase().includes(query.toLowerCase())) : outline.items;
    const searching = query.length >= 2 && !fullConversation() && !!SB.state.conversationId;
    const report = outline.report;
    const last = items[items.length - 1];
    const next = [query, items.length, outline.count, outline.hidden, last ? last.text.length : 0, searching, !!fullLoading, report && report.paused].join('|');
    if (!force && next === signature) {
      updateCurrent();
      return;
    }
    signature = next;
    entries = items;
    countEl.textContent = outline.count ? `${SB.util.formatNumber(outline.count)} prompt${outline.count === 1 ? '' : 's'}` : '';

    const html = [];
    if (!query && report && report.paused) {
      html.push(
        '<div class="list-note">Older messages are paused for speed. ' +
          '<button data-act="more">Load more</button> · <button data-act="all">Load all</button></div>'
      );
    } else if (!query && outline.hidden) {
      html.push(
        `<div class="list-note">${SB.util.formatNumber(outline.hidden)} older prompt${outline.hidden === 1 ? ' is' : 's are'} hidden for speed. ` +
          'Click one to jump there, or <button data-act="all">load everything</button>.</div>'
      );
    }
    if (searching) {
      html.push(`<div class="list-note">${fullLoading ? 'Searching the whole chat…' : 'Showing loaded messages only.'}</div>`);
    }
    items.forEach((item, i) => {
      const cls = item.kind === 'hidden' ? ' is-hidden' : item.kind === 'answer' || item.role === 'assistant' ? ' is-answer' : '';
      const num = item.role === 'assistant' || item.kind === 'answer' ? '↳' : item.n || '•';
      html.push(
        `<button class="item${cls}" data-i="${i}" role="listitem">` +
          `<span class="num">${num}</span>` +
          `<span class="body"><span class="text">${highlight(snippet(item.text, query), query) || '<em>(attachment)</em>'}</span>${metaFor(item)}</span>` +
          `</button>`
      );
    });
    if (!items.length && !searching) {
      html.push(`<div class="empty">${query ? 'No matches in this chat' : 'Your prompts will show up here'}</div>`);
    }
    SB.ui.html(list, html.join(''));
    currentIndex = -1;
    updateCurrent();
  }

  function elementFor(entry) {
    if (entry.el && entry.el.isConnected) return entry.el;
    const el = SB.chatgpt.findTurn(entry.id) || (entry.promptId ? SB.chatgpt.findTurn(entry.promptId) : null);
    if (el) entry.el = el;
    return el;
  }

  function updateCurrent() {
    if (!isOpen || !list) return;
    let current = -1;
    if (!input.value.trim()) {
      const scroller = SB.chatgpt.scroller();
      const top = (scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top) + 140;
      entries.forEach((entry, i) => {
        if (entry.kind !== 'prompt') return;
        const el = elementFor(entry);
        if (!el || el.hasAttribute('data-sb-collapsed')) return;
        if (el.getBoundingClientRect().top <= top) current = i;
      });
      if (current === -1) current = entries.findIndex((e) => e.kind === 'prompt');
    }
    if (current === currentIndex) return;
    const previous = list.querySelector('.item.current');
    if (previous) previous.classList.remove('current');
    const button = current >= 0 ? list.querySelector(`.item[data-i="${current}"]`) : null;
    if (button) {
      button.classList.add('current');
      button.scrollIntoView({ block: 'nearest' });
    }
    currentIndex = current;
  }

  function activate(entry) {
    const anchor = entry.role === 'assistant' && entry.promptId ? entry.promptId : entry.id;
    // Answers inside a virtualized turn render after the scroll; then land on the exact message.
    const refine = () => {
      if (entry.role !== 'assistant') return;
      setTimeout(() => {
        const exact = SB.chatgpt.findTurn(entry.id);
        if (exact && exact !== SB.chatgpt.findTurn(entry.promptId)) SB.actions.reveal(exact);
      }, 450);
    };
    if (entry.kind === 'hidden') {
      if (anchor) SB.speed.reach(anchor, entry.fromEnd || 1);
      return;
    }
    const el = elementFor(entry);
    if (el) {
      if (el.hasAttribute('data-sb-collapsed')) SB.speed.loadMore('all');
      SB.actions.reveal(el);
      refine();
    } else if (anchor) {
      // Loaded, but virtualized out of the page right now: scroll it into existence.
      SB.actions.seek(anchor).then((found) => (found ? refine() : SB.ui.toast("Couldn't find that message on the page", 'error')));
    }
  }

  function position() {
    if (!panel) return;
    const dock = SB.state.settings.dockPosition;
    panel.dataset.position = dock === 'left' ? 'left' : 'right';
    panel.style.right = dock === 'hidden' ? '16px' : '';
  }

  function build() {
    panel = SB.ui.el(`
      <section class="outline hidden" role="dialog" aria-label="Chat outline">
        <header>
          <h2>Outline <small></small></h2>
          <button class="icon-btn" data-act="top" title="Scroll to top">${SB.ui.icon('top')}</button>
          <button class="icon-btn" data-act="bottom" title="Scroll to bottom">${SB.ui.icon('bottom')}</button>
          <button class="icon-btn" data-act="close" title="Close (Esc)">${SB.ui.icon('close')}</button>
        </header>
        <label class="search">${SB.ui.icon('search')}<input type="text" placeholder="Search the whole chat…" aria-label="Search the whole chat" spellcheck="false"></label>
        <div class="list" role="list"></div>
      </section>`);
    list = panel.querySelector('.list');
    input = panel.querySelector('input');
    countEl = panel.querySelector('h2 small');

    panel.addEventListener('click', (event) => {
      const act = event.target.closest('[data-act]');
      if (act) {
        const name = act.dataset.act;
        if (name === 'close') close(true);
        else if (name === 'top') SB.actions.scrollTop();
        else if (name === 'bottom') SB.actions.scrollBottom();
        else if (name === 'all') SB.speed.loadMore('all');
        else if (name === 'more') SB.speed.loadMore();
        return;
      }
      const button = event.target.closest('.item');
      const entry = button && entries[Number(button.dataset.i)];
      if (entry) activate(entry);
    });
    const onInput = SB.util.throttle(() => {
      if (input.value.trim().length >= 2) loadFull();
      render(true);
    }, 150);
    input.addEventListener('input', onInput);
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (input.value) {
          input.value = '';
          render(true);
        } else {
          close(true);
        }
      } else if (event.key === 'Enter' && event.target === input) {
        const first = list.querySelector('.item');
        if (first) first.click();
      }
    });
    SB.ui.root().appendChild(panel);
  }

  function persist(value) {
    try {
      localStorage.setItem(OPEN_KEY, value ? '1' : '0');
    } catch (error) {
      /* ignore */
    }
  }

  function maybeLoadFullForOutline() {
    const report = SB.util.currentReport();
    if (isOpen && report && report.mode === 'paged' && report.hasMore) loadFull();
  }

  function open(focus) {
    if (!SB.ui.root()) return;
    if (!panel) build();
    position();
    panel.classList.remove('hidden');
    isOpen = true;
    persist(true);
    render(true);
    maybeLoadFullForOutline();
    if (focus) input.focus({ preventScroll: true });
    SB.emit('outline', true);
  }

  function close(refocus) {
    if (!panel) return;
    panel.classList.add('hidden');
    isOpen = false;
    persist(false);
    SB.emit('outline', false);
    if (refocus) {
      const composer = SB.chatgpt.composer();
      if (composer) composer.focus();
    }
  }

  function toggle(force) {
    const next = typeof force === 'boolean' ? force : !isOpen;
    if (next) open(true);
    else close(true);
  }

  SB.on('ready', () => {
    let wasOpen = false;
    try {
      wasOpen = localStorage.getItem(OPEN_KEY) === '1';
    } catch (error) {
      /* ignore */
    }
    if (wasOpen && SB.state.settings.enabled) open(false);
  });
  SB.on('refresh', () => render(false));
  SB.on('report', () => {
    maybeLoadFullForOutline();
    render(true);
  });
  SB.on('navigate', () => {
    if (input) input.value = '';
    full = null;
    render(true);
  });
  SB.on('settings', (s) => {
    position();
    if (!s.enabled && isOpen) close(false);
  });
  document.addEventListener('scroll', SB.util.throttle(updateCurrent, 100), { capture: true, passive: true });

  SB.outline = { toggle, open, close, isOpen: () => isOpen };
})();
