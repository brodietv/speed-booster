/* Speed Booster — live word / token counter for the message you're typing. */
(() => {
  'use strict';
  const SB = globalThis.SpeedBooster;
  let badge = null;
  let frame = 0;

  function render() {
    frame = 0;
    const root = SB.ui.root();
    if (!root) return;
    const s = SB.state.settings;
    const composer = s.enabled && s.tokenCounter ? SB.chatgpt.composer() : null;
    const text = composer ? SB.chatgpt.composerText(composer, true) : '';
    if (!text.trim()) {
      if (badge) badge.classList.add('hidden');
      return;
    }
    if (!badge) {
      badge = SB.ui.el('<div class="counter" aria-hidden="true"></div>');
      root.appendChild(badge);
    }
    const words = SB.format.countWords(text);
    const tokens = SB.format.estimateTokens(text);
    badge.textContent = `${SB.util.formatNumber(words)} word${words === 1 ? '' : 's'} · ≈${SB.util.formatNumber(tokens)} tokens`;
    const box = (composer.closest('form') || composer).getBoundingClientRect();
    badge.style.top = `${Math.max(4, Math.round(box.top - 26))}px`;
    badge.style.right = `${Math.max(4, Math.round(window.innerWidth - box.right + 10))}px`;
    badge.classList.remove('hidden');
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  document.addEventListener(
    'input',
    (event) => {
      const composer = SB.chatgpt.composer();
      if (composer && composer.contains(event.target)) schedule();
    },
    true
  );
  window.addEventListener('resize', schedule, { passive: true });
  SB.on('refresh', schedule);
  SB.on('settings', schedule);
})();
