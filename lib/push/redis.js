import { openSealed, seal, PUSH_PREFIX, SNAPSHOT_TTL_SECONDS, DELIVERY_TTL_SECONDS } from './core.js';
let cached;
export async function pushRedis() {
  if (cached) return cached;
  const url = process.env.RIN_PUSH_KV_REST_API_URL || process.env.RIN_PUSH_REST_API_URL || process.env.RIN_PUSH_REDIS_REST_URL || process.env.RIN_PUSH_UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.RIN_PUSH_KV_REST_API_TOKEN || process.env.RIN_PUSH_REST_API_TOKEN || process.env.RIN_PUSH_REDIS_REST_TOKEN || process.env.RIN_PUSH_UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('RIN_PUSH_REDIS_NOT_CONFIGURED');
  const { Redis } = await import('@upstash/redis');
  cached = new Redis({url,token});
  return cached;
}
export const pushKey = name => `${PUSH_PREFIX}:${name}`;
export async function readProtected(redis, name) {
  const raw = await redis.get(pushKey(name));
  return raw ? openSealed(raw) : null;
}
export async function writeProtected(redis, name, value, ttl = SNAPSHOT_TTL_SECONDS) {
  return redis.set(pushKey(name),seal(value), {ex:ttl});
}
export async function deleteProtected(redis,...names) {
  return redis.del(...names.map(pushKey));
}
export async function acquirePushLease(redis, suffix, ttl = 110) {
  const response = await redis.set(pushKey(`lock:${suffix}`), String(Date.now()),{nx:true,ex:ttl});
  return response === 'OK';
}
export { DELIVERY_TTL_SECONDS };
