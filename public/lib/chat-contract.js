export const CHAT_SCHEMA_VERSION = 6;

const ALLOWED_ROLES = new Set(['user', 'assistant']);
const TEXT_KINDS = new Set(['text', 'voice']);
const ALLOWED_KINDS = new Set(['text', 'voice', 'sticker', 'silence', 'tool_result', 'system']);
const REPLY_KINDS = new Set(['text', 'voice', 'sticker']);
const ALLOWED_STATUSES = new Set(['pending', 'sent', 'complete', 'failed']);
const INTERNAL_NONVERBAL_META = /^\s*\[(?:Невербальный\s+жест|Невербальная\s+реакция|Эмоциональный\s+жест|Стикер)\s+Рин\s*:[\s\S]*\]\s*$/iu;
const SAFE_STICKER_SRC = /^\/stickers\/[a-z0-9_]+\.webp$/iu;

export const cleanInlineText = (value, max = 2400) => String(value ?? '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

export const cleanMessageText = (value, max = 8000) => String(value ?? '')
  .replace(/\r\n?/g, '\n')
  .replace(/[\t\f\v ]+/g, ' ')
  .replace(/ *\n */g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
  .slice(0, max);

export function isInternalNonverbalMetaText(value = '') {
  return INTERNAL_NONVERBAL_META.test(String(value || ''));
}

export function normalizeReplySnapshot(value = null) {
  if (!value || typeof value !== 'object') return null;
  const role = ALLOWED_ROLES.has(value.role) ? value.role : null;
  const kind = REPLY_KINDS.has(value.kind) ? value.kind : null;
  if (!role || !kind) return null;
  const fallback = kind === 'sticker' ? 'Стикер' : kind === 'voice' ? 'Голосовое сообщение' : '';
  const excerpt = cleanInlineText(value.excerpt || fallback, 360);
  if (!excerpt) return null;
  const stickerSrc = SAFE_STICKER_SRC.test(String(value.stickerSrc || '')) ? String(value.stickerSrc) : null;
  return {
    role,
    kind,
    excerpt,
    stickerSrc: kind === 'sticker' ? stickerSrc : null,
    stickerId: kind === 'sticker' ? cleanInlineText(value.stickerId, 80) || null : null
  };
}

export function replySnapshotFromMessage(message = null) {
  if (!message || typeof message !== 'object' || !ALLOWED_ROLES.has(message.role)) return null;
  const kind = message.kind === 'sticker' || message.sticker?.src
    ? 'sticker'
    : message.kind === 'voice' ? 'voice' : 'text';
  return normalizeReplySnapshot({
    role: message.role,
    kind,
    excerpt: kind === 'sticker'
      ? cleanInlineText(message.sticker?.utterance, 240) || 'Стикер'
      : kind === 'voice'
        ? cleanInlineText(message.content, 360) || 'Голосовое сообщение'
        : cleanInlineText(message.content, 360),
    stickerSrc: message.sticker?.src || null,
    stickerId: message.sticker?.id || null
  });
}

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

  const content = TEXT_KINDS.has(kind)
    ? cleanMessageText(value.content, 8000)
    : cleanInlineText(value.content, kind === 'sticker' ? 800 : 2400);
  if (TEXT_KINDS.has(kind) && !content) return null;
  const stickerSrc = kind === 'sticker' && SAFE_STICKER_SRC.test(String(value.sticker?.src || ''))
    ? String(value.sticker.src)
    : null;
  if (kind === 'sticker' && !stickerSrc) return null;

  const tsNumber = Number(value.ts);
  return {
    schemaVersion: CHAT_SCHEMA_VERSION,
    id: cleanInlineText(value.id, 100) || `legacy-${index}-${Number.isFinite(tsNumber) ? tsNumber : Date.now()}`,
    requestId: cleanInlineText(value.requestId, 100) || null,
    turnId: cleanInlineText(value.turnId, 120) || null,
    deliveryId: cleanInlineText(value.deliveryId, 120) || null,
    segmentId: cleanInlineText(value.segmentId, 120) || null,
    segmentIndex: Number.isFinite(Number(value.segmentIndex)) ? Math.max(0, Math.round(Number(value.segmentIndex))) : null,
    inReplyTo: cleanInlineText(value.inReplyTo, 100) || null,
    replySnapshot: normalizeReplySnapshot(value.replySnapshot),
    role,
    kind,
    status,
    content,
    ts: Number.isFinite(tsNumber) ? tsNumber : Date.now(),
    ...(kind === 'silence' ? {
      silence: {
        reason: cleanInlineText(value.silence?.reason, 320) || 'осознанное молчание',
        scene: cleanInlineText(value.silence?.scene, 100) || null
      }
    } : {}),
    ...(kind === 'sticker' ? {
      sticker: {
        src: stickerSrc,
        utterance: cleanInlineText(value.sticker.utterance, 300) || null,
        emotion: cleanInlineText(value.sticker.emotion, 80) || null,
        id: cleanInlineText(value.sticker.id, 80) || null,
        meaning: cleanInlineText(value.sticker.meaning, 240) || null,
        cause: cleanInlineText(value.sticker.cause, 280) || null,
        delivery: cleanInlineText(value.sticker.delivery, 40) || null,
        intensity: Math.max(0, Math.min(100, Number(value.sticker.intensity) || 0)),
        canExplain: value.sticker.canExplain !== false,
        expiresAfterTurns: Math.max(0, Math.min(8, Number(value.sticker.expiresAfterTurns) || 0))
      }
    } : {}),
    ...(value.errorCode ? { errorCode: cleanInlineText(value.errorCode, 80) } : {})
  };
}

export function normalizeChatHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .map(normalizeChatMessage)
    .filter(Boolean)
    .slice(-160);
}

export function isTextTurn(message) {
  return Boolean(
    message &&
    ALLOWED_ROLES.has(message.role) &&
    TEXT_KINDS.has(message.kind || 'text') &&
    ['sent', 'complete'].includes(message.status || 'complete') &&
    cleanMessageText(message.content)
  );
}

export function isConversationEvent(message) {
  if (!message || !ALLOWED_ROLES.has(message.role)) return false;
  if (!['sent', 'complete'].includes(message.status || 'complete')) return false;
  if (TEXT_KINDS.has(message.kind || 'text')) return Boolean(cleanMessageText(message.content));
  if (message.role !== 'assistant') return false;
  return message.kind === 'sticker' || message.kind === 'silence';
}

export function conversationEventText(message = {}) {
  if (message.kind === 'silence') {
    return cleanInlineText(`Рин осознанно промолчала: ${message.silence?.reason || 'микросцена завершена'}`, 500);
  }
  if (message.kind === 'sticker') {
    return cleanInlineText(
      message.content || `Невербальный жест Рин: ${message.sticker?.meaning || message.sticker?.emotion || 'эмоция'}${message.sticker?.cause ? `; причина: ${message.sticker.cause}` : ''}`,
      800
    );
  }
  return cleanMessageText(message.content, 8000);
}

export function selectTransportHistory(history = [], options = {}) {
  const includeRequestId = cleanInlineText(options.includeRequestId, 100);
  const selected = normalizeChatHistory(history)
    .filter(message => {
      if (message.role === 'assistant' && TEXT_KINDS.has(message.kind) && isInternalNonverbalMetaText(message.content)) return false;
      if (message.kind === 'sticker' || message.kind === 'silence') return message.role === 'assistant' && message.status === 'complete';
      if (!TEXT_KINDS.has(message.kind)) return false;
      if (message.status === 'complete') return true;
      return message.role === 'user' && message.status === 'sent' && message.requestId === includeRequestId;
    });
  if (!includeRequestId) return selected;
  const current = selected.filter(message => message.role === 'user' && message.requestId === includeRequestId && message.status === 'sent');
  if (!current.length) return selected;
  const currentIds = new Set(current.map(message => message.id));
  return [...selected.filter(message => !currentIds.has(message.id)), ...current];
}

export function selectModelHistory(history = [], options = {}) {
  return selectTransportHistory(history, options).map(message => ({
    id: message.id,
    requestId: message.requestId,
    turnId: message.turnId,
    deliveryId: message.deliveryId,
    segmentId: message.segmentId,
    segmentIndex: message.segmentIndex,
    inReplyTo: message.inReplyTo,
    replySnapshot: message.replySnapshot,
    role: message.role,
    kind: message.kind,
    status: message.status,
    content: conversationEventText(message),
    ...(message.kind === 'sticker' && message.sticker ? { sticker: message.sticker } : {}),
    ...(message.kind === 'silence' && message.silence ? { silence: message.silence } : {}),
    ts: message.ts
  }));
}

export function pruneModelHistory(history = [], maxItems = 32, maxChars = 6500) {
  let slice = (Array.isArray(history) ? history : []).filter(isConversationEvent).slice(-maxItems);
  while (JSON.stringify(slice).length > maxChars && slice.length > 8) slice = slice.slice(1);
  return slice;
}

export function lastUserText(history = []) {
  return [...history].reverse().find(item => item?.role === 'user' && cleanMessageText(item?.content))?.content || '';
}

export function currentUserTurnGroup(history = [], requestId = '') {
  const wanted = cleanInlineText(requestId, 100);
  if (!wanted) return [];
  return (Array.isArray(history) ? history : []).filter(item => item?.role === 'user' && item?.requestId === wanted);
}

export function currentUserTurn(history = [], requestId = '') {
  const group = currentUserTurnGroup(history, requestId);
  if (group.length) return group.at(-1);
  return [...history].reverse().find(item => item?.role === 'user') || null;
}

export function lastConversationEvent(history = []) {
  return [...history].reverse().find(isConversationEvent) || null;
}

export function isExplicitFarewell(value) {
  const text = cleanInlineText(value, 500).toLowerCase();
  if (/(?:до встречи|до завтра|спокойной ночи|доброй ночи|увидимся|до связи|бай|bye)/i.test(text)) return true;
  return /^(?:(?:ну|ладно)[, ]+)?(?:(?:всё|все)[, ]+)?пока[.!…)]*$/i.test(text);
}

export function contentKey(value = '') {
  const text = cleanInlineText(value, 1200).toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `k-${(hash >>> 0).toString(36)}`;
}
