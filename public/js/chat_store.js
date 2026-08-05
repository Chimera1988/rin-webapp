export const CHAT_SCHEMA_VERSION = 5;
export const CHAT_STORAGE_KEY = 'rin-history-v5';
export const LEGACY_CHAT_STORAGE_KEYS = ['rin-history-v4', 'rin-history-v3', 'rin-history-v2'];
export const RESETTABLE_STORAGE_KEYS = [
  CHAT_STORAGE_KEY,
  ...LEGACY_CHAT_STORAGE_KEYS,
  'rin-init-count',
  'rin-theme',
  'rin-sticker-prob',
  'rin-sticker-mode',
  'rin-sticker-last-mode',
  'rin-sticker-safe',
  'rin-sticker-opacity',
  'rin-speak-enabled',
  'rin-speak-rate',
  'rin-wallpaper-data',
  'rin-wallpaper-opacity',
  'rin-debug-enabled',
  'rin-profile-v1',
  'rin-diary-v1',
  'rin-lore-recent-v1',
  'rin-stickers-v7-stats',
  'rin-stickers-v6-stats',
  'rin-stickers-v5-stats',
  'rin-memory-analysis-turn',
  'rin-memory-jobs-v1'
];

const ALLOWED_KINDS = new Set(['text', 'voice', 'sticker', 'silence', 'tool_result', 'system']);
const REPLY_KINDS = new Set(['text', 'voice', 'sticker']);
const ALLOWED_STATUSES = new Set(['pending', 'sent', 'complete', 'failed']);
const clean = (value, max = 2400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const INTERNAL_NONVERBAL_META = /^\s*\[(?:Невербальный\s+жест|Невербальная\s+реакция|Эмоциональный\s+жест|Стикер)\s+Рин\s*:[\s\S]*\]\s*$/iu;
const SAFE_STICKER_SRC = /^\/stickers\/[a-z0-9_]+\.webp$/iu;
const randomId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function isInternalNonverbalMetaText(value = '') {
  return INTERNAL_NONVERBAL_META.test(String(value || ''));
}

export function normalizeReplySnapshot(value = null) {
  if (!value || typeof value !== 'object') return null;
  const role = ['user', 'assistant'].includes(value.role) ? value.role : null;
  const kind = REPLY_KINDS.has(value.kind) ? value.kind : null;
  if (!role || !kind) return null;
  const fallback = kind === 'sticker' ? 'Стикер' : kind === 'voice' ? 'Голосовое сообщение' : '';
  const excerpt = clean(value.excerpt || fallback, 360);
  if (!excerpt) return null;
  const stickerSrc = SAFE_STICKER_SRC.test(String(value.stickerSrc || '')) ? String(value.stickerSrc) : null;
  return {
    role,
    kind,
    excerpt,
    stickerSrc: kind === 'sticker' ? stickerSrc : null,
    stickerId: kind === 'sticker' ? clean(value.stickerId, 80) || null : null
  };
}

export function createReplySnapshot(message = null) {
  if (!message || typeof message !== 'object' || !['user', 'assistant'].includes(message.role)) return null;
  const kind = message.sticker?.src || message.kind === 'sticker'
    ? 'sticker'
    : message.kind === 'voice' ? 'voice' : 'text';
  const excerpt = kind === 'sticker'
    ? clean(message.sticker?.utterance, 240) || 'Стикер'
    : kind === 'voice'
      ? clean(message.content, 360) || 'Голосовое сообщение'
      : clean(message.content, 360);
  return normalizeReplySnapshot({
    role: message.role,
    kind,
    excerpt,
    stickerSrc: message.sticker?.src || null,
    stickerId: message.sticker?.id || null
  });
}

export function createSerialQueue(worker) {
  if (typeof worker !== 'function') throw new TypeError('Queue worker must be a function');
  let tail = Promise.resolve();
  return {
    enqueue(value) {
      const result = tail.then(() => worker(value));
      tail = result.catch(() => undefined);
      return result;
    },
    idle() {
      return tail;
    }
  };
}

export function createChatMessage({
  role,
  kind = 'text',
  status = 'complete',
  content = '',
  requestId = null,
  inReplyTo = null,
  replySnapshot = null,
  sticker = null,
  silence = null,
  errorCode = null,
  ts = Date.now(),
  id = null
} = {}) {
  if (!['user', 'assistant'].includes(role)) throw new TypeError('Invalid chat role');
  if (!ALLOWED_KINDS.has(kind)) throw new TypeError('Invalid chat kind');
  if (!ALLOWED_STATUSES.has(status)) throw new TypeError('Invalid chat status');
  const normalizedReply = normalizeReplySnapshot(replySnapshot);
  const message = {
    schemaVersion: CHAT_SCHEMA_VERSION,
    id: clean(id, 100) || randomId(role),
    requestId: clean(requestId, 100) || null,
    inReplyTo: clean(inReplyTo, 100) || null,
    replySnapshot: normalizedReply,
    role,
    kind,
    status,
    content: clean(content),
    ts: Number.isFinite(Number(ts)) ? Number(ts) : Date.now(),
    ...(clean(errorCode, 80) ? { errorCode: clean(errorCode, 80) } : {})
  };
  if (kind === 'silence') {
    message.silence = { reason: clean(silence?.reason, 320) || 'осознанное молчание', scene: clean(silence?.scene, 100) || null };
  }
  if (kind === 'sticker' && sticker?.src) {
    message.sticker = {
      src: clean(sticker.src, 500),
      utterance: clean(sticker.utterance, 300) || null,
      emotion: clean(sticker.emotion, 80) || null,
      id: clean(sticker.id, 80) || null,
      meaning: clean(sticker.meaning, 240) || null,
      cause: clean(sticker.cause, 280) || null,
      delivery: clean(sticker.delivery, 40) || null,
      intensity: Math.max(0, Math.min(100, Number(sticker.intensity) || 0)),
      canExplain: sticker.canExplain !== false,
      expiresAfterTurns: Math.max(0, Math.min(8, Number(sticker.expiresAfterTurns) || 0))
    };
  }
  return message;
}

export function normalizeStoredMessage(value, index = 0) {
  if (!value || typeof value !== 'object' || !['user', 'assistant'].includes(value.role)) return null;
  const kind = value.type === 'sticker' || value.sticker?.src
    ? 'sticker'
    : value.kind == null ? 'text' : ALLOWED_KINDS.has(value.kind) ? value.kind : null;
  const status = value.status == null ? 'complete' : ALLOWED_STATUSES.has(value.status) ? value.status : null;
  if (!kind || !status) return null;
  try {
    return createChatMessage({
      ...value,
      id: value.id || `legacy-${index}-${value.ts || Date.now()}`,
      kind,
      status,
      replySnapshot: value.replySnapshot || null,
      sticker: value.sticker || null,
      silence: value.silence || null
    });
  } catch {
    return null;
  }
}

export function normalizeStoredHistory(value) {
  const normalized = (Array.isArray(value) ? value : [])
    .map(normalizeStoredMessage)
    .filter(Boolean)
    .filter(message => !(message.role === 'assistant' && ['text', 'voice'].includes(message.kind) && isInternalNonverbalMetaText(message.content)));
  const textIds = new Set(normalized.filter(item => ['text','voice','silence'].includes(item.kind)).slice(-140).map(item => item.id));
  const visualIds = new Set(normalized.filter(item => !['text','voice'].includes(item.kind)).slice(-40).map(item => item.id));
  return normalized.filter(item => textIds.has(item.id) || visualIds.has(item.id));
}

export function safeStorageGet(storage, key, fallback = null) {
  try {
    const value = storage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function safeStorageRemove(storage, key) {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function safeStorageSet(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch (error) {
    console.error(`[Rin storage] failed to write ${key}`, error);
    return false;
  }
}

export function loadChatHistory(storage = localStorage) {
  let raw = safeStorageGet(storage, CHAT_STORAGE_KEY);
  if (!raw) {
    for (const key of LEGACY_CHAT_STORAGE_KEYS) {
      raw = safeStorageGet(storage, key);
      if (raw) break;
    }
  }
  let parsed = [];
  try { parsed = JSON.parse(raw || '[]'); } catch { parsed = []; }
  const normalized = normalizeStoredHistory(parsed).map(message => (
    message.role === 'user' && ['pending', 'sent'].includes(message.status)
      ? { ...message, status: 'failed', errorCode: 'INTERRUPTED_REQUEST' }
      : message
  ));
  saveChatHistory(normalized, storage);
  LEGACY_CHAT_STORAGE_KEYS.forEach(key => safeStorageRemove(storage, key));
  return normalized;
}

export function saveChatHistory(history, storage = localStorage) {
  return safeStorageSet(storage, CHAT_STORAGE_KEY, JSON.stringify(normalizeStoredHistory(history)));
}

export function updateMessage(history, id, patch = {}) {
  const index = history.findIndex(item => item.id === id);
  if (index < 0) return null;
  const next = normalizeStoredMessage({ ...history[index], ...patch }, index);
  if (!next) return null;
  history[index] = next;
  return next;
}

export function toApiHistory(history, requestId) {
  const selected = normalizeStoredHistory(history)
    .filter(message => {
      if (message.kind === 'sticker' || message.kind === 'silence') return message.role === 'assistant' && message.status === 'complete';
      if (!['text', 'voice'].includes(message.kind)) return false;
      if (message.status === 'complete') return true;
      return message.role === 'user' && message.status === 'sent' && message.requestId === requestId;
    });
  const currentIndex = selected.findIndex(message => message.role === 'user' && message.requestId === requestId && message.status === 'sent');
  if (currentIndex >= 0 && currentIndex !== selected.length - 1) selected.push(selected.splice(currentIndex, 1)[0]);
  return selected.map(message => ({
    schemaVersion: CHAT_SCHEMA_VERSION,
    id: message.id,
    requestId: message.requestId,
    inReplyTo: message.inReplyTo,
    replySnapshot: message.replySnapshot,
    role: message.role,
    kind: message.kind,
    status: message.status,
    content: message.content,
    ...(message.kind === 'sticker' ? { sticker: message.sticker } : {}),
    ...(message.kind === 'silence' ? { silence: message.silence } : {}),
    ts: message.ts
  }));
}

export function hasBlockingTurn(history) {
  const lastText = [...normalizeStoredHistory(history)].reverse().find(message => ['text', 'voice'].includes(message.kind));
  return Boolean(lastText && lastText.role === 'user' && ['pending', 'sent', 'failed'].includes(lastText.status));
}

export function resetApplicationStorage(storage = localStorage, { preservePin = true } = {}) {
  RESETTABLE_STORAGE_KEYS.forEach(key => safeStorageRemove(storage, key));
  if (!preservePin) safeStorageRemove(storage, 'rin-pin');
}
