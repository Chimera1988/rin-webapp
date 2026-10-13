import { setSecurityRedisForTests } from '../../lib/server/security-gate.js';

export function enableTestSecurity() {
  const counters = new Map();
  setSecurityRedisForTests({
    async eval(script, keys, args) {
      const login = script.includes('RIN_LOGIN_FAILURE_WINDOW');
      const recordFailure = login && args[0] === '1';
      let exceeded = 0;
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const maximum = Number(args[2 * i + (login ? 2 : 1)]);
        const current = (counters.get(key) || 0) + (!login || recordFailure ? 1 : 0);
        if (!login || recordFailure) counters.set(key, current);
        if ((login && !recordFailure ? current >= maximum : current > maximum) && !exceeded) exceeded = i + 1;
      }
      return [exceeded, exceeded ? Number(args[(exceeded - 1) * 2 + (login ? 1 : 0)]) : 0];
    }
  });
  return () => setSecurityRedisForTests(null);
}
