/* Speed Booster — message bridge between this content script and the MAIN-world network layer. */
(() => {
  'use strict';
  const SB = globalThis.SpeedBooster;
  const TAG = '__speedBooster';
  const pending = new Map();
  let sequence = 0;

  function isReport(report) {
    return (
      !!report &&
      typeof report === 'object' &&
      typeof report.conversationId === 'string' &&
      (report.total === null || Number.isFinite(report.total)) &&
      Number.isFinite(report.kept) &&
      Array.isArray(report.prompts) &&
      !!report.times &&
      typeof report.times === 'object'
    );
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (event.origin !== location.origin || !msg || typeof msg !== 'object' || msg[TAG] !== 'page') return;
    const payload = msg.payload || {};

    if (msg.type === 'ready') {
      send('hello');
      if (SB.state.settingsLoaded) send('settings', SB.settings.pageSubset(SB.state.settings));
    } else if (msg.type === 'conversation' || msg.type === 'hello') {
      const report = msg.type === 'hello' ? payload.report : payload;
      if (isReport(report)) {
        SB.state.reports.set(report.conversationId, report);
        SB.emit('report', report);
      }
    } else if (msg.type === 'response') {
      const request = pending.get(payload.requestId);
      if (!request) return;
      pending.delete(payload.requestId);
      if (payload.ok) request.resolve(payload.text);
      else request.reject(new Error(payload.error || 'Request failed'));
    }
  });

  function send(type, payload) {
    window.postMessage({ [TAG]: 'content', type, payload }, location.origin);
  }

  function request(type, payload, timeout) {
    const requestId = 'r' + ++sequence + Math.random().toString(36).slice(2, 8);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('Timed out'));
      }, timeout || 20000);
      pending.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      send(type, Object.assign({ requestId }, payload));
    });
  }

  SB.bridge = { send, request };
  send('hello');
})();
