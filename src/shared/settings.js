/**
 * Settings schema shared by the content scripts, popup and options page.
 * Stored in extension storage; a small subset is mirrored into the page's
 * localStorage so the MAIN-world network layer can read it synchronously.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else (root.SpeedBooster = root.SpeedBooster || {}).settings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    enabled: true,
    trimEnabled: true,
    keepMessages: 30,
    loadMoreStep: 30,
    renderBoost: true,
    wideMode: false,
    chatWidth: 1280,
    timestamps: true,
    tokenCounter: true,
    shortcuts: true,
    dockPosition: 'right',
  });

  const RANGES = Object.freeze({
    keepMessages: [2, 500],
    loadMoreStep: [5, 500],
    chatWidth: [720, 2000],
  });

  /** chatWidth at the top of its range means "use the full width". */
  const FULL_WIDTH = RANGES.chatWidth[1];
  const DOCK_POSITIONS = ['right', 'left', 'hidden'];
  const MIRRORED = ['enabled', 'trimEnabled', 'keepMessages'];
  const PAGE_KEY = 'speedBooster:settings';

  function sanitize(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const key of Object.keys(DEFAULTS)) {
      const fallback = DEFAULTS[key];
      const value = input[key];
      if (typeof fallback === 'boolean') {
        out[key] = typeof value === 'boolean' ? value : fallback;
      } else if (typeof fallback === 'number') {
        const n = Number(value);
        const [min, max] = RANGES[key];
        out[key] = Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
      } else if (key === 'dockPosition') {
        out[key] = DOCK_POSITIONS.includes(value) ? value : fallback;
      } else {
        out[key] = value === undefined ? fallback : value;
      }
    }
    return out;
  }

  function ext() {
    if (typeof browser !== 'undefined' && browser && browser.storage) return browser;
    if (typeof chrome !== 'undefined' && chrome && chrome.storage) return chrome;
    return null;
  }

  async function load() {
    const api = ext();
    if (!api) return sanitize({});
    const stored = await api.storage.local.get('settings');
    return sanitize(stored && stored.settings);
  }

  async function save(patch) {
    const api = ext();
    const next = sanitize(Object.assign({}, await load(), patch));
    if (api) await api.storage.local.set({ settings: next });
    return next;
  }

  function onChange(callback) {
    const api = ext();
    if (!api) return;
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) callback(sanitize(changes.settings.newValue));
    });
  }

  function pageSubset(settings) {
    const out = {};
    for (const key of MIRRORED) out[key] = settings[key];
    return out;
  }

  return { DEFAULTS, RANGES, FULL_WIDTH, DOCK_POSITIONS, PAGE_KEY, sanitize, load, save, onChange, pageSubset };
});
