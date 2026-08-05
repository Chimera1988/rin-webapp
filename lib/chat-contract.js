export const CHAT_SCHEMA_VERSION = 5;

const ALLOWED_ROLES = new Set(['user', 'assistant']);
const TEXT_KINDS = new Set(['text', 'voice']);
const ALLOWED_KINDS = new Set(['text', 'voice', 'sticker', 'silence', 'tool_result', 'system']);
const REPLY_KINDS = new Set(['text', 'voice', 'sticker']);
const ALLOWED_STATUSES = new Set(['pending', 'sent', 'complete', 'failed']);

const cleanText = (value, max = 2400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const INTERNAL_NONVERBAL_META = /^\s*\[(?:Невербальный\s+жест|Невербальная\s+реакция|Эмоциональный\s+жест|Стикер)\s+Рин\s*:[\s\S]*\]\s*$/iu;
const SAFE_STICKER_SRC = /^\/stickers\/[a-z0-9_]+\.webp$/iu;

export function isInternalNonverbalMetaText(value = '') {
  return INTERNAL_NONVERBAL_META.test(String(value || ''));
}

export function normalizeReplySnapshot(value = null) {
  if (!value || typeof value !== 'object') return null;
  const role = ALLOWED_ROLES.has(value.role) ? value.role : null;
  const kind = REPLY_KINDS.has(value.kind) ? value.kind : null;
  if (!role || !kind) return null;
  const fallback = kind === 'sticker' ? 'Стикер' : kind === 'voice' ? 'Голосовое сообщение' : '';
  const excerpt = cleanText(value.excerpt || fallback, 360);
  if (!excerpt) return null;
  const stickerSrc = SAFE_STICKER_SRC.test(String(value.stickerSrc || '')) ? String(value.stickerSrc) : null;
  return {
    role,
    kind,
    excerpt,
    stickerSrc: kind === 'sticker' ? stickerSrc : null,
    stickerId: kind === 'sticker' ? cleanText(value.stickerId, 80) || null : null
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
      ? cleanText(message.sticker?.utterance, 240) || 'Стикер'
      : kind === 'voice'
        ? cleanText(message.content, 360) || 'Голосовое сообщение'
        : cleanText(message.content, 360),
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
  const content = cleanText(value.content, kind === 'sticker' ? 500 : 2400);

  if (TEXT_KINDS.has(kind) && !content) return null;
  if (kind === 'sticker' && !value.sticker?.src && !content) return null;

  const tsNumber = Number(value.ts);
  return {
    schemaVersion: CHAT_SCHEMA_VERSION,
    id: cleanText(value.id, 100) || `legacy-${index}-${Number.isFinite(tsNumber) ? tsNumber : Date.now()}`,
    requestId: cleanText(value.requestId, 100) || null,
    inReplyTo: cleanText(value.inReplyTo, 100) || null,
    replySnapshot: normalizeReplySnapshot(value.replySnapshot),
    role,
    kind,
    status,
    content,
    ts: Number.isFinite(tsNumber) ? tsNumber : Date.now(),
    ...(kind === 'silence' ? { silence: { reason: cleanText(value.silence?.reason, 320) || 'осознанное молчание', scene: cleanText(value.silence?.scene, 100) || null } } : {}),
    ...(kind === 'sticker' && value.sticker?.src ? {
      sticker: {
        src: cleanText(value.sticker.src, 500),
        utterance: cleanText(value.sticker.utterance, 300) || null,
        emotion: cleanText(value.sticker.emotion, 80) || null,
        id: cleanText(value.sticker.id, 80) || null,
        meaning: cleanText(value.sticker.meaning, 240) || null,
        cause: cleanText(value.sticker.cause, 280) || null,
        delivery: cleanText(value.sticker.delivery, 40) || null,
        intensity: Math.max(0, Math.min(100, Number(value.sticker.intensity) || 0)),
        canExplain: value.sticker.canExplain !== false,
        expiresAfterTurns: Math.max(0, Math.min(8, Number(value.sticker.expiresAfterTurns) || 0))
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
      if (message.role === 'assistant' && TEXT_KINDS.has(message.kind) && isInternalNonverbalMetaText(message.content)) return false;
      if (message.kind === 'sticker' || message.kind === 'silence') return message.role === 'assistant' && message.status === 'complete';
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
    inReplyTo: message.inReplyTo,
    replySnapshot: message.replySnapshot,
    role: message.role,
    kind: message.kind,
    status: message.status,
    content: message.kind === 'silence'
      ? cleanText(`Рин осознанно промолчала: ${message.silence?.reason || 'микросцена завершена'}`, 500)
      : message.kind === 'sticker'
      ? cleanText(message.content || `Невербальный жест Рин: ${message.sticker?.meaning || message.sticker?.emotion || 'эмоция'}${message.sticker?.cause ? `; причина: ${message.sticker.cause}` : ''}`, 800)
      : cleanText(message.content, 1800),
    ...(message.kind === 'sticker' && message.sticker ? { sticker: message.sticker } : {}),
    ...(message.kind === 'silence' && message.silence ? { silence: message.silence } : {}),
    ts: message.ts
  }));
}

export function pruneModelHistory(history = [], maxItems = 32, maxChars = 6500) {
  let slice = (Array.isArray(history) ? history : []).filter(item => isTextTurn(item) || item?.kind === 'sticker' || item?.kind === 'silence').slice(-maxItems);
  while (JSON.stringify(slice).length > maxChars && slice.length > 8) slice = slice.slice(1);
  return slice;
}

export function lastUserText(history = []) {
  return [...history].reverse().find(item => item?.role === 'user' && cleanText(item?.content))?.content || '';
}

export function currentUserTurn(history = [], requestId = '') {
  const wanted = cleanText(requestId, 100);
  if (wanted) {
    const byRequest = [...history].reverse().find(item => item?.role === 'user' && item?.requestId === wanted);
    if (byRequest) return byRequest;
  }
  return [...history].reverse().find(item => item?.role === 'user') || null;
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
