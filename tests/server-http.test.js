import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout, publicError, readJsonBody, requestPin, requireMethod } from '../lib/server/http.js';

test('server HTTP helpers accept parsed bodies and one PIN header contract', async () => {
  const req = { body: { value: 1 }, headers: { 'x-rin-pin': '1357' } };
  assert.deepEqual(await readJsonBody(req), { value: 1 });
  assert.equal(requestPin(req, {}), '1357');
});

test('server timeout maps to a public error without upstream details', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  try {
    let caught;
    try { await fetchWithTimeout('https://example.invalid', {}, 5); } catch (error) { caught = error; }
    const mapped = publicError(caught, 'Safe failure');
    assert.equal(mapped.status, 504);
    assert.deepEqual(mapped.body, { error: 'Upstream timeout', code: 'UPSTREAM_TIMEOUT' });
    assert.doesNotMatch(JSON.stringify(mapped), /example\.invalid|request_timeout/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('server method guard has one canonical 405 contract', () => {
  const res = { statusCode: 200, headers: {}, body: null, setHeader(k,v){ this.headers[k]=v; }, status(code){ this.statusCode=code; return this; }, json(body){ this.body=body; return this; } };
  assert.equal(requireMethod({ method: 'GET' }, res, 'POST'), false);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
  assert.deepEqual(res.body, { error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
  assert.equal(requireMethod({ method: 'post' }, res, 'POST'), true);
});
