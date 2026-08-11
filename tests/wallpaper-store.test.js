import test from 'node:test';
import assert from 'node:assert/strict';
import { createWallpaperStore, isWallpaperDataUrl, LEGACY_WALLPAPER_STORAGE_KEY } from '../public/js/wallpaper_store.js';
import { MemoryStorage } from './helpers/runtime.js';

function createFakeIndexedDB() {
  const values = new Map();
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore() {},
    transaction() {
      const transaction = {
        error: null,
        objectStore() {
          return {
            get(key) {
              const request = { result: undefined, error: null };
              queueMicrotask(() => {
                request.result = values.get(key);
                request.onsuccess?.();
              });
              return request;
            },
            put(value, key) {
              values.set(key, value);
              queueMicrotask(() => transaction.oncomplete?.());
            },
            delete(key) {
              values.delete(key);
              queueMicrotask(() => transaction.oncomplete?.());
            }
          };
        }
      };
      return transaction;
    }
  };
  return {
    values,
    open() {
      const request = { result: db, error: null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }
  };
}

const IMAGE = 'data:image/png;base64,aGVsbG8=';

test('wallpaper store validates image data URLs and rejects unrelated payloads', () => {
  assert.equal(isWallpaperDataUrl(IMAGE), true);
  assert.equal(isWallpaperDataUrl('data:text/html;base64,PGgxPk5vPC9oMT4='), false);
  assert.equal(isWallpaperDataUrl('https://example.test/image.png'), false);
});

test('legacy localStorage wallpaper migrates once into IndexedDB', async () => {
  const legacyStorage = new MemoryStorage({ [LEGACY_WALLPAPER_STORAGE_KEY]: IMAGE });
  const indexedDBRef = createFakeIndexedDB();
  const store = createWallpaperStore({ indexedDBRef, legacyStorage });

  assert.equal(await store.get(), IMAGE);
  assert.equal(legacyStorage.getItem(LEGACY_WALLPAPER_STORAGE_KEY), null);
  assert.equal(indexedDBRef.values.get('wallpaper'), IMAGE);

  const secondStore = createWallpaperStore({ indexedDBRef, legacyStorage });
  assert.equal(await secondStore.get(), IMAGE);
});

test('wallpaper write fails closed without IndexedDB while legacy reads and reset remain safe', async () => {
  const legacyStorage = new MemoryStorage({ [LEGACY_WALLPAPER_STORAGE_KEY]: IMAGE });
  const store = createWallpaperStore({ indexedDBRef: null, legacyStorage });
  assert.equal(await store.get(), IMAGE);
  assert.equal(await store.set(IMAGE), false);
  assert.equal(legacyStorage.getItem(LEGACY_WALLPAPER_STORAGE_KEY), IMAGE);
  assert.equal(await store.remove(), true);
  assert.equal(legacyStorage.getItem(LEGACY_WALLPAPER_STORAGE_KEY), null);
});
