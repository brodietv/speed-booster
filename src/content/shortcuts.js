/*
 * Speed Booster — keyboard shortcuts. Alt (⌥ on Mac) + key, matched by physical
 * key so layouts and ⌥-characters don't matter. Chosen to avoid ChatGPT's own
 * shortcuts and browser menus (Alt+D/E/F etc.).
 */
(() => {
  'use strict';
  const SB = globalThis.SpeedBooster;

  const KEYS = {
    KeyK: () => SB.palette.open('all'),
    KeyP: () => SB.palette.open('prompts'),
    KeyJ: () => SB.outline.toggle(),
    KeyW: () => SB.actions.toggleWide(),
    ArrowUp: () => SB.actions.jumpPrompt(-1),
    ArrowDown: () => SB.actions.jumpPrompt(1),
  };

  window.addEventListener(
    'keydown',
    (event) => {
      const s = SB.state.settings;
      if (!s.enabled || !s.shortcuts || event.repeat) return;
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.getModifierState && event.getModifierState('AltGraph')) return;
      const action = KEYS[event.code];
      if (!action) return;
      if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        // Leave ⌥↑/⌥↓ alone while editing text (they move the caret on macOS).
        const target = event.composedPath()[0];
        if (SB.ui.owns(event) || (SB.util.isEditable(target) && SB.chatgpt.composerText().trim())) return;
      }
      event.preventDefault();
      event.stopPropagation();
      action();
    },
    true
  );
})();
