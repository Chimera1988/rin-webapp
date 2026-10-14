import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticatedHeaders,
  fetchWithTimeout,
  getStoredPin,
  removeStoredPin,
  setCsrfToken
} from '../public/js/http_client.js';
import { MemoryStorage } from './helpers/runtime.js';

test('client uses transient CSRF headers, not persistent PIN, and can delete legacy data',()=>{
  const storage=new MemoryStorage({'rin-pin':' 2468 '});
  assert.equal(getStoredPin(storage),'2468');
  assert.equal(authenticatedHeaders({Accept:'application/json'})['X-Rin-Pin'],undefined);
  setCsrfToken('temporary-csrf');
  assert.equal(authenticatedHeaders()['X-Rin-CSRF'],'temporary-csrf');
  setCsrfToken('');
  assert.equal(authenticatedHeaders()['X-Rin-CSRF'],undefined);
  assert.equal(removeStoredPin(storage),true);
  assert.equal(storage.getItem('rin-pin'),null);
  const blocked={getItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
  assert.equal(getStoredPin(blocked),'');
  assert.equal(removeStoredPin(blocked),false);
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
