import { RIN_RELEASE_ID } from './release.js';
import { authenticatedHeaders, fetchWithTimeout, getStoredPin, removeStoredPin } from './http_client.js';

function redirectToLogin(reason = '') {
  const query = reason ? `?reason=${encodeURIComponent(reason)}` : '';
  window.location.replace(`/login.html${query}`);
}

document.getElementById('backButton')?.addEventListener('click', () => {
  if (window.history.length > 1) window.history.back();
});

async function validateSession(pin) {
  try {
    const response = await fetchWithTimeout('/api/login', {
      method: 'POST',
      headers: authenticatedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ pin }),
      cache: 'no-store'
    }, 10_000);
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, status: 0, code: error?.name === 'AbortError' ? 'timeout' : 'network' };
  }
}

const pin = getStoredPin();
if (!pin) {
  redirectToLogin('missing_pin');
} else {
  const auth = await validateSession(pin);
  if (!auth.ok) {
    if (auth.status === 401) {
      removeStoredPin();
      redirectToLogin('invalid_pin');
    } else {
      redirectToLogin('auth_unavailable');
    }
  } else {
    await import(`/js/persona_ui.js?v=${encodeURIComponent(RIN_RELEASE_ID)}`);
    const chatModule = await import(`/chat.js?v=${encodeURIComponent(RIN_RELEASE_ID)}`);
    await chatModule.RIN_CHAT_READY;
    document.documentElement.classList.add('auth-ready');
  }
}
