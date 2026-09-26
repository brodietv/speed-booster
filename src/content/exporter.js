/*
 * Speed Booster — export the full conversation (even messages hidden for speed)
 * as Markdown, HTML, PDF, JSON or text. Falls back to the visible messages if
 * the full conversation can't be fetched.
 */
(() => {
  'use strict';
  const SB = globalThis.SpeedBooster;
  let busy = false;

  /** Untrimmed conversation via the network layer (ChatGPT's own auth), normalized. */
  async function fetchFull(conversationId) {
    const text = await SB.bridge.request('fetchConversation', { conversationId }, 30000);
    return SB.format.normalize(JSON.parse(text), conversationId);
  }

  function fromDom() {
    const report = SB.util.currentReport();
    const times = (report && report.times) || {};
    const messages = [];
    for (const el of SB.chatgpt.messages()) {
      const role = el.getAttribute('data-message-author-role') === 'user' ? 'user' : 'assistant';
      const text = SB.chatgpt.messageText(el);
      if (!text) continue;
      const id = el.getAttribute('data-message-id');
      const last = messages[messages.length - 1];
      if (role === 'assistant' && last && last.role === 'assistant') {
        last.text += '\n\n' + text;
        continue;
      }
      messages.push({ id, role, text, time: times[id] || null, model: el.getAttribute('data-message-model-slug') });
    }
    const title =
      (report && report.title) || document.title.replace(/\s*[-|–]\s*ChatGPT\s*$/i, '').trim() || 'ChatGPT conversation';
    return { id: SB.state.conversationId, title, createTime: null, updateTime: null, model: null, messages };
  }

  async function conversation() {
    const id = SB.state.conversationId;
    if (id) {
      try {
        return { conv: await fetchFull(id), complete: true };
      } catch (error) {
        console.warn('[Speed Booster] Full conversation unavailable, exporting visible messages.', error);
      }
    }
    // DOM-collapsed turns are still in the page; network-trimmed or virtualized ones are not.
    const status = SB.speed.status();
    const complete = status.mode === 'dom' || (status.mode === 'none' && !SB.chatgpt.isVirtualized());
    return { conv: fromDom(), complete };
  }

  /** kind: 'md' | 'html' | 'pdf' | 'json' | 'txt' | 'copy' */
  async function run(kind) {
    if (busy) return;
    busy = true;
    try {
      if (kind === 'pdf') SB.ui.toast('Preparing PDF…');
      const { conv, complete } = await conversation();
      if (!conv.messages.length) {
        SB.ui.toast('Nothing to export yet — open a conversation first', 'error');
        return;
      }
      const now = Date.now();
      const F = SB.format;
      const n = `${conv.messages.length} message${conv.messages.length === 1 ? '' : 's'}`;
      if (kind === 'copy') {
        const ok = await SB.util.copyText(F.toMarkdown(conv, now));
        SB.ui.toast(ok ? `Copied ${n} as Markdown` : 'Copy failed', ok ? undefined : 'error');
      } else if (kind === 'pdf') {
        const reply = await SB.ext.runtime.sendMessage({ type: 'sb:print', html: F.toHTML(conv, now), title: conv.title });
        if (!reply || !reply.ok) throw new Error('could not open the print view');
      } else if (kind === 'html') {
        SB.util.download(F.filename(conv, 'html', now), F.toHTML(conv, now), 'text/html');
        SB.ui.toast(`Exported ${n} as HTML`);
      } else if (kind === 'json') {
        SB.util.download(F.filename(conv, 'json', now), F.toJSON(conv, now), 'application/json');
        SB.ui.toast(`Exported ${n} as JSON`);
      } else if (kind === 'txt') {
        SB.util.download(F.filename(conv, 'txt', now), F.toText(conv), 'text/plain');
        SB.ui.toast(`Exported ${n} as text`);
      } else {
        SB.util.download(F.filename(conv, 'md', now), F.toMarkdown(conv, now), 'text/markdown');
        SB.ui.toast(`Exported ${n} as Markdown`);
      }
      if (!complete) SB.ui.toast('Only loaded messages were included — load all messages for a full export', 'error');
    } catch (error) {
      console.error('[Speed Booster] Export failed', error);
      SB.ui.toast('Export failed: ' + (error && error.message), 'error');
    } finally {
      busy = false;
    }
  }

  SB.exporter = { run, conversation, fetchFull };
})();
