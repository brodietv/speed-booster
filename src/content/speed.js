/*
 * Speed Booster — speed status, the "older messages hidden" pill, loading more
 * history (reload for the classic loader, resume for the paged loader), and a
 * DOM fallback that collapses old turns if the network layer ever can't trim.
 */
(() => {
  'use strict';
  const SB = globalThis.SpeedBooster;
  const GRACE_MS = 1500;
  const SEEK_TIMEOUT_MS = 25000;

  let collapsed = [];
  let fallback = null; // { total, hidden } while the DOM fallback is active
  let decided = false;
  let firstSeenAt = 0;
  let pill = null;
  let dismissedFor = null;
  let lastTurnCount = 0;
  let lastStatus = null;
  let seeking = null;

  function status() {
    const report = SB.util.currentReport();
    if (report) {
      const live = Math.max(0, lastTurnCount - report.kept);
      return {
        mode: report.mode === 'paged' ? 'paged' : 'tree',
        conversationId: report.conversationId,
        title: report.title,
        total: report.total == null ? null : report.total + live,
        kept: report.kept + live,
        hidden: report.hidden, // null when unknown (paged loader with more history)
        trimmed: !!report.trimmed,
        paused: !!report.paused,
        hasMore: !!report.hasMore,
        tokens: report.tokens,
      };
    }
    const base = { conversationId: SB.state.conversationId, paused: false, hasMore: false, tokens: null };
    if (fallback) {
      return Object.assign(base, {
        mode: 'dom',
        total: fallback.total,
        kept: fallback.total - fallback.hidden,
        hidden: fallback.hidden,
        trimmed: fallback.hidden > 0,
      });
    }
    return Object.assign(base, { mode: 'none', total: lastTurnCount, kept: lastTurnCount, hidden: 0, trimmed: false });
  }

  function revealDom(amount) {
    const count = amount === 'all' ? collapsed.length : Math.min(collapsed.length, amount);
    for (const el of collapsed.splice(collapsed.length - count, count)) el.removeAttribute('data-sb-collapsed');
    fallback.hidden = collapsed.length;
    update();
  }

  async function releaseOlder(conversationId, amount) {
    try {
      return Number(await SB.bridge.request('releaseOlder', { conversationId, amount }, 5000)) || 0;
    } catch (error) {
      return 0;
    }
  }

  /** Show `amount` more older messages, or 'all'. */
  async function loadMore(amount) {
    const step = amount || SB.state.settings.loadMoreStep;
    const report = SB.util.currentReport();
    if (fallback && fallback.hidden > 0) {
      revealDom(step);
    } else if (report && report.mode === 'paged') {
      // Resume paused history in place; if nothing was paused, nudge ChatGPT's own pager.
      const released = await releaseOlder(report.conversationId, step);
      if (!released) SB.actions.scrollTop();
    } else if (report && report.trimmed) {
      SB.reloadWithHistory(step === 'all' ? 'all' : report.kept + step >= report.total ? 'all' : report.kept + step);
    }
  }

  /**
   * Scroll to a turn, then keep it aligned for a few seconds: ChatGPT pins
   * freshly loaded chats to the bottom and virtualized turns above change height
   * as they render. Any wheel/touch/key/click from the user ends the correction.
   */
  function landOn(el) {
    SB.actions.reveal(el);
    const events = ['wheel', 'touchmove', 'keydown', 'mousedown'];
    let cancelled = false;
    const cancel = () => (cancelled = true);
    for (const type of events) window.addEventListener(type, cancel, { capture: true, passive: true });
    for (const delay of [400, 1000, 1800, 3000]) {
      setTimeout(() => {
        if (cancelled || !el.isConnected) return;
        const scroller = SB.chatgpt.scroller();
        const top = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
        if (Math.abs(el.getBoundingClientRect().top - top) > 24) el.scrollIntoView({ block: 'start' });
      }, delay);
    }
    setTimeout(() => {
      for (const type of events) window.removeEventListener(type, cancel, { capture: true });
    }, 3100);
  }

  function seekStep() {
    if (!seeking) return;
    const el = SB.chatgpt.findTurn(seeking.id);
    if (el) {
      seeking = null;
      landOn(el);
      return;
    }
    if (seeking.passive) {
      // After a reload: just wait for the message to render.
      if (Date.now() > seeking.until) seeking = null;
      return;
    }
    const report = SB.util.currentReport();
    if (Date.now() > seeking.until || (report && !report.hasMore && !report.paused)) {
      seeking = null;
      SB.ui.toast("Couldn't reach that message — try loading all messages", 'error');
      return;
    }
    const scroller = SB.chatgpt.scroller();
    scroller.scrollTop = 0; // ChatGPT fetches the next older page when its top sentinel is visible
    setTimeout(seekStep, 700);
  }

  /**
   * Bring a message that isn't loaded into view. `fromEnd` = how many turns
   * from that message to the end of the chat (inclusive).
   */
  async function reach(id, fromEnd) {
    const existing = SB.chatgpt.findTurn(id);
    const report = SB.util.currentReport();
    if (existing && !existing.closest('[data-sb-collapsed]')) {
      SB.actions.reveal(existing);
    } else if (fallback && fallback.hidden) {
      revealDom('all');
      SB.actions.reveal(SB.chatgpt.findTurn(id));
    } else if (report && report.mode === 'paged') {
      const needed = Math.max(SB.state.settings.loadMoreStep, fromEnd - report.kept + 2);
      SB.ui.toast('Loading older messages…');
      await releaseOlder(report.conversationId, needed);
      seeking = { id, until: Date.now() + SEEK_TIMEOUT_MS };
      seekStep();
    } else if (report) {
      SB.ui.toast('Loading older messages…');
      SB.reloadWithHistory(fromEnd + 2 >= (report.total || Infinity) ? 'all' : fromEnd + 2, id);
    }
  }

  function reset() {
    for (const el of collapsed) el.removeAttribute('data-sb-collapsed');
    collapsed = [];
    fallback = null;
    decided = false;
    firstSeenAt = 0;
    lastTurnCount = 0;
    seeking = null;
    update();
  }

  function maybeCollapse(turns) {
    if (decided || !turns.length) return;
    if (!firstSeenAt) firstSeenAt = Date.now();
    // Current ChatGPT virtualizes turns itself; the network layer handles the rest.
    if (SB.util.currentReport() || SB.chatgpt.isVirtualized()) {
      decided = true;
      return;
    }
    if (Date.now() - firstSeenAt < GRACE_MS) {
      // The page may go quiet before the grace period ends; check again afterwards.
      setTimeout(SB.requestRefresh, GRACE_MS + 50);
      return;
    }
    decided = true;
    const s = SB.state.settings;
    if (!s.enabled || !s.trimEnabled || turns.length <= s.keepMessages + 4) return;
    let first = turns.length - s.keepMessages;
    if (turns[first].role !== 'user' && first > 0) first--;
    collapsed = turns.slice(0, first).map((t) => t.el);
    for (const el of collapsed) el.setAttribute('data-sb-collapsed', '');
    fallback = { total: turns.length, hidden: collapsed.length };
  }

  function nearTop() {
    const scroller = SB.chatgpt.scroller();
    if (!scroller) return true;
    return scroller.scrollTop < 360 || scroller.scrollHeight <= scroller.clientHeight + 4;
  }

  function renderPill(st) {
    const root = SB.ui.root();
    if (!root) return;
    const hiddenKnown = st.hidden > 0;
    const show =
      SB.state.settings.enabled &&
      (st.paused || (st.trimmed && hiddenKnown)) &&
      dismissedFor !== SB.state.conversationId &&
      nearTop();
    if (!show) {
      if (pill) pill.classList.add('hidden');
      return;
    }
    if (!pill) {
      pill = SB.ui.el(`
        <div class="pill" role="status">
          ${SB.ui.icon('zap')}
          <span class="label"></span>
          <button class="btn primary" data-act="more"></button>
          <button class="btn" data-act="all"></button>
          <button class="icon-btn" data-act="dismiss" aria-label="Dismiss">${SB.ui.icon('close')}</button>
        </div>`);
      pill.addEventListener('click', (event) => {
        const act = event.target.closest('[data-act]');
        if (!act) return;
        if (act.dataset.act === 'more') loadMore();
        else if (act.dataset.act === 'all') loadMore('all');
        else {
          dismissedFor = SB.state.conversationId;
          pill.classList.add('hidden');
        }
      });
      root.appendChild(pill);
    }
    const stepSetting = SB.state.settings.loadMoreStep;
    const step = hiddenKnown ? Math.min(stepSetting, st.hidden) : stepSetting;
    pill.querySelector('.label').textContent = hiddenKnown
      ? `${SB.util.formatNumber(st.hidden)} older message${st.hidden === 1 ? '' : 's'} hidden for speed`
      : 'Older messages paused for speed';
    const more = pill.querySelector('[data-act="more"]');
    more.textContent = `Load ${step} more`;
    more.classList.toggle('hidden', hiddenKnown && step >= st.hidden);
    pill.querySelector('[data-act="all"]').textContent = hiddenKnown ? 'Show all' : 'Load all';
    const scroller = SB.chatgpt.scroller();
    const rect = scroller && scroller !== document.scrollingElement ? scroller.getBoundingClientRect() : null;
    pill.style.left = rect && rect.width ? `${Math.round(rect.left + rect.width / 2)}px` : '50%';
    pill.style.top = `${Math.max(56, Math.round(rect ? rect.top + 12 : 64))}px`;
    pill.classList.remove('hidden');
  }

  function update() {
    lastStatus = status();
    renderPill(lastStatus);
    SB.emit('speed', lastStatus);
  }

  SB.on('ready', () => {
    const jump = SB.takePendingJump();
    if (jump) seeking = { id: jump.id, until: Date.now() + 15000, passive: true };
  });
  SB.on('refresh', (snapshot) => {
    lastTurnCount = snapshot.turns.length;
    maybeCollapse(snapshot.turns);
    if (seeking && seeking.passive) seekStep();
    update();
  });
  SB.on('navigate', reset);
  SB.on('report', update);
  SB.on('settings', update);

  document.addEventListener(
    'scroll',
    SB.util.throttle(() => lastStatus && (lastStatus.trimmed || lastStatus.paused) && renderPill(lastStatus), 120),
    { capture: true, passive: true }
  );

  SB.speed = { status, loadMore, reach, update };
})();
