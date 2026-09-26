/* Speed Booster — content-script core: namespace, event bus and small utilities. */
(() => {
  'use strict';
  const SB = (globalThis.SpeedBooster = globalThis.SpeedBooster || {});
  SB.ext = typeof browser !== 'undefined' && browser && browser.runtime ? browser : chrome;
  SB.isMac = /mac|iphone|ipad/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');

  SB.requestRefresh = () => {}; // replaced by main.js once the page is ready

  SB.state = {
    settings: SB.settings.sanitize({}),
    reports: new Map(), // conversationId -> report from the network layer
    conversationId: null,
  };

  const listeners = new Map();
  SB.on = (event, fn) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event).delete(fn);
  };
  SB.emit = (event, data) => {
    for (const fn of listeners.get(event) || []) {
      try {
        fn(data);
      } catch (error) {
        console.error('[Speed Booster]', event, error);
      }
    }
  };

  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const timeCache = { day: '', labels: new Map() };

  SB.util = {
    conversationIdFromUrl(href) {
      const match = /\/c\/([0-9a-f-]{36})/i.exec(new URL(href || location.href).pathname);
      return match && UUID.test(match[1]) ? match[1].toLowerCase() : null;
    },

    currentReport() {
      const id = SB.state.conversationId;
      return (id && SB.state.reports.get(id)) || null;
    },

    throttle(fn, wait) {
      let timer = null;
      let last = 0;
      return function throttled() {
        const remaining = wait - (Date.now() - last);
        if (remaining <= 0) {
          clearTimeout(timer);
          timer = null;
          last = Date.now();
          fn();
        } else if (!timer) {
          timer = setTimeout(() => {
            timer = null;
            last = Date.now();
            fn();
          }, remaining);
        }
      };
    },

    formatNumber(n) {
      return Number(n || 0).toLocaleString();
    },

    compact(n) {
      const v = Number(n || 0);
      if (v < 1000) return String(v);
      if (v < 10000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
      if (v < 1e6) return Math.round(v / 1000) + 'k';
      return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    },

    /** Short, locale-aware timestamp: "14:32", "Mon 14:32", "Mar 3, 14:32" or "Mar 3, 2024". Memoized per day. */
    friendlyTime(seconds) {
      if (!seconds) return '';
      const today = new Date().toDateString();
      if (timeCache.day !== today) {
        timeCache.day = today;
        timeCache.labels.clear();
      }
      let label = timeCache.labels.get(seconds);
      if (label === undefined) {
        label = SB.util.formatTime(seconds);
        timeCache.labels.set(seconds, label);
      }
      return label;
    },

    formatTime(seconds) {
      const date = new Date(seconds * 1000);
      const now = new Date();
      const time = { hour: 'numeric', minute: '2-digit' };
      if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], time);
      const days = (now - date) / 86400000;
      if (days < 6 && days > 0) return date.toLocaleString([], Object.assign({ weekday: 'short' }, time));
      if (date.getFullYear() === now.getFullYear()) {
        return date.toLocaleString([], Object.assign({ month: 'short', day: 'numeric' }, time));
      }
      return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    },

    shortcutLabel(key) {
      return (SB.isMac ? '⌥' : 'Alt+') + key;
    },

    download(filename, text, mime) {
      const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.documentElement.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    },

    async copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.documentElement.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
      }
    },

    isEditable(el) {
      return !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|range|color|file)$/i.test(el.type)));
    },
  };

  /**
   * Hand the settings the MAIN-world network layer needs to it: directly (so the
   * first load of a tab uses fresh values) and via localStorage (read synchronously
   * on the next page load, before this script's async storage read finishes).
   */
  SB.mirrorSettings = () => {
    const subset = SB.settings.pageSubset(SB.state.settings);
    try {
      localStorage.setItem(SB.settings.PAGE_KEY, JSON.stringify(subset));
    } catch (error) {
      /* storage blocked — network layer falls back to defaults */
    }
    if (SB.bridge) SB.bridge.send('settings', subset);
  };

  const KEEP_PREFIX = 'speedBooster:keep:';
  const JUMP_KEY = 'speedBooster:jumpTo';

  /**
   * Classic loader: reload the chat with `keep` turns rendered ('all' for
   * everything), optionally scrolling to a message once it appears.
   */
  SB.reloadWithHistory = (keep, jumpId) => {
    const id = SB.state.conversationId;
    if (!id) return;
    try {
      sessionStorage.setItem(KEEP_PREFIX + id, keep === 'all' ? 'all' : String(Math.max(1, Math.ceil(keep))));
      if (jumpId) sessionStorage.setItem(JUMP_KEY, JSON.stringify({ id: jumpId, conversationId: id }));
    } catch (error) {
      /* ignore */
    }
    location.reload();
  };

  SB.takePendingJump = () => {
    try {
      const raw = sessionStorage.getItem(JUMP_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(JUMP_KEY);
      const jump = JSON.parse(raw);
      return jump && jump.conversationId === SB.state.conversationId ? jump : null;
    } catch (error) {
      return null;
    }
  };

  SB.resetKeepOverride = () => {
    try {
      if (SB.state.conversationId) sessionStorage.removeItem(KEEP_PREFIX + SB.state.conversationId);
    } catch (error) {
      /* ignore */
    }
  };
})();
