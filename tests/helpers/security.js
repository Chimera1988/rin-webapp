import { createHmac } from 'node:crypto';
import { setSessionRedisForTests, COOKIE_NAME } from '../../lib/server/session.js';
import { setSecurityRedisForTests } from '../../lib/server/security-gate.js';

const TEST_TOKEN='A'.repeat(43);
const TEST_CSRF='B'.repeat(43);
export function testSessionHeaders(){return {'cookie':`${COOKIE_NAME}=${TEST_TOKEN}`,'x-rin-csrf':TEST_CSRF};}
export function enableTestSecurity() {
  const oldKey=process.env.RIN_PUSH_DATA_KEY;
  if(!oldKey)process.env.RIN_PUSH_DATA_KEY=Buffer.alloc(32,41).toString('base64url');
  const sessions=new Map();
  const redis={
    async set(k,v){sessions.set(k,v);return 'OK';},
    async get(k){
      const secret=Buffer.from(String(process.env.RIN_PUSH_DATA_KEY||''),'base64url');
      const digest=createHmac('sha256',secret).update(`rin-session-v1:${TEST_TOKEN}`).digest('hex');
      const pinRevision=createHmac('sha256',secret).update(`rin-pin-rev-v1:${String(process.env.ACCESS_PIN||'')}`).digest('hex');
      if(k===`rin:session:v2613:${digest}`)return JSON.stringify({csrf:TEST_CSRF,pinRevision});
      return sessions.get(k)||null;
    },
    async del(k){return sessions.delete(k)?1:0;}
  };
  setSessionRedisForTests(redis);
  globalThis.__rinTestSessionHeaders=testSessionHeaders;

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
  return () => {
    setSecurityRedisForTests(null);
    setSessionRedisForTests(null);
    delete globalThis.__rinTestSessionHeaders;
    if(oldKey===undefined)delete process.env.RIN_PUSH_DATA_KEY;
    else process.env.RIN_PUSH_DATA_KEY=oldKey;
  };
}
