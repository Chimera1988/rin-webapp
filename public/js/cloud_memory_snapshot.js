// Browser-safe, one-way snapshot creation: no Node-only imports, no local writes.
// Shared with the server to make hash verification deterministic across runtimes.
const safeObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const safeArray = (value, max) => Array.isArray(value) ? value.slice(-max) : [];
import { normalizePersonalActions } from '../lib/action-lifecycle.js';
import { correctKnownMemoryEvents } from '../lib/memory-attribution.js';
const SECRET_KEY = /(?:password|passwd|api[_-]?key|secret|token|credential|access[_-]?pin|private[_-]?key)/iu;
function safeFactMap(value, depth = 0) {
  if (depth > 8) return {};
  const source = safeObject(value), out = {};
  for (const [key, item] of Object.entries(source).slice(0, 90)) {
    if (SECRET_KEY.test(key) || item == null) continue;
    if (typeof item === 'string') out[key] = item.slice(0, 2000);
    else if (typeof item === 'number' && Number.isFinite(item) || typeof item === 'boolean') out[key] = item;
    else if (item && typeof item === 'object' && !Array.isArray(item)) out[key] = safeFactMap(item, depth + 1);
  }
  return out;
}
export function snapshotBody(diary = {}) {
  const source = safeObject(diary);
  const relationship = safeObject(source.relationship);
  return {
    schema_version: Math.max(1, Math.min(99, Math.round(Number(source._schema) || 9))),
    client_updated_at_ms: Number.isSafeInteger(Number(source._updated_at)) && source._updated_at != null
      ? Number(source._updated_at) : null,
    facts: safeFactMap(source.facts),
    events: correctKnownMemoryEvents(safeArray(source.events, 120)),
    summaries: safeArray(source.summaries, 12),
    shared_moments: safeArray(relationship.sharedMoments, 20),
    shared_symbols: safeArray(relationship.sharedSymbols, 12),
    personal_actions: normalizePersonalActions(source.innerLife?.personalActions)
  };
}
export function snapshotContentBytes(body) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  if (bytes.byteLength > 300_000) throw new Error('MEMORY_SNAPSHOT_TOO_LARGE');
  return bytes;
}
export async function prepareClientSnapshot(diary = {}, cryptoObject = globalThis.crypto) {
  if (!cryptoObject?.subtle?.digest) throw new Error('MEMORY_CRYPTO_UNAVAILABLE');
  const body = snapshotBody(diary);
  const bytes = snapshotContentBytes(body);
  const digest = new Uint8Array(await cryptoObject.subtle.digest('SHA-256', bytes));
  const snapshot_hash = Array.from(digest, x => x.toString(16).padStart(2, '0')).join('');
  return { ...body, snapshot_hash };
}
