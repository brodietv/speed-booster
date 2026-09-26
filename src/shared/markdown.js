/**
 * Small, safe Markdown → HTML renderer for exports (HTML/PDF). Input is always
 * escaped first; only a fixed set of tags is produced and links are limited to
 * http(s)/mailto, so exported files can't carry scripts from chat content.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else (root.SpeedBooster = root.SpeedBooster || {}).markdown = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
  const CODE = '\u0000';
  const LINK = '\u0001';

  function safeUrl(url) {
    const value = String(url || '').trim();
    return /^(https?:\/\/|mailto:)/i.test(value) ? value : null;
  }

  function emphasis(s) {
    return s
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
      .replace(/(^|[^\w*])\*(?=[^\s*])([^*]*?[^\s*])\*(?![\w*])/g, '$1<em>$2</em>')
      .replace(/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  }

  /** Inline markdown on one line of raw text. */
  function inline(text) {
    const codes = [];
    const links = [];
    let s = String(text).replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m, ticks, code) => {
      codes.push('<code>' + escapeHtml(code.replace(/^ (.*) $/, '$1')) + '</code>');
      return CODE + (codes.length - 1) + CODE;
    });
    const keep = (html) => LINK + (links.push(html) - 1) + LINK;
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, alt) =>
      keep('<span class="img">[image' + (alt ? ': ' + escapeHtml(alt) : '') + ']</span>')
    );
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, label, url) => {
      const href = safeUrl(url);
      return href ? keep(`<a href="${escapeHtml(href)}">${emphasis(escapeHtml(label))}</a>`) : m;
    });
    s = s.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, (m, url) => keep(`<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`));
    s = emphasis(escapeHtml(s));
    return s
      .replace(new RegExp(LINK + '(\\d+)' + LINK, 'g'), (m, i) => links[Number(i)])
      .replace(new RegExp(CODE + '(\\d+)' + CODE, 'g'), (m, i) => codes[Number(i)]);
  }

  const indentOf = (line) => line.match(/^\s*/)[0].replace(/\t/g, '    ').length;
  const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*).*$/;
  const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  function isBlockStart(lines, i) {
    const line = lines[i];
    return (
      FENCE.test(line) ||
      /^\s{0,3}#{1,6}\s/.test(line) ||
      /^\s{0,3}>/.test(line) ||
      LIST_ITEM.test(line) ||
      /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line) ||
      /^\s*(\$\$|\\\[)\s*$/.test(line) ||
      (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]))
    );
  }

  function splitRow(line) {
    let row = line.trim();
    if (row.startsWith('|')) row = row.slice(1);
    if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
    return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
  }

  function renderItem(itemLines) {
    const first = itemLines[0].replace(/^\[( |x|X)\]\s+/, (m, c) => (c === ' ' ? '☐ ' : '☑ '));
    if (itemLines.length === 1) return inline(first);
    const html = render([first].concat(itemLines.slice(1)).join('\n'));
    return html.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
  }

  function parseList(lines, start) {
    const base = indentOf(lines[start]);
    const ordered = /\d/.test(LIST_ITEM.exec(lines[start])[2]);
    const first = ordered ? parseInt(LIST_ITEM.exec(lines[start])[2], 10) : 1;
    const items = [];
    let i = start;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        const next = j < lines.length ? lines[j] : null;
        const nextItem = next && LIST_ITEM.exec(next);
        if (next && (indentOf(next) > base || (nextItem && indentOf(next) === base && /\d/.test(nextItem[2]) === ordered))) {
          if (indentOf(next) > base) items[items.length - 1].push('');
          i = j;
          continue;
        }
        break;
      }
      const item = LIST_ITEM.exec(line);
      const indent = indentOf(line);
      if (item && indent === base) {
        if (/\d/.test(item[2]) !== ordered) break;
        items.push([item[3]]);
      } else if (indent > base) {
        items[items.length - 1].push(line.replace(/^\s+/, (ws) => ' '.repeat(Math.max(0, indentOf(ws) - base - 2))));
      } else if (!isBlockStart(lines, i)) {
        items[items.length - 1].push(line.trim()); // lazy continuation
      } else {
        break;
      }
      i++;
    }
    const tag = ordered ? 'ol' : 'ul';
    const startAttr = ordered && first !== 1 ? ` start="${first}"` : '';
    return [`<${tag}${startAttr}>` + items.map((lines) => `<li>${renderItem(lines)}</li>`).join('') + `</${tag}>`, i];
  }

  function render(markdown) {
    const lines = String(markdown || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000\u0001]/g, '')
      .split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      let m = FENCE.exec(line);
      if (m) {
        const marker = m[1];
        const close = new RegExp('^\\s*' + (marker[0] === '`' ? '`' : '~') + '{' + marker.length + ',}\\s*$');
        const indent = indentOf(line);
        const body = [];
        i++;
        while (i < lines.length && !close.test(lines[i])) {
          body.push(lines[i].replace(/^\s+/, (ws) => ' '.repeat(Math.max(0, indentOf(ws) - indent))));
          i++;
        }
        i++;
        const lang = m[2] ? ` class="language-${escapeHtml(m[2])}"` : '';
        out.push(`<pre><code${lang}>${escapeHtml(body.join('\n'))}</code></pre>`);
        continue;
      }
      if (/^\s*(\$\$|\\\[)\s*$/.test(line)) {
        const close = line.trim() === '$$' ? /^\s*\$\$\s*$/ : /^\s*\\\]\s*$/;
        const body = [];
        i++;
        while (i < lines.length && !close.test(lines[i])) body.push(lines[i++]);
        i++;
        out.push(`<pre class="math">${escapeHtml(body.join('\n'))}</pre>`);
        continue;
      }
      if (!line.trim()) {
        i++;
        continue;
      }
      m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (m) {
        out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
        i++;
        continue;
      }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
        const header = splitRow(line);
        const aligns = splitRow(lines[i + 1]).map((c) =>
          /^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : /^:-+$/.test(c) ? 'left' : ''
        );
        const align = (k) => (aligns[k] ? ` style="text-align:${aligns[k]}"` : '');
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
        out.push(
          '<table><thead><tr>' +
            header.map((c, k) => `<th${align(k)}>${inline(c)}</th>`).join('') +
            '</tr></thead><tbody>' +
            rows.map((r) => '<tr>' + header.map((_, k) => `<td${align(k)}>${inline(r[k] || '')}</td>`).join('') + '</tr>').join('') +
            '</tbody></table>'
        );
        continue;
      }
      if (/^\s{0,3}>/.test(line)) {
        const body = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) body.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
        out.push(`<blockquote>${render(body.join('\n'))}</blockquote>`);
        continue;
      }
      if (LIST_ITEM.test(line)) {
        const [html, next] = parseList(lines, i);
        out.push(html);
        i = next;
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines, i))) para.push(lines[i++].trim());
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    }
    return out.join('\n');
  }

  return { render, inline, escapeHtml };
});
