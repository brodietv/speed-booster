/*
 * Builds realistic ChatGPT conversation payloads for tests: the classic
 * `mapping` tree (with hidden system/context nodes, tool calls, and branches
 * before and after any trim point) and the paged `messages` format.
 */
'use strict';

const CONVERSATION_ID = '6a1f0c2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
const START = 1767225600; // 2026-01-01T00:00:00Z

function uuid(n) {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

function message(id, role, text, time, extra) {
  const msg = {
    id,
    author: { role, name: null, metadata: {} },
    create_time: time,
    update_time: null,
    content: { content_type: 'text', parts: [text] },
    status: 'finished_successfully',
    end_turn: role === 'assistant' ? true : null,
    weight: 1,
    metadata: role === 'assistant' ? { model_slug: 'gpt-5-thinking' } : {},
    recipient: 'all',
    channel: null,
  };
  return Object.assign(msg, extra || {});
}

/**
 * @param {object} opts
 * @param {number} opts.exchanges  number of user→assistant exchanges on the active branch
 * @param {boolean} opts.tools     every 7th answer uses a tool (call + output + final text)
 * @param {boolean} opts.branches  add an edited-prompt branch early and a regenerated answer late
 */
function makeConversation(opts) {
  const { exchanges = 60, tools = true, branches = true, id = CONVERSATION_ID } = opts || {};
  const mapping = {};
  let seq = 1;
  let time = START;
  const nextId = () => uuid(seq++);
  const add = (nodeId, msg, parent) => {
    mapping[nodeId] = { id: nodeId, message: msg, parent, children: [] };
    if (parent) mapping[parent].children.push(nodeId);
    return nodeId;
  };

  add('client-created-root', null, null);
  const system = add(
    nextId(),
    message(uuid(seq - 1), 'system', '', null, { metadata: { is_visually_hidden_from_conversation: true } }),
    'client-created-root'
  );
  const contextId = nextId();
  let parent = add(
    contextId,
    message(contextId, 'user', '', time, {
      content: { content_type: 'user_editable_context', user_profile: 'I like concise answers.', user_instructions: '' },
      metadata: { is_visually_hidden_from_conversation: true },
    }),
    system
  );

  const ids = { prompts: [], answers: [], branchPrompt: null, regenerated: null };
  for (let i = 0; i < exchanges; i++) {
    time += 60;
    const userId = nextId();
    const prompt = `Question ${i + 1}: how do I tune ${['postgres', 'nginx', 'react', 'rust'][i % 4]} for speed?`;
    add(userId, message(userId, 'user', prompt, time, i === 3 ? { metadata: { attachments: [{ name: 'notes.pdf' }] } } : {}), parent);
    ids.prompts.push(userId);

    if (branches && i === 5) {
      // Edited prompt: a sibling branch that is NOT on the active path.
      const alt = nextId();
      add(alt, message(alt, 'user', 'Question 6 (edited): something else entirely', time + 5), parent);
      const altAnswer = nextId();
      add(altAnswer, message(altAnswer, 'assistant', 'Answer on the old branch', time + 10), alt);
      ids.branchPrompt = alt;
    }

    parent = userId;
    if (tools && i % 7 === 6) {
      const call = nextId();
      add(call, message(call, 'assistant', '', time + 5, {
        recipient: 'python',
        content: { content_type: 'code', language: 'python', text: 'print(2 + 2)' },
      }), parent);
      const output = nextId();
      add(output, message(output, 'tool', '', time + 6, {
        author: { role: 'tool', name: 'python', metadata: {} },
        content: { content_type: 'execution_output', text: '4' },
      }), call);
      parent = output;
    }
    time += 30;
    const answerId = nextId();
    const answer =
      `Here is answer ${i + 1}.\n\n` +
      '```sql\nSELECT * FROM speed WHERE x < 10;\n```\n\n' +
      `- Tip one for #${i + 1}\n- Tip two \ue200cite\ue202turn0search1\ue201\n\nSee also 【3†source】 **bold** text.`;
    add(answerId, message(answerId, 'assistant', answer, time), parent);
    ids.answers.push(answerId);

    if (branches && i === exchanges - 2) {
      // Regenerated answer late in the chat: sibling of the active answer.
      const regen = nextId();
      add(regen, message(regen, 'assistant', 'A regenerated version of this answer', time + 1), parent);
      ids.regenerated = regen;
    }
    parent = answerId;
  }

  const data = {
    title: 'Tuning everything for speed',
    create_time: START,
    update_time: time,
    mapping,
    moderation_results: [],
    current_node: parent,
    plugin_ids: null,
    conversation_id: id,
    conversation_template_id: null,
    gizmo_id: null,
    is_archived: false,
    safe_urls: [],
    default_model_slug: 'gpt-5-thinking',
  };
  return { data, ids };
}

/** The active branch as an ordered list of message objects (root excluded). */
function linearMessages(data) {
  const out = [];
  let id = data.current_node;
  while (id && data.mapping[id]) {
    if (data.mapping[id].message) out.unshift(data.mapping[id].message);
    id = data.mapping[id].parent;
  }
  return out;
}

/**
 * Paged API: { messages (oldest first), current_node, page_info }. A "turn" here
 * starts at every user message; `before` is an opaque cursor (index-based).
 */
function page(data, { before = null, numTurns = 10 } = {}) {
  const all = linearMessages(data);
  const end = before == null ? all.length : Number(String(before).replace(/^c/, ''));
  let start = end;
  let turns = 0;
  while (start > 0) {
    start--;
    const m = all[start];
    if (m.author.role === 'user' && m.content.content_type !== 'user_editable_context') {
      turns++;
      if (turns >= numTurns) break;
    }
  }
  return {
    messages: all.slice(start, end),
    current_node: data.current_node,
    page_info: { has_previous_page: start > 0, start_cursor: 'c' + start },
    safe_urls: [],
    blocked_urls: [],
    moderation_results: [],
  };
}

module.exports = { makeConversation, linearMessages, page, CONVERSATION_ID, uuid };
