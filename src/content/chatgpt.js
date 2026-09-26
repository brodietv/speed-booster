/*
 * Speed Booster — ChatGPT DOM adapter. Every selector lives here, each with
 * fallbacks, so a ChatGPT redesign means updating one file.
 *
 * Current ChatGPT (2026) wraps each turn in div[data-turn-id-container] and
 * virtualizes: off-screen turns are empty placeholders, so anything that needs
 * the full list of prompts uses the network layer's report, not the DOM.
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
    send: ['[data-testid="send-button"]', 'button#composer-submit-button', 'form[data-type="unified-composer"] button[type="submit"]'],
    stop: '[data-testid="stop-button"]',
  };

  const isRootPlaceholder = (id) => !id || id === 'client-created-root' || id.startsWith('paginated-root');
  const visible = (el) => !!el && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);

  function messages(root) {
    return Array.from((root || document).querySelectorAll(S.message));
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
      (el) => !isRootPlaceholder(el.getAttribute('data-turn-id-container'))
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
    const container = document.querySelector(`[data-turn-id-container="${esc}"]`);
    if (container) return container;
    const turn = document.querySelector(`[data-turn-id="${esc}"]`);
    if (turn) return turn.closest(S.container) || turn;
    const msg = document.querySelector(`[data-message-id="${esc}"]`);
    if (msg) return msg.closest(`${S.container}, ${S.turn}, article, section`) || msg;
    return null;
  }

  /** Every user turn currently in the page (rendered or placeholder), in order. */
  function promptAnchors() {
    const found = new Set();
    for (const t of turns()) if (t.role === 'user') found.add(t.el);
    const report = SB.util.currentReport();
    if (report) {
      for (const p of report.prompts) {
        if (p.hidden) continue;
        const el = findTurn(p.id);
        if (el) found.add(el);
      }
    }
    return Array.from(found).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
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

  function escapeHtml(text) {
    return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  function caretToEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /** Replace the composer's content (works with ProseMirror and plain textareas). */
  function setComposer(el, text) {
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.setSelectionRange(text.length, text.length);
      return;
    }
    el.innerHTML = text
      .split('\n')
      .map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
      .join('');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    caretToEnd(el);
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

  /** Insert text into the composer: fills an empty composer, otherwise inserts at the caret. */
  function insert(text, options) {
    const el = composer();
    if (!el) return false;
    const caret = savedCaret;
    savedCaret = null;
    el.focus();
    const current = composerText(el);
    if ((options && options.replace) || !current.trim()) {
      setComposer(el, text);
      return true;
    }
    if (el.tagName === 'TEXTAREA') {
      const start = el.selectionStart != null ? el.selectionStart : current.length;
      const end = el.selectionEnd != null ? el.selectionEnd : current.length;
      setComposer(el, current.slice(0, start) + text + current.slice(end));
      el.setSelectionRange(start + text.length, start + text.length);
      return true;
    }
    const selection = window.getSelection();
    if (caret && el.contains(caret.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(caret);
    } else {
      caretToEnd(el);
    }
    const data = new DataTransfer();
    data.setData('text/plain', text);
    const handled = !el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    if (handled || document.execCommand('insertText', false, text)) return true;
    setComposer(el, current + '\n\n' + text);
    return true;
  }

  function sendButton() {
    for (const selector of S.send) {
      const el = document.querySelector(selector);
      if (el && visible(el)) return el;
    }
    return null;
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
    promptAnchors,
    isVirtualized,
    roleOf,
    scroller,
    composer,
    composerText,
    rememberCaret,
    insert,
    send,
    isGenerating,
    messageText,
  };
})();
