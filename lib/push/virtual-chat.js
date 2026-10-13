import { INTERNAL_BACKGROUND_CALL } from '../server/security-gate.js';
import chatHandler from '../../api/chat.js';

// The existing Rin Mind route is used unchanged, including its validators, canon and cognition.
// The in-process Symbol verifies the background invocation without passing PIN credentials.
export async function createBackgroundTurn(payload) {
  let status = 500, result = null;
  const res = {
    setHeader() { return this; },
    status(code) { status = code; return this; },
    json(body) { result = body; return this; }
  };
  await chatHandler({method:'POST',headers:{},body:payload,[INTERNAL_BACKGROUND_CALL]:true},res);
  if (status !== 200) {
    const error = new Error(`BACKGROUND_MIND_FAILED:${result?.code || status}`);
    error.code = result?.code || 'BACKGROUND_MIND_FAILED';
    throw error;
  }
  return result;
}
