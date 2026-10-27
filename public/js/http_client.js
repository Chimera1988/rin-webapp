const DEFAULT_TIMEOUT_MS = 15_000;
const LEGACY_PIN_KEY = 'rin-pin';
let csrfToken = '';

export function requestDeadlineExceeded(startedAt, timeoutMs, now = Date.now()) {
  return Number.isFinite(startedAt) && Number.isFinite(now)
    && now - startedAt >= Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const startedAt = Date.now();
  const maxWait = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
  let exceeded = false;
  const timedOut = () => {
    if (requestDeadlineExceeded(startedAt, maxWait)) {
      exceeded = true;
      controller.abort(new DOMException('Client request timeout', 'AbortError'));
    }
  };
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) forwardAbort();
  else externalSignal?.addEventListener?.('abort', forwardAbort, { once: true });
  // iOS can suspend timers while the PWA is in the background. Recheck elapsed
  // wall time on resume; never accept a stale response as a fresh committed turn.
  const onResume = () => timedOut();
  const timer = setTimeout(timedOut, maxWait);
  const hasDocument = typeof document !== 'undefined';
  const hasWindow = typeof window !== 'undefined';
  if (hasDocument) document.addEventListener('visibilitychange', onResume);
  if (hasWindow) window.addEventListener('pageshow', onResume);
  try {
    const response = await fetch(url, {...options, credentials:'same-origin', signal:controller.signal});
    timedOut();
    if (exceeded) throw new DOMException('Client request timeout', 'AbortError');
    return response;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', forwardAbort);
    if (hasDocument) document.removeEventListener('visibilitychange', onResume);
    if (hasWindow) window.removeEventListener('pageshow', onResume);
  }
}
export function setCsrfToken(value) {csrfToken=String(value||'');}
export function authenticatedHeaders(headers = {}) {
  return csrfToken ? {...headers,'X-Rin-CSRF':csrfToken} : {...headers};
}
// One-time automatic migration for an iPhone whose existing localStorage holds the old PIN.
export function getStoredPin(storage = localStorage){
  try{return String(storage.getItem(LEGACY_PIN_KEY)||'').trim();}catch{return '';}
}
export function removeStoredPin(storage = localStorage){
  try{storage.removeItem(LEGACY_PIN_KEY);return true;}catch{return false;}
}
