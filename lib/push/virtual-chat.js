import chatHandler from '../../api/chat.js';

// The existing Rin Mind route is used unchanged, including its validators, canon and cognition.
// Credentials are never persisted in Redis; only the server's own ACCESS_PIN is used here.
export async function createBackgroundTurn(payload) {
  let status = 500, result = null;
  const res = {
    setHeader() { return this; },
    status(code) { status = code; return this; },
    json(body) { result = body; return this; }
  };
  await chatHandler({method:'POST',headers:{'x-rin-pin':process.env.ACCESS_PIN||''},body:payload},res);
  if (status !== 200) {
    const error = new Error(`BACKGROUND_MIND_FAILED:${result?.code || status}`);
    error.code = result?.code || 'BACKGROUND_MIND_FAILED';
    throw error;
  }
  return result;
}
