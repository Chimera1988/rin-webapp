export const CHAT_SCHEMA_VERSION = 3;

const ALLOWED_ROLES = new Set(['user', 'assistant']);
const TEXT_KINDS = new Set(['text', 'voice']);
const ALLOWED_KINDS = new Set(['text', 'voice', 'sticker', 'tool_result', 'system']);
const ALLOWED_STATUSES = new Set(['pending', 'sent', 'complete', 'failed']);

const cleanText = (value, max = 2400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function normalizeChatMessage(value = {}, index = 0) {
  if (!value || typeof value !== 'object') return null;
  const role = ALLOWED_ROLES.has(value.role) ? value.role : null;
  if (!role) return null;

  const legacySticker = value.type === 'sticker' || value.sticker?.src;
  const kind = legacySticker
    ? 'sticker'
    : value.kind == null
      ? 'text'
      : ALLOWED_KINDS.has(value.kind) ? value.kind : null;
  const status = value.status == null
    ? 'complete'
    : ALLOWED_STATUSES.has(value.status) ? value.status : null;
  if (!kind || !status) return null;
  const content = cleanText(value.content, kind === 'sticker' ? 500 : 2400);

  if (TEXT_KINDS.has(kind) && !content) return null;
  if (kind === 'sticker' && !value.sticker?.src && !content) return null;

  const tsNumber = Number(value.ts);
  return {
    schemaVersion: CHAT_SCHEMA_VERSION,
    id: cleanText(value.id, 100) || `legacy-${index}-${Number.isFinite(tsNumber) ? tsNumber : Date.now()}`,
    requestId: cleanText(value.requestId, 100) || null,
    inReplyTo: cleanText(value.inReplyTo, 100) || null,
    role,
    kind,
    status,
    content,
    ts: Number.isFinite(tsNumber) ? tsNumber : Date.now(),
    ...(kind === 'sticker' && value.sticker?.src ? {
      sticker: {
        src: cleanText(value.sticker.src, 500),
        utterance: cleanText(value.sticker.utterance, 300) || null,
        emotion: cleanText(value.sticker.emotion, 80) || null
      }
    } : {}),
    ...(value.errorCode ? { errorCode: cleanText(value.errorCode, 80) } : {})
  };
}

export function normalizeChatHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .map(normalizeChatMessage)
    .filter(Boolean)
    .slice(-120);
}

export function isTextTurn(message) {
  return Boolean(
    message &&
    ALLOWED_ROLES.has(message.role) &&
    TEXT_KINDS.has(message.kind || 'text') &&
    ['sent', 'complete'].includes(message.status || 'complete') &&
    cleanText(message.content)
  );
}

export function selectModelHistory(history = [], options = {}) {
  const includeRequestId = cleanText(options.includeRequestId, 100);
  const selected = normalizeChatHistory(history)
    .filter(message => {
      if (!TEXT_KINDS.has(message.kind)) return false;
      if (message.status === 'complete') return true;
      return message.role === 'user' && message.status === 'sent' && message.requestId === includeRequestId;
    });
  const currentIndex = includeRequestId
    ? selected.findIndex(message => message.role === 'user' && message.requestId === includeRequestId && message.status === 'sent')
    : -1;
  if (currentIndex >= 0 && currentIndex !== selected.length - 1) selected.push(selected.splice(currentIndex, 1)[0]);
  return selected.map(message => ({
    id: message.id,
    requestId: message.requestId,
    role: message.role,
    kind: message.kind,
    status: message.status,
    content: cleanText(message.content, 1800),
    ts: message.ts
  }));
}

export function pruneModelHistory(history = [], maxItems = 32, maxChars = 6500) {
  let slice = (Array.isArray(history) ? history : []).filter(isTextTurn).slice(-maxItems);
  while (JSON.stringify(slice).length > maxChars && slice.length > 8) slice = slice.slice(1);
  return slice;
}

export function lastUserText(history = []) {
  return [...history].reverse().find(item => item?.role === 'user' && cleanText(item?.content))?.content || '';
}

export function isExplicitFarewell(value) {
  const text = cleanText(value, 500).toLowerCase();
  if (/(?:до встречи|до завтра|спокойной ночи|доброй ночи|увидимся|до связи|бай|bye)/i.test(text)) return true;
  return /^(?:(?:ну|ладно)[, ]+)?(?:(?:всё|все)[, ]+)?пока[.!…)]*$/i.test(text);
}

export function contentKey(value = '') {
  const text = cleanText(value, 1200).toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `k-${(hash >>> 0).toString(36)}`;
}
