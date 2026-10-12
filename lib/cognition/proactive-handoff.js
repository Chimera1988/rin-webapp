// A proactive delivery is already a conversation turn, not a separate greeting.
// Observe the first reply to it from the shared persisted history. This module
// does not prescribe a reply or modify dialogue/long-term memory.
import { isConversationEvent } from '../chat-contract.js';

const PROACTIVE_TYPES = new Set(['greeting', 'scheduled', 'manual']);
const clean = (text, length = 600) => String(text || '').replace(/\s+/gu, ' ').trim().slice(0, length);

function acknowledgement(text = '') {
  const value = clean(text, 300).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return !value || /^(?:привет|здравствуй|здравствуйте|доброе утро|добрый день|добрый вечер|хай|hello|hi|ага|угу|да|понятно|хорошо|ок|окей|спасибо|и тебе|взаимно)$/iu.test(value);
}

/**
 * An incoming user turn follows one completed proactive assistant semantic turn.
 * Explicit message provenance survives local persistence, Push, and reopening PWA.
 * Old Push request ids are recognized for backward compatibility only.
 */
export function inspectProactiveHandoff(history = [], userText = '') {
  const events = (Array.isArray(history) ? history : []).filter(isConversationEvent);
  const current = [...events].reverse().find(item => item.role === 'user');
  if (!current) return null;
  let firstUserIndex = events.lastIndexOf(current);
  const requestId = clean(current.requestId, 120);
  if (requestId) {
    while (firstUserIndex > 0 && events[firstUserIndex - 1].role === 'user'
      && events[firstUserIndex - 1].requestId === requestId) firstUserIndex--;
  }
  const before = events.slice(0, firstUserIndex);
  const last = before.at(-1);
  if (!last || last.role !== 'assistant') return null;
  const sourceRequest = clean(last.requestId, 120);
  const sourceType = PROACTIVE_TYPES.has(last.proactiveType)
    ? last.proactiveType
    : /^rin-bg-\d{4}-\d{2}-\d{2}-/u.test(sourceRequest) ? 'scheduled' : null;
  if (!sourceType) return null;

  // Capture all text bubbles belonging to the same proactive turn, including
  // a trailing sticker. Do not mistake a sticker alone for the topic.
  const sameTurn = [];
  for (let i = before.length - 1; i >= 0; i--) {
    const message = before[i];
    if (message.role !== 'assistant' || message.requestId !== last.requestId) break;
    sameTurn.unshift(message);
  }
  const text = clean(sameTurn.filter(item => ['text','voice'].includes(item.kind || 'text'))
    .map(item => item.content).join(' '), 720);
  const ageMs = Number(current.ts) - Number(last.ts);
  return {
    source: /^rin-bg-/u.test(sourceRequest) ? 'push' : 'local',
    type: sourceType,
    mode: acknowledgement(userText) ? 'acknowledgement' : 'followup',
    requestId: sourceRequest,
    message: text,
    // For delayed responses, preserve the initiative as context, not as a live
    // greeting that must be mirrored immediately.
    delayed: Number.isFinite(ageMs) && ageMs > 4 * 3600000
  };
}
