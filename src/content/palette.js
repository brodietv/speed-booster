/*
 * Speed Booster — command palette (Alt/⌥+K) and prompt library (Alt/⌥+P).
 * Prompts support {{variables}} with an inline fill-in form, and
 * Ctrl/⌘+Enter inserts and sends in one go.
 */
(() => {
  'use strict';
  const SB = globalThis.SpeedBooster;
  const MAX_RESULTS = 60;

  let overlay = null;
  let box = null;
  let input = null;
  let results = null;
  let mode = 'all';
  let items = [];
  let selected = 0;
  let prompts = [];
  let savedSelection = '';

  const mod = () => (SB.isMac ? '⌘' : 'Ctrl');

  /** Substring matches win; otherwise an in-order fuzzy match. Returns -1 for no match. */
  function score(query, text) {
    const q = query.toLowerCase();
    const t = String(text || '').toLowerCase();
    if (!q) return 0;
    const at = t.indexOf(q);
    if (at >= 0) return 1000 - at + (at === 0 || /[\s\-_/(]/.test(t[at - 1]) ? 200 : 0);
    let from = 0;
    let total = 0;
    let streak = 0;
    for (const ch of q) {
      if (ch === ' ') continue;
      const found = t.indexOf(ch, from);
      if (found < 0) return -1;
      streak = found === from ? streak + 1 : 0;
      total += 10 + streak * 6 - Math.min(9, found - from);
      from = found + 1;
    }
    return total;
  }

  function actionItems() {
    const st = SB.speed.status();
    const s = SB.state.settings;
    const hiddenKnown = st.hidden > 0;
    const step = hiddenKnown ? Math.min(s.loadMoreStep, st.hidden) : s.loadMoreStep;
    const list = [];
    if (st.paused || (st.trimmed && hiddenKnown)) {
      list.push({
        title: `Load ${step} older messages`,
        sub: hiddenKnown ? `${SB.util.formatNumber(st.hidden)} are hidden for speed` : 'Older messages are paused for speed',
        icon: 'history',
        run: () => SB.speed.loadMore(),
      });
      list.push({
        title: 'Show the entire conversation',
        sub: st.total != null ? `Renders all ${SB.util.formatNumber(st.total)} messages (slower)` : 'Loads all older messages (slower)',
        icon: 'history',
        run: () => SB.speed.loadMore('all'),
      });
    }
    list.push(
      { title: 'Outline & search this chat', icon: 'outline', key: 'J', run: () => SB.outline.toggle(true) },
      { title: 'Browse prompt library', icon: 'sparkles', key: 'P', keepOpen: true, run: () => setMode('prompts') },
      { title: s.wideMode ? 'Turn off wide mode' : 'Turn on wide mode', icon: 'wide', key: 'W', run: SB.actions.toggleWide },
      { title: 'Export chat as Markdown', sub: 'Full conversation, including hidden messages', icon: 'file', run: () => SB.exporter.run('md') },
      { title: 'Export chat as PDF', sub: 'Opens a clean print view', icon: 'file', run: () => SB.exporter.run('pdf') },
      { title: 'Export chat as a web page', sub: '.html file', icon: 'file', run: () => SB.exporter.run('html') },
      { title: 'Export chat as JSON', icon: 'braces', run: () => SB.exporter.run('json') },
      { title: 'Export chat as plain text', icon: 'file', run: () => SB.exporter.run('txt') },
      { title: 'Copy chat as Markdown', icon: 'copy', run: () => SB.exporter.run('copy') },
      { title: 'Jump to previous prompt', icon: 'top', key: '↑', run: () => SB.actions.jumpPrompt(-1) },
      { title: 'Jump to next prompt', icon: 'bottom', key: '↓', run: () => SB.actions.jumpPrompt(1) },
      { title: 'Scroll to top', icon: 'top', run: SB.actions.scrollTop },
      { title: 'Scroll to bottom', icon: 'bottom', run: SB.actions.scrollBottom },
      { title: s.timestamps ? 'Hide timestamps' : 'Show timestamps', icon: 'clock', run: SB.actions.toggleTimestamps },
      { title: 'Summarize chat to continue in a new one', sub: 'Inserts a hand-off summary prompt', icon: 'sparkles', run: SB.actions.insertSummaryPrompt },
      { title: 'Save composer text as a prompt', icon: 'plus', keepOpen: true, run: showSaveForm },
      { title: 'Manage prompt library', sub: 'Opens Speed Booster settings', icon: 'book', run: SB.actions.openOptions },
      { title: 'Speed Booster settings', icon: 'settings', run: SB.actions.openOptions }
    );
    return list.map((a) => Object.assign({ type: 'action' }, a));
  }

  function promptItems() {
    return prompts.map((p) => ({
      type: 'prompt',
      title: p.title,
      sub: p.body.replace(/\s+/g, ' ').slice(0, 140),
      icon: 'sparkles',
      prompt: p,
    }));
  }

  function filtered(query) {
    const groups = [];
    const rank = (list, weightSub) =>
      list
        .map((item) => {
          const s = Math.max(score(query, item.title), weightSub ? score(query, item.sub) * 0.6 : -1);
          return { item, s };
        })
        .filter((x) => !query || x.s >= 0)
        .sort((a, b) => (query ? b.s - a.s : 0))
        .map((x) => x.item);

    if (mode === 'prompts') {
      groups.push({ label: 'Prompts', items: rank(promptItems(), true) });
      const extras = [
        { type: 'action', title: 'Save composer text as a prompt', icon: 'plus', keepOpen: true, run: showSaveForm },
        { type: 'action', title: 'Manage prompt library', icon: 'book', run: SB.actions.openOptions },
      ];
      groups.push({ label: 'Library', items: rank(extras, false) });
    } else {
      const actions = rank(actionItems(), true);
      const promptList = rank(promptItems(), true);
      const order = query && promptList.length && (!actions.length || score(query, promptList[0].title) > score(query, actions[0].title));
      const a = { label: 'Actions', items: actions };
      const p = { label: 'Prompts', items: promptList };
      groups.push(...(order ? [p, a] : [a, p]));
    }
    return groups.filter((g) => g.items.length);
  }

  function renderResults() {
    const query = input.value.trim();
    const groups = filtered(query);
    items = [];
    const html = [];
    for (const group of groups) {
      html.push(`<div class="section-label">${group.label}</div>`);
      for (const item of group.items) {
        if (items.length >= MAX_RESULTS) break;
        const i = items.push(item) - 1;
        const hint =
          item.type === 'prompt'
            ? `<span class="hint"><kbd>↵</kbd></span>`
            : item.key
              ? `<span class="hint"><kbd>${SB.util.shortcutLabel(item.key)}</kbd></span>`
              : '';
        html.push(
          `<div class="row" data-i="${i}" role="option">` +
            `<span class="glyph">${SB.ui.icon(item.icon)}</span>` +
            `<span class="copy"><div class="title">${SB.ui.escape(item.title)}</div>` +
            (item.sub ? `<div class="sub">${SB.ui.escape(item.sub)}</div>` : '') +
            `</span>${hint}</div>`
        );
      }
    }
    if (!items.length) html.push('<div class="empty">No matches</div>');
    results.innerHTML = html.join('');
    select(0);
  }

  function select(index) {
    if (!items.length) return;
    selected = (index + items.length) % items.length;
    const prev = results.querySelector('.row.selected');
    if (prev) prev.classList.remove('selected');
    const row = results.querySelector(`.row[data-i="${selected}"]`);
    if (row) {
      row.classList.add('selected');
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  function footer(html) {
    box.querySelector('footer').innerHTML = html;
  }

  function searchFooter() {
    footer(
      `<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> ${mode === 'prompts' ? 'insert' : 'run'}</span>` +
        `<span><kbd>${mod()}</kbd><kbd>↵</kbd> insert &amp; send</span><span><kbd>esc</kbd> close</span>`
    );
  }

  function setMode(next) {
    mode = next;
    box.querySelector('.mode').textContent = mode === 'prompts' ? 'Prompts' : 'Commands';
    input.placeholder = mode === 'prompts' ? 'Search your prompts…' : 'Type a command or search prompts…';
    input.value = '';
    showSearch();
  }

  function showSearch() {
    box.querySelector('.input-row').classList.remove('hidden');
    box.querySelector('.form-host').innerHTML = '';
    results.classList.remove('hidden');
    searchFooter();
    renderResults();
    input.focus();
  }

  function run(item, sendNow) {
    if (!item) return;
    if (item.type === 'prompt') {
      usePrompt(item.prompt, sendNow);
      return;
    }
    if (!item.keepOpen) close(false);
    item.run();
  }

  function usePrompt(prompt, sendNow) {
    const vars = SB.prompts.variables(prompt.body);
    if (vars.length) showVariableForm(prompt, vars, sendNow);
    else finishPrompt(prompt, {}, sendNow);
  }

  async function finishPrompt(prompt, values, sendNow) {
    const now = new Date();
    const text = SB.prompts.fill(prompt.body, values, {
      selection: savedSelection,
      date: now.toLocaleDateString(),
      time: now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    });
    close(false);
    SB.prompts.recordUse(prompt.id).catch(() => {});
    if (!SB.chatgpt.insert(text)) {
      await SB.util.copyText(text);
      SB.ui.toast('Composer not found — prompt copied to clipboard', 'error');
      return;
    }
    if (sendNow && !(await SB.chatgpt.send())) SB.ui.toast('Press Enter to send', 'error');
  }

  function formShell(title, inner) {
    box.querySelector('.input-row').classList.add('hidden');
    results.classList.add('hidden');
    const host = box.querySelector('.form-host');
    host.innerHTML = `<form class="form" novalidate><h4>${SB.ui.escape(title)}</h4>${inner}</form>`;
    return host.querySelector('form');
  }

  function showVariableForm(prompt, vars, sendNow) {
    const multiline = (name) =>
      /^(text|code|error|content|input|notes|context|article|email|data|essay|draft)$/i.test(name) ||
      new RegExp('(^|\\n)\\s*\\{\\{\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(:[^}]*)?\\}\\}\\s*(\\n|$)').test(prompt.body);
    const fields = vars
      .map((v, i) => {
        const id = 'sb-var-' + i;
        const attrs = `id="${id}" data-name="${SB.ui.escape(v.name)}" placeholder="${SB.ui.escape(v.fallback || '')}"`;
        const control = multiline(v.name) ? `<textarea ${attrs} rows="4"></textarea>` : `<input ${attrs} type="text" autocomplete="off">`;
        return `<div class="field"><label for="${id}">${SB.ui.escape(v.name)}</label>${control}</div>`;
      })
      .join('');
    const form = formShell(
      prompt.title,
      `<pre class="preview">${SB.ui.escape(prompt.body)}</pre>${fields}` +
        `<div class="actions"><button type="button" class="btn" data-act="back">Back</button>` +
        `<button type="button" class="btn" data-act="insert">Insert</button>` +
        `<button type="submit" class="btn primary">${SB.ui.icon('send')} Insert &amp; send</button></div>`
    );
    footer(`<span><kbd>↵</kbd> next field</span><span><kbd>${mod()}</kbd><kbd>↵</kbd> insert &amp; send</span><span><kbd>esc</kbd> back</span>`);

    const values = () => {
      const out = {};
      form.querySelectorAll('[data-name]').forEach((el) => (out[el.dataset.name] = el.value));
      return out;
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      finishPrompt(prompt, values(), true);
    });
    form.addEventListener('click', (event) => {
      const act = event.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'back') showSearch();
      else finishPrompt(prompt, values(), false);
    });
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        showSearch();
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        finishPrompt(prompt, values(), true);
      } else if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
        event.preventDefault();
        const controls = Array.from(form.querySelectorAll('[data-name]'));
        const next = controls[controls.indexOf(event.target) + 1];
        if (next) next.focus();
        else finishPrompt(prompt, values(), sendNow);
      }
    });
    const first = form.querySelector('[data-name]');
    if (first) first.focus();
  }

  function showSaveForm() {
    const body = SB.chatgpt.composerText();
    const form = formShell(
      'Save as prompt',
      `<div class="field"><label for="sb-save-title">Title</label><input id="sb-save-title" type="text" autocomplete="off" placeholder="e.g. Weekly report"></div>` +
        `<div class="field"><label for="sb-save-body">Prompt — use {{name}} for fill-in blanks</label><textarea id="sb-save-body" rows="7"></textarea></div>` +
        `<div class="actions"><button type="button" class="btn" data-act="back">Back</button><button type="submit" class="btn primary">Save prompt</button></div>`
    );
    footer(`<span><kbd>${mod()}</kbd><kbd>↵</kbd> save</span><span><kbd>esc</kbd> back</span>`);
    const title = form.querySelector('#sb-save-title');
    const text = form.querySelector('#sb-save-body');
    text.value = body;
    const save = async () => {
      if (!text.value.trim()) {
        text.focus();
        return;
      }
      const list = await SB.prompts.load();
      list.unshift(
        SB.prompts.sanitizePrompt({ title: title.value.trim(), body: text.value, lastUsed: Date.now(), uses: 1 })
      );
      await SB.prompts.save(list);
      close(true);
      SB.ui.toast('Prompt saved — find it with ' + SB.util.shortcutLabel('P'));
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      save();
    });
    form.addEventListener('click', (event) => {
      if (event.target.closest('[data-act="back"]')) showSearch();
    });
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        showSearch();
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        save();
      }
    });
    (body ? title : text).focus();
  }

  function build() {
    overlay = SB.ui.el(`
      <div class="overlay">
        <div class="palette" role="dialog" aria-label="Speed Booster command palette">
          <div class="input-row">
            ${SB.ui.icon('search')}
            <input type="text" spellcheck="false" autocomplete="off" aria-label="Search commands and prompts">
            <span class="mode"></span>
          </div>
          <div class="form-host"></div>
          <div class="results" role="listbox"></div>
          <footer></footer>
        </div>
      </div>`);
    box = overlay.querySelector('.palette');
    input = overlay.querySelector('.input-row input');
    results = overlay.querySelector('.results');

    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close(true);
    });
    input.addEventListener('input', renderResults);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        select(selected + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        select(selected - 1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        run(items[selected], event.metaKey || event.ctrlKey);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        if (input.value) {
          input.value = '';
          renderResults();
        } else {
          close(true);
        }
      } else if (event.key === 'Backspace' && !input.value && mode === 'prompts') {
        setMode('all');
      }
    });
    results.addEventListener('mousemove', (event) => {
      const row = event.target.closest('.row');
      if (row && Number(row.dataset.i) !== selected) select(Number(row.dataset.i));
    });
    results.addEventListener('click', (event) => {
      const row = event.target.closest('.row');
      if (row) run(items[Number(row.dataset.i)], event.metaKey || event.ctrlKey);
    });
    SB.ui.root().appendChild(overlay);
  }

  async function open(nextMode) {
    const wanted = nextMode === 'prompts' ? 'prompts' : 'all';
    if (overlay && mode === wanted) {
      close(true);
      return;
    }
    if (!SB.ui.root()) return;
    savedSelection = String(window.getSelection() || '').trim(); // for {{selection}}
    if (!overlay) SB.chatgpt.rememberCaret();
    prompts = SB.prompts.rank(await SB.prompts.load());
    if (!overlay) build();
    setMode(wanted);
  }

  function close(refocus) {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    if (refocus) {
      const composer = SB.chatgpt.composer();
      if (composer) composer.focus();
    }
  }

  SB.on('navigate', () => close(false));
  SB.palette = { open, close, isOpen: () => !!overlay, score };
})();
