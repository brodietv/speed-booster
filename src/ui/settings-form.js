/*
 * Binds [data-setting] controls (checkboxes, ranges, numbers, selects) and
 * <output data-for> labels to extension storage. Used by the popup and options page.
 */
(() => {
  'use strict';
  const SB = globalThis.SpeedBooster;

  const FORMATS = {
    width: (v) => (v >= SB.settings.FULL_WIDTH ? 'Full width' : v + 'px'),
    messages: (v) => `${v} message${v === 1 ? '' : 's'}`,
  };

  function format(out, value) {
    const fn = FORMATS[out.dataset.format];
    return fn ? fn(value) : String(value);
  }

  function readValue(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'range' || el.type === 'number') return Number(el.value);
    return el.value;
  }

  async function bind(root, options) {
    const onChange = (options && options.onChange) || (() => {});
    let settings = await SB.settings.load();
    const fields = Array.from(root.querySelectorAll('[data-setting]'));

    function paint() {
      for (const el of fields) {
        const value = settings[el.dataset.setting];
        if (el.type === 'checkbox') el.checked = !!value;
        else if (document.activeElement !== el) el.value = value;
      }
      for (const out of root.querySelectorAll('output[data-for]')) out.textContent = format(out, settings[out.dataset.for]);
      for (const el of root.querySelectorAll('[data-requires]')) {
        el.classList.toggle('disabled', !settings[el.dataset.requires] || !settings.enabled);
      }
    }

    async function commit(el) {
      const key = el.dataset.setting;
      settings = await SB.settings.save({ [key]: readValue(el) });
      paint();
      onChange(key, settings);
    }

    for (const el of fields) {
      el.addEventListener('change', () => commit(el));
      if (el.type === 'range') {
        // Live preview while dragging (e.g. chat width updates in the open ChatGPT tab).
        let timer = null;
        el.addEventListener('input', () => {
          const out = root.querySelector(`output[data-for="${el.dataset.setting}"]`);
          if (out) out.textContent = format(out, Number(el.value));
          clearTimeout(timer);
          timer = setTimeout(() => commit(el), 120);
        });
      }
    }
    SB.settings.onChange((next) => {
      settings = next;
      paint();
    });
    paint();
    return { get: () => settings };
  }

  SB.settingsForm = { bind, format };
})();
