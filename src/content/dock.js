/* Speed Booster — the floating dock: speed stats, outline, prompts, commands, export, wide mode. */
(() => {
  'use strict';
  const SB = globalThis.SpeedBooster;

  const BUTTONS = [
    { id: 'speed', icon: 'zap', tip: 'Speed Booster' },
    { sep: true },
    { id: 'outline', icon: 'outline', tip: 'Outline & search', key: 'J' },
    { id: 'prompts', icon: 'sparkles', tip: 'Prompt library', key: 'P' },
    { id: 'commands', icon: 'command', tip: 'Command palette', key: 'K' },
    { id: 'export', icon: 'download', tip: 'Export chat' },
    { id: 'wide', icon: 'wide', tip: 'Wide mode', key: 'W' },
    { sep: true },
    { id: 'settings', icon: 'settings', tip: 'Settings' },
  ];

  let dock = null;
  let popover = null;
  let popoverKind = null;
  let popoverAnchor = null;

  function speedContent() {
    const st = SB.speed.status();
    const s = SB.state.settings;
    const f = SB.util.formatNumber;
    const head = `<h3>${SB.ui.icon('zap')} Speed Booster</h3>`;
    const footer =
      `<div class="note">Keeps the last ${s.keepMessages} messages · render boost ${s.renderBoost ? 'on' : 'off'} · ` +
      `<button class="link" data-act="settings">settings</button></div>`;
    if (!st.conversationId && !st.total) {
      return `${head}<p>Open a conversation to see its stats. Long chats open instantly because only the most recent messages are rendered.</p>${footer}`;
    }
    const totalKnown = st.total != null;
    let html =
      head +
      `<div class="stats">` +
      `<div class="stat"><b>${f(st.kept)}</b><span>${totalKnown ? 'showing' : 'loaded'}</span></div>` +
      `<div class="stat"><b>${totalKnown ? f(st.total) : f(st.kept) + '+'}</b><span>messages</span></div>` +
      `<div class="stat"><b>${st.tokens != null ? '≈' + SB.util.compact(st.tokens) : '—'}</b><span>tokens${totalKnown ? '' : ' so far'}</span></div>` +
      `</div>`;
    if (st.paused) {
      html +=
        '<p>Older messages are paused so this chat stays fast. ChatGPT still remembers all of them.</p>' +
        `<div class="actions"><button class="btn primary" data-act="more">Load ${s.loadMoreStep} more</button>` +
        '<button class="btn" data-act="all">Load all</button></div>';
    } else if (st.mode === 'paged' && st.hasMore && s.trimEnabled) {
      html += `<p>Older messages load as you scroll up — up to ${s.keepMessages}, then they're paused for speed.</p>`;
    } else if (st.trimmed && st.hidden) {
      const step = Math.min(s.loadMoreStep, st.hidden);
      html +=
        `<p>${f(st.hidden)} older message${st.hidden === 1 ? ' is' : 's are'} hidden so this chat stays fast. ChatGPT still remembers all of them.</p>` +
        `<div class="actions">${step < st.hidden ? `<button class="btn primary" data-act="more">Load ${step} more</button>` : ''}` +
        `<button class="btn${step < st.hidden ? '' : ' primary'}" data-act="all">Show all</button></div>`;
    } else if (!s.trimEnabled) {
      html += '<p>Speed mode is off, so every message is rendered.</p>';
    } else {
      html += `<p>Nothing to trim — chats longer than ${s.keepMessages} messages are trimmed automatically when they load.</p>`;
    }
    if (st.tokens > 60000) {
      html +=
        `<p class="note">This chat is long (≈${SB.util.compact(st.tokens)} tokens), so ChatGPT may lose track of early details. ` +
        `<button class="link" data-act="summary">Get a hand-off summary</button> and continue in a new chat.</p>`;
    }
    return html + footer;
  }

  function exportContent() {
    const icon = SB.ui.icon;
    return (
      `<h3>${icon('download')} Export chat</h3>` +
      `<p>Includes every message — even ones hidden for speed.</p>` +
      `<div class="menu">` +
      `<button class="menu-item" data-act="md">${icon('file')} Markdown <small>.md</small></button>` +
      `<button class="menu-item" data-act="pdf">${icon('file')} PDF <small>print view</small></button>` +
      `<button class="menu-item" data-act="html">${icon('file')} Web page <small>.html</small></button>` +
      `<button class="menu-item" data-act="json">${icon('braces')} JSON <small>.json</small></button>` +
      `<button class="menu-item" data-act="txt">${icon('file')} Plain text <small>.txt</small></button>` +
      `<button class="menu-item" data-act="copy">${icon('copy')} Copy as Markdown</button>` +
      `</div>`
    );
  }

  function placePopover() {
    if (!popover || !popoverAnchor) return;
    const anchor = popoverAnchor.getBoundingClientRect();
    const bar = dock.getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    popover.style.top = `${Math.round(Math.min(Math.max(8, anchor.top - 12), window.innerHeight - height - 8))}px`;
    let left = SB.state.settings.dockPosition === 'left' ? bar.right + 10 : bar.left - 10 - width;
    left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
    popover.style.left = `${Math.round(left)}px`;
  }

  function renderPopover() {
    if (!popover) return;
    popover.innerHTML = popoverKind === 'speed' ? speedContent() : exportContent();
    placePopover();
  }

  function closePopover() {
    if (popover) popover.remove();
    popover = null;
    popoverKind = null;
    popoverAnchor = null;
    if (dock) dock.classList.remove('engaged');
  }

  function togglePopover(kind, anchor) {
    if (popoverKind === kind) {
      closePopover();
      return;
    }
    closePopover();
    popoverKind = kind;
    popoverAnchor = anchor;
    popover = SB.ui.el(`<div class="popover" role="dialog"></div>`);
    popover.addEventListener('click', (event) => {
      const act = event.target.closest('[data-act]');
      if (!act) return;
      const name = act.dataset.act;
      closePopover();
      if (name === 'more') SB.speed.loadMore();
      else if (name === 'all') SB.speed.loadMore('all');
      else if (name === 'summary') SB.actions.insertSummaryPrompt();
      else if (name === 'settings') SB.actions.openOptions();
      else SB.exporter.run(name);
    });
    SB.ui.root().appendChild(popover);
    dock.classList.add('engaged');
    renderPopover();
  }

  function onClick(event) {
    const button = event.target.closest('.dock-btn');
    if (!button) return;
    const id = button.dataset.id;
    if (id === 'speed' || id === 'export') {
      togglePopover(id, button);
      return;
    }
    closePopover();
    if (id === 'outline') SB.outline.toggle();
    else if (id === 'prompts') SB.palette.open('prompts');
    else if (id === 'commands') SB.palette.open('all');
    else if (id === 'wide') SB.actions.toggleWide();
    else if (id === 'settings') SB.actions.openOptions();
  }

  function build() {
    dock = SB.ui.el('<nav class="dock" aria-label="Speed Booster"></nav>');
    dock.innerHTML = BUTTONS.map((b) =>
      b.sep
        ? '<div class="dock-sep"></div>'
        : `<button class="dock-btn" data-id="${b.id}" aria-label="${b.tip}">${SB.ui.icon(b.icon)}</button>`
    ).join('');
    dock.addEventListener('click', onClick);
    SB.ui.root().appendChild(dock);
  }

  let lastSignature = '';

  function update() {
    if (!SB.ui.root()) return;
    if (!dock) build();
    const s = SB.state.settings;
    const current = SB.speed.status();
    // Called on every refresh while ChatGPT streams — skip DOM writes when nothing changed.
    const signature = JSON.stringify([s, current, SB.outline.isOpen(), popoverKind]);
    if (signature === lastSignature) return;
    lastSignature = signature;
    const hidden = !s.enabled || s.dockPosition === 'hidden';
    dock.classList.toggle('hidden', hidden);
    if (hidden) closePopover();
    dock.dataset.position = s.dockPosition;

    const st = current;
    for (const b of BUTTONS) {
      if (b.sep) continue;
      const el = dock.querySelector(`[data-id="${b.id}"]`);
      el.dataset.tip = b.key && s.shortcuts ? `${b.tip}  ${SB.util.shortcutLabel(b.key)}` : b.tip;
    }
    const speed = dock.querySelector('[data-id="speed"]');
    const hiddenKnown = st.trimmed && st.hidden > 0;
    const boosting = hiddenKnown || st.paused;
    speed.classList.toggle('lit', boosting);
    speed.dataset.tip = hiddenKnown
      ? `${SB.util.formatNumber(st.hidden)} older messages hidden for speed`
      : st.paused
        ? 'Older messages paused for speed'
        : 'Speed Booster';
    let badge = speed.querySelector('.badge');
    if (boosting) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'badge';
        speed.appendChild(badge);
      }
      badge.textContent = hiddenKnown ? SB.util.compact(st.hidden) : '+';
    } else if (badge) {
      badge.remove();
    }
    dock.querySelector('[data-id="wide"]').setAttribute('aria-pressed', String(s.wideMode));
    dock.querySelector('[data-id="outline"]').setAttribute('aria-pressed', String(SB.outline.isOpen()));
    if (popoverKind === 'speed') renderPopover();
  }

  document.addEventListener(
    'mousedown',
    (event) => {
      if (!popover) return;
      const path = event.composedPath();
      if (!path.includes(popover) && !path.includes(dock)) closePopover();
    },
    true
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (popover && event.key === 'Escape') closePopover();
    },
    true
  );
  window.addEventListener('resize', SB.util.throttle(placePopover, 100));

  SB.on('ready', update);
  SB.on('speed', update);
  SB.on('settings', update);
  SB.on('outline', update);
  SB.on('navigate', closePopover);

  SB.dock = { update, closePopover };
})();
