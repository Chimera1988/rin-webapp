import { setSecurityRedisForTests } from '../../lib/server/security-gate.js';

export function enableTestSecurity() {
  const counters = new Map();
  setSecurityRedisForTests({
    async eval(_script, keys, args) {
      let exceeded = 0;
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const maximum = Number(args[2 * i + 1]);
        const current = (counters.get(key) || 0) + 1;
        counters.set(key, current);
        if (current > maximum && !exceeded) exceeded = i + 1;
      }
      return [exceeded, exceeded ? Number(args[(exceeded - 1) * 2]) : 0];
    }
  });
  return () => setSecurityRedisForTests(null);
}
