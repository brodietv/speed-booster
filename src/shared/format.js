/**
 * Conversation helpers shared by the exporter (content script) and unit tests:
 * normalize ChatGPT's conversation JSON and render it as Markdown/text/JSON.
 */
(function (root, factory) {
  'use strict';
  const node = typeof module === 'object' && module && module.exports;
  const api = factory(() => (node ? require('./markdown.js') : root.SpeedBooster.markdown));
  if (node) module.exports = api;
  else (root.SpeedBooster = root.SpeedBooster || {}).format = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (markdown) {
  'use strict';

  const LABELS = { user: 'You', assistant: 'ChatGPT' };

  /** Removes ChatGPT's inline citation markers (private-use glyphs and 【…†…】 tokens). */
  function cleanText(text) {
    return String(text || '')
      .replace(/\ue200[^\ue201]*\ue201/g, '')
      .replace(/[\ue200-\ue2ff]/g, '')
      .replace(/【\d+(?::\d+)?†[^】]*】/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  function partText(part) {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    if (typeof part.text === 'string') return part.text;
    const type = String(part.content_type || '');
    if (type.includes('image')) return '[Image]';
    if (type.includes('audio')) return '';
    if (type.includes('video')) return '[Video]';
    return '';
  }

  function contentText(content) {
    if (!content) return '';
    if (Array.isArray(content.parts)) return content.parts.map(partText).filter(Boolean).join('\n\n');
    if (typeof content.text === 'string') return content.text;
    return '';
  }

  function attachmentsLine(message) {
    const files = (message.metadata && message.metadata.attachments) || [];
    const names = files.map((f) => f && f.name).filter(Boolean);
    return names.length ? 'Attachments: ' + names.join(', ') : '';
  }

  function activePath(data) {
    const path = [];
    const seen = new Set();
    let id = data.current_node;
    while (id && data.mapping[id] && !seen.has(id)) {
      seen.add(id);
      path.push(data.mapping[id]);
      id = data.mapping[id].parent;
    }
    return path.reverse();
  }

  /**
   * Flattens the rendered branch into [{ id, role, text, time, model }].
   * Consecutive assistant/tool nodes are merged into one answer, like the UI does.
   */
  function normalize(data, conversationId) {
    const messages = [];
    for (const node of activePath(data)) {
      const m = node.message;
      if (!m || !m.author) continue;
      const meta = m.metadata || {};
      if (meta.is_visually_hidden_from_conversation) continue;
      const role = m.author.role;
      const type = m.content && m.content.content_type;
      let text = '';
      let as = null;

      if (role === 'user') {
        if (type === 'user_editable_context') continue;
        text = [contentText(m.content), attachmentsLine(m)].filter(Boolean).join('\n\n');
        as = 'user';
      } else if (role === 'assistant') {
        if (m.recipient && m.recipient !== 'all') continue; // tool call
        if (type !== 'text' && type !== 'multimodal_text') continue; // reasoning, code, etc.
        text = cleanText(contentText(m.content));
        as = 'assistant';
      } else if (role === 'tool' && type === 'multimodal_text') {
        text = (m.content.parts || []).some((p) => p && typeof p === 'object' && /image/.test(p.content_type || ''))
          ? '[Image]'
          : '';
        as = 'assistant';
      }
      if (!as || !text.trim()) continue;

      const last = messages[messages.length - 1];
      if (as === 'assistant' && last && last.role === 'assistant') {
        last.text += '\n\n' + text;
        continue;
      }
      messages.push({
        id: m.id || node.id,
        role: as,
        text,
        time: m.create_time || null,
        model: meta.model_slug || null,
      });
    }
    return {
      id: conversationId || data.conversation_id || data.id || null,
      title: data.title || 'ChatGPT conversation',
      createTime: data.create_time || null,
      updateTime: data.update_time || null,
      model: data.default_model_slug || null,
      messages,
    };
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** Deterministic local "YYYY-MM-DD HH:mm" (exports shouldn't depend on browser locale). */
  function stamp(seconds) {
    if (!seconds) return '';
    const d = new Date(seconds * 1000);
    if (isNaN(d)) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function conversationUrl(conv) {
    return conv.id ? `https://chatgpt.com/c/${conv.id}` : '';
  }

  function toMarkdown(conv, exportedAt) {
    const when = stamp((exportedAt || Date.now()) / 1000).slice(0, 10);
    const count = conv.messages.length;
    const lines = [`# ${conv.title}`, ''];
    lines.push(`_Exported from ChatGPT on ${when} · ${count} message${count === 1 ? '' : 's'}_`);
    if (conv.id) lines.push('', `<${conversationUrl(conv)}>`);
    for (const msg of conv.messages) {
      const details = [msg.role === 'assistant' ? prettyModel(msg.model) : '', stamp(msg.time)].filter(Boolean);
      lines.push('', '---', '', `**${LABELS[msg.role]}**${details.map((d) => ` · ${d}`).join('')}`, '', msg.text);
    }
    return lines.join('\n') + '\n';
  }

  function toText(conv) {
    const out = [conv.title, '='.repeat(Math.min(conv.title.length, 80)), ''];
    for (const msg of conv.messages) {
      const time = stamp(msg.time);
      out.push(`${LABELS[msg.role]}${time ? ` (${time})` : ''}:`, msg.text, '');
    }
    return out.join('\n');
  }

  function toJSON(conv, exportedAt) {
    const iso = (s) => (s ? new Date(s * 1000).toISOString() : null);
    return JSON.stringify(
      {
        title: conv.title,
        id: conv.id,
        url: conversationUrl(conv) || null,
        model: conv.model,
        created: iso(conv.createTime),
        updated: iso(conv.updateTime),
        exported: new Date(exportedAt || Date.now()).toISOString(),
        messages: conv.messages.map((m) => ({ role: m.role, time: iso(m.time), model: m.model, text: m.text })),
      },
      null,
      2
    );
  }

  /** "gpt-5-thinking-mini" → "GPT-5 Thinking Mini", "o4-mini-high" → "o4 Mini High". */
  function prettyModel(slug) {
    if (!slug || typeof slug !== 'string') return '';
    const match = /^(gpt-[\w.]+?|o\d[\w.]*?)(?:-(.+))?$/i.exec(slug);
    if (!match) return slug;
    const base = match[1].replace(/^gpt-/i, 'GPT-');
    const rest = match[2] ? ' ' + match[2].split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '';
    return base + rest;
  }

  const HTML_STYLE = `
  :root { color-scheme: light dark; --text: #1f2328; --muted: #656d76; --border: #d8dee4; --bubble: #f2f3f5; --code: #f6f8fa; --accent: #0f9d77; --link: #0969da; --bg: #ffffff; }
  @media screen and (prefers-color-scheme: dark) {
    :root { --text: #e6e6e6; --muted: #9da5ae; --border: #30363d; --bubble: #2a2d31; --code: #161b22; --accent: #3ecf98; --link: #58a6ff; --bg: #0f1113; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.65 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  main { max-width: 820px; margin: 0 auto; padding: 40px 24px 72px; }
  header { padding-bottom: 18px; border-bottom: 1px solid var(--border); }
  h1.title { margin: 0 0 6px; font-size: 26px; line-height: 1.25; }
  .meta { color: var(--muted); font-size: 13px; }
  .msg { padding: 20px 0; border-bottom: 1px solid var(--border); }
  .role { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-bottom: 8px; font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
  .assistant .role { color: var(--accent); }
  .role time, .role .model { font-weight: 500; letter-spacing: 0; text-transform: none; color: var(--muted); }
  .user .body { background: var(--bubble); border-radius: 14px; padding: 12px 16px; white-space: pre-wrap; word-wrap: break-word; }
  .body > :first-child { margin-top: 0; }
  .body > :last-child { margin-bottom: 0; }
  pre { background: var(--code); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; overflow-x: auto; font-size: 13.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9em; }
  :not(pre) > code { background: var(--code); border: 1px solid var(--border); border-radius: 6px; padding: .1em .35em; }
  table { border-collapse: collapse; margin: 14px 0; display: block; overflow-x: auto; }
  th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: var(--code); }
  blockquote { margin: 14px 0; padding: 2px 16px; border-left: 4px solid var(--border); color: var(--muted); }
  a { color: var(--link); }
  hr { border: 0; border-top: 1px solid var(--border); margin: 22px 0; }
  .img { color: var(--muted); font-style: italic; }
  footer { margin-top: 28px; color: var(--muted); font-size: 12px; }
  @media print {
    main { max-width: none; padding: 0; }
    a { color: inherit; }
    .msg { break-inside: auto; }
    .role { break-after: avoid; }
    pre, table, blockquote { break-inside: avoid; }
  }`;

  /** Standalone, script-free HTML document (also used for "Save as PDF"). */
  function toHTML(conv, exportedAt) {
    const md = markdown();
    const esc = md.escapeHtml;
    const when = stamp((exportedAt || Date.now()) / 1000).slice(0, 10);
    const count = conv.messages.length;
    const link = conversationUrl(conv);
    const body = conv.messages
      .map((msg) => {
        const time = stamp(msg.time);
        const model = msg.role === 'assistant' ? prettyModel(msg.model) : '';
        const content = msg.role === 'user' ? esc(msg.text) : md.render(msg.text);
        return (
          `<article class="msg ${msg.role}"><div class="role">${LABELS[msg.role]}` +
          (time ? ` <time>${esc(time)}</time>` : '') +
          (model ? ` <span class="model">${esc(model)}</span>` : '') +
          `</div><div class="body">${content}</div></article>`
        );
      })
      .join('\n');
    return (
      `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
      `<title>${esc(conv.title)}</title>\n<style>${HTML_STYLE}</style>\n</head>\n<body>\n<main>\n` +
      `<header><h1 class="title">${esc(conv.title)}</h1><div class="meta">Exported from ChatGPT on ${when} · ` +
      `${count} message${count === 1 ? '' : 's'}${link ? ` · <a href="${esc(link)}">Open in ChatGPT</a>` : ''}</div></header>\n` +
      `${body}\n<footer>Exported with Speed Booster for ChatGPT</footer>\n</main>\n</body>\n</html>\n`
    );
  }

  function filename(conv, extension, exportedAt) {
    const safe =
      String(conv.title || 'ChatGPT conversation')
        .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80)
        .replace(/[. ]+$/, '') || 'ChatGPT conversation';
    const date = stamp((exportedAt || Date.now()) / 1000).slice(0, 10);
    return `${safe} - ${date}.${extension}`;
  }

  /** Same estimate as the network layer: ~4 chars/token for ASCII, denser otherwise. */
  function estimateTokens(text) {
    if (!text) return 0;
    let ascii = 0;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 128) ascii++;
    return Math.ceil(ascii / 4 + (text.length - ascii) / 1.5);
  }

  function countWords(text) {
    const matches = String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu);
    return matches ? matches.length : 0;
  }

  return {
    normalize,
    cleanText,
    toMarkdown,
    toText,
    toJSON,
    toHTML,
    filename,
    stamp,
    prettyModel,
    estimateTokens,
    countWords,
    LABELS,
  };
});
