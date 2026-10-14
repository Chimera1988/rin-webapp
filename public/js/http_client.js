const DEFAULT_TIMEOUT_MS = 15_000;
const LEGACY_PIN_KEY = 'rin-pin';
let csrfToken = '';

export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) forwardAbort();
  else externalSignal?.addEventListener?.('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Client request timeout', 'AbortError')),
    Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  try {return await fetch(url, {...options, credentials:'same-origin', signal:controller.signal});}
  finally {clearTimeout(timer);externalSignal?.removeEventListener?.('abort',forwardAbort);}
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
