import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitiationStateStore, INITIATION_STATE_KEY, LEGACY_INITIATION_COUNT_KEY } from '../public/js/initiation_state.js';
import { MemoryStorage } from './helpers/runtime.js';

test('legacy daily counters migrate once into the v2 initiation state', () => {
  const storage = new MemoryStorage({ [LEGACY_INITIATION_COUNT_KEY]: JSON.stringify({ '2026-08-11': 1 }) });
  const state = createInitiationStateStore(storage);
  assert.equal(state.getSentCount('2026-08-11'), 1);
  assert.equal(storage.getItem(LEGACY_INITIATION_COUNT_KEY), null);
  assert.match(storage.getItem(INITIATION_STATE_KEY) || '', /rin-init-state-v2/);
});

test('a schedule window can be attempted only once across store reloads', () => {
  const storage = new MemoryStorage();
  let state = createInitiationStateStore(storage);
  assert.equal(state.hasAttempted('2026-08-11', 'day_ping'), false);
  assert.equal(state.recordAttempt('2026-08-11', 'day_ping'), true);
  assert.equal(state.hasAttempted('2026-08-11', 'day_ping'), true);

  state = createInitiationStateStore(storage);
  assert.equal(state.hasAttempted('2026-08-11', 'day_ping'), true);
  assert.equal(state.recordSent('2026-08-11'), true);
  assert.equal(state.getSentCount('2026-08-11'), 1);
});

test('failed persistence refuses an initiation attempt instead of enabling re-rolls', () => {
  const storage = {
    getItem() { return null; },
    setItem() { throw new Error('quota'); },
    removeItem() {}
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const state = createInitiationStateStore(storage);
    assert.equal(state.recordAttempt('2026-08-11', 'morning'), false);
  } finally {
    console.error = originalError;
  }
});

test('legacy initiation counters remain intact when v2 migration persistence fails', () => {
  const legacyValue = JSON.stringify({ '2026-08-11': 2 });
  const storage = new MemoryStorage({ [LEGACY_INITIATION_COUNT_KEY]: legacyValue });
  const originalSet = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (String(key) === INITIATION_STATE_KEY) throw new Error('quota');
    originalSet(key, value);
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const state = createInitiationStateStore(storage);
    assert.equal(state.getSentCount('2026-08-11'), 2);
    assert.equal(storage.getItem(INITIATION_STATE_KEY), null);
    assert.equal(storage.getItem(LEGACY_INITIATION_COUNT_KEY), legacyValue);
  } finally {
    console.error = originalError;
  }
});
