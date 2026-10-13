import test from 'node:test';
import assert from 'node:assert/strict';
import { applySecurityLimit, auditRejectedPin, INTERNAL_BACKGROUND_CALL, setSecurityRedisForTests } from '../lib/server/security-gate.js';
import { createReq, createRes } from './helpers/runtime.js';

function fakeRedis() {
  const keys = new Map();
  let now = 0;
  return {
    keys,
    shift(seconds) { now += seconds; },
    async eval(_script, ks, args) {
      let firstExceeded = 0;
      let retry = 0;
      for (let i = 0; i < ks.length; i++) {
        const key = ks[i];
        const ttlSeconds = Number(args[i * 2]);
        const max = Number(args[i * 2 + 1]);
        let record = keys.get(key);
        if (!record || record.expires <= now) record = {count: 0, expires: now + ttlSeconds};
        record.count += 1;
        keys.set(key, record);
        if (record.count > max) {
          if (!firstExceeded) firstExceeded = i + 1;
          retry = Math.max(retry, Math.ceil(record.expires - now));
        }
      }
      return [firstExceeded, retry];
    }
  };
}
const env = { ACCESS_PIN: 'protected-test-secret', RIN_PUSH_DATA_KEY: 'independent-hmac-secret' };
function request(ip = '192.0.2.5') {
  return createReq({ headers: { 'x-vercel-forwarded-for': ip, 'x-rin-pin': 'unrelated-pin' } });
}

test('login brute-force limit is atomic, shared across endpoints and returns safe Retry-After', async () => {
  const redis = fakeRedis();
  const req = request();
  for (let n = 0; n < 8; n++) assert.equal(await applySecurityLimit(req, createRes(), 'login', {redis,env}), true);
  const response = createRes();
  assert.equal(await applySecurityLimit(req, response, 'login', {redis,env}), false);
  assert.equal(response.statusCode, 429);
  assert.deepEqual(response.body, {code: 'RIN_RATE_LIMITED'});
  assert.ok(Number(response.headers['retry-after']) > 0);
  const dump = JSON.stringify([...redis.keys]);
  assert.doesNotMatch(dump, /192\.0\.2\.5|protected-test-secret|unrelated-pin/);
  redis.shift(901);
  assert.equal(await applySecurityLimit(req, createRes(), 'login', {redis,env}), true);
});

test('distributed login brute-force is bounded by the shared global budget', async () => {
  const redis = fakeRedis();
  for (let n = 0; n < 30; n++) {
    const res = createRes();
    assert.equal(await applySecurityLimit(request(`198.51.100.${n + 1}`), res, 'login', {redis,env}), true);
  }
  const res = createRes();
  assert.equal(await applySecurityLimit(request('203.0.113.2'),res,'login',{redis,env}),false);
  assert.equal(res.statusCode,429);
});

test('PIN entry points other than login share a separate universal attempt budget', async () => {
  const redis = fakeRedis();
  const req = request('198.51.100.10');
  for (let n=0; n<160; n++) assert.equal(await applySecurityLimit(req,createRes(),'api',{redis,env}),true);
  const denied = createRes();
  assert.equal(await applySecurityLimit(req,denied,'api',{redis,env}),false);
  assert.equal(denied.body.code,'RIN_RATE_LIMITED');
});

test('paid endpoints have separate burst and daily budgets', async () => {
  const redis = fakeRedis();
  const req = request();
  for (let n=0; n<40; n++) assert.equal(await applySecurityLimit(req,createRes(),'chat',{redis,env}),true);
  assert.equal(await applySecurityLimit(req,createRes(),'chat',{redis,env}),false);
  assert.equal(await applySecurityLimit(req,createRes(),'memory',{redis,env}),true);
  assert.equal(await applySecurityLimit(req,createRes(),'tts',{redis,env}),true);
  redis.shift(301);
  assert.equal(await applySecurityLimit(req,createRes(),'chat',{redis,env}),true);
});

test('Redis failure denies requests before paid model calls', async () => {
  const redis = { async eval() { throw new Error('redis secret credentials in failure detail'); } };
  const old = console.warn;
  const logs=[];
  console.warn = (...args)=>logs.push(args.join(' '));
  try {
    const response = createRes();
    assert.equal(await applySecurityLimit(request(), response, 'login', {redis,env}),false);
    assert.equal(response.statusCode,503);
    assert.deepEqual(response.body,{code:'RIN_SECURITY_TEMPORARILY_UNAVAILABLE'});
    assert.doesNotMatch(JSON.stringify({response,logs}),/secret credentials|protected-test-secret|192\.0\.2\.5/);
  } finally { console.warn = old; }
});

test('internal cron capability cannot be created by network JSON or headers', async () => {
  const broken = {async eval(){throw new Error('should not be called');}};
  const fakeRemote = request();
  fakeRemote.headers['x-rin-internal'] = 'true';
  fakeRemote.body = {INTERNAL_BACKGROUND_CALL:true};
  assert.equal(await applySecurityLimit({...fakeRemote,[INTERNAL_BACKGROUND_CALL]:true}, createRes(), 'chat', {redis:broken,env}), true);
  const res = createRes();
  const old = console.warn;
  console.warn = () => {};
  try {assert.equal(await applySecurityLimit(fakeRemote,res,'chat',{redis:broken,env}),false);}
  finally {console.warn = old;}
  assert.equal(res.statusCode,503);
});

test('security event logging emits fixed metadata, never a PIN or user text', () => {
  const old = console.warn;
  const logs=[];
  console.warn = (...args)=>logs.push(args.join(' '));
  try {auditRejectedPin('chat');auditRejectedPin('https://example.invalid/secret?pin=123456');}
  finally {console.warn = old;}
  assert.deepEqual(logs,['[rin-security] pin_rejected kind=chat scope=auth','[rin-security] pin_rejected kind=other scope=auth']);
});

// Guard against accidentally mutating runtime state in a test suite.
test.after(() => setSecurityRedisForTests(null));
