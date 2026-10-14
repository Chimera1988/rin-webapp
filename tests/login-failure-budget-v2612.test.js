import test from 'node:test';
import assert from 'node:assert/strict';
import loginHandler from '../api/login.js';
import { setSessionRedisForTests } from '../lib/server/session.js';
import { setSecurityRedisForTests } from '../lib/server/security-gate.js';
import { createReq, createRes } from './helpers/runtime.js';

const originalPin = process.env.ACCESS_PIN;
process.env.ACCESS_PIN = 'test-2612-strong-pin';
const originalSessionKey=process.env.RIN_PUSH_DATA_KEY;
process.env.RIN_PUSH_DATA_KEY=Buffer.alloc(32,43).toString('base64url');
setSessionRedisForTests({async set(){return 'OK';}});

function redisHarness() {
  let seconds = 0;
  let evals = 0;
  const values = new Map();
  const client = {
    values,
    get evals() { return evals; },
    advance(delta) { seconds += delta; },
    async eval(script, keys, args) {
      assert.match(script, /RIN_LOGIN_FAILURE_WINDOW/);
      evals += 1;
      const recordFailure = args[0] === '1';
      let block = 0;
      let retry = 0;
      for (let i = 0; i < keys.length; i += 1) {
        const lifetime = Number(args[2 * i + 1]);
        const max = Number(args[2 * i + 2]);
        let rec = values.get(keys[i]);
        if (rec && rec.expires <= seconds) { values.delete(keys[i]); rec = undefined; }
        let current = rec?.count || 0;
        if (recordFailure) {
          current += 1;
          values.set(keys[i], { count: current, expires: rec?.expires ?? seconds + lifetime });
        }
        const ttl = rec ? Math.ceil(rec.expires - seconds) : (recordFailure ? lifetime : -2);
        if ((recordFailure && current > max) || (!recordFailure && current >= max)) {
          if (!block) block = i + 1;
          retry = Math.max(retry, ttl);
        }
      }
      return [block, retry];
    }
  };
  return client;
}

function request(pin, ip = '192.0.2.120') {
  return createReq({
    method: 'POST',
    headers: { 'x-rin-pin': pin, 'x-vercel-forwarded-for': ip },
    body: {}
  });
}

async function invoke(pin, ip) {
  const res = createRes();
  await loginHandler(request(pin, ip), res);
  return res;
}

test('many successful PWA reload validations never consume the incorrect-PIN counter', async () => {
  const client = redisHarness();
  setSecurityRedisForTests(client);
  try {
    for (let i = 0; i < 70; i++) {
      const res = await invoke('test-2612-strong-pin');
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
    }
    assert.equal(client.values.size, 0);
    assert.equal(client.evals, 70);
    assert.equal((await invoke('nope')).statusCode, 401);
    assert.equal(client.values.size, 2);
  } finally { setSecurityRedisForTests(null); }
});

test('eight incorrect PINs lock out additional attempts, including a correct guess, until TTL expiry', async () => {
  const client = redisHarness();
  setSecurityRedisForTests(client);
  const oldWarn = console.warn;
  console.warn = () => {};
  try {
    for (let i = 0; i < 8; i++) assert.equal((await invoke('bad-pin')).statusCode, 401);
    const denied = await invoke('test-2612-strong-pin');
    assert.equal(denied.statusCode, 429);
    assert.deepEqual(denied.body, {code:'RIN_RATE_LIMITED'});
    assert.ok(Number(denied.headers['retry-after']) > 0);
    client.advance(901);
    assert.equal((await invoke('test-2612-strong-pin')).statusCode, 200);
    assert.equal(client.values.size, 0); // The expired record is removed on read; success writes nothing.
  } finally { console.warn = oldWarn; setSecurityRedisForTests(null); }
});

test('correct PIN does not reset earlier failed attempt count', async () => {
  const client = redisHarness();
  setSecurityRedisForTests(client);
  const oldWarn = console.warn;
  console.warn = () => {};
  try {
    for (let i = 0; i < 4; i++) assert.equal((await invoke('wrong')).statusCode,401);
    for (let i = 0; i < 15; i++) assert.equal((await invoke('test-2612-strong-pin')).statusCode,200);
    for (let i = 0; i < 4; i++) assert.equal((await invoke('wrong')).statusCode,401);
    assert.equal((await invoke('test-2612-strong-pin')).statusCode,429);
  } finally { console.warn = oldWarn; setSecurityRedisForTests(null); }
});

test('Redis error fails closed even when correct PIN is supplied, without leaking secrets', async () => {
  setSecurityRedisForTests({ async eval() { throw new Error('redis-secret-and-pin-must-not-log'); }});
  const oldWarn = console.warn;
  const lines = [];
  console.warn = msg => lines.push(msg);
  try {
    const res = await invoke('test-2612-strong-pin');
    assert.equal(res.statusCode,503);
    assert.deepEqual(res.body,{code:'RIN_SECURITY_TEMPORARILY_UNAVAILABLE'});
    assert.doesNotMatch(JSON.stringify({lines,body:res.body}), /redis-secret-and-pin-must-not-log|test-2612-strong-pin/);
  } finally { console.warn = oldWarn; setSecurityRedisForTests(null); }
});

test('missing ACCESS_PIN remains a configuration error and does not create a failed-attempt strike', async () => {
  const client = redisHarness();
  setSecurityRedisForTests(client);
  try {
    delete process.env.ACCESS_PIN;
    const res = await invoke('any');
    assert.equal(res.statusCode,503);
    assert.equal(res.body.code,'AUTH_NOT_CONFIGURED');
    assert.equal(client.values.size,0);
  } finally { process.env.ACCESS_PIN = 'test-2612-strong-pin';
const originalSessionKey=process.env.RIN_PUSH_DATA_KEY;
process.env.RIN_PUSH_DATA_KEY=Buffer.alloc(32,43).toString('base64url');
setSessionRedisForTests({async set(){return 'OK';}}); setSecurityRedisForTests(null); }
});

test('all UI entry points and debug version agree on release 2.6.12', async () => {
  const {readFile} = await import('node:fs/promises');
  const release = await readFile(new URL('../public/js/release.js', import.meta.url), 'utf8');
  const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const login = await readFile(new URL('../public/login.html', import.meta.url), 'utf8');
  const client = await readFile(new URL('../public/chat.js', import.meta.url), 'utf8');
  const id = release.match(/RIN_RELEASE_ID = '([^']+)'/)?.[1];
  assert.equal(id, '2026-10-14-rin-mind-v2.6.13-secure-session-private-backup');
  for (const html of [index, login]) {
    assert.match(html, /v2\.6\.13-secure-session-private-backup/);
    assert.doesNotMatch(html, /v2\.6\.9-scene-episodic-candidates/);
  }
  assert.match(client, /const RIN_BUILD_VERSION = RIN_RELEASE_ID/);
});

test.after(() => {
  if (originalPin === undefined) delete process.env.ACCESS_PIN;
  else process.env.ACCESS_PIN = originalPin;
  setSecurityRedisForTests(null);
  setSessionRedisForTests(null);
  if(originalSessionKey===undefined)delete process.env.RIN_PUSH_DATA_KEY;
  else process.env.RIN_PUSH_DATA_KEY=originalSessionKey;
});
