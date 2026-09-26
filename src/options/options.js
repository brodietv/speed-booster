/* Speed Booster — options page: settings, prompt library manager, shortcuts, help. */
(() => {
  'use strict';
  const SB = globalThis.SpeedBooster;
  const ext = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;
  const $ = (selector) => document.querySelector(selector);
  const isMac = /mac/i.test(navigator.platform || '');
  const TABS = ['settings', 'prompts', 'shortcuts', 'about'];

  $('#version').textContent = 'v' + ext.runtime.getManifest().version;
  for (const kbd of document.querySelectorAll('kbd[data-key]')) kbd.textContent = (isMac ? '⌥' : 'Alt+') + kbd.dataset.key;
  for (const kbd of document.querySelectorAll('kbd[data-mod]')) kbd.textContent = (isMac ? '⌘' : 'Ctrl+') + kbd.dataset.mod;
  $('#mac-note').hidden = !isMac;

  function showTab() {
    let name = location.hash.slice(1);
    if (name === 'welcome') {
      $('#welcome-banner').hidden = false;
      name = 'settings';
    }
    if (!TABS.includes(name)) name = 'settings';
    for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== name;
    for (const tab of document.querySelectorAll('[data-tab]')) tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  }
  window.addEventListener('hashchange', showTab);
  showTab();

  let toastTimer = null;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2600);
  }

  /* ---------- Settings ---------- */

  SB.settingsForm.bind($('#panel-settings'));
  $('#reset-settings').addEventListener('click', async () => {
    if (!confirm('Reset all Speed Booster settings to their defaults? Your prompts are kept.')) return;
    await ext.storage.local.set({ settings: SB.settings.sanitize({}) });
    toast('Settings reset to defaults');
  });

  /* ---------- Prompt library ---------- */

  const dialog = $('#prompt-dialog');
  let prompts = [];
  let editing = null;

  function renderPrompt(prompt) {
    const el = document.createElement('article');
    el.className = 'prompt';
    el.tabIndex = 0;
    el.dataset.id = prompt.id;
    el.innerHTML = '<div class="text"><h3></h3><p></p><div class="chips"></div></div><div class="meta"></div>';
    el.querySelector('h3').textContent = prompt.title;
    el.querySelector('p').textContent = prompt.body;
    el.querySelector('.chips').append(
      ...SB.prompts.variables(prompt.body).map((v) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = `{{${v.name}}}`;
        return chip;
      })
    );
    el.querySelector('.meta').textContent = prompt.uses ? `Used ${prompt.uses}×` : '';
    el.addEventListener('click', () => openEditor(prompt));
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') openEditor(prompt);
    });
    return el;
  }

  function renderPrompts() {
    const query = $('#prompt-search').value.trim().toLowerCase();
    const list = $('#prompt-list');
    const shown = prompts.filter((p) => !query || `${p.title}\n${p.body}`.toLowerCase().includes(query));
    if (!prompts.length) {
      list.innerHTML = '<div class="empty-state">No prompts yet. Create one, or restore the starter prompts below.</div>';
    } else if (!shown.length) {
      list.innerHTML = '<div class="empty-state">No prompts match your search.</div>';
    } else {
      list.replaceChildren(...shown.map(renderPrompt));
    }
  }

  async function loadPrompts() {
    prompts = await SB.prompts.load();
    renderPrompts();
  }

  function updateVariables() {
    const vars = SB.prompts.variables($('#prompt-body').value);
    $('#prompt-vars').textContent = vars.length
      ? 'Fill-in blanks: ' + vars.map((v) => v.name + (v.fallback ? ` (default “${v.fallback}”)` : '')).join(', ')
      : '';
  }

  function openEditor(prompt) {
    editing = prompt ? prompt.id : null;
    $('#prompt-dialog-title').textContent = prompt ? 'Edit prompt' : 'New prompt';
    $('#prompt-title').value = prompt ? prompt.title : '';
    $('#prompt-body').value = prompt ? prompt.body : '';
    $('#prompt-delete').hidden = !prompt;
    updateVariables();
    dialog.showModal();
    (prompt ? $('#prompt-body') : $('#prompt-title')).focus();
  }

  $('#prompt-body').addEventListener('input', updateVariables);
  $('#prompt-new').addEventListener('click', () => openEditor(null));
  $('#prompt-cancel').addEventListener('click', () => dialog.close());
  $('#prompt-search').addEventListener('input', renderPrompts);

  $('#prompt-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = $('#prompt-title').value.trim();
    const body = $('#prompt-body').value;
    if (!body.trim()) {
      $('#prompt-body').focus();
      return;
    }
    const existing = editing && prompts.find((p) => p.id === editing);
    if (existing) {
      existing.title = title || existing.title;
      existing.body = body;
    } else {
      prompts.unshift(SB.prompts.sanitizePrompt({ title, body }));
    }
    prompts = await SB.prompts.save(prompts);
    dialog.close();
    renderPrompts();
    toast(existing ? 'Prompt saved' : 'Prompt added');
  });

  $('#prompt-delete').addEventListener('click', async () => {
    if (!editing || !confirm('Delete this prompt?')) return;
    prompts = await SB.prompts.save(prompts.filter((p) => p.id !== editing));
    dialog.close();
    renderPrompts();
    toast('Prompt deleted');
  });

  $('#prompt-export').addEventListener('click', () => {
    const data = {
      app: 'speed-booster',
      version: 1,
      exported: new Date().toISOString(),
      prompts: prompts.map(({ title, body }) => ({ title, body })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'speed-booster-prompts.json' });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });

  $('#prompt-import').addEventListener('click', () => $('#prompt-file').click());
  $('#prompt-file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = SB.prompts.sanitizeList(Array.isArray(parsed) ? parsed : parsed && parsed.prompts);
      const existing = new Set(prompts.map((p) => p.title + '\u0000' + p.body));
      const fresh = incoming
        .filter((p) => !existing.has(p.title + '\u0000' + p.body))
        .map((p) => Object.assign(p, { id: SB.prompts.makeId(), uses: 0, lastUsed: 0 }));
      prompts = await SB.prompts.save(prompts.concat(fresh));
      renderPrompts();
      toast(fresh.length ? `Imported ${fresh.length} prompt${fresh.length === 1 ? '' : 's'}` : 'Nothing new to import');
    } catch (error) {
      toast("That file isn't a valid prompt export");
    }
  });

  $('#prompt-restore').addEventListener('click', async () => {
    const ids = new Set(prompts.map((p) => p.id));
    const missing = SB.prompts.starters().filter((p) => !ids.has(p.id));
    prompts = await SB.prompts.save(prompts.concat(missing));
    renderPrompts();
    toast(
      missing.length
        ? `Restored ${missing.length} starter prompt${missing.length === 1 ? '' : 's'}`
        : 'All starter prompts are already in your library'
    );
  });

  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.prompts && !dialog.open) loadPrompts();
  });
  loadPrompts();
})();
