import { storageGet, storageSetVerified } from './storage.js';

/**
 * Small adapter that binds the generic storage helpers to one concrete Storage
 * instance. Keeping this boundary explicit prevents accidental calls such as
 * storageGet(key) where the key is mistaken for the storage object.
 */
export function createLocalSettings(storage) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new TypeError('A Web Storage-compatible object is required');
  }

  return Object.freeze({
    get(key, fallback = null) {
      return storageGet(storage, key, fallback);
    },
    set(key, value) {
      return storageSetVerified(storage, key, value);
    }
  });
}
