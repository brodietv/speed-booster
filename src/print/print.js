/* Speed Booster — print view: renders an exported chat and opens the print dialog ("Save as PDF"). */
(async () => {
  'use strict';
  const ext = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;
  const title = document.getElementById('bar-title');
  const button = document.getElementById('print');

  const job = await ext.runtime.sendMessage({ type: 'sb:printJob', id: location.hash.slice(1) }).catch(() => null);
  if (!job || typeof job.html !== 'string') {
    title.textContent = 'This print view has expired — export the chat again from ChatGPT.';
    return;
  }

  // The export is a script-free document; move its styles and body into this page.
  const doc = new DOMParser().parseFromString(job.html, 'text/html');
  for (const style of doc.head.querySelectorAll('style')) document.head.appendChild(style);
  document.getElementById('content').replaceChildren(...doc.body.childNodes);
  document.title = job.title || doc.title || 'ChatGPT conversation';
  title.replaceChildren();
  title.append(document.title, Object.assign(document.createElement('span'), { className: 'hint', textContent: '  ·  choose “Save as PDF” as the destination' }));

  button.disabled = false;
  button.addEventListener('click', () => window.print());
  setTimeout(() => window.print(), 400);
})();
