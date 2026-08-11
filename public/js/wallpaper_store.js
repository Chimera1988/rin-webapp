import { storageGet, storageRemove } from './storage.js';

export const LEGACY_WALLPAPER_STORAGE_KEY = 'rin-wallpaper-data';
const DB_NAME = 'rin-media-v1';
const DB_VERSION = 1;
const STORE_NAME = 'assets';
const WALLPAPER_KEY = 'wallpaper';

export function isWallpaperDataUrl(value = '') {
  return /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/iu.test(String(value || ''));
}

function openDatabase(indexedDBRef) {
  if (!indexedDBRef?.open) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDBRef.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('WALLPAPER_DB_OPEN_FAILED'));
    request.onblocked = () => reject(new Error('WALLPAPER_DB_BLOCKED'));
  });
}

function databaseGet(db) {
  if (!db) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(WALLPAPER_KEY);
    request.onsuccess = () => resolve(isWallpaperDataUrl(request.result) ? request.result : null);
    request.onerror = () => reject(request.error || new Error('WALLPAPER_DB_READ_FAILED'));
  });
}

function databasePut(db, data) {
  if (!db) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(data, WALLPAPER_KEY);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error || new Error('WALLPAPER_DB_WRITE_FAILED'));
    transaction.onabort = () => reject(transaction.error || new Error('WALLPAPER_DB_WRITE_ABORTED'));
  });
}

function databaseDelete(db) {
  if (!db) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(WALLPAPER_KEY);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error || new Error('WALLPAPER_DB_DELETE_FAILED'));
    transaction.onabort = () => reject(transaction.error || new Error('WALLPAPER_DB_DELETE_ABORTED'));
  });
}

export function createWallpaperStore({ indexedDBRef = globalThis.indexedDB, legacyStorage = globalThis.localStorage } = {}) {
  let dbPromise = null;
  const database = () => {
    if (!dbPromise) dbPromise = openDatabase(indexedDBRef).catch(() => null);
    return dbPromise;
  };

  return {
    async get() {
      const db = await database();
      const stored = await databaseGet(db).catch(() => null);
      if (stored) return stored;

      const legacy = storageGet(legacyStorage, LEGACY_WALLPAPER_STORAGE_KEY, '');
      if (!isWallpaperDataUrl(legacy)) return '';
      if (db && await databasePut(db, legacy).catch(() => false)) storageRemove(legacyStorage, LEGACY_WALLPAPER_STORAGE_KEY);
      return legacy;
    },
    async set(data) {
      if (!isWallpaperDataUrl(data)) return false;
      const db = await database();
      if (!db) return false;
      const saved = await databasePut(db, data).catch(() => false);
      if (saved) storageRemove(legacyStorage, LEGACY_WALLPAPER_STORAGE_KEY);
      return saved;
    },
    async remove() {
      storageRemove(legacyStorage, LEGACY_WALLPAPER_STORAGE_KEY);
      const db = await database();
      return databaseDelete(db).catch(() => false);
    }
  };
}
