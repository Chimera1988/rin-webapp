const DEFAULT_TIMEOUT_MS = 15_000;
const PIN_KEY = 'rin-pin';

export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) forwardAbort();
  else externalSignal?.addEventListener?.('abort', forwardAbort, { once: true });

  const timer = setTimeout(() => {
    controller.abort(new DOMException('Client request timeout', 'AbortError'));
  }, Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', forwardAbort);
  }
}

/** Transport-only diagnostics. Never silently replay a submitted chat request. */
export async function fetchWithTransportDiagnostics(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const started = Date.now();
  try {
    return await fetchWithTimeout(url, options, timeoutMs);
  } catch (cause) {
    const failure = cause instanceof Error ? cause : new Error(String(cause ?? 'Fetch failed'));
    const timeout = failure.name === 'AbortError';
    const raw = String(failure.message || '');
    const kind = timeout ? 'client_abort_or_timeout'
      : /load failed|failed to fetch|networkerror|network request failed/i.test(raw) ? 'network_load_failed'
      : 'transport_exception';
    let online = 'unknown';
    let visibility = 'unknown';
    try { if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') online = navigator.onLine ? 'yes' : 'no'; } catch {}
    try { if (typeof document !== 'undefined') visibility = String(document.visibilityState || 'unknown').slice(0,24); } catch {}
    failure.transportDiagnostics = {kind,elapsedMs:Date.now()-started,online,visibility};
    throw failure;
  }
}

export function getStoredPin(storage = localStorage) {
  try { return String(storage.getItem(PIN_KEY) || '').trim(); } catch { return ''; }
}

export function storePin(pin, storage = localStorage) {
  try {
    storage.setItem(PIN_KEY, String(pin || '').trim());
    return true;
  } catch {
    return false;
  }
}

export function removeStoredPin(storage = localStorage) {
  try {
    storage.removeItem(PIN_KEY);
    return true;
  } catch {
    return false;
  }
}

export function authenticatedHeaders(headers = {}, storage = localStorage) {
  return { ...headers, 'X-Rin-Pin': getStoredPin(storage) };
}
