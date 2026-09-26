/**
 * Prompt library: starter prompts, {{variable}} handling and storage.
 * Shared by the in-page command palette and the options page.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else (root.SpeedBooster = root.SpeedBooster || {}).prompts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STARTERS = [
    {
      title: 'Summarize this chat',
      body: 'Summarize our conversation so far as a tight bullet list: key points, decisions made, open questions, and suggested next steps.',
    },
    {
      title: 'Explain it simply',
      body: 'Explain {{topic}} simply, as if to a smart 12-year-old. Start with a one-sentence answer, then an everyday analogy, then the precise version with the correct terminology.',
    },
    {
      title: 'Improve my writing',
      body: 'Improve the following text: make it clearer, tighter and more engaging while keeping my voice and meaning. Give the improved version first, then a short list of the most important changes.\n\n{{text}}',
    },
    {
      title: 'Code review',
      body: 'Review this code like a meticulous senior engineer. List bugs, edge cases, security and performance problems ordered by severity, each with a concrete fix. Finish with the corrected code.\n\n```\n{{code}}\n```',
    },
    {
      title: 'Debug this error',
      body: "I'm getting this error:\n\n```\n{{error}}\n```\n\nExplain the most likely causes, ranked by likelihood, and how to confirm and fix each one. Ask me for anything you need to narrow it down.",
    },
    {
      title: 'Critique your last answer',
      body: 'Critically review your previous answer. Point out mistakes, weak assumptions and anything important you left out, then give an improved answer.',
    },
    {
      title: 'Fact-check',
      body: 'Fact-check your last answer. For each key claim, rate your confidence (high / medium / low), flag anything that may be outdated or wrong, and tell me how I could verify it.',
    },
    {
      title: 'Be concise from now on',
      body: 'For the rest of this chat: lead with the answer, skip preamble and filler, prefer bullets and short paragraphs, and only elaborate when I ask.',
    },
    {
      title: 'Ask me questions first',
      body: 'Before answering, ask me the 3–5 most important clarifying questions you need in order to give an excellent, tailored answer about: {{topic}}',
    },
    {
      title: 'Step-by-step plan',
      body: "Create a step-by-step plan to {{goal}}. Include milestones, time estimates, the tools or resources I'll need, and the biggest risks with how to mitigate them.",
    },
    {
      title: 'Help me decide',
      body: 'Help me decide: {{decision}}\n\nList the realistic options, the pros and cons of each, the key questions that should drive the choice, and your recommendation with reasoning.',
    },
    {
      title: 'Translate',
      body: "Translate the following into {{language:Spanish}}. Preserve tone, formatting and meaning, and flag anything that doesn't translate cleanly.\n\n{{text}}",
    },
    {
      title: 'Quiz me',
      body: 'Quiz me on {{topic}}. Ask one question at a time, wait for my answer, tell me whether I was right with a brief explanation, then ask the next question. Gradually increase the difficulty.',
    },
    {
      title: 'Continue',
      body: 'Continue exactly where you left off, without repeating anything.',
    },
  ];

  const BUILTINS = ['selection', 'date', 'time'];
  const VARIABLE = /\{\{\s*([A-Za-z0-9_][\w -]{0,40}?)\s*(?::([^}]*))?\}\}/g;
  const MAX_PROMPTS = 1000;

  function makeId() {
    return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** Placeholders the user must fill in, in order of appearance: [{ name, fallback }]. */
  function variables(body) {
    const seen = new Map();
    String(body || '').replace(VARIABLE, (match, name, fallback) => {
      const key = name.trim();
      if (!BUILTINS.includes(key.toLowerCase()) && !seen.has(key)) {
        seen.set(key, { name: key, fallback: (fallback || '').trim() });
      }
      return match;
    });
    return [...seen.values()];
  }

  function fill(body, values, builtins) {
    const vals = values || {};
    const auto = builtins || {};
    return String(body || '').replace(VARIABLE, (match, name, fallback) => {
      const key = name.trim();
      const lower = key.toLowerCase();
      if (BUILTINS.includes(lower)) return auto[lower] != null ? String(auto[lower]) : '';
      const value = vals[key];
      return value != null && String(value) !== '' ? String(value) : (fallback || '').trim();
    });
  }

  function sanitizePrompt(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const body = typeof raw.body === 'string' ? raw.body : typeof raw.prompt === 'string' ? raw.prompt : '';
    if (!body.trim()) return null;
    const title = (typeof raw.title === 'string' && raw.title.trim()) || body.trim().split('\n')[0].slice(0, 60);
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : makeId(),
      title: title.slice(0, 120),
      body: body.slice(0, 20000),
      uses: Math.max(0, Math.floor(num(raw.uses))),
      lastUsed: num(raw.lastUsed),
      createdAt: num(raw.createdAt) || Date.now(),
    };
  }

  function sanitizeList(list) {
    const out = [];
    const ids = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
      const prompt = sanitizePrompt(raw);
      if (!prompt) continue;
      if (ids.has(prompt.id)) prompt.id = makeId();
      ids.add(prompt.id);
      out.push(prompt);
      if (out.length >= MAX_PROMPTS) break;
    }
    return out;
  }

  function starters() {
    return STARTERS.map((p, i) => sanitizePrompt(Object.assign({ id: 'starter-' + (i + 1), createdAt: i + 1 }, p)));
  }

  /** Most used and most recent first (a simple "frecency" score). */
  function rank(list) {
    const now = Date.now();
    const score = (p) => {
      const days = p.lastUsed ? (now - p.lastUsed) / 86400000 : 365;
      return p.uses * 2 + 20 / (1 + days);
    };
    return list
      .map((p, i) => ({ p, i, s: score(p) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.p);
  }

  function ext() {
    if (typeof browser !== 'undefined' && browser && browser.storage) return browser;
    if (typeof chrome !== 'undefined' && chrome && chrome.storage) return chrome;
    return null;
  }

  async function load() {
    const api = ext();
    if (!api) return starters();
    const stored = await api.storage.local.get('prompts');
    if (!stored || stored.prompts === undefined) return starters();
    return sanitizeList(stored.prompts);
  }

  async function save(list) {
    const clean = sanitizeList(list);
    const api = ext();
    if (api) await api.storage.local.set({ prompts: clean });
    return clean;
  }

  async function recordUse(id) {
    const list = await load();
    const prompt = list.find((p) => p.id === id);
    if (!prompt) return list;
    prompt.uses += 1;
    prompt.lastUsed = Date.now();
    return save(list);
  }

  return { STARTERS, BUILTINS, variables, fill, sanitizePrompt, sanitizeList, starters, rank, load, save, recordUse, makeId };
});
