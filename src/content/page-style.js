/* Speed Booster — stylesheet injected into ChatGPT itself (render boost, wide mode, timestamps). */
(() => {
  'use strict';
  const SB = globalThis.SpeedBooster;
  const ID = 'speed-booster-page-style';
  let styleEl = null;
  let cssText = '';

  // Classic (non-virtualized) turn markup only — current ChatGPT already skips off-screen turns itself.
  const CLASSIC_TURN = [
    'article[data-testid^="conversation-turn-"]',
    'div[data-testid^="conversation-turn-"]',
    'section[data-testid^="conversation-turn-"]',
  ]
    .map((s) => `${s}:not([data-turn-id-container] *)`)
    .join(', ');

  function build(s) {
    if (!s.enabled) return '';
    const rules = [
      '[data-sb-collapsed] { display: none !important; }',
      '@keyframes sb-flash { 0%, 35% { box-shadow: inset 0 0 0 2px rgba(16, 163, 127, .55); background-color: rgba(16, 163, 127, .07); } 100% { box-shadow: inset 0 0 0 2px transparent; background-color: transparent; } }',
      '[data-sb-flash] { animation: sb-flash 1.6s ease-out; border-radius: 14px; }',
    ];

    if (s.renderBoost) {
      // Off-screen turns skip style, layout and paint until they scroll into view.
      rules.push(`${CLASSIC_TURN} { content-visibility: auto; contain-intrinsic-size: auto 480px; }`);
    }

    if (s.wideMode) {
      const width = s.chatWidth >= SB.settings.FULL_WIDTH ? '100%' : s.chatWidth + 'px';
      rules.push(
        `[class*="--thread-content-max-width"] { --thread-content-max-width: ${width} !important; }`,
        `[class*="max-w-(--thread-content-max-width)"], [class*="max-w-[var(--thread-content-max-width)]"] { max-width: ${width} !important; }`,
        `main [class*="max-w-3xl"], main [class*="max-w-[48rem]"], main [class*="max-w-[40rem]"], main [class*="max-w-[38rem]"] { max-width: ${width} !important; }`
      );
    }

    if (s.timestamps) {
      rules.push(
        `[data-message-author-role][data-sb-time]::before {
          content: attr(data-sb-time);
          display: block;
          font-size: 11px;
          line-height: 16px;
          opacity: 0.5;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          pointer-events: none;
          user-select: none;
        }`
      );
    }
    return rules.join('\n');
  }

  let waitingForHead = false;

  // Only ever attach inside <head>: React tolerates foreign nodes there during hydration.
  function ensureAttached() {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = ID;
    }
    if (styleEl.isConnected) return;
    if (document.head) {
      document.head.appendChild(styleEl);
    } else if (!waitingForHead) {
      waitingForHead = true;
      const observer = new MutationObserver(() => {
        if (!document.head) return;
        observer.disconnect();
        waitingForHead = false;
        ensureAttached();
      });
      observer.observe(document.documentElement, { childList: true });
    }
  }

  function apply() {
    const next = build(SB.state.settings);
    if (next !== cssText) {
      cssText = next;
      ensureAttached();
      styleEl.textContent = cssText;
    } else if (cssText) {
      ensureAttached();
    }
  }

  SB.pageStyle = { apply, ensureAttached: () => cssText && ensureAttached(), build };
})();
