/* Speed Booster — actions shared by the dock, command palette, shortcuts and popup. */
(() => {
  'use strict';
  const SB = globalThis.SpeedBooster;

  function flash(el) {
    if (!el) return;
    el.removeAttribute('data-sb-flash');
    void el.offsetWidth; // restart the animation
    el.setAttribute('data-sb-flash', '');
    setTimeout(() => el.removeAttribute('data-sb-flash'), 1700);
  }

  function reveal(el) {
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    flash(el);
  }

  /** Jump to the previous (-1) or next (+1) prompt relative to what's on screen. */
  function jumpPrompt(direction) {
    const prompts = SB.chatgpt.turns().filter((t) => t.role === 'user').map((t) => t.el);
    if (!prompts.length) return;
    const scroller = SB.chatgpt.scroller();
    const top = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
    const offsets = prompts.map((el) => el.getBoundingClientRect().top - top);
    let target;
    if (direction < 0) {
      for (let i = offsets.length - 1; i >= 0; i--) {
        if (offsets[i] < -8) {
          target = prompts[i];
          break;
        }
      }
      target = target || prompts[0];
    } else {
      target = prompts.find((el, i) => offsets[i] > 24) || prompts[prompts.length - 1];
    }
    reveal(target);
  }

  async function toggle(key, onLabel, offLabel) {
    const next = await SB.settings.save({ [key]: !SB.state.settings[key] });
    SB.ui.toast(next[key] ? onLabel : offLabel);
  }

  SB.actions = {
    flash,
    reveal,
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
