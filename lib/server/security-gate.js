import { createHmac } from 'node:crypto';
import { pushRedis } from '../push/redis.js';

// Private in-process capability: an HTTP request cannot manufacture this Symbol through JSON/headers.
export const INTERNAL_BACKGROUND_CALL = Symbol('rin-verified-background-call');

const PREFIX = 'rin:security:v2611';
const LIMITS = Object.freeze({
  login: [{ name: 'ip', max: 8, seconds: 900 }, { name: 'global', max: 30, seconds: 900 }],
  api: [{ name: 'ip', max: 160, seconds: 900 }, { name: 'global', max: 400, seconds: 900 }],
  chat: [{ name: 'burst', max: 40, seconds: 300 }, { name: 'daily', max: 650, seconds: 86400 }],
  memory: [{ name: 'burst', max: 65, seconds: 300 }, { name: 'daily', max: 650, seconds: 86400 }],
  tts: [{ name: 'burst', max: 80, seconds: 300 }, { name: 'daily', max: 600, seconds: 86400 }]
});

// One Redis EVAL atomically enforces both quotas, reducing cross-region round trips.
const INCREMENT_WINDOWS = `
local firstExceeded = 0
local retryAfter = 0
for i = 1, #KEYS do
  local seconds = tonumber(ARGV[2 * i - 1])
  local maximum = tonumber(ARGV[2 * i])
  local current = redis.call('INCR', KEYS[i])
  if current == 1 then redis.call('EXPIRE', KEYS[i], seconds) end
  local ttl = redis.call('TTL', KEYS[i])
  if ttl < 0 then redis.call('EXPIRE', KEYS[i], seconds); ttl = seconds end
  if current > maximum then
    if firstExceeded == 0 then firstExceeded = i end
    if ttl > retryAfter then retryAfter = ttl end
  end
end
return {firstExceeded, retryAfter}
`;

let testRedisClient = null;
// Test-only dependency injection. Never controlled by an HTTP parameter.
export function setSecurityRedisForTests(client) { testRedisClient = client; }

function peerFingerprint(req, env = process.env) {
  const headers = req?.headers || {};
  const get = name => typeof headers.get === 'function' ? headers.get(name) : headers[name];
  // Vercel-supplied forwarding header is preferred; any fallback is also bounded by a global quota.
  const candidate = get('x-vercel-forwarded-for') || get('x-forwarded-for') || req?.socket?.remoteAddress || 'unknown';
  const ip = String(Array.isArray(candidate) ? candidate[0] : candidate).split(',')[0].trim().slice(0, 90);
  const secret = String(env.RIN_PUSH_DATA_KEY || env.CRON_SECRET || env.ACCESS_PIN || '');
  if (!secret) throw new Error('SECURITY_IDENTITY_KEY_UNAVAILABLE');
  return createHmac('sha256', secret).update(ip || 'unknown').digest('hex').slice(0, 24);
}

function event(name, kind, scope) {
  // Only fixed enums. No IP, PIN, session, user text, headers, URLs, or request payloads.
  console.warn(`[rin-security] ${name} kind=${kind} scope=${scope}`);
}

function reject(res, status, code, retry = 0) {
  res.setHeader?.('Cache-Control', 'no-store');
  if (retry) res.setHeader?.('Retry-After', String(Math.min(86400, Math.max(1, Math.ceil(retry)))));
  res.status(status).json({ code });
  return false;
}

export async function applySecurityLimit(req, res, category, { redis = null, env = process.env } = {}) {
  if (req?.[INTERNAL_BACKGROUND_CALL] === true) return true;
  const rules = LIMITS[category];
  if (!rules) throw new Error('UNSUPPORTED_SECURITY_LIMIT');
  const kind = category === 'login' ? 'login' : (category === 'api' ? 'api' : 'paid');
  try {
    const client = redis || testRedisClient || await pushRedis();
    const fingerprint = peerFingerprint(req, env);
    const keys = rules.map(rule => `${PREFIX}:${category}:${rule.name}:${rule.name === 'ip' ? fingerprint : 'all'}`);
    const args = rules.flatMap(rule => [String(rule.seconds), String(rule.max)]);
    const answer = await client.eval(INCREMENT_WINDOWS, keys, args);
    const blockedIndex = Number(answer?.[0]);
    const ttl = Number(answer?.[1]);
    if (!Number.isSafeInteger(blockedIndex) || blockedIndex < 0 || blockedIndex > rules.length || !Number.isFinite(ttl)) {
      throw new Error('SECURITY_RATE_RESPONSE_INVALID');
    }
    if (blockedIndex > 0) {
      event('rate_limited', category, rules[blockedIndex - 1].name);
      return reject(res, 429, 'RIN_RATE_LIMITED', ttl);
    }

    return true;
  } catch (error) {
    // Fail closed, otherwise Redis outages silently reopen unlimited paid API calls and PIN guessing.
    event('limiter_unavailable', kind, 'redis');
    return reject(res, 503, 'RIN_SECURITY_TEMPORARILY_UNAVAILABLE');
  }
}

export function auditRejectedPin(route) {
  const safeRoute = ['login', 'chat', 'memory', 'tts', 'archive', 'archive-media', 'push', 'weather'].includes(route) ? route : 'other';
  event('pin_rejected', safeRoute, 'auth');
}
