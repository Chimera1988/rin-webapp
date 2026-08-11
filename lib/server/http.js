import { timingSafeEqual } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 1_000_000;

function parseJson(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}


export function requireMethod(req, res, method) {
  const allowed = String(method || '').toUpperCase();
  if (String(req?.method || '').toUpperCase() === allowed) return true;
  res.setHeader?.('Allow', allowed);
  res.status(405).json({ error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
  return false;
}

export async function readJsonBody(req) {
  if (req?.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (Buffer.isBuffer(req?.body)) return req.body.length <= MAX_BODY_BYTES ? parseJson(req.body.toString('utf8')) : {};
  if (typeof req?.body === 'string') return Buffer.byteLength(req.body, 'utf8') <= MAX_BODY_BYTES ? parseJson(req.body) : {};
  if (!req || typeof req[Symbol.asyncIterator] !== 'function') return {};

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return {};
    chunks.push(buffer);
  }
  return parseJson(Buffer.concat(chunks).toString('utf8'));
}

export function requestPin(req, body = {}) {
  const headers = req?.headers || {};
  const header = typeof headers.get === 'function'
    ? headers.get('x-rin-pin')
    : headers['x-rin-pin'] ?? headers['X-Rin-Pin'];
  return String(header ?? body?.pin ?? '').trim();
}

function pinsMatch(actual, expected) {
  const actualBuffer = Buffer.from(String(actual), 'utf8');
  const expectedBuffer = Buffer.from(String(expected), 'utf8');
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function requirePin(req, res, body = {}) {
  res.setHeader?.('Cache-Control', 'no-store');
  const configured = String(process.env.ACCESS_PIN ?? '').trim();
  if (!configured) {
    res.status(503).json({ error: 'Service authentication is not configured', code: 'AUTH_NOT_CONFIGURED' });
    return false;
  }
  if (!pinsMatch(requestPin(req, body), configured)) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return false;
  }
  return true;
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const forwardAbort = () => controller.abort(externalSignal?.reason);

  if (externalSignal?.aborted) forwardAbort();
  else externalSignal?.addEventListener?.('abort', forwardAbort, { once: true });

  const timeout = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
  const timer = setTimeout(() => {
    controller.abort(new DOMException('Upstream request timeout', 'AbortError'));
  }, timeout);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', forwardAbort);
  }
}

export function publicError(error, fallback = 'Internal error') {
  if (error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('timeout')) {
    return { status: 504, body: { error: 'Upstream timeout', code: 'UPSTREAM_TIMEOUT' } };
  }
  return { status: 500, body: { error: fallback, code: 'INTERNAL_ERROR' } };
}

