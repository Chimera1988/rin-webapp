import { normalizeChatMessage, isInternalNonverbalMetaText } from '../../public/lib/chat-contract.js';

export const ARCHIVE_BATCH_LIMIT = 70;
export const ARCHIVE_PAGE_LIMIT = 80;
export const ARCHIVE_MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const safeId = x => typeof x === 'string' && /^[a-z0-9_-]{1,100}$/i.test(x);
export function validArchiveId(value) { return safeId(value); }

// Strict projection: clients cannot supply arbitrary SQL fields, URLs or raw media paths.
export function sanitizeArchiveMessage(raw) {
  if (!raw || !safeId(raw.id)) return null;
  const message = normalizeChatMessage(raw);
  if (!message || message.status !== 'complete' ||
      !['text','voice','sticker','silence'].includes(message.kind)) return null;
  if (message.role === 'assistant' && message.status !== 'complete') return null;
  if (['text','voice'].includes(message.kind) && isInternalNonverbalMetaText(message.content)) return null;
  if (!Number.isSafeInteger(message.ts) || message.ts < 946684800000 || message.ts > Date.now() + 86400000) return null;
  const { media, ...withoutMedia } = message;
  return withoutMedia;
}

export function archiveMessages(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > ARCHIVE_BATCH_LIMIT) return null;
  const messages = value.map(sanitizeArchiveMessage);
  if (messages.some(x=>!x)) return null;
  const ids = messages.map(x=>x.id);
  if (new Set(ids).size !== ids.length) return null;
  return messages;
}

export function archiveCursor({beforeTs, beforeId} = {}) {
  if (beforeTs === undefined && beforeId === undefined) return null;
  const ts = Number(beforeTs);
  if (!Number.isSafeInteger(ts) || ts < 946684800000 || !safeId(beforeId)) return undefined;
  return { ts, id: beforeId };
}

export function cloudMessageWithMedia(row) {
  const payload = row?.payload;
  const message = payload && typeof payload === 'object' ? {...payload} : null;
  if (message && row?.has_audio === true && message.kind === 'voice') message.media = {archived:true,type:'audio'};
  return message;
}
