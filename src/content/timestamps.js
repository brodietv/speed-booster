/*
 * Speed Booster — message timestamps and model badges ("2:14 PM · GPT-5 Thinking").
 * Rendered via CSS attr(), so React's DOM is never restructured.
 */
(() => {
  'use strict';
  const SB = globalThis.SpeedBooster;
  const SETTLE_MS = 1500;
  const seen = new Map(); // message id -> { at: seconds, live: boolean }
  let firstMessagesAt = 0;

  SB.on('navigate', () => {
    firstMessagesAt = 0;
  });

  SB.on('refresh', (snapshot) => {
    const s = SB.state.settings;
    if (!s.enabled || !s.timestamps || !snapshot.messages.length) return;
    const now = Date.now();
    if (!firstMessagesAt) firstMessagesAt = now;
    const report = SB.util.currentReport();
    const times = (report && report.times) || {};
    // Messages that appear after the chat has rendered are new, so "now" is their time.
    const settled = !SB.state.conversationId || !!report || now - firstMessagesAt > SETTLE_MS;

    for (const msg of snapshot.messages) {
      const id = msg.getAttribute('data-message-id');
      if (!id) continue;
      let seconds = times[id];
      if (!seconds) {
        let entry = seen.get(id);
        if (!entry) {
          entry = { at: now / 1000, live: settled };
          seen.set(id, entry);
        }
        seconds = entry.live ? entry.at : null;
      }
      const model =
        msg.getAttribute('data-message-author-role') === 'assistant'
          ? SB.format.prettyModel(msg.getAttribute('data-message-model-slug'))
          : '';
      const label = [seconds ? SB.util.friendlyTime(seconds) : '', model].filter(Boolean).join(' · ');
      if (label && msg.getAttribute('data-sb-time') !== label) msg.setAttribute('data-sb-time', label);
    }
  });
})();
