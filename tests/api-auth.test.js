import test from 'node:test';
import assert from 'node:assert/strict';
import { createReq, createRes } from './helpers/runtime.js';

const originalPin = process.env.ACCESS_PIN;
process.env.ACCESS_PIN = '2468';

const handlers = {
  login: (await import('../api/login.js?auth')).default,
  chat: (await import('../api/chat.js?auth')).default,
  memory: (await import('../api/memory.js?auth')).default,
  tts: (await import('../api/tts.js?auth')).default,
  weather: (await import('../api/weather.js?auth')).default
};

test.after(() => {
  if (originalPin === undefined) delete process.env.ACCESS_PIN;
  else process.env.ACCESS_PIN = originalPin;
});

test('all communication endpoints share the same PIN guard', async () => {
  for (const [name, handler] of Object.entries(handlers)) {
    const req = createReq({
      method: name === 'weather' ? 'GET' : 'POST',
      headers: { 'x-rin-pin': 'wrong' },
      body: {}
    });
    const res = createRes();
    await handler(req, res);
    assert.equal(res.statusCode, 401, name);
    assert.equal(res.body.code, 'UNAUTHORIZED', name);
  }
});

test('login accepts only the configured PIN', async () => {
  const res = createRes();
  await handlers.login(createReq({ headers: { 'x-rin-pin': '2468' }, body: {} }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('all communication endpoints reject unsupported methods before handler-specific work', async () => {
  for (const [name, handler] of Object.entries(handlers)) {
    const req = createReq({
      method: name === 'weather' ? 'POST' : 'GET',
      headers: { 'x-rin-pin': '2468' },
      body: {}
    });
    const res = createRes();
    await handler(req, res);
    assert.equal(res.statusCode, 405, name);
    assert.equal(res.body.code, 'METHOD_NOT_ALLOWED', name);
    assert.equal(res.headers.allow, name === 'weather' ? 'GET' : 'POST', name);
  }
});
