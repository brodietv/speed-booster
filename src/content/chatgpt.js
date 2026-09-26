/*
 * Speed Booster — ChatGPT DOM adapter. Every selector lives here, each with
 * fallbacks, so a ChatGPT redesign means updating one file.
 *
 * Current ChatGPT (2026) wraps each turn in div[data-turn-id-container] (the
 * mounted <section> repeats the attribute) and virtualizes: off-screen turns are
 * empty placeholders — or absent entirely — so anything that needs the full list
 * of prompts uses the network layer's report, not the DOM.
 */
(() => {
  'use strict';
  const SB = globalThis.SpeedBooster;

  const S = {
    message: '[data-message-author-role]',
    container: '[data-turn-id-container]',
    turn: '[data-testid^="conversation-turn-"], article[data-turn], section[data-turn]',
    scrollRoot: '[data-scroll-root]',
    composer: [
      '#prompt-textarea[contenteditable="true"]',
      'div#prompt-textarea',
      'form[data-type="unified-composer"] [contenteditable="true"]',
      'form .ProseMirror[contenteditable="true"]',
      'textarea#prompt-textarea',
      'form [contenteditable="true"][role="textbox"]',
      'main form textarea',
    ],
    // #composer-submit-button changes role (voice/send/stop); only this test id means "send".
    send: '[data-testid="send-button"]',
    stop: '[data-testid="stop-button"]',
  };

  const isRootPlaceholder = (id) => !id || id === 'client-created-root' || id.startsWith('paginated-root');
  const visible = (el) => !!el && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);

  function messages(root) {
    return Array.from((root || document).querySelectorAll(S.message));
  }

  /** Outermost turn wrapper for an element (the mounted section repeats the container attribute). */
  function outerContainer(el) {
    let top = el.closest(S.container);
    let next = top && top.parentElement ? top.parentElement.closest(S.container) : null;
    while (next) {
      top = next;
      next = top.parentElement ? top.parentElement.closest(S.container) : null;
    }
    return top;
  }

  function roleOf(el) {
    const section = el.matches('[data-turn]') ? el : el.querySelector('[data-turn]');
    const turn = section && section.getAttribute('data-turn');
    if (turn === 'user' || turn === 'assistant') return turn;
    const msg = el.matches(S.message) ? el : el.querySelector(S.message);
    if (!msg) return null; // virtualized placeholder
    return msg.getAttribute('data-message-author-role') === 'user' ? 'user' : 'assistant';
  }

  function idOf(el) {
    const container = el.getAttribute('data-turn-id-container');
    if (container) return container;
    const section = el.matches('[data-turn-id]') ? el : el.querySelector('[data-turn-id]');
    if (section) return section.getAttribute('data-turn-id');
    const msg = el.matches(S.message) ? el : el.querySelector(S.message);
    return msg ? msg.getAttribute('data-message-id') : null;
  }

  function isVirtualized() {
    return !!document.querySelector(S.container);
  }

  /** Turns in document order: [{ el, role, id }]. role is null for virtualized placeholders. */
  function turns() {
    let list = Array.from(document.querySelectorAll(S.container)).filter(
      (el) =>
        !isRootPlaceholder(el.getAttribute('data-turn-id-container')) &&
        (!el.parentElement || !el.parentElement.closest(S.container))
    );
    if (!list.length) {
      list = Array.from(document.querySelectorAll(S.turn)).filter(
        (el) => !el.parentElement || !el.parentElement.closest(S.turn)
      );
    }
    if (!list.length) {
      const seen = new Set();
      for (const msg of messages()) seen.add(msg.closest('article, section') || msg);
      list = Array.from(seen);
    }
    return list.map((el) => ({ el, role: roleOf(el), id: idOf(el) }));
  }

  /** The turn element for a message/turn id, even if it's a virtualized placeholder. */
  function findTurn(id) {
    if (!id) return null;
    const esc = CSS.escape(id);
    const hit =
      document.querySelector(`[data-turn-id-container="${esc}"]`) ||
      document.querySelector(`[data-turn-id="${esc}"]`) ||
      document.querySelector(`[data-message-id="${esc}"]`);
    if (!hit) return null;
    return outerContainer(hit) || hit.closest(`${S.turn}, article, section`) || hit;
  }

  /** Id of a rendered user turn (user turn ids equal their message ids). */
  function promptIdOf(turn) {
    const msg = turn.el.matches(S.message) ? turn.el : turn.el.querySelector('[data-message-author-role="user"]');
    return (msg && msg.getAttribute('data-message-id')) || turn.id;
  }

  /** Ids of every loaded prompt in conversation order: the network report, then prompts only in the DOM. */
  function promptOrder() {
    const report = SB.util.currentReport();
    const ids = report ? report.prompts.filter((p) => !p.hidden && p.id).map((p) => p.id) : [];
    const known = new Set(ids);
    for (const t of turns()) {
      if (t.role !== 'user') continue;
      const id = promptIdOf(t);
      if (id && !known.has(id)) {
        known.add(id);
        ids.push(id);
      }
    }
    return ids;
  }

  /** Rendered user turns right now: [{ id, el }] in document order. */
  function mountedPrompts() {
    return turns()
      .filter((t) => t.role === 'user')
      .map((t) => ({ id: promptIdOf(t), el: t.el }));
  }

  function scrollable(el) {
    if (!el || el.scrollHeight <= el.clientHeight + 1) return false;
    const overflow = getComputedStyle(el).overflowY;
    return overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay';
  }

  let cachedScroller = null;
  function scroller() {
    if (cachedScroller && cachedScroller.isConnected && scrollable(cachedScroller)) return cachedScroller;
    const root = document.querySelector(S.scrollRoot);
    if (scrollable(root)) return (cachedScroller = root);
    let el = document.querySelector(S.message) || document.querySelector(S.container) || document.querySelector('main');
    while (el && el !== document.body && el !== document.documentElement) {
      if (scrollable(el)) return (cachedScroller = el);
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  /** Top edge of the scrolling viewport, in client coordinates. */
  function viewportTop() {
    const el = scroller();
    return el === document.scrollingElement || el === document.documentElement ? 0 : el.getBoundingClientRect().top;
  }

  function composer() {
    for (const selector of S.composer) {
      const el = document.querySelector(selector);
      if (el && visible(el)) return el;
    }
    return null;
  }

  /**
   * Text in the composer. `fast` avoids innerText (which forces a layout) by
   * joining ProseMirror's paragraphs — used by the live counter.
   */
  function composerText(el, fast) {
    const target = el || composer();
    if (!target) return '';
    if (target.tagName === 'TEXTAREA') return target.value;
    if (fast) {
      const blocks = target.children.length ? Array.from(target.children, (child) => child.textContent) : [target.textContent];
      return blocks.join('\n');
    }
    return target.innerText.replace(/\n$/, '');
  }

  function select(el, collapseToEnd) {
    const range = document.createRange();
    range.selectNodeContents(el);
    if (collapseToEnd) range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /** Last-resort write: paragraphs built from text nodes, then let the editor pick up the mutation. */
  function setComposer(el, text) {
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.setSelectionRange(text.length, text.length);
      return;
    }
    const blocks = text.split('\n').map((line) => {
      const p = document.createElement('p');
      if (line) p.textContent = line;
      else p.appendChild(document.createElement('br'));
      return p;
    });
    el.replaceChildren(...blocks);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    select(el, true);
  }

  let savedCaret = null;

  /** Remember where the caret was in the composer before our UI takes focus. */
  function rememberCaret() {
    const el = composer();
    const selection = window.getSelection();
    savedCaret =
      el && el.tagName !== 'TEXTAREA' && selection.rangeCount && el.contains(selection.anchorNode)
        ? selection.getRangeAt(0).cloneRange()
        : null;
  }

  const squash = (text) => String(text).replace(/\s+/g, ' ').trim();

  /**
   * Insert text into the composer — replacing it when empty, otherwise at the caret.
   * Tries what ProseMirror handles natively first (paste, then a native editing
   * command), checking the result each time, and only then rewrites the DOM.
   */
  function insert(text, options) {
    const el = composer();
    if (!el) return false;
    const caret = savedCaret;
    savedCaret = null;
    el.focus();
    const current = composerText(el);
    const replace = (options && options.replace) || !current.trim();

    if (el.tagName === 'TEXTAREA') {
      if (replace) {
        setComposer(el, text);
      } else {
        const start = el.selectionStart != null ? el.selectionStart : current.length;
        const end = el.selectionEnd != null ? el.selectionEnd : current.length;
        setComposer(el, current.slice(0, start) + text + current.slice(end));
        el.setSelectionRange(start + text.length, start + text.length);
      }
      return true;
    }

    const place = () => {
      if (replace) select(el, false);
      else if (caret && el.contains(caret.startContainer)) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(caret);
      } else select(el, true);
    };
    const probe = squash(text).slice(0, 80);
    const landed = () => {
      const now = squash(composerText(el));
      return now.includes(probe) && (replace || now.length > squash(current).length);
    };

    place();
    // Very long pastes become file attachments in ChatGPT, so only paste normal-sized prompts.
    if (text.length < 2500) {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      if (landed()) return true;
      place();
    }
    if (document.execCommand('insertText', false, text) && landed()) return true;
    setComposer(el, replace ? text : current + '\n\n' + text);
    return true;
  }

  function sendButton() {
    const el = document.querySelector(S.send);
    return el && visible(el) ? el : null;
  }

  /** Click send once ChatGPT has enabled the button (it updates asynchronously after input). */
  function send() {
    return new Promise((resolve) => {
      const started = Date.now();
      (function attempt() {
        const button = sendButton();
        if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && !isGenerating()) {
          button.click();
          resolve(true);
        } else if (Date.now() - started > 2500) {
          resolve(false);
        } else {
          setTimeout(attempt, 60);
        }
      })();
    });
  }

  function isGenerating() {
    return !!document.querySelector(S.stop);
  }

  /**
   * Readable text of a message element (markdown body for answers).
   * `fast` uses textContent, which never forces a layout — for outline/search.
   */
  function messageText(el, fast) {
    const body = el.querySelector('.markdown') || el.querySelector('[class*="whitespace-pre-wrap"]') || el;
    const text = fast ? body.textContent : body.innerText || body.textContent;
    return (text || '').trim();
  }

  SB.chatgpt = {
    selectors: S,
    messages,
    turns,
    findTurn,
    promptOrder,
    mountedPrompts,
    isVirtualized,
    roleOf,
    scroller,
    viewportTop,
    composer,
    composerText,
    rememberCaret,
    insert,
    send,
    isGenerating,
    messageText,
  };
})();
