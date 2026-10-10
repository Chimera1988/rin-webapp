import { RESETTABLE_STORAGE_KEYS, CHAT_STORAGE_KEY } from './chat_store.js';
import { isWallpaperDataUrl } from './wallpaper_store.js';

export const RIN_BACKUP_FORMAT = 'rin-local-backup';
export const RIN_BACKUP_VERSION = 1;
const KEYS = Object.freeze([...new Set(RESETTABLE_STORAGE_KEYS.filter(key => key !== 'rin-pin'))].sort());
const MAX_IMPORT_BYTES = 24 * 1024 * 1024;

function currentCrypto(cryptoRef) {
  const subtle = cryptoRef?.subtle;
  if (!subtle?.digest) throw new Error('CRYPTO_UNAVAILABLE');
  return subtle;
}

async function sha256(content, cryptoRef) {
  const digest = await currentCrypto(cryptoRef).digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function snapshotKeys(storage) {
  const values = Object.create(null);
  for (const key of KEYS) {
    const value = storage.getItem(key);
    if (value !== null) values[key] = value;
  }
  return values;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('BACKUP_DATA_INVALID');
  if (!payload.storage || typeof payload.storage !== 'object' || Array.isArray(payload.storage)) throw new Error('BACKUP_DATA_INVALID');
  const storage = Object.create(null);
  for (const [key, value] of Object.entries(payload.storage)) {
    if (!KEYS.includes(key) || typeof value !== 'string') throw new Error('BACKUP_STORAGE_INVALID');
    storage[key] = value;
  }
  for (const key of [CHAT_STORAGE_KEY, 'rin-diary-v1', 'rin-profile-v1', 'rin-init-state-v2', 'rin-memory-jobs-v1']) {
    if (!Object.hasOwn(storage, key)) continue;
    let data;
    try { data = JSON.parse(storage[key]); } catch { throw new Error('BACKUP_STORAGE_INVALID'); }
    if (key === CHAT_STORAGE_KEY && !Array.isArray(data)) throw new Error('BACKUP_STORAGE_INVALID');
    if (key !== CHAT_STORAGE_KEY && (!data || typeof data !== 'object')) throw new Error('BACKUP_STORAGE_INVALID');
  }
  if (typeof payload.wallpaper !== 'string' || (payload.wallpaper && !isWallpaperDataUrl(payload.wallpaper))) {
    throw new Error('BACKUP_WALLPAPER_INVALID');
  }
  return { storage, wallpaper: payload.wallpaper };
}

export function backupSummary(payload) {
  let count = 0;
  try {
    const history = JSON.parse(payload?.storage?.[CHAT_STORAGE_KEY] || '[]');
    count = Array.isArray(history) ? history.length : 0;
  } catch { /* validation will raise on import */ }
  return { messages: count, keys: Object.keys(payload?.storage || {}).length, wallpaper: Boolean(payload?.wallpaper) };
}

export async function createBackup({ storage, wallpaperStore, cryptoRef = globalThis.crypto, now = Date.now() }) {
  if (!storage || !wallpaperStore) throw new Error('BACKUP_ENVIRONMENT_INVALID');
  const payload = validatePayload({ storage: snapshotKeys(storage), wallpaper: await wallpaperStore.get() || '' });
  const date = new Date(now).toISOString();
  const document = {
    format: RIN_BACKUP_FORMAT,
    version: RIN_BACKUP_VERSION,
    createdAt: date,
    payload,
    digest: await sha256(JSON.stringify(payload), cryptoRef)
  };
  return { json: JSON.stringify(document, null, 2), filename: `rin-backup-${date.slice(0, 10)}-${date.slice(11, 16).replace(':', '-')}.json`, summary: backupSummary(payload) };
}

export async function parseBackup(raw, { cryptoRef = globalThis.crypto } = {}) {
  if (typeof raw !== 'string' || new Blob([raw]).size > MAX_IMPORT_BYTES) throw new Error('BACKUP_SIZE_INVALID');
  let file;
  try { file = JSON.parse(raw); } catch { throw new Error('BACKUP_JSON_INVALID'); }
  if (file?.format !== RIN_BACKUP_FORMAT || file?.version !== RIN_BACKUP_VERSION || typeof file?.createdAt !== 'string' || !Number.isFinite(Date.parse(file.createdAt))) {
    throw new Error('BACKUP_FORMAT_UNSUPPORTED');
  }
  if (!/^[0-9a-f]{64}$/.test(file.digest || '')) throw new Error('BACKUP_CHECKSUM_INVALID');
  const payload = validatePayload(file.payload);
  if (await sha256(JSON.stringify(file.payload), cryptoRef) !== file.digest) throw new Error('BACKUP_CHECKSUM_INVALID');
  return { payload, createdAt: file.createdAt, summary: backupSummary(payload) };
}

export async function restoreBackup(backup, { storage, wallpaperStore }) {
  if (!storage || !wallpaperStore) throw new Error('BACKUP_ENVIRONMENT_INVALID');
  // Import is validated before any write. Recover local data on ordinary write failures.
  const incoming = validatePayload(backup?.payload);
  const previous = snapshotKeys(storage);
  const previousWallpaper = await wallpaperStore.get() || '';
  let changed = false;
  try {
    changed = true;
    for (const key of KEYS) {
      if (Object.hasOwn(incoming.storage, key)) {
        const value = incoming.storage[key];
        storage.setItem(key, value);
        if (storage.getItem(key) !== value) throw new Error('BACKUP_WRITE_FAILED');
      } else storage.removeItem(key);
    }
    const wallpaperOk = incoming.wallpaper
      ? await wallpaperStore.set(incoming.wallpaper)
      : await wallpaperStore.remove();
    if (!wallpaperOk) throw new Error('BACKUP_WALLPAPER_WRITE_FAILED');
  } catch (error) {
    if (changed) {
      let rollbackFailed = false;
      for (const key of KEYS) {
        try {
          if (Object.hasOwn(previous, key)) storage.setItem(key, previous[key]);
          else storage.removeItem(key);
        } catch { rollbackFailed = true; }
      }
      try {
        const reverted = previousWallpaper
          ? await wallpaperStore.set(previousWallpaper)
          : await wallpaperStore.remove();
        if (!reverted) rollbackFailed = true;
      } catch { rollbackFailed = true; }
      if (rollbackFailed) throw new Error('BACKUP_ROLLBACK_FAILED', { cause: error });
    }
    throw error;
  }
  return true;
}

export const MAX_BACKUP_IMPORT_BYTES = MAX_IMPORT_BYTES;
