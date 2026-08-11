import { storageReadJson, storageRemove, storageWriteJson } from './storage.js';

export const INITIATION_STATE_KEY = 'rin-init-state-v2';
export const LEGACY_INITIATION_COUNT_KEY = 'rin-init-count';
const STATE_SCHEMA = 'rin-init-state-v2';

function cleanDateKey(value = '') {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function cleanWindowKey(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function normalizeDay(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    sent: Math.max(0, Math.min(20, Math.round(Number(source.sent) || 0))),
    attemptedWindowKeys: [...new Set(
      (Array.isArray(source.attemptedWindowKeys) ? source.attemptedWindowKeys : [])
        .map(cleanWindowKey)
        .filter(Boolean)
    )].slice(-16)
  };
}

function normalizeState(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const days = {};
  for (const [dateKey, day] of Object.entries(source.days || {})) {
    const cleanDate = cleanDateKey(dateKey);
    if (cleanDate) days[cleanDate] = normalizeDay(day);
  }
  const recentDates = Object.keys(days).sort().slice(-8);
  return {
    schema: STATE_SCHEMA,
    days: Object.fromEntries(recentDates.map(key => [key, days[key]]))
  };
}

function migrateLegacyCounts(storage) {
  const legacy = storageReadJson(storage, LEGACY_INITIATION_COUNT_KEY, null);
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return null;
  const days = {};
  for (const [dateKey, count] of Object.entries(legacy)) {
    const cleanDate = cleanDateKey(dateKey);
    if (!cleanDate) continue;
    days[cleanDate] = { sent: Math.max(0, Math.round(Number(count) || 0)), attemptedWindowKeys: [] };
  }
  storageRemove(storage, LEGACY_INITIATION_COUNT_KEY);
  return normalizeState({ schema: STATE_SCHEMA, days });
}

export function createInitiationStateStore(storage = localStorage) {
  function read() {
    const current = storageReadJson(storage, INITIATION_STATE_KEY, null);
    if (current) return normalizeState(current);
    const migrated = migrateLegacyCounts(storage);
    if (migrated) {
      storageWriteJson(storage, INITIATION_STATE_KEY, migrated);
      return migrated;
    }
    return normalizeState({});
  }

  function write(state) {
    return storageWriteJson(storage, INITIATION_STATE_KEY, normalizeState(state));
  }

  function getDay(dateKey) {
    const cleanDate = cleanDateKey(dateKey);
    if (!cleanDate) return normalizeDay({});
    return normalizeDay(read().days[cleanDate]);
  }

  function updateDay(dateKey, mutator) {
    const cleanDate = cleanDateKey(dateKey);
    if (!cleanDate) return false;
    const state = read();
    const day = normalizeDay(state.days[cleanDate]);
    mutator(day);
    state.days[cleanDate] = normalizeDay(day);
    return write(state);
  }

  return {
    getSentCount(dateKey) {
      return getDay(dateKey).sent;
    },
    hasAttempted(dateKey, windowKey) {
      const key = cleanWindowKey(windowKey);
      return Boolean(key && getDay(dateKey).attemptedWindowKeys.includes(key));
    },
    recordAttempt(dateKey, windowKey) {
      const key = cleanWindowKey(windowKey);
      if (!key) return false;
      return updateDay(dateKey, day => {
        day.attemptedWindowKeys = [...new Set([...day.attemptedWindowKeys, key])].slice(-16);
      });
    },
    recordSent(dateKey) {
      return updateDay(dateKey, day => { day.sent += 1; });
    },
    reset() {
      return storageRemove(storage, INITIATION_STATE_KEY);
    }
  };
}
