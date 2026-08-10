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
