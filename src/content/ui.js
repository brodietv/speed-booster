/* Speed Booster — in-page UI host (Shadow DOM, so ChatGPT's CSS and ours never collide). */
(() => {
  'use strict';
  const SB = globalThis.SpeedBooster;

  const ICONS = {
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    outline: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    sparkles:
      '<path d="M9.94 15.5a2 2 0 0 0-1.44-1.44l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0l1.58 6.13a2 2 0 0 0 1.44 1.44l6.13 1.58a.5.5 0 0 1 0 .96l-6.13 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z"/>',
    command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    wide: '<path d="M18 8l4 4-4 4M6 8l-4 4 4 4M2 12h20"/>',
    settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    top: '<path d="M5 3h14M12 21V7M6 13l6-6 6 6"/>',
    bottom: '<path d="M12 3v14M6 11l6 6 6-6M5 21h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    braces:
      '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 21h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    enter: '<path d="M9 10 4 15l5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5z"/><path d="M4 19.5V22h16"/>',
  };

  const CSS = `
  :host { all: initial; }
  .sb {
    --bg: #ffffff; --surface: #f7f7f8; --raised: #ffffff;
    --border: rgba(0,0,0,.1); --border-strong: rgba(0,0,0,.18);
    --text: #0d0d0d; --muted: #5d5d6b; --faint: #8e8ea0;
    --hover: rgba(0,0,0,.05); --active: rgba(0,0,0,.08);
    --accent: #0f9d77; --accent-text: #ffffff; --accent-soft: rgba(16,163,127,.12);
    --tip-bg: #0d0d0d; --tip-text: #ffffff;
    --shadow: 0 10px 30px rgba(0,0,0,.12), 0 2px 6px rgba(0,0,0,.06);
    font: 13px/1.45 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Helvetica, Arial, sans-serif;
    color: var(--text);
    -webkit-font-smoothing: antialiased;
  }
  .sb[data-theme="dark"] {
    --bg: #212121; --surface: #2a2a2a; --raised: #2f2f2f;
    --border: rgba(255,255,255,.1); --border-strong: rgba(255,255,255,.2);
    --text: #ececec; --muted: #b4b4b4; --faint: #8f8f8f;
    --hover: rgba(255,255,255,.07); --active: rgba(255,255,255,.11);
    --accent: #1fc788; --accent-text: #06291b; --accent-soft: rgba(31,199,136,.16);
    --tip-bg: #f4f4f4; --tip-text: #0d0d0d;
    --shadow: 0 12px 36px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.3);
  }
  *, *::before, *::after { box-sizing: border-box; }
  button, input, textarea, select { font: inherit; color: inherit; }
  button { cursor: pointer; }
  svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
  .hidden { display: none !important; }
  kbd {
    font: 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    padding: 3px 5px; border-radius: 5px; border: 1px solid var(--border);
    background: var(--surface); color: var(--muted); white-space: nowrap;
  }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    height: 30px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border);
    background: var(--raised); font-weight: 500; white-space: nowrap;
  }
  .btn:hover { background: var(--hover); }
  .btn.primary { background: var(--accent); border-color: transparent; color: var(--accent-text); }
  .btn.primary:hover { filter: brightness(1.06); }
  .btn svg { width: 15px; height: 15px; }
  .icon-btn {
    width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 8px;
    background: transparent; color: var(--muted);
  }
  .icon-btn:hover { background: var(--hover); color: var(--text); }
  .icon-btn svg { width: 16px; height: 16px; }

  /* Dock */
  .dock {
    position: fixed; top: 50%; right: 10px; transform: translateY(-50%); z-index: 2147483000;
    display: flex; flex-direction: column; gap: 2px; padding: 4px;
    background: var(--raised); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
    opacity: .72; transition: opacity .15s ease;
  }
  .dock[data-position="left"] { right: auto; left: 10px; }
  .dock:hover, .dock:focus-within, .dock.engaged { opacity: 1; }
  .dock-btn {
    position: relative; width: 34px; height: 34px; display: grid; place-items: center;
    border: 0; border-radius: 10px; background: transparent; color: var(--muted);
  }
  .dock-btn:hover { background: var(--hover); color: var(--text); }
  .dock-btn[aria-pressed="true"], .dock-btn.lit { color: var(--accent); }
  .dock-btn[aria-pressed="true"] { background: var(--accent-soft); }
  .dock-btn .badge {
    position: absolute; top: 0; right: -2px; min-width: 16px; height: 15px; padding: 0 4px;
    border-radius: 8px; background: var(--accent); color: var(--accent-text);
    font-size: 9.5px; font-weight: 700; line-height: 15px; text-align: center; pointer-events: none;
  }
  .dock-sep { height: 1px; margin: 3px 7px; background: var(--border); }
  .dock-btn[data-tip]:hover::after {
    content: attr(data-tip); position: absolute; top: 50%; right: calc(100% + 10px); transform: translateY(-50%);
    background: var(--tip-bg); color: var(--tip-text); padding: 5px 8px; border-radius: 7px;
    font-size: 12px; font-weight: 500; white-space: nowrap; pointer-events: none;
  }
  .dock[data-position="left"] .dock-btn[data-tip]:hover::after { right: auto; left: calc(100% + 10px); }
  .dock.engaged .dock-btn[data-tip]:hover::after { display: none; }

  /* Popovers */
  .popover {
    position: fixed; z-index: 2147483001; width: 290px; padding: 14px;
    background: var(--raised); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow);
  }
  .popover h3 { margin: 0 0 4px; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
  .popover h3 svg { width: 16px; height: 16px; color: var(--accent); }
  .popover p { margin: 0 0 10px; color: var(--muted); }
  .popover .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin: 10px 0 12px; }
  .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 7px 8px; }
  .stat b { display: block; font-size: 15px; font-variant-numeric: tabular-nums; }
  .stat span { font-size: 11px; color: var(--faint); }
  .menu { display: flex; flex-direction: column; gap: 2px; margin: 0 -6px -6px; }
  .menu-item {
    display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 0; border-radius: 9px;
    background: transparent; text-align: left;
  }
  .menu-item:hover { background: var(--hover); }
  .menu-item svg { width: 16px; height: 16px; color: var(--muted); }
  .menu-item small { margin-left: auto; color: var(--faint); font-size: 11px; }
  .note { font-size: 11.5px; color: var(--faint); margin-top: 10px; }
  .popover p.note { margin: 10px 0 0; }
  .link { border: 0; background: none; padding: 0; color: var(--accent); font-weight: 600; cursor: pointer; }
  .link:hover { text-decoration: underline; }

  /* "Older messages hidden" pill */
  .pill {
    position: fixed; top: 64px; left: 50%; transform: translateX(-50%); z-index: 2147482999;
    display: flex; align-items: center; gap: 8px; padding: 5px 5px 5px 12px; max-width: calc(100vw - 24px);
    background: var(--raised); border: 1px solid var(--border); border-radius: 999px; box-shadow: var(--shadow);
    white-space: nowrap; animation: sb-in .18s ease;
  }
  .pill > svg { width: 15px; height: 15px; color: var(--accent); }
  .pill .label { overflow: hidden; text-overflow: ellipsis; }
  .pill .btn { height: 26px; padding: 0 10px; font-size: 12.5px; }

  /* Outline */
  .outline {
    position: fixed; top: 72px; right: 60px; z-index: 2147483000; width: 310px; max-height: calc(100vh - 160px);
    display: flex; flex-direction: column; overflow: hidden;
    background: var(--raised); border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow);
    animation: sb-in .16s ease;
  }
  .outline[data-position="left"] { right: auto; left: 60px; }
  .outline header { display: flex; align-items: center; gap: 2px; padding: 10px 8px 6px 14px; }
  .outline h2 { flex: 1; margin: 0; font-size: 13px; font-weight: 600; }
  .outline h2 small { font-weight: 400; color: var(--faint); margin-left: 4px; }
  .search {
    display: flex; align-items: center; gap: 7px; margin: 2px 10px 8px; padding: 6px 10px;
    border-radius: 10px; background: var(--surface); border: 1px solid var(--border);
  }
  .search:focus-within { border-color: var(--border-strong); }
  .search svg { width: 15px; height: 15px; color: var(--faint); }
  .search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; }
  .list { overflow: auto; padding: 0 6px 8px; overscroll-behavior: contain; }
  .item {
    display: flex; gap: 8px; align-items: flex-start; width: 100%; padding: 7px 8px; border: 0; border-radius: 9px;
    background: transparent; text-align: left; color: var(--text);
  }
  .item:hover { background: var(--hover); }
  .item.current { background: var(--accent-soft); }
  .item .num { flex: none; min-width: 22px; color: var(--faint); font-size: 11px; line-height: 19px; font-variant-numeric: tabular-nums; }
  .item .body { flex: 1; min-width: 0; }
  .item .text { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 19px; word-break: break-word; }
  .item .meta { display: flex; align-items: center; gap: 4px; margin-top: 1px; font-size: 11px; color: var(--faint); }
  .item .meta svg { width: 11px; height: 11px; }
  .item.is-hidden { color: var(--muted); }
  .item.is-answer .num { color: var(--accent); }
  .item mark { background: rgba(250, 204, 21, .35); color: inherit; border-radius: 3px; padding: 0 1px; }
  .empty { padding: 18px 12px 22px; text-align: center; color: var(--faint); }
  .list-note { margin: 2px 8px 6px; padding: 8px 10px; border-radius: 10px; background: var(--surface); color: var(--muted); font-size: 12px; }
  .list-note button { border: 0; background: none; padding: 0; color: var(--accent); font-weight: 600; }

  /* Command palette */
  .overlay {
    position: fixed; inset: 0; z-index: 2147483100; display: flex; justify-content: center; align-items: flex-start;
    padding-top: 12vh; background: rgba(0,0,0,.32); animation: sb-fade .12s ease;
  }
  .palette {
    width: min(640px, calc(100vw - 32px)); max-height: 72vh; display: flex; flex-direction: column; overflow: hidden;
    background: var(--raised); border: 1px solid var(--border); border-radius: 16px;
    box-shadow: 0 24px 70px rgba(0,0,0,.35); animation: sb-in .14s ease;
  }
  .palette .input-row { display: flex; align-items: center; gap: 10px; padding: 13px 16px; border-bottom: 1px solid var(--border); }
  .palette .input-row svg { color: var(--faint); }
  .palette .input-row input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font-size: 15px; }
  .palette .mode { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
  .results { overflow: auto; padding: 6px; overscroll-behavior: contain; }
  .section-label { padding: 8px 10px 4px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--faint); }
  .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; cursor: pointer; }
  .row.selected { background: var(--active); }
  .row .glyph { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); flex: none; }
  .row .glyph svg { width: 15px; height: 15px; }
  .row .copy { flex: 1; min-width: 0; }
  .row .title { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .sub { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .hint { flex: none; display: flex; gap: 4px; }
  .palette footer {
    display: flex; flex-wrap: wrap; gap: 14px; padding: 8px 14px; border-top: 1px solid var(--border);
    color: var(--faint); font-size: 11.5px;
  }
  .palette footer span { display: inline-flex; align-items: center; gap: 5px; }
  .form { padding: 14px 16px 16px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
  .form h4 { margin: 0; font-size: 14px; }
  .form .preview { margin: 0; color: var(--muted); font-size: 12px; white-space: pre-wrap; max-height: 90px; overflow: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; }
  .field { display: flex; flex-direction: column; gap: 5px; }
  .field label { font-size: 12px; font-weight: 600; color: var(--muted); }
  .field input, .field textarea {
    width: 100%; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--border-strong);
    background: var(--bg); outline: 0; resize: vertical;
  }
  .field input:focus, .field textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .form .actions { display: flex; gap: 8px; justify-content: flex-end; }

  /* Composer counter */
  .counter {
    position: fixed; z-index: 2147482998; padding: 2px 8px; border-radius: 999px; pointer-events: none;
    font-size: 11px; font-variant-numeric: tabular-nums; color: var(--muted);
    background: var(--raised); border: 1px solid var(--border);
  }

  /* Toasts */
  .toasts {
    position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 2147483200;
    display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none;
  }
  .toast {
    padding: 9px 14px; border-radius: 10px; background: var(--tip-bg); color: var(--tip-text);
    font-size: 13px; font-weight: 500; box-shadow: var(--shadow); animation: sb-in .18s ease;
  }
  .toast.error { background: #e5484d; color: #fff; }

  @keyframes sb-in { from { opacity: 0; transform: translateY(6px); } }
  .pill { animation-name: sb-pill; }
  @keyframes sb-pill { from { opacity: 0; transform: translate(-50%, -6px); } }
  @keyframes sb-fade { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
  @media (max-width: 760px) {
    .dock { top: auto; bottom: 130px; transform: none; }
    .outline { left: 8px !important; right: 8px !important; width: auto; top: 60px; }
    .dock-btn[data-tip]:hover::after { display: none; }
  }
  `;

  let host = null;
  let container = null;
  let toastBox = null;

  function icon(name) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }

  function syncTheme() {
    if (!container) return;
    const html = document.documentElement;
    const dark =
      html.classList.contains('dark') ||
      (!html.classList.contains('light') && matchMedia('(prefers-color-scheme: dark)').matches);
    container.dataset.theme = dark ? 'dark' : 'light';
  }

  function mount() {
    if (host && host.isConnected) return container;
    if (!host) {
      host = document.createElement('speed-booster-ui');
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = CSS;
      container = document.createElement('div');
      container.className = 'sb';
      toastBox = document.createElement('div');
      toastBox.className = 'toasts';
      container.appendChild(toastBox);
      shadow.append(style, container);
      syncTheme();
      new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme);
      // Keep keystrokes typed into our inputs away from ChatGPT's global shortcuts.
      for (const type of ['keydown', 'keyup', 'keypress']) {
        shadow.addEventListener(type, (event) => {
          if (SB.util.isEditable(event.composedPath()[0])) event.stopPropagation();
        });
      }
    }
    (document.body || document.documentElement).appendChild(host);
    return container;
  }

  const parser = new DOMParser();

  /**
   * Parse our own UI markup into nodes. Every dynamic value in it has already
   * gone through escape(), so chat content can never become markup.
   */
  function fragment(markup) {
    const doc = parser.parseFromString(`<body>${markup}</body>`, 'text/html');
    const out = document.createDocumentFragment();
    out.append(...doc.body.childNodes);
    return out;
  }

  function el(markup) {
    return fragment(markup.trim()).firstElementChild;
  }

  /** Replace an element's children with parsed markup. */
  function html(target, markup) {
    target.replaceChildren(fragment(markup));
  }

  function toast(message, type) {
    if (!toastBox) return;
    const node = document.createElement('div');
    node.className = 'toast' + (type === 'error' ? ' error' : '');
    node.textContent = message;
    toastBox.appendChild(node);
    setTimeout(() => node.remove(), type === 'error' ? 4200 : 2600);
  }

  function escape(text) {
    return String(text == null ? '' : text).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  }

  /** Is this event's target inside our UI? */
  function owns(event) {
    return !!host && event.composedPath().includes(host);
  }

  SB.ui = {
    mount,
    root: () => container,
    host: () => host,
    icon,
    el,
    html,
    toast,
    escape,
    owns,
    isMounted: () => !!host && host.isConnected,
  };
})();
