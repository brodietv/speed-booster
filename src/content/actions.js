/* Speed Booster — actions shared by the dock, command palette, shortcuts and popup. */
(() => {
  'use strict';
  const SB = globalThis.SpeedBooster;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const USER_INPUT = ['wheel', 'touchmove', 'keydown', 'mousedown'];

  function flash(el) {
    if (!el) return;
    el.removeAttribute('data-sb-flash');
    void el.offsetWidth; // restart the animation
    el.setAttribute('data-sb-flash', '');
    setTimeout(() => el.removeAttribute('data-sb-flash'), 1700);
  }

  let stopSettling = null;

  /**
   * Scroll a turn to the top of the chat, then keep it there while virtualized
   * turns above it render and change height (and while ChatGPT pins a freshly
   * loaded chat to the bottom). Any wheel/touch/key/click from the user ends it.
   */
  function reveal(el) {
    if (!el) return;
    if (stopSettling) stopSettling();
    el.scrollIntoView({ block: 'start' });
    flash(el);
    let stopped = false;
    let steady = 0;
    let ticks = 0;
    const stop = () => {
      stopped = true;
      for (const type of USER_INPUT) window.removeEventListener(type, stop, { capture: true });
      if (stopSettling === stop) stopSettling = null;
    };
    stopSettling = stop;
    for (const type of USER_INPUT) window.addEventListener(type, stop, { capture: true, passive: true });
    (function tick() {
      setTimeout(() => {
        if (stopped) return;
        if (!el.isConnected || ++ticks > 24) return stop();
        const offset = el.getBoundingClientRect().top - SB.chatgpt.viewportTop();
        if (Math.abs(offset) > 12) {
          el.scrollIntoView({ block: 'start' });
          steady = 0;
        } else if (++steady >= 3) {
          return stop();
        }
        tick();
      }, 150);
    })();
  }

  /**
   * Bring a loaded prompt into view even when ChatGPT has virtualized it out of
   * the page entirely: estimate its position, then binary-search on scroll
   * position using the prompts that are mounted. Resolves true when found.
   */
  async function seek(id) {
    const direct = SB.chatgpt.findTurn(id);
    if (direct) {
      reveal(direct);
      return true;
    }
    const order = SB.chatgpt.promptOrder();
    const target = order.indexOf(id);
    if (target === -1) return false;
    const scroller = SB.chatgpt.scroller();
    const maxTop = () => Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    let lo = 0;
    let hi = maxTop();
    scroller.scrollTop = Math.round(hi * (order.length > 1 ? target / (order.length - 1) : 0));
    for (let i = 0; i < 20; i++) {
      await sleep(160);
      const el = SB.chatgpt.findTurn(id);
      if (el) {
        reveal(el);
        return true;
      }
      const mounted = SB.chatgpt
        .mountedPrompts()
        .map((p) => order.indexOf(p.id))
        .filter((n) => n >= 0);
      const position = scroller.scrollTop;
      if (!mounted.length) {
        scroller.scrollTop = Math.max(0, position - scroller.clientHeight / 2); // inside a long answer
        continue;
      }
      if (Math.min(...mounted) > target) hi = position;
      else if (Math.max(...mounted) < target) lo = position;
      else break;
      hi = Math.min(hi, maxTop());
      scroller.scrollTop = Math.round((lo + hi) / 2);
    }
    const found = SB.chatgpt.findTurn(id);
    if (found) reveal(found);
    return !!found;
  }

  /** Jump to the previous (-1) or next (+1) prompt relative to what's on screen. */
  function jumpPrompt(direction) {
    const order = SB.chatgpt.promptOrder();
    if (!order.length) return;
    const top = SB.chatgpt.viewportTop();
    let above = -1;
    let at = -1;
    let below = order.length;
    for (const prompt of SB.chatgpt.mountedPrompts()) {
      const index = order.indexOf(prompt.id);
      if (index === -1) continue;
      const offset = prompt.el.getBoundingClientRect().top - top;
      if (offset < -8) above = Math.max(above, index);
      else if (offset <= 24) at = index;
      else below = Math.min(below, index);
    }
    let target;
    if (direction < 0) target = above >= 0 ? above : at >= 0 ? at - 1 : below - 1;
    else target = below < order.length ? below : at >= 0 ? at + 1 : above + 1;
    seek(order[Math.min(order.length - 1, Math.max(0, target))]);
  }

  async function toggle(key, onLabel, offLabel) {
    const next = await SB.settings.save({ [key]: !SB.state.settings[key] });
    SB.ui.toast(next[key] ? onLabel : offLabel);
  }

  SB.actions = {
    flash,
    reveal,
    seek,
    jumpPrompt,
    toggleWide: () => toggle('wideMode', 'Wide mode on', 'Wide mode off'),
    toggleTimestamps: () => toggle('timestamps', 'Timestamps on', 'Timestamps off'),
    scrollTop() {
      SB.chatgpt.scroller().scrollTo({ top: 0, behavior: 'smooth' });
    },
    scrollBottom() {
      const scroller = SB.chatgpt.scroller();
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    },
    openOptions() {
      Promise.resolve(SB.ext.runtime.sendMessage({ type: 'sb:openOptions' })).catch(() => {
        SB.ui.toast('Open Speed Booster settings from the browser toolbar', 'error');
      });
    },
    /** Long chats silently lose early context — offer a summary to carry into a fresh chat. */
    insertSummaryPrompt() {
      const text =
        'Write a compact but complete summary of this entire conversation that I can paste into a new chat to continue seamlessly: goals, key facts and constraints, decisions made, code or artifacts produced (with the latest versions), open questions and next steps.';
      if (!SB.chatgpt.insert(text)) {
        SB.util.copyText(text);
        SB.ui.toast('Composer not found — prompt copied to clipboard');
      }
    },
  };
})();
