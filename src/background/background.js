/* Speed Booster — background worker: opens the settings page and the PDF print view. */
'use strict';

const ext = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;
const printJobs = new Map();
const PRINT_JOB_TTL = 5 * 60 * 1000;

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string' || sender.id !== ext.runtime.id) return undefined;

  if (msg.type === 'sb:openOptions') {
    ext.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return undefined;
  }

  if (msg.type === 'sb:print' && typeof msg.html === 'string') {
    const id = crypto.randomUUID();
    printJobs.set(id, { html: msg.html, title: String(msg.title || '') });
    setTimeout(() => printJobs.delete(id), PRINT_JOB_TTL);
    const tab = { url: ext.runtime.getURL('src/print/print.html#' + id) };
    if (sender.tab) tab.index = sender.tab.index + 1;
    Promise.resolve(ext.tabs.create(tab)).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, error: String(error) })
    );
    return true; // async response
  }

  if (msg.type === 'sb:printJob') {
    const job = printJobs.get(msg.id) || null;
    printJobs.delete(msg.id);
    sendResponse(job);
    return undefined;
  }
  return undefined;
});

ext.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') ext.tabs.create({ url: ext.runtime.getURL('src/options/options.html#welcome') });
});
