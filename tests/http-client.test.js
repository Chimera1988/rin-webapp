import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticatedHeaders,
  fetchWithTimeout,
  getStoredPin,
  removeStoredPin,
  storePin
} from '../public/js/http_client.js';
import { MemoryStorage } from './helpers/runtime.js';

test('client PIN helpers use one storage contract and tolerate unavailable storage', () => {
  const storage = new MemoryStorage();
  assert.equal(storePin(' 2468 ', storage), true);
  assert.equal(getStoredPin(storage), '2468');
  assert.equal(authenticatedHeaders({ Accept: 'application/json' }, storage)['X-Rin-Pin'], '2468');
  assert.equal(removeStoredPin(storage), true);
  assert.equal(getStoredPin(storage), '');

  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); }
  };
  assert.equal(getStoredPin(blocked), '');
  assert.equal(storePin('1', blocked), false);
  assert.equal(removeStoredPin(blocked), false);
});

test('client fetch policy aborts stalled requests with a retryable AbortError', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  try {
    await assert.rejects(
      fetchWithTimeout('/slow', {}, 5),
      error => error?.name === 'AbortError'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
