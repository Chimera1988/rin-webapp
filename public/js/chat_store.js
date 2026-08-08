import {
  CHAT_SCHEMA_VERSION,
  cleanInlineText,
  isInternalNonverbalMetaText,
  lastConversationEvent,
  normalizeChatMessage,
  normalizeReplySnapshot,
  replySnapshotFromMessage,
  selectTransportHistory
} from '../lib/chat-contract.js';

export { CHAT_SCHEMA_VERSION, isInternalNonverbalMetaText, normalizeReplySnapshot };
export const CHAT_STORAGE_KEY = 'rin-history-v5';
export const LEGACY_CHAT_STORAGE_KEYS = ['rin-history-v4', 'rin-history-v3', 'rin-history-v2'];
export const RESETTABLE_STORAGE_KEYS = [
  CHAT_STORAGE_KEY,
  ...LEGACY_CHAT_STORAGE_KEYS,
  'rin-init-count', 'rin-theme', 'rin-sticker-prob', 'rin-sticker-mode', 'rin-sticker-last-mode',
  'rin-sticker-safe', 'rin-sticker-opacity', 'rin-speak-enabled', 'rin-speak-rate', 'rin-wallpaper-data',
  'rin-wallpaper-opacity', 'rin-debug-enabled', 'rin-profile-v1', 'rin-diary-v1', 'rin-lore-recent-v1',
  'rin-stickers-v7-stats', 'rin-stickers-v6-stats', 'rin-stickers-v5-stats', 'rin-memory-analysis-turn',
  'rin-memory-jobs-v1'
];

const clean = cleanInlineText;
const randomId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function createReplySnapshot(message = null) {
  return replySnapshotFromMessage(message);
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

export function createChatMessage(input = {}) {
  const role = input?.role;
  const kind = input?.kind ?? 'text';
  const status = input?.status ?? 'complete';
  if (!['user', 'assistant'].includes(role)) throw new TypeError('Invalid chat role');
  if (!['text', 'voice', 'sticker', 'silence', 'tool_result', 'system'].includes(kind)) throw new TypeError('Invalid chat kind');
  if (!['pending', 'sent', 'complete', 'failed'].includes(status)) throw new TypeError('Invalid chat status');
  const message = normalizeChatMessage({
    ...input,
    role,
    kind,
    status,
    id: clean(input.id, 100) || randomId(role),
    ts: Number.isFinite(Number(input.ts)) ? Number(input.ts) : Date.now()
  });
  if (!message) throw new TypeError('Invalid chat message');
  return message;
}

export function normalizeStoredMessage(value, index = 0) {
  const normalized = normalizeChatMessage({
    ...(value && typeof value === 'object' ? value : {}),
    id: value?.id || `legacy-${index}-${value?.ts || Date.now()}`
  }, index);
  return normalized;
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
  return selectTransportHistory(normalizeStoredHistory(history), { includeRequestId: requestId })
    .map(message => ({ ...message, schemaVersion: CHAT_SCHEMA_VERSION }));
}

export function hasBlockingTurn(history) {
  const normalized = normalizeStoredHistory(history);
  const pendingUser = [...normalized].reverse().find(message => message.role === 'user' && ['pending', 'sent', 'failed'].includes(message.status));
  const lastEvent = lastConversationEvent(normalized);
  return Boolean(pendingUser && (!lastEvent || lastEvent.role === 'user' || Number(pendingUser.ts) >= Number(lastEvent.ts || 0)));
}

export function resetApplicationStorage(storage = localStorage, { preservePin = true } = {}) {
  RESETTABLE_STORAGE_KEYS.forEach(key => safeStorageRemove(storage, key));
  if (!preservePin) safeStorageRemove(storage, 'rin-pin');
}
