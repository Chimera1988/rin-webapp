export class MemoryStorage {
  constructor(initial = {}) { this.map = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)])); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
  setItem(key, value) { this.map.set(String(key), String(value)); }
  removeItem(key) { this.map.delete(String(key)); }
  clear() { this.map.clear(); }
}

export function createReq({ method = 'POST', headers = {}, body = {}, query = {} } = {}) {
  const pin=headers['x-rin-pin'] ?? headers['X-Rin-Pin'];
  const validPin=pin && pin===String(process.env.ACCESS_PIN||'');
  // Legacy fixtures now authenticate as a session. Production code has no such bridge.
  const sessionHeaders=validPin && globalThis.__rinTestSessionHeaders?.() || {};
  return { method, headers:{...sessionHeaders,...headers}, body, query };
}

export function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; }
  };
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
