/* Speed Booster — content-script bootstrap: settings, lifecycle, refresh loop, popup messages. */
(() => {
  'use strict';
  const SB = globalThis.SpeedBooster;

  function checkNavigation() {
    const id = SB.util.conversationIdFromUrl();
    if (id === SB.state.conversationId) return false;
    SB.state.conversationId = id;
    SB.emit('navigate', id);
    return true;
  }

  function snapshot() {
    return { turns: SB.chatgpt.turns(), messages: SB.chatgpt.messages() };
  }

  function refresh() {
    if (!SB.ui.isMounted()) SB.ui.mount();
    SB.pageStyle.ensureAttached();
    checkNavigation();
    SB.emit('refresh', snapshot());
  }

  function onMessage(msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('sb:')) return undefined;
    switch (msg.type) {
      case 'sb:status':
        sendResponse(Object.assign({ ok: true, url: location.href }, SB.speed.status()));
        break;
      case 'sb:loadMore':
        sendResponse({ ok: true });
        setTimeout(() => SB.speed.loadMore(msg.amount), 0);
        break;
      case 'sb:reload':
        sendResponse({ ok: true });
        SB.resetKeepOverride();
        setTimeout(() => location.reload(), 0);
        break;
      case 'sb:export':
        SB.exporter.run(msg.format);
        sendResponse({ ok: true });
        break;
      case 'sb:palette':
        SB.palette.open(msg.mode);
        sendResponse({ ok: true });
        break;
      default:
        return undefined;
    }
    return undefined;
  }

  async function start() {
    SB.state.conversationId = SB.util.conversationIdFromUrl();
    try {
      SB.state.settings = await SB.settings.load();
    } catch (error) {
      console.warn('[Speed Booster] Using default settings', error);
    }
    SB.state.settingsLoaded = true;
    SB.mirrorSettings();
    SB.pageStyle.apply();
    SB.settings.onChange((next) => {
      SB.state.settings = next;
      SB.mirrorSettings();
      SB.pageStyle.apply();
      SB.emit('settings', next);
    });
    SB.ext.runtime.onMessage.addListener(onMessage);

    if (document.readyState === 'loading') {
      await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }
    SB.ui.mount();
    SB.emit('ready');

    const schedule = SB.util.throttle(refresh, 350);
    SB.requestRefresh = schedule;
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    setInterval(() => {
      if (checkNavigation()) schedule();
    }, 600);
    refresh();
  }

  start().catch((error) => console.error('[Speed Booster] Failed to start', error));
})();
