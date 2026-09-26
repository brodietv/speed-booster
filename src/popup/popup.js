/* Speed Booster — toolbar popup: live stats for the open chat and quick settings. */
(() => {
  'use strict';
  const SB = globalThis.SpeedBooster;
  const ext = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;
  const $ = (selector) => document.querySelector(selector);
  const isMac = /mac/i.test(navigator.platform || '');
  const CHATGPT = /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//;
  const RELOAD_KEYS = ['enabled', 'trimEnabled', 'keepMessages'];
  let tab = null;

  const fmt = (n) => Number(n || 0).toLocaleString();
  const compact = (n) => (n < 1000 ? String(n) : n < 1e6 ? Math.round(n / 100) / 10 + 'k' : Math.round(n / 1e5) / 10 + 'M');

  $('#version').textContent = 'v' + ext.runtime.getManifest().version;
  for (const kbd of document.querySelectorAll('kbd[data-key]')) kbd.textContent = (isMac ? '⌥' : 'Alt+') + kbd.dataset.key;

  $('#open-options').addEventListener('click', () => {
    ext.runtime.openOptionsPage();
    window.close();
  });

  $('#reload-apply').addEventListener('click', async () => {
    if (tab) await send({ type: 'sb:reload' }).catch(() => ext.tabs.reload(tab.id));
    window.close();
  });

  SB.settingsForm.bind(document.body, {
    onChange(key) {
      if (RELOAD_KEYS.includes(key) && tab && CHATGPT.test(tab.url || '')) $('#reload-hint').hidden = false;
    },
  });

  function send(message) {
    return Promise.resolve(ext.tabs.sendMessage(tab.id, message));
  }

  const card = $('#chat');
  let cardHtml = '';

  /** Replace the stats card only when its content changes (it refreshes every 2s). */
  function setCard(html) {
    if (html === cardHtml) return;
    cardHtml = html;
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    card.replaceChildren(...doc.body.childNodes);
  }

  card.addEventListener('click', async (event) => {
    const act = event.target.closest('[data-act]');
    const exp = event.target.closest('[data-export]');
    if (event.target.closest('#reload-tab')) {
      ext.tabs.reload(tab.id);
      window.close();
    } else if (act) {
      await send({ type: 'sb:loadMore', amount: act.dataset.act === 'all' ? 'all' : undefined }).catch(() => {});
      window.close();
    } else if (exp) {
      await send({ type: 'sb:export', format: exp.dataset.export }).catch(() => {});
      window.close();
    }
  });

  function renderChat(st) {
    const totalKnown = st.total != null;
    if (!st.conversationId && !st.total) {
      setCard('<div class="empty">Open a conversation to see its stats.</div>');
      return;
    }
    let status;
    if (st.paused) status = '<b>⚡ Boosting</b> — older messages are paused for speed.';
    else if (st.trimmed && st.hidden > 0) status = `<b>⚡ Boosting</b> — ${fmt(st.hidden)} older messages hidden for speed.`;
    else if (st.mode === 'paged' && st.hasMore) status = 'Older messages load as you scroll up.';
    else status = 'This chat is small enough to show in full.';

    const canLoad = st.paused || (st.trimmed && st.hidden > 0);
    setCard(`
      <div class="stats">
        <div class="stat"><b>${fmt(st.kept)}</b><span>${totalKnown ? 'showing' : 'loaded'}</span></div>
        <div class="stat"><b>${totalKnown ? fmt(st.total) : fmt(st.kept) + '+'}</b><span>messages</span></div>
        <div class="stat"><b>${st.tokens != null ? '≈' + compact(st.tokens) : '—'}</b><span>tokens</span></div>
      </div>
      <p class="status">${status}</p>
      ${canLoad ? '<div class="actions"><button class="btn small primary" data-act="more">Load more</button><button class="btn small" data-act="all">Show all</button></div>' : ''}
      <div class="exports"><span>Export</span>
        <button data-export="md">Markdown</button><button data-export="pdf">PDF</button>
        <button data-export="html">HTML</button><button data-export="json">JSON</button>
      </div>`);
  }

  async function refresh() {
    [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (!tab || !CHATGPT.test(tab.url || '')) {
      setCard(
        '<div class="empty"><span>Open ChatGPT to see live stats for your chat.</span>' +
          '<a class="btn small primary" href="https://chatgpt.com/" target="_blank" rel="noopener">Open</a></div>'
      );
      return;
    }
    let st = null;
    try {
      st = await send({ type: 'sb:status' });
    } catch (error) {
      st = null;
    }
    if (!st || !st.ok) {
      setCard(
        '<div class="empty"><span>Reload this tab to start Speed Booster.</span>' +
          '<button class="btn small primary" id="reload-tab">Reload</button></div>'
      );
      return;
    }
    renderChat(st);
  }

  refresh();
  setInterval(refresh, 2000);
})();
