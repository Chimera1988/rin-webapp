export function storageGet(storage, key, fallback = null) {
  try {
    const value = storage?.getItem?.(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function storageSet(storage, key, value, { log = true } = {}) {
  try {
    storage?.setItem?.(key, String(value));
    return true;
  } catch (error) {
    if (log) console.error(`[Rin storage] failed to write ${key}`, error);
    return false;
  }
}

export function storageRemove(storage, key) {
  try {
    storage?.removeItem?.(key);
    return true;
  } catch {
    return false;
  }
}

export function storageReadJson(storage, key, fallback = null) {
  const raw = storageGet(storage, key, null);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function storageWriteJson(storage, key, value, options = {}) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    if (options.log !== false) console.error(`[Rin storage] failed to serialize ${key}`, error);
    return false;
  }
  return storageSet(storage, key, encoded, options);
}
